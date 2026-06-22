import { describe, expect, it } from "vitest";
import { canResumeCampaignRunStatus, isCancellationStatus, restartRecoveryDecision } from "./run-safety";

describe("campaign run safety rules", () => {
  it("treats cancelling and cancelled as terminal overwrite blockers", () => {
    expect(isCancellationStatus("cancelling")).toBe(true);
    expect(isCancellationStatus("cancelled")).toBe(true);
    expect(isCancellationStatus("running")).toBe(false);
  });

  it("allows resume only after the old in-process work is no longer stopping/running", () => {
    expect(canResumeCampaignRunStatus("cancelled")).toBe(true);
    expect(canResumeCampaignRunStatus("failed")).toBe(true);
    expect(canResumeCampaignRunStatus("partial")).toBe(true);
    expect(canResumeCampaignRunStatus("completed")).toBe(true);
    expect(canResumeCampaignRunStatus("cancelling")).toBe(false);
    expect(canResumeCampaignRunStatus("running")).toBe(false);
  });

  it("finalizes cancelling runs as cancelled on restart", () => {
    expect(restartRecoveryDecision("cancelling")).toEqual({
      status: "cancelled",
      currentStage: "cancelled",
      errorMessage: null,
    });
  });

  it("marks interrupted running runs as resumable without auto-resume", () => {
    expect(restartRecoveryDecision("running")).toMatchObject({
      status: "failed",
      currentStage: "interrupted_restart",
    });
  });
});
