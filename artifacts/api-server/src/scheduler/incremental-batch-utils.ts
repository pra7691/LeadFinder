import { sanitizeEmail } from "../services/lead-emails";

export function planProcessingBatchSizes(totalLeads: number, batchSize = 50): number[] {
  const total = Math.max(0, Math.floor(totalLeads));
  const size = Math.max(1, Math.floor(batchSize));
  const batches: number[] = [];
  for (let remaining = total; remaining > 0; remaining -= size) {
    batches.push(Math.min(size, remaining));
  }
  return batches;
}

export function normalizeUniqueRecipients(emails: string[]): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const rawEmail of emails) {
    const email = sanitizeEmail(rawEmail.trim()).toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }
  return recipients;
}
