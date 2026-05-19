import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignKeywordsTable,
  campaignCountriesTable,
  leadsTable,
  logsTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { SerperOrganicResult } from "../services/serper";
import { extractRootDomain } from "../services/serper";

// ---------------------------------------------------------------------------
// Mock Serper so no real API calls are made in automated tests
// ---------------------------------------------------------------------------
vi.mock("../services/serper", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/serper")>();
  return {
    ...actual,
    searchSerper: vi.fn(),
  };
});

// Pull the mock reference after hoisting
const { searchSerper } = await import("../services/serper");
const mockSearchSerper = vi.mocked(searchSerper);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResults(domains: string[]): SerperOrganicResult[] {
  return domains.map((d, i) => ({
    title: `Company at ${d}`,
    link: `https://${d}/about`,
    snippet: `We are ${d}`,
    position: i + 1,
  }));
}

async function createTestCampaign(
  overrides: Partial<{
    name: string;
    isActive: boolean;
    maxSearchesPerDay: number;
  }> = {},
) {
  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      name: overrides.name ?? `Test Campaign ${Date.now()}`,
      objective: "Test objective",
      isActive: overrides.isActive ?? true,
      maxSearchesPerDay: overrides.maxSearchesPerDay ?? 100,
    })
    .returning();
  return campaign!;
}

async function addKeyword(campaignId: number, keyword: string) {
  await db.insert(campaignKeywordsTable).values({ campaignId, keyword });
}

async function addCountry(campaignId: number, country: string) {
  await db.insert(campaignCountriesTable).values({ campaignId, country });
}

async function cleanupCampaign(campaignId: number) {
  await db.delete(campaignsTable).where(eq(campaignsTable.id, campaignId));
}

// ---------------------------------------------------------------------------
// Unit tests — extractRootDomain (pure function, no mocking needed)
// ---------------------------------------------------------------------------
describe("extractRootDomain", () => {
  it("extracts root domain from a standard https URL", () => {
    expect(extractRootDomain("https://example.com/page")).toBe("example.com");
  });

  it("strips www prefix", () => {
    expect(extractRootDomain("https://www.example.com/page")).toBe(
      "example.com",
    );
  });

  it("preserves subdomains other than www", () => {
    expect(extractRootDomain("https://app.example.com/dashboard")).toBe(
      "app.example.com",
    );
  });

  it("handles URLs without protocol", () => {
    expect(extractRootDomain("example.com/path")).toBe("example.com");
  });

  it("returns null for invalid URL", () => {
    expect(extractRootDomain("not a url at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractRootDomain("")).toBeNull();
  });

  it("lowercases the result", () => {
    expect(extractRootDomain("https://EXAMPLE.COM/page")).toBe("example.com");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — POST /api/campaigns/:id/run-discovery
// ---------------------------------------------------------------------------
describe("POST /api/campaigns/:id/run-discovery", () => {
  let testCampaignId: number;
  const originalApiKey = process.env["SERPER_API_KEY"];

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env["SERPER_API_KEY"] = "test-key-12345";
    // Default mock returns empty results unless overridden per-test
    mockSearchSerper.mockResolvedValue([]);
    // Seed blocked_domains so domain-filtering tests work against a clean DB
    await db
      .insert(appSettingsTable)
      .values({
        key: "blocked_domains",
        value: "linkedin.com\ngoogle.com\nfacebook.com\ntwitter.com\nglassdoor.com\nindeed.com",
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: {
          value: "linkedin.com\ngoogle.com\nfacebook.com\ntwitter.com\nglassdoor.com\nindeed.com",
        },
      });
  });

  afterEach(async () => {
    process.env["SERPER_API_KEY"] = originalApiKey;
    // Remove seeded settings
    await db
      .delete(appSettingsTable)
      .where(eq(appSettingsTable.key, "blocked_domains"));
    if (testCampaignId) {
      await cleanupCampaign(testCampaignId);
      testCampaignId = 0;
    }
  });

  // ── 1. Guard rails ────────────────────────────────────────────────────────

  it("returns 400 when SERPER_API_KEY is not set", async () => {
    delete process.env["SERPER_API_KEY"];
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(400);

    expect(res.body.error).toMatch(/SERPER_API_KEY/i);
  });

  it("returns 404 when campaign does not exist", async () => {
    const res = await request(app)
      .post("/api/campaigns/999999/run-discovery")
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 when campaign is inactive", async () => {
    const campaign = await createTestCampaign({ isActive: false });
    testCampaignId = campaign.id;

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(400);

    expect(res.body.error).toMatch(/not active/i);
  });

  it("returns 400 for non-numeric campaign ID", async () => {
    const res = await request(app)
      .post("/api/campaigns/abc/run-discovery")
      .expect(400);

    expect(res.body.error).toMatch(/invalid campaign id/i);
  });

  // ── 2. Domain filtering ───────────────────────────────────────────────────

  it("skips blocked domains and reports them in summary", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "test keyword");
    await addCountry(testCampaignId, "USA");

    // The seed app_settings has blocked_domains including linkedin.com, google.com etc.
    mockSearchSerper.mockResolvedValue(
      makeResults(["linkedin.com", "google.com", "uniquefirmtest-9182.com"]),
    );

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    expect(res.body.blockedSkipped).toBeGreaterThanOrEqual(2);
    expect(res.body.newLeadsCreated).toBe(1);
    expect(res.body.searchesPerformed).toBe(1);
  });

  it("skips duplicate domains already in the campaign", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "test keyword");
    await addCountry(testCampaignId, "USA");

    // Pre-insert a lead with the same domain
    await db.insert(leadsTable).values({
      campaignId: testCampaignId,
      companyName: "Pre-existing Corp",
      rootDomain: "pre-existing-corp-test.com",
      websiteUrl: "https://pre-existing-corp-test.com",
      leadStatus: "discovered",
      reviewStatus: "pending",
      emailStatus: "not_sent",
      relevanceScore: 0,
      relevanceReason: "",
    });

    mockSearchSerper.mockResolvedValue(
      makeResults([
        "pre-existing-corp-test.com", // duplicate
        "brand-new-test-firm-7654.com", // fresh
      ]),
    );

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    expect(res.body.duplicatesSkipped).toBeGreaterThanOrEqual(1);
    expect(res.body.newLeadsCreated).toBe(1);
  });

  it("does not deduplicate across different campaigns", async () => {
    // Create two separate campaigns
    const campaignA = await createTestCampaign({ name: "Campaign A test" });
    const campaignB = await createTestCampaign({ name: "Campaign B test" });
    testCampaignId = campaignA.id; // cleanup in afterEach

    // Pre-insert the domain only in campaign A
    await db.insert(leadsTable).values({
      campaignId: campaignA.id,
      companyName: "Shared Domain Corp",
      rootDomain: "shared-domain-test-3311.com",
      websiteUrl: "https://shared-domain-test-3311.com",
      leadStatus: "discovered",
      reviewStatus: "pending",
      emailStatus: "not_sent",
      relevanceScore: 0,
      relevanceReason: "",
    });

    // Run discovery on campaign B with same domain
    await addKeyword(campaignB.id, "test keyword");
    await addCountry(campaignB.id, "USA");
    mockSearchSerper.mockResolvedValue(
      makeResults(["shared-domain-test-3311.com"]),
    );

    const res = await request(app)
      .post(`/api/campaigns/${campaignB.id}/run-discovery`)
      .expect(200);

    // Should create the lead in campaign B (not considered a duplicate)
    expect(res.body.newLeadsCreated).toBe(1);

    // Cleanup campaign B separately
    await cleanupCampaign(campaignB.id);
  });

  // ── 3. Lead creation ──────────────────────────────────────────────────────

  it("creates leads with correct fields for new domains", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "AI video dataset");
    await addCountry(testCampaignId, "Germany");

    mockSearchSerper.mockResolvedValue([
      {
        title: "DataVault GmbH - AI Data Solutions",
        link: "https://datavault-test-5541.de/services",
        snippet: "We provide training data",
        position: 1,
      },
    ]);

    await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    const leads = await db
      .select()
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.campaignId, testCampaignId),
          eq(leadsTable.rootDomain, "datavault-test-5541.de"),
        ),
      );

    expect(leads).toHaveLength(1);
    const lead = leads[0]!;
    expect(lead.rootDomain).toBe("datavault-test-5541.de");
    expect(lead.websiteUrl).toBe("https://datavault-test-5541.de/services");
    expect(lead.leadStatus).toBe("discovered");
    expect(lead.reviewStatus).toBe("pending");
    expect(lead.emailStatus).toBe("not_sent");
    expect(lead.relevanceScore).toBe(0);
    expect(lead.sourceKeyword).toBe("AI video dataset");
    expect(lead.sourceCountry).toBe("Germany");
    expect(lead.sourceQuery).toBe("AI video dataset Germany");
    expect(lead.campaignId).toBe(testCampaignId);
  });

  it("returns accurate summary counts", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "video AI");
    await addCountry(testCampaignId, "USA");

    mockSearchSerper.mockResolvedValue(
      makeResults([
        "fresh-lead-one-test.com",
        "fresh-lead-two-test.com",
        "linkedin.com", // blocked
      ]),
    );

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    expect(res.body.campaignId).toBe(testCampaignId);
    expect(res.body.searchesPerformed).toBe(1);
    expect(res.body.resultsFound).toBe(3);
    expect(res.body.newLeadsCreated).toBe(2);
    expect(res.body.blockedSkipped).toBeGreaterThanOrEqual(1);
    expect(res.body.queries).toContain("video AI USA");
  });

  // ── 4. Search cap ─────────────────────────────────────────────────────────

  it("respects max_searches_per_day and stops early", async () => {
    const campaign = await createTestCampaign({ maxSearchesPerDay: 1 });
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "keyword one");
    await addKeyword(testCampaignId, "keyword two");
    await addCountry(testCampaignId, "USA");

    mockSearchSerper.mockResolvedValue(makeResults(["domain-cap-test.com"]));

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    expect(mockSearchSerper).toHaveBeenCalledTimes(1);
    expect(res.body.searchesPerformed).toBe(1);
    expect(res.body.queries).toHaveLength(1);
  });

  it("runs keyword × country as query pairs", async () => {
    const campaign = await createTestCampaign({ maxSearchesPerDay: 10 });
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "egocentric video");
    await addCountry(testCampaignId, "Canada");
    await addCountry(testCampaignId, "UK");

    mockSearchSerper.mockResolvedValue([]);

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    expect(res.body.queries).toContain("egocentric video Canada");
    expect(res.body.queries).toContain("egocentric video UK");
    expect(res.body.searchesPerformed).toBe(2);
  });

  // ── 5. Logging ────────────────────────────────────────────────────────────

  it("creates discovery start and completion log entries", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "test kw");
    await addCountry(testCampaignId, "USA");

    mockSearchSerper.mockResolvedValue([]);

    await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    const logs = await db
      .select()
      .from(logsTable)
      .where(eq(logsTable.campaignId, testCampaignId));

    const types = logs.map((l) => l.type);
    expect(types).toContain("discovery"); // start + completion
    expect(types).toContain("search");
  });

  it("creates a lead log entry for each new lead", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "test kw");
    await addCountry(testCampaignId, "USA");

    mockSearchSerper.mockResolvedValue(
      makeResults(["new-domain-log-test.com"]),
    );

    await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    const logs = await db
      .select()
      .from(logsTable)
      .where(
        and(
          eq(logsTable.campaignId, testCampaignId),
          eq(logsTable.type, "lead"),
        ),
      );

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.message).toContain("new-domain-log-test.com");
  });

  it("logs filter events when domains are blocked or duplicate", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "test kw");
    await addCountry(testCampaignId, "USA");

    mockSearchSerper.mockResolvedValue(makeResults(["linkedin.com"]));

    await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    const filterLogs = await db
      .select()
      .from(logsTable)
      .where(
        and(
          eq(logsTable.campaignId, testCampaignId),
          eq(logsTable.type, "filter"),
        ),
      );

    expect(filterLogs.length).toBeGreaterThanOrEqual(1);
    expect(filterLogs[0]!.message).toContain("linkedin.com");
  });

  // ── 6. Edge cases ─────────────────────────────────────────────────────────

  it("handles campaign with no keywords gracefully (zero searches)", async () => {
    const campaign = await createTestCampaign();
    testCampaignId = campaign.id;
    // No keywords, no countries added

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    expect(res.body.searchesPerformed).toBe(0);
    expect(res.body.newLeadsCreated).toBe(0);
    expect(mockSearchSerper).not.toHaveBeenCalled();
  });

  it("handles Serper API error gracefully and continues", async () => {
    const campaign = await createTestCampaign({ maxSearchesPerDay: 10 });
    testCampaignId = campaign.id;
    await addKeyword(testCampaignId, "failing keyword");
    await addCountry(testCampaignId, "USA");

    mockSearchSerper.mockRejectedValue(new Error("Serper API error 429: rate limited"));

    const res = await request(app)
      .post(`/api/campaigns/${testCampaignId}/run-discovery`)
      .expect(200);

    // Route should handle the error and return a valid summary
    expect(res.body.searchesPerformed).toBe(0); // search failed, not counted
    expect(res.body.newLeadsCreated).toBe(0);

    // Should have logged the error
    const errorLogs = await db
      .select()
      .from(logsTable)
      .where(
        and(
          eq(logsTable.campaignId, testCampaignId),
          eq(logsTable.type, "error"),
        ),
      );
    expect(errorLogs.length).toBeGreaterThanOrEqual(1);
    expect(errorLogs[0]!.message).toContain("rate limited");
  });
});
