export const QUEUEABLE_OUTREACH_STATUSES = new Set(["approved", "pending_review"]);

export type QueueProcessResult = "continue" | "stop";

export function canQueueOutreachStatus(status: string): boolean {
  return QUEUEABLE_OUTREACH_STATUSES.has(status);
}

export function uniqueQueueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

export function recoverSendingStatus(item: {
  status: string;
  sentAt?: unknown | null;
  bouncedAt?: unknown | null;
}): "queued" | "sent" | "bounced" | "ignore" {
  if (item.status !== "sending") return "ignore";
  if (item.sentAt) return "sent";
  if (item.bouncedAt) return "bounced";
  return "queued";
}

export function createSingleQueueWorkerGate() {
  let running = false;

  return {
    isRunning: () => running,
    start(run: () => Promise<void>): boolean {
      if (running) return false;
      running = true;
      void Promise.resolve()
        .then(run)
        .finally(() => {
          running = false;
        });
      return true;
    },
  };
}

export async function drainManualSendQueue<T>({
  claim,
  process,
  shouldStop,
}: {
  claim: () => Promise<T | null>;
  process: (item: T) => Promise<QueueProcessResult>;
  shouldStop: () => boolean;
}): Promise<{ processed: number; stopped: boolean }> {
  let processed = 0;
  let stopped = false;

  while (!shouldStop()) {
    const item = await claim();
    if (!item) break;

    const result = await process(item);
    processed++;
    if (result === "stop") {
      stopped = true;
      break;
    }
  }

  if (shouldStop()) stopped = true;
  return { processed, stopped };
}
