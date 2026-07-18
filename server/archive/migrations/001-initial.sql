CREATE TABLE source_races (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  source_race_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  race_name TEXT NOT NULL,
  mode_name TEXT NOT NULL,
  event_date TEXT,
  location TEXT,
  organizer TEXT,
  current_snapshot_id INTEGER REFERENCES race_snapshots(id),
  UNIQUE (provider, source_race_id)
);

CREATE TABLE race_snapshots (
  id INTEGER PRIMARY KEY,
  source_race_id INTEGER NOT NULL REFERENCES source_races(id),
  captured_at TEXT NOT NULL,
  artifact_mime_type TEXT NOT NULL,
  artifact_blob BLOB NOT NULL,
  normalized_json TEXT NOT NULL,
  UNIQUE (source_race_id, captured_at)
);

CREATE TABLE race_entries (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES race_snapshots(id),
  source_entry_id TEXT,
  normalized_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  displayed_number TEXT,
  brand TEXT,
  class_name TEXT,
  overall_position INTEGER,
  class_position INTEGER,
  field_size INTEGER NOT NULL,
  class_size INTEGER NOT NULL,
  total_time_seconds REAL,
  entry_json TEXT NOT NULL
);

CREATE TABLE race_sections (
  id INTEGER PRIMARY KEY,
  race_entry_id INTEGER NOT NULL REFERENCES race_entries(id),
  section_index INTEGER NOT NULL,
  section_name TEXT,
  total_cumulated_time TEXT,
  overall_position INTEGER,
  class_position INTEGER,
  section_overall_position INTEGER,
  section_class_position INTEGER,
  avg_speed REAL,
  overall_behind_by TEXT,
  section_json TEXT NOT NULL,
  UNIQUE (race_entry_id, section_index)
);

CREATE INDEX source_races_catalog_idx ON source_races(event_date DESC, race_name);
CREATE INDEX race_snapshots_source_idx ON race_snapshots(source_race_id, captured_at);
CREATE INDEX race_entries_history_idx ON race_entries(normalized_name, snapshot_id);
CREATE INDEX race_sections_entry_idx ON race_sections(race_entry_id, section_index);
