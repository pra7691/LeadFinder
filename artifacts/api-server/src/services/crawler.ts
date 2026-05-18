import * as cheerio from "cheerio";

export interface CrawlData {
  companyName: string | null;
  emails: string | null;
  phoneNumbers: string | null;
  address: string | null;
  country: string | null;
  linkedinUrl: string | null;
  description: string | null;
  rawText: string;
  pagesAttempted: number;
  pagesSucceeded: number;
}

/**
 * Pages to crawl in priority order.
 * Homepage first (highest contact info density), then contact/about pages.
 * Explicitly avoids blog/doc/dataset paths.
 */
const CRAWL_PAGES = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/company"];
const FETCH_TIMEOUT_MS = 10_000;

/** Path patterns that indicate non-company content — skip these during crawl. */
const SKIP_CRAWL_PATHS = [
  /\/blog\b/i, /\/blogs\b/i, /\/article/i, /\/news\b/i, /\/docs\b/i,
  /\/documentation/i, /\/paper/i, /\/dataset/i, /\/forum/i, /\/community/i,
  /\/tutorial/i, /\/post\//i, /\/tag\//i, /\/category\//i,
];

function shouldSkipPath(path: string): boolean {
  for (const pat of SKIP_CRAWL_PATHS) {
    if (pat.test(path)) return true;
  }
  return false;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadBot/1.0; +https://leadgen.internal)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    return await response.text();
  } catch {
    return null;
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
  if (email.length > 80) return false;
  return true;
}

function extractEmails($: ReturnType<typeof cheerio.load>, rawHtml: string): string[] {
  const found = new Set<string>();

  // Also check mailto: href links — highest fidelity source
  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0]?.trim() ?? "";
    if (email && isValidEmail(email)) {
      found.add(email.toLowerCase());
    }
  });

  // Scan raw HTML for email patterns
  const matches = rawHtml.match(EMAIL_REGEX) ?? [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (isValidEmail(lower)) {
      found.add(lower);
    }
  }

  return [...found].slice(0, 10);
}

// ── Phone extraction ───────────────────────────────────────────────────────

// Matches E.164, North American, and European formats
const TEL_HREF_REGEX = /tel:([\d\s\+\-\(\)\.]{7,20})/gi;
const PHONE_REGEX =
  /(?<!\d)(\+?\d{1,3}[\s.\-]?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\d)/g;

function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isLikelyPhone(digits: string): boolean {
  // Must have 7–15 digits
  if (digits.length < 7 || digits.length > 15) return false;
  // Reject sequences that look like years, decimals, or IDs (all same digit)
  if (/^(\d)\1{6,}$/.test(digits)) return false;
  // Reject if it looks like a plain integer (zip code, ID, etc.)
  if (/^\d{5}$/.test(digits)) return false;
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

  // 1. tel: links — highest confidence
  $("a[href^='tel:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/tel:([\d\s\+\-\(\)\.]+)/i);
    if (match?.[1]) addPhone(match[1].trim());
  });

  // 2. Scan contact/footer areas specifically
  const contactSections = $("footer, #contact, .contact, [class*='contact'], [class*='footer']");
  contactSections.each((_, section) => {
    const text = $(section).text();
    const matches = text.matchAll(PHONE_REGEX);
    for (const m of matches) {
      addPhone(m[0]);
    }
  });

  // 3. Fallback: full page scan (capped)
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

const TITLE_NOISE_SUFFIXES = [
  / [|–\-·•] .*/,
  / : .*/,
];

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
          const name = typeof s?.name === "string" ? (s.name as string).trim() : null;
          if (name && name.length > 1 && name.length < 80 && !isMarketingText(name)) {
            return name;
          }
        }
      }
    } catch {
      // invalid JSON-LD
    }
  }

  // 1. og:site_name — very reliable
  const ogSite = $("meta[property='og:site_name']").attr("content");
  if (ogSite && ogSite.trim() && !isMarketingText(ogSite)) {
    return ogSite.trim();
  }

  // 2. Title tag — clean it
  const rawTitle = $("title").first().text();
  if (rawTitle) {
    const cleaned = cleanTitle(rawTitle);
    if (cleaned && cleaned.length > 1 && !isMarketingText(cleaned)) {
      return cleaned;
    }
  }

  // 3. og:title as fallback
  const ogTitle = $("meta[property='og:title']").attr("content");
  if (ogTitle) {
    const cleaned = cleanTitle(ogTitle);
    if (cleaned && cleaned.length > 1 && !isMarketingText(cleaned)) {
      return cleaned;
    }
  }

  // 4. Logo image alt text — brand logos often carry the company name
  let logoName: string | null = null;
  $("img[class*='logo'], img[id*='logo'], a.logo img, header img").each((_, el) => {
    if (logoName) return;
    const alt = $(el).attr("alt")?.trim() ?? "";
    if (alt && alt.length > 1 && alt.length < 60 && !isMarketingText(alt)) {
      logoName = alt;
    }
  });
  if (logoName) return logoName;

  // 5. Footer copyright — e.g. "© 2024 Simform Solutions"
  const footerText = $("footer").text();
  const copyrightMatch = footerText.match(
    /©\s*(?:\d{4}[-–]\d{2,4}\s*)?(?:\d{4}\s+)?(.{2,60}?)(?:\.|,|All rights|Inc\b|LLC|Ltd)/i,
  );
  if (copyrightMatch?.[1]) {
    const name = copyrightMatch[1].trim().replace(/^by\s+/i, "");
    if (name && name.length > 1 && name.length < 60 && !isMarketingText(name)) {
      return name;
    }
  }

  return null;
}

// ── LinkedIn extraction ────────────────────────────────────────────────────

function extractLinkedIn($: ReturnType<typeof cheerio.load>): string | null {
  let found: string | null = null;
  $("a[href*='linkedin.com/company/'], a[href*='linkedin.com/in/']").each(
    (_, el) => {
      if (!found) {
        const href = $(el).attr("href") ?? "";
        if (href.includes("linkedin.com")) {
          found = href.split("?")[0] ?? href;
        }
      }
    },
  );
  return found;
}

// ── Address / country extraction ───────────────────────────────────────────

const ADDRESS_SELECTORS = [
  "address",
  "[class*='address']",
  "[class*='location']",
  "[itemprop='address']",
  "[itemprop='streetAddress']",
];

const COUNTRY_HINTS: Record<string, string> = {
  "united states": "United States",
  " usa": "United States",
  " u.s.a": "United States",
  "united kingdom": "United Kingdom",
  " uk ": "United Kingdom",
  germany: "Germany",
  deutschland: "Germany",
  france: "France",
  canada: "Canada",
  australia: "Australia",
  netherlands: "Netherlands",
  "new zealand": "New Zealand",
  sweden: "Sweden",
  norway: "Norway",
  denmark: "Denmark",
  finland: "Finland",
  switzerland: "Switzerland",
  austria: "Austria",
  belgium: "Belgium",
  spain: "Spain",
  italy: "Italy",
  japan: "Japan",
  "south korea": "South Korea",
  india: "India",
  singapore: "Singapore",
  israel: "Israel",
};

function extractAddressAndCountry(
  $: ReturnType<typeof cheerio.load>,
): { address: string | null; country: string | null } {
  let address: string | null = null;
  let country: string | null = null;

  for (const sel of ADDRESS_SELECTORS) {
    const el = $(sel).first();
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 5 && text.length < 300) {
        address = text;
        break;
      }
    }
  }

  // Detect country from address or footer text
  const footerText = ($("footer").text() + " " + (address ?? "")).toLowerCase();
  for (const [hint, name] of Object.entries(COUNTRY_HINTS)) {
    if (footerText.includes(hint)) {
      country = name;
      break;
    }
  }

  return { address, country };
}

// ── Description extraction ─────────────────────────────────────────────────

function extractDescription($: ReturnType<typeof cheerio.load>): string | null {
  const ogDesc = $("meta[property='og:description']").attr("content");
  if (ogDesc && ogDesc.trim().length > 20) return ogDesc.trim().slice(0, 500);

  const metaDesc = $("meta[name='description']").attr("content");
  if (metaDesc && metaDesc.trim().length > 20)
    return metaDesc.trim().slice(0, 500);

  return null;
}

// ── Main crawl entry point ─────────────────────────────────────────────────

function buildPageUrls(baseUrl: string): string[] {
  try {
    const parsed = new URL(
      baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`,
    );
    const origin = `${parsed.protocol}//${parsed.host}`;
    return CRAWL_PAGES.map((p) => `${origin}${p}`);
  } catch {
    return [];
  }
}

function mergeField<T>(
  existing: T | null,
  incoming: T | null,
): T | null {
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
      if (!host || host === sourceRootDomain || seen.has(host)) return;

      // Skip static file extensions
      const path = parsed.pathname.toLowerCase();
      if (/\.(css|js|png|jpg|jpeg|gif|svg|pdf|ico|woff|xml|json|zip|mp4|mp3)$/.test(path)) return;

      // Skip social / utility platforms (quick check)
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
    } catch {
      // invalid URL
    }
  });

  return results;
}

export async function crawlWebsite(websiteUrl: string): Promise<CrawlData> {
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
    // Skip paths that look like blog/docs/dataset pages
    try {
      const { pathname } = new URL(url);
      if (shouldSkipPath(pathname)) continue;
    } catch { /* keep going */ }

    pagesAttempted++;
    const html = await fetchPage(url);
    if (!html) continue;
    pagesSucceeded++;

    const $ = cheerio.load(html);

    // Remove script/style noise for text extraction
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

  return {
    companyName: companyName,
    emails: emails.length > 0 ? emails.join(", ") : null,
    phoneNumbers: phones.length > 0 ? phones.join(", ") : null,
    address,
    country,
    linkedinUrl,
    description,
    rawText: rawTextParts.join("\n\n").slice(0, 50_000),
    pagesAttempted,
    pagesSucceeded,
  };
}
