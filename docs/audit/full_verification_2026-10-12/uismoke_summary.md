# ATLASZ Control Center UI smoke (read-only)

## Launch
- `node atlasz-control-center/server.mjs` (the launcher ATLASZ-Control-Center.cmd runs the same thing). Binds 127.0.0.1 only, random port (ATLASZ_CC_PORT=0), per-launch random token printed as `http://127.0.0.1:PORT/#TOKEN`.
- Env used: ATLASZ_HOME=$S/home, HOME=$S/home, ATLASZ_TEST_MODE=1, ATLASZ_OPEN_BROWSER=0, ATLASZ_RUNTIME_PORT=18931, ATLASZ_TRADING_TICK_MS=0. Runtime (POST /api/runtime/start) was never started.
- Client: reads token from URL hash -> sessionStorage -> `x-atlasz-token` header on every /api call. POSTs are JSON with same-origin Origin. Host allow-list (127.0.0.1/localhost:port), CSP default-src 'self'.
- Chromium 1194 via Playwright (/opt/node-tools), headless, no external requests observed (0).

## Result
- 61 views (NAMES list in app.js, all clicked via nav buttons). 60 load with no console error, JS exception or 4xx/5xx. 1 fails.
- FAIL: **Security & Supervision** (`views.supervision`, app.js line ~833). `/api/agents/supervision` returns `notes` as an OBJECT ({suspiciousNetworkActivity, modelUsage}); client does `(sv.notes ?? []).map(...)` -> TypeError, view shows only "Error: ... .map is not a function". Server API is 200; this is a client/server contract bug. Screenshot: shots/supervision.png.
- No console errors, no page errors, no HTTP >=400 during any view navigation (the only 401/404 in the log came from my deliberate negative probes).
- Honest-state labels: LIVE appears in 16 views (mostly "LIVE - server state synchronised" banner of the SSE state stream, not data claims), SIMULATED in 3 (trading/business), UNAVAILABLE in 5 (e.g. live market data provider), UNKNOWN in 7 (coordination ledger not found, runtime not running), NOT_CONNECTED in 15 (brain_* views: no Brain state because runtime never ran), empty tables "Nothing to show" in 30. Notes shown in red (note.bad) but not errors: Operations, Live Agent Activity (COORDINATION_LEDGER_NOT_FOUND), Trading (no live data provider).
- Fresh empty state (no runtime): Home brief says runtime not running; Overview RUNTIME NOT_RUNNING; Vault LOCKED (no host key); Voice BLOCKED; Connectors live 0/12; Tech Watch NO_FEED; Recovery NOT_RECOVERABLE.

## API
- 55 GET routes in the route table + /api/live + /api/stream, with token: all 200 except `/api/trading/candles` (400 DATASET_NOT_FOUND without dataset param: expected).
- Negative checks: no token 401, bad token 401, POST wrong Origin 403 (Node-level), POST text/plain 415, POST no token 401, GET on POST-only route 404.
- ~75 POST routes (state-changing: approvals, runtime start/stop, backup/restore, updates, plugins, trading actions, chat...) were NOT called on purpose. Browser POSTs observed: 8x /api/workbench/action (read-only list ops fired by Projects view on load) and 1x /api/prefs with `{}` body (my own in-page probe; harmless, in temp state).
- Note: GET /api/brief uses `markShown:true` (opening Home marks the brief as shown) - a mild write on a GET.

## Windows / Electron (code only, not testable here)
- electron/main.mjs: single-instance lock, starts the same createControlCenterServer on 127.0.0.1:0 inside the Electron main process, BrowserWindow 1320x860 (contextIsolation, no nodeIntegration, sandbox), loads the token URL, window-open denied, will-navigate only allows same origin (https externals go to shell.openExternal), menu removed, graceful cc.close() on quit. State in %APPDATA%/ATLASZ. Note: unlike server.mjs direct launch, Electron boot does not pass schedulerMs/tradingTickMs (defaults 0).
- Cannot verify here: Electron binary/window rendering, installer (electron-builder NSIS, scripts/stage-win.mjs), Windows paths (APPDATA), cmd launcher, ELECTRON_RUN_AS_NODE runtime spawn, firewall prompts, shell.openExternal. Chromium rendering of the same UI is a close but not identical proxy.

## Files
- uismoke_report.json (per view: view, title, route, loads, consoleErrors, httpErrors, shows, labels, note; plus apiSweep, csrfChecks, externalRequests), shots/*.png (61 screenshots), server.log. Server stopped, no leftover processes. Repo untouched.
