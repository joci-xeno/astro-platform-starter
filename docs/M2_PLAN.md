# Milestone M2 — Agent Runtime Integration: PLAN ONLY (no implementation started)

Status: PREPARED. Nothing here is implemented. Per the owner's instruction, **agents can NOT use tools today**; that is claimed only after the integration tests below pass.

## Starting point (verified in Task 3 / M1)
- 30 agents (5 SEARCH + 25 EXECUTION) run only governed SCREENING jobs (`brain.dispatch.run` via `runGoverned`).
- 31 typed tools exist (`typed-tools.mjs`); the only production caller of `tools.invoke` is the scheduler. Strict schemas reject extra args (probe P17). Agents have no approve/spend/send/pay/speak tool (probe P19).
- Control chain fail-closed, approvals single-use and argument-bound (probes P01-P07).

## Design (ATLASZ-T3-003 / T3-004)
1. **ToolBroker** (new, `atlasz-runtime/agent-tool-broker.mjs`): the single path from an agent to `tools.invoke`. Inputs: agentId (must be one of the 30), toolName, args. It (a) checks a static per-role **allow-list** (SEARCH: read/research tools only; EXECUTION: + sandbox/drafting tools; nobody: approve/spend/send/pay/speak/deploy), (b) calls `tools.invoke(name,args,{actor:{type:"AGENT",id}})`, which runs the control chain, (c) writes every call to the Black Box (including DENIED/REQUIRES_APPROVAL), (d) enforces per-agent budgets (calls/min, total calls per job, output size), (e) never throws.
2. **Approval flow**: `REQUIRES_APPROVAL` is returned to the job as a pending item surfaced in the Control Center approvals list; the agent never holds or forwards an approval. The owner's Ed25519 approval stays single-use and args-bound.
3. **Dispatch hook**: governed jobs gain an optional `toolPlan` (list of {tool,args}) executed through the broker after screening; default empty => behaviour unchanged. Kill switch / safe mode checked before each call.
4. **No topology change**: broker rejects any agent id not in the fixed 30.

## Integration tests required before any claim (all must pass)
- each of the 30 agents invokes one allowed read-only tool successfully, with a Black Box entry;
- a disallowed tool for the role -> DENIED, no handler call (spy);
- extra/injected args (tenant, consent, approval) -> INVALID_ARGUMENTS;
- REQUIRES_APPROVAL tool: no handler call without a valid approval; replay of a used approval refused; approval for other args refused;
- kill switch / safe mode mid-job: next call DENIED;
- NO-SPEND: any positive spend DENIED;
- handler throw / timeout / invalid output do not crash the runtime; budgets enforced;
- mutation tests on the broker; a real-process test through the canonical runtime;
- forged agent id (31st agent) refused.

## Owner decisions needed BEFORE implementation starts
1. Approve the **per-role tool allow-list** (draft to be supplied for review: which of the 31 tools SEARCH vs EXECUTION may call).
2. Approve **budgets** (calls per job / per minute) as defaults.
3. Confirm that tool calls with `REQUIRES_APPROVAL` should surface in the existing approvals list (no new channel).
4. Decide on the **runtime bind address** (currently 0.0.0.0, now token-protected; changing to 127.0.0.1 may break Railway-style hosting, so it is not done without approval).
5. Decide on **Electron/Node `--permission` support** for the packaged app (plugin hooks and update self-tests fail closed where unavailable).
6. For T3-009 (real-source lead discovery): an owner-approved source list and outbound network access; no live claim until a real probe passes.
