import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  leadsTable,
  outreachQueueTable,
  leadListsTable,
  leadListItemsTable,
} from "@workspace/db";
import { eq, and, gte, sql, or, inArray } from "drizzle-orm";

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

  // New review analytics
  const [{ total: pendingReview }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.status, "pending_review"));

  const [{ total: approvedToSend }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.status, "approved"));

  const [{ total: rejectedDrafts }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(eq(outreachQueueTable.status, "rejected"));

  // Risky queued emails: noreply/donotreply in recipient email, still pending review or approved
  const [{ total: riskyQueued }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(
      and(
        inArray(outreachQueueTable.status, ["pending_review", "approved", "draft", "queued"]),
        or(
          sql`${outreachQueueTable.recipientEmail} ilike 'noreply@%'`,
          sql`${outreachQueueTable.recipientEmail} ilike 'no-reply@%'`,
          sql`${outreachQueueTable.recipientEmail} ilike 'donotreply@%'`,
          sql`${outreachQueueTable.recipientEmail} ilike 'do-not-reply@%'`,
        ),
      ),
    );

  // Lists ready for outreach: active lists that have leads with email addresses
  const listsWithEmails = await db
    .selectDistinct({ listId: leadListItemsTable.listId })
    .from(leadListItemsTable)
    .innerJoin(leadsTable, eq(leadListItemsTable.leadId, leadsTable.id))
    .innerJoin(leadListsTable, eq(leadListItemsTable.listId, leadListsTable.id))
    .where(
      and(
        eq(leadListsTable.listStatus, "active"),
        sql`${leadsTable.emails} is not null and ${leadsTable.emails} != '[]' and ${leadsTable.emails} != ''`,
      ),
    );
  const listsReadyForOutreach = listsWithEmails.length;

  res.json({
    totalCampaigns,
    activeCampaigns,
    totalLeads,
    leadsToReview,
    emailsQueued,
    emailsSentToday,
    pendingReview,
    approvedToSend,
    rejectedDrafts,
    riskyQueued,
    listsReadyForOutreach,
  });
});

export default router;
