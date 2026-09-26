PRAGMA foreign_keys = ON;

-- Social media automation foundation.
-- Platform-neutral by design; Instagram is the only channel enabled initially.

CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, account_key)
);

CREATE TABLE IF NOT EXISTS social_content (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  source_provider TEXT NOT NULL DEFAULT 'google-drive',
  source_file_id TEXT NOT NULL DEFAULT '',
  source_file_name TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  workflow_state TEXT NOT NULL DEFAULT 'inbox'
    CHECK (workflow_state IN ('inbox', 'processing', 'review', 'published')),
  caption TEXT NOT NULL DEFAULT '',
  ai_metadata_json TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS social_content_targets (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_caption TEXT NOT NULL DEFAULT '',
  publish_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (publish_status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed')),
  platform_post_id TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (content_id) REFERENCES social_content(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES social_accounts(id),
  UNIQUE(content_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_social_content_state ON social_content(workflow_state);
CREATE INDEX IF NOT EXISTS idx_social_content_scheduled_at ON social_content(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_content_source_file ON social_content(source_provider, source_file_id);
CREATE INDEX IF NOT EXISTS idx_social_targets_status ON social_content_targets(publish_status);
CREATE INDEX IF NOT EXISTS idx_social_targets_account ON social_content_targets(account_id);

INSERT OR IGNORE INTO social_accounts
  (id, platform, account_key, display_name, enabled, created_at, updated_at)
VALUES
  ('makani-instagram', 'instagram', 'makani-media', 'Makani Media Instagram', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('makani-facebook', 'facebook', 'makani-media', 'Makani Media Facebook', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('makani-linkedin', 'linkedin', 'makani-media', 'Makani Media LinkedIn', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('makani-google-business', 'google-business-profile', 'makani-media', 'Makani Media Google Business Profile', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
