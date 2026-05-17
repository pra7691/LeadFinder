import { Router } from "express";
import { db } from "@workspace/db";
import {
  outreachQueueTable,
  campaignsTable,
  leadsTable,
  logsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  ListOutreachQueryParams,
  UpdateOutreachBody,
  UpdateOutreachParams,
  QueueLeadBody,
  BulkQueueLeadsBody,
  BulkApproveOutreachBody,
  DeleteOutreachParams,
  ApproveOutreachParams,
} from "@workspace/api-zod";

const router = Router();

function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

async function enrichItem(item: typeof outreachQueueTable.$inferSelect) {
  const [lead] = await db
    .select({ companyName: leadsTable.companyName })
    .from(leadsTable)
    .where(eq(leadsTable.id, item.leadId));
  const [campaign] = await db
    .select({ name: campaignsTable.name })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, item.campaignId));
  return {
    ...item,
    companyName: lead?.companyName ?? null,
    campaignName: campaign?.name ?? null,
  };
}

async function enrichItems(items: (typeof outreachQueueTable.$inferSelect)[]) {
  if (items.length === 0) return [];
  const leadIds = [...new Set(items.map((i) => i.leadId))];
  const campaignIds = [...new Set(items.map((i) => i.campaignId))];
  const leads = await db
    .select({ id: leadsTable.id, companyName: leadsTable.companyName })
    .from(leadsTable)
    .where(inArray(leadsTable.id, leadIds));
  const campaigns = await db
    .select({ id: campaignsTable.id, name: campaignsTable.name })
    .from(campaignsTable)
    .where(inArray(campaignsTable.id, campaignIds));
  const leadMap = new Map(leads.map((l) => [l.id, l.companyName]));
  const campMap = new Map(campaigns.map((c) => [c.id, c.name]));
  return items.map((item) => ({
    ...item,
    companyName: leadMap.get(item.leadId) ?? null,
    campaignName: campMap.get(item.campaignId) ?? null,
  }));
}

async function logAction(
  campaignId: number | null,
  type: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(logsTable).values({
    campaignId,
    type,
    message,
    metadataJson: meta ? JSON.stringify(meta) : null,
  });
}

router.get("/outreach", async (req, res) => {
  const params = ListOutreachQueryParams.parse({
    campaignId: req.query.campaignId ? Number(req.query.campaignId) : undefined,
    status: req.query.status,
  });

  const conditions = [];
  if (params.campaignId !== undefined) {
    conditions.push(eq(outreachQueueTable.campaignId, params.campaignId));
  }
  if (params.status !== undefined) {
    conditions.push(eq(outreachQueueTable.status, params.status));
  }

  const items =
    conditions.length > 0
      ? await db.select().from(outreachQueueTable).where(and(...conditions))
      : await db.select().from(outreachQueueTable);

  const enriched = await enrichItems(items);
  res.json(enriched);
});

router.post("/outreach", async (req, res) => {
  const body = QueueLeadBody.parse(req.body);

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, body.leadId));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, body.campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const vars = {
    company_name: lead.companyName,
    country: lead.country ?? "",
    campaign_name: campaign.name,
  };

  let emailList: string[] = [];
  try { emailList = lead.emails ? JSON.parse(lead.emails) : []; } catch { emailList = []; }
  const recipientEmail = body.recipientEmail ?? emailList[0] ?? "";

  if (!recipientEmail) {
    res.status(400).json({ error: "No email address for this lead" });
    return;
  }

  const subjectRaw = campaign.subjectTemplate ?? "Outreach from {{campaign_name}}";
  const bodyRaw =
    campaign.emailTemplate ??
    "Hi,\n\nI wanted to reach out regarding {{company_name}}.\n\n{{campaign_name}}";

  const subject = renderTemplate(subjectRaw, vars);
  const emailBody = renderTemplate(bodyRaw, vars);

  const [item] = await db
    .insert(outreachQueueTable)
    .values({
      campaignId: body.campaignId,
      leadId: body.leadId,
      emailAccountId: body.emailAccountId ?? null,
      recipientEmail,
      subject,
      body: emailBody,
      status: "draft",
    })
    .returning();

  await logAction(body.campaignId, "outreach", `Queued lead: ${lead.companyName}`, {
    leadId: body.leadId,
    outreachId: item.id,
  });

  res.status(201).json(await enrichItem(item));
});

router.post("/outreach/bulk-queue", async (req, res) => {
  const body = BulkQueueLeadsBody.parse(req.body);

  const leads = await db
    .select()
    .from(leadsTable)
    .where(inArray(leadsTable.id, body.leadIds));

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, body.campaignId));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const subjectRaw = campaign.subjectTemplate ?? "Outreach from {{campaign_name}}";
  const bodyRaw =
    campaign.emailTemplate ??
    "Hi,\n\nI wanted to reach out regarding {{company_name}}.\n\n{{campaign_name}}";

  let queued = 0;
  let skipped = 0;
  const items: (typeof outreachQueueTable.$inferSelect)[] = [];

  for (const lead of leads) {
    let leadEmails: string[] = [];
    try { leadEmails = lead.emails ? JSON.parse(lead.emails) : []; } catch { leadEmails = []; }
    const recipientEmail = leadEmails[0] ?? "";
    if (!recipientEmail) {
      skipped++;
      continue;
    }

    const vars = {
      company_name: lead.companyName,
      country: lead.country ?? "",
      campaign_name: campaign.name,
    };

    const [item] = await db
      .insert(outreachQueueTable)
      .values({
        campaignId: body.campaignId,
        leadId: lead.id,
        emailAccountId: body.emailAccountId ?? null,
        recipientEmail,
        subject: renderTemplate(subjectRaw, vars),
        body: renderTemplate(bodyRaw, vars),
        status: "draft",
      })
      .returning();
    items.push(item);
    queued++;
  }

  skipped += body.leadIds.length - leads.length;

  await logAction(
    body.campaignId,
    "outreach",
    `Bulk queued ${queued} leads (${skipped} skipped — no email)`,
    { queued, skipped },
  );

  const enriched = await enrichItems(items);
  res.json({ queued, skipped, items: enriched });
});

router.post("/outreach/bulk-approve", async (req, res) => {
  const body = BulkApproveOutreachBody.parse(req.body);

  const now = new Date();
  const result = await db
    .update(outreachQueueTable)
    .set({ status: "approved", approvedAt: now })
    .where(
      and(
        inArray(outreachQueueTable.id, body.ids),
        inArray(outreachQueueTable.status, ["draft", "queued"]),
      ),
    )
    .returning();

  if (result.length > 0) {
    await logAction(null, "outreach", `Bulk approved ${result.length} outreach items`, {
      ids: body.ids,
    });
  }

  res.json({ approved: result.length });
});

router.patch("/outreach/:id", async (req, res) => {
  const { id } = UpdateOutreachParams.parse({ id: Number(req.params.id) });
  const body = UpdateOutreachBody.parse(req.body);

  const setData: Record<string, unknown> = { ...body };
  if (body.scheduledAt !== undefined) {
    setData.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  }
  if (body.status === "approved") {
    setData.approvedAt = new Date();
  }

  const [item] = await db
    .update(outreachQueueTable)
    .set(setData)
    .where(eq(outreachQueueTable.id, id))
    .returning();
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(await enrichItem(item));
});

router.delete("/outreach/:id", async (req, res) => {
  const { id } = DeleteOutreachParams.parse({ id: Number(req.params.id) });
  await db.delete(outreachQueueTable).where(eq(outreachQueueTable.id, id));
  res.status(204).send();
});

router.post("/outreach/:id/approve", async (req, res) => {
  const { id } = ApproveOutreachParams.parse({ id: Number(req.params.id) });

  const [item] = await db
    .update(outreachQueueTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(eq(outreachQueueTable.id, id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await logAction(item.campaignId, "outreach", `Approved outreach item #${id}`, { id });
  res.json(await enrichItem(item));
});

export default router;
