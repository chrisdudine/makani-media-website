# Social automation production handoff

Verified 2026-09-27 UTC (2026-09-26 Hawaii time).

## Current phase

The social foundation and Drive inbox intake already exist. Do not rebuild them or reapply migrations blindly.

- Repository main: `e4a0a13d3c09cc10e8d8897f36b3ac0827ef8ab8` (Drive inbox ingestion), following `c226bacb13506f7c02678a49236e8548fcb5f845` (social tables).
- Worker: `makani-media-api`; production D1: `makani-media`, ID `514ec4c8-012e-40b0-b426-c3228b4f6bdf`, binding `DB`.
- Production migration ledger records 0004 at `2026-09-26 16:55:52` and 0005 at `2026-09-26 17:41:30` UTC. Schema and partial unique index match the migration files. No duplicate Drive IDs or foreign-key violations were found.
- Cron: `*/5 * * * *`, present before this task and preserved.
- Inbox folder: `16M72Ioa-KtWd0jpbx_Gqee42NHtbqIXO`. Only direct image/video children are ingested; no recursion, downloads, moves, or publishing.
- Existing test file: `social-inbox-intake-test.png`, Drive ID `1CbUIu-toKuKEaIId3Aglpaj4GgTIXVFQ`. Exactly one D1 row exists, in `inbox`, created and last updated `2026-09-26T23:00:33.358Z`.
- A fresh production cron observed through the live tail at `2026-09-27T06:40:27.353Z` completed with outcome `ok`, scanned 1, inserted 0, existing 1, skipped 0, pages 1, no exceptions. This exercises the deployed OAuth refresh, folder lookup, Drive listing and D1 conflict handling. The original insertion predates this audit; no duplicate test file was created.

## Changes in this audit

No application logic, booking UI, migration SQL, or OAuth secret was changed.

- Default tests now include Calendar and social intake. Historical one-time extraction comparisons are retained under `tests/legacy/` behind `pnpm test:legacy-extraction`, rather than requiring an absent sibling baseline for normal tests. Current Worker contracts replace comparisons with obsolete pre-booking behavior.
- Added migration replay and duplicate-failure preservation checks, a pinned Wrangler development dependency, and a test/dry-run GitHub workflow.
- Both Wrangler configs now enable persistent logs and 1% sampled traces.
- Cloudflare rejected a settings-only update with error 10214 because uploaded version 98 differed from active version 97. Resolved by uploading the tested intake bundle with observability enabled and all existing secret bindings retained. The downloaded bundle matched the dry-run build except for its source-map comment.
- New active production version: `5ade058a-cf32-4dfe-b0f4-ba0ea518291b`, 100% traffic, deployment `2e888828-a28a-4ca4-9c9e-7961731f29a0`, at `2026-09-27T06:44:06.037375Z`.
- Previous active version: `20893f7d-d548-4b5e-afb8-fd9d2f70f80c`. No database rollback is needed for this logging-only release.

- Post-release cron at `2026-09-27T06:45:30.887Z` again completed successfully: scanned 1, inserted 0, existing 1, skipped 0, pages 1. Persistent Cloudflare logs associate this event with version `5ade058a-cf32-4dfe-b0f4-ba0ea518291b`. The original D1 row and timestamps remained unchanged.
- Repository changes remain local: automatic approval review rejected the GitHub push as an external export requiring explicit user approval. No PR was created and the new GitHub test workflow has not run remotely. A reviewable patch accompanies this handoff.

## Validation

- Node 24.19.0: 28 tests passed, zero failures. Includes booking validation/persistence, Calendar failure/blocked-slot behavior, booking emails, estimates, source parsing/assets, ingestion pagination/concurrency/retries, and migrations.
- Wrangler 4.141.0 production-config dry run passed (48 KiB bundle). All five migrations applied successfully to a fresh **local** D1 database.
- Root `migrations_dir` correctly points to `worker/migrations`; the config inside `worker/` uses its adjacent default migrations directory.
- Production booking diagnostics returned `ok: true` before and after the release. All Google, D1 and email binding checks passed. Calendar availability for `2027-01-18` returned HTTP 200 and available slots; October 2026 remained blocked by the existing December 15 blackout. No real booking, Calendar event, email, or public post was created during validation.
- Full formatting check reports existing differences in `index.html`, `pricing.html`, `privacy.html`, and `terms.html`; those pages were left unchanged. These are style differences, not failing behavior tests.
- GitHub Pages workflow deploys the static site only. It is not proof of Worker deployment.

## OAuth and access

Cloudflare access is available and production ingestion is not blocked by credentials. The Worker retains `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`, as well as all unrelated secrets. The successful cron proves effective Drive metadata access; the Calendar endpoint proves effective Calendar availability access.

The exact granted scope list, OAuth consent-screen publication state, and refresh-token expiry are not exposed by secret metadata, so they were not independently inspected. Do not rotate a working shared refresh token merely to inspect it. If reauthorization is ever needed, preserve existing Calendar read/free-busy and event-write permissions, add Drive read-only access, request offline access and include prior grants. Metadata-only ingestion can work with `drive.metadata.readonly`; a later media-analysis pipeline that downloads bytes needs `drive.readonly` or another suitable grant. Do not assume current metadata success proves byte-download access.

References: [Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [incremental OAuth authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Workers tracing](https://developers.cloudflare.com/workers/observability/traces/).

## Next Worker/Codex task

Read this handoff, inspect current main and the audit changes, and recheck active deployment and migration ledger before editing. Apply the accompanying audit patch (or incorporate its review branch if later pushed) before building the next phase. Do not recreate the foundation or Drive intake, reapply 0004/0005, or replace booking/Calendar functionality.

The next unfinished product phase is AI media analysis and draft generation on top of `social_content`. First verify the existing Worker credential can read media bytes; metadata access alone is insufficient evidence. Build an incremental, bounded pipeline with explicit claims, retry/error handling and idempotency. Generate useful metadata and draft captions for Makani Media, store them in D1, and transition `inbox` through `processing` to `review`. Preserve human edits and prevent overlapping runs from generating duplicate work. Keep platform-specific drafts/adapters modular for Instagram, LinkedIn and Google Business Profile. An existing `GEMINI_API_KEY` secret binding is present, but model access and suitability were not tested in this phase.

Do not implement automatic public publishing. Preserve booking, consultation, Calendar, email and payment integrations. Run the full tests and a Worker dry run, validate new migrations locally, and report any additional scopes or model credentials needed before the next rollout.
