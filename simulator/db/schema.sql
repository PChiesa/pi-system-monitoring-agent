-- PI Simulator persistence schema

CREATE TABLE IF NOT EXISTS tags (
  id            SERIAL PRIMARY KEY,
  tag_name      TEXT UNIQUE NOT NULL,
  unit          TEXT NOT NULL DEFAULT '',
  custom_group  TEXT,
  value_type    TEXT NOT NULL DEFAULT 'number' CHECK (value_type IN ('number', 'boolean', 'string')),
  nominal       DOUBLE PRECISION NOT NULL DEFAULT 0,
  sigma         DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_value     DOUBLE PRECISION,
  max_value     DOUBLE PRECISION,
  discrete      BOOLEAN NOT NULL DEFAULT FALSE,
  boolean_default BOOLEAN,
  string_default  TEXT,
  string_options  TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS af_databases (
  id          SERIAL PRIMARY KEY,
  uuid        UUID DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS af_elements (
  id          SERIAL PRIMARY KEY,
  uuid        UUID DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  database_id INTEGER NOT NULL REFERENCES af_databases(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES af_elements(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (database_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS af_attributes (
  id            SERIAL PRIMARY KEY,
  uuid          UUID DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'Double',
  default_uom   TEXT NOT NULL DEFAULT '',
  pi_point_name TEXT,
  element_id    INTEGER NOT NULL REFERENCES af_elements(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (element_id, name)
);

CREATE TABLE IF NOT EXISTS custom_scenarios (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL,
  modifiers   JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tags_tag_name ON tags(tag_name);
CREATE INDEX IF NOT EXISTS idx_af_elements_database_id ON af_elements(database_id);
CREATE INDEX IF NOT EXISTS idx_af_elements_parent_id ON af_elements(parent_id);
CREATE INDEX IF NOT EXISTS idx_af_attributes_element_id ON af_attributes(element_id);
