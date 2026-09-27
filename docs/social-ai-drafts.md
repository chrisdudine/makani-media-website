# Social AI drafts

This phase adds media analysis and draft captions to the existing five-minute Drive inbox scan. It does not add publishing, approvals, or changes to booking, Calendar, email, or payments.

## Processing contract

After successful intake, the scheduled Worker processes at most **one** eligible item. Eligibility requires a Google Drive source, `workflow_state='inbox'`, an empty caption, untouched `{}` AI metadata, and no existing target rows. Human-authored content is never enrolled.

Migration `0006_social_generation_jobs.sql` adds a separate job ledger. Claims use an atomic D1 batch and a random ownership token with a ten-minute lease. The ledger permits three total attempts, with five-minute and fifteen-minute retry delays for transient failures. Expired leases are reclaimable; an exhausted final lease becomes a visible failed job. Completion is guarded by the ownership token, lease, source file, original update timestamp, blank content, and absence of target rows. Draft content, platform targets, and success state commit in one D1 transaction. An edited item or stale worker cannot overwrite the winning content.

The model API itself has no exactly-once guarantee: a process lost after generation but before saving can incur another model call after lease expiry. D1 draft persistence is idempotent, and the attempt cap bounds retries.

Successful items move `inbox → processing → review`. Failed permanent/exhausted jobs also move to review with an error code in the job ledger and no fabricated caption. Transient failures return to inbox until their next attempt. Failures never publish or schedule posts.

## Media and draft storage

- Google OAuth reuses the existing credentials and refreshes without requesting or replacing scopes. Drive metadata and downloaded bytes are read-only.
- Membership in the designated inbox, trash status, size, MIME type and source version are checked. Metadata is rechecked after model generation to avoid saving drafts for changed/moved media.
- Maximum media size: **8 MiB**, enforced both from metadata and while streaming. Supported images: PNG, JPEG, WebP, HEIC, HEIF. Supported videos: MP4, MPEG, QuickTime, WebM, with a known duration of at most **60 seconds**. Larger files and unsupported formats require review; this phase does not transcode or upload large files to Gemini's Files API.
- One bounded media request is sent to Gemini using inline bytes. OAuth, Drive and model calls have timeouts; JSON responses are bounded to 256 KiB. Raw provider errors, keys, tokens and media bytes are not logged. For an unclassified Gemini HTTP 403, a 300-character denial detail is stripped of the supplied key, opaque strings, and HTML before logging.
- `social_content.caption` receives the general draft. `ai_metadata_json` contains the model/version, source version, summary, subjects, review notes, platform drafts and `requires_human_approval: true`.
- Separate target rows are created for existing Instagram, LinkedIn and Google Business Profile accounts, always with `publish_status='draft'`. Disabled accounts stay disabled; they may still have a draft for future review. Existing target rows are never overwritten.
- The prompt treats media text and speech as untrusted input, forbids inferred identities/client relationships/precise locations, and flags unusable/test media. These instructions and schema validation do not replace human review.

## Configuration and verification

Both Wrangler configurations contain:

```toml
SOCIAL_AI_ENABLED = "false" # enable only after generation access is working
SOCIAL_AI_VERIFY = "false"
SOCIAL_AI_MODEL = "gemini-3.5-flash-lite"
```

`SOCIAL_AI_VERIFY=true` takes precedence and performs a read-only download and model-lookup check on an inbox item. It does **not** establish permission to invoke generation or consume jobs. Disable this temporary verification setting after use. The normal processor is disabled unless `SOCIAL_AI_ENABLED` is exactly `true`.

Required secrets: existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GEMINI_API_KEY`. Check the remote migration ledger before rollout; 0004/0005 were already applied. Apply 0006 once before enabling the processor. Preserve all unrelated secrets and bindings on every deployment.

Run:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:runtime
pnpm exec wrangler deploy --dry-run
pnpm exec wrangler d1 migrations list makani-media --remote
```

`test:runtime` uses the workerd and Miniflare versions pinned through Wrangler, an isolated D1 database, and intercepted Google responses; it never calls production services. The runtime test verifies all migrations, concurrent claims, draft persistence and repeat-run idempotency. The GitHub test workflow runs it alongside regression tests and packaging.

## Operations

Structured events: `social_ai_drafts` with `status` (`disabled`, `idle`, `review`, `retry`, `failed`, `superseded`, or preflight `verified`); `social_ai_drafts_failed` for configuration/uncaught failures. Detailed per-item status is in `social_generation_jobs`:

```sql
SELECT c.id,c.source_file_name,c.workflow_state,j.status,j.attempts,
       j.error_code,j.next_attempt_at,j.model
FROM social_content c
LEFT JOIN social_generation_jobs j ON j.content_id=c.id;
SELECT content_id,platform,publish_status,platform_caption
FROM social_content_targets ORDER BY content_id,platform;
```

Typical terminal codes include `MEDIA_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `VIDEO_DURATION_UNSUPPORTED`, `FILE_OUTSIDE_INBOX`, and `DRIVE_HTTP_403`. Known Gemini configuration failures are classified as `GEMINI_KEY_BLOCKED`, `GEMINI_KEY_INVALID`, `GEMINI_KEY_RESTRICTED`, `GEMINI_API_DISABLED`, `GEMINI_BILLING_REQUIRED`, `GEMINI_REGION_UNSUPPORTED`, or `GEMINI_MODEL_ACCESS_DENIED`, or `GEMINI_PROJECT_ACCESS_DENIED`; unknown responses retain a safe HTTP status code. Known provider messages are reduced to codes; an unclassified HTTP 403 may include the bounded, redacted denial detail described above.

To pause drafting, set `SOCIAL_AI_ENABLED=false` while leaving intake enabled. No code rollback or schema deletion is needed. Do not delete completed jobs to regenerate drafts: that can destroy idempotency. After fixing a terminal configuration issue, explicitly requeue only the affected untouched item, preserving its attempts count; verify its caption/metadata/targets have not been edited. Items already at three attempts need a deliberate operator decision before increasing their retry budget. No public administrative endpoint has been introduced.

## Next phase

Once actual Gemini generation succeeds on production media, the next product task is a review interface showing the original asset, AI summary, platform drafts and failures. It should let a human edit, approve or reject drafts with optimistic concurrency. Publishing adapters remain a separate, explicitly authorized phase.

References: [Gemini generation API](https://ai.google.dev/api/generate-content), [image inputs](https://ai.google.dev/gemini-api/docs/image-understanding), [video inputs](https://ai.google.dev/gemini-api/docs/video-understanding), [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/).
