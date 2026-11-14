# Mobile browser tests

Install dependencies with `pnpm install --frozen-lockfile`, then install the browser
engines and Linux libraries with `pnpm exec playwright install --with-deps chromium webkit`.
Run `just test-e2e` or `pnpm run test:e2e`. To run one engine, use
`pnpm run test:e2e --project=android-chromium` or `--project=ios-webkit`.

The suite builds Astro, applies migrations to disposable local D1 state under
`.wrangler/e2e`, and starts Pages on `127.0.0.1:8793`. That state is deleted on
each run. No remote database or Cloudflare account credentials are used. The
public `snaptally-e2e-only` bearer token exists only for the local fixture.
Do not run two copies of this suite in the same checkout at once. The server
will refuse to reuse a listener already occupying its port.

Each test gets a fresh browser context with independent localStorage, IndexedDB
and cache storage. Transaction names and IDs are unique across concurrent tests;
the server database is shared only for that invocation. Offline tests read the
actual IndexedDB outbox and verify the same ID exactly once through the real
local transaction API after reconnection.

Both mobile profiles cover the keypad, custom cards, authenticated saves,
settings persistence, manifest metadata and offline queue recovery. The profiles
use Android Chromium at 412x915 and iOS WebKit at 390x844. These are emulated
browser engines, not physical device or standalone iOS installation tests.
Service-worker activation, cache inspection and offline shell reload run in
Chromium because Playwright's service-worker automation is Chromium-specific.

The dedicated e2e workflow runs without repository secrets and uploads its HTML
report, screenshots and retained failure traces for seven days. Open the local
report with `pnpm exec playwright show-report` or inspect a trace with
`pnpm exec playwright show-trace path/to/trace.zip`.
