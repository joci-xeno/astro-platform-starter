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


## Completeness Lock — No Requirement Left Behind
This specification is cumulative. Codex MUST NOT treat later sections as replacements for earlier ATLASZ requirements. Preserve all existing working capabilities and reconcile requirements by the latest explicit JOCI decision where two statements conflict.

Before implementation is declared complete, build a Requirement Traceability Matrix covering:
1. every requirement in this AGENTS.md;
2. the recovered/uploaded ATLASZ requirements material referenced by the repository;
3. every currently registered capability in completion-registry.mjs;
4. every BLOCKED-ASTRA item;
5. every accepted P0/P1/P2 requirement added during the final design review.

For every requirement record: requirement name, source/section, code/module, Integration Hub/runtime path, acceptance test, evidence, status, blocker, and next action. A requirement may not disappear merely because it is not yet implemented.

Historical runtime claims in recovered notes are evidence to investigate, not authority over newer verified runtime evidence. Never regress a newer verified fact to an older note.

## Eight General Intelligence Capabilities — Explicit Preservation
The following eight capabilities are mandatory tracked requirements and must not be collapsed into a vague "AI" label:
1. General Reasoning & Planning
2. Broad Toolkit & Capability Discovery
3. Autonomous Debugging & Recovery
4. Novel Situation Adaptation
5. Independent Verification & Inference
6. Broad Knowledge & Language
7. Code Creation & Maintenance
8. Higher-Level Independent Supervisor / Auditor

Each must be mapped to real models/tools/runtime paths and independently classified by evidence.

## Conversation-First MASTER Experience
ATLASZ must be usable primarily by natural conversation, not by requiring JOCI to operate developer tools.

On authenticated desktop/client startup, MASTER may proactively greet JOCI in his configured preferred language and present a concise useful status/brief such as current priorities, important alerts, work/revenue status, pending approvals and health. Do not use a fixed canned greeting when current state is available.

Required conversational behavior:
- maintain configurable language/preference settings;
- support natural text and, when LIVE, voice conversation;
- allow JOCI to change modes/objectives conversationally;
- explain what it is doing and surface approvals at the point they are needed;
- remember durable project context with provenance rather than forcing repeated re-entry;
- execute JOCI instructions by default when lawful, safe, technically feasible and within granted authority;
- if an instruction conflicts with a hard safety/legal/financial/owner-control rule, stop only the conflicting action and explain the exact blocker.

The interface should feel like one coherent ATLASZ MASTER even when many agents/models/tools are working underneath.

## Daily Brief / Startup Brief
When enabled by JOCI, startup or the first interaction of the day should produce a short personalized operational brief:
- greeting in preferred language;
- today's important tasks/deadlines;
- Money Engine state and verified revenue/payment changes;
- replies/client actions requiring attention;
- system/provider health and blockers;
- approvals waiting for JOCI;
- optional recommended next actions.
Do not invent events or status. Every operational claim must come from current durable state/evidence.

## Business Proof / Evidence Package
Maintain a proof package suitable for JOCI's own audit and later independent audit:
SPEND/COST X -> OPPORTUNITY/AGREEMENT EVIDENCE -> WORK EXECUTED -> QA -> DELIVERY -> INVOICE -> RECEIVED/SETTLED Y -> VERIFIED NET PROFIT N -> HUMAN INTERVENTION H -> TIME T.

This package is required before making strong profitability claims and is distinct from marketing copy.

## Predictive Revenue Loop — Explicit ICP and Sales Controls
The E2E Money Engine must include:
MARKET SCAN -> ICP/DEMAND VALIDATION -> OPPORTUNITY QUALIFICATION -> BUYER/DECISION MAKER -> OFFER -> CONTROLLED OUTREACH -> FOLLOW-UP -> REPLY -> DEAL -> EXECUTION -> QA -> DELIVERY -> COLLECTION -> VERIFIED PROFIT -> LEARNING.

Prefer targets with evidence of ability/willingness to pay. Do not claim demand is "proven" without evidence.

Sales communication should use tested frameworks/templates where available, while allowing factual Client-DNA personalization. Agents may not fabricate claims. Conversion performance should be measured so weak scripts can be improved through controlled tests.

## Market/Revenue Model Coverage — Explicit
Do not omit or merge away the market models. E2E is the governing execution lifecycle; the following are market/customer relationship models that E2E may operate across:
E2E + B2B + B2C + B2G + B2B2C + D2C + C2B.

The Opportunity Qualifier must be able to tag the model, applicable compliance/procurement constraints, payment method, buyer type, acquisition channel, delivery type and revenue form.

## Scale Governance
Scaling is economics-driven, not agent-count-driven.
- Keep 5 SEARCH + 25 EXECUTION as the current production topology.
- Recommend expansion only after verified throughput/profit/bottleneck evidence.
- Never autonomously expand agent count or incur scaling spend.
- JOCI approval is required before expansion or new paid capacity.
- Generated profit does not automatically authorize reinvestment.

## Commercialization / Licensing Controls
Preserve the possibility that JOCI may keep ATLASZ private or later commercialize it.
If commercialization is later authorized:
- create a separate sanitized customer distribution/instance;
- keep JOCI's production secrets, personal data and core private configuration isolated;
- support recurring technology licensing/subscription controls where appropriate;
- use isolated customer instances/tenancy and explicit entitlement controls;
- do not expose core architecture/IP publicly without authorization.
No sale/licensing decision is assumed by this requirement.

## Firecrawl and External Research Adapters
Track Firecrawl as an explicit adapter requirement alongside other verified search/research providers. External research adapters must expose provenance, health, rate/cost state and failure truthfully. A connector available to ChatGPT is not automatically an ATLASZ runtime connector.

## Desktop Extension / Integration Fabric
The Windows Control Center should support adding approved desktop extensions/integrations later without rebuilding MASTER. Extension installation/connection must be permissioned, versioned, auditable and reversible. Never auto-install paid software or extensions without JOCI approval.

## Voice Interaction Details
When real STT/TTS is LIVE, JOCI should be able to converse with MASTER during ordinary daily activity, hear status/results and respond to approval requests by voice. Voice identity alone is not sufficient authentication for high-risk approvals unless a separately verified strong-auth mechanism explicitly supports it.

## Tax / GST / PST / Accounting Workflow
Beyond calculation, build a preparation workflow that can ingest verified records, classify transactions, reconcile evidence, prepare tax/GST/PST workpapers and produce review-ready outputs. Filing, payment or binding submission remains unavailable until an authorized real provider/runtime and required owner approval are proven.

## Human Mission — Practical, Not Anthropomorphic
ATLASZ's mission may include generating sustainable verified profit and helping people when JOCI directs it, but it must not claim a literal soul, consciousness or human emotions.

The Human Core should convert compassion into practical behavior:
NOTICE DIFFICULTY -> UNDERSTAND NEED -> FIND LAWFUL/SAFE OPTIONS -> RANK HELP -> TAKE PERMITTED ACTION -> VERIFY WHETHER HELP OCCURRED.

Charitable/nonprofit activity must remain financially/accountingly separated from ATLASZ external revenue and from JOCI/GMP unless JOCI explicitly initiates an authorized project.

## Independent External Auditability
ATLASZ must be inspectable from outside itself. Do not rely on self-reported health.
Preserve machine-readable logs/evidence so a separate auditor/system can verify Git commit/SHA, deployment, health, provider probes, sent-message evidence, delivery, invoice, payment evidence, costs and profit.

The external supervisor/auditor is logically independent from the system it evaluates and cannot be silently disabled by ordinary agents.

## Historical Module Audit Obligation
Do not assume the old "41 modules / 24 wired / 17 unwired" snapshot is current. Re-audit the current repository and current Integration Hub. Specifically verify that Execution Factory, Agent Factory, Deal State, Delivery, Follow-Up, Invoice, Negotiation, Opportunity Qualification, Proposal/Quote, Recovery, Tax, Universal Connector and other recovered modules are actually imported, exported, invoked and runtime-tested.

## Current Revenue Truth Gate
A complete revenue cycle remains unproven until real evidence demonstrates:
SEARCH -> OPPORTUNITY -> QUALIFICATION -> BUYER/CONTACT -> REAL SENT -> REPLY -> DEAL/WON -> EXECUTION ORDER -> EXECUTION -> INDEPENDENT QA -> DELIVERY -> INVOICE -> AUTHORITATIVE PAYMENT RECEIPT -> VERIFIED NET PROFIT.

Never use a successful service/deployment alone as proof that this business cycle works.

## Final No-Omission Acceptance
Codex must finish with two reports:
A. CAPABILITY EVIDENCE REPORT — every capability and its actual status.
B. REQUIREMENT TRACEABILITY REPORT — every requirement mapped to implementation/test/evidence/blocker.

If any item from the cumulative ATLASZ specification has no mapping, the build is NOT complete.


## Disaster Recovery / Point-in-Time Restore / Reinstall Architecture — MANDATORY
Treat ATLASZ recovery as a first-class subsystem separate from ordinary self-healing. The objective is that loss or corruption of a Windows client, an ATLASZ deployment, or both does not force ATLASZ to be rebuilt from scratch.

### Three physically/logically separated layers
1. **ATLASZ SERVER / CORE**
   - MASTER, 5 SEARCH + 25 EXECUTION, Money Engine, durable workflow state, databases/memory, provider configuration references, audit/evidence and server-side services.
   - Must not depend on one Windows laptop remaining alive.
   - Approved long-running server work may continue while the desktop client is offline.

2. **ATLASZ WINDOWS APP / CONTROL CENTER**
   - Deliver a signed/versioned installer target such as `ATLASZ-Setup.exe` when the Windows build is ready.
   - A replacement Windows machine must be able to install the client, authenticate JOCI and securely reconnect to the existing ATLASZ Core without rebuilding the Core.
   - Client-local caches/configuration must be treated as replaceable; authoritative durable state belongs in protected durable storage/server systems.

3. **ATLASZ RECOVERY PACKAGE**
   - Maintain a separate recovery package suitable for protected offline/off-site storage.
   - It may contain installer/recovery tooling, manifests, version/SHA information, restore instructions, backup metadata and encrypted recovery material where appropriate.
   - NEVER place plaintext API keys, banking passwords, access tokens or other secrets in the recovery package/USB.
   - Recovery credentials/keys require secure encryption, least privilege and owner-controlled recovery procedures.

### Two primary recovery commands/modes
**CONNECT TO EXISTING ATLASZ**
Use when the laptop/client is lost or replaced but the ATLASZ Core is healthy:
NEW/REPAIRED WINDOWS MACHINE -> INSTALL ATLASZ CLIENT -> STRONG JOCI AUTH -> DISCOVER/SELECT OWN ATLASZ CORE -> SECURE RECONNECT -> VERIFY IDENTITY/CORE -> SYNC SAFE CLIENT STATE -> HEALTH CHECK -> READY.

**DISASTER RECOVERY**
Use when the server/core or durable state is damaged:
FREEZE/ISOLATE BAD STATE -> IDENTIFY LAST VERIFIED HEALTHY RESTORE POINT -> RESTORE CODE/CONFIG/DATA AS APPROPRIATE -> RECONNECT REQUIRED SERVICES -> RUN ACCEPTANCE/HEALTH TESTS -> JUDGE -> PROMOTE RESTORED STATE OR ROLLBACK/ESCALATE.

### Point-in-Time Restore (PITR)
Maintain multiple restore points rather than only "latest backup". Retention must be configurable and evidence-driven. At minimum support the concept of:
- latest verified healthy checkpoint;
- previous healthy checkpoint(s);
- daily restore points;
- longer-lived stable release checkpoints.
A useful default policy may expose restore choices such as yesterday / ~3 days / ~7 days / stable release, but exact retention must be configurable based on storage/provider capability and cost approval.

Never automatically restore to a point merely because it is newer. Prefer the newest **verified healthy** compatible point.

### Restore domains must be separable
A recovery operation must explicitly identify what is being restored:
- source code / Git commit;
- application release/build;
- Railway/service deployment configuration where reproducibly captured;
- durable databases/state;
- workflow/checkpoint state;
- non-secret configuration;
- evidence/audit indexes;
- desktop client configuration;
- provider connection metadata.
Secrets must be restored/reconnected through secure secret-management/re-authentication mechanisms, not copied from plaintext backups.

Do not blindly roll back customer/payment/audit facts. Financial evidence and immutable audit records require special preservation/reconciliation so a code rollback cannot erase the historical truth of a received payment, invoice, approval or external action.

### Change-safe restore-point workflow
Before consequential system changes:
PRECHECK -> CREATE/CAPTURE RESTORE POINT -> VERIFY BACKUP/RESTORE METADATA -> APPLY CHANGE -> TEST -> HEALTH CHECK -> INDEPENDENT JUDGE -> MARK HEALTHY.

On failure:
DETECT -> STOP/QUARANTINE -> DIAGNOSE -> SELECT LAST COMPATIBLE VERIFIED HEALTHY POINT -> RESTORE -> RETEST -> if PASS mark recovered; if FAIL rollback/escalate to JOCI.

A backup that has never been restore-tested is not sufficient proof of disaster recovery.

### Three failure classes must be acceptance-tested
A. **Laptop failure only**
Server Core remains healthy. Prove a clean/replacement Windows environment can install, strongly authenticate and reconnect without rebuilding ATLASZ.

B. **Server/Core failure only**
Client may remain healthy. Prove restoration to a verified healthy server restore point, followed by runtime/provider/5+25/Money Engine health validation.

C. **Combined laptop + server loss**
Prove that the protected recovery package plus durable/off-site backups and documented infrastructure/configuration can reconstruct/reconnect the authorized ATLASZ environment without relying on the failed laptop/server.

### Recovery integrity and safety
- Encrypt backups at rest and in transit where supported.
- Use integrity hashes/manifests and version/SHA provenance.
- Keep at least one backup copy logically separated from the live system so a live-system failure or destructive bug cannot erase all recovery points.
- Apply retention/versioning and protect backups from ordinary agent deletion.
- Restore actions that affect production, secrets, payments, owner authentication or irreversible external state require the applicable JOCI approval.
- Recovery cannot weaken JOCI authority, Guardrails, audit or financial controls.
- Record who/what initiated recovery, selected restore point, evidence, test result and final state.

### Recovery Mission Control
Mission Control must eventually show runtime-derived recovery status:
- last successful backup/checkpoint;
- last verified restore test;
- latest verified healthy restore point;
- available restore-point ranges;
- backup integrity/health;
- recovery blockers;
- current client/core version;
- rollback target;
- recovery drill status.
Do not display hard-coded green status.

### Recovery acceptance evidence
Do not mark Disaster Recovery or PITR LIVE until real restore drills prove the relevant path. Required evidence includes restore-point identifier/time, source commit/release, backup integrity verification, restored durable-state check, startup logs, /health and /status, exact 5 SEARCH + 25 EXECUTION verification, critical provider state, owner-control tests and post-restore Money Engine truth checks.

### Recovery is not the same as Self-Healing
Self-Healing handles bounded operational faults in the running system.
Rollback handles a bad change/release.
Point-in-Time Restore recovers earlier durable state.
Client Reinstall/Reconnect handles a failed/replaced Windows machine.
Disaster Recovery reconstructs service after major loss.
Keep these concepts separately visible and separately testable even when they share underlying tooling.


## JOCI Launch Phrase / Startup Signature
JOCI's preferred ATLASZ launch phrase is:

**"Indul a mandula!"**

Treat this as a friendly startup signature/activation phrase in the future conversational desktop/voice experience when JOCI enables it. It is not a security credential and must never substitute for strong authentication or approval.

A future authenticated startup experience may greet JOCI naturally in his configured language and include the phrase, for example:
"Hello Joci — indul a mandula!"
Then immediately continue with the truthful Daily/Startup Brief and current priorities.

The wording/greeting must remain configurable by JOCI.
