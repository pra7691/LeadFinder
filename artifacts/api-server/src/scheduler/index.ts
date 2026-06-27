/**
 * Cron-based scheduler worker.
 * Checks every minute which campaigns are due and runs their pipeline.
 */

import * as cron from "node-cron";
import { db } from "@workspace/db";
import { campaignsTable, leadsTable, campaignRunsTable } from "@workspace/db";
import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { runPipeline } from "./pipeline";
import { isCancellationStatus, restartRecoveryDecision } from "./run-safety";
import { logger } from "../lib/logger";
import { recoverManualOutreachSendQueueOnStartup, resumeQueuedOutreachSendQueue, resumeStuckOutreach } from "../routes/outreach-send";
import { captureCampaignRunConfiguration } from "./campaign-run-configuration";

// ── Helpers ────────────────────────────────────────────────────────────────

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function isOutreachAutoResumeEnabled(): boolean {
  return process.env.OUTREACH_AUTO_RESUME_ON_STARTUP === "true";
}

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

  // Durable manual queue recovery: only explicitly queued outreach may resume.
  // Approved/pending_review items still require the user to click Send.
  resumeQueuedOutreachSendQueue().catch((err) =>
    logger.error({ err }, "Scheduler tick: resumeQueuedOutreachSendQueue failed"),
  );

  // Resume any approved outreach items that are sitting idle (no active send loop).
  // This handles:
  //   • daily email limit reset (the previous loop stopped when the cap was hit;
  //     the next tick after IST midnight picks them up again automatically)
  //   • new approvals when no loop is running
  //   • any other case where items got stranded in "approved"
  // The function early-exits if a batch is already running, so this is cheap.
  if (isOutreachAutoResumeEnabled()) {
    resumeStuckOutreach().catch((err) =>
      logger.error({ err }, "Scheduler tick: resumeStuckOutreach failed"),
    );
  }

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

    const [campaignForSnapshot] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaign.id));
    if (!campaignForSnapshot) continue;
    const configurationSnapshot = await captureCampaignRunConfiguration(campaignForSnapshot);

    const [campaignRun] = await db
      .insert(campaignRunsTable)
      .values({
        campaignId: campaign.id,
        runName: `Scheduled Run – ${new Date().toISOString().slice(0, 10)}`,
        runType: "scheduled",
        status: "running",
        configurationSnapshot,
      })
      .returning();

    // Run pipeline in background (don't block the tick)
    runPipeline(campaign.id, campaignRun?.id)
      .then(async (result) => {
        if (campaignRun) {
          const [currentRun] = await db
            .select({ status: campaignRunsTable.status })
            .from(campaignRunsTable)
            .where(eq(campaignRunsTable.id, campaignRun.id));
          if (isCancellationStatus(currentRun?.status)) {
            logger.info({ campaignId: campaign.id, runId: campaignRun.id }, "Scheduler: run is stopping/stopped — skipping status update");
            return;
          }
        }

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

        await Promise.all([
          db
          .update(campaignsTable)
          .set({
            lastRunStatus: status,
            lastRunAt: new Date(),
            nextRunAt: nextRunAt ?? undefined,
          })
            .where(eq(campaignsTable.id, campaign.id)),
          campaignRun
            ? db.update(campaignRunsTable)
              .set({
                status: status === "success" ? "completed" : status,
                currentStage: status === "success" ? "completed" : status,
                completedAt: new Date(),
                totalNewLeads: result.discoveryLeadsCreated,
                totalSearches: result.discoverySearchesPerformed,
                totalSearchesSkipped: result.discoverySearchesSkipped,
                totalResults: result.discoveryRawResults,
                totalResultsSeenBefore: result.discoveryResultsSeenBefore,
                totalDuplicates: result.discoveryDuplicatesSkipped,
                totalBlocked: result.discoveryBlockedSkipped,
                totalRejected: result.failed,
                totalDiscoverySourcesFound: result.discoverySourcesFound,
                totalDiscoverySourcesMined: result.discoverySourcesMined,
                totalDiscoverySourcesSkipped: result.discoverySourcesSkipped,
                errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
                metadataJson: JSON.stringify({
                  crawledCount: result.crawledCount,
                  scoredCount: result.scoredCount,
                  pendingCrawlCount: result.pendingCrawlCount,
                  crawlFailedCount: result.crawlFailedCount,
                  pendingScoreCount: result.pendingScoreCount,
                  autoBlockedLowScoreCount: result.autoBlockedLowScoreCount,
                  emailsSent: result.emailsSent,
                  durationMs: result.durationMs,
                }),
                durationSeconds: Math.round(result.durationMs / 1000),
              })
              .where(eq(campaignRunsTable.id, campaignRun.id))
            : Promise.resolve(),
        ]);

        logger.info(
          { campaignId: campaign.id, status, nextRunAt },
          "Scheduler: pipeline complete",
        );
      })
      .catch(async (err) => {
        logger.error({ err, campaignId: campaign.id }, "Scheduler: pipeline threw");

        if (campaignRun) {
          const [currentRun] = await db
            .select({ status: campaignRunsTable.status })
            .from(campaignRunsTable)
            .where(eq(campaignRunsTable.id, campaignRun.id));
          if (isCancellationStatus(currentRun?.status)) {
            return;
          }
        }

        const nextRunAt = computeNextRunAt(
          campaign.scheduleType,
          campaign.scheduleTime,
          campaign.scheduleDays,
        );

        await Promise.all([
          db
          .update(campaignsTable)
          .set({
            lastRunStatus: "failed",
            lastRunAt: new Date(),
            nextRunAt: nextRunAt ?? undefined,
          })
            .where(eq(campaignsTable.id, campaign.id)),
          campaignRun
            ? db.update(campaignRunsTable)
              .set({
                status: "failed",
                currentStage: "failed",
                completedAt: new Date(),
                errorMessage: err instanceof Error ? err.message : String(err),
              })
              .where(eq(campaignRunsTable.id, campaignRun.id))
            : Promise.resolve(),
        ]);
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
    const now = new Date();

    // 1. A restart during graceful cancellation should finish as cancelled.
    const cancellingRuns = await db
      .select({ id: campaignRunsTable.id, campaignId: campaignRunsTable.campaignId })
      .from(campaignRunsTable)
      .where(eq(campaignRunsTable.status, "cancelling"));
    const cancellingRunIds = cancellingRuns.map((run) => run.id);

    if (cancellingRunIds.length > 0) {
      const cancellingDecision = restartRecoveryDecision("cancelling");
      await db
        .update(leadsTable)
        .set({ crawlStatus: "pending", crawlError: "Reset after cancellation during server restart" })
        .where(and(
          inArray(leadsTable.campaignRunId, cancellingRunIds),
          eq(leadsTable.crawlStatus, "crawling"),
        ));

      await db
        .update(campaignRunsTable)
        .set({
          status: cancellingDecision?.status ?? "cancelled",
          currentStage: cancellingDecision?.currentStage ?? "cancelled",
          errorMessage: cancellingDecision?.errorMessage ?? null,
          completedAt: now,
          estimatedRemainingSeconds: 0,
        })
        .where(inArray(campaignRunsTable.id, cancellingRunIds));

      const campaignIds = [...new Set(cancellingRuns.map((run) => run.campaignId))];
      await db
        .update(campaignsTable)
        .set({ lastRunStatus: "cancelled", lastRunAt: now })
        .where(inArray(campaignsTable.id, campaignIds));

      logger.warn(
        { runIds: cancellingRunIds },
        `Startup recovery: finalized ${cancellingRunIds.length} cancelling run(s) as cancelled`,
      );
    }

    // 2. Running runs were interrupted by restart. Preserve completed work and make them manually resumable.
    const runningRuns = await db
      .select({ id: campaignRunsTable.id, campaignId: campaignRunsTable.campaignId })
      .from(campaignRunsTable)
      .where(eq(campaignRunsTable.status, "running"));
    const runningRunIds = runningRuns.map((run) => run.id);

    if (runningRunIds.length > 0) {
      await db
        .update(leadsTable)
        .set({ crawlStatus: "pending", crawlError: "Reset after server restart" })
        .where(and(
          inArray(leadsTable.campaignRunId, runningRunIds),
          eq(leadsTable.crawlStatus, "crawling"),
        ));
    }

    const runningDecision = restartRecoveryDecision("running");
    const stuckRuns = runningRunIds.length > 0 ? await db
      .update(campaignRunsTable)
      .set({
        status: runningDecision?.status ?? "failed",
        completedAt: now,
        currentStage: runningDecision?.currentStage ?? "interrupted_restart",
        errorMessage: runningDecision?.errorMessage ?? "Server restarted while this run was active. Resume Run will continue the same run without rediscovery.",
      })
      .where(inArray(campaignRunsTable.id, runningRunIds))
      .returning({ id: campaignRunsTable.id }) : [];

    if (stuckRuns.length > 0) {
      const campaignIds = [...new Set(runningRuns.map((run) => run.campaignId))];
      await db
        .update(campaignsTable)
        .set({ lastRunStatus: "failed", lastRunAt: now })
        .where(inArray(campaignsTable.id, campaignIds));

      logger.warn(
        { runIds: stuckRuns.map((r) => r.id) },
        `Startup recovery: marked ${stuckRuns.length} interrupted campaign run(s) as failed/interrupted_restart`,
      );
    }

    // 3. Reset any orphaned crawling leads not covered by run-level recovery.
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

    // 4. Reset campaigns still stuck in "running" without a matching active run.
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

    // 5. Recover only explicitly queued/sending manual outreach. Approved items remain opt-in only.
    await recoverManualOutreachSendQueueOnStartup();

    // 6. Optionally resume outreach items stuck in "approved" from a previous interrupted send.
    if (isOutreachAutoResumeEnabled()) {
      await resumeStuckOutreach();
    } else {
      logger.warn(
        "Startup outreach auto-resume is disabled; approved outreach items will not be sent automatically. Set OUTREACH_AUTO_RESUME_ON_STARTUP=true to enable.",
      );
    }
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
