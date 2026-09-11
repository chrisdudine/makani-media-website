ALTER TABLE consultations ADD COLUMN buffer_end_time TEXT;

CREATE TABLE IF NOT EXISTS shoot_bookings (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Pacific/Honolulu',
  status TEXT NOT NULL DEFAULT 'confirmed',
  google_calendar_event_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_shoot_bookings_start_time ON shoot_bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_shoot_bookings_status ON shoot_bookings(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shoot_bookings_google_event
  ON shoot_bookings(google_calendar_event_id)
  WHERE google_calendar_event_id <> '';

CREATE TABLE IF NOT EXISTS calendar_blocks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'google-calendar',
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_blocks_start_time ON calendar_blocks(start_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_blocks_external
  ON calendar_blocks(source, external_id)
  WHERE external_id <> '';
