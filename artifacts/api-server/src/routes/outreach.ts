import { Router } from "express";
import { db } from "@workspace/db";
import {
  outreachQueueTable,
  campaignsTable,
  leadsTable,
  logsTable,
  emailTemplatesTable,
  leadListsTable,
  leadListItemsTable,
  emailAccountsTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, or, isNull, desc } from "drizzle-orm";
import { classifyEmail } from "../services/email-validator";
import {
  ListOutreachQueryParams,
  UpdateOutreachBody,
  UpdateOutreachParams,
  QueueLeadBody,
  BulkQueueLeadsBody,
  BulkApproveOutreachBody,
  DeleteOutreachParams,
  ApproveOutreachParams,
  OutreachFromListBody,
  RejectOutreachBody,
  BulkRejectOutreachBody,
} from "@workspace/api-zod";
import { generatePersonalizedEmail } from "../services/email-generator";
import { analyzeQuality } from "../services/quality-analyzer";
import { getPrimaryLeadEmail, parseLeadEmails } from "../services/lead-emails";
import { isEmailUnsubscribed } from "./unsubscribe";
import { isEmailHardBounced } from "./outreach-send";
import { isEmailBlacklisted } from "../services/email-blacklist";
import { domainMatchesBlockedList, parseBlockedDomains } from "../services/domain-blocklist";

const router = Router();

async function getTemplateVars(lead: typeof leadsTable.$inferSelect, campaignName?: string, listName?: string) {
  const emailList = parseLeadEmails(lead.emails);
  return {
    company_name: lead.companyName,
    website_url: lead.websiteUrl ?? lead.rootDomain ?? "",
    country: lead.country ?? "",
    emails: emailList.join(", "),
    relevance_reason: (lead as unknown as Record<string, string>).relevanceReason ?? "",
    campaign_name: campaignName ?? "",
    list_name: listName ?? "",
  };
}

async function resolveEmailContent(
  lead: typeof leadsTable.$inferSelect,
  templateId: number | null | undefined,
  campaignId: number | null | undefined,
  context: { campaignName?: string; listName?: string },
): Promise<{ subject: string; body: string }> {
  if (templateId) {
    const [tmpl] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, templateId));
    if (tmpl) {
      const result = await generatePersonalizedEmail(lead, tmpl, context);
      return { subject: result.subject, body: result.body };
    }
  }
  if (campaignId) {
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    if (campaign) {
      const { renderTemplate } = await import("../services/email-generator");
      const vars = await getTemplateVars(lead, campaign.name, context.listName);
      const subjectRaw = campaign.subjectTemplate ?? "Outreach from {{campaign_name}} — {{company_name}}";
      const bodyRaw = campaign.emailTemplate ?? "Hi,\n\nI wanted to reach out regarding {{company_name}}.\n\nBest regards";
      return {
        subject: renderTemplate(subjectRaw, vars),
        body: renderTemplate(bodyRaw, vars),
      };
    }
  }
  const { renderTemplate } = await import("../services/email-generator");
  const vars = await getTemplateVars(lead, context.campaignName, context.listName);
  return {
    subject: renderTemplate("Outreach — {{company_name}}", vars),
    body: renderTemplate("Hi,\n\nI wanted to reach out regarding {{company_name}}.\n\nBest regards", vars),
  };
}

async function enrichItem(item: typeof outreachQueueTable.$inferSelect) {
  const [lead] = await db
    .select({
      companyName: leadsTable.companyName,
      relevanceScore: leadsTable.relevanceScore,
      qualificationStatus: leadsTable.qualificationStatus,
      websiteUrl: leadsTable.websiteUrl,
      country: leadsTable.country,
    })
    .from(leadsTable)
    .where(eq(leadsTable.id, item.leadId));
  const campaignName = item.campaignId
    ? (await db.select({ name: campaignsTable.name }).from(campaignsTable).where(eq(campaignsTable.id, item.campaignId)))[0]?.name ?? null
    : null;
  const qualityWarnings = analyzeQuality({
    recipientEmail: item.recipientEmail,
    subject: item.subject,
    body: item.body,
    aiPersonalized: item.aiPersonalized ?? false,
    companyName: lead?.companyName,
    relevanceScore: lead?.relevanceScore,
    qualificationStatus: lead?.qualificationStatus,
    websiteUrl: lead?.websiteUrl,
    country: lead?.country,
  });
  return {
    ...item,
    companyName: lead?.companyName ?? null,
    campaignName,
    relevanceScore: lead?.relevanceScore ?? null,
    qualificationStatus: lead?.qualificationStatus ?? null,
    qualityWarnings,
  };
}

async function enrichItems(items: (typeof outreachQueueTable.$inferSelect)[]) {
  if (items.length === 0) return [];

  const leadIds = [...new Set(items.map((i) => i.leadId))];
  const campaignIds = [...new Set(items.map((i) => i.campaignId).filter(Boolean))] as number[];
  const templateIds = [...new Set(items.map((i) => i.emailTemplateId).filter(Boolean))] as number[];
  const accountIds = [...new Set(items.map((i) => i.emailAccountId).filter(Boolean))] as number[];
  const listIds = [...new Set(items.map((i) => i.listId).filter(Boolean))] as number[];

  const [leads, campaigns, templates, accounts, lists] = await Promise.all([
    db.select({
      id: leadsTable.id,
      companyName: leadsTable.companyName,
      relevanceScore: leadsTable.relevanceScore,
      qualificationStatus: leadsTable.qualificationStatus,
      websiteUrl: leadsTable.websiteUrl,
      country: leadsTable.country,
    }).from(leadsTable).where(inArray(leadsTable.id, leadIds)),
    campaignIds.length
      ? db.select({ id: campaignsTable.id, name: campaignsTable.name }).from(campaignsTable).where(inArray(campaignsTable.id, campaignIds))
      : Promise.resolve([]),
    templateIds.length
      ? db.select({ id: emailTemplatesTable.id, name: emailTemplatesTable.name }).from(emailTemplatesTable).where(inArray(emailTemplatesTable.id, templateIds))
      : Promise.resolve([]),
    accountIds.length
      ? db.select({ id: emailAccountsTable.id, email: emailAccountsTable.email }).from(emailAccountsTable).where(inArray(emailAccountsTable.id, accountIds))
      : Promise.resolve([]),
    listIds.length
      ? db.select({ id: leadListsTable.id, name: leadListsTable.name }).from(leadListsTable).where(inArray(leadListsTable.id, listIds))
      : Promise.resolve([]),
  ]);

  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const campMap = new Map(campaigns.map((c) => [c.id, c.name]));
  const tmplMap = new Map(templates.map((t) => [t.id, t.name]));
  const acctMap = new Map(accounts.map((a) => [a.id, a.email]));
  const listMap = new Map(lists.map((l) => [l.id, l.name]));
  const allEmails = items.map((i) => i.recipientEmail);

  return items.map((item) => {
    const lead = leadMap.get(item.leadId);
    const qualityWarnings = analyzeQuality({
      recipientEmail: item.recipientEmail,
      subject: item.subject,
      body: item.body,
      aiPersonalized: item.aiPersonalized ?? false,
      companyName: lead?.companyName,
      relevanceScore: lead?.relevanceScore,
      qualificationStatus: lead?.qualificationStatus,
      websiteUrl: lead?.websiteUrl,
      country: lead?.country,
      allRecipientEmails: allEmails,
    });
    const emailClassification = classifyEmail(item.recipientEmail);
    return {
      ...item,
      companyName: lead?.companyName ?? null,
      campaignName: item.campaignId ? campMap.get(item.campaignId) ?? null : null,
      templateName: item.emailTemplateId ? tmplMap.get(item.emailTemplateId) ?? null : null,
      senderEmail: item.emailAccountId ? acctMap.get(item.emailAccountId) ?? null : null,
      listName: item.listId ? listMap.get(item.listId) ?? null : null,
      relevanceScore: lead?.relevanceScore ?? null,
      qualificationStatus: lead?.qualificationStatus ?? null,
      recipientEmailType: emailClassification.type,
      qualityWarnings,
    };
  });
}

async function logAction(campaignId: number | null, type: string, message: string, meta?: Record<string, unknown>) {
  await db.insert(logsTable).values({ campaignId, type, message, metadataJson: meta ? JSON.stringify(meta) : null });
}

// ─── GET /outreach ────────────────────────────────────────────────────────────
router.get("/outreach", async (req, res) => {
  const params = ListOutreachQueryParams.parse({
    campaignId: req.query.campaignId ? Number(req.query.campaignId) : undefined,
    status: req.query.status,
  });
  const conditions = [];
  if (params.campaignId !== undefined) conditions.push(eq(outreachQueueTable.campaignId, params.campaignId));
  if (params.status !== undefined) conditions.push(eq(outreachQueueTable.status, params.status));
  const items = conditions.length > 0
    ? await db.select().from(outreachQueueTable).where(and(...conditions)).orderBy(desc(outreachQueueTable.createdAt))
    : await db.select().from(outreachQueueTable).orderBy(desc(outreachQueueTable.createdAt));
  res.json(await enrichItems(items));
});

// ─── POST /outreach ───────────────────────────────────────────────────────────
router.post("/outreach", async (req, res) => {
  const body = QueueLeadBody.parse(req.body);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, body.leadId));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const recipientEmail = body.recipientEmail ?? getPrimaryLeadEmail(lead.emails) ?? "";
  if (!recipientEmail) { res.status(400).json({ error: "No email address for this lead" }); return; }

  // Duplicate protection: reject if same recipient already queued for same campaign/list
  const dupConditions = [
    eq(outreachQueueTable.recipientEmail, recipientEmail),
    inArray(outreachQueueTable.status, ["pending_review", "approved", "draft", "queued"]),
  ];
  if (body.campaignId) dupConditions.push(eq(outreachQueueTable.campaignId, body.campaignId));
  if (body.listId) dupConditions.push(eq(outreachQueueTable.listId, body.listId));
  const [dup] = await db.select({ id: outreachQueueTable.id }).from(outreachQueueTable).where(and(...dupConditions));
  if (dup) {
    res.status(409).json({ error: "Duplicate: this recipient is already queued for this campaign/list", existingId: dup.id });
    return;
  }

  const campaign = body.campaignId
    ? (await db.select().from(campaignsTable).where(eq(campaignsTable.id, body.campaignId)))[0]
    : null;

  const { subject, body: emailBody } = await resolveEmailContent(
    lead,
    body.emailTemplateId ?? null,
    body.campaignId ?? null,
    { campaignName: campaign?.name, listName: "" },
  );

  const [item] = await db.insert(outreachQueueTable).values({
    campaignId: body.campaignId ?? null,
    leadId: body.leadId,
    emailAccountId: body.emailAccountId ?? null,
    emailTemplateId: body.emailTemplateId ?? null,
    listId: body.listId ?? null,
    recipientEmail,
    subject,
    body: emailBody,
    status: "pending_review",
  }).returning();

  await logAction(body.campaignId ?? null, "outreach", `Queued lead: ${lead.companyName}`, { leadId: body.leadId, outreachId: item.id });
  res.status(201).json(await enrichItem(item));
});

// ─── POST /outreach/from-list ─────────────────────────────────────────────────
router.post("/outreach/from-list", async (req, res) => {
  const body = OutreachFromListBody.parse(req.body);

  const [list] = await db.select().from(leadListsTable).where(eq(leadListsTable.id, body.listId));
  if (!list) { res.status(404).json({ error: "List not found" }); return; }

  const [tmpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, body.emailTemplateId));
  if (!tmpl) { res.status(404).json({ error: "Email template not found" }); return; }

  const listItems = await db
    .select({ leadId: leadListItemsTable.leadId })
    .from(leadListItemsTable)
    .where(eq(leadListItemsTable.listId, body.listId));

  if (listItems.length === 0) { res.json({ queued: 0, skipped: 0, items: [] }); return; }

  const leadIds = listItems.map((li) => li.leadId);
  const leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds));

  let queued = 0;
  let skipped = 0;
  const batchId = `list-${body.listId}-${Date.now()}`;
  const items: (typeof outreachQueueTable.$inferSelect)[] = [];

  // Pre-fetch existing queue items for this list to detect duplicates
  const existingForList = await db
    .select({ recipientEmail: outreachQueueTable.recipientEmail })
    .from(outreachQueueTable)
    .where(and(
      eq(outreachQueueTable.listId, body.listId),
      inArray(outreachQueueTable.status, ["pending_review", "approved", "draft", "queued"]),
    ));
  const alreadyQueued = new Set(existingForList.map((r) => r.recipientEmail.toLowerCase()));

  // Load blocked domains once for the whole batch
  const [blockedDomainsRow1] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "blocked_domains"));
  const blockedDomainSet1 = parseBlockedDomains(blockedDomainsRow1?.value);

  for (const lead of leads) {
    const recipientEmail = getPrimaryLeadEmail(lead.emails) ?? "";
    if (!recipientEmail) { skipped++; continue; }

    // Skip invalid email format
    if (classifyEmail(recipientEmail).isRejected) { skipped++; continue; }

    // Skip blacklisted emails (exact match)
    if (await isEmailBlacklisted(recipientEmail)) { skipped++; continue; }

    // Skip blocked domains and their subdomains
    const recipientDomain1 = recipientEmail.trim().toLowerCase().split("@")[1];
    if (recipientDomain1 && domainMatchesBlockedList(recipientDomain1, blockedDomainSet1)) { skipped++; continue; }

    // Skip unsubscribed recipients
    if (await isEmailUnsubscribed(recipientEmail)) { skipped++; continue; }

    // Skip previously hard-bounced recipients
    if (await isEmailHardBounced(recipientEmail)) { skipped++; continue; }

    // Duplicate protection
    if (alreadyQueued.has(recipientEmail.toLowerCase())) { skipped++; continue; }

    const { subject, body: emailBody } = await resolveEmailContent(
      lead,
      body.emailTemplateId,
      null,
      { listName: list.name },
    );

    const [item] = await db.insert(outreachQueueTable).values({
      campaignId: null,
      leadId: lead.id,
      emailAccountId: body.emailAccountId ?? null,
      emailTemplateId: body.emailTemplateId,
      listId: body.listId,
      recipientEmail,
      subject,
      body: emailBody,
      batchId,
      status: "pending_review",
    }).returning();
    items.push(item);
    alreadyQueued.add(recipientEmail.toLowerCase());
    queued++;
  }

  skipped += leadIds.length - leads.length;
  await logAction(null, "outreach", `Queued ${queued} leads from list "${list.name}" (${skipped} skipped)`, { queued, skipped, listId: body.listId });

  res.json({ queued, skipped, items: await enrichItems(items) });
});

// ─── POST /outreach/bulk-queue ────────────────────────────────────────────────
router.post("/outreach/bulk-queue", async (req, res) => {
  const body = BulkQueueLeadsBody.parse(req.body);
  const leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, body.leadIds));

  const campaign = body.campaignId
    ? (await db.select().from(campaignsTable).where(eq(campaignsTable.id, body.campaignId)))[0]
    : null;

  let queued = 0;
  let skipped = 0;
  const items: (typeof outreachQueueTable.$inferSelect)[] = [];

  // Load blocked domains once for the whole batch
  const [blockedDomainsRow2] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "blocked_domains"));
  const blockedDomainSet2 = parseBlockedDomains(blockedDomainsRow2?.value);

  for (const lead of leads) {
    const recipientEmail = getPrimaryLeadEmail(lead.emails) ?? "";
    if (!recipientEmail) { skipped++; continue; }

    // Skip invalid email format
    if (classifyEmail(recipientEmail).isRejected) { skipped++; continue; }

    // Skip blacklisted emails (exact match)
    if (await isEmailBlacklisted(recipientEmail)) { skipped++; continue; }

    // Skip blocked domains and their subdomains
    const recipientDomain2 = recipientEmail.trim().toLowerCase().split("@")[1];
    if (recipientDomain2 && domainMatchesBlockedList(recipientDomain2, blockedDomainSet2)) { skipped++; continue; }

    // Skip unsubscribed recipients
    if (await isEmailUnsubscribed(recipientEmail)) { skipped++; continue; }

    // Skip previously hard-bounced recipients
    if (await isEmailHardBounced(recipientEmail)) { skipped++; continue; }

    const { subject, body: emailBody } = await resolveEmailContent(
      lead,
      body.emailTemplateId ?? null,
      body.campaignId ?? null,
      { campaignName: campaign?.name, listName: "" },
    );

    const [item] = await db.insert(outreachQueueTable).values({
      campaignId: body.campaignId ?? null,
      leadId: lead.id,
      emailAccountId: body.emailAccountId ?? null,
      emailTemplateId: body.emailTemplateId ?? null,
      listId: body.listId ?? null,
      recipientEmail,
      subject,
      body: emailBody,
      status: "pending_review",
    }).returning();
    items.push(item);
    queued++;
  }

  skipped += body.leadIds.length - leads.length;
  await logAction(body.campaignId ?? null, "outreach", `Bulk queued ${queued} leads (${skipped} skipped — no email)`, { queued, skipped });

  res.json({ queued, skipped, items: await enrichItems(items) });
});

// ─── POST /outreach/bulk-approve ──────────────────────────────────────────────
router.post("/outreach/bulk-approve", async (req, res) => {
  const body = BulkApproveOutreachBody.parse(req.body);
  const now = new Date();
  const result = await db
    .update(outreachQueueTable)
    .set({ status: "approved", approvedAt: now })
    .where(and(inArray(outreachQueueTable.id, body.ids), inArray(outreachQueueTable.status, ["draft", "queued", "pending_review"])))
    .returning();
  if (result.length > 0) {
    await logAction(null, "outreach", `Bulk approved ${result.length} outreach items`, { ids: body.ids });
  }
  res.json({ approved: result.length });
});

// ─── POST /outreach/bulk-reject ───────────────────────────────────────────────
router.post("/outreach/bulk-reject", async (req, res) => {
  const body = BulkRejectOutreachBody.parse(req.body);
  const now = new Date();
  const result = await db
    .update(outreachQueueTable)
    .set({ status: "rejected", rejectedAt: now })
    .where(and(inArray(outreachQueueTable.id, body.ids), inArray(outreachQueueTable.status, ["draft", "queued", "pending_review", "approved"])))
    .returning();
  if (result.length > 0) {
    await logAction(null, "outreach", `Bulk rejected ${result.length} outreach items`, { ids: body.ids });
  }
  res.json({ rejected: result.length });
});

// ─── PATCH /outreach/:id ──────────────────────────────────────────────────────
router.patch("/outreach/:id", async (req, res) => {
  const { id } = UpdateOutreachParams.parse({ id: Number(req.params.id) });
  const body = UpdateOutreachBody.parse(req.body);
  const setData: Record<string, unknown> = { ...body };
  if (body.scheduledAt !== undefined) setData.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (body.status === "approved") setData.approvedAt = new Date();
  if (body.status === "rejected") setData.rejectedAt = new Date();
  const [item] = await db.update(outreachQueueTable).set(setData).where(eq(outreachQueueTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await enrichItem(item));
});

// ─── DELETE /outreach/:id ─────────────────────────────────────────────────────
router.delete("/outreach/:id", async (req, res) => {
  const { id } = DeleteOutreachParams.parse({ id: Number(req.params.id) });
  await db.delete(outreachQueueTable).where(eq(outreachQueueTable.id, id));
  res.status(204).send();
});

// ─── POST /outreach/:id/approve ───────────────────────────────────────────────
router.post("/outreach/:id/approve", async (req, res) => {
  const { id } = ApproveOutreachParams.parse({ id: Number(req.params.id) });
  const [item] = await db.update(outreachQueueTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(eq(outreachQueueTable.id, id))
    .returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  await logAction(item.campaignId, "outreach", `Approved outreach item #${id}`, { id });
  res.json(await enrichItem(item));
});

// ─── POST /outreach/:id/reject ────────────────────────────────────────────────
router.post("/outreach/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = RejectOutreachBody.safeParse(req.body ?? {});
  const reason = parsed.success ? (parsed.data.reason ?? null) : null;
  const [item] = await db.update(outreachQueueTable)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(eq(outreachQueueTable.id, id))
    .returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  await logAction(item.campaignId, "outreach", `Rejected outreach item #${id}${reason ? `: ${reason}` : ""}`, { id, reason });
  res.json(await enrichItem(item));
});

// ─── POST /outreach/:id/regenerate ───────────────────────────────────────────
router.post("/outreach/:id/regenerate", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const forceAi = Boolean((req.body as Record<string, unknown> | undefined)?.forceAi);

  const [existing] = await db.select().from(outreachQueueTable).where(eq(outreachQueueTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, existing.leadId));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Determine which email account to use for sender name
  const emailAccount = existing.emailAccountId
    ? (await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, existing.emailAccountId)))[0]
    : null;

  const campaign = existing.campaignId
    ? (await db.select().from(campaignsTable).where(eq(campaignsTable.id, existing.campaignId)))[0]
    : null;

  const list = existing.listId
    ? (await db.select().from(leadListsTable).where(eq(leadListsTable.id, existing.listId)))[0]
    : null;

  let subject: string;
  let body: string;
  let aiPersonalized = false;

  if (forceAi && existing.emailTemplateId) {
    const [tmpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, existing.emailTemplateId));
    if (tmpl) {
      const result = await generatePersonalizedEmail(lead, tmpl, {
        campaignName: campaign?.name,
        listName: list?.name,
      });
      subject = result.subject;
      body = result.body;
      aiPersonalized = result.aiUsed;
    } else {
      const content = await resolveEmailContent(lead, existing.emailTemplateId, existing.campaignId, {
        campaignName: campaign?.name, listName: list?.name,
      });
      subject = content.subject;
      body = content.body;
    }
  } else {
    const content = await resolveEmailContent(lead, existing.emailTemplateId, existing.campaignId, {
      campaignName: campaign?.name, listName: list?.name,
    });
    subject = content.subject;
    body = content.body;
  }

  const [updated] = await db.update(outreachQueueTable)
    .set({ subject, body, aiPersonalized, status: "pending_review", rejectedAt: null })
    .where(eq(outreachQueueTable.id, id))
    .returning();

  await logAction(existing.campaignId, "outreach", `Regenerated outreach item #${id}${aiPersonalized ? " (AI)" : ""}`, { id, forceAi });
  res.json(await enrichItem(updated));
});

export default router;
