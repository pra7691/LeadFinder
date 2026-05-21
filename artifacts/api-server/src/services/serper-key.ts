/**
 * Serper API key resolution — single source of truth.
 *
 * Lookup order:
 *   1. app_settings table (key: "serper_api_key") — configured via Settings UI
 *   2. SERPER_API_KEY environment variable — legacy / server-deployment fallback
 *
 * Returns null if neither is configured.
 * Never throws — DB failures fall through to the env fallback.
 */

import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getSerperApiKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "serper_api_key"))
      .limit(1);
    if (row?.value) return row.value;
  } catch {
    // DB not reachable — fall through to env
  }
  return process.env["SERPER_API_KEY"] ?? null;
}
