import { describe, expect, it, vi } from "vitest";
import {
  canQueueOutreachStatus,
  createSingleQueueWorkerGate,
  drainManualSendQueue,
  recoverSendingStatus,
  uniqueQueueIds,
} from "./outreach-send-queue-core";

describe("manual outreach send queue core", () => {
  it("deduplicates repeated send clicks before queueing", () => {
    expect(uniqueQueueIds([4, 4, 2, 0, -1, 2, 9])).toEqual([4, 2, 9]);
  });

  it("only allows explicit review/approved states to enter the manual queue", () => {
    expect(canQueueOutreachStatus("pending_review")).toBe(true);
    expect(canQueueOutreachStatus("approved")).toBe(true);
    expect(canQueueOutreachStatus("queued")).toBe(false);
    expect(canQueueOutreachStatus("sending")).toBe(false);
    expect(canQueueOutreachStatus("sent")).toBe(false);
  });

  it("returns interrupted sending items without a delivery result to queued on restart", () => {
    expect(recoverSendingStatus({ status: "sending", sentAt: null, bouncedAt: null })).toBe("queued");
    expect(recoverSendingStatus({ status: "sending", sentAt: new Date(), bouncedAt: null })).toBe("sent");
    expect(recoverSendingStatus({ status: "sending", sentAt: null, bouncedAt: new Date() })).toBe("bounced");
  });

  it("ignores approved and pending review items during startup recovery", () => {
    expect(recoverSendingStatus({ status: "approved", sentAt: null })).toBe("ignore");
    expect(recoverSendingStatus({ status: "pending_review", sentAt: null })).toBe("ignore");
    expect(recoverSendingStatus({ status: "queued", sentAt: null })).toBe("ignore");
  });

  it("processes queued items one at a time and advances after success or failure", async () => {
    const queue = [
      { id: 1, result: "success" },
      { id: 2, result: "failure" },
      { id: 3, result: "success" },
    ];
    const seen: number[] = [];
    let activeSendCount = 0;
    let maxConcurrentSends = 0;

    const mockSmtpSend = vi.fn(async (item: (typeof queue)[number]) => {
      activeSendCount++;
      maxConcurrentSends = Math.max(maxConcurrentSends, activeSendCount);
      await Promise.resolve();
      seen.push(item.id);
      activeSendCount--;
      return item.result;
    });

    const result = await drainManualSendQueue({
      shouldStop: () => false,
      claim: async () => queue.shift() ?? null,
      process: async (item) => {
        await mockSmtpSend(item);
        return "continue";
      },
    });

    expect(result.processed).toBe(3);
    expect(result.stopped).toBe(false);
    expect(seen).toEqual([1, 2, 3]);
    expect(maxConcurrentSends).toBe(1);
    expect(mockSmtpSend).toHaveBeenCalledTimes(3);
  });

  it("stops claiming more queued items when the worker asks to stop", async () => {
    const queue = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const seen: number[] = [];

    const result = await drainManualSendQueue({
      shouldStop: () => false,
      claim: async () => queue.shift() ?? null,
      process: async (item) => {
        seen.push(item.id);
        return item.id === 2 ? "stop" : "continue";
      },
    });

    expect(result.processed).toBe(2);
    expect(result.stopped).toBe(true);
    expect(seen).toEqual([1, 2]);
    expect(queue).toEqual([{ id: 3 }]);
  });

  it("continues with queued items after restart recovery", async () => {
    const recovered = [
      { id: 1, status: recoverSendingStatus({ status: "sending", sentAt: null }) },
      { id: 2, status: "queued" },
    ];
    const sent: number[] = [];

    const result = await drainManualSendQueue({
      shouldStop: () => false,
      claim: async () => recovered.find((item) => item.status === "queued") ?? null,
      process: async (item) => {
        item.status = "sent";
        sent.push(item.id);
        return "continue";
      },
    });

    expect(result.processed).toBe(2);
    expect(sent).toEqual([1, 2]);
  });

  it("duplicate worker attempts cannot start a second drain loop", async () => {
    const gate = createSingleQueueWorkerGate();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => hold);

    expect(gate.start(run)).toBe(true);
    expect(gate.start(run)).toBe(false);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await hold;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(gate.isRunning()).toBe(false);
  });
});
