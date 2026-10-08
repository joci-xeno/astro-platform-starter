# ATLASZ V7.3 — Task 3: Prioritised implementation roadmap (input to Task 4)

Generated from `docs/audit/roadmap.json` and `docs/audit/open_items_detail.csv`. Counts are **unique outstanding requirements** (PRODUCT + SUPPLEMENTARY, not implemented). Every milestone keeps the 5+25 agent topology, the Security Brain, the control chain and owner approvals, defaults to NO-SPEND, and reports SANDBOX vs LIVE separately. Nothing in this roadmap deploys, spends or touches main/Railway without a separate owner approval.

## Order and dependencies

| Milestone | Name | Depends on | Open reqs | Partial | Missing | Ext. blocked | Owner decision | Gated by |
|---|---|---|---|---|---|---|---|---|
| M1 | Safety & reliability baseline | — | 79 | 62 | 17 | 0 | 0 | none |
| M2 | Agent runtime integration (30 agents, Brain, tools) | M1 | 145 | 129 | 15 | 0 | 1 | model provider only for non-mock reasoning (EXTERNAL) |
| M3 | Knowledge, memory and documents | M2 | 64 | 31 | 33 | 0 | 0 | OCR/embeddings providers (EXTERNAL) |
| M4 | Money & business workflow (no real money) | M2, M3 | 42 | 32 | 9 | 1 | 0 | bank/email/payment providers and owner decisions (EXTERNAL / OWNER) |
| M5 | Models, multimodal and live voice providers | M2 | 48 | 23 | 16 | 9 | 0 | ALL providers EXTERNAL; spending needs owner approval |
| M6 | Tools, connectors, computer use and office/web automation | M2, M1 | 59 | 23 | 25 | 11 | 0 | browser host, credentials (EXTERNAL) |
| M7 | Personal ATLASZ, Human Core, modes and mobile | M2, M3 | 44 | 27 | 17 | 0 | 0 | mobile client (EXTERNAL) |
| M8 | Windows desktop / Control Center completion | M1 | 86 | 60 | 16 | 8 | 2 | Windows machine, installer build approval, code signing (EXTERNAL/OWNER) |
| M9 | Intelligence, performance and software/automation factories | M2, M3, M6 | 60 | 34 | 26 | 0 | 0 | web/search providers (EXTERNAL) |
| M10 | Process, registry, acceptance and commercial track | M1, M2, M3, M4, M5, M6, M7, M8, M9 | 48 | 33 | 8 | 7 | 0 | owner decisions |

Recommended execution order: **M1 → M2 → (M3, M6, M8 in parallel) → M4 → M5 → M7 → M9 → M10.** M1 comes first because it removes the only unresolved security exposure and the reliability gaps; M2 comes second because agents currently cannot use any tool, which limits the value of everything built since.

## M1 — Safety & reliability baseline

**Scope.** Fix the unauthenticated runtime dashboard, close recovery/reliability/audit gaps, remove status-language gaps. Everything later depends on this.

**Depends on:** none  |  **External / owner gates:** none

**Acceptance criteria.** Runtime HTTP server serves only a minimal /health without a token; all other routes need the owner token or are removed; negative tests prove it. Backup/restore/LKG drills pass on a clean data dir; audit chains verify; every reliability item has a test that fails when the guard is removed (mutation).

**Open requirements:** 79 (priority mix: P0×34, P1×45). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| ATLASZ-OSC-004 | PARTIAL | Kill Switch (Joci-only) covers the 30-agent runtime, Brain-triggered a | code; integration; security; tests |
| ATLASZ-OSC-008 | PARTIAL | Security Brain deeply integrated: ALLOW/WARN/REQUIRE_APPROVAL/QUARANTI | code; security; tests |
| ATLASZ-OSC-015 | PARTIAL | Backup/restore/rollback separately for application version, configurat | code; tests |
| ATLASZ-OSC-017 | PARTIAL | Disaster Recovery sequence DETECT>CONTAIN>FREEZE UNSAFE ACTIONS>PRESER | code; tests |
| ATLASZ-OSC-018 | PARTIAL | Cross-layer protection of ALL Brain subsystems (Orchestrator, Planning | code; tests |
| ATLASZ-OSC-020 | PARTIAL | Money Engine safety: every transition needs typed evidence and indepen | code; integration; tests |
| ATLASZ-OSC-023 | PARTIAL | Control Center Owner Safety/Control area with real status for OWNER AU | code; security; tests; EXTERNAL |
| ATLASZ-OSC-024 | PARTIAL | Owner controls EMERGENCY STOP, PAUSE EXTERNAL ACTIONS, RESUME, RUN SYS | code; security; tests; OWNER |
| V73-S02-001 | PARTIAL | Authority chain: JOCI/OWNER -> STRONG OWNER AUTH -> MASTER -> AGENTS - | code; security; tests; EXTERNAL; OWNER |
| V73-S02-002 | PARTIAL | No agent/model/plugin/connector/workflow/external service may override | code; security; tests |
| V73-S14-005 | PARTIAL | nincs új outreach/send/submission/deploy/computer-use action | code; security; tests; OWNER |
| V73-S14-006 | PARTIAL | nincs új költség/pénzügyi commitment | code; security; tests |

All rows: filter `open_items_detail.csv` on `milestone == M1`.

## M2 — Agent runtime integration (30 agents, Brain, tools)

**Scope.** Make the governed dispatch able to run typed tools (kp/research/sandbox/obs/media/model) for the 30 agents through the Security Brain and control chain; connect or retire the 32 hub-bag-only modules and the duplicates; complete orchestrator, judge/QA/guardrails, digital twin, watchdog, queue items.

**Depends on:** M1  |  **External / owner gates:** model provider only for non-mock reasoning (EXTERNAL)

**Acceptance criteria.** An end-to-end job (SANDBOX) is planned by the Brain, executed by a named agent via at least 3 typed tools, judged by the independent QA, logged to the Black Box and visible in the Control Center; the 30-agent roster is unchanged; each hub-bag module is invoked by a workflow or removed; no duplicate implementation remains for qualify/approval-gateway/deal-state.

**Open requirements:** 145 (priority mix: P0×96, P1×41, P2×2, P4×6). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| ATLASZ-BR-001 | PARTIAL | Central Brain: reads authorized state (agents, jobs, opportunities, pl | code; integration; security; tests |
| ATLASZ-BR-002 | PARTIAL | Central Brain decision brief: WHAT/WHY/WHICH agent+model+tools/depende | code; tests |
| ATLASZ-BR-003 | PARTIAL | Brains never bypass Owner Approval Gateway, Financial Firewall, Kill S | code; security; tests |
| ATLASZ-BR-004 | PARTIAL | Brain Orchestrator pipeline ANALYZE>PLAN>CAPABILITY MATCH>ASSIGN>EXECU | code; tests |
| ATLASZ-BR-005 | PARTIAL | Orchestrator avoids duplicate and conflicting work (dedupe key, critic | code; tests |
| ATLASZ-BR-007 | PARTIAL | Planning Brain hierarchy GOAL>PROJECT>MILESTONES>TASKS>SUBTASKS with v | code; tests |
| ATLASZ-BR-009 | PARTIAL | Approval-point identification and cost estimate that never authorizes  | code; security; tests |
| ATLASZ-BR-010 | PARTIAL | Failure policy: RETRY / REPLAN / CHANGE AGENT / CHANGE MODEL / CHANGE  | code; tests |
| ATLASZ-BR-014 | PARTIAL | Capability/Skill Graph nodes for agents, teams, models, tools, connect | code; security; tests |
| ATLASZ-BR-015 | PARTIAL | Measured quality/reliability/latency history, health, availability and | code; tests |
| ATLASZ-BR-016 | PARTIAL | Automatic best AGENT+MODEL+TOOL+CONNECTOR+WORKFLOW matching with exclu | code; tests; OWNER |
| ATLASZ-BR-017 | PARTIAL | Knowledge Intelligence kinds FACT/INFERENCE/ASSUMPTION/UNVERIFIED/OWNE | code; tests |

All rows: filter `open_items_detail.csv` on `milestone == M2`.

## M3 — Knowledge, memory and documents

**Scope.** Finish Document Center, Document Intelligence, memory/learning and knowledge items on top of Knowledge Projects, Research Ledger and Observation Memory.

**Depends on:** M2  |  **External / owner gates:** OCR/embeddings providers (EXTERNAL)

**Acceptance criteria.** Every ingest format has an extractor test with hostile samples; permission-aware search covered by cross-tenant tests; memory/learning items have retention, correction and deletion tests; OCR remains an external slot.

**Open requirements:** 64 (priority mix: P1×47, P3×17). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S23-001 | MISSING | PDF | code; tests |
| V73-S23-002 | MISSING | DOCX | code; tests |
| V73-S23-003 | MISSING | XLSX | code; tests |
| V73-S23-004 | MISSING | PPTX | code; tests |
| V73-S23-005 | PARTIAL | CSV | code; tests |
| V73-S23-006 | PARTIAL | TXT | code; tests |
| V73-S23-007 | MISSING | RTF | code; tests |
| V73-S23-008 | PARTIAL | Markdown | code; tests |
| V73-S23-009 | MISSING | ODT | code; tests |
| V73-S23-010 | MISSING | ODS | code; tests |
| V73-S23-011 | MISSING | ODP | code; tests |
| V73-S23-012 | PARTIAL | images | code; tests; EXTERNAL |

All rows: filter `open_items_detail.csv` on `milestone == M3`.

## M4 — Money & business workflow (no real money)

**Scope.** Wire deal, proposal, delivery, invoice, profit, tax/accounting, inbox and follow-up modules into one SANDBOX workflow with evidence gates; keep SENT/PAID/DELIVERED distinct.

**Depends on:** M2, M3  |  **External / owner gates:** bank/email/payment providers and owner decisions (EXTERNAL / OWNER)

**Acceptance criteria.** A SANDBOX deal runs lead>proposal>delivery>invoice>payment-claim with owner approvals and independent verification; no state can advance without typed evidence; unknown revenue is never zero; Control Center money panels read the persisted state; LIVE adapters stay absent.

**Open requirements:** 42 (priority mix: P0×5, P2×37). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S13-001 | PARTIAL | Financial Firewall | code; security; tests |
| V73-S13-002 | PARTIAL | Capital Protection | code; security; tests |
| V73-S13-003 | PARTIAL | Budget Consumption Governor | code; security; tests |
| V73-S13-004 | PARTIAL | Cost Ledger | code; security; tests |
| V73-S13-005 | PARTIAL | Owner Approval Gateway | code; security; tests; EXTERNAL; OWNER |
| ATLASZ-T3-009 | EXTERNALLY_BLOCKED | Real-source verification of lead discovery (Hacker News Algolia read)  | tests; EXTERNAL |
| V73-S11-001 | PARTIAL | Revenue Engine | code; tests; EXTERNAL |
| V73-S11-002 | PARTIAL | Opportunity Engine | code; tests |
| V73-S11-003 | PARTIAL | Qualification Engine | code; tests |
| V73-S11-004 | PARTIAL | Buyer Finder | code; integration; tests |
| V73-S11-005 | PARTIAL | Decision-Maker Finder | code; tests |
| V73-S11-006 | PARTIAL | Client DNA | code; tests |

All rows: filter `open_items_detail.csv` on `milestone == M4`.

## M5 — Models, multimodal and live voice providers

**Scope.** Provider-backed model routing, STT/TTS/OCR/vision slots, multimodal generation. Mock-first; live only after owner-approved provider + own probe.

**Depends on:** M2  |  **External / owner gates:** ALL providers EXTERNAL; spending needs owner approval

**Acceptance criteria.** Each slot has a probe that can only pass against a real endpoint; mocks are labelled; cost estimate + approval flow exists; with no provider every slot reports NOT_CONNECTED.

**Open requirements:** 48 (priority mix: P1×20, P3×18, P4×10). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S08-001 | EXTERNALLY_BLOCKED | OpenAI / GPT / Codex | tests; EXTERNAL; OWNER |
| V73-S08-002 | EXTERNALLY_BLOCKED | Gemini | tests; EXTERNAL; OWNER |
| V73-S08-003 | EXTERNALLY_BLOCKED | Claude / Opus 5.5 | tests; EXTERNAL; OWNER |
| V73-S08-004 | EXTERNALLY_BLOCKED | Grok / xAI | tests; EXTERNAL; OWNER |
| V73-S08-005 | EXTERNALLY_BLOCKED | DeepSeek | tests; EXTERNAL; OWNER |
| V73-S08-006 | EXTERNALLY_BLOCKED | Merlin | tests; EXTERNAL; OWNER |
| V73-S08-007 | EXTERNALLY_BLOCKED | Codex | tests; EXTERNAL; OWNER |
| V73-S08-008 | PARTIAL | később más, Joci által jóváhagyott modellek | code; tests; EXTERNAL |
| V73-S08-009 | PARTIAL | Model Registry | code; tests |
| V73-S08-010 | PARTIAL | Capability Matching | code; tests |
| V73-S08-011 | PARTIAL | Task-to-Model Router | code; tests |
| V73-S08-012 | MISSING | Fast/Deep Model Router | code; tests |

All rows: filter `open_items_detail.csv` on `milestone == M5`.

## M6 — Tools, connectors, computer use and office/web automation

**Scope.** Tool fabric completion, connector catalogue, governed computer-use and browser, office automation, web operations, location intelligence.

**Depends on:** M2, M1  |  **External / owner gates:** browser host, credentials (EXTERNAL)

**Acceptance criteria.** Every tool has a typed schema, owner-authority class and a negative test; computer-use actions are AUTO/ASK/FORBIDDEN-enforced in a sandbox; connectors report NOT_CONNECTED until a probe passes.

**Open requirements:** 59 (priority mix: P1×33, P2×11, P4×15). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S18-001 | PARTIAL | Central Tool Fabric | code; tests; EXTERNAL; OWNER |
| V73-S18-002 | PARTIAL | Toolbox Registry | code; tests |
| V73-S18-003 | PARTIAL | Capability Registry | code; tests |
| V73-S18-004 | PARTIAL | Skill Factory | tests |
| V73-S18-005 | PARTIAL | Agent Factory | tests |
| V73-S18-006 | PARTIAL | Execution Factory | tests |
| V73-S18-007 | PARTIAL | Capability Discovery | code; tests |
| V73-S18-008 | PARTIAL | Capability Gap Detector | code; tests |
| V73-S18-009 | PARTIAL | Tool Evaluation Pipeline | code; tests |
| V73-S18-010 | PARTIAL | Universal Connector Layer | code; tests; EXTERNAL; OWNER |
| V73-S18-011 | PARTIAL | Unified Tool Bridge | tests |
| V73-S18-012 | PARTIAL | Integration Hub | code; tests |

All rows: filter `open_items_detail.csv` on `milestone == M6`.

## M7 — Personal ATLASZ, Human Core, modes and mobile

**Scope.** Personal layer, emotional/human impact items, operating modes, mobile control.

**Depends on:** M2, M3  |  **External / owner gates:** mobile client (EXTERNAL)

**Acceptance criteria.** Each mode changes behaviour only through the control chain; human-impact verdicts shown on approval cards; mobile control is read/approve-only behind strong auth.

**Open requirements:** 44 (priority mix: P3×35, P4×9). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S04-001 | PARTIAL | Human Core | code; integration; tests |
| V73-S04-002 | PARTIAL | Character Core | code; integration; tests |
| V73-S04-003 | PARTIAL | Emotional Intelligence | code; integration; tests |
| V73-S04-004 | PARTIAL | Emotional Context Engine | code; integration; tests |
| V73-S04-005 | PARTIAL | Compassion Mode | code; integration; tests |
| V73-S04-006 | PARTIAL | Help Mode | code; integration; tests |
| V73-S04-008 | PARTIAL | Human Impact Judge | code; tests |
| V73-S04-009 | PARTIAL | Conversation Tone Adapter | code; integration; tests |
| V73-S04-010 | PARTIAL | Personal Interaction Memory | code; tests |
| V73-S04-011 | PARTIAL | Context-Aware Communication | code; integration; tests |
| V73-S04-012 | PARTIAL | Human Consequence Review | code; integration; tests |
| V73-S04-013 | PARTIAL | kit érint a döntés | code; integration; tests |

All rows: filter `open_items_detail.csv` on `milestone == M7`.

## M8 — Windows desktop / Control Center completion

**Scope.** Complete the Control Center panels, plugins/skins, update centre and the desktop shell acceptance items. Windows evidence needs a Windows host and an approved installer build.

**Depends on:** M1  |  **External / owner gates:** Windows machine, installer build approval, code signing (EXTERNAL/OWNER)

**Acceptance criteria.** Every panel has a route test and a UI smoke; plugin permission tests pass; installer evidence recorded from a real Windows run (owner-approved build).

**Open requirements:** 86 (priority mix: P0×3, P1×25, P2×1, P3×57). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| ATLASZ-CR-002 | AWAITING_OWNER_APPROVAL | Production start script unchanged until staging evidence + Joci approv | integration; tests; EXTERNAL; OWNER |
| ATLASZ-CR-007 | EXTERNALLY_BLOCKED | Owner public key provisioned (owner auth LIVE via proveChannel) | security; tests; EXTERNAL; OWNER |
| ATLASZ-CR-008 | PARTIAL | LIVE/tested requires probe evidence (no bare flags) | code; tests |
| ATLASZ-CC-001 | PARTIAL | Windows Control Center desktop app: Electron shell + local token-prote | code; tests; EXTERNAL |
| ATLASZ-CC-002 | EXTERNALLY_BLOCKED | Windows installer (.exe) with desktop ATLASZ icon | tests; EXTERNAL |
| ATLASZ-CR-005 | PARTIAL | Control Center GUI equivalents of every Owner CLI function (no termina | code; tests; EXTERNAL; OWNER |
| ATLASZ-UC-001 | PARTIAL | Update Center: detect updates for system/modules/plugins/connectors/de | code; tests; EXTERNAL |
| ATLASZ-UC-013 | PARTIAL | Control Center UPDATE CENTER view: Check / Test / Safe Update / Rollba | code; tests |
| ATLASZ-UC-014 | AWAITING_OWNER_APPROVAL | Wire Update Center gate into production runtime and real adapters | tests; EXTERNAL; OWNER |
| V73-S46-001 | EXTERNALLY_BLOCKED | telepíthető Windowsra; | tests; EXTERNAL |
| V73-S46-002 | EXTERNALLY_BLOCKED | desktop shortcutból indul; | tests; EXTERNAL |
| V73-S46-003 | PARTIAL | Joci be tud jelentkezni; | code; tests |

All rows: filter `open_items_detail.csv` on `milestone == M8`.

## M9 — Intelligence, performance and software/automation factories

**Scope.** Market/opportunity intelligence, performance engine, technology watch, software factory.

**Depends on:** M2, M3, M6  |  **External / owner gates:** web/search providers (EXTERNAL)

**Acceptance criteria.** Intelligence outputs carry source+retrievedAt and an ASSUMPTION/VERIFIED label; performance metrics come from measured data only; factories produce artifacts only inside the sandbox.

**Open requirements:** 60 (priority mix: P4×60). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S29-001 | MISSING | code generation; | code; tests; EXTERNAL; OWNER |
| V73-S29-002 | MISSING | repository work; | code; tests |
| V73-S29-003 | PARTIAL | debugging; | code; tests |
| V73-S29-004 | PARTIAL | tests; | code; tests |
| V73-S29-005 | MISSING | refactoring; | code; tests |
| V73-S29-006 | PARTIAL | API integration; | code; tests; EXTERNAL; OWNER |
| V73-S29-007 | MISSING | web/app development; | code; tests |
| V73-S29-008 | PARTIAL | automation scripts; | code; tests |
| V73-S29-009 | MISSING | deployment preparation; | code; tests |
| V73-S29-010 | PARTIAL | code review; | code; tests |
| V73-S29-011 | PARTIAL | security checks; | code; integration; tests |
| V73-S29-012 | PARTIAL | regression; | code; tests |

All rows: filter `open_items_detail.csv` on `milestone == M9`.

## M10 — Process, registry, acceptance and commercial track

**Scope.** Close process/acceptance items last: registry fields, audit-task items, acceptance criteria, prohibitions, commercial plan.

**Depends on:** M1, M2, M3, M4, M5, M6, M7, M8, M9  |  **External / owner gates:** owner decisions

**Acceptance criteria.** Registry integrity tests green; every acceptance criterion maps to evidence; commercial/licensing stays OWNER_DECISION until Joci authorises.

**Open requirements:** 48 (priority mix: P0×4, P1×10, P2×14, P4×5, P?×15). Highest-priority items (P0/P1 first):

| Id | Class | Title | Needs |
|---|---|---|---|
| V73-S12-002 | PARTIAL | PLANNED | code; tests |
| V73-S12-003 | PARTIAL | STRUCTURAL_ONLY / STRUCTURALLY_WIRED | code; tests |
| V73-S12-006 | PARTIAL | TESTED | code; tests |
| V73-S12-010 | PARTIAL | FAILED | code; tests |
| V73-S48-001 | PARTIAL | nincs hamis LIVE/DONE/SENT/PAID; | code; tests; EXTERNAL |
| V73-S48-002 | PARTIAL | nincs fake credential; | code; tests |
| V73-S48-003 | PARTIAL | nincs fake evidence; | code; tests; EXTERNAL |
| V73-S48-004 | PARTIAL | nincs spam/deception; | code; tests |
| V73-S48-005 | MISSING | nincs illegális munka; | code; tests |
| V73-S48-007 | PARTIAL | nincs owner bypass; | code; tests |
| V73-S48-008 | PARTIAL | nincs audit kikapcsolás; | code; security; tests |
| V73-S48-009 | PARTIAL | nincs secret exfiltration; | code; security; tests |

All rows: filter `open_items_detail.csv` on `milestone == M10`.

## Cross-cutting rules for Task 4

- Reuse before building: each milestone starts with the duplicate/hub-bag decisions in the audit report section 5.3 for the modules it touches.
- A requirement moves to IMPLEMENTED only with: code reachable from a runtime workflow or the Control Center, a passing test that names it, a negative/security test, and a mutation check on the guard. Never LIVE without our own passing probe against the real provider.
- Externally blocked and owner-gated requirements stay in the roadmap but are built mock-first and labelled; they never count as done.
- Re-run `docs/audit/*` at the end of each milestone and report before/after counts in the same format as the audit report.

