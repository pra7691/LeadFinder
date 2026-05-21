import { Router } from "express";
import { db } from "@workspace/db";
import { campaignRunsTable, campaignRunResultsTable, campaignsTable, leadsTable, logsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requestCancellation } from "../scheduler/pipeline";

const router = Router();

// List campaign runs (optionally filtered by campaignId)
router.get("/campaign-runs", async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;

  const runs = await db
    .select()
    .from(campaignRunsTable)
    .where(campaignId !== undefined ? eq(campaignRunsTable.campaignId, campaignId) : undefined)
    .orderBy(desc(campaignRunsTable.startedAt));

  res.json(runs);
});

// Get a single campaign run
router.get("/campaign-runs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.json(run);
});

// Get leads for a campaign run
router.get("/campaign-runs/:id/leads", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const leads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.campaignRunId, id))
    .orderBy(desc(leadsTable.createdAt));

  res.json(leads);
});

// Get results (blocked / duplicate / lead_created / rejected / skipped_recent) for a run
router.get("/campaign-runs/:id/results", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const rows = await db
    .select()
    .from(campaignRunResultsTable)
    .where(
      status
        ? and(
            eq(campaignRunResultsTable.campaignRunId, id),
            eq(campaignRunResultsTable.resultStatus, status),
          )
        : eq(campaignRunResultsTable.campaignRunId, id),
    )
    .orderBy(desc(campaignRunResultsTable.createdAt))
    .limit(500);

  res.json(rows);
});

// Delete a campaign run — leads are kept, their campaign_run_id is set to null via FK SET NULL.
// To also delete leads, first call POST /leads/bulk-delete with the run's lead IDs.
router.delete("/campaign-runs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (run.status === "running") {
    res.status(400).json({
      error: "Cannot delete a running campaign run. Wait until it finishes or mark it failed first.",
    });
    return;
  }

  // Deleting the run sets leads.campaign_run_id = null via SET NULL FK automatically.
  await db.delete(campaignRunsTable).where(eq(campaignRunsTable.id, id));

  res.status(204).send();
});

// Cancel a running campaign run
router.post("/campaign-runs/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (run.status !== "running") {
    res.status(400).json({ error: "Run is not currently running" });
    return;
  }

  // Signal the in-process pipeline to stop at the next safe checkpoint
  requestCancellation(id);

  // Immediately mark as cancelled in the DB so the UI reflects the change
  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - new Date(run.startedAt).getTime()) / 1000);

  const [updated] = await db
    .update(campaignRunsTable)
    .set({ status: "cancelled", completedAt: now, durationSeconds, progressPercent: 100 })
    .where(eq(campaignRunsTable.id, id))
    .returning();

  await db
    .update(campaignsTable)
    .set({ lastRunStatus: "cancelled" })
    .where(eq(campaignsTable.id, run.campaignId));

  await db.insert(logsTable).values({
    campaignId: run.campaignId,
    type: "workflow",
    message: `Campaign run #${id} cancelled by user after ${durationSeconds}s. Leads already discovered are preserved.`,
  });

  res.json(updated);
  return;
});

export default router;
