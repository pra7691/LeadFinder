/**
 * Scheduler pipeline: runs discovery → crawl → score → email for a campaign.
 * Called by the cron worker and the manual trigger endpoint.
 */

import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignKeywordsTable,
  campaignCountriesTable,
  campaignRunsTable,
  campaignRunResultsTable,
  leadsTable,
  campaignRunBatchesTable,
  campaignRunBatchItemsTable,
  outreachQueueTable,
  emailAccountsTable,
  campaignEmailAccountsTable,
  appSettingsTable,
  logsTable,
  searchQueryHistoryTable,
  searchResultHistoryTable,
  discoverySourceHistoryTable,
  leadListsTable,
  leadListItemsTable,
  emailTemplatesTable,
  type CampaignRunConfigurationSnapshot,
} from "@workspace/db";
import { eq, and, or, sql, desc, gte, isNotNull, isNull, like, inArray } from "drizzle-orm";
import { searchSerper, extractRootDomain } from "../services/serper";
import { getSerperApiKey } from "../services/serper-key";
import { crawlWebsite, extractCompanyLinksFromPage } from "../services/crawler";
import { classifyLeadType } from "../services/lead-classifier";
import { scoreLead } from "../services/scorer";
import { classifyEmail } from "../services/email-validator";
import { isEmailBlacklisted } from "../services/email-blacklist";
import nodemailer from "nodemailer";
import { isEncrypted, decrypt } from "../lib/crypto";
import { logger } from "../lib/logger";
import { appendUnsubscribeFooter, toHtmlEmail, toTextEmail } from "../services/email-html";
import { buildUnsubscribeUrl, isEmailUnsubscribed } from "../routes/unsubscribe";
import { parseLeadEmails, getPrimaryLeadEmail, sanitizeEmail } from "../services/lead-emails";
import { generatePersonalizedEmail } from "../services/email-generator";
import { domainMatchesBlockedList, parseBlockedDomains, normalizeDomainToken } from "../services/domain-blocklist";
import { normalizeUniqueRecipients } from "./incremental-batch-utils";
import { isCancellationStatus } from "./run-safety";
import {
  campaignFromRunConfiguration,
  isCampaignRunConfigurationSnapshot,
  shouldSkipRefresh,
  templateFromRunConfiguration,
} from "./campaign-run-configuration";
import {
  isRunReadyForFinalization,
  missingDraftRecipients,
  missingListItems,
  resolveTerminalRunStatus,
} from "./campaign-run-finalization-core";
import { classifyNetworkFailure, shouldQueueBrowserRetry } from "../services/crawl-failure-classifier";
import {
  getBrowserRetryState,
  recordHttpCrawlFailure,
  recordHttpCrawlInterrupted,
  recordHttpCrawlStarted,
  recordHttpCrawlSucceeded,
  startBrowserRetryWorker,
} from "../services/browser-retry-queue";
import { FAILED_CRAWL_EXCLUDED_LEAD_TYPES, isNonTargetFailedCrawlUrl } from "../services/failed-crawl-core";

const CRAWL_CONCURRENCY = 5;
const SCORE_CONCURRENCY = 2;
const PROCESSING_BATCH_SIZE = 50;

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const runNext = () => {
    if (active >= concurrency) return;
    const next = queue.shift();
    if (!next) return;
    active++;
    next();
  };

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      runNext();
    });
    try {
      return await task();
    } finally {
      active--;
      runNext();
    }
  };
}

const crawlLimiter = createLimiter(CRAWL_CONCURRENCY);
const scoreLimiter = createLimiter(SCORE_CONCURRENCY);
const runBatchDrainLocks = new Map<number, Promise<BatchProcessingStats>>();

type BatchProcessingStats = {
  batchesProcessed: number;
  scoredCount: number;
  failedCount: number;
  qualifiedCount: number;
  outreachDraftsCreated: number;
};

type CrawlStats = {
  crawledCount: number;
  scoredCount: number;
  failedCount: number;
  outreachDraftsCreated: number;
};

// ── Cancellation registry ─────────────────────────────────────────────────

const cancelledRuns = new Set<number>();
const activePipelineRuns = new Set<number>();

/** Signal the pipeline to stop at the next safe checkpoint. */
export function requestCancellation(runId: number): void {
  cancelledRuns.add(runId);
}

/** Clear the cancellation flag once the pipeline has acknowledged it. */
export function clearCancellation(runId: number | undefined | null): void {
  if (runId != null) cancelledRuns.delete(runId);
}

export function isRunPipelineActive(runId: number | undefined | null): boolean {
  return runId != null && activePipelineRuns.has(runId);
}

async function isCancellationRequested(runId: number | undefined | null): Promise<boolean> {
  if (runId == null) return false;
  if (cancelledRuns.has(runId)) return true;
  const [run] = await db
    .select({ status: campaignRunsTable.status })
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, runId));
  return isCancellationStatus(run?.status);
}

async function finalizeCancelledRun(
  campaignId: number,
  campaignRunId: number | undefined | null,
  startedAtMs: number,
): Promise<void> {
  if (campaignRunId == null) return;

  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - startedAtMs) / 1000);
  await db
    .update(campaignRunsTable)
    .set({
      status: "cancelled",
      currentStage: "cancelled",
      completedAt: now,
      durationSeconds,
      estimatedRemainingSeconds: 0,
    })
    .where(and(
      eq(campaignRunsTable.id, campaignRunId),
      inArray(campaignRunsTable.status, ["running", "cancelling"]),
    ));

  await db
    .update(campaignsTable)
    .set({ lastRunStatus: "cancelled", lastRunAt: now })
    .where(eq(campaignsTable.id, campaignId));

  await schedulerLog(campaignId, `Campaign run #${campaignRunId} cancelled at a safe checkpoint`, { campaignRunId });
  clearCancellation(campaignRunId);
}

function fromHeader(account: typeof emailAccountsTable.$inferSelect): string {
  const address = account.email || account.smtpUser;
  const displayName = account.senderName?.trim() || address;
  return `"${displayName.replace(/"/g, '\\"')}" <${address}>`;
}

function emptyBatchStats(): BatchProcessingStats {
  return {
    batchesProcessed: 0,
    scoredCount: 0,
    failedCount: 0,
    qualifiedCount: 0,
    outreachDraftsCreated: 0,
  };
}

function mergeBatchStats(
  target: BatchProcessingStats,
  incoming: BatchProcessingStats,
): BatchProcessingStats {
  target.batchesProcessed += incoming.batchesProcessed;
  target.scoredCount += incoming.scoredCount;
  target.failedCount += incoming.failedCount;
  target.qualifiedCount += incoming.qualifiedCount;
  target.outreachDraftsCreated += incoming.outreachDraftsCreated;
  return target;
}

function processingOutreachBatchKey(batch: typeof campaignRunBatchesTable.$inferSelect): string {
  return `campaign-run-${batch.campaignRunId}-batch-${batch.batchNumber}`;
}

async function getAssignedSenderAccountId(
  campaignId: number,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<number | null> {
  if (configurationSnapshot) {
    return configurationSnapshot.senderAccountIds[0] ?? null;
  }
  const [assigned] = await db
    .select({ accountId: campaignEmailAccountsTable.emailAccountId })
    .from(campaignEmailAccountsTable)
    .where(eq(campaignEmailAccountsTable.campaignId, campaignId))
    .limit(1);
  return assigned?.accountId ?? null;
}

async function getRecoverableBatch(
  campaignRunId: number,
): Promise<typeof campaignRunBatchesTable.$inferSelect | null> {
  if (await isCancellationRequested(campaignRunId)) return null;

  const [batch] = await db
    .select()
    .from(campaignRunBatchesTable)
    .where(and(
      eq(campaignRunBatchesTable.campaignRunId, campaignRunId),
      inArray(campaignRunBatchesTable.status, ["claimed", "scoring", "creating_drafts"]),
    ))
    .orderBy(campaignRunBatchesTable.batchNumber)
    .limit(1);
  return batch ?? null;
}

async function claimCrawledLeadBatch(
  campaign: typeof campaignsTable.$inferSelect,
  campaignRunId: number,
  flushPartial: boolean,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<typeof campaignRunBatchesTable.$inferSelect | null> {
  if (await isCancellationRequested(campaignRunId)) return null;

  return db.transaction(async (tx) => {
    const candidatesResult = await tx.execute(sql`
      SELECT l.id
      FROM leads l
      WHERE l.campaign_id = ${campaign.id}
        AND l.campaign_run_id = ${campaignRunId}
        AND l.crawl_status = 'crawled'
        AND l.scoring_method IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM campaign_run_batch_items bi
          WHERE bi.campaign_run_id = ${campaignRunId}
            AND bi.lead_id = l.id
        )
      ORDER BY l.id
      LIMIT ${PROCESSING_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `);
    const candidateRows =
      (candidatesResult as unknown as { rows?: { id: number }[] }).rows ?? [];
    if (candidateRows.length === 0) return null;
    if (!flushPartial && candidateRows.length < PROCESSING_BATCH_SIZE) return null;

    const nextNumberResult = await tx.execute(sql`
      SELECT COALESCE(MAX(batch_number), 0) + 1 AS next_number
      FROM campaign_run_batches
      WHERE campaign_run_id = ${campaignRunId}
    `);
    const nextNumberRows =
      (nextNumberResult as unknown as { rows?: { next_number: number | string }[] }).rows ?? [];
    const batchNumber = Number(nextNumberRows[0]?.next_number ?? 1);
    const senderAccountId = await getAssignedSenderAccountId(campaign.id, configurationSnapshot);
    let emailTemplateId = campaign.emailTemplateId ?? null;
    if (configurationSnapshot) {
      const snapshotTemplateId = configurationSnapshot.emailTemplate?.id ?? null;
      const [liveTemplate] = snapshotTemplateId
        ? await tx.select({ id: emailTemplatesTable.id })
          .from(emailTemplatesTable)
          .where(eq(emailTemplatesTable.id, snapshotTemplateId))
          .limit(1)
        : [];
      emailTemplateId = liveTemplate?.id ?? null;
    }

    const [batch] = await tx
      .insert(campaignRunBatchesTable)
      .values({
        campaignId: campaign.id,
        campaignRunId,
        batchNumber,
        status: "claimed",
        crawledLeadsCount: candidateRows.length,
        emailTemplateId: configurationSnapshot?.automation.autoOutreachEnabled === false
          ? null
          : emailTemplateId,
        senderAccountId,
      })
      .returning();
    if (!batch) return null;

    await tx.insert(campaignRunBatchItemsTable).values(
      candidateRows.map((row) => ({
        campaignId: campaign.id,
        campaignRunId,
        batchId: batch.id,
        leadId: row.id,
      })),
    ).onConflictDoNothing();

    return batch;
  });
}

async function isEmailHardBouncedForRecipient(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: outreachQueueTable.id })
    .from(outreachQueueTable)
    .where(and(
      eq(outreachQueueTable.recipientEmail, email.toLowerCase()),
      eq(outreachQueueTable.status, "bounced"),
    ))
    .limit(1);
  return Boolean(row);
}

async function canCreateAutoOutreachDraft(
  campaignId: number,
  lead: typeof leadsTable.$inferSelect,
  recipientEmail: string,
  blockedDomains: Set<string>,
): Promise<boolean> {
  if (lead.crawlStatus !== "crawled") return false;
  if (lead.qualificationStatus !== "qualified") return false;
  if (lead.reviewStatus === "low_relevance" || lead.reviewStatus === "rejected") return false;

  const email = sanitizeEmail(recipientEmail.trim()).toLowerCase();
  if (!email || !email.includes("@")) return false;
  if (classifyEmail(email).isRejected) return false;
  if (await isEmailBlacklisted(email)) return false;

  const recipientDomain = email.split("@")[1];
  if (recipientDomain && domainMatchesBlockedList(recipientDomain, blockedDomains)) return false;
  if (await isEmailUnsubscribed(email)) return false;
  if (await isEmailHardBouncedForRecipient(email)) return false;

  const [existing] = await db
    .select({ id: outreachQueueTable.id })
    .from(outreachQueueTable)
    .where(and(
      eq(outreachQueueTable.campaignId, campaignId),
      eq(outreachQueueTable.recipientEmail, email),
      inArray(outreachQueueTable.status, ["pending_review", "approved", "draft", "queued", "sent"]),
    ))
    .limit(1);
  return !existing;
}

async function processCampaignRunBatch(
  campaign: typeof campaignsTable.$inferSelect,
  batch: typeof campaignRunBatchesTable.$inferSelect,
  errors: string[],
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<BatchProcessingStats> {
  const stats = emptyBatchStats();
  if (await isCancellationRequested(batch.campaignRunId)) return stats;

  await db
    .update(campaignRunBatchesTable)
    .set({ status: "scoring", errorMessage: null })
    .where(eq(campaignRunBatchesTable.id, batch.id));

  const keywordList = configurationSnapshot
    ? configurationSnapshot.keywords
    : (await db
      .select({ keyword: campaignKeywordsTable.keyword })
      .from(campaignKeywordsTable)
      .where(eq(campaignKeywordsTable.campaignId, campaign.id)))
      .map((k) => k.keyword);

  const batchItems = await db
    .select({ leadId: campaignRunBatchItemsTable.leadId })
    .from(campaignRunBatchItemsTable)
    .where(eq(campaignRunBatchItemsTable.batchId, batch.id));
  if (batchItems.length === 0) {
    await db.update(campaignRunBatchesTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(campaignRunBatchesTable.id, batch.id));
    stats.batchesProcessed++;
    return stats;
  }

  const leadIds = batchItems.map((item) => item.leadId);
  let leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds));

  for (const lead of leads) {
    if (await isCancellationRequested(batch.campaignRunId)) break;
    if (lead.scoringMethod) continue;
    await scoreLimiter(async () => {
      const result = await scoreLead({
        leadId: lead.id,
        campaignObjective: campaign.objective,
        campaignKeywords: keywordList,
        companyName: lead.companyName,
        rootDomain: lead.rootDomain,
        rawText: lead.rawText ?? null,
        sourceQuery: lead.sourceQuery ?? null,
      }, configurationSnapshot?.ai);

      const failed = result.score == null;
      const reviewStatus =
        !failed && result.score !== null && result.score < campaign.minRelevanceScore
          ? "low_relevance"
          : lead.reviewStatus;
      const qualificationStatus =
        failed
          ? lead.qualificationStatus
          : result.score! >= campaign.minRelevanceScore
            ? "qualified"
            : "rejected";

      await db.update(leadsTable)
        .set({
          relevanceScore: result.score,
          relevanceReason: result.reason,
          scoringMethod: result.scoringMethod,
          reviewStatus,
          qualificationStatus,
        })
        .where(eq(leadsTable.id, lead.id));

      if (failed) {
        errors.push(`Score failed ${lead.rootDomain}: ${result.reason}`);
        stats.failedCount++;
      } else {
        stats.scoredCount++;
      }
    });
  }

  if (await isCancellationRequested(batch.campaignRunId)) {
    await db
      .update(campaignRunBatchesTable)
      .set({ status: "scoring", scoredCount: stats.scoredCount })
      .where(eq(campaignRunBatchesTable.id, batch.id));
    return stats;
  }

  leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds));
  const qualifiedLeads = leads.filter(
    (lead) =>
      lead.qualificationStatus === "qualified" &&
      (lead.relevanceScore ?? -1) >= campaign.minRelevanceScore,
  );
  stats.qualifiedCount = qualifiedLeads.length;

  await db
    .update(campaignRunBatchesTable)
    .set({
      status: "creating_drafts",
      scoredCount: stats.scoredCount,
      qualifiedCount: stats.qualifiedCount,
    })
    .where(eq(campaignRunBatchesTable.id, batch.id));

  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));
  const blockedDomains = parseBlockedDomains(blockedSetting?.value);

  const template = configurationSnapshot
    ? templateFromRunConfiguration(configurationSnapshot)
    : batch.emailTemplateId
      ? (await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, batch.emailTemplateId)))[0]
      : null;
  const senderAccountId = batch.senderAccountId ?? await getAssignedSenderAccountId(campaign.id, configurationSnapshot);
  const outreachBatchKey = processingOutreachBatchKey(batch);
  const seenRecipients = new Set<string>();

  if (template && senderAccountId) {
    for (const lead of qualifiedLeads) {
      if (await isCancellationRequested(batch.campaignRunId)) break;
      for (const recipientEmail of normalizeUniqueRecipients(parseLeadEmails(lead.emails))) {
        if (await isCancellationRequested(batch.campaignRunId)) break;
        if (seenRecipients.has(recipientEmail)) continue;
        seenRecipients.add(recipientEmail);
        if (!(await canCreateAutoOutreachDraft(campaign.id, lead, recipientEmail, blockedDomains))) {
          continue;
        }

        const result = await generatePersonalizedEmail(
          { ...lead, emails: recipientEmail },
          template,
          { campaignName: campaign.name, listName: "" },
          configurationSnapshot?.ai,
        );

        try {
          const [inserted] = await db.insert(outreachQueueTable).values({
            campaignId: campaign.id,
            leadId: lead.id,
            emailAccountId: senderAccountId,
            emailTemplateId: batch.emailTemplateId,
            templateSnapshot: configurationSnapshot?.emailTemplate ?? null,
            listId: null,
            recipientEmail,
            subject: result.subject,
            body: result.body,
            batchId: outreachBatchKey,
            outreachBatchId: batch.id,
            status: "pending_review",
            aiPersonalized: result.aiUsed,
          }).onConflictDoNothing().returning({ id: outreachQueueTable.id });
          if (inserted) stats.outreachDraftsCreated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ err, recipientEmail, batchId: batch.id }, "Incremental auto-outreach draft insert failed");
          errors.push(`Auto-outreach draft failed ${recipientEmail}: ${msg}`);
        }
      }
    }
  }

  if (await isCancellationRequested(batch.campaignRunId)) {
    await db
      .update(campaignRunBatchesTable)
      .set({
        status: "creating_drafts",
        scoredCount: stats.scoredCount,
        qualifiedCount: stats.qualifiedCount,
        outreachDraftsCreated: stats.outreachDraftsCreated,
      })
      .where(eq(campaignRunBatchesTable.id, batch.id));
    return stats;
  }

  await db
    .update(campaignRunBatchesTable)
    .set({
      status: "completed",
      scoredCount: stats.scoredCount,
      qualifiedCount: stats.qualifiedCount,
      outreachDraftsCreated: stats.outreachDraftsCreated,
      completedAt: new Date(),
    })
    .where(eq(campaignRunBatchesTable.id, batch.id));

  await schedulerLog(
    campaign.id,
    `Processing batch #${batch.batchNumber}: ${stats.scoredCount} scored, ${stats.qualifiedCount} qualified, ${stats.outreachDraftsCreated} pending-review drafts`,
    { campaignRunId: batch.campaignRunId, batchId: batch.id },
  );

  stats.batchesProcessed++;
  return stats;
}

async function drainCampaignRunBatchesUnlocked(
  campaign: typeof campaignsTable.$inferSelect,
  campaignRunId: number,
  errors: string[],
  flushPartial: boolean,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<BatchProcessingStats> {
  const stats = emptyBatchStats();

  while (true) {
    if (await isCancellationRequested(campaignRunId)) break;
    const batch =
      await getRecoverableBatch(campaignRunId) ??
      await claimCrawledLeadBatch(campaign, campaignRunId, flushPartial, configurationSnapshot);
    if (!batch) break;

    try {
      const batchStats = await processCampaignRunBatch(campaign, batch, errors, configurationSnapshot);
      mergeBatchStats(stats, batchStats);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Processing batch #${batch.batchNumber} failed: ${msg}`);
      stats.failedCount++;
      await db.update(campaignRunBatchesTable)
        .set({ status: "failed", errorMessage: msg.slice(0, 500) })
        .where(eq(campaignRunBatchesTable.id, batch.id));
      break;
    }
  }

  return stats;
}

async function drainCampaignRunBatches(
  campaign: typeof campaignsTable.$inferSelect,
  campaignRunId: number | undefined,
  errors: string[],
  flushPartial: boolean,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<BatchProcessingStats> {
  if (campaignRunId == null) return emptyBatchStats();
  if (await isCancellationRequested(campaignRunId)) return emptyBatchStats();

  const previous = runBatchDrainLocks.get(campaignRunId) ?? Promise.resolve(emptyBatchStats());
  const next = previous
    .catch(() => emptyBatchStats())
    .then(() => drainCampaignRunBatchesUnlocked(
      campaign,
      campaignRunId,
      errors,
      flushPartial,
      configurationSnapshot,
    ));
  runBatchDrainLocks.set(campaignRunId, next);

  try {
    return await next;
  } finally {
    if (runBatchDrainLocks.get(campaignRunId) === next) {
      runBatchDrainLocks.delete(campaignRunId);
    }
  }
}

// ── Pipeline result ────────────────────────────────────────────────────────

export interface PipelineResult {
  campaignId: number;
  discoveryLeadsCreated: number;
  discoverySearchesPerformed: number;
  discoverySearchesSkipped: number;
  discoveryRawResults: number;
  discoveryResultsSeenBefore: number;
  discoverySourcesFound: number;
  discoverySourcesMined: number;
  discoverySourcesSkipped: number;
  discoveryDuplicatesSkipped: number;
  discoveryBlockedSkipped: number;
  crawledCount: number;
  scoredCount: number;
  pendingCrawlCount: number;
  crawlFailedCount: number;
  pendingScoreCount: number;
  autoBlockedLowScoreCount: number;
  emailsSent: number;
  skipped: number;
  failed: number;
  durationMs: number;
  errors: string[];
}

export interface PipelineOptions {
  forceDiscoveryRefresh?: boolean;
  /** Reruns bypass discovery-source history; normal runs retain existing refresh behavior. */
  forceDiscoverySourceRefresh?: boolean;
  /** When true, skip the discovery step entirely (used when resuming a failed run). */
  skipDiscovery?: boolean;
  /** Immutable per-run configuration. Loaded from campaign_runs when omitted. */
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null;
}

// ── Hard qualification filter lists ────────────────────────────────────────

/**
 * Known non-company / discovery-platform domains that should never become leads.
 * Extend this list freely — it is checked before any DB insert.
 */
const JUNK_DOMAINS = new Set([
  "linkedin.com", "crunchbase.com", "techcrunch.com", "ycombinator.com",
  "yc.com", "reddit.com", "medium.com", "github.com", "producthunt.com",
  "wellfound.com", "angel.co", "arxiv.org", "huggingface.co", "kaggle.com",
  "paperswithcode.com", "twitter.com", "x.com", "facebook.com",
  "instagram.com", "youtube.com", "wikipedia.org", "stackoverflow.com",
  "quora.com", "pitchbook.com", "cbinsights.com", "glassdoor.com",
  "indeed.com", "Monster.com", "notion.so", "substack.com",
  "hashnode.com", "dev.to", "hackernoon.com", "venturebeat.com",
  "wired.com", "forbes.com", "businessinsider.com", "bloomberg.com",
  "reuters.com", "theverge.com", "arstechnica.com",
]);

/** URL path segments that indicate an article/blog/doc, not a company homepage. */
const JUNK_PATH_PATTERNS = [
  /\/blog\b/i, /\/blogs\b/i, /\/article\b/i, /\/articles\b/i,
  /\/news\b/i, /\/docs\b/i, /\/documentation\b/i, /\/paper\b/i,
  /\/research-paper/i, /\/dataset\b/i, /\/datasets\b/i,
  /\/marketplace\b/i, /\/forum\b/i, /\/community\b/i,
  /\/tutorial\b/i, /\/tutorials\b/i, /\/post\//i, /\/tag\//i,
  /\/category\//i, /\/topics\//i, /\/explore\b/i,
];

/** TLD patterns for government institutions that should never become leads. */
const JUNK_TLD_PATTERN = /\.(gov|gov\.uk|gov\.au|gc\.ca)$/i;

/**
 * Subdomain prefixes that indicate non-company content even when the root
 * domain itself is not in any block list. e.g. docs.company.com, blog.company.com.
 * These are checked against the SUBDOMAIN part of the rootDomain only.
 */
const JUNK_SUBDOMAIN_PREFIXES = [
  "docs.", "blog.", "blogs.", "discuss.", "forum.", "forums.", "community.",
  "help.", "support.", "status.", "dev.", "developer.", "developers.",
  "careers.", "jobs.", "hiring.", "news.", "press.", "ir.", "investors.",
  "shop.", "store.", "app.", "apps.", "play.", "pages.", "sites.",
  "training.", "learn.", "learning.",
  "open.", "opensource.", "wiki.",
  "mail.", "webmail.", "calendar.", "drive.", "cloud.",
];

/** Title/snippet words that strongly suggest non-company content. */
const JUNK_TITLE_WORDS = [
  "tutorial", "documentation", "blog post", "research paper",
  "dataset", "publication", "conference paper", "preprint", "arxiv",
  "open source", "github repo", "community forum",
];

/**
 * Known listing/directory domains. These are useful as discovery sources to
 * mine company links from, but must never be saved as final company leads.
 */
const DIRECTORY_DOMAINS = new Set([
  "clutch.co", "goodfirms.co", "designrush.com", "themanifest.com",
  "businessofapps.com", "buildfire.com", "g2.com", "capterra.com",
  "softwareworld.co", "appdevelopmentcompanies.co", "topdevelopers.co",
  "selectedfirms.co", "techreviewer.co", "appfutura.com",
  "guru.com", "sortlist.com", "upcity.com", "expertise.com",
  "itfirms.co", "agencyspotter.com", "semrush.com", "similarweb.com",
  "trustpilot.com", "yelp.com", "bark.com", "thumbtack.com",
  "checkatrade.com", "clutch.io", "goodfirms.io",
]);

/** Title words indicating this is a listicle/ranking article, not a company page. */
const LISTICLE_TITLE_WORDS = [
  "top ", " top ", "best ", " best ", " companies", " agencies", " firms",
  " developers", " services", "list of", " rankings", " ranked",
  " reviews", "directory of", " vs ", " vs.", "comparison", "alternatives to",
  "in 2024", "in 2025", "in 2026", "in 2027",
];

/** URL path patterns that indicate a listicle article on any domain. */
const LISTICLE_URL_PATTERNS = [
  /\/top[-_\d]/i, /\/best[-_]/i, /\/\d+-(?:top|best)/i,
  /\/list\b/i, /\/rankings?\b/i, /\/compare\b/i, /\/alternatives\b/i,
  /\/reviews?\b/i,
];

type ResultClass = "direct" | "discovery_source" | "blocked";
type ResultClassification = { cls: ResultClass; reason?: string };

/**
 * Classifies a search result into:
 * - "direct"            → real company website — save as lead
 * - "discovery_source"  → listicle/directory — mine for company links, don't save as lead
 * - "blocked"           → junk/social/gov — skip entirely
 */
function classifySearchResult(
  rootDomain: string,
  url: string,
  title: string,
  blockedDomains: Set<string>,
): ResultClass {
  return classifySearchResultDetailed(rootDomain, url, title, blockedDomains).cls;
}

function classifySearchResultDetailed(
  rootDomain: string,
  url: string,
  title: string,
  blockedDomains: Set<string>,
): ResultClassification {
  const domainLower = rootDomain.toLowerCase();
  const titleLower = title.toLowerCase();

  // User-configured blocked domains
  if (domainMatchesBlockedList(domainLower, blockedDomains)) {
    return { cls: "blocked", reason: "Domain blocked in Settings" };
  }

  // Hard-coded junk/social/news domains
  if (JUNK_DOMAINS.has(domainLower)) {
    return { cls: "blocked", reason: "Known platform/news/social domain" };
  }
  for (const junk of JUNK_DOMAINS) {
    if (domainLower.endsWith(`.${junk}`)) {
      return { cls: "blocked", reason: "Known platform/news/social domain" };
    }
  }

  // Government TLDs
  if (JUNK_TLD_PATTERN.test(domainLower)) {
    return { cls: "blocked", reason: "Government domain" };
  }

  // Junk subdomain prefixes (docs.*, blog.*, discuss.*, etc.)
  for (const prefix of JUNK_SUBDOMAIN_PREFIXES) {
    if (domainLower.startsWith(prefix)) {
      return { cls: "blocked", reason: `Non-company subdomain (${prefix.replace(".", "")})` };
    }
  }

  // Known directory/listing domains → treat as discovery sources to mine
  if (DIRECTORY_DOMAINS.has(domainLower)) {
    return { cls: "discovery_source", reason: "Directory/listing discovery source" };
  }
  for (const dir of DIRECTORY_DOMAINS) {
    if (domainLower.endsWith(`.${dir}`)) {
      return { cls: "discovery_source", reason: "Directory/listing discovery source" };
    }
  }

  // URL path patterns that flag junk content (blog, docs, dataset…)
  try {
    const { pathname } = new URL(url);
    for (const pat of JUNK_PATH_PATTERNS) {
      if (pat.test(pathname)) {
        return { cls: "blocked", reason: "Blog/article/docs/dataset page" };
      }
    }
    // URL patterns that indicate a listicle article (on any domain) → mine it
    for (const pat of LISTICLE_URL_PATTERNS) {
      if (pat.test(pathname)) {
        return { cls: "discovery_source", reason: "Listicle/ranking discovery source" };
      }
    }
  } catch {
    // invalid URL
  }

  // Title words that strongly indicate a listicle → mine it
  for (const word of LISTICLE_TITLE_WORDS) {
    if (titleLower.includes(word)) {
      return { cls: "discovery_source", reason: "Listicle/ranking discovery source" };
    }
  }

  // Title words that indicate pure junk → block
  for (const word of JUNK_TITLE_WORDS) {
    if (titleLower.includes(word)) {
      return { cls: "blocked", reason: "Junk title/content signal" };
    }
  }

  return { cls: "direct" };
}

/** Format a root domain into a readable placeholder company name. */
function formatDomainName(rootDomain: string): string {
  const base = rootDomain.split(".")[0] ?? rootDomain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

interface MineArgs {
  discoveryUrl: string;
  sourceRootDomain: string;
  campaign: typeof campaignsTable.$inferSelect;
  campaignRunId?: number;
  sourceKeyword: string;
  sourceCountry: string;
  sourceQuery: string;
  blockedDomains: Set<string>;
  existingDomains: Set<string>;
  maxNewLeads?: number;
}

interface MineResult {
  mined: number;
  duplicates: number;
  blocked: number;
  totalLinks: number;
}

/**
 * Fetches a discovery-source page (listicle/directory), extracts outbound company
 * links, and creates lead rows for each real company found on that page.
 */
async function mineDiscoverySource({
  discoveryUrl,
  sourceRootDomain,
  campaign,
  campaignRunId,
  sourceKeyword,
  sourceCountry,
  sourceQuery,
  blockedDomains,
  existingDomains,
  maxNewLeads,
}: MineArgs): Promise<MineResult> {
  let links: { href: string; rootDomain: string; anchorText: string }[];
  try {
    links = await extractCompanyLinksFromPage(discoveryUrl, sourceRootDomain);
  } catch {
    return { mined: 0, duplicates: 0, blocked: 0, totalLinks: 0 };
  }

  let mined = 0;
  let duplicates = 0;
  let blocked = 0;

  for (const { href, rootDomain, anchorText } of links) {
    if (await isCancellationRequested(campaignRunId)) break;
    if (maxNewLeads != null && mined >= maxNewLeads) break;
    if (existingDomains.has(rootDomain)) {
      duplicates++;
      continue;
    }

    // Re-classify the extracted link — only save direct company links
    const cls = classifySearchResult(rootDomain, href, anchorText, blockedDomains);
    if (cls !== "direct") {
      blocked++;
      continue;
    }

    try {
      await db.insert(leadsTable).values({
        campaignId: campaign.id,
        campaignRunId: campaignRunId ?? null,
        companyName: "",
        rootDomain,
        websiteUrl: href,
        leadStatus: "discovered",
        reviewStatus: "pending",
        qualificationStatus: "unqualified",
        outreachStatus: "not_queued",
        emailStatus: "not_sent",
        relevanceScore: 0,
        relevanceReason: "",
        sourceKeyword,
        sourceCountry,
        sourceQuery,
        sourceType: "mined",
        discoverySourceDomain: sourceRootDomain,
        discoverySourceUrl: discoveryUrl,
        leadType: classifyLeadType(rootDomain),
      });
      existingDomains.add(rootDomain);
      recordResult(campaignRunId, campaign.id, "lead_created", {
        title: anchorText,
        url: href,
        rootDomain,
        sourceQuery,
        reason: `Mined from ${sourceRootDomain}`,
      });
      mined++;
    } catch {
      // unique constraint violation = race dupe — skip
      duplicates++;
    }
  }

  if (mined > 0) {
    await schedulerLog(
      campaign.id,
      `Mined ${mined} company lead${mined !== 1 ? "s" : ""} from ${sourceRootDomain}`,
      { discoveryUrl, mined },
    );
  }

  return { mined, duplicates, blocked, totalLinks: links.length };
}

/**
 * Determine the automatic qualification status for a freshly discovered lead.
 * Currently always returns "unqualified" — placeholder for future ML/heuristic upgrades.
 */
function autoQualificationStatus(
  _rootDomain: string,
  _url: string,
): "unqualified" | "qualified" | "rejected" {
  return "unqualified";
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Update current_stage on the campaign_run row (non-fatal). */
async function setStage(
  campaignRunId: number | undefined | null,
  stage: string,
): Promise<void> {
  if (campaignRunId == null) return;
  try {
    await db
      .update(campaignRunsTable)
      .set({ currentStage: stage })
      .where(and(
        eq(campaignRunsTable.id, campaignRunId),
        sql`${campaignRunsTable.status} not in ('cancelling', 'cancelled')`,
      ));
  } catch { /* non-fatal */ }
}

/** Insert a campaign_run_results row (non-fatal, fire-and-forget). */
function recordResult(
  campaignRunId: number | undefined | null,
  campaignId: number,
  resultStatus: string,
  fields: { title?: string; url?: string; rootDomain?: string; sourceQuery?: string; reason?: string },
): void {
  if (campaignRunId == null) return;
  db.insert(campaignRunResultsTable)
    .values({
      campaignRunId,
      campaignId,
      resultStatus,
      title: fields.title ?? null,
      url: fields.url ?? null,
      rootDomain: fields.rootDomain ?? null,
      sourceQuery: fields.sourceQuery ?? null,
      reason: fields.reason ?? null,
    })
    .catch(() => { /* non-fatal */ });
}

async function schedulerLog(
  campaignId: number,
  message: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(logsTable).values({
    campaignId,
    type: "scheduler",
    message,
    metadataJson: meta ? JSON.stringify(meta) : null,
  });
}

// ── Step 1: Discovery ───────────────────────────────────────────────────────

interface DiscoveryStats {
  newLeadsCreated: number;
  searchesPerformed: number;
  searchesSkipped: number;
  rawResultsFound: number;
  resultUrlsSeenBefore: number;
  discoverySourcesFound: number;
  discoverySourcesMined: number;
  discoverySourcesSkipped: number;
  duplicatesSkipped: number;
  blockedSkipped: number;
  missingSerperKey: boolean;
}

type UploadedDomainCandidate = {
  rootDomain: string;
  websiteUrl: string;
  sourceLabel: string;
};

function extractUploadedDomainCandidates(value: string | null | undefined): UploadedDomainCandidate[] {
  const raw = value ?? "";
  const candidates = new Map<string, UploadedDomainCandidate>();
  const urlPattern = /(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s"',;]*)?/gi;

  for (const match of raw.matchAll(urlPattern)) {
    const token = match[0].trim().replace(/[)\].,;]+$/g, "");
    const rootDomain = extractRootDomain(token);
    if (!rootDomain) continue;
    const websiteUrl = token.startsWith("http") ? token : `https://${rootDomain}`;
    if (!candidates.has(rootDomain)) {
      candidates.set(rootDomain, {
        rootDomain,
        websiteUrl,
        sourceLabel: token,
      });
    }
  }

  return Array.from(candidates.values());
}

async function runUploadedDomainDiscovery(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
  campaignRunId?: number,
): Promise<DiscoveryStats> {
  const stats: DiscoveryStats = {
    newLeadsCreated: 0,
    searchesPerformed: 0,
    searchesSkipped: 0,
    rawResultsFound: 0,
    resultUrlsSeenBefore: 0,
    discoverySourcesFound: 0,
    discoverySourcesMined: 0,
    discoverySourcesSkipped: 0,
    duplicatesSkipped: 0,
    blockedSkipped: 0,
    missingSerperKey: false,
  };

  const uploadedDomains = extractUploadedDomainCandidates(campaign.uploadedDomains);
  if (uploadedDomains.length === 0) {
    errors.push("No valid uploaded domains found. Upload a text or CSV file containing website domains.");
    await schedulerLog(campaign.id, "Uploaded-domain discovery skipped: no valid domains found");
    return stats;
  }

  const applyBlockLogic = campaign.uploadedDomainsApplyBlockLogic !== false;
  const [blockedSetting] = applyBlockLogic
    ? await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "blocked_domains"))
    : [];
  const blockedDomains = applyBlockLogic ? parseBlockedDomains(blockedSetting?.value) : new Set<string>();

  const existingLeads = await db
    .select({ rootDomain: leadsTable.rootDomain })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaign.id));
  const existingDomains = new Set(existingLeads.map((l) => normalizeDomainToken(l.rootDomain)).filter(Boolean));

  await schedulerLog(
    campaign.id,
    `Uploaded-domain discovery started: ${uploadedDomains.length} domain${uploadedDomains.length !== 1 ? "s" : ""}${applyBlockLogic ? "" : " (blocked-domain logic bypassed)"}`,
  );

  if (campaignRunId != null) {
    try {
      await db.update(campaignRunsTable)
        .set({ totalWorkUnits: uploadedDomains.length })
        .where(eq(campaignRunsTable.id, campaignRunId));
    } catch { /* non-fatal */ }
  }

  for (const candidate of uploadedDomains) {
    const { rootDomain, websiteUrl, sourceLabel } = candidate;
    stats.rawResultsFound++;

    if (applyBlockLogic) {
      const classificationResult = classifySearchResultDetailed(
        rootDomain,
        websiteUrl,
        rootDomain,
        blockedDomains,
      );

      if (classificationResult.cls === "blocked") {
        recordResult(campaignRunId, campaign.id, "blocked", {
          title: rootDomain,
          url: websiteUrl,
          rootDomain,
          sourceQuery: "uploaded_domains",
          reason: classificationResult.reason ?? "Blocked domain or junk content",
        });
        stats.blockedSkipped++;
        continue;
      }
    }

    if (existingDomains.has(rootDomain)) {
      recordResult(campaignRunId, campaign.id, "duplicate", {
        title: rootDomain,
        url: websiteUrl,
        rootDomain,
        sourceQuery: "uploaded_domains",
        reason: "Domain already exists in campaign leads",
      });
      stats.duplicatesSkipped++;
      continue;
    }

    try {
      await db.insert(leadsTable).values({
        campaignId: campaign.id,
        campaignRunId: campaignRunId ?? null,
        companyName: "",
        rootDomain,
        websiteUrl,
        leadStatus: "discovered",
        reviewStatus: "pending",
        qualificationStatus: autoQualificationStatus(rootDomain, websiteUrl),
        outreachStatus: "not_queued",
        emailStatus: "not_sent",
        relevanceScore: 0,
        relevanceReason: "",
        sourceQuery: "uploaded_domains",
        sourceType: "uploaded",
        leadType: classifyLeadType(rootDomain, rootDomain),
      });
      existingDomains.add(rootDomain);
      recordResult(campaignRunId, campaign.id, "lead_created", {
        title: rootDomain,
        url: websiteUrl,
        rootDomain,
        sourceQuery: "uploaded_domains",
        reason: `Uploaded from ${sourceLabel}`,
      });
      stats.newLeadsCreated++;
    } catch {
      recordResult(campaignRunId, campaign.id, "duplicate", {
        title: rootDomain,
        url: websiteUrl,
        rootDomain,
        sourceQuery: "uploaded_domains",
        reason: "Domain already exists (race condition)",
      });
      stats.duplicatesSkipped++;
    }

    if (campaignRunId != null) {
      const completed = stats.newLeadsCreated + stats.duplicatesSkipped + stats.blockedSkipped;
      try {
        await db.update(campaignRunsTable).set({
          totalResults: stats.rawResultsFound,
          totalNewLeads: stats.newLeadsCreated,
          totalDuplicates: stats.duplicatesSkipped,
          totalBlocked: stats.blockedSkipped,
          completedWorkUnits: completed,
          progressPercent: uploadedDomains.length > 0 ? Math.min(100, completed / uploadedDomains.length * 100) : 0,
        }).where(eq(campaignRunsTable.id, campaignRunId));
      } catch { /* non-fatal */ }
    }
  }

  if (campaignRunId != null) {
    try {
      await db.update(campaignRunsTable)
        .set({
          totalResults: stats.rawResultsFound,
          totalNewLeads: stats.newLeadsCreated,
          totalDuplicates: stats.duplicatesSkipped,
          totalBlocked: stats.blockedSkipped,
        })
        .where(eq(campaignRunsTable.id, campaignRunId));
    } catch { /* non-fatal */ }
  }

  await schedulerLog(
    campaign.id,
    `Uploaded-domain discovery complete: ${stats.newLeadsCreated} new, ${stats.duplicatesSkipped} duplicate, ${stats.blockedSkipped} blocked`,
  );

  return stats;
}

async function runDiscovery(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
  campaignRunId?: number,
  options: PipelineOptions = {},
): Promise<DiscoveryStats> {
  const stats: DiscoveryStats = {
    newLeadsCreated: 0,
    searchesPerformed: 0,
    searchesSkipped: 0,
    rawResultsFound: 0,
    resultUrlsSeenBefore: 0,
    discoverySourcesFound: 0,
    discoverySourcesMined: 0,
    discoverySourcesSkipped: 0,
    duplicatesSkipped: 0,
    blockedSkipped: 0,
    missingSerperKey: false,
  };

  if ((campaign.discoveryInputMode ?? "search") === "upload") {
    return runUploadedDomainDiscovery(campaign, errors, campaignRunId);
  }

  const apiKey = await getSerperApiKey();
  if (!apiKey) {
    stats.missingSerperKey = true;
    errors.push(
      "Serper API key not configured — skipping discovery. Add it in Settings → Search API Settings or set SERPER_API_KEY environment variable.",
    );
    return stats;
  }

  const keywords = options.configurationSnapshot
    ? options.configurationSnapshot.keywords.map((keyword) => ({ keyword }))
    : await db
      .select()
      .from(campaignKeywordsTable)
      .where(eq(campaignKeywordsTable.campaignId, campaign.id));

  const countries = options.configurationSnapshot
    ? options.configurationSnapshot.locations.map((country) => ({ country }))
    : await db
      .select()
      .from(campaignCountriesTable)
      .where(eq(campaignCountriesTable.campaignId, campaign.id));

  if (keywords.length === 0) {
    await schedulerLog(campaign.id, "Discovery skipped: no keywords configured");
    return stats;
  }

  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  let blockedDomains = parseBlockedDomains(blockedSetting?.value);

  const existingLeads = await db
    .select({ rootDomain: leadsTable.rootDomain })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaign.id));

  const existingDomains = new Set(existingLeads.map((l) => normalizeDomainToken(l.rootDomain)).filter(Boolean));
  const blockedResultDomains = new Set<string>();

  let searchCount = 0;
  const [globalSearchSetting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "global_max_searches_per_day"));
  const maxSearches = parseInt(globalSearchSetting?.value ?? String(campaign.maxSearchesPerDay ?? 10), 10);
  const now = new Date();
  const queryRefreshMs = (campaign.queryRefreshDays ?? 30) * 24 * 60 * 60 * 1000;
  const sourceRefreshMs = (campaign.discoverySourceRefreshDays ?? 30) * 24 * 60 * 60 * 1000;

  const countryTargets = countries.length > 0 ? countries : [{ country: "" }];
  const searchScopeLabel = countries.length > 0
    ? `${keywords.length} keywords × ${countries.length} countries`
    : `${keywords.length} keyword${keywords.length !== 1 ? "s" : ""} without country targeting`;

  await schedulerLog(campaign.id, `Discovery started: ${searchScopeLabel}`);

  // ── Work unit tracking setup ──────────────────────────────────────────────
  const totalWorkUnits = Math.min(keywords.length * countryTargets.length, maxSearches);
  const discoveryStartedAt = Date.now();

  // Historical avg seconds-per-unit for better time estimation
  let avgSecsPerUnit: number | null = null;
  if (campaignRunId != null) {
    try {
      const historicalRuns = await db
        .select({ durationSeconds: campaignRunsTable.durationSeconds, totalWorkUnits: campaignRunsTable.totalWorkUnits })
        .from(campaignRunsTable)
        .where(and(eq(campaignRunsTable.campaignId, campaign.id), eq(campaignRunsTable.status, "completed")))
        .orderBy(desc(campaignRunsTable.startedAt))
        .limit(5);
      const valid = historicalRuns.filter((r) => (r.durationSeconds ?? 0) > 0 && (r.totalWorkUnits ?? 0) > 0);
      if (valid.length > 0) {
        const avgDur = valid.reduce((s, r) => s + r.durationSeconds!, 0) / valid.length;
        const avgUnits = valid.reduce((s, r) => s + (r.totalWorkUnits ?? 0), 0) / valid.length;
        avgSecsPerUnit = avgDur / avgUnits;
      }
    } catch { /* non-fatal */ }
    try {
      await db.update(campaignRunsTable)
        .set({ totalWorkUnits })
        .where(eq(campaignRunsTable.id, campaignRunId));
    } catch { /* non-fatal */ }
  }

  outer: for (const kw of keywords) {
    for (const co of countryTargets) {
      if (searchCount >= maxSearches) break outer;

      // ── Refresh blocklist each query so domains added mid-run are respected ─
      try {
        const [freshBlockedSetting] = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.key, "blocked_domains"));
        blockedDomains = parseBlockedDomains(freshBlockedSetting?.value);
      } catch { /* non-fatal – keep using the last good snapshot */ }

      const query = [kw.keyword, co.country].filter(Boolean).join(" ");

      // ── Query history skip check ──────────────────────────────────────────
      const [qhRecord] = await db
        .select({ id: searchQueryHistoryTable.id, nextRefreshAt: searchQueryHistoryTable.nextRefreshAt })
        .from(searchQueryHistoryTable)
        .where(and(
          eq(searchQueryHistoryTable.campaignId, campaign.id),
          eq(searchQueryHistoryTable.query, query),
        ))
        .limit(1);

      if (shouldSkipRefresh(qhRecord?.nextRefreshAt, now, options.forceDiscoveryRefresh)) {
        stats.searchesSkipped++;
        await schedulerLog(campaign.id, `Query skipped (recently searched): "${query}"`, {
          nextRefreshAt: qhRecord?.nextRefreshAt?.toISOString() ?? null,
        });
        if (campaignRunId != null) {
          const _cu = stats.searchesPerformed + stats.searchesSkipped;
          const _ru = Math.max(0, totalWorkUnits - _cu);
          const _el = Date.now() - discoveryStartedAt;
          const _pp = totalWorkUnits > 0 ? Math.min(100, _cu / totalWorkUnits * 100) : 0;
          let _ers: number | null = null;
          let _eca: Date | null = null;
          if (avgSecsPerUnit != null && _ru > 0) { _ers = Math.round(avgSecsPerUnit * _ru); }
          else if (_cu >= 2 && _ru > 0) { _ers = Math.round(_el / _cu / 1000 * _ru); }
          if (_ers != null) _eca = new Date(Date.now() + _ers * 1000);
          try {
            await db.update(campaignRunsTable).set({
              totalSearchesSkipped: sql`coalesce(${campaignRunsTable.totalSearchesSkipped}, 0) + 1`,
              completedWorkUnits: _cu, progressPercent: _pp,
              estimatedRemainingSeconds: _ers, estimatedCompletionAt: _eca,
            }).where(eq(campaignRunsTable.id, campaignRunId));
          } catch { /* non-fatal */ }
        }
        continue;
      }

      let results;
      try {
        results = await searchSerper(query, apiKey, campaign.resultsPerSearch ?? 10);
        searchCount++;
        stats.searchesPerformed++;
        stats.rawResultsFound += results.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Search failed: "${query}": ${msg}`);
        await schedulerLog(campaign.id, `Search error: "${query}": ${msg}`);
        // Record failed query so it is not retried immediately
        try {
          await db.insert(searchQueryHistoryTable).values({
            campaignId: campaign.id,
            campaignRunId: campaignRunId ?? null,
            query,
            keyword: kw.keyword,
            country: co.country,
            searchedAt: now,
            resultCount: 0,
            status: "failed",
            errorMessage: msg.slice(0, 500),
            nextRefreshAt: null,
          }).onConflictDoUpdate({
            target: [searchQueryHistoryTable.campaignId, searchQueryHistoryTable.query],
            set: {
              campaignRunId: campaignRunId ?? null,
              searchedAt: now,
              resultCount: 0,
              status: "failed",
              errorMessage: msg.slice(0, 500),
              nextRefreshAt: null,
              updatedAt: now,
            },
          });
        } catch { /* non-fatal */ }
        continue;
      }

      // ── Upsert query history (before processing results) ─────────────────
      const nextQueryRefreshAt = new Date(now.getTime() + queryRefreshMs);
      let queryHistoryId: number | null = null;
      try {
        const [qhRow] = await db
          .insert(searchQueryHistoryTable)
          .values({
            campaignId: campaign.id,
            campaignRunId: campaignRunId ?? null,
            query,
            keyword: kw.keyword,
            country: co.country,
            searchedAt: now,
            resultCount: results.length,
            status: "completed",
            nextRefreshAt: nextQueryRefreshAt,
          })
          .onConflictDoUpdate({
            target: [searchQueryHistoryTable.campaignId, searchQueryHistoryTable.query],
            set: {
              campaignRunId: campaignRunId ?? null,
              searchedAt: now,
              resultCount: results.length,
              status: "completed",
              nextRefreshAt: nextQueryRefreshAt,
              updatedAt: now,
            },
          })
          .returning({ id: searchQueryHistoryTable.id });
        queryHistoryId = qhRow?.id ?? null;
      } catch { /* non-fatal */ }

      let qNewLeads = 0;
      let qDups = 0;
      let qBlocked = 0;
      let qSources = 0;
      const maxNewLeadsForQuery = Math.max(1, campaign.resultsPerSearch ?? 10);

      for (const result of results) {
        if (qNewLeads >= maxNewLeadsForQuery) {
          break;
        }

        const rootDomain = extractRootDomain(result.link);
        if (!rootDomain) continue;

        const classificationResult = classifySearchResultDetailed(
          rootDomain, result.link, result.title, blockedDomains,
        );
        const classification = classificationResult.cls;

        // ── Track result URL in history ───────────────────────────────────
        const resultType =
          classification === "blocked" ? "blocked"
          : classification === "discovery_source" ? "discovery_source"
          : existingDomains.has(rootDomain) ? "duplicate"
          : "direct";
        try {
          const [srhRow] = await db
            .insert(searchResultHistoryTable)
            .values({
              campaignId: campaign.id,
              campaignRunId: campaignRunId ?? null,
              searchQueryHistoryId: queryHistoryId,
              query,
              resultUrl: result.link,
              rootDomain,
              resultTitle: result.title,
              resultSnippet: result.snippet,
              resultPosition: result.position,
              resultType,
              firstSeenAt: now,
              lastSeenAt: now,
              timesSeen: 1,
            })
            .onConflictDoUpdate({
              target: [searchResultHistoryTable.campaignId, searchResultHistoryTable.resultUrl],
              set: {
                resultType,
                lastSeenAt: now,
                timesSeen: sql`${searchResultHistoryTable.timesSeen} + 1`,
                updatedAt: now,
              },
            })
            .returning({ timesSeen: searchResultHistoryTable.timesSeen });
          if (srhRow && srhRow.timesSeen > 1) stats.resultUrlsSeenBefore++;
        } catch { /* non-fatal */ }

        if (classification === "blocked") {
          if (blockedResultDomains.has(rootDomain)) {
            recordResult(campaignRunId, campaign.id, "duplicate", {
              title: result.title,
              url: result.link,
              rootDomain,
              sourceQuery: query,
              reason: "Duplicate blocked domain already shown in blocked results",
            });
            qDups++;
            stats.duplicatesSkipped++;
            continue;
          }
          blockedResultDomains.add(rootDomain);
          await schedulerLog(
            campaign.id,
            `Filtered (blocked): ${rootDomain}`,
            { url: result.link },
          );
          recordResult(campaignRunId, campaign.id, "blocked", {
            title: result.title,
            url: result.link,
            rootDomain,
            sourceQuery: query,
            reason: classificationResult.reason ?? "Blocked domain or junk content",
          });
          qBlocked++;
          stats.blockedSkipped++;
          continue;
        }

        if (classification === "discovery_source") {
          stats.discoverySourcesFound++;
          qSources++;

          // ── Discovery source history skip check ──────────────────────────
          const [dshRecord] = await db
            .select({ nextRefreshAt: discoverySourceHistoryTable.nextRefreshAt })
            .from(discoverySourceHistoryTable)
            .where(and(
              eq(discoverySourceHistoryTable.campaignId, campaign.id),
              eq(discoverySourceHistoryTable.sourceUrl, result.link),
            ))
            .limit(1);

          if (shouldSkipRefresh(
            dshRecord?.nextRefreshAt,
            now,
            options.forceDiscoverySourceRefresh,
          )) {
            stats.discoverySourcesSkipped++;
            await schedulerLog(
              campaign.id,
              `Discovery source skipped (recently mined): ${rootDomain}`,
              { url: result.link },
            );
            continue;
          }

          await schedulerLog(
            campaign.id,
            `Mining discovery source: ${rootDomain}`,
            { url: result.link, title: result.title },
          );
          const mineResult = await mineDiscoverySource({
            discoveryUrl: result.link,
            sourceRootDomain: rootDomain,
            campaign,
            campaignRunId,
            sourceKeyword: kw.keyword,
            sourceCountry: co.country,
            sourceQuery: query,
            blockedDomains,
            existingDomains,
            maxNewLeads: Math.max(0, maxNewLeadsForQuery - qNewLeads),
          });

          stats.newLeadsCreated += mineResult.mined;
          stats.duplicatesSkipped += mineResult.duplicates;
          stats.discoverySourcesMined++;
          qNewLeads += mineResult.mined;
          qDups += mineResult.duplicates;

          // ── Upsert discovery source history ──────────────────────────────
          const dsNextRefreshAt = new Date(now.getTime() + sourceRefreshMs);
          try {
            await db
              .insert(discoverySourceHistoryTable)
              .values({
                campaignId: campaign.id,
                campaignRunId: campaignRunId ?? null,
                sourceUrl: result.link,
                sourceDomain: rootDomain,
                minedAt: now,
                companiesFound: mineResult.totalLinks,
                newCompanyLeads: mineResult.mined,
                duplicateCompanyLeads: mineResult.duplicates,
                blockedLinks: mineResult.blocked,
                status: "completed",
                nextRefreshAt: dsNextRefreshAt,
              })
              .onConflictDoUpdate({
                target: [discoverySourceHistoryTable.campaignId, discoverySourceHistoryTable.sourceUrl],
                set: {
                  campaignRunId: campaignRunId ?? null,
                  minedAt: now,
                  companiesFound: mineResult.totalLinks,
                  newCompanyLeads: mineResult.mined,
                  duplicateCompanyLeads: mineResult.duplicates,
                  blockedLinks: mineResult.blocked,
                  status: "completed",
                  nextRefreshAt: dsNextRefreshAt,
                  updatedAt: now,
                },
              });
          } catch { /* non-fatal */ }
          continue;
        }

        // classification === "direct" — a real company page
        if (existingDomains.has(rootDomain)) {
          recordResult(campaignRunId, campaign.id, "duplicate", {
            title: result.title,
            url: result.link,
            rootDomain,
            sourceQuery: query,
            reason: "Domain already exists in campaign leads",
          });
          qDups++;
          stats.duplicatesSkipped++;
          continue;
        }

        try {
          await db.insert(leadsTable).values({
            campaignId: campaign.id,
            campaignRunId: campaignRunId ?? null,
            companyName: "",
            rootDomain,
            websiteUrl: result.link,
            leadStatus: "discovered",
            reviewStatus: "pending",
            qualificationStatus: autoQualificationStatus(rootDomain, result.link),
            outreachStatus: "not_queued",
            emailStatus: "not_sent",
            relevanceScore: 0,
            relevanceReason: "",
            sourceKeyword: kw.keyword,
            sourceCountry: co.country,
            sourceQuery: query,
            sourceType: "direct",
            leadType: classifyLeadType(rootDomain, result.title),
          });
          existingDomains.add(rootDomain);
          recordResult(campaignRunId, campaign.id, "lead_created", {
            title: result.title,
            url: result.link,
            rootDomain,
            sourceQuery: query,
          });
          stats.newLeadsCreated++;
          qNewLeads++;
        } catch {
          // unique constraint violation = race condition dupe
          recordResult(campaignRunId, campaign.id, "duplicate", {
            title: result.title,
            url: result.link,
            rootDomain,
            sourceQuery: query,
            reason: "Domain already exists (race condition)",
          });
          stats.duplicatesSkipped++;
          qDups++;
        }
      }

      // ── Update query history with per-query lead/dup/blocked counts ───────
      if (queryHistoryId != null) {
        try {
          await db
            .update(searchQueryHistoryTable)
            .set({
              newLeadsCount: qNewLeads,
              duplicateCount: qDups,
              blockedCount: qBlocked,
              discoverySourceCount: qSources,
            })
            .where(eq(searchQueryHistoryTable.id, queryHistoryId));
        } catch { /* non-fatal */ }
      }

      // ── Incrementally update campaign_run live counters + progress ──────────
      if (campaignRunId != null) {
        const _cu = stats.searchesPerformed + stats.searchesSkipped;
        const _ru = Math.max(0, totalWorkUnits - _cu);
        const _el = Date.now() - discoveryStartedAt;
        const _pp = totalWorkUnits > 0 ? Math.min(100, _cu / totalWorkUnits * 100) : 0;
        let _ers: number | null = null;
        let _eca: Date | null = null;
        if (avgSecsPerUnit != null && _ru > 0) { _ers = Math.round(avgSecsPerUnit * _ru); }
        else if (_cu >= 2 && _ru > 0) { _ers = Math.round(_el / _cu / 1000 * _ru); }
        if (_ers != null) _eca = new Date(Date.now() + _ers * 1000);
        try {
          await db.update(campaignRunsTable).set({
            totalNewLeads: sql`coalesce(${campaignRunsTable.totalNewLeads}, 0) + ${qNewLeads}`,
            totalSearches: sql`coalesce(${campaignRunsTable.totalSearches}, 0) + 1`,
            totalBlocked: sql`coalesce(${campaignRunsTable.totalBlocked}, 0) + ${qBlocked}`,
            totalDuplicates: sql`coalesce(${campaignRunsTable.totalDuplicates}, 0) + ${qDups}`,
            completedWorkUnits: _cu, progressPercent: _pp,
            estimatedRemainingSeconds: _ers, estimatedCompletionAt: _eca,
          }).where(eq(campaignRunsTable.id, campaignRunId));
        } catch { /* non-fatal */ }
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ── Post-run blocklist cleanup ─────────────────────────────────────────────
  // Delete any leads created during this run whose domain now matches the
  // blocklist (catches domains added to the blocklist while the run was running).
  try {
    const [finalBlockedSetting] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "blocked_domains"));
    const finalBlockedDomains = parseBlockedDomains(finalBlockedSetting?.value);
    if (finalBlockedDomains.size > 0 && campaignRunId != null) {
      const runLeads = await db
        .select({ id: leadsTable.id, rootDomain: leadsTable.rootDomain })
        .from(leadsTable)
        .where(eq(leadsTable.campaignRunId, campaignRunId));
      const toDelete = runLeads.filter((l) => domainMatchesBlockedList(l.rootDomain, finalBlockedDomains));
      if (toDelete.length > 0) {
        for (const lead of toDelete) {
          await db.delete(leadsTable).where(eq(leadsTable.id, lead.id));
        }
        await schedulerLog(
          campaign.id,
          `Post-run blocklist cleanup: removed ${toDelete.length} lead${toDelete.length === 1 ? "" : "s"} that matched updated blocklist`,
          { removed: toDelete.map((l) => l.rootDomain) },
        );
        stats.newLeadsCreated = Math.max(0, stats.newLeadsCreated - toDelete.length);
      }
    }
  } catch { /* non-fatal */ }

  await schedulerLog(
    campaign.id,
    `Discovery complete: ${stats.searchesPerformed} searched, ${stats.searchesSkipped} skipped, ${stats.newLeadsCreated} new leads`,
    { ...stats } as Record<string, unknown>,
  );
  return stats;
}

// ── Step 2: Crawl ───────────────────────────────────────────────────────────

async function runCrawl(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
  campaignRunId?: number,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<CrawlStats> {
  const stats: CrawlStats = {
    crawledCount: 0,
    scoredCount: 0,
    failedCount: 0,
    outreachDraftsCreated: 0,
  };
  const [blockedDomainSetting] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));
  const blockedDomains = parseBlockedDomains(blockedDomainSetting?.value);

  if (!(await isCancellationRequested(campaignRunId))) {
    const initialBatchStats = await drainCampaignRunBatches(
      campaign,
      campaignRunId,
      errors,
      true,
      configurationSnapshot,
    );
    stats.scoredCount += initialBatchStats.scoredCount;
    stats.failedCount += initialBatchStats.failedCount;
    stats.outreachDraftsCreated += initialBatchStats.outreachDraftsCreated;
  }

  const crawlLead = async (lead: typeof leadsTable.$inferSelect): Promise<void> => {
    try {
      if (await isCancellationRequested(campaignRunId)) return;

      await db.update(leadsTable)
        .set({ crawlStatus: "crawling", crawlError: null })
        .where(eq(leadsTable.id, lead.id));
      await recordHttpCrawlStarted({
        leadId: lead.id,
        campaignId: campaign.id,
        campaignRunId,
      });

      // Hard per-lead deadline. Scales with maxPagesPerDomain so deep crawls
      // get enough headroom; minimum 120s.
      const perLeadBudgetSec = Math.max(120, (campaign.maxPagesPerDomain ?? 10) * 18);
      const LEAD_TIMEOUT_MS = perLeadBudgetSec * 1000;
      const data = await Promise.race([
        crawlWebsite(lead.websiteUrl, lead.rootDomain, {
          crawlPaths: campaign.crawlPaths,
          internalLinkKeywords: campaign.internalLinkKeywords,
          maxPagesPerDomain: campaign.maxPagesPerDomain,
          maxCrawlDepth: campaign.maxCrawlDepth,
          shouldStop: () => isCancellationRequested(campaignRunId),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Crawl timed out after ${LEAD_TIMEOUT_MS / 1000}s`)), LEAD_TIMEOUT_MS),
        ),
      ]);
      if (data.cancelled) {
        await recordHttpCrawlInterrupted(lead.id, "Cancelled before crawl completed");
        await db.update(leadsTable)
          .set({ crawlStatus: "pending", crawlError: "Cancelled before crawl completed" })
          .where(eq(leadsTable.id, lead.id));
        return;
      }
      const ok = data.pagesSucceeded > 0;
      const updates: Record<string, unknown> = { rawText: data.rawText || null };
      if (ok) {
        updates.crawlStatus = "crawled";
        updates.crawlError = null;
        if (data.companyName) updates.companyName = data.companyName;
        if (data.emails) updates.emails = data.emails;
        if (data.emailDomainStatus) updates.emailDomainStatus = data.emailDomainStatus;
        if (data.phoneNumbers) updates.phoneNumbers = data.phoneNumbers;
        if (data.address) updates.address = data.address;
        if (data.country) updates.country = data.country;
        if (data.linkedinUrl) updates.linkedinUrl = data.linkedinUrl;
      }
      if (ok) {
        await db.update(leadsTable).set(updates).where(eq(leadsTable.id, lead.id));
        await recordHttpCrawlSucceeded(lead.id);
        stats.crawledCount++;
        if (!(await isCancellationRequested(campaignRunId))) {
          const batchStats = await drainCampaignRunBatches(
            campaign,
            campaignRunId,
            errors,
            false,
            configurationSnapshot,
          );
          stats.scoredCount += batchStats.scoredCount;
          stats.failedCount += batchStats.failedCount;
          stats.outreachDraftsCreated += batchStats.outreachDraftsCreated;
        }
      } else {
        const failure = data.failure ?? { category: "empty_content" as const, message: "No pages returned content" };
        const blocked = domainMatchesBlockedList(lead.rootDomain, blockedDomains);
        const skippedSource = isNonTargetFailedCrawlUrl(lead.rootDomain, lead.websiteUrl) ||
          FAILED_CRAWL_EXCLUDED_LEAD_TYPES.has(lead.leadType ?? "");
        const queueBrowser = campaignRunId != null && shouldQueueBrowserRetry({ failure, blocked, skippedSource });
        const disposition = await recordHttpCrawlFailure({ leadId: lead.id, failure, queueBrowser });
        if (disposition === "already_succeeded") return;
        if (disposition === "queued") {
          await schedulerLog(campaign.id, `Browser retry queued ${lead.rootDomain}: ${failure.message}`, {
            campaignRunId,
            leadId: lead.id,
            rootDomain: lead.rootDomain,
            failureCategory: failure.category,
          });
          return;
        }
        const message = `Crawl failed ${lead.rootDomain}: ${failure.message}`;
        errors.push(message);
        await schedulerLog(campaign.id, message, {
          campaignRunId,
          leadId: lead.id,
          rootDomain: lead.rootDomain,
          websiteUrl: lead.websiteUrl,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (await isCancellationRequested(campaignRunId)) {
        await recordHttpCrawlInterrupted(lead.id, "Cancelled before crawl completed");
        await db.update(leadsTable)
          .set({ crawlStatus: "pending", crawlError: "Cancelled before crawl completed" })
          .where(eq(leadsTable.id, lead.id));
        return;
      }
      const failure = classifyNetworkFailure(err);
      const blocked = domainMatchesBlockedList(lead.rootDomain, blockedDomains);
      const skippedSource = isNonTargetFailedCrawlUrl(lead.rootDomain, lead.websiteUrl) ||
        FAILED_CRAWL_EXCLUDED_LEAD_TYPES.has(lead.leadType ?? "");
      const queueBrowser = campaignRunId != null && shouldQueueBrowserRetry({ failure, blocked, skippedSource });
      const disposition = await recordHttpCrawlFailure({ leadId: lead.id, failure, queueBrowser });
      if (disposition === "already_succeeded") return;
      if (disposition === "queued") {
        await schedulerLog(campaign.id, `Browser retry queued ${lead.rootDomain}: ${msg}`, {
          campaignRunId,
          leadId: lead.id,
          rootDomain: lead.rootDomain,
          failureCategory: failure.category,
        });
        return;
      }
      const message = `Crawl failed ${lead.rootDomain}: ${msg}`;
      errors.push(message);
      await schedulerLog(campaign.id, message, {
        campaignRunId,
        leadId: lead.id,
        rootDomain: lead.rootDomain,
        websiteUrl: lead.websiteUrl,
      });
    }
  };

  while (true) {
    if (await isCancellationRequested(campaignRunId)) break;

    const conditions = [
      eq(leadsTable.campaignId, campaign.id),
      or(eq(leadsTable.crawlStatus, "pending"), eq(leadsTable.crawlStatus, "crawling")),
    ];
    if (campaignRunId != null) {
      conditions.push(eq(leadsTable.campaignRunId, campaignRunId));
    }

    const uncrawled = await db
      .select()
      .from(leadsTable)
      .where(and(...conditions))
      .limit(100);

    if (uncrawled.length === 0) break;

    await schedulerLog(campaign.id, `Crawl started: ${uncrawled.length} leads to crawl`);

    await Promise.all(uncrawled.map((lead) => crawlLimiter(() => crawlLead(lead))));

    if (await isCancellationRequested(campaignRunId)) break;
    if (campaignRunId == null) break;
  }

  // Browser fallbacks are durable and run independently from the five HTTP workers.
  // Once HTTP work is drained, keep scoring newly recovered leads until browser work settles.
  if (campaignRunId != null && !(await isCancellationRequested(campaignRunId))) {
    startBrowserRetryWorker();
    while (!(await isCancellationRequested(campaignRunId))) {
      const browserState = await getBrowserRetryState(campaignRunId);
      if (browserState.pendingCount === 0 && browserState.runningCount === 0) break;
      if (browserState.setupRequiredCount > 0 && browserState.runningCount === 0) break;

      const batchStats = await drainCampaignRunBatches(
        campaign,
        campaignRunId,
        errors,
        false,
        configurationSnapshot,
      );
      stats.scoredCount += batchStats.scoredCount;
      stats.failedCount += batchStats.failedCount;
      stats.outreachDraftsCreated += batchStats.outreachDraftsCreated;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!(await isCancellationRequested(campaignRunId))) {
    const finalBatchStats = await drainCampaignRunBatches(
      campaign,
      campaignRunId,
      errors,
      true,
      configurationSnapshot,
    );
    stats.scoredCount += finalBatchStats.scoredCount;
    stats.failedCount += finalBatchStats.failedCount;
    stats.outreachDraftsCreated += finalBatchStats.outreachDraftsCreated;
  }

  await schedulerLog(campaign.id, `Crawl complete: ${stats.crawledCount} succeeded`);
  return stats;
}

// ── Step 3: Score ───────────────────────────────────────────────────────────

async function runScore(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
  campaignRunId?: number,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<{ scoredCount: number; failedCount: number }> {
  const keywordList = configurationSnapshot
    ? configurationSnapshot.keywords
    : (await db
      .select({ keyword: campaignKeywordsTable.keyword })
      .from(campaignKeywordsTable)
      .where(eq(campaignKeywordsTable.campaignId, campaign.id)))
      .map((k) => k.keyword);
  let scoredCount = 0;
  let failedCount = 0;

  while (true) {
    const conditions = [
      eq(leadsTable.campaignId, campaign.id),
      eq(leadsTable.crawlStatus, "crawled"),
      or(
        isNull(leadsTable.scoringMethod),
        like(leadsTable.scoringMethod, "failed%"),
        // Re-score leads that were scored but qualification_status was never set correctly
        and(
          eq(leadsTable.qualificationStatus, "unqualified"),
          sql`${leadsTable.scoringMethod} is not null`,
        ),
      ),
    ];
    if (campaignRunId != null) {
      conditions.push(eq(leadsTable.campaignRunId, campaignRunId));
    }

    const unscored = await db
      .select()
      .from(leadsTable)
      .where(and(...conditions))
      .limit(50);

    if (unscored.length === 0) break;

    await schedulerLog(campaign.id, `Scoring started: ${unscored.length} leads`);

    for (const lead of unscored) {
      try {
        const result = await scoreLead({
          campaignObjective: campaign.objective,
          campaignKeywords: keywordList,
          companyName: lead.companyName,
          rootDomain: lead.rootDomain,
          rawText: lead.rawText ?? null,
          sourceQuery: lead.sourceQuery ?? null,
        }, configurationSnapshot?.ai);

        const failed = result.score == null;
        const reviewStatus =
          !failed && result.score !== null && result.score < campaign.minRelevanceScore
            ? "low_relevance"
            : lead.reviewStatus;

        // Automatically qualify / reject based on the min relevance threshold
        const qualificationStatus =
          failed
            ? lead.qualificationStatus  // keep existing if scoring failed
            : result.score! >= campaign.minRelevanceScore
              ? "qualified"
              : "rejected";

        await db.update(leadsTable)
          .set({
            relevanceScore: result.score,
            relevanceReason: result.reason,
            scoringMethod: result.scoringMethod,
            reviewStatus,
            qualificationStatus,
          })
          .where(eq(leadsTable.id, lead.id));

        if (failed) {
          errors.push(`Score failed ${lead.rootDomain}: ${result.reason}`);
          failedCount++;
        } else {
          scoredCount++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Score failed ${lead.rootDomain}: ${msg}`);
      }
    }

    if (campaignRunId == null) break;
  }

  await schedulerLog(campaign.id, `Scoring complete: ${scoredCount} leads scored`);
  return { scoredCount, failedCount };
}

// ── Step 3b: Auto-List qualified leads ──────────────────────────────────────

async function runAutoList(
  campaign: typeof campaignsTable.$inferSelect,
  campaignRunId: number | undefined,
  _errors: string[],
): Promise<number | null> {
  if (campaignRunId == null || await isCancellationRequested(campaignRunId)) return null;

  let listName = campaign.name;
  let qualifiedLeadCount = 0;
  let emailItems = 0;
  let insertedItems = 0;

  const listId = await db.transaction(async (tx) => {
    const [runRow] = await tx
      .select({ runName: campaignRunsTable.runName, finalListId: campaignRunsTable.finalListId })
      .from(campaignRunsTable)
      .where(eq(campaignRunsTable.id, campaignRunId))
      .for("update");
    if (!runRow) return null;

    listName = runRow.runName ? `${campaign.name} – ${runRow.runName}` : campaign.name;
    let list = runRow.finalListId
      ? (await tx.select().from(leadListsTable).where(eq(leadListsTable.id, runRow.finalListId)))[0]
      : undefined;

    if (!list) {
      [list] = await tx.insert(leadListsTable).values({
        name: listName,
        campaignId: campaign.id,
        listStatus: "active",
      }).returning();
      if (!list) return null;
      await tx.update(campaignRunsTable)
        .set({ finalListId: list.id })
        .where(eq(campaignRunsTable.id, campaignRunId));
    }

    const eligibleLeads = await tx
      .select({ id: leadsTable.id, emails: leadsTable.emails })
      .from(leadsTable)
      .where(and(
        eq(leadsTable.campaignId, campaign.id),
        eq(leadsTable.campaignRunId, campaignRunId),
        eq(leadsTable.crawlStatus, "crawled"),
        eq(leadsTable.qualificationStatus, "qualified"),
        isNotNull(leadsTable.scoringMethod),
        gte(leadsTable.relevanceScore, campaign.minRelevanceScore),
      ));
    qualifiedLeadCount = eligibleLeads.length;

    const candidates: { listId: number; leadId: number; email: string | null }[] = [];
    for (const lead of eligibleLeads) {
      const emails = parseLeadEmails(lead.emails);
      if (emails.length === 0) {
        candidates.push({ listId: list.id, leadId: lead.id, email: null });
      } else {
        for (const email of emails) {
          candidates.push({ listId: list.id, leadId: lead.id, email });
          emailItems++;
        }
      }
    }

    const existingItems = await tx
      .select({ leadId: leadListItemsTable.leadId, email: leadListItemsTable.email })
      .from(leadListItemsTable)
      .where(eq(leadListItemsTable.listId, list.id));
    const rowsToInsert = missingListItems(candidates, existingItems);
    if (rowsToInsert.length > 0) {
      await tx.insert(leadListItemsTable).values(rowsToInsert).onConflictDoNothing();
    }
    insertedItems = rowsToInsert.length;
    return list.id;
  });

  if (listId == null) return null;
  await schedulerLog(
    campaign.id,
    `Final list "${listName}": ${qualifiedLeadCount} qualified leads, ${emailItems} email items, ${insertedItems} new list items`,
    { campaignRunId, listId, qualifiedLeadCount, emailItems, insertedItems },
  );
  return listId;
}

// ── Step 3c: Auto-create pending_review outreach drafts from the new list ────

async function runAutoOutreach(
  campaign: typeof campaignsTable.$inferSelect,
  listId: number,
  _errors: string[],
  campaignRunId?: number,
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<number> {
  if (!campaign.emailTemplateId && !configurationSnapshot?.emailTemplate) return 0;
  if (configurationSnapshot?.automation.autoOutreachEnabled === false) return 0;
  if (await isCancellationRequested(campaignRunId)) return 0;

  const assignedAccountId = await getAssignedSenderAccountId(campaign.id, configurationSnapshot);
  if (!assignedAccountId) return 0;

  const liveCampaignTemplateId = campaign.emailTemplateId;
  const tmpl = configurationSnapshot
    ? templateFromRunConfiguration(configurationSnapshot)
    : liveCampaignTemplateId != null
      ? (await db
        .select()
        .from(emailTemplatesTable)
        .where(eq(emailTemplatesTable.id, liveCampaignTemplateId)))[0]
      : null;
  if (!tmpl) return 0;

  const [liveTemplate] = tmpl.id != null
    ? await db
      .select({ id: emailTemplatesTable.id })
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, tmpl.id))
      .limit(1)
    : [];

  // Fetch list + list items
  const [list] = await db
    .select({ name: leadListsTable.name })
    .from(leadListsTable)
    .where(eq(leadListsTable.id, listId));
  if (!list) return 0;

  const listItems = await db
    .select({
      id: leadListItemsTable.id,
      email: leadListItemsTable.email,
      leadId: leadListItemsTable.leadId,
      companyName: leadListItemsTable.companyName,
    })
    .from(leadListItemsTable)
    .where(eq(leadListItemsTable.listId, listId));
  if (listItems.length === 0) return 0;

  // Bulk-fetch lead records
  const leadIds = [...new Set(listItems.map((i) => i.leadId).filter((id): id is number => id !== null))];
  const leads = leadIds.length > 0
    ? await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds))
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));
  const blockedDomains = parseBlockedDomains(blockedSetting?.value);
  const existingOutreach = await db
    .select({ recipientEmail: outreachQueueTable.recipientEmail })
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.campaignId, campaign.id));
  const candidateRecipients = listItems.map((item) => {
    const lead = item.leadId ? leadById.get(item.leadId) : undefined;
    return sanitizeEmail((item.email?.trim() || (lead ? getPrimaryLeadEmail(lead.emails) : null)) ?? "");
  });
  const recipientsToCreate = new Set(missingDraftRecipients(
    candidateRecipients,
    existingOutreach.map((item) => item.recipientEmail),
  ));

  const batchId = `auto-run-${campaignRunId ?? "legacy"}-list-${listId}`;
  let created = 0;

  for (const item of listItems) {
    if (await isCancellationRequested(campaignRunId)) break;
    const lead = item.leadId ? leadById.get(item.leadId) : undefined;
    const rawEmail = (item.email?.trim() || (lead ? getPrimaryLeadEmail(lead.emails) : null)) ?? "";
    const recipientEmail = sanitizeEmail(rawEmail).toLowerCase();
    if (!recipientsToCreate.delete(recipientEmail) || !lead) continue;
    if (!(await canCreateAutoOutreachDraft(campaign.id, lead, recipientEmail, blockedDomains))) continue;

    // Build lead context: use recipientEmail as emails so AI picks the right name
    const leadForContent: typeof leadsTable.$inferSelect = { ...lead, emails: recipientEmail };

    try {
      if (await isCancellationRequested(campaignRunId)) break;
      const result = await generatePersonalizedEmail(
        leadForContent,
        tmpl,
        { campaignName: campaign.name, listName: list.name },
        configurationSnapshot?.ai,
      );

      const [inserted] = await db.insert(outreachQueueTable).values({
        campaignId: campaign.id,
        leadId: lead?.id ?? null,
        emailAccountId: assignedAccountId,
        emailTemplateId: liveTemplate?.id ?? null,
        templateSnapshot: configurationSnapshot?.emailTemplate ?? null,
        listId,
        recipientEmail,
        subject: result.subject,
        body: result.body,
        batchId,
        status: "pending_review",
        aiPersonalized: result.aiUsed,
      }).onConflictDoNothing().returning({ id: outreachQueueTable.id });
      if (inserted) created++;
    } catch (err) {
      logger.warn({ err, recipientEmail }, "Auto-outreach: failed to generate draft for item");
    }
  }

  await schedulerLog(
    campaign.id,
    `Auto-outreach: created ${created} pending_review drafts for list #${listId}`,
    { listId, batchId, created },
  );

  return created;
}

// ── Step 4: Queue & Send Emails ─────────────────────────────────────────────

async function runEmail(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
  configurationSnapshot?: CampaignRunConfigurationSnapshot | null,
): Promise<number> {
  if (!campaign.emailTemplate || !campaign.subjectTemplate) {
    return 0; // No email template configured
  }

  // Re-fetch the current blocklist so we don't email any domain that was
  // blocked since this campaign's leads were originally created.
  const [emailBlockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));
  const emailBlockedDomains = parseBlockedDomains(emailBlockedSetting?.value);

  // Configurable send delay
  const [delayMinRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "send_delay_min_seconds"));
  const [delayMaxRow] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "send_delay_max_seconds"));
  const pipelineDelayMinMs = Math.max(1000, (parseInt(delayMinRow?.value ?? "30", 10) || 30) * 1000);
  const pipelineDelayMaxMs = Math.max(pipelineDelayMinMs, (parseInt(delayMaxRow?.value ?? "120", 10) || 120) * 1000);

  // Find qualified leads not yet queued for this campaign
  const eligibleLeads = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.campaignId, campaign.id),
        eq(leadsTable.reviewStatus, "pending"),
        eq(leadsTable.crawlStatus, "crawled"),
        sql`${leadsTable.relevanceScore} >= ${campaign.minRelevanceScore}`,
        sql`${leadsTable.emails} IS NOT NULL AND ${leadsTable.emails} != ''`,
      ),
    )
    .limit(await (async () => {
      const [s] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "global_max_emails_per_day"));
      return parseInt(s?.value ?? String(campaign.maxEmailsPerDay ?? 20), 10);
    })());

  if (eligibleLeads.length === 0) return 0;

  // Filter out leads whose domain is now in the blocklist (could have been
  // added since the lead was originally discovered in a prior run).
  const safeLeads = eligibleLeads.filter(
    (l) => !domainMatchesBlockedList(l.rootDomain, emailBlockedDomains),
  );
  if (safeLeads.length === 0) return 0;

  // Get the email account assigned to this campaign
  const assignedAccountId = await getAssignedSenderAccountId(campaign.id, configurationSnapshot);
  if (!assignedAccountId) return 0;

  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(
      and(
        eq(emailAccountsTable.id, assignedAccountId),
        eq(emailAccountsTable.isActive, true),
      ),
    );

  if (!account) return 0;

  // Check account daily limit
  let accountSentToday = account.sentToday;
  if (account.lastSentAt && !isSameDay(new Date(account.lastSentAt), new Date())) {
    await db.update(emailAccountsTable).set({ sentToday: 0 }).where(eq(emailAccountsTable.id, account.id));
    accountSentToday = 0;
  }

  const rawPassword = isEncrypted(account.smtpPassword)
    ? decrypt(account.smtpPassword)
    : account.smtpPassword;

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.smtpUser, pass: rawPassword },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });

  let emailsSent = 0;
  const [globalEmailSetting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "global_max_emails_per_day"));
  const globalMaxEmailsPerDay = parseInt(globalEmailSetting?.value ?? String(campaign.maxEmailsPerDay ?? 20), 10);

  for (const lead of safeLeads) {
    if (accountSentToday >= account.dailySendLimit) break;
    if (emailsSent >= globalMaxEmailsPerDay) break;

    const recipientEmail = lead.emails?.split(",")[0]?.trim();
    if (!recipientEmail) continue;

    // Skip unsubscribed recipients
    if (await isEmailUnsubscribed(recipientEmail)) {
      await schedulerLog(campaign.id, `Skipped email to ${recipientEmail} (unsubscribed)`, { leadId: lead.id });
      continue;
    }

    // Check for duplicate queue entry by recipient email for this campaign.
    // One lead may expose multiple legitimate contact emails that should each
    // be eligible for outreach.
    const existing = await db
      .select({ id: outreachQueueTable.id })
      .from(outreachQueueTable)
      .where(
        and(
          eq(outreachQueueTable.recipientEmail, recipientEmail),
          eq(outreachQueueTable.campaignId, campaign.id),
        ),
      )
      .limit(1);

    if (existing.length > 0) continue;

    // Build email from template
    const subject = (campaign.subjectTemplate || "")
      .replace(/\{\{company_name\}\}/g, lead.companyName)
      .replace(/\{\{country\}\}/g, lead.sourceCountry || "")
      .replace(/\{\{campaign_name\}\}/g, campaign.name);

    const body = (campaign.emailTemplate || "")
      .replace(/\{\{company_name\}\}/g, lead.companyName)
      .replace(/\{\{country\}\}/g, lead.sourceCountry || "")
      .replace(/\{\{campaign_name\}\}/g, campaign.name);

    // Insert as approved to outreach queue first (so we get an ID for the unsubscribe token)
    const [queued] = await db.insert(outreachQueueTable).values({
      campaignId: campaign.id,
      leadId: lead.id,
      emailAccountId: account.id,
      recipientEmail,
      subject,
      body,
      status: "approved",
      approvedAt: new Date(),
    }).returning();

    if (!queued) continue;

    // Build final email body with unsubscribe link
    const unsubscribeUrl = await buildUnsubscribeUrl(queued.id, recipientEmail, lead.companyName);
    const bodyWithUnsub = unsubscribeUrl
      ? appendUnsubscribeFooter(body, `To unsubscribe from future emails, click here: ${unsubscribeUrl}`)
      : body;
    const fullBody = appendUnsubscribeFooter(bodyWithUnsub, campaign.unsubscribeFooter);

    // Auto-send
    try {
      await transporter.sendMail({
        from: fromHeader(account),
        to: recipientEmail,
        subject,
        text: toTextEmail(fullBody),
        html: toHtmlEmail(fullBody),
        headers: unsubscribeUrl ? {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : undefined,
      });

      const now = new Date();
      await db.update(outreachQueueTable)
        .set({ status: "sent", sentAt: now, failureReason: null })
        .where(eq(outreachQueueTable.id, queued.id));

      await db.update(emailAccountsTable)
        .set({
          sentToday: sql`${emailAccountsTable.sentToday} + 1`,
          totalSent: sql`${emailAccountsTable.totalSent} + 1`,
          lastSentAt: now,
        })
        .where(eq(emailAccountsTable.id, account.id));

      // Mark lead as sent
      await db.update(leadsTable)
        .set({ reviewStatus: "approved", emailStatus: "sent" })
        .where(eq(leadsTable.id, lead.id));

      accountSentToday++;
      emailsSent++;

      await schedulerLog(campaign.id, `Email sent to ${recipientEmail} (${lead.rootDomain})`, { leadId: lead.id });

      // Anti-spam delay
      if (emailsSent < safeLeads.length) {
        const delayMs = Math.floor(Math.random() * (pipelineDelayMaxMs - pipelineDelayMinMs + 1)) + pipelineDelayMinMs;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Email failed to ${recipientEmail}: ${msg}`);
      await db.update(outreachQueueTable)
        .set({ status: "failed", failureReason: msg })
        .where(eq(outreachQueueTable.id, queued.id));
    }
  }

  return emailsSent;
}

async function getProcessingState(
  campaignId: number,
  campaignRunId?: number,
): Promise<{ pendingCrawlCount: number; crawlFailedCount: number; pendingScoreCount: number }> {
  const conditions = [eq(leadsTable.campaignId, campaignId)];
  if (campaignRunId != null) {
    conditions.push(eq(leadsTable.campaignRunId, campaignRunId));
  }

  const leads = await db
    .select({
      crawlStatus: leadsTable.crawlStatus,
      scoringMethod: leadsTable.scoringMethod,
    })
    .from(leadsTable)
    .where(and(...conditions));

  return {
    pendingCrawlCount: leads.filter((lead) => ["pending", "crawling", "browser_pending", "browser_crawling"].includes(lead.crawlStatus ?? "")).length,
    crawlFailedCount: leads.filter((lead) => lead.crawlStatus === "failed").length,
    pendingScoreCount: leads.filter((lead) => lead.crawlStatus === "crawled" && !lead.scoringMethod).length,
  };
}

async function getBatchProcessingState(
  campaignRunId?: number,
): Promise<{ pendingBatchCount: number; failedBatchCount: number }> {
  if (campaignRunId == null) {
    return { pendingBatchCount: 0, failedBatchCount: 0 };
  }
  const batches = await db
    .select({ status: campaignRunBatchesTable.status })
    .from(campaignRunBatchesTable)
    .where(eq(campaignRunBatchesTable.campaignRunId, campaignRunId));
  return {
    pendingBatchCount: batches.filter((b) => ["claimed", "scoring", "creating_drafts"].includes(b.status)).length,
    failedBatchCount: batches.filter((b) => b.status === "failed").length,
  };
}

async function autoBlockLowRelevanceDomains(
  campaign: typeof campaignsTable.$inferSelect,
  campaignRunId?: number,
): Promise<number> {
  const conditions = [
    eq(leadsTable.campaignId, campaign.id),
  ];
  if (campaignRunId != null) {
    conditions.push(eq(leadsTable.campaignRunId, campaignRunId));
  }

  const leads = await db
    .select({
      rootDomain: leadsTable.rootDomain,
      relevanceScore: leadsTable.relevanceScore,
      scoringMethod: leadsTable.scoringMethod,
    })
    .from(leadsTable)
    .where(and(...conditions));

  const lowScoreDomains = leads
    .filter((lead) =>
      typeof lead.relevanceScore === "number" &&
      lead.relevanceScore < campaign.minRelevanceScore &&
      !!lead.scoringMethod &&
      !lead.scoringMethod.startsWith("failed"),
    )
    .map((lead) => normalizeDomainToken(lead.rootDomain))
    .filter(Boolean);

  if (lowScoreDomains.length === 0) return 0;

  // Fetch current blocked domains to avoid adding duplicates
  const [blockedSetting] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  const existingSet = parseBlockedDomains(blockedSetting?.value);
  const addedDomains: string[] = [];
  for (const domain of lowScoreDomains) {
    if (!existingSet.has(domain)) {
      existingSet.add(domain);
      addedDomains.push(domain);
    }
  }

  if (addedDomains.length === 0) return 0;

  // Use atomic SQL append instead of read-modify-write to avoid overwriting
  // domains that the user may have added manually between our read and write.
  const appendValue = addedDomains.join("\n");
  await db
    .insert(appSettingsTable)
    .values({ key: "blocked_domains", value: appendValue })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: {
        value: sql`${appSettingsTable.value} || E'\n' || ${appendValue}`,
        updatedAt: new Date(),
      },
    });

  // Also disqualify all existing leads for these domains across this campaign
  // so they won't surface for outreach in future runs.
  for (const domain of addedDomains) {
    await db
      .update(leadsTable)
      .set({ qualificationStatus: "rejected" })
      .where(
        and(
          eq(leadsTable.campaignId, campaign.id),
          sql`${leadsTable.rootDomain} = ${domain}`,
        ),
      );
  }

  await schedulerLog(
    campaign.id,
    `Auto-blocked ${addedDomains.length} low-relevance domain${addedDomains.length !== 1 ? "s" : ""} and disqualified their leads`,
    {
      minRelevanceScore: campaign.minRelevanceScore,
      domains: addedDomains,
    },
  );

  return addedDomains.length;
}

// ── Main pipeline ───────────────────────────────────────────────────────────

export async function runPipeline(
  campaignId: number,
  campaignRunId?: number,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const result: PipelineResult = {
    campaignId,
    discoveryLeadsCreated: 0,
    discoverySearchesPerformed: 0,
    discoverySearchesSkipped: 0,
    discoveryRawResults: 0,
    discoveryResultsSeenBefore: 0,
    discoverySourcesFound: 0,
    discoverySourcesMined: 0,
    discoverySourcesSkipped: 0,
    discoveryDuplicatesSkipped: 0,
    discoveryBlockedSkipped: 0,
    crawledCount: 0,
    scoredCount: 0,
    pendingCrawlCount: 0,
    crawlFailedCount: 0,
    pendingScoreCount: 0,
    autoBlockedLowScoreCount: 0,
    emailsSent: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
    errors,
  };

  const [currentCampaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!currentCampaign) {
    errors.push(`Campaign ${campaignId} not found`);
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  if (!currentCampaign.isActive) {
    result.skipped++;
    await schedulerLog(campaignId, "Pipeline skipped: campaign is inactive");
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  if (currentCampaign.isPaused) {
    result.skipped++;
    await schedulerLog(campaignId, "Pipeline skipped: campaign is paused");
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  let configurationSnapshot = options.configurationSnapshot;
  if (configurationSnapshot === undefined && campaignRunId != null) {
    const [run] = await db
      .select({ configurationSnapshot: campaignRunsTable.configurationSnapshot })
      .from(campaignRunsTable)
      .where(eq(campaignRunsTable.id, campaignRunId));
    configurationSnapshot = isCampaignRunConfigurationSnapshot(run?.configurationSnapshot)
      ? run.configurationSnapshot
      : null;
  }
  const campaign = configurationSnapshot
    ? campaignFromRunConfiguration(currentCampaign, configurationSnapshot)
    : currentCampaign;
  const executionOptions: PipelineOptions = { ...options, configurationSnapshot };

  if (campaignRunId != null) activePipelineRuns.add(campaignRunId);

  try {
    await schedulerLog(campaignId, `Pipeline started for campaign "${campaign.name}"${options.skipDiscovery ? " (resuming — skipping discovery)" : ""}`);
    await setStage(campaignRunId, "searching");

    try {
      if (options.skipDiscovery) {
        await schedulerLog(campaignId, "Discovery skipped (resume mode)");
      } else {
        const discoveryStats = await runDiscovery(campaign, errors, campaignRunId, executionOptions);
        result.discoveryLeadsCreated = discoveryStats.newLeadsCreated;
        result.discoverySearchesPerformed = discoveryStats.searchesPerformed;
        result.discoverySearchesSkipped = discoveryStats.searchesSkipped;
        result.discoveryRawResults = discoveryStats.rawResultsFound;
        result.discoveryResultsSeenBefore = discoveryStats.resultUrlsSeenBefore;
        result.discoverySourcesFound = discoveryStats.discoverySourcesFound;
        result.discoverySourcesMined = discoveryStats.discoverySourcesMined;
        result.discoverySourcesSkipped = discoveryStats.discoverySourcesSkipped;
        result.discoveryDuplicatesSkipped = discoveryStats.duplicatesSkipped;
        result.discoveryBlockedSkipped = discoveryStats.blockedSkipped;
        if (discoveryStats.missingSerperKey) {
          result.failed++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Discovery failed: ${msg}`);
      result.failed++;
      logger.error({ err, campaignId }, "Scheduler: discovery step failed");
    }

    if (await isCancellationRequested(campaignRunId)) {
      await finalizeCancelledRun(campaignId, campaignRunId, startedAt);
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    await setStage(campaignRunId, "crawling");
    try {
      const crawlStats = await runCrawl(campaign, errors, campaignRunId, configurationSnapshot);
      result.crawledCount = crawlStats.crawledCount;
      result.scoredCount += crawlStats.scoredCount;
      result.failed += crawlStats.failedCount;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Crawl failed: ${msg}`);
      result.failed++;
      logger.error({ err, campaignId }, "Scheduler: crawl step failed");
    }

    if (await isCancellationRequested(campaignRunId)) {
      await finalizeCancelledRun(campaignId, campaignRunId, startedAt);
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    await setStage(campaignRunId, "scoring");
    try {
      const batchStats = await drainCampaignRunBatches(
        campaign,
        campaignRunId,
        errors,
        true,
        configurationSnapshot,
      );
      result.scoredCount += batchStats.scoredCount;
      result.failed += batchStats.failedCount;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Scoring failed: ${msg}`);
      result.failed++;
      logger.error({ err, campaignId }, "Scheduler: score step failed");
    }

    if (await isCancellationRequested(campaignRunId)) {
      await finalizeCancelledRun(campaignId, campaignRunId, startedAt);
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    // After scoring: auto-add qualified+email leads to a named list, then create
    // pending_review outreach drafts if the campaign has an email template set.
    let autoListId: number | null = null;
    try {
      const finalizationProcessingState = await getProcessingState(campaignId, campaignRunId);
      const finalizationBatchState = await getBatchProcessingState(campaignRunId);
      const projectedFailureCount = result.failed +
        finalizationProcessingState.crawlFailedCount +
        finalizationProcessingState.pendingCrawlCount +
        finalizationProcessingState.pendingScoreCount +
        finalizationBatchState.pendingBatchCount +
        finalizationBatchState.failedBatchCount;
      const workCompleted = result.discoveryLeadsCreated > 0 ||
        result.crawledCount > 0 ||
        finalizationProcessingState.crawlFailedCount > 0 ||
        result.scoredCount > 0 ||
        result.emailsSent > 0;
      const projectedStatus = resolveTerminalRunStatus(projectedFailureCount, workCompleted);
      const ready = isRunReadyForFinalization({
        status: projectedStatus,
        pendingCrawlCount: finalizationProcessingState.pendingCrawlCount,
        pendingScoreCount: finalizationProcessingState.pendingScoreCount,
        pendingBatchCount: finalizationBatchState.pendingBatchCount,
      });
      if (
        campaignRunId != null &&
        ready &&
        configurationSnapshot?.automation.autoListEnabled !== false &&
        !(await isCancellationRequested(campaignRunId))
      ) {
        autoListId = await runAutoList(campaign, campaignRunId, errors);
      }
    } catch (err) {
      logger.error({ err, campaignId }, "Scheduler: auto-list step failed");
    }

    if (await isCancellationRequested(campaignRunId)) {
      await finalizeCancelledRun(campaignId, campaignRunId, startedAt);
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    try {
      if (autoListId != null && configurationSnapshot?.automation.autoOutreachEnabled !== false) {
        await runAutoOutreach(campaign, autoListId, errors, campaignRunId, configurationSnapshot);
      }
    } catch (err) {
      logger.error({ err, campaignId }, "Scheduler: auto-outreach step failed");
    }

    if (await isCancellationRequested(campaignRunId)) {
      await finalizeCancelledRun(campaignId, campaignRunId, startedAt);
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    try {
      result.emailsSent = await runEmail(campaign, errors, configurationSnapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Email step failed: ${msg}`);
      result.failed++;
      logger.error({ err, campaignId }, "Scheduler: email step failed");
    }

    result.durationMs = Date.now() - startedAt;
    const processingState = await getProcessingState(campaignId, campaignRunId);
    const batchProcessingState = await getBatchProcessingState(campaignRunId);
    result.pendingCrawlCount = processingState.pendingCrawlCount;
    result.crawlFailedCount = processingState.crawlFailedCount;
    result.pendingScoreCount = processingState.pendingScoreCount;
    if (processingState.pendingCrawlCount > 0) {
      errors.push(`${processingState.pendingCrawlCount} lead(s) still pending crawl`);
      result.failed += processingState.pendingCrawlCount;
    }
    if (processingState.crawlFailedCount > 0) {
      errors.push(`${processingState.crawlFailedCount} lead(s) failed crawl and could not be scored`);
      result.failed += processingState.crawlFailedCount;
    }
    if (processingState.pendingScoreCount > 0) {
      errors.push(`${processingState.pendingScoreCount} crawled lead(s) still pending scoring`);
      result.failed += processingState.pendingScoreCount;
    }
    if (batchProcessingState.pendingBatchCount > 0) {
      errors.push(`${batchProcessingState.pendingBatchCount} processing batch(es) still pending`);
      result.failed += batchProcessingState.pendingBatchCount;
    }
    if (batchProcessingState.failedBatchCount > 0) {
      errors.push(`${batchProcessingState.failedBatchCount} processing batch(es) failed`);
      result.failed += batchProcessingState.failedBatchCount;
    }

    if (await isCancellationRequested(campaignRunId)) {
      await finalizeCancelledRun(campaignId, campaignRunId, startedAt);
      return result;
    }

    if (result.scoredCount > 0 && processingState.pendingCrawlCount === 0 && processingState.pendingScoreCount === 0) {
      result.autoBlockedLowScoreCount = await autoBlockLowRelevanceDomains(campaign, campaignRunId);
    }

    await schedulerLog(
      campaignId,
      `Pipeline complete: ${result.discoveryLeadsCreated} discovered, ${result.crawledCount} crawled, ${result.scoredCount} scored, ${result.emailsSent} emailed in ${Math.round(result.durationMs / 1000)}s`,
      result as unknown as Record<string, unknown>,
    );

    return result;
  } finally {
    if (campaignRunId != null) activePipelineRuns.delete(campaignRunId);
  }
}
