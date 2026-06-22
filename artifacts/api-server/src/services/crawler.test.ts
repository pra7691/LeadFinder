import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlWebsite } from "./crawler";

const html = `
  <html>
    <body>
      <a href="/contact">Contact sales</a>
      <h1>Acme AI Lab</h1>
      <p>Email sales@acme.test for details.</p>
    </body>
  </html>
`;

describe("crawlWebsite cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not process a page when cancellation is requested after the active HTTP request finishes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, {
      headers: { "content-type": "text/html" },
    })));

    let checks = 0;
    const result = await crawlWebsite("https://acme.test", "acme.test", {
      maxPagesPerDomain: 2,
      shouldStop: () => {
        checks++;
        return checks >= 2;
      },
    });

    expect(result.cancelled).toBe(true);
    expect(result.pagesAttempted).toBe(1);
    expect(result.pagesSucceeded).toBe(0);
    expect(result.emails).toBeNull();
  });

  it("does not queue or crawl additional pages after cancellation between pages", async () => {
    const fetchMock = vi.fn(async () => new Response(html, {
      headers: { "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    let checks = 0;
    const result = await crawlWebsite("https://acme.test", "acme.test", {
      internalLinkKeywords: "contact",
      maxCrawlDepth: 1,
      maxPagesPerDomain: 2,
      shouldStop: () => {
        checks++;
        return checks >= 4;
      },
    });

    expect(result.cancelled).toBe(true);
    expect(result.pagesAttempted).toBe(1);
    expect(result.pagesSucceeded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
