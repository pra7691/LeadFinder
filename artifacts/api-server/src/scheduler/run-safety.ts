export function isCancellationStatus(status: string | null | undefined): boolean {
  return status === "cancelling" || status === "cancelled";
}

export function canResumeCampaignRunStatus(status: string | null | undefined): boolean {
  return status === "failed" || status === "partial" || status === "cancelled" || status === "completed";
}

export function restartRecoveryDecision(status: string | null | undefined):
  | { status: "cancelled"; currentStage: "cancelled"; errorMessage: null }
  | { status: "failed"; currentStage: "interrupted_restart"; errorMessage: string }
  | null {
  if (status === "cancelling") {
    return { status: "cancelled", currentStage: "cancelled", errorMessage: null };
  }
  if (status === "running") {
    return {
      status: "failed",
      currentStage: "interrupted_restart",
      errorMessage: "Server restarted while this run was active. Resume Run will continue the same run without rediscovery.",
    };
  }
  return null;
}
