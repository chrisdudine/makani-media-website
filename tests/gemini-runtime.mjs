// Isolated workerd/D1 endpoint integration. No live Google or customer calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(
  process.env.WORKER_TEST_RUNTIME || import.meta.url,
);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const bundle = await build({
  stdin: {
    contents: `import {handleLeadEngineRequest} from './worker/src/gemini.js'; export default {async fetch(r,e){const gate=new URL(r.url).searchParams.get('gate');return await handleLeadEngineRequest(r,{...e,...(gate==='production'?{LEAD_ENGINE_ENVIRONMENT:'production'}:gate==='recipient'?{LEAD_ENGINE_TEST_RECIPIENT:'wrong@example.test'}:{})})||new Response('missing',{status:404});}};`,
    resolveDir: resolve("."),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
let calls = 0,
  fail = false;
const result = {
  summary: "Synthetic request",
  recommendedService: "Review scope",
  missingInformation: "Date",
  draftResponse: "Internal draft",
  confidence: 0.8,
  nextAction: "Human review",
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-07",
    d1Databases: { DB: "crm-isolated-test" },
    bindings: {
      ADMIN_API_KEY: "test-admin",
      GEMINI_API_KEY: "test-gemini",
      LEAD_ENGINE_ENVIRONMENT: "staging",
      LEAD_ENGINE_TEST_RECIPIENT: "makanimediamaui@gmail.com",
      LIVE_PROSPECT_OUTREACH: "false",
      STRIPE_MODE: "test",
    },
    outboundService: async (request) => {
      calls++;
      const url = new URL(request.url);
      assert.equal(url.hostname, "generativelanguage.googleapis.com");
      assert.equal(url.search, "");
      assert.equal(request.headers.get("x-goog-api-key"), "test-gemini");
      const body = await request.json();
      assert.equal(body.generationConfig.maxOutputTokens, 4096);
      assert.equal(
        body.generationConfig.responseJsonSchema.additionalProperties,
        false,
      );
      return fail
        ? new Response("private provider detail", { status: 400 })
        : Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: JSON.stringify(result) }] },
              },
            ],
          });
    },
  }),
);
try {
  const DB = await mf.getD1Database("DB");
  const sql = readFileSync("worker/migrations/0004_lead_engine_ai.sql", "utf8");
  await DB.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => DB.prepare(s)),
  );
  const body = {
    task: "project_analysis",
    entityId: "SYNTHETIC",
    payload: { request: "Internal test" },
  };
  const send = (
    query = "",
    key = "test-admin",
    payload = JSON.stringify(body),
  ) =>
    mf.dispatchFetch("http://local/api/internal/lead-engine/analyze" + query, {
      method: "POST",
      headers: { "X-Admin-Key": key, "Content-Type": "application/json" },
      body: payload,
    });
  assert.equal((await send("", "wrong")).status, 401);
  assert.equal((await send("?gate=production")).status, 409);
  assert.equal((await send("?gate=recipient")).status, 409);
  assert.equal((await send("", "test-admin", "{")).status, 400);
  assert.equal(calls, 0);
  assert.equal(
    (await DB.prepare("SELECT COUNT(*) n FROM lead_engine_ai_runs").first()).n,
    0,
  );
  let response = await send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).testOnly, true);
  let rows = (await DB.prepare("SELECT * FROM lead_engine_ai_runs").all())
    .results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "succeeded");
  assert.equal(rows[0].test_only, 1);
  assert.equal(rows[0].environment, "staging");
  assert.deepEqual(JSON.parse(rows[0].output_json), result);
  fail = true;
  response = await send();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Gemini analysis failed safely.",
  });
  rows = (
    await DB.prepare(
      "SELECT * FROM lead_engine_ai_runs ORDER BY created_at",
    ).all()
  ).results;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].status, "failed");
  assert.equal(rows[1].error, "Gemini request failed (400)");
  assert.equal(rows[1].output_json, "{}");
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(rows).includes("test-gemini"));
  assert.ok(!JSON.stringify(rows).includes("private provider detail"));
  console.log(
    "PASS: CRM authenticated endpoint, staging/production gates, local migration, success/failure D1 audit, and safe error handling",
  );
} finally {
  await mf.dispose();
}
