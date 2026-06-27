import { describe, expect, it } from "vitest";
import {
  isRunReadyForFinalization,
  missingDraftRecipients,
  missingListItems,
  resolveTerminalRunStatus,
} from "./campaign-run-finalization-core";

describe("campaign run finalization", () => {
  it("finalizes a completed run after all work drains", () => {
    expect(isRunReadyForFinalization({
      status: "completed",
      pendingCrawlCount: 0,
      pendingScoreCount: 0,
      pendingBatchCount: 0,
    })).toBe(true);
  });

  it("finalizes a partial run even when some crawls failed", () => {
    expect(resolveTerminalRunStatus(4, true)).toBe("partial");
    expect(isRunReadyForFinalization({
      status: "partial",
      pendingCrawlCount: 0,
      pendingScoreCount: 0,
      pendingBatchCount: 0,
    })).toBe(true);
  });

  it("does not finalize interrupted or active work", () => {
    for (const status of ["running", "cancelling", "cancelled", "failed"]) {
      expect(isRunReadyForFinalization({
        status,
        pendingCrawlCount: 0,
        pendingScoreCount: 0,
        pendingBatchCount: 0,
      })).toBe(false);
    }
    expect(isRunReadyForFinalization({
      status: "partial",
      pendingCrawlCount: 1,
      pendingScoreCount: 0,
      pendingBatchCount: 0,
    })).toBe(false);
  });

  it("creates no outreach recipients when no qualified emails exist", () => {
    expect(missingDraftRecipients([], [])).toEqual([]);
  });

  it("reuses existing list items and adds only missing qualified entries", () => {
    const existing = [{ leadId: 10, email: "one@example.com" }, { leadId: 11, email: null }];
    const candidates = [
      { leadId: 10, email: "ONE@example.com" },
      { leadId: 11, email: null },
      { leadId: 12, email: "two@example.com" },
    ];
    expect(missingListItems(candidates, existing)).toEqual([
      { leadId: 12, email: "two@example.com" },
    ]);
  });

  it("does not duplicate existing drafts or duplicate candidate emails", () => {
    expect(missingDraftRecipients(
      ["new@example.com", "NEW@example.com", "existing@example.com"],
      ["Existing@example.com"],
    )).toEqual(["new@example.com"]);
  });
});
