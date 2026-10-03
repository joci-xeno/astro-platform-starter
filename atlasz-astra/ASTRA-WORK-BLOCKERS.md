# ATLASZ — ASTRA / WORK BLOCKERS

This file contains only work that cannot honestly be completed or proven from the current environment. Astra/Work should execute these against the real runtime/desktop and report evidence. Never mark LIVE without a successful test.

## 1. Railway latest-branch deployment
- Force atlasz-30-workers to build the current atlasz-30-runtime HEAD, not an old deployment snapshot.
- Root directory: /
- Start command: node atlasz-runtime/supervisor-safe.mjs
- Verify the supervisor imports ../atlasz-addons/internal-integration-hub.mjs.
- Prove /health and runtime status after deployment.
- Do not delete or rebuild working sibling services.

## 2. Computer Use provider
- Attach a real sandboxed browser/desktop Computer Use provider to createComputerUseFabric().
- Preserve JOCI > MASTER > AGENT > TOOL authority.
- AUTO normal approved work; ASK_JOCI for spending/purchases/subscriptions/contracts/payments/banking/account-security and sensitive external publishing/deletion.
- FORBIDDEN: bypass owner authority, exfiltrate secrets, disable audit.
- Test click/type/scroll/browser navigation in a sandbox before LIVE.

## 3. Real tool adapters
Use toolBridgeAttach() so each tested provider is registered consistently in Universal Connector Layer, Tool Fabric and Executor Toolbox.
Priority: web/browser, files, code/test, GitHub, research, email, CRM/database, deploy/logs, spreadsheets/documents, cloud drive, voice.
Do not mark a tool available merely because an account/plugin exists.

## 4. Voice
Attach real STT and TTS providers to voice-interface.mjs and test microphone -> STT -> MASTER -> TTS. Voice must not bypass owner approval.

## 5. Model providers
Connect configured model providers through a router without exposing keys. Presence of an environment variable is not a successful model test. Record cost and errors.

## 6. Outreach
Inspect deployed outreach executor. Prove whether AgentMail actually accepts sends. QUEUED_FOR_SEND is not SENT. Verify ATLASZ_WORKER_URL points to the intended healthy worker.

## 7. End-to-end validation
Run syntax/import tests, Integration Hub startup, 30-agent status, Tool Fabric/Computer Use status, and a dry-run workflow. Then perform real external actions only under the existing approval rules.
