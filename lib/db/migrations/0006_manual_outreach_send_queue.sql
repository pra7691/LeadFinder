BEGIN;

ALTER TABLE outreach_queue
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_position integer,
  ADD COLUMN IF NOT EXISTS sending_started_at timestamptz;

CREATE INDEX IF NOT EXISTS outreach_queue_send_queue_idx
  ON outreach_queue (queue_position ASC NULLS LAST, queued_at ASC NULLS LAST, id ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS outreach_queue_sending_idx
  ON outreach_queue (sending_started_at ASC NULLS LAST, id ASC)
  WHERE status = 'sending';

CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_single_sending_idx
  ON outreach_queue ((1))
  WHERE status = 'sending';

CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_unique_queue_position_idx
  ON outreach_queue (queue_position)
  WHERE queue_position IS NOT NULL;

COMMIT;
