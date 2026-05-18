import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignRunsTable,
  leadsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCampaign(name = `Del-Campaign-${Date.now()}`) {
  const [c] = await db
    .insert(campaignsTable)
    .values({ name, objective: "Test", isActive: true })
    .returning();
  return c!;
}

async function createRun(campaignId: number, status: "completed" | "running" | "failed" = "completed") {
  const [r] = await db
    .insert(campaignRunsTable)
    .values({ campaignId, status, startedAt: new Date() })
    .returning();
  return r!;
}

async function createLead(campaignId: number, campaignRunId: number | null = null) {
  const slug = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rootDomain = `test-${slug}.com`;
  const websiteUrl = `https://test-${slug}.com`;
  const [l] = await db
    .insert(leadsTable)
    .values({
      campaignId,
      campaignRunId,
      rootDomain,
      websiteUrl,
      companyName: "Test Co",
    })
    .returning();
  return l!;
}

// ---------------------------------------------------------------------------
// DELETE /api/campaign-runs/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/campaign-runs/:id", () => {
  it("returns 404 for a non-existent run", async () => {
    const res = await request(app).delete("/api/campaign-runs/999999999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a running run", async () => {
    const campaign = await createCampaign();
    const run = await createRun(campaign.id, "running");

    const res = await request(app).delete(`/api/campaign-runs/${run.id}`);
    expect(res.status).toBe(400);

    // cleanup
    await db.delete(campaignRunsTable).where(eq(campaignRunsTable.id, run.id));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });

  it("deletes a completed run and nulls lead campaign_run_id (SET NULL)", async () => {
    const campaign = await createCampaign();
    const run = await createRun(campaign.id, "completed");
    const lead = await createLead(campaign.id, run.id);

    const res = await request(app).delete(`/api/campaign-runs/${run.id}`);
    expect(res.status).toBe(204);

    // run should be gone
    const runs = await db.select().from(campaignRunsTable).where(eq(campaignRunsTable.id, run.id));
    expect(runs).toHaveLength(0);

    // lead should still exist with null campaignRunId
    const leads = await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id));
    expect(leads).toHaveLength(1);
    expect(leads[0]!.campaignRunId).toBeNull();

    // cleanup
    await db.delete(leadsTable).where(eq(leadsTable.id, lead.id));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });

  it("deletes a failed run", async () => {
    const campaign = await createCampaign();
    const run = await createRun(campaign.id, "failed");

    const res = await request(app).delete(`/api/campaign-runs/${run.id}`);
    expect(res.status).toBe(204);

    const runs = await db.select().from(campaignRunsTable).where(eq(campaignRunsTable.id, run.id));
    expect(runs).toHaveLength(0);

    // cleanup
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });
});

// ---------------------------------------------------------------------------
// POST /api/leads/bulk-delete
// ---------------------------------------------------------------------------

describe("POST /api/leads/bulk-delete", () => {
  it("deletes multiple leads by ID", async () => {
    const campaign = await createCampaign();
    const lead1 = await createLead(campaign.id);
    const lead2 = await createLead(campaign.id);

    const res = await request(app)
      .post("/api/leads/bulk-delete")
      .send({ ids: [lead1.id, lead2.id] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    const remaining = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.campaignId, campaign.id));
    expect(remaining).toHaveLength(0);

    // cleanup
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });

  it("returns deleted: 0 for an empty ids array (no-op)", async () => {
    const res = await request(app)
      .post("/api/leads/bulk-delete")
      .send({ ids: [] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  it("returns 400 when ids is missing or not an array of numbers", async () => {
    const res = await request(app)
      .post("/api/leads/bulk-delete")
      .send({});
    expect(res.status).toBe(400);

    const res2 = await request(app)
      .post("/api/leads/bulk-delete")
      .send({ ids: ["not-a-number"] });
    expect(res2.status).toBe(400);
  });

  it("silently ignores non-existent IDs (returns 0)", async () => {
    const res = await request(app)
      .post("/api/leads/bulk-delete")
      .send({ ids: [999999998, 999999999] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/reset-data
// ---------------------------------------------------------------------------

describe("POST /api/campaigns/:id/reset-data", () => {
  it("returns 404 for a non-existent campaign", async () => {
    const res = await request(app).post("/api/campaigns/999999999/reset-data");
    expect(res.status).toBe(404);
  });

  it("deletes all runs and leads for a campaign, keeps the campaign", async () => {
    const campaign = await createCampaign();
    const run = await createRun(campaign.id, "completed");
    const lead1 = await createLead(campaign.id, run.id);
    const lead2 = await createLead(campaign.id, null);

    const res = await request(app).post(`/api/campaigns/${campaign.id}/reset-data`);

    expect(res.status).toBe(200);
    expect(res.body.deletedRuns).toBe(1);
    expect(res.body.deletedLeads).toBe(2);

    // campaign still exists
    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaign.id));
    expect(campaigns).toHaveLength(1);

    // runs gone
    const runs = await db
      .select()
      .from(campaignRunsTable)
      .where(eq(campaignRunsTable.campaignId, campaign.id));
    expect(runs).toHaveLength(0);

    // leads gone
    const leads = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.campaignId, campaign.id));
    expect(leads).toHaveLength(0);

    // cleanup
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });

  it("returns deletedRuns: 0 and deletedLeads: 0 for an empty campaign", async () => {
    const campaign = await createCampaign();

    const res = await request(app).post(`/api/campaigns/${campaign.id}/reset-data`);

    expect(res.status).toBe(200);
    expect(res.body.deletedRuns).toBe(0);
    expect(res.body.deletedLeads).toBe(0);

    // cleanup
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaign.id));
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/campaigns/:id (existing endpoint — regression tests)
// ---------------------------------------------------------------------------

describe("DELETE /api/campaigns/:id", () => {
  it("returns 404 for a non-existent campaign", async () => {
    const res = await request(app).delete("/api/campaigns/999999999");
    expect(res.status).toBe(404);
  });

  it("deletes a campaign and cascades to runs and leads", async () => {
    const campaign = await createCampaign();
    const run = await createRun(campaign.id, "completed");
    await createLead(campaign.id, run.id);

    const res = await request(app).delete(`/api/campaigns/${campaign.id}`);
    expect(res.status).toBe(204);

    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaign.id));
    expect(campaigns).toHaveLength(0);

    const runs = await db
      .select()
      .from(campaignRunsTable)
      .where(eq(campaignRunsTable.campaignId, campaign.id));
    expect(runs).toHaveLength(0);

    const leads = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.campaignId, campaign.id));
    expect(leads).toHaveLength(0);
  });
});
