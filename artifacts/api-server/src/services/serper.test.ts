import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./serper-credit-status", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./serper-credit-status")>();
  return {
    ...actual,
    clearSerperCreditsExhausted: vi.fn().mockResolvedValue(undefined),
    recordSerperCreditsExhausted: vi.fn().mockResolvedValue(undefined),
  };
});

import { searchSerper } from "./serper";
import {
  clearSerperCreditsExhausted,
  recordSerperCreditsExhausted,
} from "./serper-credit-status";

const mockClearStatus = vi.mocked(clearSerperCreditsExhausted);
const mockRecordExhausted = vi.mocked(recordSerperCreditsExhausted);

describe("searchSerper credit status integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockClearStatus.mockReset().mockResolvedValue(undefined);
    mockRecordExhausted.mockReset().mockResolvedValue(undefined);
  });

  it("records the affected run for an explicit not-enough-credits response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"message":"Not enough credits","statusCode":400}',
    } as Response);

    await expect(
      searchSerper("test query", "test-key", 10, { campaignRunId: 55 }),
    ).rejects.toThrow("Not enough credits");

    expect(mockRecordExhausted).toHaveBeenCalledOnce();
    expect(mockRecordExhausted).toHaveBeenCalledWith(
      55,
      expect.stringContaining("Not enough credits"),
    );
    expect(mockClearStatus).not.toHaveBeenCalled();
  });

  it.each([
    [403, "Not enough credits"],
    [400, "Invalid API key"],
    [429, "Rate limit exceeded"],
    [500, "Gateway timeout"],
  ])("does not set the alert for HTTP %s with %s", async (status, body) => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status,
      text: async () => body,
    } as Response);

    await expect(searchSerper("test query", "test-key")).rejects.toThrow();
    expect(mockRecordExhausted).not.toHaveBeenCalled();
    expect(mockClearStatus).not.toHaveBeenCalled();
  });

  it("does not change the alert for a network timeout", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(
      new Error("Connection timeout"),
    );

    await expect(searchSerper("test query", "test-key")).rejects.toThrow(
      "Connection timeout",
    );
    expect(mockRecordExhausted).not.toHaveBeenCalled();
    expect(mockClearStatus).not.toHaveBeenCalled();
  });

  it("clears the alert only after a successful real Serper response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ organic: [] }),
    } as Response);

    await expect(searchSerper("test query", "test-key")).resolves.toEqual([]);
    expect(mockClearStatus).toHaveBeenCalledOnce();
    expect(mockRecordExhausted).not.toHaveBeenCalled();
  });
});
