import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let emailTemplateAttachmentColumnPromise: Promise<void> | null = null;

export function ensureEmailTemplateAttachmentColumn(): Promise<void> {
  if (!emailTemplateAttachmentColumnPromise) {
    emailTemplateAttachmentColumnPromise = db
      .execute(sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS attachments_json text`)
      .then(() => undefined);
  }

  return emailTemplateAttachmentColumnPromise;
}
