import { describe, expect, it } from "vitest";
import {
  classifyHttpStatus,
  classifyNetworkFailure,
  classifyUrlBeforeCrawl,
  shouldQueueBrowserRetry,
  type CrawlFailure,
} from "./crawl-failure-classifier";

const retryable: CrawlFailure[] = [
  { category: "javascript_shell", message: "script-heavy shell" },
  { category: "http_access", message: "HTTP 403" },
  { category: "empty_content", message: "no extracted content" },
  { category: "timeout", message: "timed out" },
  { category: "navigation_error", message: "page load failed" },
];

describe("browser retry classification", () => {
  it.each(retryable)("queues retryable HTTP failure $category", (failure) => {
    expect(shouldQueueBrowserRetry({ failure })).toBe(true);
  });

  it("classifies selected access responses as retryable", () => {
    expect(classifyHttpStatus(403).category).toBe("http_access");
    expect(classifyHttpStatus(405).category).toBe("http_access");
    expect(classifyHttpStatus(408).category).toBe("timeout");
  });

  it("does not queue DNS, invalid URL, 404, or non-target states", () => {
    expect(shouldQueueBrowserRetry({ failure: classifyNetworkFailure({ cause: { code: "ENOTFOUND" }, message: "fetch failed" }) })).toBe(false);
    expect(shouldQueueBrowserRetry({ failure: classifyUrlBeforeCrawl("not a URL")! })).toBe(false);
    expect(shouldQueueBrowserRetry({ failure: classifyHttpStatus(404) })).toBe(false);
    expect(shouldQueueBrowserRetry({ failure: retryable[0]!, blocked: true })).toBe(false);
    expect(shouldQueueBrowserRetry({ failure: retryable[0]!, duplicate: true })).toBe(false);
    expect(shouldQueueBrowserRetry({ failure: retryable[0]!, skippedSource: true })).toBe(false);
    expect(shouldQueueBrowserRetry({ failure: retryable[0]!, cancelled: true })).toBe(false);
  });

  it("does not queue unsupported file URLs", () => {
    const failure = classifyUrlBeforeCrawl("https://example.com/report.pdf");
    expect(failure?.category).toBe("unsupported_file");
    expect(shouldQueueBrowserRetry({ failure: failure! })).toBe(false);
  });
});
