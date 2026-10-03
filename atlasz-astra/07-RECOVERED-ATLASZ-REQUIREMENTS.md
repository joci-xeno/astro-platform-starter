# ATLASZ — Recovered Requirements from Earlier Design Work

This is a handoff checklist for requirements recovered from earlier ATLASZ discussions and current code inventory. Do not rebuild working components. First inspect whether each requirement already has working code; extend and connect it if present.

## Core missing/high-priority
- Universal MASTER Planner / Orchestrator: objective -> plan -> agent/team selection -> tool selection -> execution -> independent Judge -> replan.
- Skill Factory: detect missing capability -> safely create/assemble adapter/skill -> test -> register -> use.
- Durable Execution / Resume after restart/interruption.
- Strong JOCI owner authentication for critical approvals.
- Emergency Stop / Kill Switch: PAUSE ALL / STOP EXTERNAL ACTIONS / RESUME.
- Shared Project Registry: canonical project/job state for authorized agents.
- Real Cost + Profit Accounting: API/tool cost -> job cost -> invoice -> received money -> verified net profit.
- Sandboxed execution / Computer Use runtime.
- Mission Control / runtime-driven central dashboard.
- Multi-agent consensus / independent challenge for uncertain work.
- Predictive scenario simulation before important execution.
- Simulation/digital-twin style safe testing before risky production changes.
- Real team-lead workflows.
- Outreach limits and controlled submissions.
- Scale governance: keep 30 unless measured economics justify expansion; expansion requires JOCI approval.
- Business proof package: actual won/delivered/paid/cost/net-profit/human-intervention evidence.

## Existing structural modules that must remain tracked and validated
Checkpoint Engine; Task Ledger; Progress Ledger; Stall Replanner; Capability Registry; Event Bus; Cost/Model Router; Dead-Letter Queue; Guardrail Engine; Regression/Eval Suite; Observability Black Box; Agent Portfolio Manager; Priority/Rate Governor; Unified Entity Graph; Client DNA; Outcome Compiler; Enterprise Control Plane; Budget Consumption Governor; Agent Factory; Buyer/Decision-Maker Finder; Deal State; Delivery Engine; Enterprise Knowledge/Agentic RAG; Execution Factory; Executor Toolbox; Follow-Up; Invoice; Negotiation; Opportunity Qualification; Proposal/Quote; Universal Connector Layer; Unified Tool Bridge.

## Existing owner rules
- Preserve 5 SEARCH + 25 EXECUTION.
- No autonomous spending/subscriptions/contracts/payments/banking/security changes.
- No fake SENT or PAID.
- No fabricated credentials, portfolio, results or client claims.
- External revenue excludes JOCI's own Green Mountain Painters, VIRENA and existing personal projects.
- Expansion beyond current system only with owner approval.
- Normal lawful research, planning, routing, debugging and ordinary execution should not stop for unnecessary approvals.

## Market intelligence correction
Predictive Market Intelligence must preserve the proactive requirement: scan global/local data streams, anticipate market changes, and autonomously adapt the 5 SEARCH agents' strategy without requiring JOCI to prompt each change.

Every item must be reported as PLANNED / CODE_ADDED / STRUCTURALLY_WIRED / CONNECTED_UNTESTED / LIVE / BLOCKED with evidence.
