/**
 * Shared AI settings reader — reads openai_api_key, openai_model, and ai_enabled
 * from the app_settings table. Single source of truth for all AI features.
 */

import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";

export interface AISettings {
  enabled: boolean;
  apiKey: string | null;
  model: string;
}

export async function getAISettings(): Promise<AISettings> {
  const rows = await db.select().from(appSettingsTable);
  const find = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  return {
    enabled: find("ai_enabled") === "true",
    apiKey: find("openai_api_key"),
    model: find("openai_model") ?? "gpt-4o-mini",
  };
}
