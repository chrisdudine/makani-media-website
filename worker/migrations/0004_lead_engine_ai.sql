CREATE TABLE IF NOT EXISTS lead_engine_ai_runs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'staging',
  test_only INTEGER NOT NULL DEFAULT 1,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_engine_ai_runs_entity
  ON lead_engine_ai_runs(entity_id);
CREATE INDEX IF NOT EXISTS idx_lead_engine_ai_runs_task
  ON lead_engine_ai_runs(task);
CREATE INDEX IF NOT EXISTS idx_lead_engine_ai_runs_created
  ON lead_engine_ai_runs(created_at);

