/**
 * Scheduler pipeline: runs discovery → crawl → score → email for a campaign.
 * Called by the cron worker and the manual trigger endpoint.
 */

import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignKeywordsTable,
  campaignCountriesTable,
  leadsTable,
  outreachQueueTable,
  emailAccountsTable,
  campaignEmailAccountsTable,
  appSettingsTable,
  logsTable,
} from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { searchSerper, extractRootDomain } from "../services/serper";
import { crawlWebsite } from "../services/crawler";
import { scoreLead } from "../services/scorer";
import nodemailer from "nodemailer";
import { isEncrypted, decrypt } from "../lib/crypto";
import { logger } from "../lib/logger";

export interface PipelineResult {
  campaignId: number;
  discoveryLeadsCreated: number;
  crawledCount: number;
  scoredCount: number;
  emailsSent: number;
  skipped: number;
  failed: number;
  durationMs: number;
  errors: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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

async function runDiscovery(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
): Promise<number> {
  const apiKey = process.env["SERPER_API_KEY"];
  if (!apiKey) {
    errors.push("SERPER_API_KEY not set — skipping discovery");
    return 0;
  }

  const keywords = await db
    .select()
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaign.id));

  const countries = await db
    .select()
    .from(campaignCountriesTable)
    .where(eq(campaignCountriesTable.campaignId, campaign.id));

  if (keywords.length === 0 || countries.length === 0) {
    await schedulerLog(campaign.id, "Discovery skipped: no keywords or countries configured");
    return 0;
  }

  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  const blockedDomains = new Set(
    (blockedSetting?.value ?? "")
      .split(/[\n,]/)
      .map((d) => d.trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean),
  );

  const existingLeads = await db
    .select({ rootDomain: leadsTable.rootDomain })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaign.id));

  const existingDomains = new Set(existingLeads.map((l) => l.rootDomain));

  let newLeadsCreated = 0;
  let searchCount = 0;
  const maxSearches = campaign.maxSearchesPerDay;

  await schedulerLog(campaign.id, `Discovery started: ${keywords.length} keywords × ${countries.length} countries`);

  outer: for (const kw of keywords) {
    for (const co of countries) {
      if (searchCount >= maxSearches) break outer;

      const query = `${kw.keyword} ${co.country}`;
      let results;
      try {
        results = await searchSerper(query, apiKey);
        searchCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Search failed: "${query}": ${msg}`);
        await schedulerLog(campaign.id, `Search error: "${query}": ${msg}`);
        continue;
      }

      for (const result of results) {
        const rootDomain = extractRootDomain(result.link);
        if (!rootDomain) continue;
        if (blockedDomains.has(rootDomain)) continue;
        if (existingDomains.has(rootDomain)) continue;

        try {
          await db.insert(leadsTable).values({
            campaignId: campaign.id,
            companyName: result.title.split(/[-|–]/, 1)[0].trim() || rootDomain,
            rootDomain,
            websiteUrl: result.link,
            leadStatus: "discovered",
            reviewStatus: "pending",
            emailStatus: "not_sent",
            relevanceScore: 0,
            relevanceReason: "",
            sourceKeyword: kw.keyword,
            sourceCountry: co.country,
            sourceQuery: query,
          });
          existingDomains.add(rootDomain);
          newLeadsCreated++;
        } catch {
          // unique constraint violation = race condition dupe
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await schedulerLog(campaign.id, `Discovery complete: ${searchCount} searches, ${newLeadsCreated} new leads`);
  return newLeadsCreated;
}

// ── Step 2: Crawl ───────────────────────────────────────────────────────────

async function runCrawl(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
): Promise<number> {
  const uncrawled = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.campaignId, campaign.id),
        eq(leadsTable.crawlStatus, "pending"),
      ),
    )
    .limit(campaign.maxLeadsPerDay);

  if (uncrawled.length === 0) return 0;

  await schedulerLog(campaign.id, `Crawl started: ${uncrawled.length} leads to crawl`);
  let crawledCount = 0;

  for (const lead of uncrawled) {
    try {
      const data = await crawlWebsite(lead.websiteUrl);
      const ok = data.pagesSucceeded > 0;
      const updates: Record<string, unknown> = {
        crawlStatus: ok ? "crawled" : "failed",
        crawlError: ok ? null : "No pages returned content",
        rawText: data.rawText || null,
      };
      if (ok) {
        if (data.companyName) updates.companyName = data.companyName;
        if (data.emails) updates.emails = data.emails;
        if (data.phoneNumbers) updates.phoneNumbers = data.phoneNumbers;
        if (data.address) updates.address = data.address;
        if (data.country) updates.country = data.country;
        if (data.linkedinUrl) updates.linkedinUrl = data.linkedinUrl;
      }
      await db.update(leadsTable).set(updates).where(eq(leadsTable.id, lead.id));
      if (ok) crawledCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Crawl failed ${lead.rootDomain}: ${msg}`);
      await db.update(leadsTable)
        .set({ crawlStatus: "failed", crawlError: msg.slice(0, 500) })
        .where(eq(leadsTable.id, lead.id));
    }
  }

  await schedulerLog(campaign.id, `Crawl complete: ${crawledCount}/${uncrawled.length} succeeded`);
  return crawledCount;
}

// ── Step 3: Score ───────────────────────────────────────────────────────────

async function runScore(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
): Promise<number> {
  const unscored = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.campaignId, campaign.id),
        eq(leadsTable.crawlStatus, "crawled"),
        eq(leadsTable.relevanceScore, 0),
      ),
    )
    .limit(50);

  if (unscored.length === 0) return 0;

  const keywords = await db
    .select({ keyword: campaignKeywordsTable.keyword })
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaign.id));

  const keywordList = keywords.map((k) => k.keyword);
  await schedulerLog(campaign.id, `Scoring started: ${unscored.length} leads`);
  let scoredCount = 0;

  for (const lead of unscored) {
    try {
      const result = await scoreLead({
        campaignObjective: campaign.objective,
        campaignKeywords: keywordList,
        companyName: lead.companyName,
        rootDomain: lead.rootDomain,
        rawText: lead.rawText ?? null,
        sourceQuery: lead.sourceQuery ?? null,
      });

      const reviewStatus =
        result.score < campaign.minRelevanceScore ? "low_relevance" : lead.reviewStatus;

      await db.update(leadsTable)
        .set({ relevanceScore: result.score, relevanceReason: result.reason, reviewStatus })
        .where(eq(leadsTable.id, lead.id));

      scoredCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Score failed ${lead.rootDomain}: ${msg}`);
    }
  }

  await schedulerLog(campaign.id, `Scoring complete: ${scoredCount} leads scored`);
  return scoredCount;
}

// ── Step 4: Queue & Send Emails ─────────────────────────────────────────────

async function runEmail(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
): Promise<number> {
  if (!campaign.emailTemplate || !campaign.subjectTemplate) {
    return 0; // No email template configured
  }

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
    .limit(campaign.maxEmailsPerDay);

  if (eligibleLeads.length === 0) return 0;

  // Get the email account assigned to this campaign
  const [assignedAccount] = await db
    .select({ accountId: campaignEmailAccountsTable.emailAccountId })
    .from(campaignEmailAccountsTable)
    .where(eq(campaignEmailAccountsTable.campaignId, campaign.id))
    .limit(1);

  if (!assignedAccount) return 0;

  const [account] = await db
    .select()
    .from(emailAccountsTable)
    .where(
      and(
        eq(emailAccountsTable.id, assignedAccount.accountId),
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

  for (const lead of eligibleLeads) {
    if (accountSentToday >= account.dailySendLimit) break;
    if (emailsSent >= campaign.maxEmailsPerDay) break;

    const recipientEmail = lead.emails?.split(",")[0]?.trim();
    if (!recipientEmail) continue;

    // Check for duplicate queue entry
    const existing = await db
      .select({ id: outreachQueueTable.id })
      .from(outreachQueueTable)
      .where(
        and(
          eq(outreachQueueTable.leadId, lead.id),
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

    const fullBody = campaign.unsubscribeFooter
      ? `${body}\n\n---\n${campaign.unsubscribeFooter}`
      : body;

    // Insert as approved to outreach queue
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

    // Auto-send
    try {
      await transporter.sendMail({
        from: `"${account.smtpUser}" <${account.smtpUser}>`,
        to: recipientEmail,
        subject,
        text: fullBody,
        html: fullBody.replace(/\n/g, "<br>"),
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
      if (emailsSent < eligibleLeads.length) {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6000) + 2000));
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

// ── Main pipeline ───────────────────────────────────────────────────────────

export async function runPipeline(campaignId: number): Promise<PipelineResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const result: PipelineResult = {
    campaignId,
    discoveryLeadsCreated: 0,
    crawledCount: 0,
    scoredCount: 0,
    emailsSent: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
    errors,
  };

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign) {
    errors.push(`Campaign ${campaignId} not found`);
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  if (!campaign.isActive) {
    result.skipped++;
    await schedulerLog(campaignId, "Pipeline skipped: campaign is inactive");
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  if (campaign.isPaused) {
    result.skipped++;
    await schedulerLog(campaignId, "Pipeline skipped: campaign is paused");
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  await schedulerLog(campaignId, `Pipeline started for campaign "${campaign.name}"`);

  try {
    result.discoveryLeadsCreated = await runDiscovery(campaign, errors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Discovery failed: ${msg}`);
    result.failed++;
    logger.error({ err, campaignId }, "Scheduler: discovery step failed");
  }

  try {
    result.crawledCount = await runCrawl(campaign, errors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Crawl failed: ${msg}`);
    result.failed++;
    logger.error({ err, campaignId }, "Scheduler: crawl step failed");
  }

  try {
    result.scoredCount = await runScore(campaign, errors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Scoring failed: ${msg}`);
    result.failed++;
    logger.error({ err, campaignId }, "Scheduler: score step failed");
  }

  try {
    result.emailsSent = await runEmail(campaign, errors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Email step failed: ${msg}`);
    result.failed++;
    logger.error({ err, campaignId }, "Scheduler: email step failed");
  }

  result.durationMs = Date.now() - startedAt;

  await schedulerLog(
    campaignId,
    `Pipeline complete: ${result.discoveryLeadsCreated} discovered, ${result.crawledCount} crawled, ${result.scoredCount} scored, ${result.emailsSent} emailed in ${Math.round(result.durationMs / 1000)}s`,
    result as unknown as Record<string, unknown>,
  );

  return result;
}
