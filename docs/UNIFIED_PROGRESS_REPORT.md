# ATLASZ V7.3 — Unified Programme Progress Report

Branch `atlasz-v73-integration`. Maintained per owner directive §10. **No count below is inflated:** the 85 / 23 / 150 / Global Business classifications are the historical audit values; a milestone only moves an item when its acceptance criteria are independently met and the owner has confirmed VERIFIED_WORKING (never claimed by Claude alone).

## 1. Status by package (historical baseline; unchanged by M1)

| Package | Covered / Verified | Partial | Missing | External blocker |
|---|---:|---:|---:|---:|
| Original 85 | 18 | 44 | 1 | 22 |
| Security 23 | 1 | 16 | 6 | 0 |
| Additional 150 | 6 | 98 | 30 | 16 |
| Global Business Intelligence | planning only — no implementation started | | | |

## 2. Milestone log

### M1 — Secret vault completion + credential broker (security/infrastructure, priority A)
- **Implemented:** vault lock/unlock with failure throttling, opt-in idle lock, revoke tombstones, emergency shutdown that survives restart (owner-approved resume only), encrypted backup package (scrypt + AES-256-GCM, header as AAD, content-bound restore approval, revoked credentials not revived without a separate approval subject), encrypted audit anchor (truncated/replaced audit log keeps the vault locked), stale-file-copy detection bound to ciphertext hashes. Credential broker: agents never receive a raw secret; owner-signed per-grant approvals; exact HTTPS hosts/paths/methods; rate limits; kill-switch gate; audit-before-send; response redaction in common encodings; cross-instance grant reload. Owner-auth nonce store now checks-and-appends under a file lock (cross-process replay).
- **Tests:** `atlasz-tests/m1-vault-broker.test.mjs` (35), `atlasz-tests/m1-round2.test.mjs` (11). Synthetic secrets and a fake fetch only; no network. Full regression suite 1136/1136 passing, 52/52 independent probes, mutation checks on the new guards (survivors equivalent: crash-window `ever` guard, `wx` open after unlink, unlocked-persist guard in single-process runs), secret scan of the diff clean.
- **Independent verification:** round 1 (14 findings, fixed in 21ede48); round 2 (3 HIGH, 5 MEDIUM, ~10 LOW; fixes in this commit). A round-3 narrow check is still recommended before any claim beyond PARTIAL.
- **Requirement movement:** 23-point #1 (vault) and #3 (broker) advance but **remain PARTIAL**. No 85/150 classification changes.
- **Not done / honest gaps:** no Control Center panel; idle lock off by default; no provider-side secret rotation; broker is not wired as an agent tool (agent-tool-policy denies unlisted tools); audit chains are unkeyed sha256 (tamper-evident, not tamper-proof); redaction covers common encodings only; a rolled-back audit log bricks the vault until recovery from a backup (fail-closed by design).

## 3. Cross-package dependencies
Vault + broker are prerequisites for: Global Business source adapters needing API keys (GB), provider connectivity diagnostics (E), chat integrations (G), PKG150 GR/MR web-research items, payment-adjacent workflows (still gated by Financial Firewall + owner approval).

## 4. Security risks (open)
Python sandbox `.so` escape (unresolved); Windows plugin isolation is permission-model only; M01 browser extension not built; A13 heuristic; unkeyed audit chains; round-15 LOW items (timeout-only launch level, selftest overshoot, `maxLifetimeSec` non-number handling).

## 5. Owner decisions / approvals outstanding
Provider selection and credentials for any live integration; source allowlist for external discovery; SQLite FTS5 / local embedding / Ollama activation; malware-scanner choice; any spend, deployment, or Railway change (none performed). VERIFIED_WORKING promotion for any item.

## 6. Next milestones (dependency order)
1. C01 code-edit / repair workflow (controlled file changes, independent review, tests, rollback).
2. Memory: Markdown memory, `node:sqlite` FTS5 evaluation, local retrieval.
3. Coordination: agent-to-agent messaging with loop limits, bounded temporary sub-agents inside the 30-agent cap, checkpointing.
4. Model routing / evolution (offline, owner-approved policy).
5. Malware/file-quarantine design.
6. Control Center panels for vault/broker/approvals.
