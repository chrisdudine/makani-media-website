import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  ingestDriveInbox,
  SOCIAL_DRIVE_FOLDER_ID,
} from "../worker/src/social-drive-inbox.js";
import worker from "../worker/src/social-inbox-worker.js";
import booking from "../worker/src/booking-wrapper.js";

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("CREATE TABLE projects(id TEXT PRIMARY KEY);");
  sqlite.exec(
    readFileSync(
      "worker/migrations/0004_social_content_foundation.sql",
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      "worker/migrations/0005_social_drive_inbox_unique.sql",
      "utf8",
    ),
  );
  return {
    sqlite,
    prepare(sql) {
      return { bind: (...values) => ({ sql, values }) };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(({ sql, values }) => ({
          success: true,
          meta: sqlite.prepare(sql).run(...values),
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
const media = (id, mimeType = "image/png", extra = {}) => ({
  id,
  name: `${id}.png`,
  mimeType,
  parents: [SOCIAL_DRIVE_FOLDER_ID],
  trashed: false,
  ...extra,
});
const envFor = (DB) => ({
  DB,
  GOOGLE_CLIENT_ID: "existing-client",
  GOOGLE_CLIENT_SECRET: "existing-secret",
  GOOGLE_REFRESH_TOKEN: "existing-refresh",
});
function mockGoogle(
  t,
  pages,
  { failPage = -1, folderStatus = 200, tokenStatus = 200 } = {},
) {
  const calls = [];
  let page = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    if (url.hostname === "oauth2.googleapis.com") {
      assert.equal(init.body.get("refresh_token"), "existing-refresh");
      assert.equal(init.body.get("client_id"), "existing-client");
      assert.equal(init.body.get("scope"), null);
      return Response.json(
        { access_token: "test-token" },
        { status: tokenStatus },
      );
    }
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.method, undefined); // Drive requests are read-only.
    if (url.pathname.endsWith(SOCIAL_DRIVE_FOLDER_ID))
      return Response.json(
        {
          id: SOCIAL_DRIVE_FOLDER_ID,
          mimeType: "application/vnd.google-apps.folder",
          trashed: false,
        },
        { status: folderStatus },
      );
    assert.match(url.searchParams.get("q"), /trashed = false/);
    assert.ok(
      url.searchParams
        .get("q")
        .includes(`'${SOCIAL_DRIVE_FOLDER_ID}' in parents`),
    );
    const index = page++;
    if (index === failPage) return Response.json({}, { status: 503 });
    return Response.json(pages[index % pages.length]);
  });
  return calls;
}

test("paginates, filters media, and inserts each Drive ID once without changing existing content", async (t) => {
  const DB = database(t);
  const calls = mockGoogle(t, [
    { files: [], nextPageToken: "page-2" },
    {
      files: [
        media("image-1"),
        media("video-1", "video/mp4"),
        media("image-1"),
        media("pdf", "application/pdf"),
        media("trash", "image/png", { trashed: true }),
        media("outside", "image/png", { parents: ["other"] }),
      ],
    },
  ]);
  const first = await ingestDriveInbox(envFor(DB));
  assert.deepEqual(first, {
    scanned: 6,
    inserted: 2,
    existing: 1,
    skipped: 3,
    pages: 2,
  });
  assert.equal(calls[3].searchParams.get("pageToken"), "page-2");
  const rows = DB.sqlite
    .prepare("SELECT * FROM social_content ORDER BY source_file_id")
    .all();
  assert.equal(rows[0].media_type, "image");
  assert.equal(rows[1].media_type, "video");
  for (const row of rows) {
    assert.equal(row.source_provider, "google-drive");
    assert.equal(row.workflow_state, "inbox");
    assert.ok(row.created_at);
  }
  DB.sqlite.exec(
    "UPDATE social_content SET workflow_state='review',caption='Keep this caption',source_file_name='Keep original name'",
  );
  const before = DB.sqlite
    .prepare("SELECT * FROM social_content ORDER BY id")
    .all();
  const second = await ingestDriveInbox(envFor(DB));
  assert.equal(second.inserted, 0);
  assert.equal(second.existing, 3);
  assert.deepEqual(
    DB.sqlite.prepare("SELECT * FROM social_content ORDER BY id").all(),
    before,
  );
});

test("overlapping scans cannot duplicate rows and handle multiple batches", async (t) => {
  const DB = database(t);
  mockGoogle(t, [
    { files: Array.from({ length: 125 }, (_, i) => media(`image-${i}`)) },
  ]);
  const results = await Promise.all([
    ingestDriveInbox(envFor(DB)),
    ingestDriveInbox(envFor(DB)),
  ]);
  assert.equal(
    results.reduce((n, result) => n + result.inserted, 0),
    125,
  );
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS n FROM social_content").get().n,
    125,
  );
  assert.throws(
    () =>
      DB.sqlite.exec(
        "INSERT INTO social_content(id,source_file_id,created_at,updated_at) VALUES('different-id','image-1','now','now')",
      ),
    /UNIQUE/,
  );
});

test("a failed later page can retry without duplicating successful earlier inserts", async (t) => {
  const DB = database(t);
  mockGoogle(
    t,
    [
      { files: [media("one")], nextPageToken: "next" },
      { files: [media("two")] },
    ],
    { failPage: 1 },
  );
  await assert.rejects(ingestDriveInbox(envFor(DB)), /503/);
  const result = await ingestDriveInbox(envFor(DB));
  assert.equal(result.inserted, 1);
  assert.equal(result.existing, 1);
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS n FROM social_content").get().n,
    2,
  );
});

for (const options of [{ tokenStatus: 400 }, { folderStatus: 404 }]) {
  test(`OAuth or folder access failure makes no inserts: ${JSON.stringify(options)}`, async (t) => {
    const DB = database(t);
    mockGoogle(t, [{ files: [media("one")] }], options);
    await assert.rejects(ingestDriveInbox(envFor(DB)));
    assert.equal(
      DB.sqlite.prepare("SELECT COUNT(*) AS n FROM social_content").get().n,
      0,
    );
  });
}

test("incomplete results fail visibly and scheduled execution reports failure", async (t) => {
  const DB = database(t);
  mockGoogle(t, [{ incompleteSearch: true, files: [media("one")] }]);
  const logged = t.mock.method(console, "error", () => {});
  await assert.rejects(worker.scheduled({}, envFor(DB)), /incomplete/);
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS n FROM social_content").get().n,
    0,
  );
});

test("scheduled execution completes ingestion and logs counts", async (t) => {
  const DB = database(t);
  mockGoogle(t, [{ files: [media("one")] }]);
  const log = t.mock.method(console, "log", () => {});
  await worker.scheduled({}, envFor(DB));
  assert.equal(JSON.parse(log.mock.calls[0].arguments[0]).inserted, 1);
});

test("all HTTP requests use the exact existing booking and Calendar handler", () => {
  assert.equal(worker.fetch, booking.fetch);
});
