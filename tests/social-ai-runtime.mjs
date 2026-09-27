// Isolated workerd + D1 integration check; all Google calls are intercepted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const bundle = await build({
  stdin: {
    contents: `import { processSocialDrafts } from './worker/src/social-ai-drafts.js'; export default { async fetch(req,env) { return Response.json(await processSocialDrafts(env)); } };`,
    resolveDir: resolve("."),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
let calls = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-07",
    d1Databases: { DB: "social-ai-runtime-test" },
    bindings: {
      SOCIAL_AI_ENABLED: "true",
      GOOGLE_CLIENT_ID: "test",
      GOOGLE_CLIENT_SECRET: "test",
      GOOGLE_REFRESH_TOKEN: "test",
      GEMINI_API_KEY: "test",
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "test" });
      if (url.hostname === "www.googleapis.com") {
        if (url.searchParams.get("alt") === "media")
          return new Response(new Uint8Array([1, 2, 3]));
        return Response.json({
          id: "one",
          parents: ["16M72Ioa-KtWd0jpbx_Gqee42NHtbqIXO"],
          size: "3",
          mimeType: "image/png",
          version: "1",
          modifiedTime: "before",
        });
      }
      assert.equal(url.hostname, "generativelanguage.googleapis.com");
      calls++;
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: "Test image",
                    subjects: ["test"],
                    review_notes: ["Do not publish"],
                    caption: "Internal test draft",
                    platforms: {
                      instagram: "Test",
                      linkedin: "Test",
                      google_business_profile: "Test",
                    },
                  }),
                },
              ],
            },
          },
        ],
      });
    },
  }),
);
try {
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("worker/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(`worker/migrations/${file}`, "utf8").replace(
      /--[^\n]*/g,
      "",
    );
    await DB.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => DB.prepare(s)),
    );
  }
  await DB.prepare(
    "INSERT INTO social_content(id,source_file_id,media_type,created_at,updated_at) VALUES ('one','one','image','before','before')",
  ).run();
  const responses = await Promise.all([
    mf.dispatchFetch("http://local/run"),
    mf.dispatchFetch("http://local/run"),
  ]);
  const results = await Promise.all(responses.map((r) => r.json()));
  assert.deepEqual(results.map((r) => r.status).sort(), ["idle", "review"]);
  assert.equal(calls, 1);
  assert.equal(
    (await DB.prepare("SELECT workflow_state FROM social_content").first())
      .workflow_state,
    "review",
  );
  assert.equal(
    (
      await DB.prepare(
        "SELECT count(*) n FROM social_content_targets WHERE publish_status='draft'",
      ).first()
    ).n,
    3,
  );
  assert.equal(
    (await (await mf.dispatchFetch("http://local/run")).json()).status,
    "idle",
  );
  console.log(
    "PASS: workerd + D1 migrations, exclusive claim, draft persistence, and repeat-run idempotency",
  );
} finally {
  await mf.dispose();
}
