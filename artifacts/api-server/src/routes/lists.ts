import { Router } from "express";
import { db } from "@workspace/db";
import {
  leadListsTable,
  leadListItemsTable,
  leadsTable,
  campaignsTable,
  campaignRunsTable,
  outreachQueueTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc, or } from "drizzle-orm";
import { classifyEmail } from "../services/email-validator";
import { parseLeadEmails } from "../services/lead-emails";

const router = Router();

/**
 * For a batch of email addresses, find matching leads in the database by searching
 * the leads.emails field.  Returns a Map of email → leadId for every email that
 * has a matching lead record.
 */
async function matchEmailsToLeads(emails: string[]): Promise<Map<string, number>> {
  if (emails.length === 0) return new Map();

  // Broad ILIKE search: fetch every lead whose emails text contains at least one
  // of the import addresses as a substring.  We'll do exact verification below.
  const conditions = emails.map((e) => sql`${leadsTable.emails} ILIKE ${`%${e}%`}`);
  const rows = await db
    .select({ id: leadsTable.id, emails: leadsTable.emails })
    .from(leadsTable)
    .where(or(...conditions));

  // Exact-match verification: parseLeadEmails handles both JSON and CSV formats.
  const result = new Map<string, number>();
  for (const email of emails) {
    const lc = email.toLowerCase();
    for (const lead of rows) {
      const leadEmails = parseLeadEmails(lead.emails).map((e) => e.toLowerCase());
      if (leadEmails.includes(lc)) {
        result.set(email, lead.id);
        break; // first match wins
      }
    }
  }
  return result;
}

// List all lead lists (with lead count + campaign name)
router.get("/lists", async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
  const includeArchived = req.query.includeArchived === "true";

  const conditions = [];
  if (campaignId !== undefined) {
    conditions.push(eq(leadListsTable.campaignId, campaignId));
  }
  if (!includeArchived) {
    conditions.push(eq(leadListsTable.listStatus, "active"));
  }

  // Join with campaigns for name and count items
  const rows = await db
    .select({
      id: leadListsTable.id,
      name: leadListsTable.name,
      description: leadListsTable.description,
      campaignId: leadListsTable.campaignId,
      campaignName: campaignsTable.name,
      listStatus: leadListsTable.listStatus,
      createdAt: leadListsTable.createdAt,
      updatedAt: leadListsTable.updatedAt,
      leadCount: sql<number>`cast(count(${leadListItemsTable.id}) as int)`,
      leadsWithEmail: sql<number>`cast((
        select count(*)
        from lead_list_items lli2
        left join leads l on l.id = lli2.lead_id
        where lli2.list_id = ${leadListsTable.id}
          and (
            (lli2.email is not null and lli2.email != '')
            or (l.emails is not null and l.emails != '')
          )
      ) as int)`,
      hasOutreach: sql<boolean>`exists (
        select 1 from outreach_queue oq
        where oq.list_id = ${leadListsTable.id}
      )`,
      campaignRunNames: sql<string>`(
        select string_agg(distinct cr.run_name, ', ' order by cr.run_name)
        from lead_list_items lli2
        join leads l on l.id = lli2.lead_id
        join campaign_runs cr on cr.id = l.campaign_run_id
        where lli2.list_id = ${leadListsTable.id}
          and cr.run_name is not null
      )`,
    })
    .from(leadListsTable)
    .leftJoin(campaignsTable, eq(leadListsTable.campaignId, campaignsTable.id))
    .leftJoin(leadListItemsTable, eq(leadListItemsTable.listId, leadListsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(
      leadListsTable.id,
      leadListsTable.name,
      leadListsTable.description,
      leadListsTable.campaignId,
      campaignsTable.name,
      leadListsTable.listStatus,
      leadListsTable.createdAt,
      leadListsTable.updatedAt,
    )
    .orderBy(desc(leadListsTable.createdAt));

  res.json(rows.map((r) => ({ ...r, leadCount: r.leadCount ?? 0 })));
});

// Create a list (optionally with manual emails)
router.post("/lists", async (req, res) => {
  const { name, description, campaignId, emails } = req.body as {
    name?: string;
    description?: string;
    campaignId?: number;
    /** Optional manual emails to add immediately: [{ email, companyName? }] */
    emails?: Array<{ email: string; companyName?: string }>;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [list] = await db
    .insert(leadListsTable)
    .values({ name: name.trim(), description: description ?? null, campaignId: campaignId ?? null })
    .returning();

  let emailsAdded = 0;
  if (Array.isArray(emails) && emails.length > 0) {
    const valid = emails
      .map((e) => ({ email: e.email?.trim().toLowerCase(), companyName: e.companyName?.trim() || null }))
      .filter((e) => e.email && e.email.includes("@") && e.email.length <= 254);
    if (valid.length > 0) {
      const emailToLeadId = await matchEmailsToLeads(valid.map((e) => e.email));
      await db.insert(leadListItemsTable).values(
        valid.map((e) => ({
          listId: list.id,
          leadId: emailToLeadId.get(e.email) ?? null,
          email: e.email,
          companyName: e.companyName,
        })),
      ).onConflictDoNothing();
      emailsAdded = valid.length;
    }
  }

  res.status(201).json({ ...list, leadCount: emailsAdded, campaignName: null });
});

// Get a single list (with count)
router.get("/lists/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  const [row] = await db
    .select({
      id: leadListsTable.id,
      name: leadListsTable.name,
      description: leadListsTable.description,
      campaignId: leadListsTable.campaignId,
      campaignName: campaignsTable.name,
      listStatus: leadListsTable.listStatus,
      createdAt: leadListsTable.createdAt,
      updatedAt: leadListsTable.updatedAt,
      leadCount: sql<number>`cast(count(${leadListItemsTable.id}) as int)`,
    })
    .from(leadListsTable)
    .leftJoin(campaignsTable, eq(leadListsTable.campaignId, campaignsTable.id))
    .leftJoin(leadListItemsTable, eq(leadListItemsTable.listId, leadListsTable.id))
    .where(eq(leadListsTable.id, id))
    .groupBy(
      leadListsTable.id,
      leadListsTable.name,
      leadListsTable.description,
      leadListsTable.campaignId,
      campaignsTable.name,
      leadListsTable.listStatus,
      leadListsTable.createdAt,
      leadListsTable.updatedAt,
    );

  if (!row) { res.status(404).json({ error: "List not found" }); return; }
  res.json({ ...row, leadCount: row.leadCount ?? 0 });
});

// Update a list
router.patch("/lists/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  const { name, description, campaignId, listStatus } = req.body as {
    name?: string;
    description?: string | null;
    campaignId?: number | null;
    listStatus?: string;
  };

  const patch: Partial<typeof leadListsTable.$inferInsert> = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (campaignId !== undefined) patch.campaignId = campaignId;
  if (listStatus !== undefined) patch.listStatus = listStatus;

  const [updated] = await db
    .update(leadListsTable)
    .set(patch)
    .where(eq(leadListsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "List not found" }); return; }
  res.json({ ...updated, leadCount: 0, campaignName: null });
});

// Delete a list
router.delete("/lists/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  await db.delete(leadListsTable).where(eq(leadListsTable.id, id));
  res.status(204).end();
});

// Get leads in a list
router.get("/lists/:id/leads", async (req, res) => {
  const listId = Number(req.params.id);
  if (isNaN(listId)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  const items = await db
    .select({ lead: leadsTable })
    .from(leadListItemsTable)
    .innerJoin(leadsTable, eq(leadListItemsTable.leadId, leadsTable.id))
    .where(eq(leadListItemsTable.listId, listId))
    .orderBy(leadListItemsTable.addedAt);

  res.json(items.map((r) => r.lead));
});

// Add leads to a list
router.post("/lists/:id/leads", async (req, res) => {
  const listId = Number(req.params.id);
  if (isNaN(listId)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  const { leadIds } = req.body as { leadIds?: number[] };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    res.status(400).json({ error: "leadIds must be a non-empty array" });
    return;
  }

  const [list] = await db.select().from(leadListsTable).where(eq(leadListsTable.id, listId));
  if (!list) { res.status(404).json({ error: "List not found" }); return; }

  const existing = await db
    .select({ leadId: leadListItemsTable.leadId })
    .from(leadListItemsTable)
    .where(and(eq(leadListItemsTable.listId, listId), inArray(leadListItemsTable.leadId, leadIds)));

  const existingIds = new Set(existing.map((e) => e.leadId));
  const newIds = leadIds.filter((id) => !existingIds.has(id));

  if (newIds.length > 0) {
    await db.insert(leadListItemsTable).values(
      newIds.map((leadId) => ({ listId, leadId })),
    );
  }

  res.json({ added: newIds.length, duplicates: existingIds.size });
});

// Remove a lead from a list
router.delete("/lists/:id/leads/:leadId", async (req, res) => {
  const listId = Number(req.params.id);
  const leadId = Number(req.params.leadId);
  if (isNaN(listId) || isNaN(leadId)) {
    res.status(400).json({ error: "Invalid IDs" });
    return;
  }

  await db
    .delete(leadListItemsTable)
    .where(and(eq(leadListItemsTable.listId, listId), eq(leadListItemsTable.leadId, leadId)));

  res.status(204).end();
});

// POST /lists/:id/emails — add manual email-only items to a list
router.post("/lists/:id/emails", async (req, res) => {
  const listId = Number(req.params.id);
  if (isNaN(listId)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  const { emails } = req.body as {
    emails?: Array<{ email: string; companyName?: string }>;
  };

  if (!Array.isArray(emails) || emails.length === 0) {
    res.status(400).json({ error: "emails must be a non-empty array" });
    return;
  }

  const [list] = await db.select({ id: leadListsTable.id }).from(leadListsTable).where(eq(leadListsTable.id, listId));
  if (!list) { res.status(404).json({ error: "List not found" }); return; }

  const valid = emails
    .map((e) => ({ email: e.email?.trim().toLowerCase(), companyName: e.companyName?.trim() || null }))
    .filter((e) => e.email && e.email.includes("@") && e.email.length <= 254);

  const skipped = emails.length - valid.length;

  if (valid.length === 0) {
    res.json({ added: 0, skipped });
    return;
  }

  const emailToLeadId = await matchEmailsToLeads(valid.map((e) => e.email));
  await db.insert(leadListItemsTable).values(
    valid.map((e) => ({
      listId,
      leadId: emailToLeadId.get(e.email) ?? null,
      email: e.email,
      companyName: e.companyName,
    })),
  ).onConflictDoNothing();

  res.json({ added: valid.length, skipped });
});

// GET /lists/:id/health — List health summary
router.get("/lists/:id/health", async (req, res) => {
  const listId = Number(req.params.id);
  if (isNaN(listId)) { res.status(400).json({ error: "Invalid list ID" }); return; }

  // Get all leads in the list
  const items = await db
    .select({ lead: leadsTable })
    .from(leadListItemsTable)
    .innerJoin(leadsTable, eq(leadListItemsTable.leadId, leadsTable.id))
    .where(eq(leadListItemsTable.listId, listId));

  const leads = items.map((r) => r.lead);
  const totalLeads = leads.length;

  // Email analysis
  const allEmails: string[] = [];
  let leadsWithEmail = 0;
  let leadsWithoutEmail = 0;

  for (const lead of leads) {
    const emailList = parseLeadEmails(lead.emails);
    if (emailList.length > 0) {
      leadsWithEmail++;
      allEmails.push(...emailList.map((e) => e.toLowerCase()));
    } else {
      leadsWithoutEmail++;
    }
  }

  // Duplicate email detection
  const emailCounts = new Map<string, number>();
  for (const email of allEmails) {
    emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }
  const duplicateEmails = [...emailCounts.values()].filter((c) => c > 1).length;

  // Classify emails
  let riskyEmails = 0;
  let genericEmails = 0;
  for (const email of allEmails) {
    const result = classifyEmail(email);
    if (result.type === "noreply" || result.type === "invalid") riskyEmails++;
    else if (result.type === "generic") genericEmails++;
  }

  // Lead qualification
  const qualifiedLeads = leads.filter((l) => l.qualificationStatus === "qualified").length;
  const rejectedLeads = leads.filter((l) => l.qualificationStatus === "rejected").length;

  // Outreach queue stats for this list
  const queueItems = await db
    .select({ status: outreachQueueTable.status, aiPersonalized: outreachQueueTable.aiPersonalized })
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.listId, listId));

  const aiPersonalizedDrafts = queueItems.filter((q) => q.aiPersonalized).length;
  const pendingReviewDrafts = queueItems.filter((q) => q.status === "pending_review").length;
  const approvedDrafts = queueItems.filter((q) => q.status === "approved").length;

  res.json({
    totalLeads,
    leadsWithEmail,
    leadsWithoutEmail,
    qualifiedLeads,
    rejectedLeads,
    aiPersonalizedDrafts,
    duplicateEmails,
    riskyEmails,
    genericEmails,
    pendingReviewDrafts,
    approvedDrafts,
  });
});

export default router;
