# ATLASZ V7.3 — Security protection matrix (zero-trust, defence in depth)

Status words: **IMPLEMENTED** (code exists) · **RUNTIME_ENFORCED** (the running Control Center/broker enforces it on the real call path, independent of any AI) · **TESTED** (an automated test attacks it; file named) · **BLOCKED** (cannot be completed here; reason given).
Nothing here claims the system is unhackable or that all malware is detected. A pass means "tested locally against these attacks".

| # | Protection | Implemented | Runtime-enforced | Tested | Evidence / blocker |
|---|---|---|---|---|---|
| 1 | Secrets only in encrypted vault; scoped `get(name,{purpose})`; no value in views | yes | yes | yes | `m1-vault-broker`, `control-center-vault-chat`, `security-adversarial` EXFIL 4 |
| 2 | Tool output/error redaction before the agent, audit or signal sees it (incl. truncated preview) | yes | yes | yes | `security-adversarial` EXFIL 1–3, 5 (defect SEC-001/002 found+fixed) |
| 3 | Outbound secret transmission: egress deny-by-default, exact hosts, signed policy, commit leak gate | yes | yes | yes | `egress-policy.test`, `provider-egress.test` |
| 4 | Secret scanning: tracked files (gate) + whole Git history + commit messages | yes | gate | yes | `repo-secret-scan.test`, `scripts/secret-history-scan.mjs` → 0 non-synthetic hits |
| 5 | Leak response: revoke → rotate → contain → assess → clear | doc | n/a | n/a | `docs/SECURITY_LEAK_RESPONSE.md` (revocation is an owner action at each provider) |
| 6 | Scoped permissions per agent (deny-by-default matrix 30×34, frozen policy, 31st agent refused) | yes | yes | yes | `agent-tool-broker.test`, `security-adversarial` ESCALATION 1–2 |
| 7 | Agents cannot grant themselves permissions; D12 extension needs owner-signed approval bound to its SHA | yes | yes | yes | `security-adversarial` ESCALATION 3; D12 inactive by default |
| 8 | Untrusted content separated from instructions: tool results marked `untrusted`, args schema-strict, no approval/tenant/role fields accepted | yes | yes | yes | `security-adversarial` PROMPT INJECTION 1–2 |
| 9 | Repeated bypass attempts → job suspended + BYPASS_ATTEMPT signal → incident | yes | yes | yes | PROMPT INJECTION 3; `module-registrations` (hosted escalation) |
| 10 | Policy enforcement before every sensitive tool call (control chain: owner authority → kill switch → safe mode → security brain → financial firewall → approval) | yes | yes | yes | `owner-control` tests, `agent-tool-broker.test` |
| 11 | Sandboxed execution (code sandbox confined, timeout/size caps) | yes | yes | yes | `agent-tools-hosted.test` (sandbox.run caps) |
| 12 | Incident containment: block operation, isolate agent, suspend tasks, preserve redacted evidence, alert owner; clearance = signed single-use approval | yes | yes (broker + intake release) | yes | `incident-response.test`, ESCALATION 4, RESTART |
| 13 | Emergency stop / safe mode honoured by broker, intake release, egress; survives restart; file tampering does not resume | yes | yes | yes | `emergency-stop.test`, `agent-tool-broker.test`, EMERGENCY STOP |
| 14 | Untrusted file intake: isolated quarantine, type/size/content validation, zip-slip & disguised-executable blocking, never executed, never reachable by privileged tools, release only via owner approval | yes | yes | yes | `file-intake.test` |
| 15 | **Malware detection by an established engine** (ClamAV / Windows Defender adapter; no homemade AV) | adapter | yes (fail-closed HELD) | adapter only (stub engines) | **BLOCKED for real detection here**: no engine in this sandbox; on the owner's Windows PC Defender is used, elsewhere install ClamAV. Without an engine every file stays HELD, never "clean". |
| 16 | Agent supervision in Master/Control Center: task, tools used, model, cost, errors, security warnings, blocks, recovery | yes | yes | yes | `module-registrations` (supervision), page "Security & Supervision" |
| 17 | Verified webhooks: HMAC signature, 300 s tolerance, raw-body exact, persistent dedupe, CONFLICT on same id/different body, test/live separation | yes | yes (in-process ingest) | yes | `payment-events.test`, FINANCE 2 |
| 18 | Payment states kept apart (initiated/pending/succeeded/failed/refund/dispute/payout); payout ≠ bank receipt without owner-authorised evidence; net revenue UNKNOWN while fees unknown | yes | yes | yes | `payment-events.test` |
| 19 | No money movement without authorisation: ledger is receive-only; no agent tool reaches money/payment/CRM/send | yes | yes | yes | FINANCE 1, `payment-events.test` (no money-moving API) |
| 20 | Stripe live operation | mechanism | no | mechanism | **BLOCKED**: no webhook secret, no account; waiting for the owner's approved integration package |
| 21 | Durable checkpoints, safe retries, duplicate prevention, task recovery after crash/restart | yes | yes | yes | `brain-failure-modes`, `master-coordinator`, `tick-loop`, RESTART |
| 22 | Master / Brain failure: fail closed, no model reasoning when unavailable | yes | yes | yes | `brain-failure-modes.test` |
| 23 | Encrypted portable backup (AES-256-GCM, scrypt), tamper/wrong-passphrase failure, restore only into empty targets, isolated restoration rehearsal | yes | n/a | yes | `portable-backup.test` · **BLOCKED**: rehearsal on a physical USB/SSD needs the owner's device |
| 24 | Owner key provisioning outside the repo, passphrase-encrypted | yes | yes | yes | `repo-secret-scan.test` · **BLOCKED**: owner has not provisioned the key yet |

## Remaining security gaps (honest)
- SEC-GAP-1: egress decisions are audited per provider, not attributed to an agent, so "suspicious network activity" is not yet shown per agent.
- SEC-GAP-2: containment covers call paths that consult the incident module; any future agent-reachable path must be wired to it.
- SEC-GAP-3: scanner signature freshness is the engine's responsibility; ATLASZ does not check it.
- SEC-GAP-4: no external penetration test; the adversarial suite covers known attack classes only.
- Pattern-based redaction/scanning cannot recognise unknown credential formats or secrets split over several fields.
- Restoring a backup does not restore external accounts (AI providers, GitHub, Stripe); those need renewed authentication.
- Owner-side actions required: provision the owner key, install/run a malware engine, provide `ATLASZ_VAULT_KEY` and provider credentials, rotate on any exposure.
