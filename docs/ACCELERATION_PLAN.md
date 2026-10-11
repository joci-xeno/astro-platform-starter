# ATLASZ development-performance audit and acceleration plan

Date: 2026-10-10. Branch `atlasz-v73-integration`. Evidence level: MEASURED on this 2-CPU / 8 GB workspace (Node 22.22.0) unless marked ESTIMATE. Nothing here changes a security control, the 30-agent roster, the owner's financial restrictions, or the unified programme scope (original 85, Security 23, Additional 150, Global Business Intelligence, crypto/trading research, live desktop dashboard).

## 1. Where the time actually went (measured)

| Finding | Evidence |
|---|---|
| The full suite was the dominant wait: 554 s serial (1380 tests in 163 files), run 7 times in the last stretch of work (about 65 minutes of pure waiting) plus the same cost again in earlier rounds. | `node --test` TAP total 554.3 s; 7 full-suite launches in the post-compaction transcript. |
| Test time was concentrated, not spread out: 5 files = 228 s (40 %); 120 of 163 files finish in under 2 s (median 0.45 s). | Per-file wall times, `docs/audit` run of 163 files, sum 568 s. |
| **A real defect inflated it:** `typed-tools.mjs` armed a `setTimeout` (tool timeout, default 10 s) for every tool call and never cleared it, so every hosted test file kept the process alive about 10 s after its last test (`agent-tools-hosted` 60.8 s -> 1.0 s, `code-sandbox-hosted` 60.6 s -> 0.9 s, `money-engine-hosted` 11.6 s -> 1.7 s). It also delayed graceful exit of the real runtime. | `process.getActiveResourcesInfo()` showed 4 pending Timeouts for 10 s; fixed by clearing the timer when the handler settles. |
| The test gate ran on one CPU lane: `node --test` defaults to `availableParallelism - 1` = 1 on this machine, while most files are waiting on I/O or timers. | 2 lanes: 554 s -> 292 s before the fix; 335 s -> 176 s after. 4 lanes (161 s) exposed a racy test, so 2 is the gate default. |
| Waiting by polling cost credits. 33 of 109 shell calls in the measured transcript were `sleep`/poll loops (self-imposed 2-minute cap); those turns re-read about 4.2 M of 23.9 M cached context tokens (about 18 %) for zero information. The tool allows a single blocking call of up to 10 minutes. | Transcript analysis: 109 Bash calls, 33 polling; cache-read tokens 23.9 M vs 80.8 k output tokens. |
| Credit use is driven by context re-reading, not by generated text: output was 0.3 % of tokens processed. Long sessions with big tool outputs are the cost multiplier; each extra turn re-reads the whole context. | 23.9 M cache-read vs 0.18 M cache-write vs 0.08 M output. |
| The M3 credential filter consumed 7 consecutive verifier rounds (rounds 8-14). Each round = code change + regression test + mutation run + full suite (9 min then) + verifier call. The filter is a heuristic over open-ended natural language, so every tightening opened a new false-positive/false-negative edge (whack-a-mole). | Rounds 9-14 each produced a new MEDIUM from the previous fix. |
| Mutation checks ran in place (edit file -> run test -> restore), so they cannot overlap with anything else and a killed run leaves a `.bak`. 13 mutation runs, each blocking the workspace. | `mutgen.py` behaviour; one stray `.bak` incident. |
| Two flaky tests were found only because of load or the clock: `m6-control-center` (read the feed cursor before the chart while the server scheduler kept advancing) and `m5-verification-round5` (a clock that straddled UTC midnight). Both were test bugs and are fixed. | Reproduced 2 of 3 under parallel load; failed at 23:47 UTC. |
| No duplicated modules found: the M6 modules sit next to the M3/M5 ones and share `owner-auth`, `audit-chain`, `secret-patterns`. The apparent duplication is the repeated audit of the same security files by successive verifier rounds, not duplicate code. | Import graph (below). |

## 2. Implemented now (safe, low risk, within existing authorization)

1. **Timer-leak fix** in `atlasz-addons/typed-tools.mjs` (timer cleared in `finally`; behaviour on timeout unchanged; covered by the existing TIMEOUT tests).
2. **Two-lane test gate**: `npm test --prefix atlasz-runtime` now runs `--test-concurrency=2`. `npm run test:serial` keeps the old single-lane behaviour; the Windows installer workflow still calls `npm test` (the Windows runner has more cores).
   Measured: **554 s -> 176 s** (two consecutive runs: 175 s and 177 s, 1380/1380 each). That is a saving of about 6.3 minutes per full run, about 68 %.
3. **Impacted-test selector** `scripts/test-impacted.mjs` (`npm run test:fast`): static import graph over `atlasz-*/` and `atlasz-tests/`, runs only the test files that transitively import a changed file; docs-only changes run nothing; changes to `package.json`, `helpers.mjs` or an unplaceable file fall back to the whole suite. Measured: ORB change -> 36 of 163 files in 65 s; a docs-only change -> 0 s; a change to the widely imported `secret-patterns.mjs` -> 116 files in 149 s (little gain, as expected). **It is a development aid, not a release gate:** the full suite is still required before every pushed commit and before every verifier round.
4. **Racy test fixed** (`m6-control-center`: the chart is judged against the cursor the server reports with the chart itself) and the midnight-straddling clock in `m5-verification-round5`.
5. **Policy for waiting** (no code): run long jobs in the background and wait with ONE blocking call (`timeout` up to 600 000 ms) instead of 2-minute poll loops.

## 3. Acceleration plan

| # | Action | Est. saving | Effort | Risk | Needs approval? |
|---|---|---|---|---|---|
| 1 | Done: timer leak + 2 lanes. | 6.3 min per full run (measured); about 40 min over the 7 runs of the last stretch | done | Low (2 lanes ran 4 times clean; 4 lanes did not) | no |
| 2 | One blocking wait instead of poll loops. | about 18 % of context-read tokens in long runs (measured share); also fewer turns | none | none | no |
| 3 | Use `test:fast` during development, the full gate once per commit. | 1-2 min per iteration on leaf modules (measured 65 s vs 176 s); 0 s for docs-only | done | Low: the graph does not see computed `import(variable)` paths; full gate remains | no |
| 4 | Run mutation checks on a throw-away copy of the tree (`cp -r` or `git worktree`), so several mutants run in parallel and no `.bak` can be left behind. | ESTIMATE 2x on mutation phases | 0.5 day | Low | no |
| 5 | Split the five long files (`m6-control-center` 48 s, `agent-tool-broker` 31 s, `m6-market-orb` 28 s, `repo-analyzer` 19 s, `model-gateway` 15 s): real waits (SSE, scheduler ticks, walk-forward) can use injectable clocks/smaller datasets; the 2-lane scheduler already balances them. | ESTIMATE 40-60 s per full run | 1 day | Medium: weakening a test by shrinking inputs; every change needs a mutation re-check | no |
| 6 | Verification budget: freeze an acceptance rule per module before a verifier round ("clean at HIGH/MEDIUM; LOW documented") and cap heuristic-filter rounds (M3 used 7). For credentials, prefer structure over phrase lists: refuse by default in a small set of contexts the owner can see, rather than chasing prose. | ESTIMATE saves 3-5 rounds per heuristic module (about 1 h of suite time + verifier credits each) | process change | Medium: lower marginal recall on rare phrasings; LOW limits are documented, fencing and redaction remain the real defences | owner decision on the rule |
| 7 | Parallel module development: M6 (trading/ORB), the Global Business Intelligence adapters, Control Center views and memory neural plumbing do not share files (import graph: the only shared files are `owner-auth`, `audit-chain`, `secret-patterns`, `core.mjs`/`server.mjs` route tables). Independent worktrees + one integration commit per module. | ESTIMATE 1.5-2x wall time on multi-module milestones; costs more credits per hour, not fewer | process | Medium: merge conflicts in `core.mjs`/`server.mjs`, `UNIFIED_PROGRESS_REPORT.md` and the traceability CSV (generate those from per-module fragments) | no |
| 8 | Cache the verifier setup: keep the verifier worktree + probe scripts between rounds (already done) and give the verifier a diff-scoped brief (already done for narrow rounds). Do not re-audit unchanged modules. | credits only | none | none | no |
| 9 | CI-style incremental build for the Windows app: build the installer only when `atlasz-control-center/` or its imports changed (the workflow is manual-only by owner rule and stays so). | build minutes, not dev time | small | Low | no (workflow stays manual) |
| 10 | Real infrastructure changes (a paid CI runner, a larger machine, a cache service, paid model usage for verifiers). | ESTIMATE up to 2-3x on the full suite with 4+ cores | n/a | cost | **YES - owner approval and budget required; not done** |

## 4. Fastest safe path to a working Windows desktop ATLASZ

What exists today: the Control Center (operations, agents, trading research, revenue, memory, security and approvals) runs from `launcher/ATLASZ-Control-Center.cmd` with Node 20+ on the PC, opening a token-protected local window (127.0.0.1). The Electron wrapper and the NSIS installer workflow exist; the workflow is `workflow_dispatch` only and produces an Actions artifact, with no secrets, deploy or Railway access.

Nothing has been launched on Windows yet; that is the single largest unknown.

1. **Today, no approval needed beyond what you already gave:** on the Windows PC with Node 20+, run the launcher from a checkout of the branch and check the 10-point demo list. This gives the first real Windows evidence.
2. **Next, needs your approval each time:** start the `build-windows-installer` workflow manually. It runs the full suite on a Windows runner (first cross-platform test evidence) and builds the installer artifact. GitHub Actions minutes are a possible cost; I did not start it.
3. **Not done, needs approval:** an Electron upgrade (the documented `--permission` sandbox limit), code signing, and any auto-update channel.
4. In parallel with 1-2 (no dependency): market-data provider decision, local embedding model decision, and the Global Business source adapters.

Fastest sequence: 1 -> fix whatever Windows shows (ESTIMATE 1-3 days of fixes) -> 2 -> signed installer decision. None of this abandons the remaining programme: classifications are unchanged (85: 18/44/1/22).

## 5. Risks of the speed-ups

- Two lanes can hide a race that appears under load (it found two test races, both fixed). If a test fails only in parallel, run `npm run test:serial` and treat the parallel failure as a defect in the test or code, not as noise.
- `test:fast` can miss a dependency reached by a computed import path or by a data file. It must never replace the full gate.
- Fewer verifier rounds means accepting documented LOW limits. HIGH/MEDIUM stay mandatory.

## 6. Not changed

Security controls, approval rules, the kill switch (JOCI only), bind addresses, the 30-agent roster, the manual-only installer workflow, the `main` branch, production/Railway, spending, subscriptions, transfers, real-money trading, neural retrieval (still blocked pending approval).
