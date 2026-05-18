import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpsertSettingBody, UpsertSettingParams } from "@workspace/api-zod";
import { testAIConnection } from "../services/email-generator";

const router = Router();

router.post("/settings/test-ai", async (_req, res) => {
  const result = await testAIConnection();
  res.json(result);
});

router.get("/settings", async (_req, res) => {
  const all = await db.select().from(appSettingsTable);
  // Mask the API key — only return whether it's set, not the actual value
  const masked = all.map((s) => {
    if (s.key === "openai_api_key" && s.value) {
      return { ...s, value: "••••••••" + s.value.slice(-4) };
    }
    return s;
  });
  res.json(masked);
});

router.put("/settings/:key", async (req, res) => {
  const { key } = UpsertSettingParams.parse({ key: req.params.key });
  const body = UpsertSettingBody.parse(req.body);

  // Don't overwrite a real key with the masked placeholder
  if (key === "openai_api_key" && body.value.startsWith("••••••••")) {
    const [existing] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key));
    if (existing) {
      res.json({ ...existing, value: "••••••••" + existing.value.slice(-4) });
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

  const response =
    key === "openai_api_key" && setting.value
      ? { ...setting, value: "••••••••" + setting.value.slice(-4) }
      : setting;

  res.json(response);
});

export default router;
