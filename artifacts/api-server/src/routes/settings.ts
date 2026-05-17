import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpsertSettingBody, UpsertSettingParams } from "@workspace/api-zod";

const router = Router();

router.get("/settings", async (_req, res) => {
  const settings = await db.select().from(appSettingsTable);
  res.json(settings);
});

router.put("/settings/:key", async (req, res) => {
  const { key } = UpsertSettingParams.parse({ key: req.params.key });
  const body = UpsertSettingBody.parse(req.body);

  const [setting] = await db
    .insert(appSettingsTable)
    .values({ key, value: body.value })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: body.value, updatedAt: new Date() },
    })
    .returning();

  res.json(setting);
});

export default router;
