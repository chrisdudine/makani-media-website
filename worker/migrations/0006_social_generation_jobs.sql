-- Additive job ledger: no existing content or booking tables are rewritten.
CREATE TABLE IF NOT EXISTS social_generation_jobs (
  content_id TEXT PRIMARY KEY REFERENCES social_content(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token TEXT NOT NULL DEFAULT '',
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_generation_ready
  ON social_generation_jobs(status, next_attempt_at, lease_expires_at);
