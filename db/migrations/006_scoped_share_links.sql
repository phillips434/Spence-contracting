CREATE TABLE IF NOT EXISTS public_share_links (
  token text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  mode text NOT NULL CHECK(mode IN ('portal','est','sub','invoice')),
  legacy_id text NOT NULL,
  scope_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
