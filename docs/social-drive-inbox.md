# Google Drive Social Media Inbox

The existing `makani-media-api` Worker scans the direct children of Drive folder
`16M72Ioa-KtWd0jpbx_Gqee42NHtbqIXO` every five minutes. It uses the existing
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` secrets,
with Drive read-only access in addition to the existing Calendar permissions.

Only non-trashed files with an `image/*` or `video/*` MIME type are ingested.
Subfolders, shortcuts, and other file types are ignored. Only metadata is read.
New D1 `social_content` rows have `source_provider='google-drive'`, the Drive ID
and name, `media_type='image'` or `'video'`, and `workflow_state='inbox'`.

Apply `0005_social_drive_inbox_unique.sql` to the existing production database
before deploying. Its unique index prevents duplicate Drive file IDs, including
overlapping scans. Existing rows, captions, workflow states, names, and timestamps
are never overwritten on repeat scans. A partially completed scan can safely retry
on the next scheduled run. The migration fails rather than deleting any duplicates.

The scheduled handler logs `social_drive_inbox` with scanned, inserted, existing,
skipped, and page counts. Failures are logged as `social_drive_inbox_failed` and
fail the scheduled invocation. OAuth secrets and tokens are never logged.

All HTTP requests continue through the unchanged booking handler. This intake
does not implement AI analysis, media processing, review, or publishing.

Run intake regression tests with `node --test tests/social-drive-inbox.test.mjs`.
