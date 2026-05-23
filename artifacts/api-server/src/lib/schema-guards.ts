import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let emailTemplateAttachmentColumnPromise: Promise<void> | null = null;
let outreachTrackingColumnsPromise: Promise<void> | null = null;

export function ensureEmailTemplateAttachmentColumn(): Promise<void> {
  if (!emailTemplateAttachmentColumnPromise) {
    emailTemplateAttachmentColumnPromise = db
      .execute(sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS attachments_json text`)
      .then(() => undefined);
  }

  return emailTemplateAttachmentColumnPromise;
}

export function ensureOutreachTrackingColumns(): Promise<void> {
  if (!outreachTrackingColumnsPromise) {
    outreachTrackingColumnsPromise = Promise.all([
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS tracking_id text`),
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0`),
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0`),
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS first_opened_at timestamptz`),
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS last_opened_at timestamptz`),
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS last_clicked_at timestamptz`),
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS batch_id text`),
    ]).then(() => undefined);
  }

  return outreachTrackingColumnsPromise;
}
