ALTER TABLE contacts ADD COLUMN free_consultation_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN stripe_customer_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  project_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Pacific/Honolulu',
  meeting_type TEXT NOT NULL,
  meeting_location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  price_cents INTEGER NOT NULL DEFAULT 0,
  payment_required INTEGER NOT NULL DEFAULT 0,
  stripe_checkout_session_id TEXT NOT NULL DEFAULT '',
  stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
  google_calendar_event_id TEXT NOT NULL DEFAULT '',
  google_meet_url TEXT NOT NULL DEFAULT '',
  hold_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_consultations_contact_id ON consultations(contact_id);
CREATE INDEX IF NOT EXISTS idx_consultations_start_time ON consultations(start_time);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consultations_stripe_session
  ON consultations(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_consultations_google_event
  ON consultations(google_calendar_event_id)
  WHERE google_calendar_event_id <> '';
