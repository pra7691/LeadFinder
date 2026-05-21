import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpsertSettingBody, UpsertSettingParams } from "@workspace/api-zod";
import { testAIConnection } from "../services/email-generator";
import { getSerperApiKey } from "../services/serper-key";
import { searchSerper } from "../services/serper";

const router = Router();

// Keys that contain secrets and must be masked in responses
const MASKED_KEYS = ["openai_api_key", "serper_api_key"];

function maskValue(key: string, value: string): string {
  if (MASKED_KEYS.includes(key) && value) {
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
  const masked = all.map((s) => ({
    ...s,
    value: maskValue(s.key, s.value),
  }));
  res.json(masked);
});

router.put("/settings/:key", async (req, res) => {
  const { key } = UpsertSettingParams.parse({ key: req.params.key });
  const body = UpsertSettingBody.parse(req.body);

  // Don't overwrite a real secret with the masked placeholder
  if (MASKED_KEYS.includes(key) && isMaskedPlaceholder(body.value)) {
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

  res.json({ ...setting, value: maskValue(key, setting.value) });
});

export default router;
