export type FinalizableRunStatus = "completed" | "partial";

export interface FinalizationReadiness {
  status: string;
  pendingCrawlCount: number;
  pendingScoreCount: number;
  pendingBatchCount: number;
}

export interface ListItemIdentity {
  leadId: number | null;
  email?: string | null;
}

function normalizedEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function listItemKey(item: ListItemIdentity): string {
  return `${item.leadId ?? "manual"}:${normalizedEmail(item.email)}`;
}

export function resolveTerminalRunStatus(failedCount: number, workCompleted: boolean): string {
  if (failedCount <= 0) return "completed";
  return workCompleted ? "partial" : "failed";
}

export function isRunReadyForFinalization(state: FinalizationReadiness): boolean {
  return (state.status === "completed" || state.status === "partial") &&
    state.pendingCrawlCount === 0 &&
    state.pendingScoreCount === 0 &&
    state.pendingBatchCount === 0;
}

export function missingListItems<T extends ListItemIdentity>(
  candidates: T[],
  existing: ListItemIdentity[],
): T[] {
  const seen = new Set(existing.map(listItemKey));
  const missing: T[] = [];
  for (const candidate of candidates) {
    const key = listItemKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(candidate);
  }
  return missing;
}

export function missingDraftRecipients(candidates: string[], existing: string[]): string[] {
  const seen = new Set(existing.map(normalizedEmail).filter(Boolean));
  const missing: string[] = [];
  for (const candidate of candidates) {
    const email = normalizedEmail(candidate);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    missing.push(email);
  }
  return missing;
}
