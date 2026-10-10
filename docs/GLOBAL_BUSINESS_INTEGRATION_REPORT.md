# ATLASZ V7.3 — Global Business Package Integration Report (PLANNING ONLY)

Status: inventory and plan. **No code was written for this package** and none will be until the owner separately authorizes implementation.
Base: branch `atlasz-v73-integration` @ 3356d7b. 85-capability status is unchanged: 18 VERIFIED_WORKING / 44 PARTIAL / 1 MISSING / 22 EXTERNAL_BLOCKER.

## 0. Sources and honesty notes
- Master spec: "GLOBAL BUSINESS INTELLIGENCE & AUTOMATIC AI MODEL EVOLUTION" (14 sections) + the integration instruction (6 points). Both were supplied as attachments in this session.
- The saved **23-point package, 150-item package and SECURITY FORTRESS 12 specification are NOT in the repository** (no matches in any .md/.py/.mjs/.json). They cannot be compared and their content is not invented here. Please supply them (or confirm that the registry IDs ATLASZ-PKG84-*, V73-S*, ATLASZ-BR/CR/OSC/SV already represent them).
- "Implemented" below means code exists and is tested at the level stated in the 85-capability registry. It does not mean LIVE or VERIFIED. No external provider or discovery source is connected (no keys, no source allowlist).

## 1. Already implemented (reuse; do not duplicate)
| Spec need | Existing module | Level |
|---|---|---|
| 30-agent topology (5 SEARCH + 25 EXECUTION), runtime reports `paidAiCallsEnabled:false` | atlasz-runtime/supervisor-safe.mjs, completion-registry `revenue-5-25` | STRUCTURALLY_WIRED, fixed topology tested |
| SEARCH pipeline (screen, dedupe, source check, extract, score, qualify, feasibility, capability match, prioritize, hand-off); unknown stays unknown | brain/search-pipeline.mjs, brain/opportunity-intelligence.mjs, opportunity-qualification-engine.mjs | Works on supplied/file feeds only |
| Commercial scoring (value, cost, probability, time, risk) | opportunity-qualification-engine, money-supervisor (priorityScore), opportunity-intelligence | Implemented; no live data |
| Money lifecycle state machine; estimate vs agreed vs invoiced vs paid | money-pipeline-controller, profit-ledger (stages LEAD_VALUE..PAID, PAID needs confirmedReceived), profit-accounting-engine, invoice-engine, payment-confirmation-adapter | Implemented; no real payment rail |
| MASTER planning, stall detection and replan | master-planner-orchestrator, stall-replanner, brain/orchestrator, planning-brain | Implemented |
| Durable schedules / resume | scheduler.mjs (C12 VERIFIED_WORKING), checkpoint-engine, brain/disaster-recovery | Implemented |
| Model registry, routing, no-spend cost router, circuit breaker, independent judge, token/cost ledger | brain/model-intelligence (C10 VERIFIED_WORKING), model-gateway, provider-resilience, cost-model-router, multi-model-brain, financial-ledger | Tested with fakes; a provider is usable only after our own passing probe |
| Budget limits | budget-consumption-governor, financial firewall | Implemented, no-spend default |
| Learning from outcomes with owner-approved lessons | experience-learning-engine (lessons need owner approval), brain/memory-fabric | Implemented; cannot rewrite rules |
| Market signals, evidence-first | market-intelligence-engine, tech-watch (file feeds) | Offline only |
| Owner authority, kill switch, approvals, audit | owner-auth, emergency-stop, audit-chain, security-brain, behavior-monitor, black-box | C13 VERIFIED_WORKING |
| Plugin system / feature isolation / rollback of plugins | plugin-manager, restricted-node | PARTIAL (R6) |
| Control Center (agents, models, money panel, approvals, ledger) | atlasz-control-center (brain-views, money-views), runtime /status | Live from local state, not from providers |

## 2. Partially implemented
- **Model evolution (spec §7).** Registry, probe-gated usability, routing and judge exist. Missing: provider catalogue discovery, deprecation tracking, candidate lifecycle, A/B benchmark harness vs the approved model, upgrade policy object (Mode C), automatic rollback with immutable upgrade records, per-task recommendation from measured results. Provider names in code today: Gemini (supervisor.js env model name only). No OpenAI/Anthropic/DeepSeek/xAI/Ollama adapters exist.
- **Opportunity discovery (§2).** The pipeline exists but is fed by file feeds. No procurement/grant/freelance source adapters, no jurisdiction/eligibility model (physical presence, licences, insurance, registration), no company/organization record store with provenance and confidence.
- **Daily revenue persistence (Revenue Persistence Engine).** Scheduler, planner, replanner and pipeline controller exist. Missing: a continuously replenished pipeline with target tracking, "switch to next opportunity on failure" policy, multi-day carry-over of unfinished workflows (checkpoints exist, workflow-level resume is registry P08/C12 territory), waiting-on-customer parallelism.
- **Control Center (§11).** Missing panels: candidate models and benchmarks, upgrades/rollbacks, opportunities by country/source, daily target vs verified collected revenue, live/simulated/historical labels per widget.
- **Learning (§8).** Exists but per-task-type/model/agent performance aggregation and source-reliability scoring are not built.
- **Module architecture (§10).** Capability registry and plugin manifests exist; versioned interface contracts, dependency declarations and feature flags are not uniform across addons.

## 3. Missing
- Company/organization intelligence module (§3).
- Procurement/grant/freelance source adapters (§2) and a source allowlist.
- Model discovery, compatibility test suite, performance evaluation, upgrade policy and rollback (§7.1-7.6).
- Daily target engine (USD 500 minimum, USD 1,000,000 aspirational) with truthful reporting.
- Commercial licensing module (see §6). Nothing exists (no licence/tamper/reactivation code).
- Final system audit program (§5 of the integration instruction) beyond the existing R6 audit pipeline (docs/audit/*).

## 4. External blockers (cannot be done without owner action; nothing is purchased or enabled)
- Source allowlist for external discovery (standing rule: no external discovery network access until approved).
- Provider API keys and spend approval for OpenAI/Anthropic/Gemini/DeepSeek/xAI; Ollama needs a local host with GPU/RAM.
- Real payment rail and authoritative payment verification (Stripe / Interac) for any "collected revenue" figure.
- Legal/professional review for procurement eligibility, cross-border tax, contract terms and the commercial licence.
- Existing 22 EXTERNAL_BLOCKER capabilities (voice, vision, computer use, live web research, ...) stay blocked and limit what agents can execute.

## 5. Revenue Persistence Engine: requirements and constraints
Adopted as objectives, not guarantees:
- Minimum USD 500/day and aspirational USD 1,000,000/day are **targets, never caps, never forecasts and never reported as income**. The dashboard shows target vs *verified collected* only; estimates, contracted and invoiced amounts are shown separately; unknown stays unknown, never zero.
- All 5 SEARCH agents search continuously; all 25 EXECUTION agents work continuously; MASTER keeps the pipeline replenished, redistributes on failure, continues other work while awaiting replies and resumes unfinished authorized workflows the next day.
- Prioritisation key: verified collected revenue, expected net profit, payment probability, feasibility, time to revenue.

Conflicts the owner must decide (these are not silently resolved):
1. "Continuously / never stop" vs NO-SPEND, approval gates and outreach limits (AGENTS.md: controlled outreach, no spam). Proposal: continuous *search and preparation*; every send, bid, acceptance, spend remains approval-gated; daily outreach caps configurable.
2. "All countries and industries" vs no external network until an allowlist exists. Proposal: owner approves sources country by country.
3. USD target vs the CAD owner accounting and entity separation (JOCI personal / GMP / VIRENA / ATLASZ). Proposal: ATLASZ external revenue only, multi-currency recorded with FX source and date.
4. Work needing physical presence, licences or insurance is classified NOT_EXECUTABLE rather than attempted.

## 6. Commercial licensing (record only; do not implement)
Dependencies recorded for the future module, kept separate from the owner's internal instance:
- 20% owner share on contractually eligible customer Money-Making-Engine revenue; per-customer licence and accounting.
- Tamper detection that is *verified* (signed manifests, attested builds), suspension of the affected engine only, owner-only reactivation by single-use signed authorization, planned fee CAD 30,000-50,000, customer data and unrelated functionality preserved.
Open issues to settle before any design: (a) enforceability and consumer/commercial law review of remote suspension and the reactivation fee; (b) revenue-share measurement requires customer-side reporting that can be falsified (R6 limit: unkeyed hashes are tamper-evident only; this would need keyed/asymmetric signing and attestation); (c) how a customer-instance suspension relates to the JOCI-only kill switch (must be a separate control that cannot touch the owner instance); (d) data protection obligations; (e) entitlement system and tenancy isolation.

## 7. Proposed phased plan (needs owner approval per phase)
- **Phase 0 (no code):** supply the 23-point / 150-item / SECURITY FORTRESS documents; owner decisions in §9; finish the 85-capability priority list.
- **Phase 1 — Foundations, offline, no spend:** module interface contract + feature flags; organization record schema with provenance/confidence; opportunity jurisdiction/eligibility classifier; daily-target ledger view (verified collected only).
- **Phase 2 — Model evolution A/B (offline fixtures):** model candidate registry, deprecation records, policy object for Mode C, upgrade/rollback records on the audit chain, benchmark harness against recorded fixtures; Mode A/B only.
- **Phase 3 — Revenue persistence:** pipeline replenishment, failover to next opportunity, multi-day workflow resume, waiting-state parallelism; all through existing approval gates.
- **Phase 4 — Control Center panels:** models/benchmarks/upgrades, opportunities by source/country, target vs verified, live/simulated/historical labels.
- **Phase 5 — Source and provider adapters (needs allowlist, keys, spend approval):** one source / one provider at a time, health probes, CONNECTED_UNTESTED until real evidence.
- **Phase 6 — SECURITY FORTRESS integration** (only when authorized; independent verification).
- **Phase 7 — Final audit and repair cycle** (inspect, defect, repair, regression, independent verification, repeat) with WORKING/PARTIAL/MISSING/EXTERNAL_BLOCKER and reproducible evidence.
- **Separate, later:** commercial licensing module, only after its own authorization and legal review.

Cost / infrastructure: phases 1-4 need no spend (local development and tests). Phase 5 needs provider API usage (variable, set by owner budget), possible hosted DB/queue for 24/7 durability, and optionally a local model host. Phase 6 and licensing may need professional security/legal review. No figures are estimated here because no provider prices were verified.

## 8. Integration dependencies
brain/model-intelligence <- provider-resilience <- model-gateway (model evolution must extend these, not add a second router); search-pipeline -> opportunity-intelligence -> money-pipeline-controller -> profit-ledger (revenue persistence); scheduler + checkpoint-engine (multi-day resume); audit-chain + black-box (immutable upgrade/rollback records); owner-auth + financial firewall (every external effect); control-center views.

## 9. Owner decisions required
1. Provide or confirm the 23-point, 150-item and SECURITY FORTRESS sources.
2. Approve (or amend) the §5 conflict resolutions, especially continuous operation under approval gates and outreach caps.
3. Which countries and source types first; approve a source allowlist before any external discovery.
4. Which providers/families are permitted for model evolution; maximum authorized cost; whether Mode C will ever be enabled and which workflows are excluded.
5. Currency policy for targets and reporting.
6. Whether commercial licensing is to be designed at all, and the legal review route.
7. Authorization of Phase 1 (this report authorizes nothing).

## 10. What was NOT done
No code, registry status change, agent change, deployment, spend, network access to discovery sources, or change to main/Railway/payments/credentials.

---
# ADDENDUM (2026-10-09, same planning-only status): 23-point and 150-item packages received

Both documents were supplied after the report above, so §0 is superseded: they ARE now available. Still no code, no registry change. Registry rule unchanged: "present in code" is not "verified".

## A. Order of work stated by the packages
85 capabilities first (still in progress: 18/44/1/22) -> the 23-point package -> the 150 ideas only after the exact owner phrase **"Claude, begin the ATLASZ 150-capability development phase."** That phrase has not been given, so Phase A of the 150 package (the per-entry audit) was NOT started. Only the 23-point mapping below was done, as a read-only inventory.

## B. 23-point package mapped to the repository (greps of module headers only; not tested or verified here)
| # | Requirement | Existing | Gap |
|---|---|---|---|
| 1 | API Key Vault | secret-vault.mjs (AES-256-GCM, name bound as AAD, locked without key, owner-signed set/delete, names-only listing, redaction), owner-keystore.mjs (passphrase-encrypted owner key) | No encrypted backup package + separate backup passphrase + restore check, no inactivity auto-lock, no rotation/revocation workflow, no credential broker for agents (agent-tool-broker brokers tools, not credentials), master key comes from host env |
| 2 | Malware/ransomware defense | restricted-node (Node permission model + namespaces), code-sandbox, inbox security screen | No file quarantine/AV scanner integration, archive limits for uploads, ransomware monitoring, image/dependency scanning. Environment must be discovered first (Windows desktop + Linux/Railway runtime) |
| 3 | Exfiltration/intrusion prevention | secret-patterns, brain/security-brain (prompt-injection screen), guardrail-engine, rate limits, owner-auth on routes | No per-provider outbound allowlist enforcement (network namespace only for plugins), leak detection in commits not wired as a gate |
| 4 | AI Models dashboard (13 providers) | Control Center models view, model-gateway summary | Only fake/probe-gated providers; no cards for most providers; none LIVE |
| 5 | Multi-model routing | cost-model-router, provider-resilience, model-gateway, brain/model-intelligence (C10 VERIFIED_WORKING) | Gateway-vs-direct duplicate-billing guard missing; no live comparison data |
| 6 | Local AI manager (Ollama) | none | Entirely missing; needs hardware discovery and owner approval for installs/downloads |
| 7 | Chat Providers center (15) | universal-inbox, inbox-pipeline, connector-catalog | No messaging adapters; most listed providers have no lawful official API route (e.g. personal WhatsApp/WeChat/Zalo Personal, iMessage) and must stay "unavailable" |
| 8 | Markdown memory (MEMORY.md, memory/DATE.md) | project-memory (durable decisions), brain/memory-fabric, knowledge-projects | File layout not implemented; versioning/recovery partial |
| 9 | SQLite FTS5 | knowledge-projects keyword BM25 (own index, labelled not semantic) | No SQLite/FTS5; would add a dependency (decision needed) |
| 10 | Local semantic/hybrid search | enterprise-knowledge-agentic-rag (structure only) | No embeddings/vector index; needs local embedding model |
| 11 | Central coordinator/delegation | master-planner-orchestrator, brain/orchestrator, orchestrator, agent-tool-broker, stall-replanner | Partial (M04 PARTIAL) |
| 12 | Scheduled background work | scheduler.mjs (C12 VERIFIED_WORKING) | Email/calendar monitoring needs connectors |
| 13 | Proactive goal-based work | suggestions, master-brief, human-core | Goal-to-plan generation partial |
| 14 | Maker-checker | business/judge, qa-reviewer, anti-collusion-guard, brain/verifier, this R6 independent-round method | Partial; per-capability enforcement not automated |
| 15 | Secure shared workspace | tenant-isolation, shared-project-registry | Partial |
| 16 | Agent-to-agent messaging | none found (agents go through the broker only) | Missing; needs loop/runaway limits |
| 17 | Permanent agents + temporary sub-agents | fixed 30-agent roster, agent-factory (owner-gated) | Temporary sub-agents with isolated sessions/limits not built; must not enlarge the 30 |
| 18 | Dynamic model assignment | model-intelligence, cost-model-router | Per-agent assignment table missing |
| 19 | Network/system hardening | Control Center binds 127.0.0.1; owner auth | Runtime `supervisor-safe.mjs` binds 0.0.0.0 (needed for Railway; changing bind or exposure needs owner approval); not a defect found now |
| 20 | Unified Control Center | atlasz-control-center (many panels) | Missing Vault, Chat Providers, Local Models, Security Center panels; mobile |
| 21 | Autonomous problem solving | stall-replanner, self-healing, system-doctor | Partial |
| 22 | E2E testing | 1090 tests, 52 probes, mutation method, independent rounds | Security acceptance gates 1-12 not yet organised as a named suite |
| 23 | Safe self-maintenance/updates | update-center.mjs (detect, compatibility, backup/LKG, staging, tests), local-update-adapters | Source-authenticity (signing) and production steps stay owner-gated |

Overlap with the Global Business package: 4/5/18 (model evolution), 12 (revenue persistence scheduling), 20 (dashboard), 23 and 9 of the Fortress items. These should be built once.

## C. 150 ideas: scope note (no audit done)
10 groups x 15 (S, AS, OP, SN, HK, MR, GR, GE, O5, S5). The package itself warns they are not 150 unique features and that vendor attributions must not be taken as documented facts. Known ID clash to resolve in Phase A: the idea IDs GE01-GE15 collide with the existing capability IDs GE01-GE12 in the 85-capability registry; the 150 entries need a distinct prefix (e.g. "I-GE01") to keep registry IDs unambiguous. Many are near-duplicates of existing work (e.g. S08/GE03 vs checkpointing, S07/GE09/HK04 vs model-intelligence, OP07 vs requirement traceability, AS02/OP04 vs judge/code-review). Phase A, B and everything after wait for the exact phrase.

## D. Additional owner decisions raised
1. Confirm the order: finish the 85 -> 23-point package -> Global Business package, or interleave model-evolution with 23-point items 4/5/18.
2. SQLite/FTS5, an AV scanner (e.g. ClamAV) and Ollama are new dependencies/software installs, each needing approval.
3. Chat providers: approve only officially supported ones; confirm that unofficial/personal-account routes (WhatsApp personal, WeChat, Zalo Personal, Tor Messenger, iMessage bridge) remain "unavailable".
4. Whether the runtime may stay bound to 0.0.0.0 on Railway, or a hardening change is wanted (approval-gated).
