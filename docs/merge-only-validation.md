# Merge-only validation — 2026-10-01 UTC

User authorized merging PR #24 then PR #23 while blocking all production deployment and live actions.

## Validation retained from isolated testing

PR #24: authenticated social review UI/API passed list, edit, approve, edit-to-draft, revoke, persisted reload, sign-out, concurrent/stale-save rejection, credential/origin rejection, limits, and rejection of publish/schedule operations. The approved social-inbox-intake-test.png displays via the direct Google Drive link. The embedded viewer reaches Google's cookie prompt in the tested browser; direct viewing is the accepted fallback for this phase. No Drive sharing changes were made.

PR #23: isolated Cloudflare authenticated CRM endpoints and D1 audit persistence passed. Dedicated D1 contains four successful and five failed test-only staging audit records. Missing, unknown and production environments reject processing with 409 and zero provider calls. Prior fixes include bounded input/output, structured-output validation, safe provider errors, audit preflight/failure handling, and production defaults that fail closed. These final staging tests used a synthetic Gemini provider, not live inference. Earlier controlled real-provider recovery results are historical evidence, not a new live-model test in this phase.

## Combined integration

PR #24 merged as 50e96c56a03442322c03e2ec5b925bd7dbecb727. Integrated that main tree into PR #23, resolving five overlaps: CI, package scripts, archived legacy test, and both Wrangler configurations. Preserved social Worker entry/cron, closed AI flags, booking/Calendar settings, observability, and closed CRM production launch gates. CRM runtime now goes through the full social-inbox Worker entry, proving routing through both wrappers.

Passed locally: 71/71 regression tests, social AI workerd/D1 runtime, social review workerd/D1 runtime, CRM workerd/D1 authenticated endpoint and success/failure audit runtime through the combined entry, and Wrangler 4.141.0 dry-run (97.26 KiB). Both CRM and social migrations apply together in the isolated review runtime. No live provider, email, customer or payment calls.

## Deployment blocks

- GitHub Pages Source changed from branch main/root to GitHub Actions after explicit user approval. Existing pages.yml workflow remains manually disabled. The existing website remains live on its previous deployment.
- Cloudflare production build trigger f37c57cf-52ff-4c91-91a9-0b488da79ff2 has empty build command, deploy command `exit 1`, and excluded paths `[*]`. This blocks migrations/deployment even if path filters are bypassed by a manual/large push.
- Non-production trigger remains version-upload only and excludes main.
- Active production version remains 7668722f-8cc9-4fd8-8f70-297153c40a24. No production migration was run. Production migration ledger records 0001, 0002, 0003, social 0004, 0005 and 0006; CRM 0004 is not in that ledger.

## Release prerequisites — separate approval required

After merge checks pass, keep deployment blocks in place. Before any production release, inspect actual production CRM schema against the migration ledger (historical controlled testing may have created audit schema outside Wrangler), prepare a non-destructive migration/reconciliation plan and backup, verify secret/binding names without replacement, and approve an exact commit plus rollback and read-only smoke-test plan. Do not blindly rerun completed social migrations. No release approval is granted by this document. AI enablement, CRM outreach, social publication/scheduling, Gmail/phone automation and live Stripe/customer actions remain separately prohibited.
