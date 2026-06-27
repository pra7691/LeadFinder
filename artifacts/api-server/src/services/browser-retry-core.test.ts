import { describe, expect, it, vi } from "vitest";
import {
  createSingleFlightDrain,
  browserFailureUpdate,
  browserSuccessUpdate,
  finalBrowserCrawlStatus,
  hasDurableBrowserRetry,
  isBrowserRetryRunnable,
  mergeRecoveredEmailLists,
  recoverBrowserRetryStatus,
} from "./browser-retry-core";

describe("browser retry lifecycle", () => {
  it("recovers interrupted and setup-blocked work without changing terminal attempts", () => {
    expect(recoverBrowserRetryStatus("running")).toBe("pending");
    expect(recoverBrowserRetryStatus("setup_required")).toBe("pending");
    expect(recoverBrowserRetryStatus("succeeded")).toBe("succeeded");
    expect(recoverBrowserRetryStatus("failed")).toBe("failed");
  });

  it("allows only one worker drain at a time", async () => {
    let release: (() => void) | undefined;
    const drain = vi.fn(() => drain.mock.calls.length === 1
      ? new Promise<void>((resolve) => { release = resolve; })
      : Promise.resolve());
    const worker = createSingleFlightDrain(drain);

    const first = worker.kick();
    const second = worker.kick();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(worker.isActive()).toBe(true);

    release?.();
    await Promise.all([first, second]);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(worker.isActive()).toBe(false);
  });

  it("preserves and deduplicates emails recovered by the browser", () => {
    expect(mergeRecoveredEmailLists(
      ["info@example.com"],
      ["INFO@example.com", "sales@example.com"],
    )).toEqual(["info@example.com", "sales@example.com"]);
  });

  it("does not start new browser work after a run stops", () => {
    expect(isBrowserRetryRunnable("running")).toBe(true);
    expect(isBrowserRetryRunnable("cancelling")).toBe(false);
    expect(isBrowserRetryRunnable("cancelled")).toBe(false);
    expect(isBrowserRetryRunnable("failed")).toBe(false);
  });

  it("becomes final failure only after a completed browser attempt has no usable page", () => {
    expect(finalBrowserCrawlStatus(1)).toBe("crawled");
    expect(finalBrowserCrawlStatus(0)).toBe("failed");
  });

  it("does not create a second browser job for a durable or completed attempt", () => {
    expect(hasDurableBrowserRetry("pending")).toBe(true);
    expect(hasDurableBrowserRetry("running")).toBe(true);
    expect(hasDurableBrowserRetry("setup_required")).toBe(true);
    expect(hasDurableBrowserRetry("succeeded")).toBe(true);
    expect(hasDurableBrowserRetry("not_needed")).toBe(false);
    expect(hasDurableBrowserRetry("failed")).toBe(false);
  });

  it("marks browser recovery crawled while preserving all unique emails", () => {
    expect(browserSuccessUpdate(
      ["first@example.com"],
      ["FIRST@example.com", "second@example.com"],
    )).toEqual({
      crawlStatus: "crawled",
      crawlError: null,
      emails: ["first@example.com", "second@example.com"],
    });
  });

  it("marks final failure only after the browser attempt reports an error", () => {
    expect(browserFailureUpdate("Browser navigation failed")).toEqual({
      crawlStatus: "failed",
      crawlError: "Browser navigation failed",
    });
  });
});
