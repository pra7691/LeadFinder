import { Router } from "express";
import { db } from "@workspace/db";
import { campaignKeywordsTable, campaignRunsTable, campaignRunResultsTable, campaignsTable, leadsTable, logsTable, appSettingsTable, leadListItemsTable } from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { requestCancellation, runPipeline } from "../scheduler/pipeline";
import { computeNextRunAt } from "../scheduler/index";
import { classifyLeadType } from "../services/lead-classifier";
import { crawlWebsite } from "../services/crawler";
import { scoreLead } from "../services/scorer";
import { saveExportFile } from "../services/export-files";

const router = Router();

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatCsvDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

async function crawlAndScoreRecoveredLead(
  lead: typeof leadsTable.$inferSelect,
  campaign: typeof campaignsTable.$inferSelect,
): Promise<{ crawlStatus: string; scored: boolean; score: number | null; scoringMethod: string | null }> {
  await db.insert(logsTable).values({
    campaignId: lead.campaignId,
    type: "crawl",
    message: `Crawl started for restored lead ${lead.rootDomain}`,
    metadataJson: JSON.stringify({ leadId: lead.id, campaignRunId: lead.campaignRunId }),
  });

  await db
    .update(leadsTable)
    .set({
      crawlStatus: "crawling",
      crawlError: null,
      relevanceScore: null,
      relevanceReason: null,
      scoringMethod: null,
    })
    .where(eq(leadsTable.id, lead.id));

  let updatedLead = lead;
  try {
    const data = await crawlWebsite(lead.websiteUrl, lead.rootDomain);
    const ok = data.pagesSucceeded > 0;
    const crawlUpdates: Record<string, unknown> = {
      crawlStatus: ok ? "crawled" : "failed",
      crawlError: ok ? null : "No pages returned content",
      rawText: data.rawText || null,
    };

    if (ok) {
      if (data.companyName) crawlUpdates.companyName = data.companyName;
      if (data.emails) crawlUpdates.emails = data.emails;
      if (data.emailDomainStatus) crawlUpdates.emailDomainStatus = data.emailDomainStatus;
      if (data.phoneNumbers) crawlUpdates.phoneNumbers = data.phoneNumbers;
      if (data.address) crawlUpdates.address = data.address;
      if (data.country) crawlUpdates.country = data.country;
      if (data.linkedinUrl) crawlUpdates.linkedinUrl = data.linkedinUrl;
    }

    [updatedLead] = await db
      .update(leadsTable)
      .set(crawlUpdates)
      .where(eq(leadsTable.id, lead.id))
      .returning();

    await db.insert(logsTable).values({
      campaignId: lead.campaignId,
      type: ok ? "crawl" : "crawl_failure",
      message: ok
        ? `Crawl completed for restored lead ${lead.rootDomain}: ${data.pagesSucceeded}/${data.pagesAttempted} pages`
        : `Crawl failed for restored lead ${lead.rootDomain}: no pages loaded`,
      metadataJson: JSON.stringify({
        leadId: lead.id,
        campaignRunId: lead.campaignRunId,
        pagesAttempted: data.pagesAttempted,
        pagesSucceeded: data.pagesSucceeded,
      }),
    });

    if (!ok) {
      return { crawlStatus: "failed", scored: false, score: null, scoringMethod: null };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(leadsTable)
      .set({ crawlStatus: "failed", crawlError: message.slice(0, 500) })
      .where(eq(leadsTable.id, lead.id));
    await db.insert(logsTable).values({
      campaignId: lead.campaignId,
      type: "crawl_failure",
      message: `Crawl error for restored lead ${lead.rootDomain}: ${message.slice(0, 200)}`,
      metadataJson: JSON.stringify({ leadId: lead.id, campaignRunId: lead.campaignRunId, error: message }),
    });
    return { crawlStatus: "failed", scored: false, score: null, scoringMethod: null };
  }

  const keywords = await db
    .select({ keyword: campaignKeywordsTable.keyword })
    .from(campaignKeywordsTable)
    .where(eq(campaignKeywordsTable.campaignId, campaign.id));

  const scoreResult = await scoreLead({
    leadId: updatedLead.id,
    campaignObjective: campaign.objective,
    campaignKeywords: keywords.map((keyword) => keyword.keyword),
    companyName: updatedLead.companyName,
    rootDomain: updatedLead.rootDomain,
    rawText: updatedLead.rawText ?? null,
    sourceQuery: updatedLead.sourceQuery ?? null,
  });

  const reviewStatus =
    scoreResult.score != null && scoreResult.score < campaign.minRelevanceScore
      ? "low_relevance"
      : updatedLead.reviewStatus;

  await db
    .update(leadsTable)
    .set({
      relevanceScore: scoreResult.score,
      relevanceReason: scoreResult.reason,
      scoringMethod: scoreResult.scoringMethod,
      reviewStatus,
    })
    .where(eq(leadsTable.id, updatedLead.id));

  await db.insert(logsTable).values({
    campaignId: lead.campaignId,
    type: "score",
    message: scoreResult.score == null
      ? `Score failed for restored lead ${lead.rootDomain}: ${scoreResult.reason}`
      : `Scored restored lead ${lead.rootDomain}: ${scoreResult.score}/100 [${scoreResult.scoringMethod}]`,
    metadataJson: JSON.stringify({
      leadId: updatedLead.id,
      campaignRunId: updatedLead.campaignRunId,
      score: scoreResult.score,
      scoringMethod: scoreResult.scoringMethod,
      reviewStatus,
    }),
  });

  return {
    crawlStatus: "crawled",
    scored: scoreResult.score != null,
    score: scoreResult.score,
    scoringMethod: scoreResult.scoringMethod,
  };
}

function normalizeRootDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^www\./, "");
}

async function removeDomainsFromBlockedSettings(domains: Set<string>) {
  if (domains.size === 0) return;

  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));

  if (!blockedSetting?.value) return;

  const nextDomains = blockedSetting.value
    .split(/[\n,]/)
    .map((d) => normalizeRootDomain(d))
    .filter((d) => d && !domains.has(d));

  if (nextDomains.join("\n") !== blockedSetting.value) {
    await db
      .update(appSettingsTable)
      .set({ value: nextDomains.join("\n") })
      .where(eq(appSettingsTable.key, "blocked_domains"));
  }
}

async function recoverBlockedResults(resultIds: number[]) {
  const uniqueIds = Array.from(new Set(resultIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) {
    return {
      created: 0,
      duplicates: 0,
      skipped: 0,
      createdLeads: [] as (typeof leadsTable.$inferSelect)[],
      processedResults: [] as { id: number; rootDomain: string; resultStatus: "lead_created" | "duplicate" }[],
    };
  }

  const results = await db
    .select()
    .from(campaignRunResultsTable)
    .where(inArray(campaignRunResultsTable.id, uniqueIds));

  const blockedResults = results.filter((result) => result.resultStatus === "blocked");
  if (blockedResults.length === 0) {
    return {
      created: 0,
      duplicates: 0,
      skipped: uniqueIds.length,
      createdLeads: [] as (typeof leadsTable.$inferSelect)[],
      processedResults: [] as { id: number; rootDomain: string; resultStatus: "lead_created" | "duplicate" }[],
    };
  }

  const campaignId = blockedResults[0].campaignId;
  const campaignRunId = blockedResults[0].campaignRunId;
  const sameRunResults = blockedResults.filter(
    (result) => result.campaignId === campaignId && result.campaignRunId === campaignRunId,
  );

  const existingLeads = await db
    .select({ rootDomain: leadsTable.rootDomain })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, campaignId));

  const seenDomains = new Set(existingLeads.map((lead) => normalizeRootDomain(lead.rootDomain)).filter(Boolean));
  const unblockedDomains = new Set<string>();
  const createdLeads: (typeof leadsTable.$inferSelect)[] = [];
  const processedResults: { id: number; rootDomain: string; resultStatus: "lead_created" | "duplicate" }[] = [];
  let created = 0;
  let duplicates = 0;
  let skipped = uniqueIds.length - sameRunResults.length;

  for (const result of sameRunResults) {
    const rootDomain = normalizeRootDomain(result.rootDomain);
    const websiteUrl = result.url?.trim();
    if (!rootDomain || !websiteUrl) {
      skipped++;
      continue;
    }

    unblockedDomains.add(rootDomain);

    if (seenDomains.has(rootDomain)) {
      await db
        .update(campaignRunResultsTable)
        .set({
          resultStatus: "duplicate",
          reason: "Marked non-blocked, but domain already exists as a lead",
        })
        .where(eq(campaignRunResultsTable.id, result.id));
      processedResults.push({ id: result.id, rootDomain, resultStatus: "duplicate" });
      duplicates++;
      continue;
    }

    const [lead] = await db
      .insert(leadsTable)
      .values({
        campaignId,
        campaignRunId,
        companyName: "",
        rootDomain,
        websiteUrl,
        leadStatus: "discovered",
        reviewStatus: "pending",
        qualificationStatus: "unqualified",
        outreachStatus: "not_queued",
        emailStatus: "not_sent",
        relevanceScore: 0,
        relevanceReason: "",
        sourceQuery: result.sourceQuery,
        sourceType: "direct",
        leadType: classifyLeadType(rootDomain, result.title ?? undefined),
      })
      .returning();

    seenDomains.add(rootDomain);
    createdLeads.push(lead);
    created++;

    await db
      .update(campaignRunResultsTable)
      .set({
        resultStatus: "lead_created",
        reason: "Marked non-blocked by user",
      })
      .where(eq(campaignRunResultsTable.id, result.id));
    processedResults.push({ id: result.id, rootDomain, resultStatus: "lead_created" });
  }

  if (created > 0 || duplicates > 0) {
    await db
      .update(campaignRunsTable)
      .set({
        totalBlocked: sql`greatest(coalesce(${campaignRunsTable.totalBlocked}, 0) - ${created + duplicates}, 0)`,
        totalNewLeads: sql`coalesce(${campaignRunsTable.totalNewLeads}, 0) + ${created}`,
        totalDuplicates: sql`coalesce(${campaignRunsTable.totalDuplicates}, 0) + ${duplicates}`,
      })
      .where(eq(campaignRunsTable.id, campaignRunId));
  }

  await removeDomainsFromBlockedSettings(unblockedDomains);

  return { created, duplicates, skipped, createdLeads, processedResults };
}

function normalizeRunStatus<T extends { status: string; currentStage: string | null; errorMessage: string | null; metadataJson: string | null }>(
  run: T,
): T {
  // Older runs could be written with status="completed" even when the run had
  // step errors (e.g. AI scoring not configured). Normalize for UI consumers.
  if (run.status !== "completed") return run;
  const hasErrors = typeof run.errorMessage === "string" && run.errorMessage.trim().length > 0;
  if (!hasErrors) return run;

  let scoredCount: number | null = null;
  try {
    if (typeof run.metadataJson === "string" && run.metadataJson.trim().length > 0) {
      const parsed = JSON.parse(run.metadataJson) as { scoredCount?: unknown };
      if (typeof parsed?.scoredCount === "number") scoredCount = parsed.scoredCount;
    }
  } catch {
    // ignore malformed metadataJson
  }

  const effectiveStatus = scoredCount === 0 ? "failed" : "partial";
  return {
    ...run,
    status: effectiveStatus,
    currentStage: run.currentStage === "completed" ? run.currentStage : effectiveStatus,
  };
}

// List campaign runs (optionally filtered by campaignId)
router.get("/campaign-runs", async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;

  const runs = await db
    .select()
    .from(campaignRunsTable)
    .where(campaignId !== undefined ? eq(campaignRunsTable.campaignId, campaignId) : undefined)
    .orderBy(desc(campaignRunsTable.startedAt));

  res.json(runs.map(normalizeRunStatus));
});

// Get a single campaign run
router.get("/campaign-runs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.json(normalizeRunStatus(run));
});

// Get leads for a campaign run
router.get("/campaign-runs/:id/leads", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const leads = await db
    .select({
      lead: leadsTable,
      addedToList: sql<boolean>`exists (
        select 1
        from ${leadListItemsTable}
        where ${leadListItemsTable.leadId} = ${leadsTable.id}
      )`,
    })
    .from(leadsTable)
    .where(eq(leadsTable.campaignRunId, id))
    .orderBy(desc(leadsTable.createdAt));

  res.json(leads.map((row) => ({ ...row.lead, addedToList: row.addedToList })));
});

// Get results (blocked / duplicate / lead_created / rejected / skipped_recent) for a run
router.get("/campaign-runs/:id/results", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const saveToFile = req.query.save === "1" || req.query.save === "true";

  const rows = await db
    .select()
    .from(campaignRunResultsTable)
    .where(
      status
        ? and(
            eq(campaignRunResultsTable.campaignRunId, id),
            eq(campaignRunResultsTable.resultStatus, status),
          )
        : eq(campaignRunResultsTable.campaignRunId, id),
    )
    .orderBy(desc(campaignRunResultsTable.createdAt))
    .limit(10000);

  res.json(rows);
});

// Export run results (blocked / duplicate / lead_created / rejected / skipped_recent) for a run
router.get("/campaign-runs/:id/results/export", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const saveToFile = req.query.save === "1" || req.query.save === "true";

  const rows = await db
    .select()
    .from(campaignRunResultsTable)
    .where(
      status
        ? and(
            eq(campaignRunResultsTable.campaignRunId, id),
            eq(campaignRunResultsTable.resultStatus, status),
          )
        : eq(campaignRunResultsTable.campaignRunId, id),
    )
    .orderBy(desc(campaignRunResultsTable.createdAt))
    .limit(10000);

  const filenameDate = new Date().toISOString().slice(0, 10);
  const filenameStatus = status ? status.replace(/[^a-z0-9_-]/gi, "-").toLowerCase() : "all-results";
  const filename = `campaign-run-${id}-${filenameStatus}-${filenameDate}.csv`;

  const headers = [
    "Result ID",
    "Campaign ID",
    "Campaign Run ID",
    "Status",
    "Title",
    "URL",
    "Root Domain",
    "Source Query",
    "Reason",
    "Created At",
  ];

  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.campaignId,
        row.campaignRunId,
        row.resultStatus,
        row.title,
        row.url,
        row.rootDomain,
        row.sourceQuery,
        row.reason,
        formatCsvDate(row.createdAt),
      ].map(csvEscape).join(","),
    );
  }
  const csv = `${lines.join("\r\n")}\r\n`;
  if (saveToFile) {
    const saved = await saveExportFile(filename, csv);
    res.json({ saved: true, ...saved, rows: rows.length });
    return;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

// Recover a blocked result as a normal lead.
router.post("/campaign-run-results/:id/unblock", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid result ID" });
    return;
  }

  const recovered = await recoverBlockedResults([id]);
  const processed = recovered.processedResults[0];

  if (!processed) {
    res.status(400).json({ error: "Only blocked results can be marked as non-blocked" });
    return;
  }

  const [result] = await db
    .select()
    .from(campaignRunResultsTable)
    .where(eq(campaignRunResultsTable.id, id));

  const [campaign] = result
    ? await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, result.campaignId))
    : [];

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found for blocked result" });
    return;
  }

  let processing: Awaited<ReturnType<typeof crawlAndScoreRecoveredLead>> | null = null;
  let processedLead: typeof leadsTable.$inferSelect | null = null;
  const lead = recovered.createdLeads[0];

  if (lead) {
    await db.insert(logsTable).values({
      campaignId: lead.campaignId,
      type: "workflow",
      message: `Marked blocked result as non-blocked: ${lead.rootDomain}`,
      metadataJson: JSON.stringify({ resultId: id, leadId: lead.id, url: lead.websiteUrl }),
    });

    processing = await crawlAndScoreRecoveredLead(lead, campaign);

    [processedLead] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, lead.id));
  } else {
    await db.insert(logsTable).values({
      campaignId: campaign.id,
      type: "workflow",
      message: `Marked blocked result as duplicate: ${processed.rootDomain}`,
      metadataJson: JSON.stringify({ resultId: id, rootDomain: processed.rootDomain }),
    });
  }

  res.json({
    lead: processedLead ?? lead ?? null,
    resultStatus: processed.resultStatus,
    processing,
  });
});

// Recover multiple blocked results as normal leads, with duplicate checks.
router.post("/campaign-run-results/unblock", async (req, res) => {
  const resultIds = Array.isArray(req.body?.resultIds)
    ? req.body.resultIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value))
    : [];

  if (resultIds.length === 0) {
    res.status(400).json({ error: "No blocked results selected" });
    return;
  }

  const recovered = await recoverBlockedResults(resultIds);
  const firstLead = recovered.createdLeads[0];
  const campaignId = firstLead?.campaignId;

  await db.insert(logsTable).values({
    campaignId: campaignId ?? null,
    type: "workflow",
    message: `Marked ${recovered.created + recovered.duplicates} blocked result${recovered.created + recovered.duplicates !== 1 ? "s" : ""} as non-blocked`,
    metadataJson: JSON.stringify({
      resultIds,
      created: recovered.created,
      duplicates: recovered.duplicates,
      skipped: recovered.skipped,
    }),
  });

  void (async () => {
    for (const lead of recovered.createdLeads) {
      const [campaign] = await db
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.id, lead.campaignId));
      if (campaign) await crawlAndScoreRecoveredLead(lead, campaign);
    }
  })().catch((err) => {
    console.error("Failed to process recovered blocked leads", err);
  });

  res.json({
    created: recovered.created,
    duplicates: recovered.duplicates,
    skipped: recovered.skipped,
    processed: recovered.processedResults,
  });
});

// Delete a campaign run — leads are kept, their campaign_run_id is set to null via FK SET NULL.
// To also delete leads, first call POST /leads/bulk-delete with the run's lead IDs.
router.delete("/campaign-runs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (run.status === "running") {
    res.status(400).json({
      error: "Cannot delete a running campaign run. Wait until it finishes or mark it failed first.",
    });
    return;
  }

  // Deleting the run sets leads.campaign_run_id = null via SET NULL FK automatically.
  await db.delete(campaignRunsTable).where(eq(campaignRunsTable.id, id));

  res.status(204).send();
});

// Cancel a running campaign run
router.post("/campaign-runs/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (run.status !== "running") {
    res.status(400).json({ error: "Run is not currently running" });
    return;
  }

  // Signal the in-process pipeline to stop at the next safe checkpoint
  requestCancellation(id);

  // Immediately mark as cancelled in the DB so the UI reflects the change
  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - new Date(run.startedAt).getTime()) / 1000);

  const [updated] = await db
    .update(campaignRunsTable)
    .set({ status: "cancelled", completedAt: now, durationSeconds, progressPercent: 100 })
    .where(eq(campaignRunsTable.id, id))
    .returning();

  await db
    .update(campaignsTable)
    .set({ lastRunStatus: "cancelled" })
    .where(eq(campaignsTable.id, run.campaignId));

  await db.insert(logsTable).values({
    campaignId: run.campaignId,
    type: "workflow",
    message: `Campaign run #${id} cancelled by user after ${durationSeconds}s. Leads already discovered are preserved.`,
  });

  res.json(updated);
  return;
});

// ── POST /campaign-runs/:id/resume ─────────────────────────────────────────
//
// Resume a failed or partial campaign run from where it left off.
// Skips the discovery step (leads were already found); re-crawls any leads
// still pending/stuck in this run, then continues with scoring and email.

router.post("/campaign-runs/:id/resume", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(campaignRunsTable)
    .where(eq(campaignRunsTable.id, id));

  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const resumable: string[] = ["failed", "partial", "cancelled"];
  if (!resumable.includes(run.status)) {
    res.status(400).json({
      error: `Cannot resume a run with status "${run.status}". Only failed, partial, or cancelled runs can be resumed.`,
    });
    return;
  }

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, run.campaignId));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.lastRunStatus === "running") {
    res.status(409).json({ error: "A pipeline is already running for this campaign" });
    return;
  }

  // Reset any leads left mid-crawl from the previous attempt
  const resetLeads = await db
    .update(leadsTable)
    .set({ crawlStatus: "pending", crawlError: "Reset for resume" })
    .where(and(eq(leadsTable.campaignRunId, id), eq(leadsTable.crawlStatus, "crawling")))
    .returning({ id: leadsTable.id });

  // Re-open the run
  await db
    .update(campaignRunsTable)
    .set({
      status: "running",
      completedAt: null,
      errorMessage: null,
      currentStage: "searching",
    })
    .where(eq(campaignRunsTable.id, id));

  await db
    .update(campaignsTable)
    .set({ lastRunStatus: "running", lastRunAt: new Date() })
    .where(eq(campaignsTable.id, campaign.id));

  await db.insert(logsTable).values({
    campaignId: campaign.id,
    type: "workflow",
    message: `Campaign run #${id} resumed by user${resetLeads.length > 0 ? ` (${resetLeads.length} stuck lead(s) reset to pending)` : ""}.`,
  });

  // Fire-and-forget — skip discovery, resume from crawl step
  runPipeline(campaign.id, id, { skipDiscovery: true })
    .then(async (result) => {
      const workCompleted =
        result.crawledCount > 0 ||
        result.scoredCount > 0 ||
        result.emailsSent > 0;
      const status =
        result.failed > 0
          ? (workCompleted ? "partial" : "failed")
          : "completed";

      const nextRunAt = computeNextRunAt(
        campaign.scheduleType,
        campaign.scheduleTime,
        campaign.scheduleDays,
      );

      await Promise.all([
        db.update(campaignsTable)
          .set({ lastRunStatus: status === "completed" ? "success" : status, lastRunAt: new Date(), nextRunAt: nextRunAt ?? undefined })
          .where(eq(campaignsTable.id, campaign.id)),
        db.update(campaignRunsTable)
          .set({
            status,
            currentStage: status,
            completedAt: new Date(),
            totalNewLeads: result.discoveryLeadsCreated,
            totalSearches: result.discoverySearchesPerformed,
            totalRejected: result.failed,
            errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
            metadataJson: JSON.stringify({
              crawledCount: result.crawledCount,
              scoredCount: result.scoredCount,
              pendingCrawlCount: result.pendingCrawlCount,
              crawlFailedCount: result.crawlFailedCount,
              pendingScoreCount: result.pendingScoreCount,
              emailsSent: result.emailsSent,
              durationMs: result.durationMs,
              resumedRun: true,
            }),
            progressPercent: 100,
            estimatedRemainingSeconds: 0,
          })
          .where(eq(campaignRunsTable.id, id)),
      ]);
    })
    .catch(async (err) => {
      const nextRunAt = computeNextRunAt(
        campaign.scheduleType,
        campaign.scheduleTime,
        campaign.scheduleDays,
      );
      await Promise.all([
        db.update(campaignsTable)
          .set({ lastRunStatus: "failed", lastRunAt: new Date(), nextRunAt: nextRunAt ?? undefined })
          .where(eq(campaignsTable.id, campaign.id)),
        db.update(campaignRunsTable)
          .set({ status: "failed", currentStage: "failed", completedAt: new Date(), errorMessage: String(err?.message ?? err) })
          .where(eq(campaignRunsTable.id, id)),
      ]);
    });

  res.status(202).json({ status: "resumed", campaignId: campaign.id, runId: id });
});

export default router;
