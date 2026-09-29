# CRM endpoint and D1 integration verification

Verified in isolated local workerd and D1 on 2026-09-29. Google responses are intercepted; no paid calls, production migrations, or customer actions occur.

Run with Node 22.13+ and pinned pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
node --test tests/gemini.test.mjs
pnpm test:crm-runtime
```

Six provider tests pass. The runtime integration test applies the existing CRM migration only to its disposable database, then verifies:

- Incorrect admin credentials return 401 without a Gemini call or audit row.
- Closed production launch gate and unsafe staging recipient return 409 before model use.
- Invalid JSON returns 400 before model use.
- Authorized synthetic analysis returns testOnly=true and persists exactly one successful staging/test-only row with the structured output.
- Provider HTTP 400 returns a generic 502 to the caller and persists a failed audit row; raw provider body and API key are absent.
- Outbound requests use the Gemini host, API-key header, JSON Schema field, and 4096-token bound. No other service is called.

This complements the already successful live synthetic Gemini provider test. It establishes endpoint/storage wiring locally; it does not claim a deployed staging endpoint test or production CRM launch readiness. The root package now pins Wrangler 4.141.0 and pnpm 11.19.0 with locked runtime dependencies, matching the social validation toolchain.

Production remains unchanged at Worker 0a971eeb-36cb-4d3a-9aa7-0b0ee2ff0313 with both AI flags false. No PR was merged. The social inbox currently contains only social-inbox-intake-test.png; a real-media quality test awaits the user's selected asset.

Next: select an approved real Drive media asset for draft-only review; assess captions and approval UX. Separately, decide whether a dedicated deployed CRM staging environment is needed before merging. Do not enable publishing, outreach, Gmail sending, phone/voicemail, payments or launch gates.
