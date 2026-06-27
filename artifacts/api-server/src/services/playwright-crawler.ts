import { chromium, type Browser } from "playwright";
import { crawlWebsiteWithLoader, type CrawlData, type CrawlOptions } from "./crawler";
import { classifyNetworkFailure } from "./crawl-failure-classifier";

const BROWSER_PAGE_TIMEOUT_MS = 30_000;

export class BrowserCrawlerSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserCrawlerSetupError";
  }
}

function isBrowserSetupFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /executable doesn't exist|browser was not found|playwright install|failed to launch/i.test(message);
}

export async function crawlWebsiteWithPlaywright(
  websiteUrl: string,
  rootDomain?: string,
  options?: CrawlOptions,
): Promise<CrawlData> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; LeadBot/1.0; +https://leadgen.internal)",
    });
    const page = await context.newPage();

    return await crawlWebsiteWithLoader(
      websiteUrl,
      rootDomain,
      options,
      async (url) => {
        try {
          const response = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: BROWSER_PAGE_TIMEOUT_MS,
          });
          if (!response) {
            return {
              html: null,
              failure: { category: "navigation_error", message: "Browser navigation returned no response" },
            };
          }
          if (!response.ok()) {
            return {
              html: null,
              failure: {
                category: response.status() === 404 ? "not_found" : response.status() === 410 ? "gone" : "http_access",
                message: `Browser navigation returned HTTP ${response.status()}`,
                statusCode: response.status(),
              },
            };
          }
          await page.waitForTimeout(500);
          return { html: await page.content(), failure: null };
        } catch (error) {
          return { html: null, failure: classifyNetworkFailure(error) };
        }
      },
      "browser",
    );
  } catch (error) {
    if (isBrowserSetupFailure(error)) {
      throw new BrowserCrawlerSetupError(
        "Playwright Chromium is not installed. Run the documented Chromium install command before activating browser retries.",
      );
    }
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
