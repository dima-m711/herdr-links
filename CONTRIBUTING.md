# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Development setup

Requirements:

- Node.js 20 or newer
- npm
- Python 3.11 or newer for the compatibility-reference tests
- macOS and Herdr for live integration checks

Install locked dependencies and run the validation suite:

```bash
npm ci
npm test
npm run build
npm run check:package
npm run check:github-install
npm run check:public-content
npm run check:public-history
```

Build before linking a local checkout:

```bash
npm run build
./bin/herdr-links install
```

Use `./bin/herdr-links uninstall` when finished. Local install/uninstall edits one managed Pi instruction block and one local Herdr registration; inspect reported rollback errors rather than retrying blindly.

## Pull requests

Keep changes narrowly scoped and include tests for behavior changes. Navigation and installation code must fail closed when identity, ownership, provenance, or response data is ambiguous.

Do not commit:

- generated `dist/` or `.test-dist/` output
- dependency directories
- credentials or npm tokens
- live socket paths or fingerprints
- pane, tab, workspace, or agent identifiers from real sessions
- raw plugin logs or verification receipts
- machine-specific absolute paths

Place temporary live-test output outside the repository.

## Runtime changes

The TypeScript implementation under `src/` is the only runtime. Python under `reference/python/` exists only for compatibility checks and must never become a fallback.

Changes that add a supported Herdr release or protocol pair require source review, automated coverage, and live focus verification. Changes to manifest build commands must also pass `npm run check:github-install` from a clean checkout.

## Reporting vulnerabilities

Follow [SECURITY.md](SECURITY.md). Do not open a public issue for a suspected vulnerability.
