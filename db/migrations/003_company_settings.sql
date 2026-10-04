-- Additive company settings storage used by the PostgreSQL support API.
CREATE TABLE IF NOT EXISTS company_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  settings_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
