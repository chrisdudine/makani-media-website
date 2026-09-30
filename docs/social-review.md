# Social review interface

Implemented on PR #24, September 30, 2026 UTC. No production deployment or merge performed for this phase.

Open /api/social-review on an isolated Worker preview with a configured ADMIN_API_KEY and D1 binding. The shell is public; every draft read and edit requires X-Admin-Key. The key is held only in tab memory, never URL parameters, cookies or local storage. Sign-out clears the key and displayed drafts. This is a single-operator shared-key interface, not named-user identity or an audit log of individual reviewers. Use only with trusted administrators who already possess the existing admin credential; do not distribute it to additional reviewers.

The screen lists review-state content, AI observations and review notes, with separate editable Instagram, LinkedIn and Google Business Profile captions. The original import filename is labeled as such; the Google Drive link and optional preview use the immutable file ID, so renames do not duplicate or overwrite content. Preview requires the reviewer's own authorized Google Drive session. No Drive sharing permissions change.

Save draft always returns that target to draft. Approve copy records approved only for the submitted caption. Return to draft revokes approval. One atomic compare-and-swap rejects stale revisions and simultaneous conflicting edits. Published/scheduled/processing content cannot be edited through these routes. Content remains in review and AI metadata retains human-approval requirements. No scheduling, sending, publishing or AI generation function is exposed.

Security: constant-time digest comparison in workerd, same-origin restriction, no CORS grant, no-store responses, restrictive CSP, text-only rendering of untrusted captions/notes, bounded JSON input, platform caption limits, parameterized SQL, generic errors. Booking and Calendar paths delegate unchanged to their existing handler. No migration required.

Validation: 56 regression tests pass; isolated workerd/D1 social review integration passes authentication, wrong key, origin rejection, list/read, concurrency conflict, approval, edit invalidation, revocation, caption limits, rejected publish/schedule fields, protected content and zero outbound calls. Existing workerd/D1 AI claim/persistence/idempotency test passes. Chrome local fixture check passed sign-in, caption approval, edit-to-draft and visual layout inspection. All fixtures and approval actions were local; production drafts were not edited or approved.

Production remains on the paused Worker 7668722f-8cc9-4fd8-8f70-297153c40a24 from the controlled logo test. No production launch gates enabled; no additional paid Gemini test, secret change, migration, publication, outreach or customer action. PR #23 remains unmerged and CRM live actions remain off.

Next: review this PR's code and preview in an isolated environment with a test admin key and test D1. Before production rollout, confirm access via the existing trusted admin credential and separately authorize deployment/review operations. Keep publishing and ongoing AI disabled. Marketing-caption prompt refinement and any further paid quality test remain separate work; existing logo captions are editable here but have not been regenerated.

