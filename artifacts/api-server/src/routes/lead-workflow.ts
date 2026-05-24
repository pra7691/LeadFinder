import { Router } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  leadNotesTable,
  leadStatusHistoryTable,
  logsTable,
  campaignsTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { normalizeDomainToken, parseBlockedDomains } from "../services/domain-blocklist";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

async function addDomainsToBlocklist(rawDomains: (string | null)[]): Promise<void> {
  const domains = rawDomains.map(normalizeDomainToken).filter(Boolean);
  if (domains.length === 0) return;

  const [existing] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  const blocked = parseBlockedDomains(existing?.value);
  const added = domains.filter((d) => !blocked.has(d));
  if (added.length === 0) return;

  added.forEach((d) => blocked.add(d));
  const nextValue = Array.from(blocked).join("\n");

  await db
    .insert(appSettingsTable)
    .values({ key: "blocked_domains", value: nextValue })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: nextValue, updatedAt: new Date() },
    });
}

async function recordStatusChange(
  leadId: number,
  fromStatus: string | null,
  toStatus: string,
  fromReviewStatus: string | null,
  toReviewStatus: string | null,
  note?: string,
) {
  await db.insert(leadStatusHistoryTable).values({
    leadId,
    fromStatus,
    toStatus,
    fromReviewStatus,
    toReviewStatus,
    note: note ?? null,
  });
}

// ── Notes ──────────────────────────────────────────────────────────────────

router.get("/leads/:id/notes", async (req, res) => {
  const leadId = Number(req.params.id);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  const notes = await db
    .select()
    .from(leadNotesTable)
    .where(eq(leadNotesTable.leadId, leadId))
    .orderBy(leadNotesTable.createdAt);
  res.json(notes);
});

router.post("/leads/:id/notes", async (req, res) => {
  const leadId = Number(req.params.id);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  const { content, authorName } = req.body as {
    content?: string;
    authorName?: string;
  };
  if (!content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  const [note] = await db
    .insert(leadNotesTable)
    .values({
      leadId,
      content: content.trim(),
      authorName: authorName?.trim() || "Operator",
    })
    .returning();
  res.status(201).json(note);
});

// ── Status History ─────────────────────────────────────────────────────────

router.get("/leads/:id/status-history", async (req, res) => {
  const leadId = Number(req.params.id);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  const history = await db
    .select()
    .from(leadStatusHistoryTable)
    .where(eq(leadStatusHistoryTable.leadId, leadId))
    .orderBy(leadStatusHistoryTable.createdAt);
  res.json(history);
});

// ── Bulk Action ────────────────────────────────────────────────────────────

const ACTION_MAP: Record<
  string,
  { leadStatus?: string; reviewStatus?: string; qualificationStatus?: string; outreachStatus?: string }
> = {
  // Legacy workflow actions
  approve:    { leadStatus: "approved",     reviewStatus: "approved" },
  reject:     { leadStatus: "rejected",     reviewStatus: "rejected" },
  archive:    { leadStatus: "archived" },
  invalid:    { leadStatus: "invalid" },
  contacted:  { leadStatus: "contacted" },
  pending:    { reviewStatus: "pending" },
  // Qualification actions
  qualify:    { qualificationStatus: "qualified" },
  disqualify: { qualificationStatus: "rejected" },
  unqualify:  { qualificationStatus: "unqualified" },
  // Outreach status actions
  mark_queued:    { outreachStatus: "queued" },
  mark_contacted: { outreachStatus: "contacted" },
  mark_closed:    { outreachStatus: "closed" },
};

router.post("/leads/bulk-action", async (req, res) => {
  const { action, leadIds, campaignId } = req.body as {
    action?: string;
    leadIds?: number[];
    campaignId?: number;
  };

  if (!action || !ACTION_MAP[action]) {
    res.status(400).json({
      error: `Unknown action. Valid: ${Object.keys(ACTION_MAP).join(", ")}`,
    });
    return;
  }

  let targetLeads;
  if (Array.isArray(leadIds) && leadIds.length > 0) {
    targetLeads = await db
      .select()
      .from(leadsTable)
      .where(inArray(leadsTable.id, leadIds));
  } else if (typeof campaignId === "number") {
    targetLeads = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.campaignId, campaignId));
  } else {
    res.status(400).json({ error: "Provide leadIds or campaignId" });
    return;
  }

  if (targetLeads.length === 0) {
    res.json({ action, affected: 0 });
    return;
  }

  const patch = ACTION_MAP[action]!;
  const targetIds = targetLeads.map((l) => l.id);

  await db
    .update(leadsTable)
    .set(patch)
    .where(inArray(leadsTable.id, targetIds));

  // Auto-block domains when leads are disqualified
  if (action === "disqualify") {
    await addDomainsToBlocklist(targetLeads.map((l) => l.rootDomain));
  }

  // Record history for each lead
  await Promise.all(
    targetLeads.map((lead) =>
      recordStatusChange(
        lead.id,
        lead.leadStatus,
        patch.leadStatus ?? lead.leadStatus,
        lead.reviewStatus,
        patch.reviewStatus ?? null,
        `Bulk action: ${action}`,
      ),
    ),
  );

  // Log to campaign logs
  const campaignIdForLog =
    targetLeads[0]?.campaignId ?? (typeof campaignId === "number" ? campaignId : null);
  if (campaignIdForLog) {
    await db.insert(logsTable).values({
      campaignId: campaignIdForLog,
      type: "workflow",
      message: `Bulk action "${action}" applied to ${targetLeads.length} leads`,
      metadataJson: JSON.stringify({ action, affected: targetLeads.length, leadIds: targetIds }),
    });
  }

  res.json({ action, affected: targetLeads.length });
});

// ── Enhanced PATCH /leads/:id — with status history logging ────────────────
// This route shadows the one in leads.ts by being registered before it.

router.patch("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = req.body as Partial<typeof leadsTable.$inferInsert>;
  const [updated] = await db
    .update(leadsTable)
    .set(body)
    .where(eq(leadsTable.id, id))
    .returning();

  // Auto-block domain when a lead is disqualified
  if (
    body.qualificationStatus === "rejected" &&
    existing.qualificationStatus !== "rejected"
  ) {
    await addDomainsToBlocklist([existing.rootDomain]);
  }

  // Record status changes
  const statusChanged =
    body.leadStatus && body.leadStatus !== existing.leadStatus;
  const reviewChanged =
    body.reviewStatus && body.reviewStatus !== existing.reviewStatus;

  if (statusChanged || reviewChanged) {
    await recordStatusChange(
      id,
      existing.leadStatus,
      body.leadStatus ?? existing.leadStatus,
      existing.reviewStatus,
      body.reviewStatus ?? null,
    );
  }

  res.json(updated);
});

// ── Campaign stats ─────────────────────────────────────────────────────────

router.get("/campaigns/:id/lead-stats", async (req, res) => {
  const campaignId = Number(req.params.id);
  if (isNaN(campaignId)) {
    res.status(400).json({ error: "Invalid campaign ID" });
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));
  if (!campaign) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const leads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaignId));

  const stats = {
    total: leads.length,
    byStatus: {} as Record<string, number>,
    byReviewStatus: {} as Record<string, number>,
    scored: leads.filter((l) => l.relevanceScore != null).length,
    crawled: leads.filter((l) => l.crawlStatus === "crawled").length,
    withEmail: leads.filter((l) => l.emails).length,
    avgScore:
      leads.filter((l) => l.relevanceScore != null).length > 0
        ? Math.round(
            leads
              .filter((l) => l.relevanceScore != null)
              .reduce((s, l) => s + (l.relevanceScore ?? 0), 0) /
              leads.filter((l) => l.relevanceScore != null).length,
          )
        : null,
  };

  for (const lead of leads) {
    stats.byStatus[lead.leadStatus] = (stats.byStatus[lead.leadStatus] ?? 0) + 1;
    stats.byReviewStatus[lead.reviewStatus] =
      (stats.byReviewStatus[lead.reviewStatus] ?? 0) + 1;
  }

  res.json(stats);
});

export default router;
