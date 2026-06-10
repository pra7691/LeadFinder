import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let emailTemplateAttachmentColumnPromise: Promise<void> | null = null;
let sendFormatColumnPromise: Promise<void> | null = null;
let outreachTrackingColumnsPromise: Promise<void> | null = null;
let unsubscribeSchemaPromise: Promise<void> | null = null;
let campaignEmailTemplateIdColumnPromise: Promise<void> | null = null;

export function ensureEmailTemplateAttachmentColumn(): Promise<void> {
  if (!emailTemplateAttachmentColumnPromise) {
    emailTemplateAttachmentColumnPromise = db
      .execute(sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS attachments_json text`)
      .then(() => undefined)
      .catch((err) => {
        // Reset so the next caller retries rather than getting a stale rejection.
        emailTemplateAttachmentColumnPromise = null;
        throw err;
      });
  }

  return emailTemplateAttachmentColumnPromise;
}

export function ensureSendFormatColumn(): Promise<void> {
  if (!sendFormatColumnPromise) {
    sendFormatColumnPromise = db
      .execute(sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS send_format text NOT NULL DEFAULT 'plain_text'`)
      .then(() => undefined)
      .catch((err) => {
        sendFormatColumnPromise = null;
        throw err;
      });
  }
  return sendFormatColumnPromise;
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
    ])
      .then(() => undefined)
      .catch((err) => {
        // Reset so the next caller retries rather than getting a stale rejection.
        outreachTrackingColumnsPromise = null;
        throw err;
      });
  }

  return outreachTrackingColumnsPromise;
}

export function ensureCampaignEmailTemplateIdColumn(): Promise<void> {
  if (!campaignEmailTemplateIdColumnPromise) {
    campaignEmailTemplateIdColumnPromise = db
      .execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_template_id integer`)
      .then(() => undefined)
      .catch((err) => {
        campaignEmailTemplateIdColumnPromise = null;
        throw err;
      });
  }
  return campaignEmailTemplateIdColumnPromise;
}

export function ensureUnsubscribeSchema(): Promise<void> {
  if (!unsubscribeSchemaPromise) {
    unsubscribeSchemaPromise = Promise.all([
      // Create the unsubscribes table
      db.execute(sql`
        CREATE TABLE IF NOT EXISTS unsubscribes (
          id serial PRIMARY KEY,
          email text NOT NULL UNIQUE,
          token text NOT NULL UNIQUE,
          outreach_id integer REFERENCES outreach_queue(id) ON DELETE SET NULL,
          company_name text,
          unsubscribed_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `),
      // Add unsubscribe_token column to outreach_queue
      db.execute(sql`ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS unsubscribe_token text`),
    ])
      .then(() => undefined)
      .catch((err) => {
        unsubscribeSchemaPromise = null;
        throw err;
      });
  }
  return unsubscribeSchemaPromise;
}
