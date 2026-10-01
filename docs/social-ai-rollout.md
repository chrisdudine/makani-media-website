# Social AI drafting rollout and handoff

Verified 2026-09-27 UTC. Implementation is complete and deployed **paused**. Production generation is blocked by Google project access; a successful production AI draft has not been demonstrated.

## Follow-up: 2026-09-28 UTC

The single controlled recovery attempt after authorized personal-account Google Cloud terms acceptance still failed at `2026-09-28T09:50:58.485Z`, now classified as `GEMINI_PROJECT_ACCESS_DENIED`. The job ledger records **four cumulative attempts**, failed state, empty caption and zero targets. AI is paused again in Worker version `e4313281-2a73-4460-8ccd-c4f00fe29a76` (deployed 09:53:55 UTC). Booking configuration and Calendar availability checks passed during the recovery deployment. No code, migrations, credentials, or public posting behavior changed.

The recovery deliberately granted one additional attempt by temporarily setting the existing capped counter to 2, then restored the cumulative count to 4 immediately after failure. The original three-failure state and timestamp remain documented below; no failed run was represented as successful.

**More specific recovery instruction:** AI Studio under `makanimediamaui@gmail.com` shows project **Makani Media Booking** (`makani-media-booking`) as **Restricted**, with billing tier **Unavailable**. Its Rate Limit page says: “This Project’s API access is restricted. Please set up billing to continue.” This supersedes the earlier assumption that contacting support is necessarily the first recovery step. The visible business-project restriction is consistent with production failure; the sealed Worker secret has not been exposed or independently matched to the project.

Billing onboarding is open for the business account. It requires separate acceptance of Google Cloud and applicable API terms, then billing enrollment. No payment or paid-usage commitment has been made. Obtain explicit acceptance and a spending limit before completing paid setup. The earlier terms acceptance was for `chrisdudine@gmail.com` and does not authorize a new billing agreement for the business account. Do not substitute the personal account’s default project or repeatedly retry the restricted project.

After authorized billing setup, recheck project access and perform one controlled generation test using the existing deployed credentials. If Google continues to deny access, escalate with the exact denial and project restriction details. Keep AI paused until recovery is verified. A production draft and human review interface remain outstanding.

## Completed

- Continued from foundation `c226bac` and Drive ingestion `e4a0a13`, preserving the completed intake work and audit branch.
- Added bounded media analysis, structured captions for Instagram/LinkedIn/Google Business Profile, draft-only target storage, atomic claims, retries, edit protection, and a separate job ledger. No publishing adapter or public administrative endpoint was added.
- All 56 automated tests pass. A separate workerd + real local D1 runtime test passes concurrent claims, all migrations, draft persistence, and repeat-run idempotency using intercepted provider responses. Wrangler packaging passes.
- Production migration 0006 was applied once at 2026-09-27 18:15:01 UTC. Migrations 0004 and 0005 were already applied; do not reapply them.
- Drive OAuth refreshed and downloaded the existing test image. Model metadata lookup succeeded. These checks do not establish generation permission.
- Final Worker version `96da08ae-3539-4a9c-b090-5eb2a4fa7951` deployed at 2026-09-27 20:40:43 UTC with `SOCIAL_AI_ENABLED=false` and `SOCIAL_AI_VERIFY=false`. Existing bindings/secrets and `*/5 * * * *` schedule remain in place.
- Post-deployment booking diagnostics report all configuration checks true. Read-only Calendar availability for 2027-01-18 returns available slots. No booking, Calendar event, email, payment, or social post was created for verification.

## Confirmed blocker

Actual Gemini generation returned HTTP 403. The diagnostic event at 2026-09-27 18:35:55.074 UTC says: **“Your project has been denied access. Please contact support.”** Model lookup working does not override this denial. Restore the Google project's authorized Gemini access through Google support before further generation attempts; there is no evidence that merely rotating a key or changing models fixes it.

The existing `social-inbox-intake-test.png` (68 bytes) has content ID `google-drive:1CbUIu-toKuKEaIId3Aglpaj4GgTIXVFQ`. Its job is failed after three controlled attempts, with historical code `GEMINI_HTTP_403`; content is in review, caption empty, AI metadata `{}`, and zero target rows. The final deployed classifier recognizes future matching denials as `GEMINI_PROJECT_ACCESS_DENIED`. Historical evidence was not rewritten. AI is paused to prevent additional failures; Drive intake continues.

## Next Worker/Codex task

Continue on `codex/social-ai-drafts`, read this rollout record and `docs/social-ai-drafts.md`, and inspect current production settings before changes. Do not rebuild intake or reapply migrations 0004–0006. First establish that Google has restored this project's permission to invoke Gemini generation. Until then, keep AI disabled and do not reset failed jobs or bypass the denial using another account/model.

After access is restored, deliberately authorize a small retry budget for the existing test item. Re-read it and guard any requeue on its exact failed state, blank caption, untouched metadata, and absence of targets; retain the prior failure history in the rollout record. Enable drafting with all unrelated bindings/secrets preserved. Observe an actual scheduled generation, verify review state plus draft-only platform targets, then observe a repeat scan to establish no duplicate generation or targets. The tiny test image validates plumbing only; use a user-approved real media item within the 8 MiB / 60-second limits to validate caption quality. Confirm booking diagnostics and Calendar availability again. No public publishing.

Once production generation is proven, the next product phase is a human review interface for the original media, AI summary, platform captions, failures, and edit/approve/reject actions with concurrency protection. Publishing remains a separate phase.

## Latest recovery and build repair — 2026-09-29 UTC

This section supersedes earlier pending-setup instructions. My First Project (`project-d8454f48-de24-40ff-abb`) was verified already linked to active business billing account `01F3AF-80301D-CC4B92`; the link was not changed. With explicit approval, Gemini API was enabled and a Gemini-only credential stored separately as `GEMINI_TEST_API_KEY`. Existing secrets and booking OAuth were preserved.

After the user reported billing/account verification complete, a new one-attempt production test (`makani-gemini-retest-20260929-02`) ran at 17:45:53–17:45:56 UTC. Drive download and the 68-byte PNG fixture check passed. Gemini again returned `GEMINI_BILLING_REQUIRED`. The D1 audit table `social_controlled_tests` records one generation attempt, failed status and no result JSON. No caption, AI metadata or platform targets were created; no successful end-to-end draft is claimed. The earlier controlled test at 16:55 UTC had the same result. No automatic retries or counter resets occurred.

Restored stable Worker version `35ebd605-1406-40eb-92cb-4157c90f3a40`, with `SOCIAL_AI_ENABLED=false` and `SOCIAL_AI_VERIFY=false`. The temporary one-shot handler is removed; regular five-minute Drive intake remains. Booking diagnostics pass after restoration. No migrations 0004–0006, secrets, billing links, public posts, emails, payments or launch gates were changed in this retest. Maximum output was 4,096 tokens with one request and no tools, comfortably below the prior $1 test ceiling at published model rates; actual billed usage is unverified because the rejected request supplied no usage totals.

Cloudflare build `9c23d628-3ba5-4c8e-b6ba-d0d68bd0b9ea` failed during dependency installation: pnpm 10.11.1 rejected the workspace file with “packages field missing or empty.” The repository uses pnpm 11 `allowBuilds` settings. Added explicit root workspace membership and pinned `packageManager` to `pnpm@11.19.0`, matching GitHub CI. Frozen installation, all 56 regression tests, isolated workerd/D1 runtime tests, and Wrangler dry-run pass locally. The preview trigger only uploads a version; it does not promote it to production.

Next: resolve Gemini-specific billing eligibility for the exact business project, without relinking the already-correct Cloud billing account or substituting the personal project. Do not retry paid generation until that prerequisite changes. Then authorize one new test ID, verify caption plus `requires_human_approval:true` metadata and three draft-only targets, and only after that run the controlled PR #23 CRM test. PR #23 production generation was deliberately not attempted because the social prerequisite failed. Keep both PRs unmerged and all publishing/outreach/customer-action gates off.
