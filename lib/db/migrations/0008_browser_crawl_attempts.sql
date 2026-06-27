CREATE TABLE IF NOT EXISTS lead_crawl_attempts (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_run_id integer REFERENCES campaign_runs(id) ON DELETE CASCADE,
  http_status text NOT NULL DEFAULT 'pending',
  http_failure_category text,
  http_error text,
  http_started_at timestamptz,
  http_completed_at timestamptz,
  browser_status text NOT NULL DEFAULT 'not_needed',
  browser_error text,
  browser_queued_at timestamptz,
  browser_started_at timestamptz,
  browser_completed_at timestamptz,
  final_status text,
  final_crawler text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_crawl_attempts_lead_unique UNIQUE (lead_id)
);

CREATE INDEX IF NOT EXISTS lead_crawl_attempts_browser_queue_idx
  ON lead_crawl_attempts (browser_status, browser_queued_at, id);

CREATE INDEX IF NOT EXISTS lead_crawl_attempts_run_idx
  ON lead_crawl_attempts (campaign_run_id, browser_status);

CREATE UNIQUE INDEX IF NOT EXISTS lead_crawl_attempts_one_browser_running_idx
  ON lead_crawl_attempts (browser_status)
  WHERE browser_status = 'running';
