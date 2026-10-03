-- Contractor Desk PostgreSQL foundation
-- Phase 1: additive only. Firestore remains production source of truth.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_owner_uid text UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text UNIQUE NOT NULL,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_memberships (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','office','field')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,user_id)
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  legacy_id text,
  name text NOT NULL,
  phone text,
  email text,
  billing_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,legacy_id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  legacy_id text,
  job_number text,
  po_number text,
  name text,
  project_type text,
  address text,
  status text,
  project_manager text,
  start_date date,
  end_date date,
  budget numeric(14,2) NOT NULL DEFAULT 0,
  spent numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,legacy_id),
  UNIQUE(company_id,job_number)
);

CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  legacy_id text,
  estimate_number text,
  title text,
  project_class text,
  status text,
  markup numeric(8,3),
  tax_rate numeric(8,3),
  residential_summary text,
  project_scope text,
  converted boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,legacy_id),
  UNIQUE(company_id,estimate_number)
);

CREATE TABLE estimate_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  position integer NOT NULL,
  category text,
  description text NOT NULL,
  quantity numeric(14,4),
  unit text,
  unit_cost numeric(14,4),
  total numeric(14,2),
  markup numeric(8,3),
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(estimate_id,position)
);

CREATE TABLE project_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legacy_key text,
  category text,
  item text,
  vendor text,
  notes text,
  status text,
  budget_amount numeric(14,2),
  actual_amount numeric(14,2),
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legacy_key text,
  title text,
  description text,
  status text,
  amount numeric(14,2),
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legacy_key text,
  log_date date,
  crew text,
  weather text,
  work_performed text,
  issues text,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legacy_key text,
  communication_type text,
  occurred_at timestamptz,
  notes text,
  follow_up text,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legacy_key text,
  source_type text,
  category text,
  description text,
  budget_amount numeric(14,2),
  actual_amount numeric(14,2),
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  daily_log_id uuid REFERENCES daily_logs(id) ON DELETE CASCADE,
  communication_id uuid REFERENCES communications(id) ON DELETE CASCADE,
  storage_provider text,
  storage_key text,
  filename text,
  content_type text,
  size_bytes bigint,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_sequences (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  next_job_number bigint NOT NULL DEFAULT 1 CHECK (next_job_number >= 1),
  next_estimate_number bigint NOT NULL DEFAULT 1 CHECK (next_estimate_number >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_company ON projects(company_id);
CREATE INDEX idx_estimates_company ON estimates(company_id);
CREATE INDEX idx_clients_company ON clients(company_id);
CREATE INDEX idx_change_orders_project ON change_orders(project_id);
CREATE INDEX idx_daily_logs_project ON daily_logs(project_id);
CREATE INDEX idx_communications_project ON communications(project_id);
CREATE INDEX idx_project_costs_project ON project_costs(project_id);
