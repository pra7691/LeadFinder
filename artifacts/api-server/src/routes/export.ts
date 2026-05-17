/**
 * Export route — GET /leads/export
 * Streams CSV or XLSX of leads with optional filters.
 * Writes an export log entry on completion.
 */

import { Router } from "express";
import ExcelJS from "exceljs";
import { db } from "@workspace/db";
import { leadsTable, logsTable } from "@workspace/db";
import { and, eq, gte, inArray, type SQL } from "drizzle-orm";

const router = Router();

type LeadRow = typeof leadsTable.$inferSelect;

const COLUMNS: { header: string; key: keyof LeadRow }[] = [
  { header: "Company Name",     key: "companyName" },
  { header: "Domain",           key: "rootDomain" },
  { header: "Website",          key: "websiteUrl" },
  { header: "Country",          key: "country" },
  { header: "Emails",           key: "emails" },
  { header: "Phones",           key: "phoneNumbers" },
  { header: "Relevance Score",  key: "relevanceScore" },
  { header: "Relevance Reason", key: "relevanceReason" },
  { header: "Lead Status",      key: "leadStatus" },
  { header: "Review Status",    key: "reviewStatus" },
  { header: "Notes",            key: "notes" },
];

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get("/leads/export", async (req, res) => {
  const format = (req.query.format as string) || "csv";
  const campaignId = req.query.campaignId
    ? Number(req.query.campaignId)
    : undefined;
  const status = req.query.status as string | undefined;
  const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
  const country = req.query.country as string | undefined;
  const leadIdsRaw = req.query.leadIds as string | undefined;
  const leadIds = leadIdsRaw
    ? leadIdsRaw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n) && n > 0)
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
      // status maps to either leadStatus or reviewStatus filter shortcuts
      switch (status) {
        case "approved":
          conditions.push(eq(leadsTable.reviewStatus, "approved"));
          break;
        case "pending":
          conditions.push(eq(leadsTable.reviewStatus, "pending"));
          break;
        case "contacted":
          conditions.push(eq(leadsTable.leadStatus, "contacted"));
          break;
        case "high_relevance":
          conditions.push(gte(leadsTable.relevanceScore, 80));
          break;
        default:
          conditions.push(eq(leadsTable.leadStatus, status));
      }
    }
    if (minScore !== undefined && !isNaN(minScore)) {
      conditions.push(gte(leadsTable.relevanceScore, minScore));
    }
    if (country) {
      conditions.push(eq(leadsTable.country, country));
    }
  }

  const leads =
    conditions.length > 0
      ? await db
          .select()
          .from(leadsTable)
          .where(and(...conditions))
          .limit(10000)
      : await db.select().from(leadsTable).limit(10000);

  const ts = new Date().toISOString().slice(0, 10);
  const filename = `leads-export-${ts}`;

  // ── Log the export ───────────────────────────────────────────────────────
  const filterDesc = [
    campaignId ? `campaign=${campaignId}` : null,
    status ? `status=${status}` : null,
    minScore ? `minScore=${minScore}` : null,
    country ? `country=${country}` : null,
    leadIds?.length ? `ids=${leadIds.length}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  await db.insert(logsTable).values({
    campaignId: campaignId ?? null,
    type: "export",
    message: `Exported ${leads.length} leads as ${format.toUpperCase()}${filterDesc ? ` (${filterDesc})` : ""}`,
  });

  // ── CSV ──────────────────────────────────────────────────────────────────
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}.csv"`,
    );

    const header = COLUMNS.map((c) => csvEscape(c.header)).join(",");
    res.write(header + "\r\n");

    for (const lead of leads) {
      const row = COLUMNS.map((c) => csvEscape(lead[c.key])).join(",");
      res.write(row + "\r\n");
    }

    res.end();
    return;
  }

  // ── XLSX ─────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "LeadGen";
  wb.created = new Date();

  const ws = wb.addWorksheet("Leads");

  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key as string,
    width: c.key === "relevanceReason" || c.key === "notes" ? 40 : 22,
  }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F46E5" },
  };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 20;

  // Add data
  for (const lead of leads) {
    const rowData: Record<string, unknown> = {};
    for (const col of COLUMNS) {
      rowData[col.key as string] = lead[col.key] ?? "";
    }
    ws.addRow(rowData);
  }

  // Alternate row shading
  for (let r = 2; r <= leads.length + 1; r++) {
    if (r % 2 === 0) {
      ws.getRow(r).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF5F5FF" },
      };
    }
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}.xlsx"`,
  );

  await wb.xlsx.write(res);
  res.end();
});

export default router;
