import { domainMatchesBlockedList } from "./domain-blocklist";
import { shouldSkipPath } from "./crawler";

export const FAILED_CRAWL_EXCLUDED_LEAD_TYPES = new Set([
  "directory",
  "media",
  "dataset",
  "stats_platform",
  "feed",
  "utility",
  "platform",
]);

export const FAILED_CRAWL_NON_TARGET_SUBDOMAIN_PATTERN =
  "^(blog|blogs|news|feed|feeds|rss|atom|docs|documentation|community|forum|forums|jobs|careers)\\.";

export const FAILED_CRAWL_NON_TARGET_PATH_PATTERN =
  "(^|/)(feed|feeds|rss|archive|archives|search|jobs|job|careers|career|vacancy|vacancies|recruitment|list|rankings|compare|alternatives|reviews)(/|$|[._?#-])|(^|/)(top[-_0-9]|best[-_]|[0-9]+-(top|best))";

const nonTargetSubdomain = new RegExp(FAILED_CRAWL_NON_TARGET_SUBDOMAIN_PATTERN, "i");
const nonTargetPath = new RegExp(FAILED_CRAWL_NON_TARGET_PATH_PATTERN, "i");

export function normalizeFailedCrawlPage(
  limitValue: unknown,
  offsetValue: unknown,
): { limit: number; offset: number } {
  const parsedLimit = Number(limitValue);
  const parsedOffset = Number(offsetValue);
  return {
    limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 200) : 50,
    offset: Number.isFinite(parsedOffset) ? Math.max(Math.trunc(parsedOffset), 0) : 0,
  };
}

export interface FailedCrawlCandidate {
  crawlStatus: string | null;
  crawlError: string | null;
  rootDomain: string;
  websiteUrl: string;
  leadType: string | null;
  sourceType: string | null;
  hasCrawlLog: boolean;
  excludedSourceRecord?: boolean;
}

export function isNonTargetFailedCrawlUrl(rootDomain: string, websiteUrl: string): boolean {
  const normalizedDomain = rootDomain.trim().toLowerCase().replace(/^www\./, "");
  if (nonTargetSubdomain.test(normalizedDomain)) return true;

  try {
    const url = new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`);
    return shouldSkipPath(url.pathname) || nonTargetPath.test(url.pathname);
  } catch {
    return true;
  }
}

export function isGenuineFailedCrawl(
  candidate: FailedCrawlCandidate,
  blockedDomains: Set<string>,
): boolean {
  if (candidate.crawlStatus !== "failed") return false;
  if (!candidate.crawlError?.trim() || !candidate.hasCrawlLog) return false;
  if (domainMatchesBlockedList(candidate.rootDomain, blockedDomains)) return false;
  if (FAILED_CRAWL_EXCLUDED_LEAD_TYPES.has(candidate.leadType ?? "")) return false;
  if (candidate.excludedSourceRecord) return false;
  if (isNonTargetFailedCrawlUrl(candidate.rootDomain, candidate.websiteUrl)) return false;
  return true;
}
