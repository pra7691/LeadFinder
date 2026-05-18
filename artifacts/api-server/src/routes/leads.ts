import { Router } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq, and, isNotNull, isNull, gte, type SQL } from "drizzle-orm";
import {
  CreateLeadBody,
  UpdateLeadBody,
  UpdateLeadParams,
  GetLeadParams,
  DeleteLeadParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/leads", async (req, res) => {
  const campaignId = req.query.campaignId
    ? Number(req.query.campaignId)
    : undefined;
  const reviewStatus = req.query.reviewStatus as string | undefined;
  const leadStatus = req.query.leadStatus as string | undefined;
  const qualificationStatus = req.query.qualificationStatus as string | undefined;
  const outreachStatus = req.query.outreachStatus as string | undefined;
  const hasEmailRaw = req.query.hasEmail;
  const hasEmail =
    hasEmailRaw !== undefined
      ? hasEmailRaw === "true" || hasEmailRaw === "1"
      : undefined;
  const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  const offset = req.query.offset ? Number(req.query.offset) : 0;

  const conditions: SQL[] = [];
  if (campaignId !== undefined) {
    conditions.push(eq(leadsTable.campaignId, campaignId));
  }
  if (reviewStatus !== undefined) {
    conditions.push(eq(leadsTable.reviewStatus, reviewStatus));
  }
  if (leadStatus !== undefined) {
    conditions.push(eq(leadsTable.leadStatus, leadStatus));
  }
  if (qualificationStatus !== undefined) {
    conditions.push(eq(leadsTable.qualificationStatus, qualificationStatus));
  }
  if (outreachStatus !== undefined) {
    conditions.push(eq(leadsTable.outreachStatus, outreachStatus));
  }
  if (hasEmail === true) {
    conditions.push(isNotNull(leadsTable.emails));
  }
  if (hasEmail === false) {
    conditions.push(isNull(leadsTable.emails));
  }
  if (minScore !== undefined && !isNaN(minScore)) {
    conditions.push(gte(leadsTable.relevanceScore, minScore));
  }

  const leads =
    conditions.length > 0
      ? await db
          .select()
          .from(leadsTable)
          .where(and(...conditions))
          .limit(limit)
          .offset(offset)
      : await db.select().from(leadsTable).limit(limit).offset(offset);

  res.json(leads);
});

router.post("/leads", async (req, res) => {
  const body = CreateLeadBody.parse(req.body);
  const [lead] = await db.insert(leadsTable).values(body).returning();
  res.status(201).json(lead);
});

router.get("/leads/:id", async (req, res) => {
  const { id } = GetLeadParams.parse({ id: Number(req.params.id) });
  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, id));
  if (!lead) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(lead);
});

// PATCH is handled by lead-workflow.ts (registered before this router)
// which records status history. This route is a structural fallback.
router.patch("/leads/:id", async (req, res) => {
  const { id } = UpdateLeadParams.parse({ id: Number(req.params.id) });
  const body = UpdateLeadBody.parse(req.body);
  const [lead] = await db
    .update(leadsTable)
    .set(body)
    .where(eq(leadsTable.id, id))
    .returning();
  if (!lead) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(lead);
});

router.delete("/leads/:id", async (req, res) => {
  const { id } = DeleteLeadParams.parse({ id: Number(req.params.id) });
  await db.delete(leadsTable).where(eq(leadsTable.id, id));
  res.status(204).send();
});

export default router;
