# Cleanup validation

Baseline: `c547b7e9e387469b20502806201b07165ee7ccf8` (current `main` when the cleanup was restarted).
Review branch: `codex/website-code-cleanup`.

## Scope

The branch was reset to the baseline before rebuilding. Page CSS was extracted with every declaration and its order preserved. Form and calendar JavaScript and the Worker were only formatted. Mobile-menu logic is shared while the original page breakpoints and navigation markup are retained. The embedded homepage PNG was extracted without re-encoding. Two obsolete one-time CTA-rewrite workflows were removed; their prior versions remain recoverable in Git history. The production deployment workflow, Wrangler configurations, and D1 migrations are unchanged.

## Required checks

- Parse and inspect every HTML, CSS, JS, JSON, and Markdown source file; reject empty, corrupt, or unexpectedly identical files.
- Compare page markup, text, links, stylesheet declarations, form/calendar logic, image bytes, and backend configuration against the baseline.
- Compare Worker responses and SQL calls for routing, validation, successful submissions, and database failure.
- Run browser comparisons across all pages and seven widths, including all form/calendar states. No failing state is omitted from comparison.
- Match every uploaded blob SHA and the complete remote Git tree to the tested local tree before updating the review branch.

## Observed results

- `pnpm install --frozen-lockfile`: passed.
- `pnpm format:check` and `git diff --check`: passed.
- `pnpm test`: all 17 source-integrity and Worker tests passed. Every project HTML, CSS, JS/MJS, JSON, and Markdown file was decoded as UTF-8, parsed, and checked for corruption and unexpected duplicate content.
- Browser regression: all 28 complete page/viewport comparisons passed against the untouched baseline. Widths: 390, 620, 720, 850, 1050, 1100, and 1440 pixels. Captured text, attributes, values, geometry, computed styles, API payloads, and all tested interactive states matched.
- Screenshot comparisons: all four desktop pages at 1440px matched byte-for-byte; mobile pricing, its open menu, both forms, and the homepage viewport at 390px also matched. Full-page screenshots can contain capture/stitching artifacts; DOM geometry and computed-style checks independently cover the entire pages.
- Both original SQL migrations applied successfully to a fresh local SQLite database, producing contacts, projects, ai_activity, and consultations tables.
- Original form/calendar/Worker logic, public markup, image bytes, production deployment workflow, database migrations, and Wrangler configuration match the baseline under the documented source comparisons.

Tests use local fixtures and mocked submissions; no production data, email, calendar, or payment actions are performed. This verifies the checked-in behavior, not live external provider availability. Future integrations remain unimplemented. The review branch must pass the per-blob and complete-tree hash checks above before publication; `main` must remain untouched.
