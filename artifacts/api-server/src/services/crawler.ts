import * as cheerio from "cheerio";
import { isBadCompanyName, domainToCompanyName } from "./lead-classifier";

export interface CrawlData {
  companyName: string | null;
  emails: string | null;
  phoneNumbers: string | null;
  address: string | null;
  country: string | null;
  linkedinUrl: string | null;
  description: string | null;
  emailDomainStatus: string | null;
  rawText: string;
  pagesAttempted: number;
  pagesSucceeded: number;
}

const CRAWL_PAGES = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/company"];
const FETCH_TIMEOUT_MS = 15_000; // covers both headers + body

const SKIP_CRAWL_PATHS = [
  /\/blog\b/i, /\/blogs\b/i, /\/article/i, /\/news\b/i, /\/docs\b/i,
  /\/documentation/i, /\/paper/i, /\/dataset/i, /\/forum/i, /\/community/i,
  /\/tutorial/i, /\/post\//i, /\/tag\//i, /\/category\//i,
];

function shouldSkipPath(path: string): boolean {
  return SKIP_CRAWL_PATHS.some((pat) => pat.test(path));
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  // Keep the timer alive through the ENTIRE request (headers + body).
  // Clearing it before response.text() was the bug: a server that sent headers
  // quickly but then stalled on the body would hang forever.
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0; +https://leadgen.internal)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    // response.text() is now also guarded by the same abort signal
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Email extraction ───────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const NOISE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "pdf", "woff", "woff2",
  "ttf", "otf", "eot", "ico", "css", "js", "ts", "map", "json", "xml",
]);

const NOISE_PREFIXES = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon",
  "bounce", "bounces", "postmaster", "abuse", "spam", "support-noreply",
  "notifications", "notification", "automated",
]);

/** Domains that produce only placeholder/test/disposable emails. */
const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "yopmail.com", "yopmail.fr",
  "mailinator.com", "guerrillamail.com", "throwaway.email",
  "tempmail.com", "sharklasers.com", "trashmail.com",
  "guerrillamailblock.com", "fakeinbox.com", "dispostable.com",
]);

/** Local parts that signal a placeholder address. */
const PLACEHOLDER_LOCALS = new Set([
  "name", "your", "yourname", "test", "demo", "abc", "user", "sample",
  "example", "email", "address", "someone", "hello", "hi",
  "info2", "contact2", "placeholder",
]);

function isValidEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const parts = lower.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || local.length > 64) return false;
  if (domain.length === 0 || domain.length > 253) return false;
  const tld = domain.split(".").pop() ?? "";
  if (NOISE_EXTENSIONS.has(tld)) return false;
  if (local.includes("..")) return false;
  if (NOISE_PREFIXES.has(local)) return false;
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) return false;
  if (PLACEHOLDER_LOCALS.has(local)) return false;
  if (email.length > 80) return false;
  return true;
}

function extractEmails($: ReturnType<typeof cheerio.load>, rawHtml: string): string[] {
  const found = new Set<string>();

  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0]?.trim() ?? "";
    if (email && isValidEmail(email)) found.add(email.toLowerCase());
  });

  const matches = rawHtml.match(EMAIL_REGEX) ?? [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (isValidEmail(lower)) found.add(lower);
  }

  return [...found].slice(0, 10);
}

// ── Cross-domain email filtering ───────────────────────────────────────────

function filterEmailsByDomain(
  emails: string[],
  rootDomain: string,
): { emails: string[]; status: string } {
  if (emails.length === 0) return { emails: [], status: "none" };

  const matching: string[] = [];
  const external: string[] = [];

  for (const email of emails) {
    const atIdx = email.lastIndexOf("@");
    if (atIdx < 0) continue;
    const emailDomain = email.slice(atIdx + 1).toLowerCase();
    if (emailDomain === rootDomain || emailDomain.endsWith(`.${rootDomain}`)) {
      matching.push(email);
    } else {
      external.push(email);
    }
  }

  if (matching.length > 0 && external.length > 0) return { emails: matching, status: "mixed" };
  if (matching.length > 0) return { emails: matching, status: "matching_domain" };
  if (external.length > 0) return { emails: external, status: "external_domain" };
  return { emails: [], status: "none" };
}

// ── Phone extraction ───────────────────────────────────────────────────────

const PHONE_REGEX =
  /(?<!\d)(\+?\d{1,3}[\s.\-]?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\d)/g;

function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isLikelyPhone(digits: string): boolean {
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^(\d)\1{6,}$/.test(digits)) return false;
  if (/^\d{4,5}$/.test(digits)) return false;
  // Reject year-like 4-digit sequences (1900–2099)
  if (/^(19|20)\d{2}$/.test(digits)) return false;
  // Reject 6-digit sequences (short codes / partial IDs)
  if (digits.length === 6) return false;
  // Reject 8-digit sequences that look like calendar dates (YYYYMMDD)
  if (digits.length === 8 && /^(19|20)\d{2}(0[1-9]|1[0-2])/.test(digits)) return false;
  return true;
}

function extractPhones($: ReturnType<typeof cheerio.load>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const addPhone = (raw: string) => {
    const normalized = normalizePhone(raw);
    const digits = normalized.replace(/\D/g, "");
    if (!isLikelyPhone(digits)) return;
    if (seen.has(digits)) return;
    seen.add(digits);
    found.push(normalized);
  };

  $("a[href^='tel:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/tel:([\d\s\+\-\(\)\.]+)/i);
    if (match?.[1]) addPhone(match[1].trim());
  });

  const contactSections = $("footer, #contact, .contact, [class*='contact'], [class*='footer']");
  contactSections.each((_, section) => {
    const text = $(section).text();
    const matches = text.matchAll(PHONE_REGEX);
    for (const m of matches) addPhone(m[0]);
  });

  if (found.length === 0) {
    const bodyText = $("body").text();
    const matches = bodyText.matchAll(PHONE_REGEX);
    for (const m of matches) {
      addPhone(m[0]);
      if (found.length >= 5) break;
    }
  }

  return found.slice(0, 5);
}

// ── Company name extraction ────────────────────────────────────────────────

const MARKETING_WORDS = [
  /\b(best|leading|top|award.winning|premier|world.class|cutting.edge|innovative|trusted|#1|number one)\b/i,
];

const TITLE_NOISE_SUFFIXES = [/ [|–\-·•] .*/, / : .*/];

function cleanTitle(title: string): string {
  let cleaned = title.trim();
  for (const pattern of TITLE_NOISE_SUFFIXES) {
    cleaned = cleaned.replace(pattern, "").trim();
  }
  return cleaned;
}

function isMarketingText(text: string): boolean {
  return text.length > 35 && MARKETING_WORDS.some((re) => re.test(text));
}

function validateName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim();
  if (!n || n.length < 2 || n.length > 80) return null;
  if (isMarketingText(n)) return null;
  if (isBadCompanyName(n)) return null;
  return n;
}

function extractCompanyName($: ReturnType<typeof cheerio.load>): string | null {
  // 0. JSON-LD Organization schema — highest fidelity
  const ldScripts = $('script[type="application/ld+json"]').map((_, el) => $(el).html()).get();
  for (const jsonStr of ldScripts) {
    if (!jsonStr) continue;
    try {
      const data = JSON.parse(jsonStr) as unknown;
      const schemas = Array.isArray(data) ? data : [data];
      for (const s of schemas as Record<string, unknown>[]) {
        const type = s?.["@type"];
        const isOrg =
          type === "Organization" ||
          (Array.isArray(type) && (type as string[]).includes("Organization"));
        if (isOrg) {
          const name = validateName(typeof s?.name === "string" ? s.name : null);
          if (name) return name;
        }
      }
    } catch { /* invalid JSON-LD */ }
  }

  // 1. og:site_name — very reliable
  const ogSite = validateName($("meta[property='og:site_name']").attr("content"));
  if (ogSite) return ogSite;

  // 2. Title tag — clean it
  const rawTitle = $("title").first().text();
  if (rawTitle) {
    const name = validateName(cleanTitle(rawTitle));
    if (name) return name;
  }

  // 3. og:title as fallback
  const ogTitle = $("meta[property='og:title']").attr("content");
  if (ogTitle) {
    const name = validateName(cleanTitle(ogTitle));
    if (name) return name;
  }

  // 4. Footer copyright — e.g. "© 2024 Simform Solutions"
  const footerText = $("footer").text();
  const copyrightMatch = footerText.match(
    /©\s*(?:\d{4}[-–]\d{2,4}\s*)?(?:\d{4}\s+)?(.{2,60}?)(?:\.|,|All rights|Inc\b|LLC|Ltd)/i,
  );
  if (copyrightMatch?.[1]) {
    const name = validateName(copyrightMatch[1].trim().replace(/^by\s+/i, ""));
    if (name) return name;
  }

  // 5. Logo alt text — only if it passes the bad-name filter
  let logoName: string | null = null;
  $("img[class*='logo'], img[id*='logo'], a.logo img, header img").each((_, el) => {
    if (logoName) return;
    const alt = $(el).attr("alt")?.trim() ?? "";
    const name = validateName(alt);
    if (name) logoName = name;
  });
  if (logoName) return logoName;

  return null;
}

// ── LinkedIn extraction ────────────────────────────────────────────────────

function extractLinkedIn($: ReturnType<typeof cheerio.load>): string | null {
  let found: string | null = null;
  $("a[href*='linkedin.com/company/'], a[href*='linkedin.com/in/']").each((_, el) => {
    if (!found) {
      const href = $(el).attr("href") ?? "";
      if (href.includes("linkedin.com")) {
        found = href.split("?")[0] ?? href;
      }
    }
  });
  return found;
}

// ── Address / country extraction ───────────────────────────────────────────

const ADDRESS_SELECTORS = [
  "address", "[class*='address']", "[class*='location']",
  "[itemprop='address']", "[itemprop='streetAddress']",
];

const COUNTRY_HINTS: Record<string, string> = {
  "united states": "United States", " usa": "United States", " u.s.a": "United States",
  "united kingdom": "United Kingdom", " uk ": "United Kingdom",
  germany: "Germany", deutschland: "Germany", france: "France",
  canada: "Canada", australia: "Australia", netherlands: "Netherlands",
  "new zealand": "New Zealand", sweden: "Sweden", norway: "Norway",
  denmark: "Denmark", finland: "Finland", switzerland: "Switzerland",
  austria: "Austria", belgium: "Belgium", spain: "Spain",
  italy: "Italy", japan: "Japan", "south korea": "South Korea",
  india: "India", singapore: "Singapore", israel: "Israel",
};

function cleanAddress(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/:(?!\s)/g, ": ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function extractAddressAndCountry(
  $: ReturnType<typeof cheerio.load>,
): { address: string | null; country: string | null } {
  let address: string | null = null;
  let country: string | null = null;

  for (const sel of ADDRESS_SELECTORS) {
    const el = $(sel).first();
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 5 && text.length < 300) { address = cleanAddress(text); break; }
    }
  }

  const footerText = ($("footer").text() + " " + (address ?? "")).toLowerCase();
  for (const [hint, name] of Object.entries(COUNTRY_HINTS)) {
    if (footerText.includes(hint)) { country = name; break; }
  }

  return { address, country };
}

// ── Description extraction ─────────────────────────────────────────────────

function extractDescription($: ReturnType<typeof cheerio.load>): string | null {
  const ogDesc = $("meta[property='og:description']").attr("content");
  if (ogDesc && ogDesc.trim().length > 20) return ogDesc.trim().slice(0, 500);
  const metaDesc = $("meta[name='description']").attr("content");
  if (metaDesc && metaDesc.trim().length > 20) return metaDesc.trim().slice(0, 500);
  return null;
}

// ── Main crawl entry point ─────────────────────────────────────────────────

function buildPageUrls(baseUrl: string): string[] {
  try {
    const parsed = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`);
    const origin = `${parsed.protocol}//${parsed.host}`;
    return CRAWL_PAGES.map((p) => `${origin}${p}`);
  } catch { return []; }
}

function mergeField<T>(existing: T | null, incoming: T | null): T | null {
  return existing ?? incoming;
}

/**
 * Fetches a discovery-source page (listicle, directory) and extracts outbound
 * company website links — used by the pipeline to mine real company leads.
 */
export async function extractCompanyLinksFromPage(
  pageUrl: string,
  sourceRootDomain: string,
): Promise<{ href: string; rootDomain: string; anchorText: string }[]> {
  const html = await fetchPage(pageUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: { href: string; rootDomain: string; anchorText: string }[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("http")) return;
    try {
      const parsed = new URL(href);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      if (!host || host === sourceRootDomain || host.endsWith(`.${sourceRootDomain}`) || seen.has(host)) return;
      // Skip utility/feed/blog subdomains that are never real company sites
      if (/^(blog|feeds?|rss|atom|cdn|static|assets|support|help|docs|login|app|dashboard|status|api|dev|staging|mail|newsletter|careers|jobs|forum|community|wiki|portal)\./i.test(host)) return;
      // Skip known feed relay services
      if (host === "feedburner.com" || host.endsWith(".feedburner.com") || host === "feedproxy.google.com") return;
      const path = parsed.pathname.toLowerCase();
      if (/\.(css|js|png|jpg|jpeg|gif|svg|pdf|ico|woff|xml|json|zip|mp4|mp3)$/.test(path)) return;
      const socialish = ["facebook.com", "twitter.com", "x.com", "linkedin.com",
        "instagram.com", "youtube.com", "pinterest.com", "tiktok.com",
        "reddit.com", "github.com", "apple.com", "google.com", "microsoft.com"];
      if (socialish.some((s) => host === s || host.endsWith(`.${s}`))) return;
      seen.add(host);
      results.push({
        href: `https://${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
        rootDomain: host,
        anchorText: $(el).text().replace(/\s+/g, " ").trim().slice(0, 100),
      });
    } catch { /* invalid URL */ }
  });

  return results;
}

/**
 * Crawls a company website and extracts contact/company data.
 * @param websiteUrl  Full URL of the company website
 * @param rootDomain  The expected root domain — used to filter cross-domain emails
 */
export async function crawlWebsite(websiteUrl: string, rootDomain?: string): Promise<CrawlData> {
  const urls = buildPageUrls(websiteUrl);
  let pagesAttempted = 0;
  let pagesSucceeded = 0;

  let companyName: string | null = null;
  let emails: string[] = [];
  let phones: string[] = [];
  let address: string | null = null;
  let country: string | null = null;
  let linkedinUrl: string | null = null;
  let description: string | null = null;
  const rawTextParts: string[] = [];

  for (const url of urls) {
    try {
      const { pathname } = new URL(url);
      if (shouldSkipPath(pathname)) continue;
    } catch { /* keep going */ }

    pagesAttempted++;
    const html = await fetchPage(url);
    if (!html) continue;
    pagesSucceeded++;

    const $ = cheerio.load(html);
    $("script, style, noscript, head").remove();
    const pageText = $("body").text().replace(/\s+/g, " ").trim();
    rawTextParts.push(`[${url}]\n${pageText.slice(0, 3000)}`);

    companyName = mergeField(companyName, extractCompanyName($));
    const pageEmails = extractEmails($, html);
    emails = [...new Set([...emails, ...pageEmails])];
    const pagePhones = extractPhones($);
    phones = [...new Set([...phones, ...pagePhones])];
    address = mergeField(address, extractAddressAndCountry($).address);
    country = mergeField(country, extractAddressAndCountry($).country);
    linkedinUrl = mergeField(linkedinUrl, extractLinkedIn($));
    description = mergeField(description, extractDescription($));
  }

  // Domain-based fallback if no good company name was found
  const effectiveDomain = rootDomain ?? (() => {
    try {
      return new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`)
        .hostname.replace(/^www\./, "").toLowerCase();
    } catch { return websiteUrl; }
  })();

  if (!companyName || isBadCompanyName(companyName)) {
    companyName = domainToCompanyName(effectiveDomain);
  }

  // Filter emails by domain to prevent cross-domain leakage
  const { emails: filteredEmails, status: emailDomainStatus } = effectiveDomain
    ? filterEmailsByDomain(emails, effectiveDomain)
    : { emails, status: emails.length > 0 ? "matching_domain" : "none" };

  return {
    companyName,
    emails: filteredEmails.length > 0 ? filteredEmails.join(", ") : null,
    phoneNumbers: phones.length > 0 ? phones.join(", ") : null,
    address,
    country,
    linkedinUrl,
    description,
    emailDomainStatus: emailDomainStatus === "none" ? null : emailDomainStatus,
    rawText: rawTextParts.join("\n\n").slice(0, 50_000),
    pagesAttempted,
    pagesSucceeded,
  };
}
