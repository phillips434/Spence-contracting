-- Contractor Desk notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  legacy_id text,
  target_firebase_uid text,
  text_body text NOT NULL,
  project_name text,
  project_legacy_id text,
  detail text,
  actor_firebase_uid text,
  actor_name text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(company_id,legacy_id)
);
CREATE TABLE IF NOT EXISTS notification_user_state (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  firebase_uid text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,firebase_uid)
);
CREATE INDEX IF NOT EXISTS idx_notifications_company_time ON notifications(company_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_firebase_uid);
