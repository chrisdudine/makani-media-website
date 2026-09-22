import test from "node:test";
import assert from "node:assert/strict";
import { handleLeadEngineRequest, leadEngineState, runGeminiTask } from "../worker/src/gemini.js";

const output = {
  subject: "Aerial progress documentation for your Maui projects",
  body: "Hello — I’m reaching out from Makani Media with a concise idea for recurring project documentation.",
  messageAngle: "Recurring stakeholder-ready progress coverage",
  sequenceStep: 0,
  toneCheck: "pass",
};

const geminiFetch = async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

test("defaults to a staging-safe state", () => {
  assert.deepEqual(leadEngineState({}), {
    environment: "staging",
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
      body: JSON.stringify({ task: "outreach_draft", entityId: "TEST-1", payload: {} }),
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

