import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SEARCH_QUERY = "egocentric data company in USA";
const OUTPUT_DIR = path.resolve("output");
const CSV_PATH = path.join(OUTPUT_DIR, "test_leads.csv");
const LOG_PATH = path.join(OUTPUT_DIR, "test_log.txt");

const SKIP_DOMAINS = new Set([
  "google.com", "youtube.com", "facebook.com", "linkedin.com",
  "twitter.com", "x.com", "instagram.com", "wikipedia.org",
  "reddit.com", "medium.com", "github.com",
]);

const CRAWL_PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us"];
const FETCH_TIMEOUT_MS = 10_000;

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;

const logLines: string[] = [];

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function extractRootDomain(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.hostname.replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch {
    return null;
  }
}

function isSkippedDomain(domain: string): boolean {
  return SKIP_DOMAINS.has(domain);
}

function uniqueMatches(text: string, re: RegExp): string[] {
  const matches = text.match(re) ?? [];
  return [...new Set(matches)];
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadScraperBot/1.0; +https://example.com)",
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

interface Lead {
  company: string;
  website: string;
  rootDomain: string;
  emails: string;
  phones: string;
  sourceUrl: string;
  crawlStatus: string;
}

async function crawlDomain(
  domain: string,
  sourceUrl: string
): Promise<Lead> {
  log(`\nCrawling domain: ${domain}`);

  const allEmails = new Set<string>();
  const allPhones = new Set<string>();
  let companyName = domain;
  let crawledPages = 0;

  for (const p of CRAWL_PATHS) {
    const url = `https://${domain}${p}`;
    log(`  → Fetching ${url}`);
    const html = await fetchPage(url);
    if (!html) continue;

    crawledPages++;
    const $ = cheerio.load(html);

    if (p === "/" || companyName === domain) {
      const title = $("title").first().text().trim();
      if (title) companyName = title.split(/[|\-–]/)[0].trim();
    }

    const text = $.text();
    uniqueMatches(text, EMAIL_RE).forEach((e) => allEmails.add(e));
    uniqueMatches(text, PHONE_RE).forEach((ph) => allPhones.add(ph));

    const metaDesc =
      $('meta[name="description"]').attr("content") ?? "";
    uniqueMatches(metaDesc, EMAIL_RE).forEach((e) => allEmails.add(e));

    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const addr = href.replace(/^mailto:/i, "").split("?")[0].trim();
      if (addr) allEmails.add(addr);
    });

    $("a[href^='tel:']").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const num = href.replace(/^tel:/i, "").trim();
      if (num) allPhones.add(num);
    });
  }

  const crawlStatus =
    crawledPages > 0 ? `crawled ${crawledPages} page(s)` : "all pages failed";

  log(`  Company: ${companyName}`);
  log(`  Emails: ${[...allEmails].join(", ") || "none"}`);
  log(`  Phones: ${[...allPhones].join(", ") || "none"}`);
  log(`  Status: ${crawlStatus}`);

  return {
    company: companyName,
    website: `https://${domain}`,
    rootDomain: domain,
    emails: [...allEmails].join("; "),
    phones: [...allPhones].join("; "),
    sourceUrl,
    crawlStatus,
  };
}

function escapeCsv(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function writeCsv(leads: Lead[]) {
  const headers = [
    "company",
    "website",
    "root_domain",
    "emails",
    "phone_numbers",
    "source_url",
    "crawl_status",
  ];
  const rows = leads.map((l) =>
    [
      l.company,
      l.website,
      l.rootDomain,
      l.emails,
      l.phones,
      l.sourceUrl,
      l.crawlStatus,
    ]
      .map(escapeCsv)
      .join(",")
  );
  fs.writeFileSync(CSV_PATH, [headers.join(","), ...rows].join("\n"), "utf8");
}

async function searchGoogle(): Promise<Array<{ url: string; title: string }>> {
  const endpoint = "https://www.googleapis.com/customsearch/v1";
  const params = {
    key: GOOGLE_SEARCH_API_KEY,
    cx: GOOGLE_SEARCH_ENGINE_ID,
    q: SEARCH_QUERY,
    num: 10,
  };

  log(`Calling Google Custom Search API for: "${SEARCH_QUERY}"`);
  try {
    const res = await axios.get(endpoint, { params, timeout: 15_000 });
    const items: Array<{ link: string; title: string }> = res.data.items ?? [];
    log(`Google API returned ${items.length} result(s)`);
    return items.map((i) => ({ url: i.link, title: i.title }));
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      log(`Google API error: HTTP ${err.response.status}`);
      log(`Response body: ${JSON.stringify(err.response.data)}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Google API request failed: ${msg}`);
    }
    return [];
  }
}

async function main() {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
    console.error(
      "ERROR: GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables must be set."
    );
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  log("=== Lead Discovery POC ===");
  log(`Query: ${SEARCH_QUERY}`);

  const results = await searchGoogle();
  log(`\nSearch results found: ${results.length}`);

  const seenDomains = new Set<string>();
  const domainToSource: Map<string, string> = new Map();

  for (const r of results) {
    const domain = extractRootDomain(r.url);
    if (!domain) {
      log(`Skipping (could not parse domain): ${r.url}`);
      continue;
    }
    if (isSkippedDomain(domain)) {
      log(`Skipping blocklisted domain: ${domain}`);
      continue;
    }
    if (seenDomains.has(domain)) {
      log(`Skipping duplicate domain: ${domain}`);
      continue;
    }
    seenDomains.add(domain);
    domainToSource.set(domain, r.url);
  }

  const uniqueDomains = [...seenDomains];
  log(`\nUnique company domains to crawl: ${uniqueDomains.length}`);
  uniqueDomains.forEach((d) => log(`  • ${d}`));

  const leads: Lead[] = [];
  let crawledCount = 0;

  for (const domain of uniqueDomains) {
    const sourceUrl = domainToSource.get(domain)!;
    const lead = await crawlDomain(domain, sourceUrl);
    leads.push(lead);
    crawledCount++;
  }

  writeCsv(leads);
  fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n", "utf8");

  console.log("\n========== REPORT ==========");
  console.log(`Search results found:    ${results.length}`);
  console.log(`Unique domains:          ${uniqueDomains.length}`);
  console.log(`Websites crawled:        ${crawledCount}`);
  console.log(`Leads saved:             ${leads.length}`);
  console.log(`CSV path:                ${CSV_PATH}`);
  console.log(`Log path:                ${LOG_PATH}`);

  const failed = leads.filter((l) => l.crawlStatus === "all pages failed");
  if (failed.length > 0) {
    console.log(`\nDomains with crawl failures (${failed.length}):`);
    failed.forEach((l) => console.log(`  • ${l.rootDomain}`));
  }
  console.log("=============================\n");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
