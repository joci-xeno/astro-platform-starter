# ATLASZ V7.3 — Task 3: Technical audit and gap assessment

Branch `atlasz-v73-integration`. Audit only: no product code was changed in Task 3 (only registry/audit data and audit tooling). Everything below is **SANDBOX evidence**: no live provider, credential, real owner key, Windows host, or production system was used, so **nothing is LIVE_VERIFIED**.

## 1. Method and limits

- Every one of the 983 registry rows (930 items + 53 section roll-ups) was mechanically checked (`docs/audit/item_audit.py`): do the named files exist, do the listed tests exist and pass, does a passing test actually name the module, is the module reachable from the runtime / Control Center / CLI, and is it *invoked* by production code (not just imported).
- The 211 previously 'working' items were re-verified three ways: the mechanical scan, 20 independent probes that drive the real modules with attack-style input outside the unit tests (`independent_probes.mjs`), and a live boot of the runtime + Control Center that hits every route (`dynamic_probe.mjs`).
- Provenance: `docs/audit/` (static scan, item audit, per-file test runner) was already present, untracked, in the working tree when Task 3 began; it was not written in this session. Its stored outputs were discarded and every scan was re-run; `dynamic_probe.mjs`, `independent_probes.mjs`, `reclassify.py`, `roadmap.py` and `render_reports.py` were added in Task 3.
- **Limits:** the scans are static (regex/import-graph), so dynamic `import()`, string-built tool names and runtime registration can be missed; 'invoked' means an import plus a call site was found, not that the call happens in practice. Passing tests prove behaviour in a sandbox, not real-world operation. The Windows installer, Railway, real providers, real money flows and a real owner key were not exercised. Hungarian-language requirement text was classified by its registry fields, not re-read from the spec line by line.

## 2. Before and after

| Registry rows | Before Task 3 | After Task 3 | Change |
|---|---|---|---|
| EXISTS_AND_WORKING | 211 | 192 | -19 |
| PARTIAL | 478 | 503 | +25 |
| MISSING | 194 | 196 | +2 |
| STRUCTURAL_ONLY | 36 | 36 | +0 |
| EXISTS_NEEDS_TEST | 17 | 17 | +0 |
| EXTERNAL_BLOCKER | 35 | 36 | +1 |
| BLOCKED_AWAITING_JOCI_APPROVAL | 3 | 3 | +0 |
| **Total rows** | 974 | 983 | +9 |

| 85 capabilities | Before | After | Change |
|---|---|---|---|
| VERIFIED_WORKING | 6 | 3 | -3 |
| PARTIAL | 47 | 50 | +3 |
| MISSING | 10 | 10 | +0 |
| EXTERNAL_BLOCKER | 22 | 22 | +0 |

| Master gap register | Before | After | Change |
|---|---|---|---|
| REGISTRY item gaps | 710 | 738 | +28 |
| CAPABILITY_85 gaps | 79 | 82 | +3 |
| IMPORT_SCAN orphans | 3 | 5 | +0 |
| **Total** | 792 | 828 | +36 |

**What the change means.** Nothing was newly built and no gap was closed in Task 3. The open-gap count rose by 36 = 23 registry items + 3 capabilities **reclassified downward** (their 'working' status was not supported: modules are tested but nothing runs them; these are over-claims, not new problems) + 9 **newly discovered** gaps registered as ATLASZ-T3-001..009 (8 MISSING, 1 EXTERNAL_BLOCKER): unauthenticated runtime dashboard, unsandboxed plugin/update child processes, agents cannot invoke tools, duplicate/hub-bag-only modules, weak-random id fallbacks, no restore UI, 4 untested routes, no schedule creation in the UI, unverified real-source discovery.

## 3. Reconciliation: requirements vs gaps (no double counting)

The three documents measure different things and overlap. Rule used: **a requirement is a registry item of kind PRODUCT or SUPPLEMENTARY; a gap is a requirement (or capability) that is not IMPLEMENTED.** Section roll-ups, status-vocabulary labels, process/audit tasks and implementation records are tracked but are not counted as outstanding product requirements.

| Registry row kind | Rows | Open (not implemented) | Counted as outstanding product requirement? |
|---|---|---|---|
| PRODUCT_REQUIREMENT | 711 | 588 | yes |
| SUPPLEMENTARY_REQUIREMENT | 137 | 87 | yes (Joci addenda: ATLASZ-BR/OSC/UC/CR/CC/SV) |
| SECTION_ROLLUP | 53 | 53 | no (derived from its items; counted once via the items) |
| STATUS_LABEL | 5 | 5 | no (S12 vocabulary words, not behaviour) |
| PROCESS_OR_AUDIT_TASK | 46 | 35 | no (S42/S43/S44/S50 working-method and audit-task items) |
| IMPLEMENTATION_RECORD | 31 | 23 | no (ATLASZ-PKG84: records of work already done; the requirement they implement is counted elsewhere) |

- **974 rows = 930 items + 53 section roll-ups.** The registry figures quoted at the start of Task 3 (478 PARTIAL / 194 MISSING; now 501 / 194 after the 23 downgrades) include roll-ups: at item level it is 479 PARTIAL (+28 STRUCTURAL_ONLY, +10 EXISTS_NEEDS_TEST, which this audit also reports as PARTIAL) and 182 MISSING.
- **Unique outstanding requirements: 675** (588 product + 87 supplementary, not implemented). The remaining open registry rows are 63 roll-ups/labels/process tasks/implementation records.
- **Gap register total 828 = 738 registry item gaps + 82 open capabilities + 5 import-scan orphans (+ 3 other scans).** Every REGISTRY gap links to exactly one registry item; each CAPABILITY gap links to the registry items it depends on (`depends_on`). 76 of the 82 open capabilities link to registry items, so most capability gaps are *views of the same work*, not additional work; only G01, GE07, A01, A07, A13, P18 have no registry link and are independent.
- Therefore the honest size of the remaining work is **~681 requirements** (not 828 gaps and not 974); the 828-gap figure double counts capability views and non-product rows. Dangling capability→registry links: 0.

Final classification of all 930 items (registry status mapped to the five classes requested; STRUCTURAL_ONLY and EXISTS_NEEDS_TEST are reported as PARTIAL; **no item is LIVE-verified**):

| Class | Items |
|---|---|
| PARTIAL | 517 |
| IMPLEMENTED | 192 |
| MISSING | 182 |
| EXTERNALLY_BLOCKED | 36 |
| AWAITING_OWNER_APPROVAL | 3 |

## 4. Verification of the previously 'working' items

Started with **211** EXISTS_AND_WORKING registry rows (all items).

| Outcome | Count | Detail |
|---|---|---|
| Retained as EXISTS_AND_WORKING | 192 | sandbox-verified; none LIVE |
| Downgraded to PARTIAL | 23 | module tested but imported only into the integration-hub adapter bag / unreachable; no workflow invokes it (S03-005, S03-011, S07-013, S09-026, S11-003/007/010/011/012/014, S15-002/004/006/007/009/011, S16-002/003/005/006, S27-009, S29-012, S50-005) |
| Retained, evidence re-pointed | 6 | S13-008..012 and S48-011 (no unauthorized subscription/purchase/payment/banking/contract/loan) were credited to the unconnected guardrail-engine; the real enforcer is the runtime control chain. Re-verified by probe P04/P05 |

Remaining flags on retained items (reviewed, none changes status): TESTS_DO_NOT_EXERCISE_MODULE×6, NO_MODULE_FILE×12, LOCATION_FILE_NOT_FOUND×2, NO_TEST_LISTED×4, LISTED_TEST_MISSING×1, MODULE_TESTED_BUT_NEVER_INVOKED_BY_A_RUNTIME_WORKFLOW×1. These are meta items (tests/registry/audit-task rows with no code module), a `*.test.mjs` glob mistaken for a missing file (ATLASZ-CR-003), or heuristic misses where the test drives a real process (S14-001, S35-008).

**Independent probes (20):** 49/49 pass.

| Probe | Claim | Result |
|---|---|---|
| P01 | Owner approval is single-use | PASS |
| P02 | Owner approval is bound to the exact arguments | PASS |
| P03 | A forged approval signed by another key is refused | PASS |
| P04 | Unknown and money operations fail closed for agents | PASS |
| P05 | No-spend: a positive spend is refused even for a permitted operation | PASS |
| P06 | Kill switch (emergency stop) blocks agents until the owner resumes | PASS |
| P07 | An agent cannot resume or stop via a forged/empty approval | PASS |
| P08 | Sandbox: Python cannot open files outside its work dir | PASS |
| P09 | Sandbox: JavaScript cannot read outside its work dir | PASS |
| P10 | Sandbox: network and child processes are denied (python) | PASS |
| P11 | Sandbox: secret in code is refused and never reaches the audit log | PASS |
| P12 | Observation memory: another tenant sees nothing; agents never see CONFIDENTIAL | PASS |
| P13 | Observation memory: delete really removes the text from disk | PASS |
| P14 | Voice cannot approve: spoken approval yields NEEDS_STRONG_AUTH and no approval | PASS |
| P15 | Voice with no provider cannot start; mock output is labelled MOCK | PASS |
| P16 | Runtime topology is exactly 5 SEARCH + 25 EXECUTION with unique ids | PASS |
| P17 | Typed tools reject extra arguments (an agent cannot inject tenant/consent) | PASS |
| P18 | Process-only sandbox tool requires owner approval | PASS |
| P19 | Agents have no tool that approves, spends, sends, or speaks | PASS |
| P20 | Money Engine panel reports unknown revenue as unknown, not zero-verified | PASS |
| P21 | Runtime HTTP: every sensitive route is 401 without the token, and an unconfigured token fails closed (503) | PASS |
| P22 | Plugin hook child: cannot read outside, write, spawn; sees no inherited secrets | PASS |
| P23 | Restricted launcher fails closed when the host cannot restrict Node | PASS |
| P24 | No production source uses Math.random() | PASS |
| P25 | Agents cannot enable/rollback/restore via the chain: RESTORE-class operations fail closed without owner approval | PASS |
| P26 | Plugin cannot gain write access by editing its manifest after the owner enabled it | PASS |
| P27 | M2: forged agent ids (a 31st agent, odd spellings) are refused and no tool handler runs | PASS |
| P28 | M2: owner decisions D3/D4/D5/D6 hold for every agent (process-only sandbox, pcc.*, voice, model.complete, money.panel, inbox.summary denied; no handler reached) | PASS |
| P29 | M2: a caller-supplied owner approval or role is ignored by the broker (valid approval for the exact args does not unlock a denied tool) | PASS |
| P30 | M2: rate limits - the 11th call of one agent within a minute is refused (RATE_LIMITED) | PASS |
| P31 | M2: Safe Mode stops all agent tool calls, reads included | PASS |
| P32 | B1: none of the 30 agent ids (nor spoofed spellings) can adopt, supersede or revoke a project decision; only OWNER | PASS |
| P33 | B1: notes/ideas of one tenant are invisible to another (get, search, export) | PASS |
| P34 | B1: a stopped system (kill switch / Safe Mode) runs no workflow step; a throwing stop check fails closed | PASS |
| P35 | B1: hostile page markup (script, style, comments, event handlers) never reaches the comparison text | PASS |
| P36 | B1: plugin install without a matching signed owner approval installs nothing; an approval for other content (another hash) is refused | PASS |
| P37 | B1: a package containing a symlink or a forbidden permission is rejected before any approval is considered | PASS |
| P38 | B1: no agent id can activate a skill; only pure computation actions are usable in a skill; an untested version cannot be activated | PASS |
| P39 | B1: an MCP server never starts without an owner approval bound to its exact folder content, and never without network isolation | PASS |
| P40 | B1: a hostile page is flagged SUSPICIOUS and its instruction lines are never returned as answers | PASS |
| P41 | B1: skills cannot use state-writing actions (notes/memory writers are refused at submission) | PASS |
| P42 | B2: code review never calls code safe and never echoes a credential-shaped literal | PASS |
| P43 | B2: repository tests do not run (no process starts) without a signed approval bound to the analysed content | PASS |
| P44 | B2: none of the 30 agent ids can change, reset, confirm or forget a preference; learning only proposes | PASS |
| P45 | B2: a corrupt durable knowledge file is never overwritten (configuration fails closed) | PASS |
| P46 | B3: accessibility audit never claims full accessibility and flags a failing contrast pair and a missing alt | PASS |
| P47 | B3: none of the 30 agent ids (nor spoofed spellings) can create, roll back or remove an assistant profile; a profile cannot grant pcc.* or model.complete | PASS |
| P48 | B3: handoffs are roster-only, a receiver cannot accept different artifacts than were handed over, and a non-roster id cannot receive work | PASS |
| P49 | B3: study cards - agents cannot change the schedule, and invalid grades never alter a card | PASS |

**Live boot of runtime + Control Center:** 30 agents (SEARCH 5, EXECUTION 25); 31 typed tools registered; 60 Control Center routes (30 GET, 30 POST): every GET returns 200 with a token and is refused without one, every POST is refused without/with a wrong token, a foreign Host header gets 403. 

### 85 capabilities re-verified

3 of the 6 'VERIFIED_WORKING' capabilities were downgraded: **G06 Function Calling, GE08 Structured Tool Invocation, P14 Strict Structured Output** — the schema/permission layer is verified, but no agent or model invokes the tools (only the scheduler and tests do), so the capability is not working end to end. C11 stays verified but its evidence no longer relies on the by-design-unwired `tenant-isolation.mjs` or the in-memory demo RAG. C12 (scheduler) and C13 (owner administration/security) stay verified (sandbox).

## 5. Structural findings

### 5.1 Agents cannot use the tools (most important integration gap)

The 30 agents execute one job type: governed `SCREENING` (`brain.dispatch.run`). Typed tools (`kp.*`, `research.*`, `sandbox.*`, `obs.*`, `media.*`, `pcc.*`, `model.complete`, `voice.status`) are registered and fully gated, but the only production caller of `tools.invoke` is the scheduler; no agent loop selects or calls a tool, and no model is attached. 'Agents can use X' is therefore true of the *interface*, not of running agents. Roadmap M2.

### 5.2 Disconnected / hub-bag-only / unreachable modules

- **32 modules are imported only into `internal-integration-hub` and never invoked:** outcome-compiler.mjs, qa-reviewer.mjs, opportunity-qualification-engine.mjs, cost-model-router.mjs, self-healing-loop.mjs, stall-replanner.mjs, task-ledger.mjs, tracing-evals.mjs, checkpoint-engine.mjs, market-intelligence-engine.mjs, buyer-decision-maker-finder.mjs, profit-accounting-engine.mjs, client-dna-engine.mjs, delivery-engine.mjs, regression-eval-suite.mjs, enterprise-knowledge-agentic-rag.mjs, follow-up-engine.mjs, negotiation-engine.mjs, guardrail-engine.mjs, tax-accounting-engine.mjs, payment-confirmation-adapter.mjs, profit-ledger.mjs, anti-collusion-guard.mjs, proposal-quote-engine.mjs, master-planner-orchestrator.mjs, deal-state.mjs, progress-ledger.mjs, execution-factory.mjs, dead-letter-queue.mjs, invoice-engine.mjs, team-lead-workflows.mjs, agent-factory.mjs.
- **Not reachable from runtime/CC/CLI:** `digital-twin.mjs` (4 'working' items downgraded), `evidence-record.mjs` (no caller), `tenant-isolation.mjs` (by design: commercial track, needs Joci's authorization); legacy `supervisor.js`, `worker.js`, `agent-child.js` (LEGACY_START only; `atlasz-competition-v1` policy confined to worker.js).
- Orphans per import scan: 5; entry points with no in-repo caller (CLI/Electron/staging scripts): evidence-record.mjs, owner-cli.mjs, supervisor-safe.mjs, stage-win.mjs, main.mjs.

### 5.3 Duplicate implementations

| Legacy / standalone module | Connected counterpart | Evidence | Recommendation |
|---|---|---|---|
| `supervisor-safe.qualify()` | `opportunity-qualification-engine.mjs` (hub bag only) | The runtime screens leads with its own inline `qualify`; the engine is never called | Merge: runtime calls the engine, delete the inline copy |
| `deal-state.mjs`, `invoice-engine.mjs`, `delivery-engine.mjs`, `profit-ledger.mjs`, `profit-accounting-engine.mjs`, `payment-confirmation-adapter.mjs`, `follow-up-engine.mjs`, `proposal-quote-engine.mjs` | `business/{deal-pipeline,invoice-service,delivery-service,finance-intelligence,payment-verification,communication-center}.mjs` (invoked via the Money Engine) | Two parallel money pipelines; the older addon engines are hub-bag only | Pick `business/*` as canonical, port any unique rules (e.g. 2/5/10-day follow-up) into it, retire the rest |
| `master-planner-orchestrator.mjs` | `brain/orchestrator.mjs` + `governed-dispatch` | Brain orchestrator is invoked; the older planner is hub-bag only | Retire or fold in |
| `approval-command-gateway.mjs` and `owner-control/approval-gateway.mjs` | both export `createApprovalGateway` | One invoked by production code, one via hub hooks | Single gateway |
| `observability-black-box.mjs` | `brain/black-box.mjs` | Brain black box is the invoked, hash-chained one | Fold in |
| `enterprise-knowledge-agentic-rag.mjs` (in-memory demo) | `knowledge-projects.mjs` + `research-ledger.mjs` | Demo is hub-bag only | Retire after confirming no unique rule |
| `recovery.mjs`, `backup-recovery.mjs`, `owner-control/recovery-points.mjs`, `brain/disaster-recovery.mjs` | (four recovery modules, all reached) | Overlapping responsibilities, each invoked | Document ownership boundaries; avoid a fifth |
| `plugin-manager` / `local-update-adapters` child-process runners | `code-sandbox.mjs` | Three separate ways to run child Node code; only the sandbox restricts the filesystem | Reuse the sandbox runner (see S-04) |

### 5.4 Control Center routes and UI

- 60 routes + 1 root: all authenticated (dynamic probe). 43 nav entries, 29 views + brain views; no broken panel route. `/api/restore/backup` exists server-side but no UI uses it (restore-from-arbitrary-backup has no screen). Routes with no test referencing their handler (static): `/api/opportunities`, `/api/money-recurring`, `/api/backup`, `/api/updates/auto`.
- Panels that exist but whose data source is empty by design until providers exist: voice, media (providers), connectors, inbox. On a fresh state every one of these routes answered 200 with no error state (dynamic probe); their NOT_CONNECTED/BLOCKED labelling is covered by the existing tests and was not re-read panel by panel here.

### 5.5 Incomplete workflows

- Discovery → qualification → proposal → delivery → invoice → payment: each stage is tested in isolation or in a SANDBOX engine; no end-to-end run exists because no search provider, mail connector or payment authority is attached (EXTERNAL / OWNER).
- Lead discovery uses one public source (Hacker News Algolia search, read-only); there are no job-board, mail or CRM connectors. Discovery against the real source was **not exercised** in this audit (no outbound network in the workspace) and has never been verified LIVE; all tests use injected fetchers.
- Scheduler jobs can be created only by code/tests; the Control Center reads but cannot create schedules.
- Voice has never run on real audio; OCR/STT/vision/embedding providers are absent.

### 5.6 Security findings (unresolved)

| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| S-01 | MEDIUM | The runtime HTTP server binds `0.0.0.0` with **no authentication** and serves `/`, `/status`, `/revenue` (full dashboard), `/opportunities` and `/events`. | supervisor-safe.mjs:428-444; probe: a fresh dashboard is ~24 KB (topology, agent activity, Money Engine aggregates, queue, scheduler, hash-chain heads, lead titles). No raw secrets or personal note text were found in it, but it is information disclosure and every module added to the dashboard widens it. | M1: `/health` only (minimal) without a token; everything else behind the owner token or removed; add a regression test that the dashboard never contains private content. Do not change Railway until the owner approves. |
| S-04 | MEDIUM | Plugin hook processes and update self-tests are launched as plain `node` children: scrubbed env, timeout and output cap, but **full filesystem and network access** (no `--permission`). | plugin-manager.mjs:105, local-update-adapters.mjs:102 (code-sandbox.mjs is the only runner with filesystem restriction) | M1/M6: run them through the sandbox runner with `--permission`; keep owner approval for enabling plugins. |
| S-02 | LOW | `Math.random()` is used as a fallback for ids in tracing-evals, agent-factory and the demo RAG. | static scan; only used if `crypto.randomUUID` is missing (Node >= 20 always has it) | Replace with `crypto.randomUUID` / `randomBytes`. |
| S-03 | INFO | No `eval` / `new Function`; no `shell:true`; child-process calls use argument arrays. | grep over addons, runtime, control-center | none |
| S-05 | INFO | Code sandbox is not a container or VM; the Windows installer machine would run PROCESS_ONLY isolation. | code-sandbox.mjs ISOLATION labels | M6: evaluate stronger isolation after owner approval. |
| S-06 | INFO | Single-owner model: no delegated roles; voice cannot approve. | C13, P14 probe | Keep unless the owner changes the model. |

## 6. What the 738 open items need

Per-item detail for all 983 rows (what exists, what code/integration/security/tests are required, external dependency, owner approval, milestone) is in `docs/audit/open_items_detail.csv`. Aggregates over the 738 open items:

| Needs | Open items |
|---|---|
| Code (build or complete) | 689 |
| Runtime / UI integration | 46 |
| Security review + negative tests | 109 |
| Tests | 738 |
| External dependency (provider, credential, Windows host) | 142 |
| Owner decision / approval | 70 |

These categories are derived from each row's own blocker/evidence text and the mechanical facts, so they are a **starting specification**, not a design; Task 4 should confirm each against the spec text as it implements it.

## 7. Test results and coverage limits

- Full suite (`npm test --prefix atlasz-runtime`): **807 tests, 807 pass, 0 fail, 0 skipped, 0 cancelled** (see recorded note in full_suite_result.json).
- Per-file run (`docs/audit/run_tests_per_file.py`): 86 files, 568 tests, 568 pass, 0 fail, 0 skipped.
- Line coverage (node --experimental-test-coverage, full suite, 527/527): **98.8% lines / 84.5% branches** over 151 loaded source files; lowest-covered: atlasz-addons/negotiation-engine.mjs 30%; atlasz-addons/tracing-evals.mjs 61%; atlasz-addons/enterprise-knowledge-agentic-rag.mjs 78%; atlasz-control-center/server.mjs 83%; atlasz-addons/tool-fabric.mjs 89%; atlasz-addons/personal-command-center.mjs 93%. Absent from the coverage report (not loaded, or not attributed by the collector - e.g. supervisor-safe.mjs is exercised through real-process tests): atlasz-control-center/public/app.js, atlasz-runtime/agent-child.js, atlasz-runtime/owner-cli.mjs, atlasz-runtime/supervisor-safe.mjs, atlasz-runtime/supervisor.js, atlasz-runtime/worker.js. Caveat: coverage counts executed lines, not asserted behaviour, so it supports but does not prove the 'working' claims (e.g. `negotiation-engine.mjs` is the least covered module and is hub-bag only).
- Limits: tests run against temp dirs with fake providers, so they show logic and failure handling, not provider behaviour; Windows-only branches (env scrubbing, junctions, process limits) cannot run on this Linux host; the Electron shell and installer are untested here; timing/robustness tests use short real timeouts and can be load-sensitive; mutation testing was done per module by hand-written mutants, not for the whole code base; the registry/gap-register generators have their own tests, so some of the suite verifies tooling rather than product behaviour.

## 8. Files produced

`docs/audit/` — `static_scan.{py,json}`, `item_audit.{py,json,csv}`, `run_tests_per_file.py`/`test_results.json`, `dynamic_probe.mjs/json`, `independent_probes.mjs/json`, `reclassify.py`, `roadmap.py`, `render_reports.py`, `open_items_detail.csv`, `reconciliation.json`, `roadmap.json`, `route_test_coverage.json`; `docs/registry_item_audit_p7.py` (generated reclassification); updated registry, capability audit and master gap register; `docs/TASK3_ROADMAP.md`.

