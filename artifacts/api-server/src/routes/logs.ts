import { Router } from "express";
import { db } from "@workspace/db";
import { logsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { ListLogsQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/logs", async (req, res) => {
  const params = ListLogsQueryParams.parse({
    campaignId: req.query.campaignId
      ? Number(req.query.campaignId)
      : undefined,
    type: req.query.type,
    limit: req.query.limit ? Number(req.query.limit) : 100,
  });

  const conditions = [];
  if (params.campaignId !== undefined) {
    conditions.push(eq(logsTable.campaignId, params.campaignId));
  }
  if (params.type !== undefined) {
    conditions.push(eq(logsTable.type, params.type));
  }

  const logs =
    conditions.length > 0
      ? await db
          .select()
          .from(logsTable)
          .where(and(...conditions))
          .orderBy(desc(logsTable.createdAt))
          .limit(params.limit ?? 100)
      : await db
          .select()
          .from(logsTable)
          .orderBy(desc(logsTable.createdAt))
          .limit(params.limit ?? 100);

  res.json(logs);
});

export default router;
