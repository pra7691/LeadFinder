import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  leadsTable,
  outreachQueueTable,
} from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

const router = Router();

router.get("/dashboard/stats", async (_req, res) => {
  const [{ total: totalCampaigns }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaignsTable);

  const [{ total: activeCampaigns }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .where(eq(campaignsTable.isActive, true));

  const [{ total: totalLeads }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadsTable);

  const [{ total: leadsToReview }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(eq(leadsTable.reviewStatus, "pending"));

  const [{ total: emailsQueued }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.status, "queued"));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ total: emailsSentToday }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(
      and(
        eq(outreachQueueTable.status, "sent"),
        gte(outreachQueueTable.sentAt, todayStart),
      ),
    );

  res.json({
    totalCampaigns,
    activeCampaigns,
    totalLeads,
    leadsToReview,
    emailsQueued,
    emailsSentToday,
  });
});

export default router;
