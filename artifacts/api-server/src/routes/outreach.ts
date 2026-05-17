import { Router } from "express";
import { db } from "@workspace/db";
import { outreachQueueTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListOutreachQueryParams,
  UpdateOutreachBody,
  UpdateOutreachParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/outreach", async (req, res) => {
  const params = ListOutreachQueryParams.parse({
    campaignId: req.query.campaignId
      ? Number(req.query.campaignId)
      : undefined,
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
      ? await db
          .select()
          .from(outreachQueueTable)
          .where(and(...conditions))
      : await db.select().from(outreachQueueTable);

  res.json(items);
});

router.patch("/outreach/:id", async (req, res) => {
  const { id } = UpdateOutreachParams.parse({ id: Number(req.params.id) });
  const body = UpdateOutreachBody.parse(req.body);
  const setData: Record<string, unknown> = { ...body };
  if (body.scheduledAt !== undefined) {
    setData.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
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
  res.json(item);
});

export default router;
