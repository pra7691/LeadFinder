import { Router } from "express";
import { db } from "@workspace/db";
import { campaignsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runPipeline } from "../scheduler/pipeline";
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

  // Mark as running immediately so the UI can reflect the state
  await db
    .update(campaignsTable)
    .set({ lastRunStatus: "running", lastRunAt: new Date() })
    .where(eq(campaignsTable.id, campaignId));

  // Fire-and-forget — do NOT await the pipeline.
  // Awaiting blocks the event loop (health checks stop responding → outage).
  runPipeline(campaignId)
    .then(async (result) => {
      const status =
        result.failed > 0 && result.discoveryLeadsCreated === 0 && result.crawledCount === 0
          ? "failed"
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
        .where(eq(campaignsTable.id, campaignId));

      logger.info({ campaignId, status }, "Manual trigger: pipeline complete");
    })
    .catch(async (err) => {
      logger.error({ err, campaignId }, "Manual trigger: pipeline threw");

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
        .where(eq(campaignsTable.id, campaignId));
    });

  // Return 202 immediately — server stays responsive throughout the pipeline run
  res.status(202).json({ status: "started", campaignId });
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
