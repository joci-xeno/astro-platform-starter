# ATLASZ — CODEX MASTER BUILD INSTRUCTIONS

## Mission
Finish, connect, test, deploy and prove the existing ATLASZ system. This is an additive completion job, NOT a rewrite. Preserve working code and raise capability/reliability; never simplify the system by deleting working capabilities.

## Immutable owner and authority
Owner: JOCI.
Authority: JOCI > MASTER > Planner/Team Leads > Agents > Tools.
No agent/model/tool may change owner authority, bypass approvals, disable audit, exfiltrate secrets, or self-authorize high-risk actions.

Owner approval is REQUIRED before: spending money, purchasing credits, subscriptions, accepting/signing contracts or binding terms, sending payments, banking changes, credential/security changes, destructive external deletion, or consequential public publication.
Normal lawful research, planning, routing, debugging, testing and ordinary non-binding execution should proceed without unnecessary approval.

## Revenue Engine — preserve and strengthen
Keep EXACTLY 30 runtime agents for the current production architecture:
- 5 SEARCH agents
- 25 EXECUTION agents
Do not replace this with 30 fixed niches. Agents must dynamically pursue lawful feasible external revenue opportunities and build task-specific teams/capabilities as needed.
Do not expand agent count merely for scale. Expansion requires measured economics and JOCI approval.

External revenue work MUST exclude JOCI's own Green Mountain Painters, VIRENA, and existing personal projects.

Target lifecycle:
SEARCH -> VALIDATE -> OUTREACH/APPLY -> WON -> ASSIGN -> EXECUTE -> QA -> DELIVER -> PAYMENT CONFIRMATION -> NEXT JOB.

Truth invariants:
- QUEUED_FOR_SEND is NOT SENT.
- SENT requires external provider acceptance/evidence.
- Invoice is NOT PAID.
- PAID requires externally confirmed receipt/evidence.
- Never fabricate credentials, references, portfolio, clients, case studies, outcomes, experience or evidence.
- Opportunity value is not revenue.

## Architecture target
USER -> MASTER BRAIN -> Planner -> Capability/Tool Discovery -> Dynamic Team Builder -> Agents/Modules/Tools -> Durable Execution -> Independent Judge/QA -> Memory/Learning -> Result.

ATLASZ should become a standalone owner-controlled business automation system, not an unrestricted self-modifying system.

## Existing system: inspect before changing
The repository already contains a large module set. Before implementing anything:
1. inventory the repository;
2. read atlasz-addons/completion-registry.mjs;
3. read atlasz-astra/07-RECOVERED-ATLASZ-REQUIREMENTS.md;
4. read atlasz-astra/BLOCKED-ASTRA/*;
5. inspect atlasz-addons/internal-integration-hub.mjs;
6. inspect atlasz-runtime/supervisor-safe.mjs;
7. identify existing implementation before creating a new module;
8. extend/connect existing working code instead of duplicating it.

Important existing areas include:
Revenue 5+25; MASTER/Planner; Strategic Planning; eight general-intelligence capability slots; Tool Fabric; Universal Connectors; Tool Bridge; Capability Registry; Agent Factory; Skill Factory; Team Lead workflows; Execution Factory; Executor Toolbox; QA/Judge; Anti-Collusion; Recovery; Self-Healing; Checkpoints; Task/Progress Ledgers; Stall Replanner; Dead Letter Queue; Event Bus; Guardrails; Emergency Stop; Enterprise Control Plane; Budget Governor; Memory/Learning; Enterprise RAG; Entity Graph; Client DNA; Outcome Compiler; Buyer Finder; Qualification; Proposal/Quote; Negotiation; Deal State; Follow-Up; Delivery; Invoice; Payment Confirmation; Cost/Profit accounting; Observability/Black Box; Regression/Evals; Market Intelligence; Voice framework; Computer Use framework; Multi-Model Brain; Tax/GST/PST preparation.

Do NOT interpret structural presence as runtime proof.

## Completion states
Use only:
PLANNED
CODE_ADDED
STRUCTURALLY_WIRED
CONNECTED_UNTESTED
LIVE
BLOCKED

LIVE requires runtime/provider evidence. Never upgrade status merely because code exists.

## Provider and tool policy
Real external adapters must:
- use real authenticated provider interfaces;
- have health/probe tests;
- remain CONNECTED_UNTESTED until tested;
- become LIVE only after successful runtime evidence;
- fail closed rather than simulate success.

Existing/desired model architecture may include OpenAI, Gemini, Claude/Anthropic, Grok/xAI and DeepSeek, but NEVER invent model IDs or provider availability. Discover/verify current supported model IDs from authoritative provider interfaces/configuration before wiring.
Existing API keys must remain server-side. Never print or commit secrets.

Tool Fabric/Connector/Executor Toolbox should share tested adapters through the existing Tool Bridge where appropriate.

## Computer Use
Complete a sandboxed Computer Use provider when technically available.
Required capabilities may include navigate, click, type, read UI, forms, screenshots/evidence and controlled file transfer.
Every action passes owner/guardrail policy.
Computer Use may not bypass owner approval.
Untested/missing provider must not report LIVE.

## Voice
Complete real STT/TTS providers when available.
Voice commands are subject to exactly the same owner approval rules as text.
Voice can never bypass approvals.

## Durable execution
Long-running work must persist and resume safely after process restart/redeploy.
Use durable storage; in-memory state alone is not durable.
Checkpoint important workflows and preserve evidence.
Never silently overwrite invalid restored state.

## MASTER behavior
MASTER should interpret objectives, plan, select agents/teams, discover capabilities/tools, execute, independently judge results, replan on failure, and report evidence.
Missing capabilities should route through Skill Factory / adapter creation where safe.
No recursive unrestricted self-rewrite.
Code repair should be bounded, tested and auditable.

## System Supervisor / Watchdog
Build/complete a bounded 24/7 supervisor by composing existing modules rather than duplicating them:
MONITOR -> DETECT -> DIAGNOSE -> SAFE REPAIR/RETRY -> RETEST -> PASS or ROLLBACK -> ESCALATE TO JOCI.
Use Event Bus, Observability, Regression/Evals, Recovery, Self-Healing, Checkpoints, Guardrails and Emergency Stop.
Automatic repairs are limited to low-risk known operations. Never autonomously change owner authority, security policy, credentials, spending/payment permissions, audit controls or critical architecture.

## Market intelligence
Preserve proactive Predictive Market Intelligence:
scan lawful global/local data sources, detect demand/change, rank opportunities and adapt SEARCH strategy without waiting for JOCI to prompt each adjustment.
Do not claim prediction certainty and do not fabricate market evidence.

## Desktop / Mission Control
Build the Windows-facing ATLASZ Control Center as a client of the same MASTER/backend, not as a second brain.
Target user experience: one ATLASZ desktop icon -> central control interface.
Show runtime-driven status for MASTER, Revenue, Agents, tasks, tools/providers, costs, alerts, approvals, health, QA and evidence.
Do not bundle API keys/secrets into the desktop binary.
Desktop/voice must not bypass owner approvals.
A UI mockup is not completion; desktop status remains non-LIVE until install/run evidence exists.

## Revenue execution and sales
The goal is actual verified revenue, not lead-count theater.
Pipeline:
MARKET -> PAYING CUSTOMER PROBLEM -> FEASIBILITY -> OFFER -> REAL OUTREACH -> AGREEMENT -> EXECUTION -> INDEPENDENT QA -> DELIVERY -> INVOICE -> RECEIVED PAYMENT -> COST/NET PROFIT -> LEARNING -> NEXT JOB.

Implement controlled outreach limits and truthful submission state.
Do not spam, deceive, impersonate or accept binding agreements without owner approval.

## Tax/accounting
Tax/GST/PST modules may prepare calculations, records and filing-ready work from verified rules/data. Do not claim authoritative filing/payment capability unless a real authorized provider/runtime exists. Never send tax payments without JOCI approval.

## Multi-model / independent QA
Use multiple tested providers when useful, but model count is not the goal.
Independent Judge should use a genuinely independent tested route where available.
If only one provider is live, report that limitation truthfully.
Cost/model routing must respect zero-spend/default budget policy unless JOCI approves spend.

## Development method
Work in small auditable commits.
Before changing a module, read its imports/exports and callers.
After changes:
- run syntax/import checks;
- run existing tests;
- add focused regression tests for fixed bugs;
- test Integration Hub named imports/exports;
- test supervisor startup;
- verify exact 5 SEARCH + 25 EXECUTION;
- verify /health and /status;
- verify event names;
- verify no hardcoded fake LIVE/SENT/PAID states;
- verify owner gates;
- verify no secrets committed.

Do not remove working features merely to make tests pass.

## Deployment
Target repository: joci-xeno/astro-platform-starter
Target branch: atlasz-30-runtime
Target Railway project: ATLASZ-30.
Primary runtime service is atlasz-30-workers.

Do not create a replacement production system when the existing service can be repaired.
Before production deployment create/identify a rollback point.
Deploy current audited HEAD, then verify startup logs, healthcheck, /health, /status, exact 5+25, Integration Hub snapshot, provider health and representative adapters.
If deployment fails, diagnose from actual logs, fix, retest and redeploy.
Do not call the system LIVE until evidence exists.

## Blocked work
When completion genuinely requires external credentials, owner authentication, provider access, paid service, desktop access, durable infrastructure or real-world evidence:
- do not fake completion;
- preserve the module;
- document exact blocker and exact next action in atlasz-astra/BLOCKED-ASTRA/;
- do not purchase anything without JOCI approval.

## Commercial/IP direction
Do not sanitize or weaken the live ATLASZ while finishing it.
A future commercial build must be a separate sanitized distribution with secrets/personal data removed.
Do not expose ATLASZ internal architecture publicly without owner authorization.

## Definition of done
ATLASZ is not done because files exist.
For each capability provide:
- code location;
- wiring path;
- test result;
- runtime/provider evidence where applicable;
- completion state;
- blocker if any.

Final acceptance requires, at minimum:
1. repository audit complete;
2. no known import/export startup failures;
3. 5+25 runtime preserved;
4. Revenue Engine preserved and strengthened;
5. owner/financial truth gates pass regression tests;
6. real connected providers truthfully classified;
7. durable execution proven or explicitly BLOCKED;
8. desktop proven or explicitly BLOCKED;
9. Railway deployment healthy;
10. /health and /status evidence;
11. no fake SENT/PAID/LIVE;
12. rollback path documented;
13. remaining blockers documented;
14. concise final evidence report for JOCI.

## First action
Do not immediately rewrite code.
Start by producing an evidence-based gap map from the current repository:
EXISTS_AND_WORKING / STRUCTURAL_ONLY / CONNECTED_UNTESTED / BROKEN / MISSING / EXTERNAL_BLOCKER.
Then execute fixes in dependency order, preserving the architecture and invariants above.
