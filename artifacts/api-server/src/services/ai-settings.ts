/**
 * Shared AI settings reader — reads openai_api_key, openai_model, ai_enabled,
 * and ai_scoring_enabled
 * from the app_settings table. Single source of truth for all AI features.
 */

import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";

export interface AISettings {
  enabled: boolean;
  scoringEnabled: boolean;
  apiKey: string | null;
  model: string;
}

export async function getAISettings(): Promise<AISettings> {
  const rows = await db.select().from(appSettingsTable);
  const find = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  const dbKey = find("openai_api_key");
  return {
    enabled: find("ai_enabled") === "true",
    scoringEnabled: find("ai_scoring_enabled") === "true",
    apiKey: dbKey && dbKey.length > 0 ? dbKey : process.env["OPENAI_API_KEY"] ?? null,
    model: find("openai_model") ?? "gpt-4o-mini",
  };
}
