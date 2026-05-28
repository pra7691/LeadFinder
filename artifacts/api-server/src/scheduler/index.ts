/**
 * Cron-based scheduler worker.
 * Checks every minute which campaigns are due and runs their pipeline.
 */

import * as cron from "node-cron";
import { db } from "@workspace/db";
import { campaignsTable, leadsTable, campaignRunsTable } from "@workspace/db";
import { and, eq, lte, ne } from "drizzle-orm";
import { runPipeline } from "./pipeline";
import { logger } from "../lib/logger";
import { resumeStuckOutreach } from "../routes/outreach-send";

// ── Helpers ────────────────────────────────────────────────────────────────

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Compute the next Date when a campaign should run.
 * Returns null for manual campaigns.
 */
export function computeNextRunAt(
  scheduleType: string,
  scheduleTime: string | null,
  scheduleDays: string | null,
  after: Date = new Date(),
): Date | null {
  if (scheduleType === "manual") return null;

  const [hStr, mStr] = (scheduleTime ?? "09:00").split(":");
  const hours = parseInt(hStr ?? "9", 10);
  const minutes = parseInt(mStr ?? "0", 10);

  if (scheduleType === "daily") {
    const next = new Date(after);
    next.setHours(hours, minutes, 0, 0);
    if (next <= after) next.setDate(next.getDate() + 1);
    return next;
  }

  if (scheduleType === "weekly") {
    const days = (scheduleDays ?? "mon")
      .split(",")
      .map((d) => d.trim().toLowerCase());

    const targetDayNums = days
      .map((d) => DAY_NAMES.indexOf(d as (typeof DAY_NAMES)[number]))
      .filter((n) => n !== -1);

    if (targetDayNums.length === 0) return null;

    // Scan up to 8 days ahead to find the next matching day
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(after);
      candidate.setDate(after.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      if (targetDayNums.includes(candidate.getDay()) && candidate > after) {
        return candidate;
      }
    }
    return null;
  }

  return null;
}

// ── Scheduler tick ────────────────────────────────────────────────────────

async function tick() {
  const now = new Date();

  // Find campaigns that are due: scheduled, not paused, not already running, nextRunAt <= now
  const dueCampaigns = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      scheduleType: campaignsTable.scheduleType,
      scheduleDays: campaignsTable.scheduleDays,
      scheduleTime: campaignsTable.scheduleTime,
    })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.isActive, true),
        eq(campaignsTable.isPaused, false),
        ne(campaignsTable.scheduleType, "manual"),
        ne(campaignsTable.lastRunStatus, "running"),
        lte(campaignsTable.nextRunAt, now),
      ),
    );

  for (const campaign of dueCampaigns) {
    logger.info({ campaignId: campaign.id, name: campaign.name }, "Scheduler: triggering pipeline");

    // Mark as running immediately
    await db
      .update(campaignsTable)
      .set({ lastRunStatus: "running", lastRunAt: now })
      .where(eq(campaignsTable.id, campaign.id));

    // Run pipeline in background (don't block the tick)
    runPipeline(campaign.id)
      .then(async (result) => {
        const workCompleted =
          result.discoveryLeadsCreated > 0 ||
          result.crawledCount > 0 ||
          result.crawlFailedCount > 0 ||
          result.scoredCount > 0 ||
          result.emailsSent > 0;
        const status = result.failed > 0
          ? (workCompleted ? "partial" : "failed")
          : "success";

        const nextRunAt = computeNextRunAt(
          campaign.scheduleType,
          campaign.scheduleTime,
          campaign.scheduleDays,
        );

        await db
          .update(campaignsTable)
          .set({
            lastRunStatus: status,
            lastRunAt: new Date(),
            nextRunAt: nextRunAt ?? undefined,
          })
          .where(eq(campaignsTable.id, campaign.id));

        logger.info(
          { campaignId: campaign.id, status, nextRunAt },
          "Scheduler: pipeline complete",
        );
      })
      .catch(async (err) => {
        logger.error({ err, campaignId: campaign.id }, "Scheduler: pipeline threw");

        const nextRunAt = computeNextRunAt(
          campaign.scheduleType,
          campaign.scheduleTime,
          campaign.scheduleDays,
        );

        await db
          .update(campaignsTable)
          .set({
            lastRunStatus: "failed",
            lastRunAt: new Date(),
            nextRunAt: nextRunAt ?? undefined,
          })
          .where(eq(campaignsTable.id, campaign.id));
      });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

/**
 * On server startup, reset any state that was left "in progress" by a previous
 * process that crashed or was killed mid-run.
 *
 * - Campaigns stuck in "running" → reset to "failed" so the scheduler can
 *   pick them up again on the next scheduled tick.
 * - Campaign runs still open → mark them ended/failed.
 * - Leads stuck in "crawling" → reset to "pending" so they get re-crawled.
 */
async function recoverStuckState() {
  try {
    // 1. Reset campaigns stuck in "running"
    const stuckCampaigns = await db
      .update(campaignsTable)
      .set({ lastRunStatus: "failed" })
      .where(eq(campaignsTable.lastRunStatus, "running"))
      .returning({ id: campaignsTable.id, name: campaignsTable.name });

    if (stuckCampaigns.length > 0) {
      logger.warn(
        { campaigns: stuckCampaigns.map((c) => `${c.id}:${c.name}`) },
        `Startup recovery: reset ${stuckCampaigns.length} stuck campaign(s) from "running" → "failed"`,
      );
    }

    // 2. Close any campaign runs that were never ended
    const stuckRuns = await db
      .update(campaignRunsTable)
      .set({ status: "failed", endedAt: new Date() })
      .where(eq(campaignRunsTable.status, "running"))
      .returning({ id: campaignRunsTable.id });

    if (stuckRuns.length > 0) {
      logger.warn(
        { runIds: stuckRuns.map((r) => r.id) },
        `Startup recovery: closed ${stuckRuns.length} stuck campaign run(s)`,
      );
    }

    // 3. Reset leads stuck mid-crawl
    const stuckLeads = await db
      .update(leadsTable)
      .set({ crawlStatus: "pending", crawlError: "Reset on server restart" })
      .where(eq(leadsTable.crawlStatus, "crawling"))
      .returning({ id: leadsTable.id });

    if (stuckLeads.length > 0) {
      logger.warn(
        { count: stuckLeads.length },
        `Startup recovery: reset ${stuckLeads.length} lead(s) from "crawling" → "pending"`,
      );
    }

    // 4. Resume any outreach items stuck in "approved" from a previous interrupted send
    await resumeStuckOutreach();
  } catch (err) {
    logger.error({ err }, "Startup recovery failed — continuing anyway");
  }
}

export function startScheduler() {
  if (cronTask) {
    logger.warn("Scheduler already running");
    return;
  }

  // Clean up any stuck state left by a previous server crash
  recoverStuckState().catch((err) =>
    logger.error({ err }, "Startup recovery threw unexpectedly"),
  );

  // Run every minute: "* * * * *"
  cronTask = cron.schedule("* * * * *", () => {
    tick().catch((err) => logger.error({ err }, "Scheduler tick error"));
  });

  logger.info("Scheduler started (every minute)");
}

export function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info("Scheduler stopped");
  }
}
