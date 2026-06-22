import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignRunsTable,
  campaignRunResultsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCampaign() {
  const [c] = await db
    .insert(campaignsTable)
    .values({
      name: `Test campaign ${Date.now()}`,
      isActive: true,
      isPaused: false,
      objective: "test",
      minRelevanceScore: 5,
      maxSearchesPerDay: 3,
      maxEmailsPerDay: 5,
      resultsPerSearch: 10,
      scheduleType: "manual",
      lastRunStatus: "success",
    })
    .returning();
  return c!;
}

async function createRun(
  campaignId: number,
  overrides: Partial<typeof campaignRunsTable.$inferInsert> = {},
) {
  const [r] = await db
    .insert(campaignRunsTable)
    .values({
      campaignId,
      runName: `Test run ${Date.now()}`,
      runType: "manual",
      status: "running",
      currentStage: "searching",
      ...overrides,
    })
    .returning();
  return r!;
}

// ---------------------------------------------------------------------------
// Test 1: Run stays running after Serper returns (current_stage = "searching")
// ---------------------------------------------------------------------------

describe("GET /api/campaign-runs/:id — lifecycle stages", () => {
  let campaignId: number;
  let runId: number;

  beforeEach(async () => {
    const c = await createCampaign();
    campaignId = c.id;
    const r = await createRun(campaignId, { currentStage: "searching" });
    runId = r.id;
  });

  afterEach(async () => {
    await db.delete(campaignRunsTable).where(eq(campaignRunsTable.campaignId, campaignId));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaignId));
  });

  it("run stays 'running' while stage is 'searching'", async () => {
    const res = await request(app)
      .get(`/api/campaign-runs/${runId}`)
      .expect(200);

    expect(res.body.status).toBe("running");
    expect(res.body.currentStage).toBe("searching");
  });

  it("run stays 'running' while stage is 'crawling'", async () => {
    await db
      .update(campaignRunsTable)
      .set({ currentStage: "crawling" })
      .where(eq(campaignRunsTable.id, runId));

    const res = await request(app)
      .get(`/api/campaign-runs/${runId}`)
      .expect(200);

    expect(res.body.status).toBe("running");
    expect(res.body.currentStage).toBe("crawling");
  });

  it("run stays 'running' while stage is 'scoring'", async () => {
    await db
      .update(campaignRunsTable)
      .set({ currentStage: "scoring" })
      .where(eq(campaignRunsTable.id, runId));

    const res = await request(app)
      .get(`/api/campaign-runs/${runId}`)
      .expect(200);

    expect(res.body.status).toBe("running");
    expect(res.body.currentStage).toBe("scoring");
  });

  it("run is 'completed' only when status=completed and stage reflects finished state", async () => {
    await db
      .update(campaignRunsTable)
      .set({ status: "completed", currentStage: "completed", completedAt: new Date() })
      .where(eq(campaignRunsTable.id, runId));

    const res = await request(app)
      .get(`/api/campaign-runs/${runId}`)
      .expect(200);

    expect(res.body.status).toBe("completed");
    expect(res.body.currentStage).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Test 2: GET /campaign-runs/:id/results — results are stored and queryable
// ---------------------------------------------------------------------------

describe("GET /api/campaign-runs/:id/results", () => {
  let campaignId: number;
  let runId: number;

  beforeEach(async () => {
    const c = await createCampaign();
    campaignId = c.id;
    const r = await createRun(campaignId);
    runId = r.id;

    // Seed results
    await db.insert(campaignRunResultsTable).values([
      {
        campaignRunId: runId,
        campaignId,
        resultStatus: "blocked",
        title: "LinkedIn Company Page",
        url: "https://linkedin.com/company/acme",
        rootDomain: "linkedin.com",
        sourceQuery: "saas companies US",
        reason: "Blocked domain or junk content",
      },
      {
        campaignRunId: runId,
        campaignId,
        resultStatus: "blocked",
        title: "GitHub Repo",
        url: "https://github.com/acme/app",
        rootDomain: "github.com",
        sourceQuery: "ai startups US",
        reason: "Blocked domain or junk content",
      },
      {
        campaignRunId: runId,
        campaignId,
        resultStatus: "duplicate",
        title: "Acme Corp",
        url: "https://acme.com",
        rootDomain: "acme.com",
        sourceQuery: "saas companies US",
        reason: "Domain already exists in campaign leads",
      },
      {
        campaignRunId: runId,
        campaignId,
        resultStatus: "lead_created",
        title: "Beta Corp",
        url: "https://betacorp.io",
        rootDomain: "betacorp.io",
        sourceQuery: "saas companies US",
        reason: null,
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(campaignRunResultsTable).where(eq(campaignRunResultsTable.campaignRunId, runId));
    await db.delete(campaignRunsTable).where(eq(campaignRunsTable.id, runId));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaignId));
  });

  it("returns all results when no status filter", async () => {
    const res = await request(app)
      .get(`/api/campaign-runs/${runId}/results`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
  });

  it("filters blocked results correctly", async () => {
    const res = await request(app)
      .get(`/api/campaign-runs/${runId}/results?status=blocked`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body.every((r: { resultStatus: string }) => r.resultStatus === "blocked")).toBe(true);
  });

  it("stores blocked result fields correctly", async () => {
    const res = await request(app)
      .get(`/api/campaign-runs/${runId}/results?status=blocked`)
      .expect(200);

    const first = res.body.find((r: { rootDomain: string }) => r.rootDomain === "linkedin.com");
    expect(first).toBeDefined();
    expect(first.title).toBe("LinkedIn Company Page");
    expect(first.url).toBe("https://linkedin.com/company/acme");
    expect(first.sourceQuery).toBe("saas companies US");
    expect(first.reason).toBe("Blocked domain or junk content");
  });

  it("filters duplicate results correctly", async () => {
    const res = await request(app)
      .get(`/api/campaign-runs/${runId}/results?status=duplicate`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].resultStatus).toBe("duplicate");
    expect(res.body[0].rootDomain).toBe("acme.com");
    expect(res.body[0].reason).toBe("Domain already exists in campaign leads");
  });

  it("returns 400 for invalid run ID", async () => {
    await request(app)
      .get("/api/campaign-runs/abc/results")
      .expect(400);
  });

  it("returns empty array for run with no results", async () => {
    const r2 = await createRun(campaignId);
    const res = await request(app)
      .get(`/api/campaign-runs/${r2.id}/results`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);

    await db.delete(campaignRunsTable).where(eq(campaignRunsTable.id, r2.id));
  });
});

// ---------------------------------------------------------------------------
// Test 3: Campaign list running state — lastRunStatus stays "running" during run
// ---------------------------------------------------------------------------

describe("GET /api/campaigns — running state", () => {
  let campaignId: number;

  beforeEach(async () => {
    const c = await createCampaign();
    campaignId = c.id;
    // Simulate a running campaign
    await db
      .update(campaignsTable)
      .set({ lastRunStatus: "running" })
      .where(eq(campaignsTable.id, campaignId));
  });

  afterEach(async () => {
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaignId));
  });

  it("campaign shows lastRunStatus=running while pipeline is active", async () => {
    const res = await request(app)
      .get("/api/campaigns")
      .expect(200);

    const found = res.body.find((c: { id: number }) => c.id === campaignId);
    expect(found).toBeDefined();
    expect(found.lastRunStatus).toBe("running");
  });
});
