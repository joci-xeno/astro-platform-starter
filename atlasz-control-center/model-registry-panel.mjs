// Owner-facing control of the model & provider registry (23-point items 4, 5, 6, 18 and the "add / edit / enable / disable / upgrade without reinstalling" requirement).
// A thin layer over atlasz-addons/model-registry.mjs: nothing is invented, LIVE is only ever the gateway's own probe evidence (no provider adapter is attached to this app, so nothing is LIVE),
// credentials are shown only as "reference configured / not configured" (the vault resolves them; no value passes through here), and every approval-gated change is signed from the keystore passphrase
// bound to the exact subject, like the other owner actions.
import path from "node:path";
import { createModelRegistry } from "../atlasz-addons/model-registry.mjs";
import { createModelRoutingBridge, createOllamaAdapter } from "../atlasz-addons/model-routing-bridge.mjs";
import { createCloudAdapter, PROVIDER_PROFILES } from "../atlasz-addons/provider-adapters.mjs";
import { createModelGateway } from "../atlasz-addons/model-gateway.mjs";
import { createProviderResilience } from "../atlasz-addons/provider-resilience.mjs";
import { createModelIntelligence } from "../atlasz-addons/brain/model-intelligence.mjs";
import { createCapabilityGraph } from "../atlasz-addons/brain/capability-graph.mjs";
import { createProviderEgress } from "../atlasz-addons/provider-egress.mjs";
import { createEgressPolicy } from "../atlasz-addons/egress-policy.mjs";

export function createModelRegistryPanel({ stateDir, ownerAuth, sign, liveStatus = () => false, hasCredential = () => false, isStopped = () => false, adapters = null, ollamaFetch = null, credentialResolver = null, cloudFetch = null, cloudResolve = null } = {}) {
  const dir = path.join(stateDir, "models");
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } },
    verifyRecorded: (...a) => { try { return ownerAuth().verifyRecorded(...a); } catch { return false; } } };
  const gate = () => (isStopped() ? { allowed: false, reason: "OWNER_STOP_OR_SAFE_MODE" } : { allowed: true });
  let reg = null, stack = null;
  const open = () => (reg ??= createModelRegistry({ dir, ownerAuth: auth, liveStatus: id => liveStatus(id) || (stack?.bridge.liveStatus(id) ?? false), hasCredential, gate }));
  /** One adapter per registered provider that has a known wire profile (resolved lazily, so providers added later are picked up). Credentials come from the injected resolver (vault) at call time; with none, every cloud call answers NO_CREDENTIAL. */
  /** Egress routes per cloud provider derived from its wire profile: only the chat path (POST) and, where it exists, the free model-list path (GET); port 443. */
  function cloudRoutes() {
    const out = {};
    for (const [id, pr] of Object.entries(PROVIDER_PROFILES)) {
      const paths = [...new Set([pr.chat.split("{model}")[0], pr.models].filter(Boolean))].filter((x, _i, a) => !a.some(y => y !== x && x.startsWith(y)));
      out[id] = { methods: pr.models ? ["GET", "POST"] : ["POST"], pathPrefixes: paths, ports: [443], maxBodyBytes: 1024 * 1024 };
    }
    return out;
  }
  const adapterCache = new Map();
  function adapterFor(r, providerId) {
    if (providerId === "ollama-local") { if (!adapterCache.has(providerId)) adapterCache.set(providerId, createOllamaAdapter({ fetchImpl: ollamaFetch })); return adapterCache.get(providerId); }
    const p = r.listProviders().find(x => x.id === providerId);
    if (!p || p.kind !== "CLOUD" || !Object.hasOwn(PROVIDER_PROFILES, p.id) || p.egressHosts.length !== 1 || p.egressHosts[0] !== PROVIDER_PROFILES[p.id].host) return null;      // an edited host means no adapter (the profile host is fixed)
    const k = p.id + "|" + p.credentialRef;
    if (!adapterCache.has(k)) adapterCache.set(k, createCloudAdapter({ providerId: p.id, credentialRef: p.credentialRef, getCredential: ref => (credentialResolver ? credentialResolver(ref) : null), fetchImpl: cloudFetch, ...(cloudResolve ? { resolveAddresses: cloudResolve } : {}) }));
    return adapterCache.get(k);
  }
  /** The connected chain: registry -> egress policy -> gateway/resilience (probe = LIVE) -> billing guard. The only adapter shipped is the loopback Ollama one; cloud providers have none until the owner adds one. */
  function chain() {
    if (stack) return stack; const r = open();
    const egress = createEgressPolicy({ ownerAuth: auth, stateDir: path.join(stateDir, "models", "egress"), isStopped });
    const pe = createProviderEgress({ registry: r, egress, gate, routes: cloudRoutes(), dir: path.join(stateDir, "models", "provider-egress") });
    const gw = createModelGateway({ resilience: createProviderResilience({ gate, clock: () => Date.now(), timeoutMs: 60000 }), models: createModelIntelligence({ graph: createCapabilityGraph(), clockMs: () => Date.now() }) });
    const bridge = createModelRoutingBridge({ registry: r, gateway: gw, providerEgress: pe, adapters: adapters ?? (id => adapterFor(r, id)) });
    return (stack = { egress, pe, gw, bridge });
  }
  const need = (v, w) => { if (typeof v !== "string" || !v) throw new Error(w + "_REQUIRED"); return v; };
  function view() {
    const r = open(), st = r.status();
    const c = chain(); c.bridge.syncGateway();
    return { state: "CONNECTED", routing: c.bridge.status(), egressProposals: c.pe.proposals().map(({ policy, ...p }) => ({ ...p, hosts: policy?.hosts ?? [] })), gatewayHealth: c.gw.health(), status: st, providers: r.listProviders(), models: r.listModels(), assignments: r.assignments(), roleDefaults: r.roleDefaults(), agents: r.agents(), snapshots: r.snapshots().slice(-10),
      note: "Configuration only. A model is LIVE only after the gateway's own passing probe; no provider adapter is attached to this app, so nothing here is LIVE. Enabling a cloud or paid model needs your signed approval; enabling a free local model changes configuration only and downloads nothing." };
  }
  async function action({ op, ...a } = {}) {
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
      case "probe": return { ok: true, results: await chain().bridge.probeAll() };
      case "ask": { need(a.prompt, "PROMPT"); return chain().bridge.complete({ agentId: need(a.agentId, "AGENT_ID"), prompt: a.prompt, capability: a.capability ?? "text", maxCostUsd: Number(a.maxCostUsd ?? 0) }); }
      case "egressApply": { const id = need(a.providerId, "PROVIDER_ID"), p = chain().pe.proposals().find(x => x.providerId === id); if (!p || p.action === "NONE") return { ok: false, reason: "NOTHING_TO_APPLY" };
        need(a.passphrase, "PASSPHRASE"); return chain().pe.applyProposal(id, { ownerApproval: sign(a.passphrase, p.action, p.subject) }); }
      case "resolve": return r.resolve({ agentId: a.agentId, capability: a.capability ?? "text", maxCostUsd: Number(a.maxCostUsd ?? 0) });
      default: throw new Error("UNKNOWN_MODEL_REGISTRY_OP");
    }
  }
  return { view, action };
}
