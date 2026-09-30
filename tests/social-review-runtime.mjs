import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wr("miniflare");
const { build } = wr("esbuild");
const bundle = await build({
  entryPoints: ["worker/src/social-inbox-worker.js"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
let outbound = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-07",
    d1Databases: { DB: "review-test" },
    bindings: {
      ADMIN_API_KEY: "local-test-only",
      SOCIAL_AI_ENABLED: "false",
      SOCIAL_AI_VERIFY: "false",
    },
    outboundService: () => {
      outbound++;
      throw Error("No external actions allowed");
    },
  }),
);
try {
  const DB = await mf.getD1Database("DB");
  for (const f of readdirSync("worker/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await DB.batch(
      readFileSync("worker/migrations/" + f, "utf8")
        .replace(/--[^\n]*/g, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => DB.prepare(s)),
    );
  await DB.prepare(
    "INSERT INTO social_content(id,source_file_id,source_file_name,workflow_state,caption,ai_metadata_json,created_at,updated_at) VALUES('one','file-id','Original name','review','Caption','{}','before','before')",
  ).run();
  for (const [id, platform] of [
    ["makani-instagram", "instagram"],
    ["makani-linkedin", "linkedin"],
    ["makani-google-business", "google-business-profile"],
  ])
    await DB.prepare(
      "INSERT INTO social_content_targets(id,content_id,account_id,platform,platform_caption,created_at,updated_at) VALUES(?,'one',?,?,'Initial caption','before','before')",
    )
      .bind(id, id, platform)
      .run();
  const request = (path, options = {}) =>
    mf.dispatchFetch("https://local/api/social-review" + path, options);
  const auth = { "X-Admin-Key": "local-test-only" };
  assert.equal((await request("/items")).status, 401);
  assert.equal(
    (await request("/items", { headers: { "X-Admin-Key": "wrong" } })).status,
    401,
  );
  assert.equal(
    (
      await request("/items", {
        headers: { ...auth, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal((await request("")).status, 200);
  let list = await (await request("/items", { headers: auth })).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].targets.length, 3);
  assert.equal(list.publishing_enabled, false);
  for (const metadata of ["null", "[]", '"text"', "{broken"]) {
    await DB.prepare(
      "UPDATE social_content SET ai_metadata_json=? WHERE id='one'",
    )
      .bind(metadata)
      .run();
    const response = await request("/items", { headers: auth });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].summary, "");
  }
  const patch = (body) =>
    request("/target", {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const initial = {
    id: "makani-instagram",
    updated_at: "before",
    caption: "Reviewed caption",
    action: "approve",
  };
  const races = await Promise.all([
    patch(initial),
    patch({ ...initial, caption: "Other editor" }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  let row = await DB.prepare(
    "SELECT * FROM social_content_targets WHERE id='makani-instagram'",
  ).first();
  assert.equal(row.publish_status, "approved");
  assert.equal(
    (await patch({ ...initial, updated_at: row.updated_at, action: "publish" }))
      .status,
    400,
  );
  assert.equal(
    (
      await patch({
        ...initial,
        updated_at: row.updated_at,
        scheduled_at: "tomorrow",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await patch({
        ...initial,
        updated_at: row.updated_at,
        caption: "x".repeat(2001),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await patch({
        ...initial,
        updated_at: row.updated_at,
        action: "save",
        caption: "Edited copy",
      })
    ).status,
    200,
  );
  row = await DB.prepare(
    "SELECT * FROM social_content_targets WHERE id='makani-instagram'",
  ).first();
  assert.equal(row.publish_status, "draft");
  assert.equal(row.platform_caption, "Edited copy");
  assert.equal(
    (await patch({ ...initial, updated_at: row.updated_at, action: "revoke" }))
      .status,
    200,
  );
  await DB.prepare(
    "UPDATE social_content SET scheduled_at='later' WHERE id='one'",
  ).run();
  row = await DB.prepare(
    "SELECT * FROM social_content_targets WHERE id='makani-instagram'",
  ).first();
  assert.equal(
    (await patch({ ...initial, updated_at: row.updated_at })).status,
    409,
  );
  await DB.prepare(
    "UPDATE social_content SET scheduled_at=NULL WHERE id='one'",
  ).run();
  await DB.prepare(
    "UPDATE social_content_targets SET publish_status='published' WHERE id='makani-linkedin'",
  ).run();
  assert.equal(
    (await patch({ ...initial, updated_at: row.updated_at })).status,
    409,
  );
  assert.equal(outbound, 0);
  assert.equal(
    (await mf.dispatchFetch("https://local/api/diagnostics/booking-config"))
      .status,
    200,
  );
  console.log(
    "PASS review runtime: authentication, origin, listing, concurrent edits, approval, edit invalidation, revoke, limits, protected states, no external actions, booking route",
  );
} finally {
  await mf.dispose();
}
