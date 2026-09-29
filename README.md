# Visual Scraper

Visual Scraper is a local-first browser extension for teaching a scraper by clicking example fields. It infers repeated records, previews the table, follows common pagination patterns, and exports JSON, CSV, or XLSX. A separate Crawlee/Playwright worker can execute the same versioned scraper definition.

## Status and scope

This is a private pilot MVP. The Chromium fixture suite covers visual training, a 20-record preview, three-page extraction, saved reruns after a DOM change, exports, Load More, infinite scrolling, SPA routes, and numbered pages. The worker parity check covers the same 60-record definition. See [testing](docs/TESTING.md) and [known limits](#known-limitations).

## Architecture

The extension's content script hosts an isolated picker and inspector. It fingerprints selected elements, infers a repeated record container, and saves a portable `ScraperDefinition`. The shared DOM engine extracts fields and detects navigation; `RunController` handles limits, deduplication, and checkpoints. The extension stores definitions in `browser.storage.local` and records/checkpoints in IndexedDB. The worker uses the same definition and browser engine, with Crawlee for browser lifecycle and SQLite for records/checkpoints. See [architecture](docs/ARCHITECTURE.md) and [schema](docs/SCRAPER_SCHEMA.md).

## Requirements and setup

- Node.js 22 or newer, pnpm 12.6, and a Chromium browser for the browser suite.
- `pnpm install`
- `pnpm build` builds Chromium MV3, Firefox MV3, and the worker.
- `pnpm dev:sites` starts the local fixture site at `http://127.0.0.1:5173/`.
- `pnpm dev:extension` starts WXT development mode.

For an unpacked Chromium build, visit `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `apps/extension/.output/chrome-mv3`. On Linux, `.output` is a hidden folder: press **Ctrl+L** in the folder picker and paste the full path to `chrome-mv3`, or press **Ctrl+H** to show hidden folders. Select the `chrome-mv3` folder, which contains `manifest.json`. Open a normal HTTP(S) page, click the extension icon, and grant access to that site's origin. For Firefox, build with `pnpm --filter @visual-scraper/extension build:firefox`, then use `about:debugging` → **This Firefox** → **Load Temporary Add-on**, selecting the Firefox build's `manifest.json`. Temporary add-ons disappear when Firefox exits. Firefox MV3 support should be validated on the intended release version before distribution.

## Create and run a scraper

1. Open a list page and click **Start scraper** in the extension popup.
2. Click **Add field**, choose a visible example, confirm the picker, and name it. Repeat for the fields you need.
3. Review the inferred record count and preview. Select the record container manually if inference is ambiguous. Review or override the pagination mode.
4. Click **Save** to keep the definition, then **Start scraping**. The run shows pages, records, duplicates, and selector recoveries.
5. Open **View and export results** and download JSON, CSV, or XLSX.
6. On a later visit, open the extension, choose a saved scraper, review its preview, and run it again.

The extension extracts in the active browser session. The worker uses its **own** local browser profile and needs a separate manual sign-in for protected sites.

Selector recoveries are listed in the results page with the original selector, replacement, confidence, and time. A repeated field change is counted once per run. The recovery fixtures cover both renamed fields and a changed record tag and class. CSV and XLSX keep inferred numeric and boolean values as typed values and protect text that spreadsheet software might interpret as a formula.

## Worker

Build with `pnpm --filter @visual-scraper/worker build`. In the extension results page, click **Download definition** to get the portable version 1 JSON, then run:

```sh
node apps/worker/dist/cli.js validate definition.json
node apps/worker/dist/cli.js login --profile shop --url https://example.com/
node apps/worker/dist/cli.js run definition.json --profile shop
node apps/worker/dist/cli.js resume RUN_ID
node apps/worker/dist/cli.js export RUN_ID --format csv
```

The worker writes `worker-data/runs.sqlite`; profiles live in `browser-profiles/`. Both are ignored by Git. For automated fixture parity, start the fixture server on port 4173, build the worker, and run `node apps/test-sites/worker-e2e.mjs`.

## Development checks

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm test:e2e:chromium
pnpm test:parity
pnpm check:release
```

Repository instructions are in [AGENTS.md](AGENTS.md), with scoped instructions in `apps/` and `packages/`. Focused project workflows are in `.agents/skills/`; optional specialist profiles are in `.codex/agents/`. They are development aids, not runtime dependencies.

## Privacy and permissions

The extension sends no page content to a server and includes no analytics or AI service. Definitions contain selectors and bounded fingerprints; datasets remain local. The popup requests access to the active website origin when the user starts scraping. Manifest permissions: `storage` for definitions, `scripting` for user-triggered injection, `tabs` for activation and navigation recovery, and `activeTab` for the current page. Optional HTTP(S) host access supports multi-page runs. Details are in [privacy and permissions](docs/PRIVACY.md).

## Known limitations

- Closed shadow roots cannot be inspected. Same-origin frames are represented in locators, but cross-origin frame messaging is not implemented.
- Infinite-scroll detection is heuristic. A long static list may be probed up to the configured no-progress limit. Virtualized lists need more fixture coverage.
- The UI exposes record and field selector edits with match highlighting, record and navigation overrides, and run limits. It does not yet provide a per-record exclusion tool or detailed event log viewer.
- Worker resume uses an idempotent dataset, but recovery after a process exit during an unconfirmed navigation action still needs a stronger action receipt protocol.
- Sites that block script injection through CSP or other restrictions may prevent worker execution. Access challenges pause ordinary scraping; no bypass is included.
- Firefox automated coverage currently checks one-field training and a three-page run. Exports, saved reruns, and alternate navigation modes are covered in Chromium and need Firefox-specific coverage before wider distribution.

## Open source

The picker, its protocol, and some extension infrastructure derive from [OpenPicker](https://github.com/usertour/openpicker), MIT licensed. Selector generation uses [`@medv/finder`](https://github.com/antonmedv/finder). The rule induction is an independent TypeScript implementation informed by [AutoScraper](https://github.com/alirezamika/autoscraper); no AutoScraper code was copied. Crawlee and Playwright run worker jobs. See [third-party notices](THIRD_PARTY_NOTICES.md).
