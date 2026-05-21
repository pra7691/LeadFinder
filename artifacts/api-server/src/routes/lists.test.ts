import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  campaignsTable,
  campaignRunsTable,
  leadsTable,
  leadListsTable,
  leadListItemsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCampaign(name = `List-Campaign-${Date.now()}`) {
  const [c] = await db
    .insert(campaignsTable)
    .values({ name, objective: "Test", isActive: true })
    .returning();
  return c!;
}

async function createLead(
  campaignId: number,
  emails: string | null,
  name?: string,
) {
  const slug = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rootDomain = `test-${slug}.com`;
  const [l] = await db
    .insert(leadsTable)
    .values({
      campaignId,
      companyName: name ?? `Test ${slug}`,
      rootDomain,
      websiteUrl: `https://${rootDomain}`,
      emails,
    })
    .returning();
  return l!;
}

async function createList(campaignId?: number, name = `Test-List-${Date.now()}`) {
  const [list] = await db
    .insert(leadListsTable)
    .values({ name, campaignId: campaignId ?? null })
    .returning();
  return list!;
}

async function addLeadToList(listId: number, leadId: number) {
  await db.insert(leadListItemsTable).values({ listId, leadId }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// GET /api/lists/:id/health — Email parsing
// ---------------------------------------------------------------------------

describe("GET /api/lists/:id/health", () => {
  let campaignId: number;
  let listId: number;

  beforeEach(async () => {
    const campaign = await createCampaign();
    campaignId = campaign.id;
    const list = await createList(campaignId);
    listId = list.id;
  });

  afterEach(async () => {
    await db.delete(leadListItemsTable).where(eq(leadListItemsTable.listId, listId));
    await db.delete(leadListsTable).where(eq(leadListsTable.id, listId));
    await db.delete(leadsTable).where(eq(leadsTable.campaignId, campaignId));
    await db.delete(campaignRunsTable).where(eq(campaignRunsTable.campaignId, campaignId));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, campaignId));
  });

  it("counts emails stored as JSON arrays", async () => {
    const l1 = await createLead(campaignId, JSON.stringify(["a@example.com"]));
    const l2 = await createLead(campaignId, JSON.stringify(["b@example.com", "sales@example.com"]));
    const l3 = await createLead(campaignId, JSON.stringify([]));
    const l4 = await createLead(campaignId, null);

    await addLeadToList(listId, l1.id);
    await addLeadToList(listId, l2.id);
    await addLeadToList(listId, l3.id);
    await addLeadToList(listId, l4.id);

    const res = await request(app).get(`/api/lists/${listId}/health`).expect(200);

    expect(res.body.totalLeads).toBe(4);
    expect(res.body.leadsWithEmail).toBe(2);
    expect(res.body.leadsWithoutEmail).toBe(2);
  });

  it("counts emails stored as comma-separated strings", async () => {
    const l1 = await createLead(campaignId, "x@test.com, y@test.com");
    const l2 = await createLead(campaignId, "z@test.com");
    const l3 = await createLead(campaignId, "");

    await addLeadToList(listId, l1.id);
    await addLeadToList(listId, l2.id);
    await addLeadToList(listId, l3.id);

    const res = await request(app).get(`/api/lists/${listId}/health`).expect(200);

    expect(res.body.totalLeads).toBe(3);
    expect(res.body.leadsWithEmail).toBe(2);
    expect(res.body.leadsWithoutEmail).toBe(1);
  });

  it("counts emails stored as semicolon-separated strings", async () => {
    const l1 = await createLead(campaignId, "a@corp.com; b@corp.com; c@corp.com");
    const l2 = await createLead(campaignId, null);

    await addLeadToList(listId, l1.id);
    await addLeadToList(listId, l2.id);

    const res = await request(app).get(`/api/lists/${listId}/health`).expect(200);

    expect(res.body.totalLeads).toBe(2);
    expect(res.body.leadsWithEmail).toBe(1);
    expect(res.body.leadsWithoutEmail).toBe(1);
  });

  it("ignores invalid entries that do not contain @", async () => {
    const l1 = await createLead(campaignId, "not-an-email, also-bad");
    const l2 = await createLead(campaignId, JSON.stringify(["valid@ok.com", ""]));

    await addLeadToList(listId, l1.id);
    await addLeadToList(listId, l2.id);

    const res = await request(app).get(`/api/lists/${listId}/health`).expect(200);

    expect(res.body.totalLeads).toBe(2);
    expect(res.body.leadsWithEmail).toBe(1);
    expect(res.body.leadsWithoutEmail).toBe(1);
  });
});
