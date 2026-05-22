export function parseLeadEmails(emails: string | null | undefined): string[] {
  if (!emails) return [];

  const trimmed = emails.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((email): email is string => typeof email === "string")
        .map((email) => email.trim())
        .filter((email) => email.length > 0 && email.includes("@"));
    }
    if (typeof parsed === "string") {
      return parseLeadEmails(parsed);
    }
  } catch {
    // Older/user-edited leads may store emails as plain comma/semicolon text.
  }

  return trimmed
    .split(/[,;\n]/)
    .map((email) => email.trim().replace(/^["'\[]+|["'\]]+$/g, ""))
    .filter((email) => email.length > 0 && email.includes("@"));
}

export function getPrimaryLeadEmail(emails: string | null | undefined): string | null {
  return parseLeadEmails(emails)[0] ?? null;
}
