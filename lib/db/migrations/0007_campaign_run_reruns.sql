ALTER TABLE campaign_runs
  ADD COLUMN IF NOT EXISTS configuration_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS rerun_of_run_id integer REFERENCES campaign_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rerun_number integer,
  ADD COLUMN IF NOT EXISTS rerun_request_key text;

ALTER TABLE outreach_queue
  ADD COLUMN IF NOT EXISTS template_snapshot jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_runs_rerun_source_number_unique
  ON campaign_runs (rerun_of_run_id, rerun_number)
  WHERE rerun_of_run_id IS NOT NULL AND rerun_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_runs_rerun_request_key_unique
  ON campaign_runs (rerun_request_key)
  WHERE rerun_request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaign_runs_rerun_source_idx
  ON campaign_runs (rerun_of_run_id);
