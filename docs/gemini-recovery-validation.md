# Controlled Gemini validation — 2026-09-29

Social test succeeded at 20:50:26 UTC using the preserved original GEMINI_API_KEY after Makani Media Booking showed Paid Tier 1. The separate My First Project test key still required billing; no keys or billing links were changed. One 68-byte Drive fixture produced a review-only caption, approval-required AI metadata and exactly three draft targets (Instagram, LinkedIn, Google Business Profile). Gemini correctly rejected the blank fixture as unsuitable for publication. Job counter increased from 4 to 5 without resetting history. Input/output usage 1342/166 tokens; estimated model cost $0.0008176.

CRM's first synthetic attempt returned HTTP 400. Its JSON Schema was incorrectly sent through responseSchema. The fix uses responseJsonSchema, an x-goog-api-key header, a 4096 output-token limit and a 60-second timeout. Six provider/gate/transport tests pass. Corrected test makani-crm-controlled-20260929-02 succeeded at 21:16:24 UTC with a structured project analysis and human-review response draft. Input/output usage 132/146 tokens; estimated model cost $0.0004046. Combined successful generation estimate $0.0012222; invoice total unverified. Prior rejected attempts remain audited and supplied no token totals.

CRM validation used the PR provider with synthetic data, saved in operational D1 table social_controlled_tests with test_only=true and requires_human_approval=true. It did not enable CRM routes, contact anyone, or apply the separate CRM migration. lead_engine_ai_runs is absent from production, so full CRM endpoint/audit persistence remains to be validated in isolated staging. The test overrode the model to gemini-3.5-flash-lite; the checked-in default was not tested or changed.

Final production Worker: 0a971eeb-36cb-4d3a-9aa7-0b0ee2ff0313. Regular code restored; both SOCIAL_AI_ENABLED and SOCIAL_AI_VERIFY false. One-shot handlers removed. Five-minute Drive intake unchanged. No migrations 0004–0006 rerun, no public posting/scheduling, no email/outreach/phone/voicemail/payment actions, and no launch gate enabled. Both PRs remain unmerged.

Cloudflare build issue was corrected in social PR commit 4f41f125a59dcf2750c8073c882da0445a8a2c9a; preview build ebd69c93-6a10-474d-aab0-5c899f30ce29 passed. Social regression suite: 56 pass, workerd/D1 runtime checks and packaging pass. Booking diagnostics and Calendar availability passed during controlled tests; final read-only checks are recorded in the user handoff.

Next: review the blank-fixture evidence, validate one approved real media item and build the human review UI with publishing still off. For PR #23, validate the fixed provider through its authenticated endpoint and CRM audit table in isolated staging before merging or enabling any live workflow. Do not treat provider success as production CRM launch readiness.

Reference: https://ai.google.dev/api/generate-content (GenerationConfig responseJsonSchema).
