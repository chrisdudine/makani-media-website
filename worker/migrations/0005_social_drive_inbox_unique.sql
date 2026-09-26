-- Fail safely if duplicates already exist; never delete or rewrite content.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_content_drive_file_unique
  ON social_content(source_provider, source_file_id)
  WHERE source_provider = 'google-drive' AND source_file_id <> '';
