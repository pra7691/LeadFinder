/**
 * Strip invalid leading/trailing characters from the local part of an email
 * address (the part before @).  Handles cases like "//info@domain.com" that
 * arise when a URL path is accidentally stored as an email.
 * Returns the email unchanged if it has no @ or is already clean.
 */
export function sanitizeEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at)
    // Strip leading chars that are not valid email-local characters
    .replace(/^[^a-zA-Z0-9_.+\-]+/, "")
    // Strip trailing chars that are not valid email-local characters
    .replace(/[^a-zA-Z0-9_.+\-]+$/, "");
  const domain = email.slice(at + 1);
  return local ? `${local}@${domain}` : email;
}

export function parseLeadEmails(emails: string | null | undefined): string[] {
  if (!emails) return [];

  const trimmed = emails.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((email): email is string => typeof email === "string")
        .map((email) => sanitizeEmail(email.trim()))
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
    .map((email) => sanitizeEmail(email.trim().replace(/^["'\[]+|["'\]]+$/g, "")))
    .filter((email) => email.length > 0 && email.includes("@"));
}

export function getPrimaryLeadEmail(emails: string | null | undefined): string | null {
  return parseLeadEmails(emails)[0] ?? null;
}
