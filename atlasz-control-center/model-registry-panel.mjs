// Owner-facing control of the model & provider registry (23-point items 4, 5, 6, 18 and the "add / edit / enable / disable / upgrade without reinstalling" requirement).
// A thin layer over atlasz-addons/model-registry.mjs: nothing is invented, LIVE is only ever the gateway's own probe evidence (no provider adapter is attached to this app, so nothing is LIVE),
// credentials are shown only as "reference configured / not configured" (the vault resolves them; no value passes through here), and every approval-gated change is signed from the keystore passphrase
// bound to the exact subject, like the other owner actions.
import path from "node:path";
import { createModelRegistry } from "../atlasz-addons/model-registry.mjs";

export function createModelRegistryPanel({ stateDir, ownerAuth, sign, liveStatus = () => false, hasCredential = () => false } = {}) {
  const dir = path.join(stateDir, "models");
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } } };
  let reg = null; const open = () => (reg ??= createModelRegistry({ dir, ownerAuth: auth, liveStatus, hasCredential }));
  const need = (v, w) => { if (typeof v !== "string" || !v) throw new Error(w + "_REQUIRED"); return v; };
  function view() {
    const r = open(), st = r.status();
    return { state: "CONNECTED", status: st, providers: r.listProviders(), models: r.listModels(), assignments: r.assignments(), roleDefaults: r.roleDefaults(), agents: r.agents(), snapshots: r.snapshots().slice(-10),
      note: "Configuration only. A model is LIVE only after the gateway's own passing probe; no provider adapter is attached to this app, so nothing here is LIVE. Enabling a cloud or paid model needs your signed approval; enabling a free local model changes configuration only and downloads nothing." };
  }
  function action({ op, ...a } = {}) {
    const r = open();
    switch (op) {
      case "seed": return { ok: true, added: r.seedDefaults() };
      case "addProvider": return r.addProvider(a.provider ?? {});
      case "addModel": return r.addModel(a.model ?? {});
      case "editModel": return r.editModel(need(a.id, "ID"), a.patch ?? {});
      case "upgrade": return r.upgrade(need(a.id, "ID"), { version: a.version, capabilities: a.capabilities ?? null, acknowledgeRemovedCapabilities: a.acknowledgeRemovedCapabilities === true });
      case "disable": return r.disable(need(a.id, "ID"));
      case "remove": return r.remove(need(a.id, "ID"));
      case "enable": { const id = need(a.id, "ID"), m = r.getModel(id); if (!m) return { ok: false, reason: "UNKNOWN_MODEL" };
        if (!m.needsOwnerApprovalToEnable) return r.enable(id);
        need(a.passphrase, "PASSPHRASE"); return r.enable(id, { approval: sign(a.passphrase, "MODEL_ENABLE", r.enableSubject(m)) }); }
      case "rollback": { const rev = a.revision, subj = r.rollbackSubject(rev); if (!subj) return { ok: false, reason: "SNAPSHOT_NOT_FOUND" }; need(a.passphrase, "PASSPHRASE"); return r.rollback(rev, { approval: sign(a.passphrase, "MODEL_REGISTRY_ROLLBACK", subj) }); }
      case "setAssignment": return r.setAssignment(need(a.agentId, "AGENT_ID"), { primary: a.primary, fallbacks: a.fallbacks ?? [], capability: a.capability ?? "text" });
      case "clearAssignment": return r.clearAssignment(need(a.agentId, "AGENT_ID"));
      case "setRoleDefault": return r.setRoleDefault(a.role, a.models ?? []);
      case "resolve": return r.resolve({ agentId: a.agentId, capability: a.capability ?? "text", maxCostUsd: Number(a.maxCostUsd ?? 0) });
      default: throw new Error("UNKNOWN_MODEL_REGISTRY_OP");
    }
  }
  return { view, action };
}
