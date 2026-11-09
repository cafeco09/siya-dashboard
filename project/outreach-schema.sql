-- Application records stay in PostgreSQL, outside Render's temporary filesystem.
CREATE TABLE IF NOT EXISTS outreach_records (
  id text PRIMARY KEY,
  kind text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_records_kind_updated ON outreach_records(kind,updated_at DESC);
