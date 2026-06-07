import { Router } from "express";
import { db } from "@workspace/db";
import { emailTemplatesTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateEmailTemplateBody,
  UpdateEmailTemplateBody,
  UpdateEmailTemplateParams,
  DeleteEmailTemplateParams,
  PreviewEmailTemplateParams,
  PreviewEmailTemplateBody,
  GetEmailTemplateParams,
} from "@workspace/api-zod";
import { renderTemplate } from "../services/email-generator";
import { parseLeadEmails } from "../services/lead-emails";
import { ensureEmailTemplateAttachmentColumn, ensureSendFormatColumn } from "../lib/schema-guards";
import { normalizeTemplateAttachmentsJson } from "../services/email-template-attachments";

const router = Router();

router.use(async (_req, _res, next) => {
  try {
    await ensureEmailTemplateAttachmentColumn();
    await ensureSendFormatColumn();
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/email-templates", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const rows = includeInactive
    ? await db.select().from(emailTemplatesTable).orderBy(emailTemplatesTable.createdAt)
    : await db
        .select()
        .from(emailTemplatesTable)
        .where(eq(emailTemplatesTable.isActive, true))
        .orderBy(emailTemplatesTable.createdAt);
  res.json(rows);
});

router.post("/email-templates", async (req, res) => {
  const body = CreateEmailTemplateBody.parse(req.body);
  const [row] = await db.insert(emailTemplatesTable).values({
    name: body.name,
    subject: body.subject,
    body: body.body,
    personalizationPrompt: body.personalizationPrompt ?? null,
    attachmentsJson: normalizeTemplateAttachmentsJson(body.attachmentsJson),
    sendFormat: (body.sendFormat === "html" ? "html" : "plain_text"),
    isActive: body.isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

router.get("/email-templates/:id", async (req, res) => {
  const { id } = GetEmailTemplateParams.parse({ id: Number(req.params.id) });
  const [row] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/email-templates/:id", async (req, res) => {
  const { id } = UpdateEmailTemplateParams.parse({ id: Number(req.params.id) });
  const body = UpdateEmailTemplateBody.parse(req.body);
  const values = {
    ...body,
    attachmentsJson:
      "attachmentsJson" in body ? normalizeTemplateAttachmentsJson(body.attachmentsJson) : undefined,
    sendFormat: "sendFormat" in body && body.sendFormat ? (body.sendFormat === "html" ? "html" : "plain_text") : undefined,
    updatedAt: new Date(),
  };
  const [row] = await db
    .update(emailTemplatesTable)
    .set(values)
    .where(eq(emailTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/email-templates/:id", async (req, res) => {
  const { id } = DeleteEmailTemplateParams.parse({ id: Number(req.params.id) });
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  res.status(204).send();
});

router.post("/email-templates/:id/preview", async (req, res) => {
  const { id } = PreviewEmailTemplateParams.parse({ id: Number(req.params.id) });
  const [tmpl] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.id, id));
  if (!tmpl) { res.status(404).json({ error: "Not found" }); return; }

  const input = PreviewEmailTemplateBody.parse(req.body ?? {});

  let vars: Record<string, string> = {
    company_name: "Acme Corp",
    website_url: "https://acme.example.com",
    country: "USA",
    emails: "hello@acme.example.com",
    relevance_reason: "Matches your target profile",
    campaign_name: "My Campaign",
    list_name: "My List",
    ...(input?.sampleData ?? {}),
  };

  if (input?.leadId) {
    const [lead] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, input.leadId));
    if (lead) {
      const emailList = parseLeadEmails(lead.emails);
      vars = {
        ...vars,
        company_name: lead.companyName,
        website_url: lead.websiteUrl ?? lead.rootDomain ?? "",
        country: lead.country ?? "",
        emails: emailList.join(", "),
        relevance_reason: lead.relevanceReason ?? "",
      };
    }
  }

  res.json({
    subject: renderTemplate(tmpl.subject, vars),
    body: renderTemplate(tmpl.body, vars),
    aiUsed: false,
  });
});

export default router;
