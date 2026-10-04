-- Preserve complete legacy identity and invitation records without changing Firebase Auth.
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_payload jsonb;
CREATE TABLE IF NOT EXISTS team_invites (
  company_id uuid NOT NULL REFERENCES companies(id),
  legacy_id text NOT NULL,
  legacy_payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,legacy_id)
);
