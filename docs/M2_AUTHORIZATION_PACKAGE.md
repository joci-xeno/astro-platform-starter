# M2 Authorization Package — Agent Runtime Integration

**Status: PROPOSAL. NOT IMPLEMENTED. Nothing in this package is loaded by any runtime code** (a test enforces that). Implementation starts only after the owner's explicit approval of the decisions in section 7.
Today the 30 agents (SEARCH-1..5, EXECUTION-1..25) run only governed screening jobs and **cannot use tools**. That is claimed only after the integration tests in `docs/M2_PLAN.md` pass.

## 1. Principles
1. Deny by default: an agent may call a tool only if the approved table says ALLOW (or APPROVAL, meaning it may *ask*).
2. Every call goes through one broker, then `tools.invoke`, then the control chain (OWNER AUTHORITY → KILL SWITCH → SAFE MODE → SECURITY BRAIN → FINANCIAL FIREWALL → OWNER APPROVAL → BLACK BOX). The broker adds a role allow-list and limits on top; it can only make things stricter, never looser.
3. All calls carry `spendUsd = 0`; any positive spend is refused (NO-SPEND).
4. Agents never hold, see or forward an owner approval. Approvals stay Ed25519, single-use and bound to the exact arguments.
5. Strict schemas stay (`additionalProperties:false`): agents cannot inject tenant, consent or approval fields.
6. Fixed topology: only the 30 existing ids are accepted; a 31st id is refused.

## 2. Verified chain behaviour for agents (sandbox probe, this session)
READ_STATUS, INTERNAL_COMPUTE and EXTERNAL_READ → allowed when no stop is active. HIGH_RISK_CHANGE → denied at OWNER_APPROVAL (`NO_OWNER_APPROVAL_PRESENTED`). In the approval gateway an agent request for HIGH_RISK_CHANGE becomes PENDING; `CREATE_AGENT` is BLOCKED (`REQUESTER_MAY_NOT_ASK`); `INTERNAL_COMPUTE` needs no approval.

## 3. Proposed permissions for all 31 tools
ALLOW = may call. DENY = broker refuses without calling the handler. APPROVAL = may request; each call needs a signed owner approval bound to its arguments.

| Tool | SEARCH (5) | EXECUTION (25) | Data risk | Rationale |
|---|---|---|---|---|
| `atlasz.queue` | ALLOW | ALLOW | LOW | queue pressure counts; needed for backpressure awareness |
| `money.panel` | DENY | ALLOW | MEDIUM | revenue aggregates; SEARCH has no need; EXECUTION reads it to avoid claiming unverified money |
| `inbox.summary` | DENY | ALLOW | MEDIUM | counts only, no message bodies |
| `model.complete` | ALLOW | ALLOW | MEDIUM | EXTERNAL_READ; no-spend, free providers only; output UNTRUSTED. Ships DISABLED until the owner picks providers (decision D5) |
| `pcc.agenda` | DENY | DENY | HIGH | owner's personal tasks/reminders; no identified agent need |
| `pcc.add` | DENY | DENY | HIGH | writes to the owner's personal command center; no identified agent need |
| `pcc.complete` | DENY | DENY | HIGH | closes owner's items; no identified agent need |
| `pcc.summary` | DENY | DENY | HIGH | counts only, but personal data; denied with the rest of pcc.* |
| `media.inspect_document` | DENY | ALLOW | MEDIUM | metadata/privacy flags of stored documents; customer material |
| `media.status` | ALLOW | ALLOW | LOW | capability/status only |
| `kp.list` | ALLOW | ALLOW | LOW | tool itself limits to projects the role may use |
| `kp.search` | ALLOW | ALLOW | LOW | cited passages from permitted knowledge projects |
| `kp.answer` | ALLOW | ALLOW | LOW | extractive, cited, or NO_SUPPORTING_EVIDENCE |
| `kp.verify` | ALLOW | ALLOW | LOW | re-check a citation |
| `research.open_question` | ALLOW | DENY | LOW | research writes belong to SEARCH only |
| `research.add_source` | ALLOW | DENY | MEDIUM | records already-retrieved web text; untrusted content, size-capped by policy |
| `research.add_finding` | ALLOW | DENY | LOW | status is computed, never author-set |
| `research.attach_evidence` | ALLOW | DENY | LOW | citation must verify now |
| `research.declare_contradiction` | ALLOW | DENY | LOW | only the owner can resolve it |
| `research.report` | ALLOW | ALLOW | LOW | read-only report |
| `research.unresolved` | ALLOW | ALLOW | LOW | read-only list |
| `sandbox.run` | DENY | ALLOW | MEDIUM | isolated sandbox (no network, private dir); refuses when OS isolation is unavailable |
| `sandbox.run_process_only` | DENY | APPROVAL | HIGH | no OS isolation; EXECUTION may only ask; each call needs a signed owner approval bound to the exact arguments |
| `sandbox.status` | ALLOW | ALLOW | LOW | isolation level and counts |
| `obs.observe` | ALLOW | ALLOW | MEDIUM | text only, never secrets/raw media; screened; tenant/consent cannot be injected |
| `obs.recall` | ALLOW | ALLOW | MEDIUM | PUBLIC/PERSONAL only, screened ALLOW; CONFIDENTIAL never visible |
| `obs.correct` | ALLOW | ALLOW | LOW | only agent-created observations; old text stays owner-only history |
| `obs.forget` | ALLOW | ALLOW | LOW | only agent-created observations |
| `obs.summary` | ALLOW | ALLOW | LOW | counts only |
| `obs.capture_research` | ALLOW | DENY | LOW | stores VERIFIED findings as memory; research-side tool |
| `voice.status` | DENY | DENY | LOW | no agent workflow needs it; agents can never speak, listen or approve |

Totals — SEARCH: 21 ALLOW, 10 DENY, 0 APPROVAL. EXECUTION: 19 ALLOW, 11 DENY, 1 APPROVAL. Machine-readable copy: `docs/m2_tool_permissions_PROPOSED.json`.
No tool exists (or is proposed) that lets an agent approve, spend, send, pay, speak, listen, transfer or deploy (probe P19).

## 4. Proposed default limits (all configurable only by the owner)
| Limit | Default |
|---|---|
| Calls per agent | 10 / minute, 100 / hour |
| Calls per job | 20 total; 5 for write tools (`research.*` writes, `obs.*` writes) |
| Global concurrency | 5 simultaneous tool calls across all 30 agents; 300 calls / hour |
| `sandbox.run` | 3 per job, 10 / hour / agent, timeout capped at 10 s (schema allows 30 s), output capped at 64 KB |
| `model.complete` | 5 per job, 20 / hour / agent, 100 / day globally, prompt capped at 8,000 chars; spend always 0 |
| `research.add_source` text | capped at 50,000 chars (schema allows 200,000) |
| Result size returned to an agent | 64 KB; larger is truncated and flagged |
| Per-call timeout | 15 s (the registry timeout still applies) |
| Repeated refusals | 5 consecutive DENIED / INVALID_ARGUMENTS from one agent → that job is suspended and a BYPASS_ATTEMPT signal goes to the Behavior Monitor / Security Brain; no automatic quarantine of the agent |
| Pending approvals | max 3 per agent, 20 in total; further requests are refused with back-pressure, duplicates are merged |
| Kill switch / Safe Mode | checked before every call; the next call after a stop is DENIED |
These numbers are untuned defaults; there is no production traffic to tune them on.

## 5. Integration with the existing owner approval queue (no new channel)
1. Broker gets `REQUIRES_APPROVAL` from `tools.invoke` (only `sandbox.run_process_only` today).
2. Broker calls the existing `approvalGateway.request({operation, what, why, target, expectedResult, requiredCredential, requestedBy:{type:"AGENT", id}, costUsd:0, financialRisk, securityRisk, dataRisk, reversibility, rollbackPossible, params})`. Identical requests are merged (id = hash of operation, subject, what, requester). The request lives 24 h, then EXPIRED.
3. It appears in the Control Center approvals list; the owner decides there. Approval is verified with `consume:false` at decision time and consumed exactly once by the executing chain.
4. The job gets `PENDING_OWNER_APPROVAL` with the request id and continues with other work; it never polls with a secret and never sees the approval. A rejected, expired or blocked request is final for that call; the agent must file a new request.
5. Everything is written to the Black Box (including DENIED and pending).

## 6. Test gate before any "agents can use tools" claim
See `docs/M2_PLAN.md` (30 agents each call an allowed tool with a Black Box entry; disallowed tool → no handler call; injected arguments rejected; approval flow incl. replay/other-args refusal; kill switch mid-job; NO-SPEND; handler errors/timeouts; budgets; real-process test; mutation tests; 31st agent refused).

## 7. Decisions needed from the owner (recommended answer first)
| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve the per-role tool table in section 3 (or mark changes) | Approve as proposed |
| D2 | Approve the default limits in section 4 | Approve as untuned starting values |
| D3 | `sandbox.run_process_only`: EXECUTION may ask via the queue, or DENY completely | DENY completely until a need exists (stricter); table currently says APPROVAL |
| D4 | Personal Command Center tools (`pcc.*`) for agents | Keep DENY |
| D5 | `model.complete`: which free providers may agents use (none is configured), or keep it DISABLED | Keep DISABLED until you name providers; no paid API either way |
| D6 | Should `money.panel` and `inbox.summary` be visible to EXECUTION agents | Yes (aggregates / counts only) |
| D7 | Approval requests from agents appear in the existing approvals list (no new channel) | Yes |
| D8 | Runtime bind address (now `0.0.0.0`, token-protected) | Decide separately; not changed here |
| D9 | Electron/Node `--permission` support for the packaged Windows app (see `docs/SANDBOX_LIMITS_WINDOWS_ELECTRON.md`) | Decide separately |
| D10 | Real-source lead discovery (T3-009): approved source list and network access | Decide separately |

## 8. Out of scope for M2
No new agents; no spending; no external sends; no deployment; no change to Railway, `main` or network exposure.
