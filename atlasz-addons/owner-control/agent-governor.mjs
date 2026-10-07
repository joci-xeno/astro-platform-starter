// ATLASZ 30-agent governor (V7.3 Owner Control §13). The topology is FIXED: exactly 5 SEARCH/SALES + 25 EXECUTION agents.
// Every agent action goes through the control chain (owner authority, kill switch, safe mode, security, firewall, approvals, black box).
// Nobody can silently create an agent, an unregistered agent, or an unrestricted tool: creation is an owner-only operation and even
// a signed approval cannot exceed the fixed topology (changing the topology is a separate governed change, not a runtime action).
import { validateRoster } from "../brain/orchestrator.mjs";

export function createAgentGovernor({ roster = [], chain, security = null, blackBox = null, tools = [], capabilityKnown = null } = {}) {
  if (!chain) throw new Error("CHAIN_REQUIRED");
  const topology = validateRoster(roster);
  const ids = new Set(roster.map(a => a.id));
  const toolReg = new Set(tools);
  const rec = (kind, p) => { try { blackBox?.record({ kind, ...p }); } catch { /* ignore */ } };
  const report = () => ({ topology, search: topology.search ?? null, execution: topology.execution ?? null, agents: roster.length, registered: [...ids], tools: [...toolReg], controls: ["OWNER_AUTHORITY", "KILL_SWITCH", "SAFE_MODE", "SECURITY_BRAIN", "FINANCIAL_FIREWALL", "OWNER_APPROVAL", "BLACK_BOX", "VERIFICATION", "RECOVERY"], allActionsViaChain: true });

  function act(agentId, operation, opts = {}) {
    if (!topology.ok) return { allowed: false, verdict: "BLOCK", reason: "TOPOLOGY_INVALID_FAIL_CLOSED" };
    if (!ids.has(agentId)) {
      rec("UNREGISTERED_AGENT_ACTION", { agentId, decision: "BLOCK", reason: "AGENT_NOT_IN_FIXED_ROSTER" });
      security?.assess({ kind: "PRIVILEGE_REQUEST", agentId, permission: "UNREGISTERED_AGENT" });
      return { allowed: false, verdict: "BLOCK", reason: "AGENT_NOT_IN_FIXED_ROSTER" };
    }
    if (opts.tool && !toolReg.has(opts.tool)) { rec("UNREGISTERED_TOOL", { agentId, tool: opts.tool, decision: "BLOCK", reason: "TOOL_NOT_REGISTERED" }); return { allowed: false, verdict: "BLOCK", reason: "TOOL_NOT_REGISTERED" }; }
    const d = chain.evaluate({ actor: { type: "AGENT", id: agentId }, operation, external: opts.external, params: opts.params, spendUsd: opts.spendUsd, ownerApproval: opts.ownerApproval, securityEvent: opts.securityEvent, pathId: "agents.runtime.30" });
    return { allowed: d.allowed, verdict: d.verdict, reason: d.reason, layer: d.layer, decision: d };
  }
  /** Any attempt to add/spawn an agent. Always refused at runtime; the roster is fixed. */
  function createAgent(blueprint = {}, { requestedBy = { type: "AGENT", id: null }, ownerApproval = null } = {}) {
    const d = chain.evaluate({ actor: { type: requestedBy.type, id: requestedBy.id }, operation: "CREATE_AGENT", params: { name: blueprint.name ?? null }, ownerApproval, pathId: "agents.create" });
    if (!d.allowed) { rec("AGENT_CREATION_REFUSED", { agentId: requestedBy.id, decision: d.verdict, reason: d.reason }); return { created: false, reason: d.reason }; }
    rec("AGENT_CREATION_REFUSED", { agentId: requestedBy.id, decision: "BLOCK", reason: "TOPOLOGY_FIXED_30" });
    return { created: false, reason: "TOPOLOGY_FIXED_30_CHANGE_IS_A_GOVERNED_RELEASE_NOT_A_RUNTIME_ACTION" };
  }
  function registerTool(tool, { ownerApproval = null } = {}) {
    const d = chain.evaluate({ actor: { type: "SYSTEM", id: "TOOL_REGISTRY" }, operation: "HIGH_RISK_CHANGE", params: { tool }, ownerApproval, pathId: "agents.tools.register" });
    if (!d.allowed) return { registered: false, reason: d.reason };
    toolReg.add(tool); return { registered: true };
  }
  const byId = new Map(roster.map(a => [a.id, a]));
  /** Activation admission: an agent becomes ACTIVE only if every check passes. A blueprint that is not an existing roster identity is a
   *  would-be 31st agent and is always refused. Checks are evaluated in order and ALL are reported (inspectable explanation). */
  function admit(blueprint = {}, { requestedBy = { type: "SYSTEM", id: "AGENT_FACTORY" } } = {}) {
    const checks = [], add = (name, ok, detail = null) => checks.push({ name, ok: !!ok, detail });
    const known = byId.get(blueprint.agentId);
    add("IDENTITY_KNOWN", !!known, known ? null : "AGENT_NOT_IN_FIXED_ROSTER");
    const wantTeam = blueprint.role === "SEARCH" ? "SEARCH" : blueprint.role === "EXECUTION" ? "EXECUTION" : null;
    add("ROLE_VALID", !!known && !!wantTeam && known.team === wantTeam, !wantTeam ? "ROLE_NOT_A_RUNTIME_TEAM" : known && known.team !== wantTeam ? "ROLE_TEAM_MISMATCH" : null);
    add("TOPOLOGY_PERMITS", topology.ok && !!known, topology.ok ? null : "TOPOLOGY_INVALID");
    const caps = Array.isArray(blueprint.capabilities) ? blueprint.capabilities : [];
    const unreg = capabilityKnown ? caps.filter(c => !capabilityKnown(c)) : caps.length ? ["NO_CAPABILITY_REGISTRY"] : [];
    add("CAPABILITIES_REGISTERED", unreg.length === 0, unreg.length ? "UNREGISTERED:" + unreg.join(",") : null);
    const tl = Array.isArray(blueprint.tools) ? blueprint.tools : [], badTools = tl.filter(t => !toolReg.has(t));
    add("PERMISSIONS_KNOWN", badTools.length === 0 && !!blueprint.approvalPolicy, badTools.length ? "UNREGISTERED_TOOLS:" + badTools.join(",") : !blueprint.approvalPolicy ? "APPROVAL_POLICY_MISSING" : null);
    let d = null;
    if (checks.every(c => c.ok)) {
      d = chain.evaluate({ actor: { type: requestedBy.type, id: requestedBy.id }, operation: "INTERNAL_COMPUTE", params: { activate: blueprint.agentId }, pathId: "agents.runtime.30" });
      add("CONTROL_CHAIN", d.allowed, d.allowed ? null : d.reason);
    }
    const admitted = checks.every(c => c.ok);
    if (!known) security?.assess({ kind: "PRIVILEGE_REQUEST", agentId: blueprint.agentId ?? null, permission: "UNREGISTERED_AGENT" });
    rec(admitted ? "AGENT_ADMITTED" : "AGENT_ADMISSION_REFUSED", { agentId: blueprint.agentId ?? null, decision: admitted ? "ALLOW" : "BLOCK", reason: checks.filter(c => !c.ok).map(c => c.name + (c.detail ? ":" + c.detail : "")).join(";") || "ALL_CHECKS_PASSED" });
    return { admitted, checks, reason: admitted ? "ALL_CHECKS_PASSED" : checks.find(c => !c.ok).name, decision: d };
  }
  /** Any change to an agent's configuration (capabilities, tools, model policy, permissions) is a high-risk owner-gated change. */
  function configure(agentId, change = {}, { requestedBy = { type: "AGENT", id: null }, ownerApproval = null } = {}) {
    if (!ids.has(agentId)) { rec("AGENT_CONFIG_REFUSED", { agentId, decision: "BLOCK", reason: "AGENT_NOT_IN_FIXED_ROSTER" }); return { configured: false, reason: "AGENT_NOT_IN_FIXED_ROSTER" }; }
    const d = chain.evaluate({ actor: { type: requestedBy.type, id: requestedBy.id }, operation: "HIGH_RISK_CHANGE", params: { agentId, keys: Object.keys(change).sort() }, ownerApproval, pathId: "agents.configure" });
    rec(d.allowed ? "AGENT_CONFIG_ALLOWED" : "AGENT_CONFIG_REFUSED", { agentId, decision: d.verdict, reason: d.reason });
    return { configured: d.allowed, reason: d.reason, decision: d };
  }
  return { act, createAgent, registerTool, admit, configure, report, isRegistered: id => ids.has(id) };
}
