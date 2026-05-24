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
  outreachQueueTable,
  emailAccountsTable,
  campaignEmailAccountsTable,
  appSettingsTable,
  logsTable,
  searchQueryHistoryTable,
  searchResultHistoryTable,
  discoverySourceHistoryTable,
} from "@workspace/db";
import { eq, and, or, sql, desc, isNull, like } from "drizzle-orm";
import { searchSerper, extractRootDomain } from "../services/serper";
import { getSerperApiKey } from "../services/serper-key";
import { crawlWebsite, extractCompanyLinksFromPage } from "../services/crawler";
import { classifyLeadType } from "../services/lead-classifier";
import { scoreLead } from "../services/scorer";
import nodemailer from "nodemailer";
import { isEncrypted, decrypt } from "../lib/crypto";
import { logger } from "../lib/logger";
import { appendUnsubscribeFooter, toHtmlEmail, toTextEmail } from "../services/email-html";
import { domainMatchesBlockedList, parseBlockedDomains, normalizeDomainToken } from "../services/domain-blocklist";

// ── Cancellation registry ─────────────────────────────────────────────────

const cancelledRuns = new Set<number>();

/** Signal the pipeline to stop at the next safe checkpoint. */
export function requestCancellation(runId: number): void {
  cancelledRuns.add(runId);
}

/** Clear the cancellation flag once the pipeline has acknowledged it. */
export function clearCancellation(runId: number | undefined | null): void {
  if (runId != null) cancelledRuns.delete(runId);
}

function isCancelled(runId: number | undefined | null): boolean {
  return runId != null && cancelledRuns.has(runId);
}

function fromHeader(account: typeof emailAccountsTable.$inferSelect): string {
  const address = account.email || account.smtpUser;
  const displayName = account.senderName?.trim() || address;
  return `"${displayName.replace(/"/g, '\\"')}" <${address}>`;
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
  /** When true, skip the discovery step entirely (used when resuming a failed run). */
  skipDiscovery?: boolean;
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

/** TLD patterns for government / education / research institutions. */
const JUNK_TLD_PATTERN = /\.(gov|edu|ac\.uk|ac\.jp|edu\.au|gov\.uk|gov\.au|ac\.nz|edu\.nz|gc\.ca)$/i;

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

  // Government / education TLDs
  if (JUNK_TLD_PATTERN.test(domainLower)) {
    return { cls: "blocked", reason: "Government or education domain" };
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
    if (isCancelled(campaignRunId)) break;
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
      .where(eq(campaignRunsTable.id, campaignRunId));
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

  const apiKey = await getSerperApiKey();
  if (!apiKey) {
    stats.missingSerperKey = true;
    errors.push(
      "Serper API key not configured — skipping discovery. Add it in Settings → Search API Settings or set SERPER_API_KEY environment variable.",
    );
    return stats;
  }

  const keywords = await db
    .select()
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaign.id));

  const countries = await db
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

  const blockedDomains = parseBlockedDomains(blockedSetting?.value);

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

      if (!options.forceDiscoveryRefresh && qhRecord?.nextRefreshAt && qhRecord.nextRefreshAt > now) {
        stats.searchesSkipped++;
        await schedulerLog(campaign.id, `Query skipped (recently searched): "${query}"`, {
          nextRefreshAt: qhRecord.nextRefreshAt.toISOString(),
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

          if (dshRecord?.nextRefreshAt && dshRecord.nextRefreshAt > now) {
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
): Promise<number> {
  let crawledCount = 0;
  while (true) {
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

    for (const lead of uncrawled) {
      try {
        await db.update(leadsTable)
          .set({ crawlStatus: "crawling", crawlError: null })
          .where(eq(leadsTable.id, lead.id));

        // Hard per-lead deadline: 7 pages × 15 s each + some buffer = 120 s max.
        // Without this, a single site that hangs at the TCP/body level could
        // block the entire crawl batch indefinitely.
        const LEAD_TIMEOUT_MS = 120_000;
        const data = await Promise.race([
          crawlWebsite(lead.websiteUrl, lead.rootDomain),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Crawl timed out after ${LEAD_TIMEOUT_MS / 1000}s`)), LEAD_TIMEOUT_MS),
          ),
        ]);
        const ok = data.pagesSucceeded > 0;
        const updates: Record<string, unknown> = {
          crawlStatus: ok ? "crawled" : "failed",
          crawlError: ok ? null : "No pages returned content",
          rawText: data.rawText || null,
        };
        if (ok) {
          if (data.companyName) updates.companyName = data.companyName;
          if (data.emails) updates.emails = data.emails;
          if (data.emailDomainStatus) updates.emailDomainStatus = data.emailDomainStatus;
          if (data.phoneNumbers) updates.phoneNumbers = data.phoneNumbers;
          if (data.address) updates.address = data.address;
          if (data.country) updates.country = data.country;
          if (data.linkedinUrl) updates.linkedinUrl = data.linkedinUrl;
        }
        await db.update(leadsTable).set(updates).where(eq(leadsTable.id, lead.id));
        if (ok) crawledCount++;
        else {
          const message = `Crawl failed ${lead.rootDomain}: No pages returned content`;
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
        const message = `Crawl failed ${lead.rootDomain}: ${msg}`;
        errors.push(message);
        await db.update(leadsTable)
          .set({ crawlStatus: "failed", crawlError: msg.slice(0, 500) })
          .where(eq(leadsTable.id, lead.id));
        await schedulerLog(campaign.id, message, {
          campaignRunId,
          leadId: lead.id,
          rootDomain: lead.rootDomain,
          websiteUrl: lead.websiteUrl,
        });
      }
    }

    if (campaignRunId == null) break;
  }

  await schedulerLog(campaign.id, `Crawl complete: ${crawledCount} succeeded`);
  return crawledCount;
}

// ── Step 3: Score ───────────────────────────────────────────────────────────

async function runScore(
  campaign: typeof campaignsTable.$inferSelect,
  errors: string[],
  campaignRunId?: number,
): Promise<{ scoredCount: number; failedCount: number }> {
  const keywords = await db
    .select({ keyword: campaignKeywordsTable.keyword })
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaign.id));

  const keywordList = keywords.map((k) => k.keyword);
  let scoredCount = 0;
  let failedCount = 0;

  while (true) {
    const conditions = [
      eq(leadsTable.campaignId, campaign.id),
      eq(leadsTable.crawlStatus, "crawled"),
      or(
        isNull(leadsTable.scoringMethod),
        like(leadsTable.scoringMethod, "failed%"),
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
        });

        const failed = result.score == null;
        const reviewStatus =
          !failed && result.score !== null && result.score < campaign.minRelevanceScore
            ? "low_relevance"
            : lead.reviewStatus;

        await db.update(leadsTable)
          .set({
            relevanceScore: result.score,
            relevanceReason: result.reason,
            scoringMethod: result.scoringMethod,
            reviewStatus,
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
    .limit(await (async () => {
      const [s] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "global_max_emails_per_day"));
      return parseInt(s?.value ?? String(campaign.maxEmailsPerDay ?? 20), 10);
    })());

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
  const [globalEmailSetting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "global_max_emails_per_day"));
  const globalMaxEmailsPerDay = parseInt(globalEmailSetting?.value ?? String(campaign.maxEmailsPerDay ?? 20), 10);

  for (const lead of eligibleLeads) {
    if (accountSentToday >= account.dailySendLimit) break;
    if (emailsSent >= globalMaxEmailsPerDay) break;

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

    const fullBody = appendUnsubscribeFooter(body, campaign.unsubscribeFooter);

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
        from: fromHeader(account),
        to: recipientEmail,
        subject,
        text: toTextEmail(fullBody),
        html: toHtmlEmail(fullBody),
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
    pendingCrawlCount: leads.filter((lead) => lead.crawlStatus === "pending" || lead.crawlStatus === "crawling").length,
    crawlFailedCount: leads.filter((lead) => lead.crawlStatus === "failed").length,
    pendingScoreCount: leads.filter((lead) => lead.crawlStatus === "crawled" && !lead.scoringMethod).length,
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

  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  const existing = Array.from(parseBlockedDomains(blockedSetting?.value));

  const blockedDomains = new Set(existing);
  const addedDomains: string[] = [];
  for (const domain of lowScoreDomains) {
    if (!blockedDomains.has(domain)) {
      blockedDomains.add(domain);
      addedDomains.push(domain);
    }
  }

  if (addedDomains.length === 0) return 0;

  const nextValue = Array.from(blockedDomains).join("\n");
  await db
    .insert(appSettingsTable)
    .values({ key: "blocked_domains", value: nextValue })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: nextValue, updatedAt: new Date() },
    });

  await schedulerLog(
    campaign.id,
    `Auto-blocked ${addedDomains.length} low-relevance domain${addedDomains.length !== 1 ? "s" : ""}`,
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

  await schedulerLog(campaignId, `Pipeline started for campaign "${campaign.name}"${options.skipDiscovery ? " (resuming — skipping discovery)" : ""}`);
  await setStage(campaignRunId, "searching");

  try {
    if (options.skipDiscovery) {
      await schedulerLog(campaignId, "Discovery skipped (resume mode)");
    } else {
      const discoveryStats = await runDiscovery(campaign, errors, campaignRunId, options);
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

  if (isCancelled(campaignRunId)) {
    clearCancellation(campaignRunId);
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  await setStage(campaignRunId, "crawling");
  try {
    result.crawledCount = await runCrawl(campaign, errors, campaignRunId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Crawl failed: ${msg}`);
    result.failed++;
    logger.error({ err, campaignId }, "Scheduler: crawl step failed");
  }

  await setStage(campaignRunId, "scoring");
  try {
    const scoreStats = await runScore(campaign, errors, campaignRunId);
    result.scoredCount = scoreStats.scoredCount;
    result.failed += scoreStats.failedCount;
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
  const processingState = await getProcessingState(campaignId, campaignRunId);
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
  if (result.scoredCount > 0 && processingState.pendingCrawlCount === 0 && processingState.pendingScoreCount === 0) {
    result.autoBlockedLowScoreCount = await autoBlockLowRelevanceDomains(campaign, campaignRunId);
  }

  await schedulerLog(
    campaignId,
    `Pipeline complete: ${result.discoveryLeadsCreated} discovered, ${result.crawledCount} crawled, ${result.scoredCount} scored, ${result.emailsSent} emailed in ${Math.round(result.durationMs / 1000)}s`,
    result as unknown as Record<string, unknown>,
  );

  return result;
}
