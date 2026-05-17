import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SEARCH_QUERY = "computer vision company in USA";
const OUTPUT_DIR = path.resolve("output");
const CSV_PATH = path.join(OUTPUT_DIR, "test_leads_v2.csv");
const LOG_PATH = path.join(OUTPUT_DIR, "test_log_v2.txt");

const SKIP_DOMAINS = new Set([
  "google.com", "youtube.com", "facebook.com", "linkedin.com",
  "twitter.com", "x.com", "instagram.com", "wikipedia.org",
  "reddit.com", "medium.com", "github.com", "crunchbase.com",
  "glassdoor.com", "yelp.com", "clutch.co", "g2.com", "techcrunch.com",
  "forbes.com", "bloomberg.com", "businessinsider.com",
]);

const CRAWL_PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us"];
const FETCH_TIMEOUT_MS = 12_000;

// ─── Email extraction ──────────────────────────────────────────────────────────
// Strict RFC-style: local@domain.tld — no surrounding junk
const EMAIL_RE = /(?<![^\s,;<>(\[])([a-zA-Z0-9][a-zA-Z0-9._%+\-]{0,62}@[a-zA-Z0-9][a-zA-Z0-9.\-]{0,253}\.[a-zA-Z]{2,})(?![^\s,;>)\]])/g;

// TLDs we trust; anything else is likely a false positive
const VALID_TLDS = new Set([
  "com","net","org","io","ai","co","us","uk","ca","de","fr","in","tech",
  "app","dev","info","biz","edu","gov","me","tv","vc","agency","studio",
]);

// Invalid patterns that indicate a broken/concatenated email
const BROKEN_EMAIL_RE = /(\d{7,}|copyright|cookie|privacy|policy|terms|example|test|noreply|no-reply|\.png|\.jpg|\.svg|\.gif|\.css|\.js)/i;

function cleanEmails(raw: Set<string>): string[] {
  const out = new Set<string>();
  for (const e of raw) {
    const cleaned = e.toLowerCase().trim();
    // Must contain exactly one @
    if ((cleaned.match(/@/g) ?? []).length !== 1) continue;
    const [local, domain] = cleaned.split("@");
    if (!local || !domain) continue;
    // Local part: 1-64 chars, no leading/trailing dots
    if (local.length < 1 || local.length > 64) continue;
    if (local.startsWith(".") || local.endsWith(".")) continue;
    // Domain must have at least one dot
    const domainParts = domain.split(".");
    if (domainParts.length < 2) continue;
    const tld = domainParts[domainParts.length - 1];
    // TLD: 2-10 chars, letters only
    if (!/^[a-z]{2,10}$/.test(tld)) continue;
    // Prefer known TLDs; reject unknowns longer than 6 chars (likely garbage)
    if (tld.length > 6 && !VALID_TLDS.has(tld)) continue;
    // Reject broken patterns
    if (BROKEN_EMAIL_RE.test(cleaned)) continue;
    // Reject if domain part has no real letters (all numbers)
    if (/^\d+$/.test(domainParts[0])) continue;
    out.add(cleaned);
  }
  return [...out].sort();
}

// ─── Phone extraction ──────────────────────────────────────────────────────────
// Only match internationally plausible phone numbers.
// Patterns: +1 (555) 123-4567 | +44 20 7946 0958 | (800) 555-0199 | etc.
// Must have at least 10 digits total.
const PHONE_PATTERNS = [
  // E.164 international: +[country][number], 7-15 digits total
  /\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}(?:[\s\-.]?\d{1,4})?/g,
  // US/CA: (NXX) NXX-XXXX or NXX-NXX-XXXX or NXX.NXX.XXXX
  /(?:\+?1[\s\-.]?)?\(?[2-9]\d{2}\)?[\s\-.]?[2-9]\d{2}[\s\-.]?\d{4}/g,
];

// Patterns that should be rejected even if they look like phones
const FAKE_PHONE_RE = /(\d+\.\d+\.\d+|\d{13,}|^0{3,}|version|id:|px|em|rgb|#[0-9a-f]{6})/i;

function extractPhonesFromText(text: string): Set<string> {
  const found = new Set<string>();
  for (const re of PHONE_PATTERNS) {
    const reCopy = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = reCopy.exec(text)) !== null) {
      const raw = m[0].trim();
      const digitsOnly = raw.replace(/\D/g, "");
      // Must have 10-15 digits
      if (digitsOnly.length < 10 || digitsOnly.length > 15) continue;
      // Reject fake patterns
      if (FAKE_PHONE_RE.test(raw)) continue;
      // US numbers: first digit of area code must be 2-9
      if (digitsOnly.length === 10 && /^[01]/.test(digitsOnly)) continue;
      // Reject if it's clearly a decimal number (e.g. 139.6379639)
      if (/^\d+\.\d+$/.test(raw)) continue;
      found.add(normalizePhone(raw));
    }
  }
  return found;
}

function normalizePhone(phone: string): string {
  // Collapse multiple spaces/dashes into single dash for readability
  return phone.trim().replace(/[\s]+/g, " ");
}

function cleanPhones(all: Set<string>): string[] {
  // Deduplicate by digit-only fingerprint
  const seen = new Map<string, string>();
  for (const p of all) {
    const digits = p.replace(/\D/g, "");
    if (!seen.has(digits)) seen.set(digits, p);
  }
  return [...seen.values()].sort();
}

// ─── Country extraction ────────────────────────────────────────────────────────
const COUNTRY_PHONE_PREFIXES: Record<string, string> = {
  "+1": "USA",
  "+44": "UK",
  "+49": "Germany",
  "+33": "France",
  "+91": "India",
  "+86": "China",
  "+81": "Japan",
  "+61": "Australia",
  "+55": "Brazil",
  "+7": "Russia",
  "+82": "South Korea",
  "+65": "Singapore",
  "+971": "UAE",
  "+972": "Israel",
  "+41": "Switzerland",
  "+31": "Netherlands",
  "+46": "Sweden",
  "+47": "Norway",
  "+45": "Denmark",
  "+358": "Finland",
};

const US_STATE_RE = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|[A-Z]{2}\s+\d{5})\b/i;

function extractCountry(
  allText: string,
  phones: Set<string>
): string {
  // 1. US state/zip mention
  if (US_STATE_RE.test(allText)) return "USA";

  // 2. Explicit country mention
  const countryKeywords: [RegExp, string][] = [
    [/\bUnited States\b/i, "USA"],
    [/\bU\.S\.A\.?\b/i, "USA"],
    [/\bUSA\b/, "USA"],
    [/\bUnited Kingdom\b/i, "UK"],
    [/\bU\.K\.?\b/i, "UK"],
    [/\bCanada\b/i, "Canada"],
    [/\bAustralia\b/i, "Australia"],
    [/\bGermany\b/i, "Germany"],
    [/\bFrance\b/i, "France"],
    [/\bIndia\b/i, "India"],
    [/\bChina\b/i, "China"],
    [/\bJapan\b/i, "Japan"],
    [/\bSingapore\b/i, "Singapore"],
    [/\bIsrael\b/i, "Israel"],
  ];
  for (const [re, name] of countryKeywords) {
    if (re.test(allText)) return name;
  }

  // 3. Phone country code
  for (const phone of phones) {
    for (const [prefix, country] of Object.entries(COUNTRY_PHONE_PREFIXES)) {
      if (phone.startsWith(prefix)) return country;
    }
  }

  return "unknown";
}

// ─── Company name cleanup ──────────────────────────────────────────────────────
function cleanCompanyName($: cheerio.CheerioAPI, domain: string): string {
  // 1. JSON-LD Organization schema
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() ?? "");
      const entries = Array.isArray(json) ? json : [json];
      for (const entry of entries) {
        if (
          entry["@type"] === "Organization" ||
          entry["@type"] === "Corporation" ||
          entry["@type"] === "LocalBusiness"
        ) {
          const name = entry.name?.trim();
          if (name && name.length < 60) return name;
        }
      }
    } catch {}
  });

  // 2. OpenGraph site name
  const ogSite = $('meta[property="og:site_name"]').attr("content")?.trim();
  if (ogSite && ogSite.length < 60) return ogSite;

  // 3. Logo alt text
  const logoAlt = $('img[alt][src*="logo"]').first().attr("alt")?.trim();
  if (logoAlt && logoAlt.length > 1 && logoAlt.length < 50) return logoAlt;

  // 4. Title tag — take first segment, strip marketing noise
  const title = $("title").first().text().trim();
  if (title) {
    const segment = title.split(/[|\-–:,]/)[0].trim();
    // Reject if it's obviously a tagline (too many words)
    if (segment.split(" ").length <= 5 && segment.length < 60) return segment;
  }

  // 5. Fallback: capitalize domain name
  return domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Logger ───────────────────────────────────────────────────────────────────
const logLines: string[] = [];
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

// ─── Domain utilities ─────────────────────────────────────────────────────────
function extractRootDomain(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.hostname.replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch {
    return null;
  }
}

// ─── Fetch page ───────────────────────────────────────────────────────────────
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });
    if (typeof res.data === "string") return res.data;
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  FETCH FAILED [${url}]: ${msg}`);
    return null;
  }
}

// ─── Lead interface ───────────────────────────────────────────────────────────
interface Lead {
  companyName: string;
  websiteUrl: string;
  rootDomain: string;
  country: string;
  emails: string;
  phoneNumbers: string;
  crawlStatus: string;
}

// ─── Crawl domain ─────────────────────────────────────────────────────────────
async function crawlDomain(domain: string): Promise<Lead> {
  log(`\nCrawling: ${domain}`);

  const rawEmails = new Set<string>();
  const rawPhones = new Set<string>();
  let companyName = "";
  let countryText = "";
  let crawledPages = 0;
  let firstPage$: cheerio.CheerioAPI | null = null;

  for (const p of CRAWL_PATHS) {
    const url = `https://${domain}${p}`;
    log(`  → ${url}`);
    const html = await fetchPage(url);
    if (!html) continue;

    crawledPages++;
    const $ = cheerio.load(html);

    // Store first page for company name extraction
    if (p === "/" && !firstPage$) firstPage$ = $;

    // Extract company name from homepage
    if (p === "/" && !companyName) {
      companyName = cleanCompanyName($, domain);
    }

    // ── Emails: prefer mailto: links (highest precision) ──
    $("a[href^='mailto:'], a[href^='MAILTO:']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const addr = href.replace(/^mailto:/i, "").split("?")[0].trim();
      if (addr && addr.includes("@")) rawEmails.add(addr.toLowerCase());
    });

    // ── Emails: scan visible text with strict regex ──
    // Only scan contact/about pages for text-based extraction (too noisy on homepage)
    if (["/contact", "/contact-us", "/about", "/about-us"].includes(p)) {
      const bodyText = $("body").text();
      let m: RegExpExecArray | null;
      const re = new RegExp(EMAIL_RE.source, "gi");
      while ((m = re.exec(bodyText)) !== null) {
        rawEmails.add(m[1].toLowerCase());
      }
    }

    // ── Phones: prefer tel: links ──
    $("a[href^='tel:']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const num = href.replace(/^tel:/i, "").trim();
      if (num) rawPhones.add(num);
    });

    // ── Phones: scan footer and contact sections ──
    const scanSelectors =
      p === "/"
        ? ["footer", '[class*="footer"]', '[class*="contact"]']
        : ["body"];
    for (const sel of scanSelectors) {
      const sectionText = $(sel).text();
      if (sectionText) {
        extractPhonesFromText(sectionText).forEach((ph) => rawPhones.add(ph));
      }
    }

    // Accumulate text for country detection
    countryText += " " + $("body").text().substring(0, 3000);
  }

  const emails = cleanEmails(rawEmails);
  const phones = cleanPhones(rawPhones);
  const country = extractCountry(countryText, rawPhones);

  if (!companyName && firstPage$) {
    companyName = cleanCompanyName(firstPage$, domain);
  }
  if (!companyName) {
    companyName = domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const crawlStatus =
    crawledPages > 0 ? `crawled ${crawledPages} page(s)` : "all pages failed";

  log(`  Name:    ${companyName}`);
  log(`  Country: ${country}`);
  log(`  Emails:  ${emails.join(", ") || "none"}`);
  log(`  Phones:  ${phones.join(", ") || "none"}`);
  log(`  Status:  ${crawlStatus}`);

  return {
    companyName,
    websiteUrl: `https://${domain}`,
    rootDomain: domain,
    country,
    emails: emails.join("; "),
    phoneNumbers: phones.join("; "),
    crawlStatus,
  };
}

// ─── CSV writer ───────────────────────────────────────────────────────────────
function escapeCsv(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function writeCsv(leads: Lead[]) {
  const headers = [
    "company_name",
    "website_url",
    "root_domain",
    "country",
    "emails",
    "phone_numbers",
    "crawl_status",
  ];
  const rows = leads.map((l) =>
    [
      l.companyName,
      l.websiteUrl,
      l.rootDomain,
      l.country,
      l.emails,
      l.phoneNumbers,
      l.crawlStatus,
    ]
      .map(escapeCsv)
      .join(",")
  );
  fs.writeFileSync(CSV_PATH, [headers.join(","), ...rows].join("\n"), "utf8");
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function search(): Promise<Array<{ url: string; title: string }>> {
  log(`Calling Serper.dev for: "${SEARCH_QUERY}"`);
  try {
    const res = await axios.post(
      "https://google.serper.dev/search",
      { q: SEARCH_QUERY, num: 10, gl: "us" },
      {
        timeout: 15_000,
        headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      }
    );
    const items: Array<{ link: string; title: string }> = res.data.organic ?? [];
    log(`Serper returned ${items.length} result(s)`);
    return items.map((i) => ({ url: i.link, title: i.title }));
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      log(`Serper error: HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`);
    } else {
      log(`Serper request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SERPER_API_KEY) {
    console.error("ERROR: SERPER_API_KEY environment variable must be set.");
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  log("=== Lead Discovery v2 — Extraction Quality Test ===");
  log(`Query: ${SEARCH_QUERY}`);

  const results = await search();
  log(`\nSearch results: ${results.length}`);

  const seenDomains = new Set<string>();
  const domainQueue: string[] = [];

  for (const r of results) {
    const domain = extractRootDomain(r.url);
    if (!domain) { log(`Skip (bad URL): ${r.url}`); continue; }
    if (SKIP_DOMAINS.has(domain)) { log(`Skip (blocklist): ${domain}`); continue; }
    if (seenDomains.has(domain)) { log(`Skip (duplicate): ${domain}`); continue; }
    seenDomains.add(domain);
    domainQueue.push(domain);
  }

  log(`\nUnique domains to crawl: ${domainQueue.length}`);
  domainQueue.forEach((d) => log(`  • ${d}`));

  const leads: Lead[] = [];
  for (const domain of domainQueue) {
    const lead = await crawlDomain(domain);
    leads.push(lead);
  }

  writeCsv(leads);
  fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n", "utf8");

  // ── Report ──
  const withEmail = leads.filter((l) => l.emails.length > 0);
  const withPhone = leads.filter((l) => l.phoneNumbers.length > 0);
  const withCountry = leads.filter((l) => l.country !== "unknown");
  const failed = leads.filter((l) => l.crawlStatus === "all pages failed");

  console.log("\n========== EXTRACTION QUALITY REPORT ==========");
  console.log(`Query:                   ${SEARCH_QUERY}`);
  console.log(`Search results found:    ${results.length}`);
  console.log(`Unique domains:          ${domainQueue.length}`);
  console.log(`Domains crawled:         ${leads.length}`);
  console.log(`Leads with email:        ${withEmail.length}`);
  console.log(`Leads with phone:        ${withPhone.length}`);
  console.log(`Country detected:        ${withCountry.length}/${leads.length}`);
  console.log(`Failed crawls:           ${failed.length}`);
  console.log(`CSV:                     ${CSV_PATH}`);
  console.log(`Log:                     ${LOG_PATH}`);

  console.log("\n── Sample cleaned emails ──");
  withEmail.slice(0, 4).forEach((l) =>
    console.log(`  ${l.rootDomain}: ${l.emails}`)
  );

  console.log("\n── Sample cleaned phones ──");
  withPhone.slice(0, 4).forEach((l) =>
    console.log(`  ${l.rootDomain}: ${l.phoneNumbers}`)
  );

  console.log("\n── Country extraction ──");
  leads.forEach((l) => console.log(`  ${l.rootDomain}: ${l.country}`));

  console.log("==============================================\n");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
