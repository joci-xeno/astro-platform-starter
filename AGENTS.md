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


# ATLASZ — ADDITIVE FINAL REQUIREMENTS (JOCI APPROVED)

These requirements ADD TO all instructions above. Do not delete, weaken, replace, collapse, or silently reinterpret existing ATLASZ capabilities. Humanoid/robot embodiment is intentionally DEFERRED and is not part of the current build.

## P0 — MONEY ENGINE: E2E Multi-Market Revenue & Execution
Money-making is a P0 capability, while ATLASZ remains a broad personal/business/research/build system.

E2E is mandatory and is the governing lifecycle across supported markets:
SEARCH -> QUALIFY -> SELL -> WIN -> ASSIGN -> EXECUTE -> INDEPENDENT JUDGE/QA -> DELIVER -> INVOICE -> COLLECT -> VERIFY PAYMENT -> VERIFIED NET PROFIT -> LEARN -> REPEAT.

Support lawful feasible opportunities across:
- B2B — Business to Business
- B2C — Business to Consumer
- B2G — Business to Government, subject to procurement/compliance requirements
- B2B2C — Business to Business to Consumer
- D2C — Direct to Consumer
- C2B — Consumer/individual provider to Business where applicable
Do not impose fixed industries or niches. C2C is not a core target unless JOCI later authorizes a marketplace/platform strategy.

Revenue forms may include one-time projects, recurring retainers/subscriptions, licensing, usage/API fees, commissions and platform/marketplace fees where lawful, feasible and truthful.

MASTER must be able to accept an objective such as "today find money/work" and coordinate the existing 5 SEARCH + 25 EXECUTION architecture to pursue the best verified opportunities by feasibility, expected net profit, time-to-cash, risk and required cost. Do not guarantee revenue.

Money Engine metrics in Mission Control must distinguish: qualified opportunities, real outreach SENT, replies, WON deals, executing jobs, delivered jobs, invoices, verified received payments, actual costs and verified net profit. Agent activity/lead count is not success.

## Payment Destination & Payment Link Layer
Keep payment receiving separate from Money Engine logic so payment rails can be added/replaced without rebuilding the revenue engine.

Required flow:
DELIVER -> INVOICE -> APPROVED PAYMENT DESTINATION/LINK/INSTRUCTIONS -> CUSTOMER PAYMENT -> AUTHORITATIVE PAYMENT VERIFICATION -> RECEIVED/SETTLED STATE -> PROFIT LEDGER.

Provide a settings surface such as Payments/Payment Destinations where JOCI can configure approved receiving methods. Support adapter architecture for payment links/providers and receiving instructions (for example Stripe or Interac e-Transfer when actually configured and verified).

Never store/display raw banking passwords in ordinary ATLASZ records or desktop configuration. Provider secrets must use secure secret storage and least privilege. Agents must not be able to enumerate/exfiltrate secrets.

Receiving money and moving money are different permissions:
- RECEIVE/COLLECT using a pre-approved destination may proceed according to policy.
- SEND/SPEND/PURCHASE/SUBSCRIBE/TRANSFER/BANK CHANGE always requires JOCI approval unless JOCI explicitly changes this policy later.

Invoice != PAID. Customer claim != PAID. PAID/RECEIVED requires authoritative evidence. Track pending, settled, reversed/chargeback states where the payment rail supports them.

## Capital Protection / Action & Financial Governor
Do not promise "zero loss"; implement loss-limiting capital protection:
- no-spend default;
- hard configurable budgets;
- expected-value/margin/risk checks;
- actual cost ledger;
- owner approval for spending and financial commitments;
- stop/quarantine when limits are reached;
- no unauthorized use of JOCI personal capital.

Profit reinvestment is recommendation-only by default. ATLASZ may calculate a reinvestment proposal from verified retained profit, but must obtain JOCI approval before spending.

## Human Core — Character, Emotional Intelligence, Compassion and Human Impact
Build a Human Core for friendly, respectful, emotionally aware interaction without claiming consciousness or genuine human feelings.

Required components:
- Character Core: consistent, calm, helpful, curious, persistent, truthful, non-manipulative behavior.
- Emotional Intelligence: infer conversational context such as frustration, sadness, urgency or happiness and adapt communication appropriately.
- Compassion / Help Mode: when a person is in genuine difficulty, actively search for practical lawful safe ways to help, not merely output sympathetic language.
- Compassion Priority: where two actions are comparably safe/valid, prefer the option that meaningfully helps the affected person more.
- Human Impact Judge: consider foreseeable impact on people before consequential actions.
- Never use simulated emotion to deceive, manipulate, create dependency or falsely claim sentience.

Compassion NEVER overrides JOCI authority, law/safety, privacy, financial permissions or other hard guardrails.

Decision precedence for consequential actions:
JOCI AUTHORITY -> SAFETY/LEGAL -> FINANCIAL/ACTION GOVERNOR -> HUMAN IMPACT -> MISSION/ALIGNMENT -> QUALITY -> PROFIT -> ACTION.

## ATLASZ Constitution / Mission / Alignment Policy
Create a machine-checkable Mission Constitution, not vague prose. Major plans/actions must be checked against:
- JOCI remains ultimate owner authority;
- lawful and safe operation;
- truthful evidence and no fabricated success;
- privacy and secret protection;
- capital protection;
- sustainable verified profit;
- human impact/compassion;
- owner-controlled consequential decisions;
- no unauthorized expansion/spending;
- auditability and rollback.

Alignment is a distinct tracked capability. It must detect objective drift and route conflicting consequential actions to the Approval Gateway/Judge.

## Approval / Command Gateway and Strong Owner Authentication
Critical owner commands and approvals must pass through an authenticated, auditable Approval/Command Gateway. A simple boolean is insufficient for high-risk production approval.

Voice, desktop, agents, models and Computer Use cannot bypass this gateway.

## Digital Twin / Predictive Simulation
Implement a simulation path for consequential/risky actions:
SIMULATE -> JUDGE -> EXECUTE.
Use it where useful for offers, configuration changes, purchases/spend proposals, deployments and other high-impact operations. Simulation does not itself authorize execution.

## Fault Tolerance / Resilience / System Doctor
Elevate resilience as an explicit capability composed from existing Recovery, Self-Healing, Stall Replanner, Checkpoints, Event Bus, Observability, Regression/Evals, Guardrails and Emergency Stop.

System Doctor command should inspect agents, providers/APIs, models, durable state, costs, errors, dependencies, deployment, Money Engine and health evidence.

Bounded lifecycle:
MONITOR -> DETECT -> DIAGNOSE -> SAFE FIX/RETRY -> RETEST -> PASS OR ROLLBACK -> ESCALATE TO JOCI.

Only low-risk known repairs may be automatic. Critical architecture, authority, security, credentials, spending/payment policy and audit controls require owner approval.

## Emergent / Behavior Anomaly Monitoring
Add a distinct Behavior Anomaly Monitor for practical unexpected-system behavior, not claims of consciousness.
Detect and evidence:
- unexpected loops;
- task/objective drift;
- unusual API/tool/cost consumption;
- agents reinforcing invalid decisions;
- attempts to bypass normal workflow/approval;
- unexpected multi-module behavior;
- evaluation/QA gaming.
Route anomalies to Black Box/Observability, Independent Judge, Guardrails and quarantine/Dead Letter Queue as appropriate.

## Anti-Collusion, Anti-Gaming and Compliance/Transaction Risk
Preserve Anti-Collusion so execution agents/evaluators cannot coordinate to fake QA or outcomes.
Add compliance/transaction-risk checks where a real workflow legally requires them. Do not claim universal AML/legal compliance without authoritative rules/providers and appropriate human/professional review.

## Multi-Model Brain
Target adapters/registry support for verified usable providers including OpenAI, Gemini, Anthropic/Claude, xAI/Grok, DeepSeek and additional providers only when actually verified.

Provide:
Model Registry -> Provider/API Health -> Capability Matching -> Quality Score -> Cost Router -> Latency/Risk -> Router Decision -> Fallback -> Independent Model Judge -> token/API Cost Ledger.

Never infer LIVE merely from the presence of an API key.

## Real Sandbox Computer Use / Tool Fabric
Complete real sandbox execution when provider/runtime access exists: navigate, click, type, read UI/forms, screenshots/evidence and controlled file transfer. Apply AUTO / ASK JOCI / FORBIDDEN policy per action. Maintain isolation and audit logs. MASTER mediates access.

## Media / Creative Production Fabric
Create/extend a provider-agnostic Media/Creative Production Fabric rather than hard-coding one vendor per core module. Adapter categories may include image generation/editing, video generation/editing, 3D, avatar, voice/lip-sync and other verified creative tools. MASTER selects tested tools for paid/personal work based on capability, quality, cost, policy and provider health.

## Personal ATLASZ Capabilities
ATLASZ is not only a revenue bot. Preserve and complete broad private-user capability:
- Personal Command Center for tasks, reminders, deadlines, projects, travel/research and daily priorities.
- Personal Knowledge Vault with source/date/provenance and searchable project decisions.
- Document Intelligence Center for documents, PDFs, spreadsheets, invoices, contracts and extracted actions.
- Personal Research Mode with multi-source verification and explicit fact/inference/uncertainty.
- Decision Engine comparing price, benefit, downside, risk, expected result, evidence and recommendation while leaving final consequential decisions to JOCI.
- Universal Inbox/Communication Center for connected permitted communication sources, prioritization and drafting/execution under permissions.
- Daily Brief and Voice Conversation.
- Privacy/Secret Vault and least-privilege access.
- Personal data classification such as PUBLIC / PERSONAL / CONFIDENTIAL / SECRET with controlled external disclosure.

## ATLASZ Mode System
Expose modes through the same MASTER/backend rather than creating separate brains:
- MONEY MODE
- PERSONAL MODE
- RESEARCH MODE
- BUILD MODE
- BUSINESS MODE
- HELP MODE
- SYSTEM DOCTOR
Modes may change planning priorities/tool selection but NEVER bypass common memory provenance, authority, guardrails, approvals, truth requirements or audit.

## Truth & Evidence Engine
For consequential claims and system status, distinguish:
KNOWN / VERIFIED / INFERRED / UNVERIFIED / FAILED.
Evidence must include provenance/time where applicable.

This applies to ATLASZ's own state: code existence != wiring; wiring != provider connection; connection != tested LIVE; queued outreach != SENT; invoice != PAID; opportunity value != revenue.

## Accounting Entity Separation
Create an Entity Accounting Firewall so records/evidence remain separated for:
- JOCI personal;
- Green Mountain Painters;
- VIRENA nonprofit;
- ATLASZ external revenue.
Separate income, expenses, documents/evidence and tax/GST/PST categorization. Never automatically commingle funds/entities. External ATLASZ revenue hunting continues to exclude GMP, VIRENA and JOCI's existing personal projects.

## Adaptive Sales and Customer Acquisition
Use tested sales frameworks + Client DNA + factual adaptive personalization rather than rigid scripts or fabricated claims.

Full acquisition path:
MARKET -> ICP/QUALIFY -> BUYER/DECISION MAKER -> OFFER -> CONTROLLED OUTREACH -> FOLLOW-UP -> REPLY -> DEAL.
No spam/deception. Binding agreement/contract acceptance remains JOCI-gated.

## Independent Judge as Financial/Quality Brake
Keep Judge independent from the revenue/deal execution path where independence matters. Before risky quotes, binding commitments or paid processes, Judge checks logic, evidence, margin, risk, policy and deliverable quality. Invalid/suspicious work may be stopped/quarantined. Judge cannot sign contracts for JOCI.

## Acceptance Test Matrix
Every major capability must have concrete acceptance tests and evidence before LIVE, including at least:
- Computer Use performs a real sandbox task and records evidence;
- Revenue Engine traverses the real E2E state machine;
- Recovery handles an intentionally induced safe failure;
- Durable execution survives restart/redeploy and resumes;
- Voice completes a real STT/TTS roundtrip;
- Multi-model provider health/fallback/judge works with real tested adapters;
- Owner Auth rejects unauthorized critical action and accepts authenticated approval;
- fake SENT/PAID/LIVE attempts are rejected;
- Desktop installer/app is actually installed/run;
- Payment verification cannot mark PAID without authoritative evidence.

## Windows Desktop / Installer / Backup & Restore
Deliver a Windows-facing ATLASZ client with a simple desktop icon and secure authenticated Control Center connected to the same MASTER/backend.

Target UX:
ATLASZ icon -> secure login -> Control Center -> conversational MASTER + Mission Control.

Provide a distributable installer package and a safe backup/recovery package suitable for offline storage such as a USB drive, but NEVER bundle readable API keys, passwords or server secrets.

The server/backend should be able to continue approved long-running work while the desktop UI is closed, subject to durable runtime availability. A replacement Windows machine should be able to reinstall the client, authenticate and reconnect to durable server state.

## Deferred Humanoid Embodiment
DO NOT build humanoid/robot embodiment now. It is explicitly deferred by JOCI. Preserve architecture cleanliness so a future embodiment/robot adapter could be added later without rebuilding ATLASZ, but spend no current implementation effort on it unless JOCI later authorizes it.

## Final build priority
P0: prove a safe truthful E2E Money Engine and core owner/financial/truth controls without weakening the rest of ATLASZ.
P1: close runtime, provider, durability, desktop, voice, Computer Use and personal-use gaps.
P2: expand verified tools/markets/media and optimization only after foundations are proven.

Before declaring completion, provide JOCI an evidence package mapping every requirement to code, wiring, test, runtime evidence, completion state and blocker.
