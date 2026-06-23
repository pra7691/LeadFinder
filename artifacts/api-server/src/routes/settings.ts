import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpsertSettingBody, UpsertSettingParams } from "@workspace/api-zod";
import { testAIConnection } from "../services/email-generator";
import { getSerperApiKey } from "../services/serper-key";
import { searchSerper } from "../services/serper";
import { resumeQueuedOutreachSendQueue } from "./outreach-send";
import { logger } from "../lib/logger";

const router = Router();

// Keys that contain secrets and must be masked in responses
const MASKED_KEYS = ["openai_api_key", "serper_api_key", "email_tracker_admin_secret"] as const;
const SECRET_ENV_KEYS: Record<string, string> = {
  openai_api_key: "OPENAI_API_KEY",
  serper_api_key: "SERPER_API_KEY",
  email_tracker_admin_secret: "EMAIL_TRACKER_ADMIN_SECRET",
};

function isMaskedKey(key: string): key is (typeof MASKED_KEYS)[number] {
  return MASKED_KEYS.some((maskedKey) => maskedKey === key);
}

function maskValue(key: string, value: string): string {
  if (isMaskedKey(key) && value) {
    return "••••••••" + value.slice(-4);
  }
  return value;
}

function isMaskedPlaceholder(value: string): boolean {
  return value.startsWith("••••••••");
}

router.post("/settings/test-ai", async (_req, res) => {
  const result = await testAIConnection();
  res.json(result);
});

router.post("/settings/test-serper", async (_req, res) => {
  const key = await getSerperApiKey();
  if (!key) {
    res.status(400).json({
      success: false,
      message:
        "Serper API key is not configured. Add it in Settings → Search API Settings or set SERPER_API_KEY in environment.",
    });
    return;
  }

  try {
    const results = await searchSerper("site:example.com", key, 1);
    res.json({
      success: true,
      message: `Serper connection successful — ${results.length} result(s) returned.`,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Strip the key value from any error text before returning it
    const safe = raw.replace(key, "[REDACTED]");
    res.status(502).json({
      success: false,
      message: `Serper API error: ${safe.slice(0, 200)}`,
    });
  }
});

router.get("/settings", async (_req, res) => {
  const all = await db.select().from(appSettingsTable);
  const byKey = new Map(all.map((s) => [s.key, s]));
  const envRows = Object.entries(SECRET_ENV_KEYS)
    .flatMap(([key, envVar]) => {
      const existing = byKey.get(key);
      if (existing && existing.value && !isMaskedPlaceholder(existing.value)) return [];
      const value = process.env[envVar];
      if (!value) return [];
      const now = new Date().toISOString();
      return [{
        id: 0,
        key,
        value,
        createdAt: now,
        updatedAt: now,
        // Signal to the UI that this value came from server environment, not DB.
        source: "server_env",
      }];
    });
  const masked = [...all, ...envRows].map((s) => ({
    ...s,
    value: maskValue(s.key, s.value),
    source: (s as { source?: string }).source ?? "database",
  }));
  res.json(masked);
});

router.put("/settings/:key", async (req, res) => {
  const { key } = UpsertSettingParams.parse({ key: req.params.key });
  const body = UpsertSettingBody.parse(req.body);

  // Don't overwrite a real secret with the masked placeholder
  if (isMaskedKey(key) && isMaskedPlaceholder(body.value)) {
    const [existing] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key));
    if (existing) {
      res.json({ ...existing, value: maskValue(key, existing.value) });
      return;
    }
  }

  const [setting] = await db
    .insert(appSettingsTable)
    .values({ key, value: body.value })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: body.value, updatedAt: new Date() },
    })
    .returning();

  if (key === "global_max_emails_per_day") {
    resumeQueuedOutreachSendQueue().catch((err) =>
      logger.error({ err }, "Failed to resume queued outreach after global email limit update"),
    );
  }

  res.json({ ...setting, value: maskValue(key, setting.value) });
});

export default router;
