# Integration boundaries

This cleanup adds no provider functionality, credentials, schema changes, or production configuration changes. It makes the existing boundaries easier to inspect before integration work.

## Forms and persistence

Both forms POST JSON to `/api/consultation`. Their explicit payloads, source values, validation, error text, and reset behavior remain page-specific and unchanged. The shoot form includes preferred time, alternate date, and access details. The consultation form maintains its own calendar selection.

The Worker validates name, email, and description; upserts a contact by normalized email; and inserts a project. It stores both selected structured fields and the complete original payload. Preserve its HTTP response contract, parameterized SQL, binding name `DB`, and existing write order when adding provider code.

## Google Workspace, Calendar, and Gmail

The calendar calls `/api/availability?date=YYYY-MM-DD`. It currently generates weekday slots from 08:00 through 16:00 and blocks slots explicitly marked unavailable. An unavailable endpoint retains the existing fallback. The checked-in Worker does not implement this GET route; it handles POST `/api/consultation` and OPTIONS only. This cleanup does not change that behavior or create calendar reservations.

Later Google integration belongs behind server endpoints, with server-side credentials and separately reviewed decisions about time zones, authoritative availability, event reservations, retries, and duplicate prevention. Gmail or Workspace actions should use distinct server-side provider modules with explicit authorization and a defined failure contract. None of these provider actions are implemented by this cleanup.

## Stripe and banking

Migration `0002_consultation_booking.sql` contains Stripe and Google Calendar identifier columns. They are preparation in the schema, not evidence of working payment or calendar integrations. Both migrations are retained byte-for-byte. Future payments, webhooks, or banking work must separately define authorization, provider secrets, webhook verification, and idempotency. Provider credentials do not belong in public JavaScript or source-controlled configuration.

## Cloudflare and D1

Root `wrangler.toml` and `worker/wrangler.toml` support the existing root-directory and worker-directory deployment commands. They point to the same Worker and D1 database; their paths, identifiers, bindings, and compatibility date are unchanged. The production Pages workflow is also unchanged.

The Worker remains intentionally small; its cleanup is formatting only. Known pre-existing limitations are outside this preservation-only refactor: contact and project writes are separate, JSON `null` does not receive a structured validation error, and the checked-in Worker does not provide calendar availability. Functional changes to these behaviors require their own review.
