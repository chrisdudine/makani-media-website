import test from "node:test";
import assert from "node:assert/strict";
import {
  handleLeadEngineRequest,
  leadEngineState,
  runGeminiTask,
} from "../worker/src/gemini.js";

const output = {
  subject: "Aerial progress documentation for your Maui projects",
  body: "Hello — I’m reaching out from Makani Media with a concise idea for recurring project documentation.",
  messageAngle: "Recurring stakeholder-ready progress coverage",
  sequenceStep: 0,
  toneCheck: "pass",
};

const geminiFetch = async () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(output) }] },
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

test("defaults to a production-gated state", () => {
  assert.deepEqual(leadEngineState({}), {
    environment: "production",
    liveProspectOutreach: false,
    stripeMode: "test",
    testRecipient: "",
    model: "gemini-2.5-flash",
  });
});

test("returns validated structured Gemini output", async () => {
  const result = await runGeminiTask(
    { GEMINI_API_KEY: "test", GEMINI_MODEL: "gemini-test" },
    "outreach_draft",
    { company: "Test Company" },
    geminiFetch,
  );
  assert.deepEqual(result, output);
});

test("internal endpoint rejects unauthorized requests", async () => {
  const response = await handleLeadEngineRequest(
    new Request("https://example.test/api/internal/lead-engine/diagnostics"),
    { ADMIN_API_KEY: "secret" },
  );
  assert.equal(response.status, 401);
});

test("production gate remains closed without explicit launch flags", async () => {
  const response = await handleLeadEngineRequest(
    new Request("https://example.test/api/internal/lead-engine/analyze", {
      method: "POST",
      headers: { "X-Admin-Key": "secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "outreach_draft",
        entityId: "TEST-1",
        payload: {},
      }),
    }),
    {
      ADMIN_API_KEY: "secret",
      LEAD_ENGINE_ENVIRONMENT: "production",
      LIVE_PROSPECT_OUTREACH: "false",
      STRIPE_MODE: "test",
      GEMINI_API_KEY: "test",
    },
  );
  assert.equal(response.status, 409);
  assert.match(await response.text(), /launch gate is closed/i);
});

test("uses JSON Schema transport and bounds generation without a key in the URL", async () => {
  await runGeminiTask(
    { GEMINI_API_KEY: "test-secret" },
    "outreach_draft",
    {},
    async (url, init) => {
      assert.equal(new URL(url).search, "");
      assert.equal(init.headers["x-goog-api-key"], "test-secret");
      const config = JSON.parse(init.body).generationConfig;
      assert.equal(config.responseSchema, undefined);
      assert.equal(config.responseJsonSchema.additionalProperties, false);
      assert.equal(config.maxOutputTokens, 4096);
      assert.ok(init.signal instanceof AbortSignal);
      return geminiFetch();
    },
  );
});

test("rejects provider errors without retrying or exposing credentials", async () => {
  let calls = 0;
  await assert.rejects(
    runGeminiTask(
      { GEMINI_API_KEY: "test-secret" },
      "outreach_draft",
      {},
      async () => {
        calls++;
        return new Response("sensitive provider detail", { status: 400 });
      },
    ),
    { message: "Gemini request failed (400)" },
  );
  assert.equal(calls, 1);
});

test("malformed request shapes return 400 before provider or audit work", async () => {
  for (const body of [
    "null",
    "[]",
    JSON.stringify({ task: "project_analysis", entityId: "x", payload: [] }),
  ]) {
    const response = await handleLeadEngineRequest(
      new Request("https://test/api/internal/lead-engine/analyze", {
        method: "POST",
        headers: { "X-Admin-Key": "test", "Content-Type": "application/json" },
        body,
      }),
      {
        ADMIN_API_KEY: "test",
        LEAD_ENGINE_ENVIRONMENT: "staging",
        LEAD_ENGINE_TEST_RECIPIENT: "makanimediamaui@gmail.com",
        DB: {
          prepare() {
            return { first: async () => ({}) };
          },
        },
      },
    );
    assert.equal(response.status, 400);
  }
});
test("rejects invalid types, extra keys and incomplete provider results", async () => {
  for (const candidate of [
    { ...output, sequenceStep: "zero" },
    { ...output, toneCheck: "invalid" },
    { ...output, extra: true },
  ]) {
    await assert.rejects(
      runGeminiTask(
        { GEMINI_API_KEY: "test" },
        "outreach_draft",
        {},
        async () =>
          Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: JSON.stringify(candidate) }] },
              },
            ],
          }),
      ),
    );
  }
  await assert.rejects(
    runGeminiTask({ GEMINI_API_KEY: "test" }, "outreach_draft", {}, async () =>
      Response.json({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: JSON.stringify(output) }] },
          },
        ],
      }),
    ),
  );
});

test("audit preflight blocks provider calls and storage failures are contained", async () => {
  let calls = 0;
  const request = () =>
    new Request("https://test/api/internal/lead-engine/analyze", {
      method: "POST",
      headers: { "X-Admin-Key": "test", "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "outreach_draft",
        entityId: "test",
        payload: {},
      }),
    });
  const base = {
    ADMIN_API_KEY: "test",
    GEMINI_API_KEY: "fake",
    LEAD_ENGINE_ENVIRONMENT: "staging",
    LEAD_ENGINE_TEST_RECIPIENT: "makanimediamaui@gmail.com",
  };
  const provider = {
    fetcher: async () => {
      calls++;
      return geminiFetch();
    },
  };
  assert.equal(
    (await handleLeadEngineRequest(request(), base, provider)).status,
    503,
  );
  assert.equal(calls, 0);
  const db = {
    prepare() {
      return {
        first: async () => ({}),
        bind() {
          return this;
        },
        run: async () => {
          throw Error("private database detail");
        },
      };
    },
  };
  const response = await handleLeadEngineRequest(
    request(),
    { ...base, DB: db },
    provider,
  );
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal((await response.json()).error, "Audit storage unavailable.");
});
test("network error details are not persisted in the failure audit", async () => {
  let values;
  const DB = {
    prepare() {
      return {
        first: async () => ({}),
        bind(...args) {
          values = args;
          return this;
        },
        run: async () => ({}),
      };
    },
  };
  const response = await handleLeadEngineRequest(
    new Request("https://test/api/internal/lead-engine/analyze", {
      method: "POST",
      headers: { "X-Admin-Key": "test", "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "outreach_draft",
        entityId: "test",
        payload: {},
      }),
    }),
    {
      ADMIN_API_KEY: "test",
      GEMINI_API_KEY: "fake",
      LEAD_ENGINE_ENVIRONMENT: "staging",
      LEAD_ENGINE_TEST_RECIPIENT: "makanimediamaui@gmail.com",
      DB,
    },
    {
      fetcher: async () => {
        throw Error("secret-provider-detail");
      },
    },
  );
  assert.equal(response.status, 502);
  assert.ok(!JSON.stringify(values).includes("secret-provider-detail"));
  assert.ok(values.includes("Gemini provider request failed"));
});
test("response and request bodies are bounded", async () => {
  await assert.rejects(
    runGeminiTask(
      { GEMINI_API_KEY: "test" },
      "outreach_draft",
      {},
      async () => new Response("x".repeat(300000)),
    ),
    /limit/,
  );
  const r = await handleLeadEngineRequest(
    new Request("https://test/api/internal/lead-engine/analyze", {
      method: "POST",
      headers: { "X-Admin-Key": "test", "Content-Type": "application/json" },
      body: "x".repeat(17000),
    }),
    {
      ADMIN_API_KEY: "test",
      LEAD_ENGINE_ENVIRONMENT: "staging",
      LEAD_ENGINE_TEST_RECIPIENT: "makanimediamaui@gmail.com",
    },
  );
  assert.equal(r.status, 400);
});

test("omitted and unknown environment cannot bypass the launch gate", async () => {
  for (const environment of [undefined, "stagign", "development", ""]) {
    let calls = 0;
    const response = await handleLeadEngineRequest(
      new Request("https://test/api/internal/lead-engine/analyze", {
        method: "POST",
        headers: { "X-Admin-Key": "test", "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "project_analysis",
          entityId: "gate-test",
          payload: {},
        }),
      }),
      {
        ADMIN_API_KEY: "test",
        LEAD_ENGINE_ENVIRONMENT: environment,
        LEAD_ENGINE_TEST_RECIPIENT: "makanimediamaui@gmail.com",
        LIVE_PROSPECT_OUTREACH: "false",
        STRIPE_MODE: "test",
      },
      {
        fetcher: async () => {
          calls++;
          throw Error("must not run");
        },
      },
    );
    assert.equal(response.status, 409);
    assert.equal(calls, 0);
  }
});

test("default deploy configs point to a closed production gate; isolated config uses test D1", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const path of ["wrangler.toml", "worker/wrangler.toml"]) {
    const text = await readFile(path, "utf8");
    assert.match(text, /LEAD_ENGINE_ENVIRONMENT = "production"/);
    assert.match(text, /LEAD_ENGINE_LAUNCH_APPROVED = "false"/);
    assert.match(text, /LIVE_PROSPECT_OUTREACH = "false"/);
  }
  const isolated = await readFile("tests/cloud-validation.toml", "utf8");
  assert.match(isolated, /LEAD_ENGINE_ENVIRONMENT = "staging"/);
  assert.ok(!isolated.includes("514ec4c8-012e-40b0-b426-c3228b4f6bdf"));
});
