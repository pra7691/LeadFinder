import { describe, expect, it } from "vitest";
import { normalizeUniqueRecipients, planProcessingBatchSizes } from "./incremental-batch-utils";

describe("incremental batch utilities", () => {
  it("claims up to 50 crawled leads per batch", () => {
    expect(planProcessingBatchSizes(50)).toEqual([50]);
    expect(planProcessingBatchSizes(51)).toEqual([50, 1]);
  });

  it("plans a 232 lead backlog as 50, 50, 50, 50, 32", () => {
    expect(planProcessingBatchSizes(232)).toEqual([50, 50, 50, 50, 32]);
  });

  it("normalizes duplicate recipients before creating drafts", () => {
    expect(normalizeUniqueRecipients([
      " Info@Example.com ",
      "//info@example.com",
      "sales@example.com",
      "not-an-email",
    ])).toEqual(["info@example.com", "sales@example.com"]);
  });
});
