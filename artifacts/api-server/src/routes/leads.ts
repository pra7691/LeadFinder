import { Router } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListLeadsQueryParams,
  CreateLeadBody,
  UpdateLeadBody,
  UpdateLeadParams,
  GetLeadParams,
  DeleteLeadParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/leads", async (req, res) => {
  const params = ListLeadsQueryParams.parse({
    campaignId: req.query.campaignId ? Number(req.query.campaignId) : undefined,
    reviewStatus: req.query.reviewStatus,
    limit: req.query.limit ? Number(req.query.limit) : 50,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  });

  const conditions = [];
  if (params.campaignId !== undefined) {
    conditions.push(eq(leadsTable.campaignId, params.campaignId));
  }
  if (params.reviewStatus !== undefined) {
    conditions.push(eq(leadsTable.reviewStatus, params.reviewStatus));
  }

  const leads =
    conditions.length > 0
      ? await db
          .select()
          .from(leadsTable)
          .where(and(...conditions))
          .limit(params.limit ?? 50)
          .offset(params.offset ?? 0)
      : await db
          .select()
          .from(leadsTable)
          .limit(params.limit ?? 50)
          .offset(params.offset ?? 0);

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
