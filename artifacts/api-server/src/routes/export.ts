/**
 * Export route — GET /leads/export
 * Streams CSV or XLSX of leads with optional filters.
 * Writes an export log entry on completion.
 */

import { Router } from "express";
import ExcelJS from "exceljs";
import { db } from "@workspace/db";
import { leadsTable, logsTable, campaignsTable, campaignRunsTable } from "@workspace/db";
import { and, eq, gte, inArray, type SQL } from "drizzle-orm";
import { saveExportFile } from "../services/export-files";

const router = Router();

// ── Export shape ───────────────────────────────────────────────────────────

type ExportRow = {
  companyName: string;
  websiteUrl: string;
  rootDomain: string;
  sourceCountry: string | null;
  country: string | null;
  emails: string | null;
  phoneNumbers: string | null;
  address: string | null;
  linkedinUrl: string | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
  qualificationStatus: string;
  outreachStatus: string;
  leadType: string | null;
  emailDomainStatus: string | null;
  sourceType: string | null;
  discoverySourceDomain: string | null;
  discoverySourceUrl: string | null;
  sourceQuery: string | null;
  sourceKeyword: string | null;
  notes: string | null;
  campaignName: string | null;
  runStartedAt: Date | string | null;
};

type ColDef = {
  header: string;
  key: keyof ExportRow;
  isArray?: boolean;
  isDate?: boolean;
  wide?: boolean;
};

const COLUMNS: ColDef[] = [
  { header: "Company Name",            key: "companyName" },
  { header: "Website URL",             key: "websiteUrl" },
  { header: "Root Domain",             key: "rootDomain" },
  { header: "Target Country",          key: "sourceCountry" },
  { header: "Company Country",         key: "country" },
  { header: "Emails",                  key: "emails",       isArray: true },
  { header: "Phone Numbers",           key: "phoneNumbers", isArray: true },
  { header: "Address",                 key: "address",      wide: true },
  { header: "LinkedIn URL",            key: "linkedinUrl" },
  { header: "Relevance Score",         key: "relevanceScore" },
  { header: "Relevance Reason",        key: "relevanceReason", wide: true },
  { header: "Qualification Status",    key: "qualificationStatus" },
  { header: "Outreach Status",         key: "outreachStatus" },
  { header: "Lead Type",               key: "leadType" },
  { header: "Email Domain Status",     key: "emailDomainStatus" },
  { header: "Source Type",             key: "sourceType" },
  { header: "Discovery Source Domain", key: "discoverySourceDomain" },
  { header: "Discovery Source URL",    key: "discoverySourceUrl", wide: true },
  { header: "Source Query",            key: "sourceQuery",  wide: true },
  { header: "Source Keyword",          key: "sourceKeyword" },
  { header: "Campaign Name",           key: "campaignName" },
  { header: "Campaign Run Date",       key: "runStartedAt", isDate: true },
  { header: "Notes",                   key: "notes",        wide: true },
];

function formatValue(v: unknown, col: ColDef): string {
  if (v == null) return "";
  if (col.isDate) {
    const d = v instanceof Date ? v : new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  }
  if (col.isArray && typeof v === "string") {
    return v.split(",").map((s) => s.trim()).join("; ");
  }
  return String(v);
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildLeadsCsv(rows: ExportRow[]) {
  const lines = [COLUMNS.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvEscape(formatValue(row[c.key], c))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function buildLeadsWorkbook(rows: ExportRow[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LeadGen";
  wb.created = new Date();

  const ws = wb.addWorksheet("Leads");

  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.wide ? 40 : 22,
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 20;

  for (const row of rows) {
    const rowData: Record<string, unknown> = {};
    for (const col of COLUMNS) {
      rowData[col.key] = formatValue(row[col.key], col);
    }
    ws.addRow(rowData);
  }

  for (let r = 2; r <= rows.length + 1; r++) {
    if (r % 2 === 0) {
      ws.getRow(r).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5FF" } };
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  return wb;
}

// ── Route ──────────────────────────────────────────────────────────────────

router.get("/leads/export", async (req, res) => {
  const format = (req.query.format as string) || "csv";
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
  const status = req.query.status as string | undefined;
  const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
  const country = req.query.country as string | undefined;
  const leadIdsRaw = req.query.leadIds as string | undefined;
  const saveToFile = req.query.save === "1" || req.query.save === "true";
  const leadIds = leadIdsRaw
    ? leadIdsRaw.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0)
    : undefined;

  // ── Build WHERE conditions ───────────────────────────────────────────────
  const conditions: SQL[] = [];

  if (leadIds && leadIds.length > 0) {
    conditions.push(inArray(leadsTable.id, leadIds));
  } else {
    if (campaignId !== undefined && !isNaN(campaignId)) {
      conditions.push(eq(leadsTable.campaignId, campaignId));
    }
    if (status) {
      switch (status) {
        case "approved":       conditions.push(eq(leadsTable.reviewStatus, "approved")); break;
        case "pending":        conditions.push(eq(leadsTable.reviewStatus, "pending")); break;
        case "contacted":      conditions.push(eq(leadsTable.leadStatus, "contacted")); break;
        case "high_relevance": conditions.push(gte(leadsTable.relevanceScore, 80)); break;
        default:               conditions.push(eq(leadsTable.leadStatus, status));
      }
    }
    if (minScore !== undefined && !isNaN(minScore)) {
      conditions.push(gte(leadsTable.relevanceScore, minScore));
    }
    if (country) {
      conditions.push(eq(leadsTable.country, country));
    }
  }

  // ── Query with campaign + run JOINs ──────────────────────────────────────
  const baseQuery = db
    .select({
      companyName: leadsTable.companyName,
      websiteUrl: leadsTable.websiteUrl,
      rootDomain: leadsTable.rootDomain,
      sourceCountry: leadsTable.sourceCountry,
      country: leadsTable.country,
      emails: leadsTable.emails,
      phoneNumbers: leadsTable.phoneNumbers,
      address: leadsTable.address,
      linkedinUrl: leadsTable.linkedinUrl,
      relevanceScore: leadsTable.relevanceScore,
      relevanceReason: leadsTable.relevanceReason,
      qualificationStatus: leadsTable.qualificationStatus,
      outreachStatus: leadsTable.outreachStatus,
      leadType: leadsTable.leadType,
      emailDomainStatus: leadsTable.emailDomainStatus,
      sourceType: leadsTable.sourceType,
      discoverySourceDomain: leadsTable.discoverySourceDomain,
      discoverySourceUrl: leadsTable.discoverySourceUrl,
      sourceQuery: leadsTable.sourceQuery,
      sourceKeyword: leadsTable.sourceKeyword,
      notes: leadsTable.notes,
      campaignName: campaignsTable.name,
      runStartedAt: campaignRunsTable.startedAt,
    })
    .from(leadsTable)
    .leftJoin(campaignsTable, eq(leadsTable.campaignId, campaignsTable.id))
    .leftJoin(campaignRunsTable, eq(leadsTable.campaignRunId, campaignRunsTable.id));

  const rows: ExportRow[] =
    conditions.length > 0
      ? await baseQuery.where(and(...conditions)).limit(10000)
      : await baseQuery.limit(10000);

  const ts = new Date().toISOString().slice(0, 10);
  const filename = `leads-export-${ts}`;

  // ── Log the export ───────────────────────────────────────────────────────
  const filterDesc = [
    campaignId ? `campaign=${campaignId}` : null,
    status ? `status=${status}` : null,
    minScore ? `minScore=${minScore}` : null,
    country ? `country=${country}` : null,
    leadIds?.length ? `ids=${leadIds.length}` : null,
  ].filter(Boolean).join(", ");

  await db.insert(logsTable).values({
    campaignId: campaignId ?? null,
    type: "export",
    message: `Exported ${rows.length} leads as ${format.toUpperCase()}${filterDesc ? ` (${filterDesc})` : ""}`,
  });

  // ── CSV ──────────────────────────────────────────────────────────────────
  if (format === "csv") {
    const csv = buildLeadsCsv(rows);
    if (saveToFile) {
      const saved = await saveExportFile(`${filename}.csv`, csv);
      res.json({ saved: true, ...saved, rows: rows.length });
      return;
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(csv);
    return;
  }

  // ── XLSX ─────────────────────────────────────────────────────────────────
  const wb = buildLeadsWorkbook(rows);
  if (saveToFile) {
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const saved = await saveExportFile(`${filename}.xlsx`, buffer);
    res.json({ saved: true, ...saved, rows: rows.length });
    return;
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);

  await wb.xlsx.write(res);
  res.end();
});

export default router;
