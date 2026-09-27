import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migration = (name) => readFileSync(`worker/migrations/${name}`, "utf8");
test("all migrations apply in order and social migrations preserve existing data", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const file of readdirSync("worker/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(migration(file));
  assert.equal(db.prepare("SELECT count(*) n FROM social_accounts").get().n, 4);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM social_accounts WHERE enabled=1 AND platform='instagram'",
      )
      .get().n,
    1,
  );
  db.exec(
    "INSERT INTO social_content(id,source_file_id,caption,workflow_state,created_at,updated_at) VALUES ('original','drive-file','Approved caption','review','before','before')",
  );
  const before = db.prepare("SELECT * FROM social_content").all();
  db.exec(migration("0004_social_content_foundation.sql"));
  db.exec(migration("0005_social_drive_inbox_unique.sql"));
  assert.deepEqual(db.prepare("SELECT * FROM social_content").all(), before);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
test("0005 refuses pre-existing Drive duplicates without deleting or rewriting them", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
  db.exec(migration("0004_social_content_foundation.sql"));
  db.exec(
    "INSERT INTO social_content(id,source_file_id,created_at,updated_at) VALUES ('one','duplicate','before','before'),('two','duplicate','before','before')",
  );
  const before = db.prepare("SELECT * FROM social_content ORDER BY id").all();
  assert.throws(
    () => db.exec(migration("0005_social_drive_inbox_unique.sql")),
    /UNIQUE/,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM social_content ORDER BY id").all(),
    before,
  );
});
