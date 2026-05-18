import { Router } from "express";
import { db } from "@workspace/db";
import { campaignRunsTable, leadsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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

export default router;
