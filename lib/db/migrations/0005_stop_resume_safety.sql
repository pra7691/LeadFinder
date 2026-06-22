ALTER TABLE campaign_runs
  ADD COLUMN IF NOT EXISTS final_list_id integer REFERENCES lead_lists(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_outreach_batch_recipient_unique
  ON outreach_queue (outreach_batch_id, lower(recipient_email))
  WHERE outreach_batch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_incremental_campaign_recipient_unique
  ON outreach_queue (campaign_id, lower(recipient_email))
  WHERE outreach_batch_id IS NOT NULL
    AND campaign_id IS NOT NULL
    AND status IN ('pending_review', 'approved', 'draft', 'queued', 'sent');
