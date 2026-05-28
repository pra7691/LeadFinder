import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Parse a newline/comma-separated list of emails into a normalised Set. */
export function parseBlockedEmails(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\n,]/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Returns true if the given email is on the blocked_emails list (exact match only). */
export async function isEmailBlacklisted(email: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "blocked_emails"));
  const blacklist = parseBlockedEmails(row?.value);
  return blacklist.has(email.trim().toLowerCase());
}
