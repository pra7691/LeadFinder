import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable, campaignsTable, campaignRunsTable, leadCrawlAttemptsTable, leadsTable } from "@workspace/db";
import { eq, and, isNotNull, isNull, gte, lte, inArray, desc, sql, getTableColumns, type SQL } from "drizzle-orm";
import { saveExportFile } from "../services/export-files";
import { parseBlockedDomains } from "../services/domain-blocklist";
import {
  CreateLeadBody,
  UpdateLeadBody,
  UpdateLeadParams,
  GetLeadParams,
  DeleteLeadParams,
} from "@workspace/api-zod";
import { normalizeQualifiedNoEmailPage } from "../services/qualified-no-email-core";
import { qualifiedNoEmailConditions } from "../services/qualified-no-email-query";
import { normalizeFailedCrawlPage } from "../services/failed-crawl-core";
import { failedCrawlConditions } from "../services/failed-crawl-query";

const router = Router();

function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

router.get("/leads/qualified-no-email", async (req, res) => {
  const { limit, offset } = normalizeQualifiedNoEmailPage(req.query.limit, req.query.offset);
  const filters = {
    campaignId: optionalPositiveInteger(req.query.campaignId),
    campaignRunId: optionalPositiveInteger(req.query.campaignRunId),
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    hasPhone: req.query.hasPhone === "true" || req.query.hasPhone === "1",
    notInList: req.query.notInList === "true" || req.query.notInList === "1",
  };
  const conditions = qualifiedNoEmailConditions(filters);

  const [items, countRows] = await Promise.all([
    db.select({
      ...getTableColumns(leadsTable),
      campaignName: campaignsTable.name,
      campaignMinRelevanceScore: campaignsTable.minRelevanceScore,
      addedToList: sql<boolean>`EXISTS (
        SELECT 1 FROM lead_list_items lli WHERE lli.lead_id = ${leadsTable.id}
      )`,
    })
      .from(leadsTable)
      .innerJoin(campaignsTable, eq(leadsTable.campaignId, campaignsTable.id))
      .where(and(...conditions))
      .orderBy(desc(leadsTable.createdAt), desc(leadsTable.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` })
      .from(leadsTable)
      .innerJoin(campaignsTable, eq(leadsTable.campaignId, campaignsTable.id))
      .where(and(...conditions)),
  ]);

  res.json({ items, total: countRows[0]?.total ?? 0, limit, offset });
});

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

function parsePositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function getBlockedDomains() {
  const [blockedSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_domains"));
  return parseBlockedDomains(blockedSetting?.value);
}

router.get("/leads", async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
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
  const maxScore = req.query.maxScore ? Number(req.query.maxScore) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  const offset = req.query.offset ? Number(req.query.offset) : 0;

  const campaignRunId = req.query.campaignRunId
    ? Number(req.query.campaignRunId)
    : undefined;
  const country = req.query.country as string | undefined;

  const conditions: SQL[] = [];
  if (campaignId !== undefined) {
    conditions.push(eq(leadsTable.campaignId, campaignId));
  }
  if (campaignRunId !== undefined) {
    conditions.push(eq(leadsTable.campaignRunId, campaignRunId));
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
  if (country !== undefined) {
    conditions.push(eq(leadsTable.country, country));
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
  if (maxScore !== undefined && !isNaN(maxScore)) {
    conditions.push(lte(leadsTable.relevanceScore, maxScore));
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

router.get("/leads/failed-crawls/groups", async (req, res) => {
  const { limit, offset } = normalizeFailedCrawlPage(req.query.limit, req.query.offset);
  const blockedDomains = await getBlockedDomains();
  const conditions = failedCrawlConditions({}, blockedDomains);
  const [items, countRows, summaryRows] = await Promise.all([
    db.select({
      campaignId: leadsTable.campaignId,
      campaignRunId: leadsTable.campaignRunId,
      campaignName: campaignsTable.name,
      runName: campaignRunsTable.runName,
      runStatus: campaignRunsTable.status,
      runStartedAt: campaignRunsTable.startedAt,
      runCompletedAt: campaignRunsTable.completedAt,
      failedCount: sql<number>`count(${leadsTable.id})::int`,
      withErrorCount: sql<number>`count(${leadsTable.id})::int`,
      latestFailedAt: sql<Date>`max(${leadsTable.updatedAt})`,
    })
      .from(leadsTable)
      .leftJoin(campaignsTable, eq(leadsTable.campaignId, campaignsTable.id))
      .leftJoin(campaignRunsTable, eq(leadsTable.campaignRunId, campaignRunsTable.id))
      .where(and(...conditions))
      .groupBy(
        leadsTable.campaignId,
        leadsTable.campaignRunId,
        campaignsTable.name,
        campaignRunsTable.runName,
        campaignRunsTable.status,
        campaignRunsTable.startedAt,
        campaignRunsTable.completedAt,
      )
      .orderBy(desc(sql`max(${leadsTable.updatedAt})`))
      .limit(limit)
      .offset(offset),
    db.select({
      total: sql<number>`count(distinct (${leadsTable.campaignId}, ${leadsTable.campaignRunId}))::int`,
    }).from(leadsTable).where(and(...conditions)),
    db.select({
      failedCount: sql<number>`count(${leadsTable.id})::int`,
      campaignCount: sql<number>`count(distinct ${leadsTable.campaignId})::int`,
    }).from(leadsTable).where(and(...conditions)),
  ]);

  res.json({
    items,
    total: countRows[0]?.total ?? 0,
    limit,
    offset,
    summary: {
      failedCount: summaryRows[0]?.failedCount ?? 0,
      withErrorCount: summaryRows[0]?.failedCount ?? 0,
      campaignCount: summaryRows[0]?.campaignCount ?? 0,
    },
  });
});

router.get("/leads/failed-crawls", async (req, res) => {
  const { limit, offset } = normalizeFailedCrawlPage(req.query.limit, req.query.offset);
  const blockedDomains = await getBlockedDomains();
  const conditions = failedCrawlConditions({
    campaignRunId: parsePositiveNumber(req.query.campaignRunId),
    campaignId: parsePositiveNumber(req.query.campaignId),
  }, blockedDomains);
  const [items, countRows] = await Promise.all([
    db.select({
      id: leadsTable.id,
      campaignId: leadsTable.campaignId,
      campaignRunId: leadsTable.campaignRunId,
      companyName: leadsTable.companyName,
      rootDomain: leadsTable.rootDomain,
      websiteUrl: leadsTable.websiteUrl,
      sourceQuery: leadsTable.sourceQuery,
      sourceKeyword: leadsTable.sourceKeyword,
      sourceCountry: leadsTable.sourceCountry,
      sourceType: leadsTable.sourceType,
      leadType: leadsTable.leadType,
      crawlStatus: leadsTable.crawlStatus,
      crawlError: leadsTable.crawlError,
      httpFailureCategory: leadCrawlAttemptsTable.httpFailureCategory,
      httpError: leadCrawlAttemptsTable.httpError,
      browserStatus: leadCrawlAttemptsTable.browserStatus,
      browserError: leadCrawlAttemptsTable.browserError,
      finalCrawler: leadCrawlAttemptsTable.finalCrawler,
      createdAt: leadsTable.createdAt,
      updatedAt: leadsTable.updatedAt,
    }).from(leadsTable)
      .leftJoin(leadCrawlAttemptsTable, eq(leadCrawlAttemptsTable.leadId, leadsTable.id))
      .where(and(...conditions))
      .orderBy(desc(leadsTable.updatedAt), desc(leadsTable.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(${leadsTable.id})::int` })
      .from(leadsTable)
      .where(and(...conditions)),
  ]);

  res.json({ items, total: countRows[0]?.total ?? 0, limit, offset });
});

router.get("/leads/failed-crawls/export", async (req, res) => {
  const campaignRunId = parsePositiveNumber(req.query.campaignRunId);
  const campaignId = parsePositiveNumber(req.query.campaignId);
  const saveToFile = req.query.save === "1" || req.query.save === "true";
  const blockedDomains = await getBlockedDomains();
  const conditions = failedCrawlConditions({ campaignRunId, campaignId }, blockedDomains);
  const rows = await db
    .select({
      id: leadsTable.id,
      campaignId: leadsTable.campaignId,
      campaignRunId: leadsTable.campaignRunId,
      companyName: leadsTable.companyName,
      rootDomain: leadsTable.rootDomain,
      websiteUrl: leadsTable.websiteUrl,
      sourceQuery: leadsTable.sourceQuery,
      sourceKeyword: leadsTable.sourceKeyword,
      sourceCountry: leadsTable.sourceCountry,
      sourceType: leadsTable.sourceType,
      leadType: leadsTable.leadType,
      crawlStatus: leadsTable.crawlStatus,
      crawlError: leadsTable.crawlError,
      httpFailureCategory: leadCrawlAttemptsTable.httpFailureCategory,
      httpError: leadCrawlAttemptsTable.httpError,
      browserStatus: leadCrawlAttemptsTable.browserStatus,
      browserError: leadCrawlAttemptsTable.browserError,
      finalCrawler: leadCrawlAttemptsTable.finalCrawler,
      createdAt: leadsTable.createdAt,
      updatedAt: leadsTable.updatedAt,
    })
    .from(leadsTable)
    .leftJoin(leadCrawlAttemptsTable, eq(leadCrawlAttemptsTable.leadId, leadsTable.id))
    .where(and(...conditions))
    .orderBy(desc(leadsTable.updatedAt), desc(leadsTable.id));

  const filenameDate = new Date().toISOString().slice(0, 10);
  const filenameScope = campaignRunId
    ? `run-${campaignRunId}`
    : campaignId
      ? `campaign-${campaignId}`
      : "all";
  const filename = `failed-crawl-logs-${filenameScope}-${filenameDate}.csv`;

  const headers = [
    "Lead ID",
    "Campaign ID",
    "Campaign Run ID",
    "Company Name",
    "Root Domain",
    "Website URL",
    "Source Query",
    "Source Keyword",
    "Source Country",
    "Source Type",
    "Lead Type",
    "Crawl Status",
    "Crawl Error",
    "HTTP Failure Category",
    "HTTP Error",
    "Browser Status",
    "Browser Error",
    "Final Crawler",
    "Created At",
    "Updated At",
  ];

  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.campaignId,
        row.campaignRunId,
        row.companyName,
        row.rootDomain,
        row.websiteUrl,
        row.sourceQuery,
        row.sourceKeyword,
        row.sourceCountry,
        row.sourceType,
        row.leadType,
        row.crawlStatus,
        row.crawlError,
        row.httpFailureCategory,
        row.httpError,
        row.browserStatus,
        row.browserError,
        row.finalCrawler,
        formatCsvDate(row.createdAt),
        formatCsvDate(row.updatedAt),
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

// Bulk delete leads by ID array — cascade handles outreach_queue, lead_list_items, lead_notes
router.post("/leads/bulk-delete", async (req, res) => {
  const { ids } = (req.body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "number")) {
    res.status(400).json({ error: "ids must be an array of lead ID numbers" });
    return;
  }
  if (ids.length === 0) {
    res.json({ deleted: 0 });
    return;
  }
  const deleted = await db
    .delete(leadsTable)
    .where(inArray(leadsTable.id, ids as number[]))
    .returning({ id: leadsTable.id });
  res.json({ deleted: deleted.length });
});

export default router;
