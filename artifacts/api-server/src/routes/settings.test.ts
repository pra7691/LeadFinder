import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POST /api/settings/test-serper
// ---------------------------------------------------------------------------

describe("POST /api/settings/test-serper", () => {
  const ORIGINAL_SERPER_ENV = process.env["SERPER_API_KEY"];
  const FAKE_DB_KEY = "db-key-serper-abc123";
  const FAKE_ENV_KEY = "env-key-serper-xyz789";

  beforeEach(async () => {
    // Clear DB key and env key before every test
    await db
      .delete(appSettingsTable)
      .where(eq(appSettingsTable.key, "serper_api_key"));
    delete process.env["SERPER_API_KEY"];
  });

  afterEach(() => {
    // Restore env var
    if (ORIGINAL_SERPER_ENV !== undefined) {
      process.env["SERPER_API_KEY"] = ORIGINAL_SERPER_ENV;
    } else {
      delete process.env["SERPER_API_KEY"];
    }
    vi.restoreAllMocks();
  });

  // ── 1. Missing key ────────────────────────────────────────────────────────

  it("returns 400 when no key is configured", async () => {
    const res = await request(app)
      .post("/api/settings/test-serper")
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Serper API key is not configured/i);
    expect(res.body.message).toMatch(/Search API Settings|environment/i);
  });

  // ── 2. Env fallback ───────────────────────────────────────────────────────

  it("uses SERPER_API_KEY env var when DB key is absent", async () => {
    process.env["SERPER_API_KEY"] = FAKE_ENV_KEY;

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ organic: [{ title: "T", link: "L", snippet: "S", position: 1 }] }),
    } as Response);

    const res = await request(app)
      .post("/api/settings/test-serper")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/Serper connection successful/i);

    // Assert the mocked fetch was called with the env key
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const reqInit = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reqInit.headers["X-API-KEY"]).toBe(FAKE_ENV_KEY);
  });

  // ── 3. DB key priority ────────────────────────────────────────────────────

  it("prefers DB serper_api_key over env var", async () => {
    // Seed DB key
    await db
      .insert(appSettingsTable)
      .values({ key: "serper_api_key", value: FAKE_DB_KEY })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: FAKE_DB_KEY },
      });

    // Also set different env key
    process.env["SERPER_API_KEY"] = FAKE_ENV_KEY;

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ organic: [] }),
    } as Response);

    const res = await request(app)
      .post("/api/settings/test-serper")
      .expect(200);

    expect(res.body.success).toBe(true);

    // Assert the DB key was used, not the env key
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const reqInit = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(reqInit.headers["X-API-KEY"]).toBe(FAKE_DB_KEY);
    expect(reqInit.headers["X-API-KEY"]).not.toBe(FAKE_ENV_KEY);
  });

  // ── 4. Serper failure ───────────────────────────────────────────────────────

  it("returns 502 when Serper API responds with an error", async () => {
    process.env["SERPER_API_KEY"] = FAKE_ENV_KEY;

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    } as Response);

    const res = await request(app)
      .post("/api/settings/test-serper")
      .expect(502);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Serper API error/i);
    expect(res.body.message).toMatch(/429/i);
  });

  it("returns 502 when Serper API throws a network error", async () => {
    process.env["SERPER_API_KEY"] = FAKE_ENV_KEY;

    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Connection timeout"));

    const res = await request(app)
      .post("/api/settings/test-serper")
      .expect(502);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Serper API error/i);
    expect(res.body.message).toMatch(/Connection timeout/i);
  });

  // ── 5. Secret redaction ───────────────────────────────────────────────────

  it("does not leak the Serper API key in error responses", async () => {
    const SECRET_KEY = "test-secret-serper-key-123";
    process.env["SERPER_API_KEY"] = SECRET_KEY;

    vi.spyOn(global, "fetch").mockRejectedValueOnce(
      new Error(`Request failed with key ${SECRET_KEY}`)
    );

    const res = await request(app)
      .post("/api/settings/test-serper")
      .expect(502);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(SECRET_KEY);
    expect(body).toContain("[REDACTED]");
  });
});
