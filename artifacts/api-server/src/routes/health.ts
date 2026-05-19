import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/healthz — shallow liveness probe
// ---------------------------------------------------------------------------
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ---------------------------------------------------------------------------
// Deep health check constants
// ---------------------------------------------------------------------------

const REQUIRED_TABLES = [
  "app_settings",
  "campaign_countries",
  "campaign_email_accounts",
  "campaign_keywords",
  "campaign_runs",
  "campaigns",
  "discovery_source_history",
  "email_accounts",
  "email_templates",
  "lead_list_items",
  "lead_lists",
  "lead_notes",
  "lead_status_history",
  "leads",
  "logs",
  "outreach_queue",
  "search_query_history",
  "search_result_history",
] as const;

const CRITICAL_COLUMNS: Record<string, string[]> = {
  campaigns: [
    "id", "name", "is_active", "max_searches_per_day",
    "schedule_type", "last_run_status",
  ],
  campaign_runs: [
    "id", "campaign_id", "status", "started_at",
    "total_new_leads", "total_blocked",
  ],
  leads: [
    "id", "campaign_id", "root_domain", "website_url",
    "lead_status", "review_status", "relevance_score",
  ],
  outreach_queue: [
    "id", "lead_id", "recipient_email", "subject", "body", "status",
  ],
  email_accounts: [
    "id", "email", "smtp_host", "smtp_port", "smtp_password", "is_active",
  ],
};

const OPTIONAL_SETTINGS = [
  "blocked_domains",
  "ai_enabled",
  "ai_scoring_enabled",
  "openai_model",
] as const;

/** Strip credentials from a connection error message so it is safe to surface. */
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/postgresql:\/\/[^@\s]+@/gi, "postgresql://***@")
    .replace(/password[=:][^\s,;]*/gi, "password=***");
}

// ---------------------------------------------------------------------------
// GET /api/healthz/deep — DB connectivity + schema check
// ---------------------------------------------------------------------------
router.get("/healthz/deep", async (_req, res) => {
  // ── 1. DATABASE_URL must exist ────────────────────────────────────────────
  if (!process.env["DATABASE_URL"]) {
    res.status(503).json({
      status: "error",
      database: { connected: false, missingTables: [], missingColumns: [], warnings: [] },
      message: "DATABASE_URL is not configured",
    });
    return;
  }

  // ── 2. Test DB connectivity ───────────────────────────────────────────────
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      status: "error",
      database: { connected: false, missingTables: [], missingColumns: [], warnings: [] },
      message: `Database connection failed: ${sanitizeErrorMessage(raw)}`,
    });
    return;
  }

  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const warnings: string[] = [];

  // ── 3. Check required tables ──────────────────────────────────────────────
  try {
    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `);
    const existing = new Set(
      (result.rows as { table_name: string }[]).map((r) => r.table_name),
    );
    for (const t of REQUIRED_TABLES) {
      if (!existing.has(t)) missingTables.push(t);
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      status: "error",
      database: { connected: true, missingTables: [], missingColumns: [], warnings: [] },
      message: `Failed to query schema information: ${sanitizeErrorMessage(raw)}`,
    });
    return;
  }

  // ── 4. Check critical columns (only when all tables present) ──────────────
  if (missingTables.length === 0) {
    try {
      const tableNames = Object.keys(CRITICAL_COLUMNS);
      const tableList = tableNames.map((t) => `'${t}'`).join(",");
      const colsResult = await db.execute(sql.raw(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (${tableList})
      `));
      const colsByTable = new Map<string, Set<string>>();
      for (const row of colsResult.rows as { table_name: string; column_name: string }[]) {
        if (!colsByTable.has(row.table_name)) colsByTable.set(row.table_name, new Set());
        colsByTable.get(row.table_name)!.add(row.column_name);
      }
      for (const [table, cols] of Object.entries(CRITICAL_COLUMNS)) {
        const existingCols = colsByTable.get(table) ?? new Set<string>();
        for (const col of cols) {
          if (!existingCols.has(col)) missingColumns.push(`${table}.${col}`);
        }
      }
    } catch {
      // Non-fatal — column check is best-effort
    }
  }

  // ── 5. Check optional app_settings keys ──────────────────────────────────
  if (missingTables.length === 0) {
    try {
      const keyList = OPTIONAL_SETTINGS.map((k) => `'${k}'`).join(",");
      const settingsResult = await db.execute(sql.raw(`
        SELECT key FROM app_settings WHERE key IN (${keyList})
      `));
      const existingKeys = new Set(
        (settingsResult.rows as { key: string }[]).map((r) => r.key),
      );
      for (const key of OPTIONAL_SETTINGS) {
        if (!existingKeys.has(key)) {
          warnings.push(
            `Optional setting "${key}" is not configured — set it in Settings`,
          );
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // ── Determine overall status ──────────────────────────────────────────────
  let status: "ok" | "warning" | "error";
  let message: string;

  if (missingTables.length > 0 || missingColumns.length > 0) {
    status = "error";
    message =
      "Database schema is not applied. Run: pnpm --filter @workspace/db run push";
  } else if (warnings.length > 0) {
    status = "warning";
    message = "Database connected but some optional settings are not configured";
  } else {
    status = "ok";
    message = "Database schema is healthy";
  }

  res.status(status === "error" ? 503 : 200).json({
    status,
    database: { connected: true, missingTables, missingColumns, warnings },
    message,
  });
});

export default router;
