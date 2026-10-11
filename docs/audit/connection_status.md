# Connection status ledger (evidence-based; IMPLEMENTED != CONNECTED != TESTED != LIVE)

| Module | Connected to | Test evidence | LIVE? | Next |
|---|---|---|---|---|
| model-registry + model-routing-bridge | gateway/provider-resilience, provider-egress, egress-policy, billing guard, Control Center "Models & Providers" | model-routing-bridge.test, control-center-model-registry.test (real HTTP) | NO - only a passing real probe makes a model LIVE; only the loopback Ollama adapter exists | cloud provider adapters (Phase 4), owner egress approval |
| quarantine (prescan + store) | Document Center ingest; Security Center panel (list/verify/signed release/delete) | document-center-quarantine.test, control-center-security.test | n/a (no malware scanner chosen: BLOCKED_NO_SCANNER_CHOSEN) | inbox/downloads intake; scanner choice |
| release-signing | local-update-adapters stager (verify before staging, optional requireSignature); trust anchors via Security Center (owner-signed) | local-update-signing.test, control-center-security.test | NO - no real publisher key/anchor yet | owner provides publisher key; install-time `accept` (replay/downgrade history) |
| ransomware canary monitor | NOT connected | quarantine.test (unit) | NO | start from supervisor |
| commit leak gate | NOT connected to hooks/CI | security-gates.test | NO | pre-commit hook |
| browser extension API | NOT connected | browser-extension-guard.test | NO | origin allowance + extension id |
| supervisor-safe documents | NOT using quarantine (two processes must not append one audit chain) | - | NO | single-writer design |
