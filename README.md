# Makani Media website

Four static pages with a separate Cloudflare Worker and D1 database. Production pages require no frontend framework, package installation, or build step.

## Source layout

- `index.html`, `pricing.html`, `book-shoot.html`, `schedule-consultation.html`: existing public URLs, content, links, and form markup.
- `assets/css/`: one readable stylesheet per page. The original declarations and cascade order are preserved, including page-specific breakpoints and overrides.
- `assets/js/mobile-menu.js`: shared menu controller. Its script tag supplies the original page breakpoint through `data-breakpoint`.
- `assets/js/book-shoot.js`, `assets/js/schedule-consultation.js`: original form and calendar logic, formatted for readability. Scripts execute in order at the end of the document.
- `assets/images/hero-logo.png`: original homepage PNG, extracted byte-for-byte so it can be cached independently.
- `worker/src/index.js`: existing request validation and persistence handler.
- `worker/migrations/`: existing ordered schema migrations.
- `tests/`: source-integrity, behavior-contract, and browser comparison checks.

Navigation markup stays in each HTML page because the pages intentionally have different links, labels, and breakpoints. The two forms retain their distinct fields and reset behavior. Page styles are not combined across pages where doing so could alter selector precedence.

## Development and validation

Use Node.js 22+ and pnpm. Run `pnpm install --frozen-lockfile` to install development-only formatting tools. Preview the public pages with any static server.

- `pnpm format` formats the source; HTML whitespace sensitivity is strict.
- `pnpm format:check` checks formatting without modifying files.
- `pnpm test` parses every HTML/CSS/JS/JSON/Markdown file, rejects duplicate or corrupt source, checks the preserved page contracts and assets, and compares Worker responses and database calls.
- `pnpm test:browser` starts a local comparison server. Open its printed address to compare the original and refactored pages at seven desktop/mobile widths. A final `PASS` is required; starting the server alone is not a test result.

Set `BASELINE_DIR` to an untouched checkout of the baseline commit. It defaults to `../baseline`. For this cleanup, the baseline is `c547b7e9e387469b20502806201b07165ee7ccf8`:

```sh
git worktree add --detach ../baseline c547b7e9e387469b20502806201b07165ee7ccf8
```

The browser runner uses frozen time and intercepted API requests. It checks every captured state, including mobile menus, sticky headers, calendar selection and fallback, filled forms, request errors, pending requests, success resets, and missing-date feedback. It never submits to production. Results are saved outside the repository by default; set `TEST_OUTPUT` to change that location. The optional `?page=book-shoot.html&width=390` query isolates one comparison.

Production deployment remains configured from `main`; this branch is for review only. Both existing Wrangler configurations and the Pages workflow are preserved. See [integration boundaries](docs/integrations.md) and [validation results](docs/cleanup-validation.md).
