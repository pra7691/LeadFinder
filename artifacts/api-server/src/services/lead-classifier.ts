/**
 * Lead type classifier — determines whether a domain is a real company or
 * a directory, media site, event page, dataset, research site, or stats platform.
 *
 * Also provides helpers for name validation and domain-to-brand conversion.
 * Used at discovery time, at scoring time, and by admin cleanup.
 */

export type LeadType =
  | "company"
  | "directory"
  | "media"
  | "event"
  | "dataset"
  | "research"
  | "stats_platform";

// ── Known-domain lookup tables ─────────────────────────────────────────────

const DIRECTORY_DOMAINS = new Set([
  "clutch.co", "goodfirms.co", "designrush.com", "themanifest.com",
  "businessofapps.com", "buildfire.com", "g2.com", "capterra.com",
  "softwareworld.co", "appdevelopmentcompanies.co", "topdevelopers.co",
  "selectedfirms.co", "techreviewer.co", "appfutura.com",
  "guru.com", "sortlist.com", "upcity.com", "expertise.com",
  "itfirms.co", "agencyspotter.com", "trustpilot.com", "yelp.com",
  "bark.com", "thumbtack.com", "toptal.com", "upwork.com", "fiverr.com",
  "appfrm.com", "topappfirms.com", "topappmakers.com",
]);

const STATS_PLATFORM_DOMAINS = new Set([
  "statista.com", "42matters.com", "data.ai", "appfigures.com",
  "sensortower.com", "sensor-tower.com", "apptopia.com",
  "appannie.com", "mobileaction.co", "similarweb.com",
]);

const DATASET_DOMAINS = new Set([
  "kaggle.com", "huggingface.co", "zenodo.org", "github.com",
  "gitlab.com", "paperswithcode.com", "dataverse.org",
  "data.world", "openml.org", "figshare.com",
]);

const RESEARCH_DOMAINS = new Set([
  "arxiv.org", "researchgate.net", "academia.edu",
  "semanticscholar.org", "pubmed.ncbi.nlm.nih.gov",
  "scholar.google.com", "ssrn.com", "acm.org",
  "ieee.org", "nature.com", "science.org",
]);

const MEDIA_DOMAINS = new Set([
  "techcrunch.com", "venturebeat.com", "wired.com",
  "forbes.com", "bloomberg.com", "reuters.com",
  "theverge.com", "engadget.com", "androidauthority.com",
  "9to5mac.com", "macrumors.com", "mashable.com",
  "businessinsider.com", "inc.com", "entrepreneur.com",
]);

// ── Pattern-based detection ────────────────────────────────────────────────

const EVENT_DOMAIN_PATTERNS = [
  /\b(summit|conference|conf|expo|meetup|congress|symposium|hackathon)\b/i,
];

const DIRECTORY_TITLE_PATTERNS = [
  /\btop\s+\d+\b/i,
  /\bbest\b.*\bcompan/i,
  /\bbest\b.*\bagenc/i,
  /\blist\s+of\b/i,
  /\branking/i,
  /\bdirector(y|ies)\b/i,
  /\bcompanies\s+in\b/i,
  /\bagencies\s+in\b/i,
  /\bin\s+20\d{2}\b/i,
  /\b\d+\s+(?:top|best)\b/i,
  /compare.*(?:company|tool|software)/i,
  /alternatives?\s+to\b/i,
];

const MEDIA_DOMAIN_PATTERNS = [
  /\b(news|blog|magazine|journal|newsletter|publication|media|press|daily|weekly)\b/i,
];

const DATASET_PATTERNS = [
  /\b(dataset|data.?set|open.?data|data.?repository)\b/i,
];

const RESEARCH_DOMAIN_PATTERNS = [
  /\b(research|academic|university|institute|laboratory|lab|proceedings)\b/i,
  /\.(edu|ac\.[a-z]{2})$/i,
];

// ── Company name validation ────────────────────────────────────────────────

const BAD_NAME_PATTERNS = [
  /\blogo\b/i,
  /\bicon\b/i,
  /\bheader\b/i,
  /\bfooter\b/i,
  /\bphone\b/i,
  /\bimage\b/i,
  /\.svg\b/i,
  /\.png\b/i,
  /\.jpg\b/i,
  /\.jpeg\b/i,
  /\bwhite\s+logo\b/i,
  /\bdark\s+logo\b/i,
  /\bcompressed\b/i,
  /\bsymbol\b/i,
  /\bconsumer\s+trends\b/i,
  /^react\b/i,
];

/**
 * Returns true if the string looks like a bad/artifact company name
 * (e.g. "Cubix Logo", "Header Interexy Logo", "Phone").
 */
export function isBadCompanyName(name: string): boolean {
  if (!name || name.trim().length === 0) return true;
  return BAD_NAME_PATTERNS.some((p) => p.test(name));
}

/**
 * Converts a root domain to a clean brand name.
 * cubix.co → Cubix
 * chelsea-apps.com → Chelsea Apps
 * topflightapps.com → Topflightapps (single word — kept as-is)
 */
export function domainToCompanyName(domain: string): string {
  // Strip TLD
  const withoutTld = domain.replace(/\.[a-z]{2,}(\.[a-z]{2})?$/, "");
  const parts = withoutTld.split(/[-_]/).filter((w) => w.length > 0);
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Main classifier ────────────────────────────────────────────────────────

/**
 * Classifies a lead domain as a company or a known non-company type.
 * @param domain  Root domain (e.g. "clutch.co")
 * @param title   Optional page title from search result — improves accuracy
 */
export function classifyLeadType(domain: string, title?: string | null): LeadType {
  const d = domain.toLowerCase();
  const text = (title ?? "").toLowerCase();

  // 1. Exact known-domain lookups (highest confidence)
  if (DIRECTORY_DOMAINS.has(d)) return "directory";
  if (STATS_PLATFORM_DOMAINS.has(d)) return "stats_platform";
  if (DATASET_DOMAINS.has(d)) return "dataset";
  if (RESEARCH_DOMAINS.has(d)) return "research";
  if (MEDIA_DOMAINS.has(d)) return "media";

  // 2. Domain pattern matching
  if (EVENT_DOMAIN_PATTERNS.some((p) => p.test(d))) return "event";
  if (MEDIA_DOMAIN_PATTERNS.some((p) => p.test(d))) return "media";
  if (RESEARCH_DOMAIN_PATTERNS.some((p) => p.test(d))) return "research";

  // 3. Title / description pattern matching
  if (DIRECTORY_TITLE_PATTERNS.some((p) => p.test(text))) return "directory";
  if (DATASET_PATTERNS.some((p) => p.test(d) || p.test(text))) return "dataset";

  return "company";
}

/**
 * Returns true if the lead type is eligible for outreach qualification.
 * Only "company" leads should be qualified and queued.
 */
export function isOutreachEligible(leadType: string | null | undefined): boolean {
  return !leadType || leadType === "company";
}

/**
 * Returns the maximum relevance score allowed for this lead type.
 * Company leads: 100. Non-company leads: capped at 30.
 */
export function maxRelevanceScore(leadType: string | null | undefined): number {
  return !leadType || leadType === "company" ? 100 : 30;
}
