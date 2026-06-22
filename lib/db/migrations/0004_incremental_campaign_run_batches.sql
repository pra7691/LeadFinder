CREATE TABLE IF NOT EXISTS campaign_run_batches (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_run_id integer NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
  batch_number integer NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  crawled_leads_count integer NOT NULL DEFAULT 0,
  scored_count integer NOT NULL DEFAULT 0,
  qualified_count integer NOT NULL DEFAULT 0,
  outreach_drafts_created integer NOT NULL DEFAULT 0,
  email_template_id integer REFERENCES email_templates(id) ON DELETE SET NULL,
  sender_account_id integer REFERENCES email_accounts(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_run_batches_run_number_unique UNIQUE (campaign_run_id, batch_number)
);

CREATE TABLE IF NOT EXISTS campaign_run_batch_items (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_run_id integer NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
  batch_id integer NOT NULL REFERENCES campaign_run_batches(id) ON DELETE CASCADE,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_run_batch_items_run_lead_unique UNIQUE (campaign_run_id, lead_id)
);

ALTER TABLE outreach_queue
  ADD COLUMN IF NOT EXISTS outreach_batch_id integer REFERENCES campaign_run_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS campaign_run_batches_run_status_idx
  ON campaign_run_batches (campaign_run_id, status);

CREATE INDEX IF NOT EXISTS campaign_run_batch_items_batch_idx
  ON campaign_run_batch_items (batch_id);

CREATE INDEX IF NOT EXISTS outreach_queue_outreach_batch_idx
  ON outreach_queue (outreach_batch_id);

CREATE INDEX IF NOT EXISTS outreach_queue_campaign_recipient_status_idx
  ON outreach_queue (campaign_id, lower(recipient_email))
  WHERE campaign_id IS NOT NULL;
