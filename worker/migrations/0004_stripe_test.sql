CREATE TABLE IF NOT EXISTS stripe_test_orders (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, amount INTEGER NOT NULL,
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, block_end TEXT NOT NULL, expires_at INTEGER NOT NULL,
 session_id TEXT UNIQUE, state TEXT NOT NULL DEFAULT 'pending', stripe_customer_id TEXT,
 payment_intent_id TEXT, invoice_id TEXT, event_id TEXT, signature_verified INTEGER NOT NULL DEFAULT 0,
 contact_id TEXT, calendar_id TEXT, confirmation_id TEXT, receipt_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stripe_test_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, order_id TEXT, received_at TEXT NOT NULL
);
