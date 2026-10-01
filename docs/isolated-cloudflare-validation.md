# Isolated Cloudflare validation — 2026-09-30

Scope: PR #24 social review first, then PR #23 CRM staging. No merge, production deployment, real Gemini call, publishing, scheduling, email/outreach, phone, Calendar event creation or Stripe action.

## PR #24

Source: b68ca4ca45fae800e011bdb46a0242229e74bb2d. Isolated Worker makani-pr24-review-validation, version 6652b03c-fcdd-412d-848c-974685f9dfff, dedicated D1 8fada28a-388a-4281-a2b1-2a3b0d3c2096. Only a test admin credential, synthetic D1 data and false social AI flags were bound. No Google, email, Gemini or production database binding; no cron.

Cloudflare HTTP checks passed: missing/wrong auth, cross-origin rejection, page/CSP, synthetic item with three targets, concurrent edit conflict, approval, edit invalidation, revocation, oversized caption rejection and rejected publish/schedule fields. Authenticated Chrome checks passed sign-in, listing, editing, approval, edit-to-draft, persisted reload and sign-out clearing displayed drafts. All targets ended as drafts. Full regression: 58 passed; both workerd/D1 runtime suites passed. No new social implementation changes were needed in this phase; prior edit-preservation/metadata fixes remained valid.

Remaining limitation: actual Google Drive image rendering was not validated. The synthetic record uses a non-existent fixture-media ID. Automatic approval review rejected substituting the earlier blank Drive fixture because approval to expose that private file in this preview was not explicit. No Drive link or permission change was made. Before calling media preview fully validated, obtain approval for a specific test Drive image (for example social-inbox-intake-test.png), then verify rendering with the authorized Google account. No production deployment approval is requested now.

## PR #23

Starting source: 1efd96389cf211f276bef0793ee972826fd6fb4f. Isolated Worker makani-pr23-crm-validation, version 7a12bce0-8097-428a-8c30-344488399e89, dedicated D1 71445c7d-8901-48ee-89be-847414e4f9c5. The tests/cloud-validation-entry.js harness invokes the real authenticated handler and provider parsing with an in-process fake transport. No real Gemini key, Google credentials, email/Stripe binding or cron. This is mocked-provider endpoint/audit validation, not a live-model quality test.

Fixed defects reproduced by tests: null request crash; arrays/prototype task names accepted too far into processing; missing schema type/enum/range/extra-key validation; incomplete model responses accepted; unbounded JSON; provider error details reaching failure audit; and uncaught/missing audit-storage failures. Added bounded parsing, strict schema checks, completion checks, safe error messages, audit preflight and contained persistence failures. Unsubscribe classification requires human review and stops sequence. Authentication compares hashes without early per-character exit; route matching is exact. Optional transport injection is code-only for tests, not an environment-controlled live bypass.

Full regression initially failed because legacy extraction tests required an absent ../baseline checkout and the old calendar script layout. Preserved those historical tests under tests/legacy and adopted the existing maintained source/booking contract tests. Default test now includes calendar tests. Added CI running full regression, CRM workerd/D1 integration and deployment dry-run. Final result: 29 tests passed, CRM runtime passed, application packaging dry-run passed (54.98 KiB). The application default Wrangler configuration still references production; never use it for staging deployment. tests/cloud-validation.toml names only the isolated mock target.

Cloudflare staging passed 20 checks: auth, diagnostics, production gate, unsafe recipient, unavailable audit storage, malformed requests, all four task types, and five simulated provider failures. D1 contains exactly nine accepted-run audit rows: four succeeded and five failed; all environment=staging and test_only=1. Failed output_json is {}; errors contain no fixture provider/network detail or test credentials. Rejected authorization/input/gate requests made zero mock calls and created no accepted-run audit row. Nine mock calls; zero live provider calls.

## Final state and next approval

Both isolated workers have workers.dev and version preview URLs disabled after testing; databases and audit evidence are retained. No cron was created. Existing production remains version 7668722f-8cc9-4fd8-8f70-297153c40a24 with SOCIAL_AI_ENABLED=false and SOCIAL_AI_VERIFY=false. Production secrets/bindings, migrations 0004–0006 and booking/Calendar behavior were not changed. Both PRs remain unmerged.

Next approval needed: permission to reference a specific test Google Drive image in the isolated social review preview. This is a read-only media validation step, not permission to publish, run AI, merge or deploy to production. After that check, perform normal code review of the CRM fixes and separately decide any future rollout. Live-model validation remains intentionally unperformed under the no-AI constraint.
