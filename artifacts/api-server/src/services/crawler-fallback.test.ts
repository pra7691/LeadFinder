import { describe, expect, it, vi } from "vitest";
import { crawlWebsiteWithLoader } from "./crawler";

const renderedHtml = `<!doctype html><html><head><title>Acme Labs</title></head><body>
  <h1>Acme Labs</h1>
  <p>We build useful systems for customers around the world with a capable research team.</p>
  <a href="mailto:sales@acme.test">Email</a>
</body></html>`;

describe("shared HTTP/browser crawl engine", () => {
  it("continues normally when the HTTP loader returns usable content", async () => {
    const loader = vi.fn().mockResolvedValue({ html: renderedHtml, failure: null });
    const result = await crawlWebsiteWithLoader(
      "https://acme.test",
      "acme.test",
      { maxPagesPerDomain: 1 },
      loader,
      "http",
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.pagesSucceeded).toBe(1);
    expect(result.emails).toBe("sales@acme.test");
    expect(result.failure).toBeNull();
  });

  it("classifies a script-heavy near-empty HTTP page for browser retry", async () => {
    const result = await crawlWebsiteWithLoader(
      "https://shell.test",
      "shell.test",
      { maxPagesPerDomain: 1 },
      async () => ({
        html: '<html><body><div id="app"></div><script></script><script></script><script></script></body></html>',
        failure: null,
      }),
      "http",
    );

    expect(result.pagesSucceeded).toBe(0);
    expect(result.failure?.category).toBe("javascript_shell");
  });

  it("accepts rendered browser content through the same extractor", async () => {
    const result = await crawlWebsiteWithLoader(
      "https://acme.test",
      "acme.test",
      { maxPagesPerDomain: 1 },
      async () => ({ html: renderedHtml, failure: null }),
      "browser",
    );

    expect(result.pagesSucceeded).toBe(1);
    expect(result.emails).toBe("sales@acme.test");
  });
});
