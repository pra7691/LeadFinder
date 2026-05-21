import { Router } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  campaignsTable,
  campaignKeywordsTable,
  logsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { scoreLead } from "../services/scorer";

const router = Router();

// ── Local concurrency helper (replaces @workspace/integrations-openai-ai-server/batch) ──

async function batchProcess<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  opts: { concurrency: number; retries: number },
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += opts.concurrency) {
    const chunk = items.slice(i, i + opts.concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= opts.retries; attempt++) {
          try {
            return await fn(item);
          } catch (err) {
            lastErr = err;
            if (attempt < opts.retries) {
              await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
            }
          }
        }
        throw lastErr;
      }),
    );
    results.push(...chunkResults);
  }
  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchScoringContext(campaignId: number) {
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, campaignId));

  const keywords = await db
    .select()
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaignId));

  return { campaign, keywords: keywords.map((k) => k.keyword) };
}

async function scoreAndSaveLead(
  lead: typeof leadsTable.$inferSelect,
  campaignObjective: string,
  campaignKeywords: string[],
  minRelevanceScore: number,
): Promise<{
  leadId: number;
  score: number | null;
  reason: string;
  scoringMethod: string;
  reviewStatus: string;
  failed: boolean;
}> {
  const result = await scoreLead({
    leadId: lead.id,
    campaignObjective,
    campaignKeywords,
    companyName: lead.companyName,
    rootDomain: lead.rootDomain,
    rawText: lead.rawText ?? null,
    sourceQuery: lead.sourceQuery ?? null,
  });

  const failed = result.score == null;
  const reviewStatus =
    result.score != null && result.score < minRelevanceScore ? "low_relevance" : lead.reviewStatus;

  await db
    .update(leadsTable)
    .set({
      relevanceScore: result.score,
      relevanceReason: result.reason,
      scoringMethod: result.scoringMethod,
      reviewStatus,
    })
    .where(eq(leadsTable.id, lead.id));

  await db.insert(logsTable).values({
    campaignId: lead.campaignId,
    type: "score",
    message: failed
      ? `Score failed for ${lead.rootDomain}: ${result.reason} [${result.scoringMethod}]`
      : `Scored ${lead.rootDomain}: ${result.score}/100 [${result.scoringMethod}]${result.score !== null && result.score < minRelevanceScore ? " (low_relevance)" : ""}`,
    metadataJson: JSON.stringify({
      leadId: lead.id,
      score: result.score,
      reason: result.reason,
      scoringMethod: result.scoringMethod,
      reviewStatus,
      failed,
    }),
  });

  return {
    leadId: lead.id,
    score: result.score,
    reason: result.reason,
    scoringMethod: result.scoringMethod,
    reviewStatus,
    failed,
  };
}

// ── Single lead scoring ────────────────────────────────────────────────────

router.post("/leads/:id/score", async (req, res) => {
  const leadId = Number(req.params.id);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, leadId));

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const { campaign, keywords } = await fetchScoringContext(lead.campaignId);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  await db.insert(logsTable).values({
    campaignId: lead.campaignId,
    type: "score",
    message: `Scoring started for ${lead.rootDomain}`,
    metadataJson: JSON.stringify({ leadId }),
  });

  try {
  const result = await scoreAndSaveLead(
      lead,
      campaign.objective,
      keywords,
      campaign.minRelevanceScore,
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── Bulk scoring ───────────────────────────────────────────────────────────

router.post("/leads/bulk-score", async (req, res) => {
  const { leadIds, campaignId } = req.body as {
    leadIds?: number[];
    campaignId?: number;
  };

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
    res.status(400).json({ error: "Provide leadIds array or campaignId" });
    return;
  }

  if (targetLeads.length === 0) {
    res.json({ attempted: 0, succeeded: 0, failed: 0, results: [] });
    return;
  }

  // Group leads by campaign to avoid redundant context fetches
  const campaignIds = [...new Set(targetLeads.map((l) => l.campaignId))];
  const contextMap = new Map<
    number,
    { objective: string; keywords: string[]; minScore: number }
  >();
  for (const cid of campaignIds) {
    const { campaign, keywords } = await fetchScoringContext(cid);
    if (campaign) {
      contextMap.set(cid, {
        objective: campaign.objective,
        keywords,
        minScore: campaign.minRelevanceScore,
      });
    }
  }

  await db.insert(logsTable).values({
    campaignId: targetLeads[0]!.campaignId,
    type: "score",
    message: `Bulk scoring started for ${targetLeads.length} leads`,
    metadataJson: JSON.stringify({ count: targetLeads.length }),
  });

  const results: Array<{
    leadId: number;
    score: number | null;
    reason: string;
    scoringMethod: string;
    reviewStatus: string;
    failed: boolean;
    error?: string;
  }> = [];
  let succeeded = 0;
  let failed = 0;

  // Rate-limited parallel scoring (concurrency=3, retries=3)
  const processed = await batchProcess(
    targetLeads,
    async (lead) => {
      const ctx = contextMap.get(lead.campaignId);
      if (!ctx) {
        return {
          leadId: lead.id,
          error: "No campaign context",
          score: null,
          reason: "Score failed: no campaign context",
          scoringMethod: "failed_ai_error",
          reviewStatus: lead.reviewStatus,
          failed: true,
        };
      }
      return scoreAndSaveLead(lead, ctx.objective, ctx.keywords, ctx.minScore);
    },
    { concurrency: 3, retries: 3 },
  );

  for (const result of processed) {
    if ("error" in result && result.error) {
      failed++;
    } else {
      if (result.failed) failed++;
      else succeeded++;
    }
    results.push(result as (typeof results)[number]);
  }

  await db.insert(logsTable).values({
    campaignId: targetLeads[0]!.campaignId,
    type: "score",
    message: `Bulk scoring complete: ${succeeded} scored, ${failed} failed`,
    metadataJson: JSON.stringify({ attempted: targetLeads.length, succeeded, failed }),
  });

  res.json({ attempted: targetLeads.length, succeeded, failed, results });
});

export default router;
