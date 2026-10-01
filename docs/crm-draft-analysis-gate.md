# Independent CRM draft-analysis permission

The authenticated `/api/internal/lead-engine/analyze` endpoint now uses `LEAD_ENGINE_DRAFT_ANALYSIS_ENABLED` independently of the existing live-launch flags. Both deployment configurations set it to `"false"`. Production analysis requires an explicit `LEAD_ENGINE_ENVIRONMENT="production"` and the exact string `"true"` for the draft permission. Missing or unknown environments fail closed. Explicit staging retains its existing fixed test-recipient restriction.

Legacy launch approval, outreach and Stripe flags cannot authorize analysis. Diagnostics report `draftAnalysisGateClosed` separately from the existing `launchGateClosed`. Successful responses include `draftOnly: true` and `humanReviewRequired: true`; these describe review requirements, not an approval or delivery operation. Production analyses retain `testOnly: false` and production audit attribution even when their result is a draft. No schema migration is required. No sending, publishing, scheduling, payment or social configuration is added or enabled.

Validation: 72 regression tests and all three isolated Worker runtime suites pass. New cases cover exact permission parsing, omitted/unknown environments, legacy flags denied, authentication with the new permission, audit-storage prerequisite, a mocked production-mode success and its persisted audit, review markers, and unchanged closed live-launch state. External services are mocked; no Gemini pilot was repeated.

The build-only Wrangler check also passed. Keep the draft permission false when integrating this change. Production deployment and model execution require separate approval; merging does not authorize either.
