-- Verified signup alerts survive mail outages and server restarts.
CREATE TABLE IF NOT EXISTS signup_alerts (
  uid text PRIMARY KEY REFERENCES auth_accounts(uid) ON DELETE CASCADE,
  recipient text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS signup_alerts_pending ON signup_alerts(next_attempt_at) WHERE sent_at IS NULL;
