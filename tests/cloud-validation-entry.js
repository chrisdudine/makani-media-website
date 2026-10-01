// Synthetic Cloudflare staging harness. No production config references this file.
// All provider traffic is replaced in-process; no real Gemini key is required.
import { handleLeadEngineRequest } from "../worker/src/gemini.js";
export default {
  async fetch(request, env) {
    let calls = 0;
    const scenario = request.headers.get("X-Validation-Case") || "success";
    const gate = request.headers.get("X-Validation-Gate");
    const safeEnv = {
      ...env,
      GEMINI_API_KEY: "synthetic-no-provider-access",
      LIVE_PROSPECT_OUTREACH: "false",
      STRIPE_MODE: "test",
      LEAD_ENGINE_LAUNCH_APPROVED: "false",
      ...(gate === "unknown" ? { LEAD_ENGINE_ENVIRONMENT: "unknown" } : gate === "missing" ? { LEAD_ENGINE_ENVIRONMENT: undefined } : {}),
      ...(gate === "production"
        ? { LEAD_ENGINE_ENVIRONMENT: "production" }
        : gate === "recipient"
          ? { LEAD_ENGINE_TEST_RECIPIENT: "invalid@example.test" }
          : gate === "audit"
            ? { DB: undefined }
            : {}),
    };
    const fetcher = async (_url, init) => {
      calls++;
      if (scenario === "http-error")
        return new Response("PRIVATE_FIXTURE_PROVIDER_DETAIL", { status: 400 });
      if (scenario === "network-error")
        throw Error("PRIVATE_FIXTURE_NETWORK_DETAIL");
      if (scenario === "oversized") return new Response("x".repeat(300000));
      const schema = JSON.parse(init.body).generationConfig.responseJsonSchema;
      let result;
      if (schema.properties.summary)
        result = {
          summary: "Synthetic project only",
          recommendedService: "Review scope",
          missingInformation: "Date",
          draftResponse: "Internal synthetic response",
          confidence: 0.8,
          nextAction: "Human review",
        };
      else if (schema.properties.subject)
        result = {
          subject: "Synthetic draft",
          body: "Internal synthetic body; do not send.",
          messageAngle: "Test only",
          sequenceStep: 0,
          toneCheck: "pass",
        };
      else if (schema.properties.classification)
        result = {
          classification: "unsubscribe",
          intent: "unsubscribe",
          requiresHuman: false,
          stopSequence: false,
          suggestedReply: "",
        };
      else
        result = {
          finding: "Synthetic metric",
          recommendation: "Human review",
          confidence: 0.5,
          metric: "test",
          risk: "No real data",
        };
      if (scenario === "invalid-output")
        result = { ...result, unexpected: true };
      return Response.json({
        candidates: [
          {
            finishReason: scenario === "incomplete" ? "MAX_TOKENS" : "STOP",
            content: { parts: [{ text: JSON.stringify(result) }] },
          },
        ],
      });
    };
    const response =
      (await handleLeadEngineRequest(request, safeEnv, { fetcher })) ||
      new Response("Not found", { status: 404 });
    const headers = new Headers(response.headers);
    headers.set("X-Validation-Provider", "mock");
    headers.set("X-Validation-Mock-Calls", String(calls));
    return new Response(response.body, { status: response.status, headers });
  },
};
