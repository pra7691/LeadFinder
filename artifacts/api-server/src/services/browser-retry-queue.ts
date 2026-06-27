import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignRunsTable,
  leadCrawlAttemptsTable,
  leadsTable,
  logsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { parseLeadEmails } from "./lead-emails";
import { BrowserCrawlerSetupError, crawlWebsiteWithPlaywright } from "./playwright-crawler";
import {
  createSingleFlightDrain,
  browserFailureUpdate,
  browserSuccessUpdate,
  hasDurableBrowserRetry,
  isBrowserRetryRunnable,
  type BrowserRetryStatus,
} from "./browser-retry-core";
import type { CrawlFailure } from "./crawl-failure-classifier";

type QueryResult<T> = { rows: T[] };

async function queryRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as QueryResult<T>;
  return result.rows ?? [];
}

export async function recordHttpCrawlStarted(input: {
  leadId: number;
  campaignId: number;
  campaignRunId?: number;
}): Promise<void> {
  await db.insert(leadCrawlAttemptsTable).values({
    leadId: input.leadId,
    campaignId: input.campaignId,
    campaignRunId: input.campaignRunId ?? null,
    httpStatus: "running",
    httpStartedAt: new Date(),
  }).onConflictDoUpdate({
    target: leadCrawlAttemptsTable.leadId,
    set: {
      campaignRunId: input.campaignRunId ?? null,
      httpStatus: "running",
      httpFailureCategory: null,
      httpError: null,
      httpStartedAt: new Date(),
      httpCompletedAt: null,
    },
  });
}

export async function recordHttpCrawlSucceeded(leadId: number): Promise<void> {
  await db.update(leadCrawlAttemptsTable).set({
    httpStatus: "succeeded",
    httpCompletedAt: new Date(),
    browserStatus: "not_needed",
    finalStatus: "crawled",
    finalCrawler: "http",
  }).where(eq(leadCrawlAttemptsTable.leadId, leadId));
}

export async function recordHttpCrawlInterrupted(leadId: number, message: string): Promise<void> {
  await db.update(leadCrawlAttemptsTable).set({
    httpStatus: "pending",
    httpError: message.slice(0, 1000),
    httpCompletedAt: null,
  }).where(eq(leadCrawlAttemptsTable.leadId, leadId));
}

export async function recordHttpCrawlFailure(input: {
  leadId: number;
  failure: CrawlFailure;
  queueBrowser: boolean;
}): Promise<"queued" | "failed" | "already_succeeded"> {
  const now = new Date();
  const [existing] = await db.select({ browserStatus: leadCrawlAttemptsTable.browserStatus })
    .from(leadCrawlAttemptsTable)
    .where(eq(leadCrawlAttemptsTable.leadId, input.leadId));
  const existingBrowserStatus = (existing?.browserStatus ?? "not_needed") as BrowserRetryStatus;
  if (existingBrowserStatus === "succeeded") {
    await db.transaction(async (tx) => {
      await tx.update(leadCrawlAttemptsTable).set({
        httpStatus: "failed",
        httpFailureCategory: input.failure.category,
        httpError: input.failure.message.slice(0, 1000),
        httpCompletedAt: now,
      }).where(eq(leadCrawlAttemptsTable.leadId, input.leadId));
      await tx.update(leadsTable).set({ crawlStatus: "crawled", crawlError: null })
        .where(eq(leadsTable.id, input.leadId));
    });
    return "already_succeeded";
  }
  if (input.queueBrowser && hasDurableBrowserRetry(existingBrowserStatus)) return "queued";

  await db.transaction(async (tx) => {
    await tx.update(leadCrawlAttemptsTable).set({
      httpStatus: "failed",
      httpFailureCategory: input.failure.category,
      httpError: input.failure.message.slice(0, 1000),
      httpCompletedAt: now,
      browserStatus: input.queueBrowser ? "pending" : "not_needed",
      browserQueuedAt: input.queueBrowser ? now : null,
      browserError: null,
      browserStartedAt: null,
      browserCompletedAt: null,
      finalStatus: input.queueBrowser ? null : "failed",
      finalCrawler: null,
    }).where(eq(leadCrawlAttemptsTable.leadId, input.leadId));

    await tx.update(leadsTable).set({
      crawlStatus: input.queueBrowser ? "browser_pending" : "failed",
      crawlError: input.failure.message.slice(0, 500),
    }).where(eq(leadsTable.id, input.leadId));
  });

  if (input.queueBrowser) {
    void browserRetryWorker.kick().catch((error) => {
      logger.error({ err: error }, "Browser retry worker failed");
    });
  }
  return input.queueBrowser ? "queued" : "failed";
}

type ClaimedAttempt = { id: number; lead_id: number };

async function claimNextBrowserRetry(): Promise<ClaimedAttempt | null> {
  let rows: ClaimedAttempt[];
  try {
    rows = await queryRows<ClaimedAttempt>(sql`
      WITH next AS (
        SELECT a.id
        FROM lead_crawl_attempts a
        JOIN campaign_runs r ON r.id = a.campaign_run_id
        WHERE a.browser_status = 'pending'
          AND r.status = 'running'
          AND NOT EXISTS (
            SELECT 1 FROM lead_crawl_attempts active
            WHERE active.browser_status = 'running'
          )
        ORDER BY a.browser_queued_at ASC NULLS LAST, a.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE lead_crawl_attempts a
      SET browser_status = 'running', browser_started_at = now(), browser_error = NULL, updated_at = now()
      WHERE a.id IN (SELECT id FROM next)
      RETURNING a.id, a.lead_id
    `);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
      return null;
    }
    throw error;
  }
  const claimed = rows[0];
  if (!claimed) return null;
  await db.update(leadsTable)
    .set({ crawlStatus: "browser_crawling" })
    .where(eq(leadsTable.id, claimed.lead_id));
  return claimed;
}

async function shouldStopBrowserAttempt(campaignRunId: number | null): Promise<boolean> {
  if (campaignRunId == null) return true;
  const [run] = await db.select({ status: campaignRunsTable.status })
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, campaignRunId));
  return !isBrowserRetryRunnable(run?.status);
}

async function returnBrowserAttemptToQueue(attemptId: number, leadId: number, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(leadCrawlAttemptsTable).set({
      browserStatus: "pending",
      browserError: message,
      browserStartedAt: null,
    }).where(eq(leadCrawlAttemptsTable.id, attemptId));
    await tx.update(leadsTable).set({
      crawlStatus: "browser_pending",
      crawlError: message.slice(0, 500),
    }).where(eq(leadsTable.id, leadId));
  });
}

async function processBrowserRetry(claimed: ClaimedAttempt): Promise<"continue" | "setup_required"> {
  const [row] = await db.select({
    lead: leadsTable,
    campaign: campaignsTable,
    campaignRunId: leadCrawlAttemptsTable.campaignRunId,
  })
    .from(leadCrawlAttemptsTable)
    .innerJoin(leadsTable, eq(leadsTable.id, leadCrawlAttemptsTable.leadId))
    .innerJoin(campaignsTable, eq(campaignsTable.id, leadCrawlAttemptsTable.campaignId))
    .where(eq(leadCrawlAttemptsTable.id, claimed.id));
  if (!row) return "continue";

  if (await shouldStopBrowserAttempt(row.campaignRunId)) {
    await returnBrowserAttemptToQueue(claimed.id, row.lead.id, "Browser retry paused with campaign run");
    return "continue";
  }

  try {
    const data = await crawlWebsiteWithPlaywright(row.lead.websiteUrl, row.lead.rootDomain, {
      crawlPaths: row.campaign.crawlPaths,
      internalLinkKeywords: row.campaign.internalLinkKeywords,
      maxPagesPerDomain: row.campaign.maxPagesPerDomain,
      maxCrawlDepth: row.campaign.maxCrawlDepth,
      shouldStop: () => shouldStopBrowserAttempt(row.campaignRunId),
    });

    if (data.cancelled || await shouldStopBrowserAttempt(row.campaignRunId)) {
      await returnBrowserAttemptToQueue(claimed.id, row.lead.id, "Browser retry paused with campaign run");
      return "continue";
    }

    if (data.pagesSucceeded > 0) {
      const recovered = browserSuccessUpdate(parseLeadEmails(row.lead.emails), parseLeadEmails(data.emails));
      await db.transaction(async (tx) => {
        await tx.update(leadsTable).set({
          crawlStatus: recovered.crawlStatus,
          crawlError: recovered.crawlError,
          rawText: data.rawText || row.lead.rawText,
          companyName: data.companyName || row.lead.companyName,
          emails: recovered.emails.length > 0 ? recovered.emails.join(", ") : null,
          emailDomainStatus: data.emailDomainStatus || row.lead.emailDomainStatus,
          phoneNumbers: data.phoneNumbers || row.lead.phoneNumbers,
          address: data.address || row.lead.address,
          country: data.country || row.lead.country,
          linkedinUrl: data.linkedinUrl || row.lead.linkedinUrl,
        }).where(eq(leadsTable.id, row.lead.id));
        await tx.update(leadCrawlAttemptsTable).set({
          browserStatus: "succeeded",
          browserCompletedAt: new Date(),
          browserError: null,
          finalStatus: "crawled",
          finalCrawler: "browser",
        }).where(eq(leadCrawlAttemptsTable.id, claimed.id));
      });
      return "continue";
    }

    const message = data.failure?.message ?? "Browser crawl returned no usable content";
    const failed = browserFailureUpdate(message);
    await db.transaction(async (tx) => {
      await tx.update(leadsTable).set(failed)
        .where(eq(leadsTable.id, row.lead.id));
      await tx.update(leadCrawlAttemptsTable).set({
        browserStatus: "failed",
        browserError: message.slice(0, 1000),
        browserCompletedAt: new Date(),
        finalStatus: "failed",
        finalCrawler: null,
      }).where(eq(leadCrawlAttemptsTable.id, claimed.id));
      await tx.insert(logsTable).values({
        campaignId: row.campaign.id,
        type: "error",
        message: `Browser crawl failed ${row.lead.rootDomain}: ${message}`,
        metadataJson: JSON.stringify({ campaignRunId: row.campaignRunId, leadId: row.lead.id }),
      });
    });
    return "continue";
  } catch (error) {
    if (error instanceof BrowserCrawlerSetupError) {
      await db.transaction(async (tx) => {
        await tx.update(leadCrawlAttemptsTable).set({
          browserStatus: "setup_required",
          browserError: error.message,
          browserStartedAt: null,
        }).where(eq(leadCrawlAttemptsTable.id, claimed.id));
        await tx.update(leadsTable).set({
          crawlStatus: "browser_pending",
          crawlError: error.message.slice(0, 500),
        }).where(eq(leadsTable.id, row.lead.id));
      });
      logger.warn({ leadId: row.lead.id }, error.message);
      return "setup_required";
    }

    const message = error instanceof Error ? error.message : String(error);
    const failed = browserFailureUpdate(message);
    await db.transaction(async (tx) => {
      await tx.update(leadsTable).set(failed)
        .where(eq(leadsTable.id, row.lead.id));
      await tx.update(leadCrawlAttemptsTable).set({
        browserStatus: "failed",
        browserError: message.slice(0, 1000),
        browserCompletedAt: new Date(),
        finalStatus: "failed",
      }).where(eq(leadCrawlAttemptsTable.id, claimed.id));
      await tx.insert(logsTable).values({
        campaignId: row.campaign.id,
        type: "error",
        message: `Browser crawl error ${row.lead.rootDomain}: ${message}`,
        metadataJson: JSON.stringify({ campaignRunId: row.campaignRunId, leadId: row.lead.id }),
      });
    });
    return "continue";
  }
}

async function drainBrowserRetryQueue(): Promise<void> {
  while (true) {
    const claimed = await claimNextBrowserRetry();
    if (!claimed) return;
    const outcome = await processBrowserRetry(claimed);
    if (outcome === "setup_required") return;
  }
}

const browserRetryWorker = createSingleFlightDrain(drainBrowserRetryQueue);

export function startBrowserRetryWorker(): void {
  void browserRetryWorker.kick().catch((error) => {
    logger.error({ err: error }, "Browser retry worker failed");
  });
}

export async function recoverBrowserRetryQueueOnStartup(): Promise<number> {
  await db.update(leadCrawlAttemptsTable).set({
    httpStatus: "pending",
    httpError: "HTTP crawl interrupted by server restart",
    httpCompletedAt: null,
  }).where(eq(leadCrawlAttemptsTable.httpStatus, "running"));

  const recovered = await db.update(leadCrawlAttemptsTable).set({
    browserStatus: "pending",
    browserStartedAt: null,
  }).where(inArray(leadCrawlAttemptsTable.browserStatus, ["running", "setup_required"]))
    .returning({ leadId: leadCrawlAttemptsTable.leadId });
  if (recovered.length > 0) {
    await db.update(leadsTable).set({ crawlStatus: "browser_pending" })
      .where(inArray(leadsTable.id, recovered.map((item) => item.leadId)));
  }
  return recovered.length;
}

export async function resumeBrowserRetriesForRun(campaignRunId: number): Promise<number> {
  const recovered = await db.update(leadCrawlAttemptsTable).set({
    browserStatus: "pending",
    browserStartedAt: null,
  }).where(and(
    eq(leadCrawlAttemptsTable.campaignRunId, campaignRunId),
    inArray(leadCrawlAttemptsTable.browserStatus, ["running", "setup_required"]),
  )).returning({ leadId: leadCrawlAttemptsTable.leadId });
  if (recovered.length > 0) {
    await db.update(leadsTable).set({ crawlStatus: "browser_pending" })
      .where(inArray(leadsTable.id, recovered.map((item) => item.leadId)));
  }
  startBrowserRetryWorker();
  return recovered.length;
}

export async function getBrowserRetryState(campaignRunId: number): Promise<{
  pendingCount: number;
  runningCount: number;
  setupRequiredCount: number;
}> {
  const rows = await queryRows<{ pending_count: number; running_count: number; setup_required_count: number }>(sql`
    SELECT
      count(*) FILTER (WHERE browser_status = 'pending')::int AS pending_count,
      count(*) FILTER (WHERE browser_status = 'running')::int AS running_count,
      count(*) FILTER (WHERE browser_status = 'setup_required')::int AS setup_required_count
    FROM lead_crawl_attempts
    WHERE campaign_run_id = ${campaignRunId}
  `);
  return {
    pendingCount: rows[0]?.pending_count ?? 0,
    runningCount: rows[0]?.running_count ?? 0,
    setupRequiredCount: rows[0]?.setup_required_count ?? 0,
  };
}
