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

### M2 — C01 code-edit / repair workflow (software development and repair, priority C)
- **Implemented:** `atlasz-addons/code-edit-workflow.mjs`: propose (nothing written) -> review by a DIFFERENT agent (static code review; FAIL blocks) -> apply with a single-use owner approval bound to the exact change digest; byte-exact snapshot (modes, created folders) pinned in the audit chain; intent recorded before the approval is spent; writes tmp+rename with post-hash verification; sandboxed tests via the existing REPO_TEST_RUN gate; failing tests restore the snapshot only for files still holding this change's output (never over someone else's edits); owner rollback (plain or explicitly partial); crash recovery; withdraw/expiry/quotas; bounded repair chain (3 attempts); truth in a hash-chained audit log, record files treated as untrusted. Wired into `createRuntime` (status + `rt.codeEdit`); no agent tool exposes it.
- **Tests:** `atlasz-tests/m2-code-edit-workflow.test.mjs` (29 tests incl. runtime hosting and a real restricted-launcher run). Independent verification: round 1 (9 findings) and round 2 (5 follow-ups) from a fresh worktree agent that never read the tests; all fixed with regression tests; mutation checks on the guards (survivors are redundant defence-in-depth or need real cross-process timing).
- **Requirement movement:** C01 (85 registry) gains the missing edit workflow but stays PARTIAL (no model-driven authoring, no git/PR integration by design, no agent tool wiring, no Control Center panel). PKG150 SN02/S506/OP02/OP04/S502 advance partially. 23-point item on controlled code change advances partially. No classification changes.
- **Known limits:** identities (author/reviewer) are asserted by the caller and must be bound to the authenticated agent when a tool is wired; audit chain is tamper-evident not tamper-proof (tail truncation by someone with write access to the state folder is not detected here); non-UTF-8 files are refused; rotating author ids can fill the global open-change cap until expiry; a local attacker racing the project folder between a path check and a rename is not defended beyond lstat checks.

### M3 — Markdown memory + FTS5 + hybrid retrieval (memory and knowledge, priority D)
- **Implemented:** `atlasz-addons/memory-store.mjs`: Markdown notes are the truth (front matter, body hash, atomic writes); a rebuildable index uses `node:sqlite` FTS5 (BM25) with an in-memory lexical fallback; local hashed n-gram similarity fused with BM25 by RRF. Classification PUBLIC/PERSONAL/CONFIDENTIAL with reader clearance (hidden notes look like missing ones); SECRET content refused/scrubbed; retrieved text fenced as UNTRUSTED_MEMORY; bad files quarantined; declassify and forget need single-use owner approvals bound to note+body hash; hash-chained audit; note cap. Wired into `createRuntime` (status + `rt.memoryStore`); no agent tool exposes it.
- **Tests:** `atlasz-tests/m3-memory-store.test.mjs` (22 tests, both backends); mutation checks on scrub/cap guards. Independent fresh-worktree verification round 1: 9 findings (0 critical/high; prototype-key classes, hand-edit declassify, byte-size quarantine, duplicate oracle, fence escape, forget leaving versions, secret-filter gaps, DB-locked under multi-process use, load-time cap) - all fixed with regression tests (41 tests); round 2 pending.
- **Requirement movement:** Markdown memory / FTS5 / hybrid-search items advance PARTIAL only. No classification changes.
- **Known limits:** similarity is lexical n-gram, NOT neural embeddings; `node:sqlite` is experimental and may be absent in Electron (fallback exists); single tenant per directory; no agent tool or Control Center panel; audit chain unkeyed; a hand edit can raise but never lower a class (floor taken from the audit chain, so an attacker who rewrites both note and audit file is out of scope); title/tags/source are returned as plain fields and must be treated as untrusted by consumers; `write` takes a caller-asserted `clearance` for the duplicate check.

## 3. Cross-package dependencies
Vault + broker are prerequisites for: Global Business source adapters needing API keys (GB), provider connectivity diagnostics (E), chat integrations (G), PKG150 GR/MR web-research items, payment-adjacent workflows (still gated by Financial Firewall + owner approval).

## 4. Security risks (open)
Python sandbox `.so` escape (unresolved); Windows plugin isolation is permission-model only; M01 browser extension not built; A13 heuristic; unkeyed audit chains; round-15 LOW items (timeout-only launch level, selftest overshoot, `maxLifetimeSec` non-number handling).

## 5. Owner decisions / approvals outstanding
Provider selection and credentials for any live integration; source allowlist for external discovery; SQLite FTS5 / local embedding / Ollama activation; malware-scanner choice; any spend, deployment, or Railway change (none performed). VERIFIED_WORKING promotion for any item.

## 6. Next milestones (dependency order)
1. Coordination: agent-to-agent messaging with loop limits, bounded temporary sub-agents inside the 30-agent cap, checkpointing.
2. Model routing / evolution (offline, owner-approved policy).
3. Malware/file-quarantine design.
4. Control Center panels for vault/broker/approvals/code-edit/memory.
