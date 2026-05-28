import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable, campaignRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runPipeline, clearCancellation } from "../scheduler/pipeline";
import { computeNextRunAt } from "../scheduler/index";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /scheduler/status ──────────────────────────────────────────────────

router.get("/scheduler/status", async (_req, res) => {
  const campaigns = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      isActive: campaignsTable.isActive,
      isPaused: campaignsTable.isPaused,
      scheduleType: campaignsTable.scheduleType,
      scheduleDays: campaignsTable.scheduleDays,
      scheduleTime: campaignsTable.scheduleTime,
      nextRunAt: campaignsTable.nextRunAt,
      lastRunAt: campaignsTable.lastRunAt,
      lastRunStatus: campaignsTable.lastRunStatus,
    })
    .from(campaignsTable)
    .orderBy(campaignsTable.name);

  const result = campaigns.map((c) => ({
    campaignId: c.id,
    campaignName: c.name,
    isActive: c.isActive,
    isPaused: c.isPaused,
    scheduleType: c.scheduleType,
    scheduleDays: c.scheduleDays,
    scheduleTime: c.scheduleTime,
    nextRunAt: c.nextRunAt ? c.nextRunAt.toISOString() : null,
    lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
    lastRunStatus: c.lastRunStatus,
  }));

  res.json(result);
});

// ── POST /campaigns/:id/trigger ────────────────────────────────────────────
//
// IMPORTANT: This endpoint must return IMMEDIATELY.
// Running the pipeline synchronously (with await) blocks the entire Node.js
// event loop for the full pipeline duration (minutes), making the server
// unresponsive to health checks and all other requests, causing downtime.
//
// The pipeline runs in the background, exactly like the cron scheduler does.

router.post("/campaigns/:id/trigger", async (req, res) => {
  const campaignId = Number(req.params.id);
  if (isNaN(campaignId)) {
    res.status(400).json({ error: "Invalid campaign ID" });
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.lastRunStatus === "running") {
    res.status(409).json({ error: "Pipeline is already running for this campaign" });
    return;
  }

  // Accept an optional runName from the request body
  const bodyRunName = typeof req.body?.runName === "string" && req.body.runName.trim()
    ? req.body.runName.trim()
    : null;

  // Create a campaign_run record immediately so the UI can show it right away
  const [campaignRun] = await db
    .insert(campaignRunsTable)
    .values({
      campaignId,
      runName: bodyRunName ?? `Campaign Run – ${new Date().toISOString().slice(0, 10)}`,
      runType: "manual",
      status: "running",
    })
    .returning();

  const runId = campaignRun.id;

  // Mark campaign as running immediately so the UI can reflect the state
  await db
    .update(campaignsTable)
    .set({ lastRunStatus: "running", lastRunAt: new Date() })
    .where(eq(campaignsTable.id, campaignId));

  // Fire-and-forget — do NOT await the pipeline.
  // Awaiting blocks the event loop (health checks stop responding → outage).
  runPipeline(campaignId, runId, { forceDiscoveryRefresh: true })
    .then(async (result) => {
      // If the run was cancelled mid-flight, don't overwrite the cancelled status
      const [currentRun] = await db
        .select({ status: campaignRunsTable.status })
        .from(campaignRunsTable)
        .where(eq(campaignRunsTable.id, runId));
      if (currentRun?.status === "cancelled") {
        clearCancellation(runId);
        logger.info({ campaignId, runId }, "Manual trigger: run was cancelled — skipping status update");
        return;
      }

      const workCompleted =
        result.discoveryLeadsCreated > 0 ||
        result.crawledCount > 0 ||
        result.crawlFailedCount > 0 ||
        result.scoredCount > 0 ||
        result.emailsSent > 0;
      const status =
        result.failed > 0
          ? (workCompleted ? "partial" : "failed")
          : "completed";

      const nextRunAt = computeNextRunAt(
        campaign.scheduleType,
        campaign.scheduleTime,
        campaign.scheduleDays,
      );

      await Promise.all([
        db.update(campaignsTable)
          .set({ lastRunStatus: status === "completed" ? "success" : status, lastRunAt: new Date(), nextRunAt: nextRunAt ?? undefined })
          .where(eq(campaignsTable.id, campaignId)),
        db.update(campaignRunsTable)
          .set({
            status,
            currentStage: status,
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
            durationSeconds: Math.round((Date.now() - campaignRun.startedAt.getTime()) / 1000),
            progressPercent: 100,
            completedWorkUnits: result.discoverySearchesPerformed + result.discoverySearchesSkipped,
            estimatedRemainingSeconds: 0,
            estimatedCompletionAt: null,
          })
          .where(eq(campaignRunsTable.id, runId)),
      ]);

      logger.info({ campaignId, runId, status }, "Manual trigger: pipeline complete");
    })
    .catch(async (err) => {
      logger.error({ err, campaignId, runId }, "Manual trigger: pipeline threw");

      const nextRunAt = computeNextRunAt(
        campaign.scheduleType,
        campaign.scheduleTime,
        campaign.scheduleDays,
      );

      await Promise.all([
        db.update(campaignsTable)
          .set({ lastRunStatus: "failed", lastRunAt: new Date(), nextRunAt: nextRunAt ?? undefined })
          .where(eq(campaignsTable.id, campaignId)),
        db.update(campaignRunsTable)
          .set({ status: "failed", currentStage: "failed", completedAt: new Date(), errorMessage: String(err?.message ?? err) })
          .where(eq(campaignRunsTable.id, runId)),
      ]);
    });

  // Return 202 immediately — server stays responsive throughout the pipeline run
  res.status(202).json({ status: "started", campaignId, runId });
});

// ── PATCH /campaigns/:id/pause ─────────────────────────────────────────────

router.patch("/campaigns/:id/pause", async (req, res) => {
  const campaignId = Number(req.params.id);
  if (isNaN(campaignId)) {
    res.status(400).json({ error: "Invalid campaign ID" });
    return;
  }

  const [updated] = await db
    .update(campaignsTable)
    .set({ isPaused: true })
    .where(eq(campaignsTable.id, campaignId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json(updated);
});

// ── PATCH /campaigns/:id/resume ────────────────────────────────────────────

router.patch("/campaigns/:id/resume", async (req, res) => {
  const campaignId = Number(req.params.id);
  if (isNaN(campaignId)) {
    res.status(400).json({ error: "Invalid campaign ID" });
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  // Recompute nextRunAt when resuming
  const nextRunAt = computeNextRunAt(
    campaign.scheduleType,
    campaign.scheduleTime,
    campaign.scheduleDays,
  );

  const [updated] = await db
    .update(campaignsTable)
    .set({ isPaused: false, nextRunAt: nextRunAt ?? undefined })
    .where(eq(campaignsTable.id, campaignId))
    .returning();

  res.json(updated);
});

export default router;
