import { describe, expect, it } from "vitest";
import {
  clearSerperCreditsExhausted,
  getSerperCreditStatus,
  isSerperCreditExhaustionResponse,
  recordSerperCreditsExhausted,
  type SerperCreditStatusStore,
} from "./serper-credit-status";

function createMemoryStore(initialValue: string | null = null) {
  let value = initialValue;
  const store: SerperCreditStatusStore = {
    read: async () => value,
    write: async (nextValue) => {
      value = nextValue;
    },
    clear: async () => {
      value = null;
    },
  };
  return { store, readRaw: () => value };
}

describe("Serper credit status", () => {
  it("matches only explicit credit-exhaustion responses", () => {
    expect(
      isSerperCreditExhaustionResponse(400, '{"message":"Not enough credits"}'),
    ).toBe(true);
    expect(isSerperCreditExhaustionResponse(402, "Credits exhausted")).toBe(
      true,
    );
    expect(isSerperCreditExhaustionResponse(400, "Invalid API key")).toBe(
      false,
    );
    expect(isSerperCreditExhaustionResponse(403, "Not enough credits")).toBe(
      false,
    );
    expect(isSerperCreditExhaustionResponse(500, "Network timeout")).toBe(
      false,
    );
  });

  it("persists across a simulated restart until explicitly cleared", async () => {
    const firstProcess = createMemoryStore();
    const detectedAt = new Date("2026-06-27T12:00:00.000Z");

    await recordSerperCreditsExhausted(
      55,
      'Serper API error 400: {"message":"Not enough credits"}',
      firstProcess.store,
      detectedAt,
    );

    const secondProcess = createMemoryStore(firstProcess.readRaw());
    expect(await getSerperCreditStatus(secondProcess.store)).toEqual({
      serperCreditsExhausted: true,
      detectedAt: detectedAt.toISOString(),
      affectedCampaignRunId: 55,
      message: 'Serper API error 400: {"message":"Not enough credits"}',
    });

    await clearSerperCreditsExhausted(secondProcess.store);
    expect(await getSerperCreditStatus(secondProcess.store)).toEqual({
      serperCreditsExhausted: false,
      detectedAt: null,
      affectedCampaignRunId: null,
      message: null,
    });
  });
});
