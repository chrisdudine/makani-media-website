import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { processSocialDrafts } from "../worker/src/social-ai-drafts.js";
import {
  DraftError,
  downloadMedia,
  generateDraft,
  validateDraft,
  readLimited,
  MAX_MEDIA_BYTES,
  verifySocialAiAccess,
} from "../worker/src/social-ai-media.js";
import { SOCIAL_DRIVE_FOLDER_ID } from "../worker/src/social-drive-inbox.js";

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const file of readdirSync("worker/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`worker/migrations/${file}`, "utf8"));
  const DB = {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null;
        },
        async run() {
          return { success: true, meta: sqlite.prepare(sql).run(...values) };
        },
        execute() {
          const stmt = sqlite.prepare(sql);
          const results = stmt.columns().length
            ? stmt.all(...values)
            : (stmt.run(...values), []);
          return {
            success: true,
            results,
            meta: { changes: sqlite.prepare("SELECT changes() n").get().n },
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return DB;
}
function seed(DB, id = "one") {
  DB.sqlite
    .prepare(
      "INSERT INTO social_content(id,source_file_id,source_file_name,media_type,created_at,updated_at) VALUES (?,?,?,'image','before','before')",
    )
    .run(id, id, `${id}.png`);
}
const envFor = (DB) => ({
  DB,
  SOCIAL_AI_ENABLED: "true",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "refresh",
  GEMINI_API_KEY: "gemini-test",
});
const draft = () => ({
  summary: "A blue test image",
  subjects: ["blue"],
  review_notes: ["Test media: do not publish"],
  caption: "Internal draft",
  platforms: {
    instagram: "Instagram draft",
    linkedin: "LinkedIn draft",
    google_business_profile: "Business draft",
  },
});
const media = () => ({
  file: { mimeType: "image/png", version: "1", modifiedTime: "before" },
  bytes: new Uint8Array([1, 2, 3]),
  assertUnchanged: async () => {},
});
const deps = (overrides = {}) => ({
  now: () => "2026-09-27T08:00:00.000Z",
  download: async () => media(),
  generate: async () => ({ model: "test-model", draft: draft() }),
  ...overrides,
});
const content = (DB) =>
  DB.sqlite.prepare("SELECT * FROM social_content WHERE id='one'").get();
const job = (DB) =>
  DB.sqlite
    .prepare("SELECT * FROM social_generation_jobs WHERE content_id='one'")
    .get();

test("one item per run reaches review with three draft-only targets and repeat runs do nothing", async (t) => {
  const DB = database(t);
  seed(DB);
  seed(DB, "two");
  const result = await processSocialDrafts(envFor(DB), deps());
  assert.equal(result.status, "review");
  assert.equal(content(DB).workflow_state, "review");
  assert.equal(job(DB).status, "succeeded");
  const metadata = JSON.parse(content(DB).ai_metadata_json);
  assert.equal(metadata.requires_human_approval, true);
  assert.equal(metadata.model, "test-model");
  assert.equal(
    DB.sqlite
      .prepare("SELECT workflow_state FROM social_content WHERE id='two'")
      .get().workflow_state,
    "inbox",
  );
  const before = content(DB);
  const targets = DB.sqlite
    .prepare("SELECT * FROM social_content_targets")
    .all();
  assert.equal(targets.length, 3);
  assert.ok(
    targets.every(
      (row) =>
        row.publish_status === "draft" &&
        row.platform_post_id === "" &&
        row.published_at === null,
    ),
  );
  assert.equal(
    DB.sqlite
      .prepare("SELECT enabled FROM social_accounts WHERE platform='linkedin'")
      .get().enabled,
    0,
  );
  await processSocialDrafts(envFor(DB), deps());
  assert.deepEqual(content(DB), before);
  assert.equal((await processSocialDrafts(envFor(DB), deps())).status, "idle");
});

test("overlapping runs make a single model call for the same item", async (t) => {
  const DB = database(t);
  seed(DB);
  let calls = 0;
  const dependency = deps({
    generate: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { model: "test", draft: draft() };
    },
  });
  const results = await Promise.all([
    processSocialDrafts(envFor(DB), dependency),
    processSocialDrafts(envFor(DB), dependency),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map((r) => r.status).sort(), ["idle", "review"]);
});

test("existing captions, metadata, and target drafts are never enrolled", async (t) => {
  const DB = database(t);
  seed(DB);
  seed(DB, "two");
  seed(DB, "three");
  DB.sqlite.exec(
    "UPDATE social_content SET caption='Human' WHERE id='one'; UPDATE social_content SET ai_metadata_json='{\"human\":true}' WHERE id='two'; INSERT INTO social_content_targets(id,content_id,account_id,platform,platform_caption,created_at,updated_at) VALUES ('manual','three','makani-instagram','instagram','Human caption','before','before')",
  );
  assert.equal((await processSocialDrafts(envFor(DB), deps())).status, "idle");
  assert.equal(
    DB.sqlite.prepare("SELECT count(*) n FROM social_generation_jobs").get().n,
    0,
  );
});

for (const edit of [
  "caption='Human edit'",
  "workflow_state='published'",
  "ai_metadata_json='{\"human\":true}'",
  "source_file_id='changed',updated_at='later'",
]) {
  test(`human edit during generation wins: ${edit}`, async (t) => {
    const DB = database(t);
    seed(DB);
    const result = await processSocialDrafts(
      envFor(DB),
      deps({
        generate: async () => {
          DB.sqlite.exec(`UPDATE social_content SET ${edit} WHERE id='one'`);
          return { model: "test", draft: draft() };
        },
      }),
    );
    assert.equal(result.status, "superseded");
    assert.equal(job(DB).status, "cancelled");
    assert.equal(
      DB.sqlite.prepare("SELECT count(*) n FROM social_content_targets").get()
        .n,
      0,
    );
  });
}

test("transient errors back off, exhaust at three attempts, and leave reviewable failure", async (t) => {
  const DB = database(t);
  seed(DB);
  const generate = async () => {
    throw new DraftError("GEMINI_HTTP_429", true);
  };
  assert.equal(
    (await processSocialDrafts(envFor(DB), deps({ generate }))).status,
    "retry",
  );
  assert.equal(content(DB).workflow_state, "inbox");
  assert.equal(job(DB).next_attempt_at, "2026-09-27T08:05:00.000Z");
  assert.equal(
    (await processSocialDrafts(envFor(DB), deps({ generate }))).status,
    "idle",
  );
  await processSocialDrafts(
    envFor(DB),
    deps({ generate, now: () => "2026-09-27T08:05:00.000Z" }),
  );
  assert.equal(job(DB).next_attempt_at, "2026-09-27T08:20:00.000Z");
  assert.equal(
    (
      await processSocialDrafts(
        envFor(DB),
        deps({ generate, now: () => "2026-09-27T08:20:00.000Z" }),
      )
    ).status,
    "failed",
  );
  assert.equal(job(DB).attempts, 3);
  assert.equal(content(DB).workflow_state, "review");
  assert.equal(content(DB).caption, "");
});

test("permanent download failure avoids model calls and secret-bearing error details", async (t) => {
  const DB = database(t);
  seed(DB);
  const result = await processSocialDrafts(
    envFor(DB),
    deps({
      download: async () => {
        throw new DraftError("DRIVE_HTTP_403");
      },
      generate: async () => assert.fail("must not run"),
    }),
  );
  assert.equal(result.status, "failed");
  assert.equal(job(DB).error_code, "DRIVE_HTTP_403");
  assert.equal(job(DB).attempts, 1);
});

test("expired claims recover and stale owner cannot overwrite the new draft", async (t) => {
  const DB = database(t);
  seed(DB);
  const first = await processSocialDrafts(
    envFor(DB),
    deps({
      generate: async () => {
        const second = await processSocialDrafts(
          envFor(DB),
          deps({
            now: () => "2026-09-27T08:11:00.000Z",
            generate: async () => ({
              model: "winner",
              draft: { ...draft(), caption: "New owner" },
            }),
          }),
        );
        assert.equal(second.status, "review");
        return { model: "stale", draft: draft() };
      },
    }),
  );
  assert.equal(first.status, "superseded");
  assert.equal(content(DB).caption, "New owner");
  assert.equal(job(DB).model, "winner");
});

test("crashed final attempt is moved out of processing without a fourth call", async (t) => {
  const DB = database(t);
  seed(DB);
  DB.sqlite.exec(
    "UPDATE social_content SET workflow_state='processing'; INSERT INTO social_generation_jobs(content_id,status,attempts,lease_token,lease_expires_at,next_attempt_at,created_at,updated_at) VALUES ('one','processing',3,'old','2026-09-27T07:00:00Z','before','before','before')",
  );
  assert.equal((await processSocialDrafts(envFor(DB), deps())).status, "idle");
  assert.equal(content(DB).workflow_state, "review");
  assert.equal(job(DB).error_code, "LEASE_EXHAUSTED");
});

test("target insert failure rolls back caption/state so retry is safe", async (t) => {
  const DB = database(t);
  seed(DB);
  DB.sqlite.exec(
    "CREATE TRIGGER reject_target BEFORE INSERT ON social_content_targets BEGIN SELECT RAISE(ABORT,'test constraint'); END",
  );
  assert.equal((await processSocialDrafts(envFor(DB), deps())).status, "retry");
  assert.equal(content(DB).caption, "");
  assert.equal(content(DB).ai_metadata_json, "{}");
});

test("a file changed during generation is retried without saving stale captions", async (t) => {
  const DB = database(t);
  seed(DB);
  const result = await processSocialDrafts(
    envFor(DB),
    deps({
      download: async () => ({
        ...media(),
        assertUnchanged: async () => {
          throw new DraftError("MEDIA_CHANGED", true);
        },
      }),
    }),
  );
  assert.equal(result.status, "retry");
  assert.equal(content(DB).caption, "");
  assert.equal(job(DB).error_code, "MEDIA_CHANGED");
});

test("exhausted crashed jobs preserve human-edited content", async (t) => {
  const DB = database(t);
  seed(DB);
  DB.sqlite.exec(
    "UPDATE social_content SET workflow_state='processing',caption='Human work',updated_at='human'; INSERT INTO social_generation_jobs(content_id,status,attempts,lease_token,lease_expires_at,next_attempt_at,created_at,updated_at) VALUES ('one','processing',3,'old','2026-09-27T07:00:00Z','before','before','before')",
  );
  const before = content(DB);
  await processSocialDrafts(envFor(DB), deps());
  assert.deepEqual(content(DB), before);
});

test("disabled or unconfigured processor leaves jobs and content untouched", async (t) => {
  const DB = database(t);
  seed(DB);
  assert.equal((await processSocialDrafts({ DB })).status, "disabled");
  await assert.rejects(
    processSocialDrafts({ DB, SOCIAL_AI_ENABLED: "true" }),
    /MISSING_AI_CREDENTIALS/,
  );
  assert.equal(
    DB.sqlite.prepare("SELECT count(*) n FROM social_generation_jobs").get().n,
    0,
  );
});

function mockApis(
  t,
  {
    file = {},
    mediaStatus = 200,
    modelStatus = 200,
    modelResult,
    mediaBytes = new Uint8Array([1, 2, 3]),
  } = {},
) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "private-token" });
    if (url.hostname === "www.googleapis.com") {
      assert.equal(init.headers.Authorization, "Bearer private-token");
      if (url.searchParams.get("alt") === "media")
        return new Response(mediaBytes, { status: mediaStatus });
      return Response.json({
        id: "one",
        size: "3",
        mimeType: "image/png",
        parents: [SOCIAL_DRIVE_FOLDER_ID],
        version: "1",
        modifiedTime: "before",
        ...file,
      });
    }
    assert.equal(url.hostname, "generativelanguage.googleapis.com");
    assert.equal(init.headers["x-goog-api-key"], "gemini-test");
    assert.equal(url.searchParams.has("key"), false);
    if (!init.method)
      return Response.json(
        { supportedGenerationMethods: ["generateContent"] },
        { status: modelStatus },
      );
    const body = JSON.parse(init.body);
    assert.equal(body.tools, undefined);
    assert.equal(body.contents[0].parts[1].inlineData.data, "AQID");
    return Response.json(
      modelResult || {
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(draft()) }] },
          },
        ],
      },
      { status: modelStatus },
    );
  });
  return calls;
}

test("credential preflight downloads real bytes and checks model access without drafts or writes", async (t) => {
  const DB = database(t);
  seed(DB);
  mockApis(t);
  const result = await verifySocialAiAccess(envFor(DB));
  assert.equal(result.status, "verified");
  assert.equal(result.bytes, 3);
  assert.equal(content(DB).workflow_state, "inbox");
  assert.equal(
    DB.sqlite.prepare("SELECT count(*) n FROM social_generation_jobs").get().n,
    0,
  );
});

test("image and structured model response go through production adapter", async (t) => {
  const DB = database(t);
  seed(DB);
  mockApis(t);
  assert.equal((await processSocialDrafts(envFor(DB))).status, "review");
});

test("short supported videos use inline video input", async (t) => {
  const DB = database(t);
  seed(DB);
  const calls = mockApis(t, {
    file: {
      mimeType: "video/mp4",
      videoMediaMetadata: { durationMillis: "30000" },
    },
  });
  assert.equal((await processSocialDrafts(envFor(DB))).status, "review");
  const call = calls.find((c) => c.url.pathname.endsWith(":generateContent"));
  assert.equal(
    JSON.parse(call.init.body).contents[0].parts[1].inlineData.mimeType,
    "video/mp4",
  );
});

for (const [file, code] of [
  [{ size: String(MAX_MEDIA_BYTES + 1) }, "MEDIA_TOO_LARGE"],
  [{ mimeType: "image/svg+xml" }, "UNSUPPORTED_MEDIA"],
  [{ parents: ["outside"] }, "FILE_OUTSIDE_INBOX"],
  [{ trashed: true }, "FILE_OUTSIDE_INBOX"],
  [
    { mimeType: "video/mp4", videoMediaMetadata: { durationMillis: "61000" } },
    "VIDEO_DURATION_UNSUPPORTED",
  ],
])
  test(`media validation rejects ${code}`, async (t) => {
    const DB = database(t);
    const calls = mockApis(t, { file });
    await assert.rejects(downloadMedia(envFor(DB), "one"), new RegExp(code));
    assert.equal(calls.length, 2);
  });

test("download permission failure and truncated model output are explicit", async (t) => {
  const DB = database(t);
  mockApis(t, { mediaStatus: 403 });
  await assert.rejects(downloadMedia(envFor(DB), "one"), /DRIVE_HTTP_403/);
  t.mock.restoreAll();
  mockApis(t, {
    modelResult: { candidates: [{ finishReason: "MAX_TOKENS" }] },
  });
  await assert.rejects(generateDraft(envFor(DB), media()), /GEMINI_INCOMPLETE/);
});

test("stream size cap works even without Content-Length and malformed drafts fail validation", async () => {
  await assert.rejects(
    readLimited(new Response(new Uint8Array(12)), 10),
    /RESPONSE_TOO_LARGE/,
  );
  assert.throws(
    () => validateDraft({ ...draft(), platforms: {} }),
    /INVALID_DRAFT/,
  );
  assert.throws(
    () => validateDraft({ ...draft(), caption: "a".repeat(2001) }),
    /INVALID_DRAFT/,
  );
});

test("Gemini permission diagnostics classify known failures without retaining response secrets", async (t) => {
  const DB = database(t);
  const calls = mockApis(t, {
    modelStatus: 403,
    modelResult: {
      error: {
        message:
          "Your API key was reported as leaked. Please use another API key. secret-value",
      },
    },
  });
  await assert.rejects(
    generateDraft(envFor(DB), media()),
    (error) =>
      error.code === "GEMINI_KEY_BLOCKED" &&
      !error.message.includes("secret-value"),
  );
  assert.equal(calls.length, 1);
});

test("unrecognized Gemini denials redact the credential and opaque strings", async (t) => {
  const DB = database(t);
  mockApis(t, {
    modelStatus: 403,
    modelResult: {
      error: {
        message:
          "Request refused gemini-test ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      },
    },
  });
  await assert.rejects(generateDraft(envFor(DB), media()), (error) => {
    assert.equal(error.code, "GEMINI_HTTP_403");
    assert.ok(error.diagnostic.includes("Request refused"));
    assert.ok(!error.diagnostic.includes("gemini-test"));
    assert.ok(!error.diagnostic.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
    return true;
  });
});

test("project-wide Gemini access denial is terminal and explicitly classified", async (t) => {
  const DB = database(t);
  mockApis(t, {
    modelStatus: 403,
    modelResult: {
      error: {
        message: "Your project has been denied access. Please contact support.",
      },
    },
  });
  await assert.rejects(
    generateDraft(envFor(DB), media()),
    (error) =>
      error.code === "GEMINI_PROJECT_ACCESS_DENIED" &&
      error.retryable === false,
  );
});
