# ATLASZ Windows Control Center

Real desktop app (Electron shell + local token-protected server + UI). Owner functions in the GUI = the same code the Owner CLI/tests use (`atlasz-control-center/core.mjs`).

| Panel | Status |
|---|---|
| System status, 5 SEARCH + 25 EXECUTION agents, jobs, Money Engine (read-only, honest), approvals history, provider health, errors/blockers | BUILT, tested via HTTP + headless browser |
| Owner Controls: create owner key (passphrase-encrypted), PAUSE ALL / STOP EXTERNAL / Resume (typed RESUME), Leave Safe Mode | BUILT, tested (incl. real runtime process halted) |
| Backup / restore / last known good, recovery drill | BUILT, tested |
| System Doctor | BUILT, tested |
| Update Center (Check / Test / Safe Update / Rollback / Safe Automatic Updates / Unfreeze) | UI + core BUILT; **no real detector/stager/tester adapters yet** -> fails closed, shows BLOCKED |
| Speak-to-Speak / Live Voice | NOT BUILT (placeholder panel says so) |
| Windows installer (.exe, desktop icon) | Config + CI workflow written; **NOT built or run on Windows** (see below) |

## Honest limits
- The npm registry in the development sandbox refuses `electron` / `electron-builder` (HTTP 403), so the installer was **not built here** and the Electron shell was **not executed**. The UI/server/core run under plain Node and were exercised in headless Chromium.
- Build the installer: GitHub Actions workflow `build-windows-installer` (needs the branch pushed), or on a Windows PC: `cd atlasz-control-center && npm run dist:win`.
- Interim without installer: `launcher/ATLASZ-Control-Center.cmd` (needs Node 20+); opens the Control Center in the browser.
- The Control Center manages a **local** runtime (`start:canonical`). Controlling a runtime on Railway needs an authenticated owner API on the runtime = production change = separate JOCI APPROVAL.
- Passphrase-encrypted key protects against a stolen key file, not against malware running as the user.
- Closing the app stops the runtime it started; a 24/7 Windows service/auto-start is not built.
