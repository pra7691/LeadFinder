import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/healthz — shallow liveness probe
// ---------------------------------------------------------------------------

describe("GET /api/healthz", () => {
  it("returns 200 with status ok regardless of DB state", async () => {
    const res = await request(app).get("/api/healthz").expect(200);
    expect(res.body.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// GET /api/healthz/deep — DB + schema check
// ---------------------------------------------------------------------------

describe("GET /api/healthz/deep", () => {
  const originalDbUrl = process.env["DATABASE_URL"];
  const OPTIONAL_KEYS = ["blocked_domains", "ai_enabled", "ai_scoring_enabled", "openai_model"] as const;

  afterEach(async () => {
    // Restore DATABASE_URL
    if (originalDbUrl !== undefined) {
      process.env["DATABASE_URL"] = originalDbUrl;
    } else {
      delete process.env["DATABASE_URL"];
    }
    // Restore any spies
    vi.restoreAllMocks();
  });

  // ── 1. Healthy DB ─────────────────────────────────────────────────────────

  it("returns ok when DB is connected and schema is healthy", async () => {
    // Seed all optional settings so the response is definitively "ok" not "warning"
    for (const key of OPTIONAL_KEYS) {
      await db
        .insert(appSettingsTable)
        .values({ key, value: "test" })
        .onConflictDoUpdate({
          target: appSettingsTable.key,
          set: { value: "test" },
        });
    }

    const res = await request(app).get("/api/healthz/deep").expect(200);

    expect(res.body.status).toBe("ok");
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.missingTables).toEqual([]);
    expect(res.body.database.missingColumns).toEqual([]);
    expect(res.body.database.warnings).toEqual([]);
    expect(res.body.message).toMatch(/healthy/i);

    // Cleanup seeded settings
    for (const key of OPTIONAL_KEYS) {
      await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key));
    }
  });

  // ── 2. Missing DATABASE_URL ───────────────────────────────────────────────

  it("returns error when DATABASE_URL is not configured", async () => {
    delete process.env["DATABASE_URL"];

    const res = await request(app).get("/api/healthz/deep").expect(503);

    expect(res.body.status).toBe("error");
    expect(res.body.database.connected).toBe(false);
    expect(res.body.database.missingTables).toEqual([]);
    expect(res.body.message).toMatch(/DATABASE_URL/i);
  });

  // ── 3. Missing tables ─────────────────────────────────────────────────────

  it("returns error and lists missing tables when schema is not applied", async () => {
    // Spy on db.execute:
    //   call 1 → SELECT 1 connection check (succeeds)
    //   call 2 → information_schema.tables query (returns subset missing campaigns + leads)
    //   call 3+ → any further queries (return empty rows)
    // Cast to any so TS doesn't enforce Drizzle's generic return type on the mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(db, "execute") as any;
    let callCount = 0;

    const ALL_TABLES = [
      "app_settings", "campaign_countries", "campaign_email_accounts",
      "campaign_keywords", "campaign_runs",
      "discovery_source_history", "email_accounts", "email_templates",
      "lead_list_items", "lead_lists", "lead_notes", "lead_status_history",
      "logs", "outreach_queue", "search_query_history", "search_result_history",
      // "campaigns" and "leads" deliberately omitted
    ];

    spy.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // SELECT 1 — connection test succeeds
        return { rows: [{ "?column?": 1 }] } as never;
      }
      if (callCount === 2) {
        // information_schema.tables — missing "campaigns" and "leads"
        return { rows: ALL_TABLES.map((t) => ({ table_name: t })) } as never;
      }
      // Any additional calls return empty rows
      return { rows: [] } as never;
    });

    const res = await request(app).get("/api/healthz/deep").expect(503);

    expect(res.body.status).toBe("error");
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.missingTables).toContain("campaigns");
    expect(res.body.database.missingTables).toContain("leads");
    expect(res.body.message).toContain("pnpm --filter @workspace/db run push");
  });

  // ── 4. Missing optional app_settings → warning ────────────────────────────

  it("returns warning when optional app_settings keys are absent", async () => {
    // Remove all optional settings to guarantee warnings
    for (const key of OPTIONAL_KEYS) {
      await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key));
    }

    const res = await request(app).get("/api/healthz/deep").expect(200);

    expect(res.body.status).toBe("warning");
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.missingTables).toEqual([]);
    expect(res.body.database.warnings.length).toBeGreaterThanOrEqual(1);
    expect(res.body.message).toMatch(/optional settings/i);
  });

  // ── 5. No secrets in response ─────────────────────────────────────────────

  it("does not expose secret values in the response body", async () => {
    const res = await request(app).get("/api/healthz/deep");
    const body = JSON.stringify(res.body);

    // DATABASE_URL contains credentials — extract the password portion if present
    if (originalDbUrl) {
      const passwordMatch = originalDbUrl.match(/\/\/[^:]+:([^@]+)@/);
      if (passwordMatch?.[1] && passwordMatch[1].length > 3) {
        expect(body).not.toContain(passwordMatch[1]);
      }
    }

    // SESSION_SECRET must never appear
    const sessionSecret = process.env["SESSION_SECRET"];
    if (sessionSecret && sessionSecret.length > 3) {
      expect(body).not.toContain(sessionSecret);
    }

    // SERPER_API_KEY must never appear
    const serperKey = process.env["SERPER_API_KEY"];
    if (serperKey && serperKey.length > 3) {
      expect(body).not.toContain(serperKey);
    }

    // The raw DATABASE_URL value itself must not appear in the response
    if (originalDbUrl && originalDbUrl.length > 10) {
      expect(body).not.toContain(originalDbUrl);
    }
  });
});
