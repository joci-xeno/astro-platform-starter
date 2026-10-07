// ATLASZ Multi-layer Owner Control & Safety System — assembly (V7.3 Owner Control §1). Wires the EXISTING owner-auth, emergency-stop,
// safe-mode, backup-recovery and Brain security/verifier/black-box into one layered chain. Creates no agents and changes no authority.
import path from "node:path";
import { createOwnerAuthority } from "./owner-authority.mjs";
import { createControlChain } from "./control-chain.mjs";
import { createApprovalGateway } from "./approval-gateway.mjs";
import { createFinancialFirewall } from "./financial-firewall.mjs";
import { createMoneyStateGuard } from "./money-state-guard.mjs";
import { createAgentGovernor } from "./agent-governor.mjs";
import { createModuleIsolation, safeModeBanner } from "./safe-mode-scope.mjs";
import { createRecoveryManager } from "./recovery-points.mjs";
import { createSystemDoctor } from "./system-doctor.mjs";
import { createClaimTracker } from "./claim-distinctions.mjs";

export function createOwnerControlSystem({ capabilityKnown = null, dir, ownerAuth, gate, emergencyStatus = null, safeMode = null, security = null, blackBox = null, verifier = null, roster = [], tools = [], sources = {}, budget = null, extraProbes = {}, now = () => new Date().toISOString() } = {}) {
  if (!dir || !ownerAuth || typeof gate !== "function") throw new Error("DIR_OWNERAUTH_GATE_REQUIRED");
  const authority = createOwnerAuthority({ ownerAuth });
  const firewall = createFinancialFirewall({ file: path.join(dir, "financial-firewall.json"), ownerAuth, budget, now });
  const isolation = createModuleIsolation({ blackBox, now });
  const chain = createControlChain({ authority, gate, safeMode, security, firewall, blackBox, verifier, isolation, now });
  chain.registerStandardPaths();
  const gateway = createApprovalGateway({ dir: path.join(dir, "approvals"), ownerAuth });
  const claims = createClaimTracker({ verifier });
  const moneyGuard = verifier ? createMoneyStateGuard({ chain, verifier, firewall, blackBox }) : null;
  const agents = createAgentGovernor({ roster, chain, security, blackBox, tools, capabilityKnown });
  const recovery = createRecoveryManager({ root: path.join(dir, "recovery"), sources, chain });
  const st = (state, detail) => ({ state, detail });
  const probes = {
    runtime: () => st("HEALTHY", "control system assembled"),
    agent_topology_30: () => { const t = agents.report().topology; return t.ok ? st("HEALTHY", "5+25=30") : st("BLOCKED", JSON.stringify(t)); },
    owner_authentication: () => { const s = ownerAuth.status(); return s.state === "LIVE" ? st("HEALTHY", "channel proven") : s.state === "CONNECTED_UNTESTED" ? st("DEGRADED", "key configured, channel not yet proven") : st("NOT_CONFIGURED", "no owner public key"); },
    kill_switch: () => { const g = gate({ external: true }); if (!g || typeof g.allowed !== "boolean") return st("UNKNOWN", "gate state unreadable"); return g.allowed ? st("HEALTHY", "RUNNING (armed)") : st("BLOCKED", "EMERGENCY STOP ACTIVE: " + (g.reason ?? "")); },
    approval_gateway: () => st("HEALTHY", `${gateway.pending().length} pending`),
    security_brain: () => (security ? st("HEALTHY", JSON.stringify(security.status())) : st("NOT_CONFIGURED", "no security brain")),
    financial_firewall: () => { const s = firewall.status(); return s.integrity === "OK" ? st("HEALTHY", s.mode) : st("DEGRADED", s.integrity); },
    black_box: () => (blackBox ? (blackBox.verifyFile().ok ? st("HEALTHY", "hash chain intact") : st("FAILED", "hash chain broken")) : st("NOT_CONFIGURED", "no black box")),
    backup: () => { const r = recovery.readiness(); const c = r.categories.filter(x => x.backup !== "NOT_CONFIGURED"); if (!c.length) return st("NOT_CONFIGURED", "no recovery sources"); if (c.every(x => x.backup === "VERIFIED")) return st("HEALTHY", "all configured categories drill-verified"); if (c.some(x => ["FAILED", "UNRESTORABLE", "NO_BACKUP"].includes(x.backup))) return st("FAILED", JSON.stringify(c.map(x => `${x.category}:${x.backup}`))); return st("UNKNOWN", "not yet verified"); },
    last_known_good: () => { const l = recovery.latestVerifiedLkg(); return l.lkg ? st("HEALTHY", l.lkg.build?.version ?? l.lkg.backupId) : st("NOT_CONFIGURED", "no verified LKG"); },
    recovery_readiness: () => { const r = recovery.readiness().restoreReadiness; return r === "READY" ? st("HEALTHY", r) : r === "NOT_READY" ? st("FAILED", r) : r === "NOT_CONFIGURED" ? st("NOT_CONFIGURED", r) : st("UNKNOWN", r); },
    ...extraProbes,
  };
  const doctor = createSystemDoctor({ probes, blackBox, now });
  function status() {
    const es = emergencyStatus ? emergencyStatus() : null, sm = safeMode?.status?.() ?? null;
    return {
      ownerAuthority: authority.status(), killSwitch: es ? { mode: es.mode, banner: es.banner ?? null } : { mode: "UNKNOWN" }, approvals: { pending: gateway.pending().length },
      securityBrain: security ? security.status() : "NOT_CONFIGURED", financialFirewall: firewall.summary(), blackBox: blackBox ? { ...blackBox.stats(), chainIntact: blackBox.verifyFile().ok } : "NOT_CONFIGURED",
      safeMode: sm ? { ...sm, ...safeModeBanner(sm) } : "UNKNOWN", recovery: recovery.readiness(), controlledPaths: chain.paths().length, decisions: chain.tally(), isolation: isolation.list(),
    };
  }
  const probe = name => (probes[name] ? probes[name]() : null);
  return { authority, chain, gateway, firewall, moneyGuard, claims, agents, isolation, recovery, doctor, status, probe };
}
