CREATE TABLE project_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position integer NOT NULL,
  description text,
  start_date date,
  end_date date,
  budget_amount numeric(14,2),
  actual_amount numeric(14,2),
  status text,
  assigned_to text,
  assigned_phone text,
  assigned_email text,
  category text,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(project_id,position)
);

CREATE TABLE project_punch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position integer NOT NULL,
  item_text text,
  done boolean NOT NULL DEFAULT false,
  category text,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(project_id,position)
);

CREATE TABLE project_notes_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position integer NOT NULL,
  note_date date,
  note_text text,
  priority text,
  author text,
  resolved boolean NOT NULL DEFAULT false,
  occurred_at timestamptz,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(project_id,position)
);

CREATE TABLE project_payment_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position integer NOT NULL,
  label text,
  amount numeric(14,2),
  percent numeric(8,3),
  due_date date,
  status text,
  paid boolean NOT NULL DEFAULT false,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(project_id,position)
);

CREATE TABLE estimate_payment_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  position integer NOT NULL,
  label text,
  amount numeric(14,2),
  percent numeric(8,3),
  due_date date,
  status text,
  paid boolean NOT NULL DEFAULT false,
  legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(estimate_id,position)
);

CREATE INDEX idx_scope_items_project ON project_scope_items(project_id);
CREATE INDEX idx_punch_items_project ON project_punch_items(project_id);
CREATE INDEX idx_notes_log_project ON project_notes_log(project_id);
CREATE INDEX idx_project_milestones_project ON project_payment_milestones(project_id);
CREATE INDEX idx_estimate_milestones_estimate ON estimate_payment_milestones(estimate_id);
