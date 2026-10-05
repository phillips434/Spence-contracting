CREATE TABLE IF NOT EXISTS legacy_public_share_roots (
  company_id uuid NOT NULL REFERENCES companies(id),
  kind text NOT NULL CHECK (kind IN ('projects','estimates')),
  legacy_id text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,kind,legacy_id)
);
-- Populated once from the verified public source manifest. New records need scoped tokens.
