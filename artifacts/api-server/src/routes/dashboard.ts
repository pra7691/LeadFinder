import { Router } from "express";
import { db } from "@workspace/db";
import {
  campaignsTable,
  leadsTable,
  outreachQueueTable,
  leadListsTable,
  leadListItemsTable,
  searchQueryHistoryTable,
  appSettingsTable,
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

  const [{ total: searchesToday }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(searchQueryHistoryTable)
    .where(
      and(
        eq(searchQueryHistoryTable.status, "completed"),
        gte(searchQueryHistoryTable.searchedAt, todayStart),
      ),
    );

  const [{ total: qualifiedLeadsToday }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.qualificationStatus, "qualified"),
        gte(leadsTable.updatedAt, todayStart),
      ),
    );

  // Global daily limits from app_settings
  const settingsRows = await db
    .select()
    .from(appSettingsTable)
    .where(sql`${appSettingsTable.key} IN ('global_max_searches_per_day', 'global_max_emails_per_day')`);
  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const globalMaxSearches = parseInt(settingsMap["global_max_searches_per_day"] ?? "10", 10);
  const globalMaxEmails = parseInt(settingsMap["global_max_emails_per_day"] ?? "20", 10);

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
    searchesToday,
    qualifiedLeadsToday,
    globalMaxSearches,
    globalMaxEmails,
  });
});

router.get("/dashboard/activity-stats", async (req, res) => {
  const range = (req.query.range as string) ?? "today";

  let startDate: Date | null = null;
  const now = new Date();

  if (range === "today") {
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
  } else if (range === "week") {
    startDate = new Date();
    startDate.setDate(now.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
  }
  // "alltime" → no startDate filter

  const searchesWhere = startDate
    ? and(
        eq(searchQueryHistoryTable.status, "completed"),
        gte(searchQueryHistoryTable.searchedAt, startDate),
      )
    : eq(searchQueryHistoryTable.status, "completed");

  const qualifiedLeadsWhere = startDate
    ? and(
        eq(leadsTable.qualificationStatus, "qualified"),
        gte(leadsTable.updatedAt, startDate),
      )
    : eq(leadsTable.qualificationStatus, "qualified");

  const emailsSentWhere = startDate
    ? and(
        eq(outreachQueueTable.status, "sent"),
        gte(outreachQueueTable.sentAt, startDate),
      )
    : eq(outreachQueueTable.status, "sent");

  const [{ total: searches }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(searchQueryHistoryTable)
    .where(searchesWhere);

  const [{ total: qualifiedLeads }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(qualifiedLeadsWhere);

  const [{ total: emailsSent }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(outreachQueueTable)
    .where(emailsSentWhere);

  res.json({ searches, qualifiedLeads, emailsSent });
});

export default router;
