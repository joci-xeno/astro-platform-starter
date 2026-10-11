// Bridge: model-registry -> egress-policy (23-point item 3 controlled outbound traffic, applied to the model providers of items 4/5/6).
// It derives the egress policy each ENABLED model's provider needs (exact hosts from the registry, nothing else) and checks one model request
// against BOTH the registry and the egress engine. It never opens a connection and never weakens egress-policy:
//   proposals()                 desired policy per provider with >=1 enabled model (hosts = the provider's registry egressHosts, exact; no wildcards),
//                               plus REMOVE proposals for providers whose policy is still in force but have no enabled model. Each proposal carries the exact
//                               subject egress-policy will verify (policySubject / removeSubject). Providers whose hosts egress-policy refuses (e.g. a
//                               reserved TLD such as .example) are reported as NOT_REPRESENTABLE with the reason, never forced in.
//   applyProposal(id, {ownerApproval})   hands the policy to egress.setPolicy / removePolicy, which verifies the owner's signed approval itself
//                               (EGRESS_POLICY_SET / EGRESS_POLICY_REMOVE bound to the policy hash). This module never verifies or consumes the approval first.
//   checkModelRequest({modelId, url, method, bodyBytes, resolvedAddresses})   deny unless: model known AND enabled AND its provider known AND the model's
//                               hosts still equal the provider's hosts AND the URL host is one of them (exact) AND the kill switch allows AND egress.check allows.
//                               Every decision (allow and deny) is appended to this bridge's own hash-chained audit (host/method/path only; never query or body).
// Status honesty: IMPLEMENTED + unit TESTED with the real registry and egress engine and synthetic hosts. Not CONNECTED: no model gateway calls it yet. Not LIVE.
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { normaliseEgressPolicy, policySubject, removeSubject, LOOPBACK_HOST } from "./egress-policy.mjs";
import { emergencyGate } from "./emergency-stop.mjs";

export const PROVIDER_EGRESS_LIMITS = Object.freeze({ maxUrl: 4096, maxModelId: 64 });
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Route defaults. Owner data: method/path/body limits per provider id may be overridden via `routes`. Paths default to "/" because the registry does not record API paths. */
export const DEFAULT_CLOUD_ROUTE = Object.freeze({ methods: ["POST"], pathPrefixes: ["/"], ports: [443], maxBodyBytes: 1024 * 1024 });
export const DEFAULT_LOOPBACK_ROUTE = Object.freeze({ methods: ["GET", "POST"], pathPrefixes: ["/api"], ports: [11434], maxBodyBytes: 1024 * 1024 });
const sameList = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
/** host of an absolute URL from the RAW string (lowercased); null when there is none. egress.check does the full validation afterwards. */
function rawHost(url) {
  if (typeof url !== "string" || url.length > PROVIDER_EGRESS_LIMITS.maxUrl) return null;
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(url); if (!m) return null;
  const a = m[1]; if (a.includes("@")) return null;
  const h = a.startsWith("[") ? a.slice(0, a.indexOf("]") + 1) : a.split(":")[0];
  return h ? h.toLowerCase() : null;
}

export function createProviderEgress({ registry, egress, gate = emergencyGate, routes = {}, dir = null, now = () => new Date().toISOString() } = {}) {
  if (!registry || typeof registry.getModel !== "function" || typeof registry.listModels !== "function" || typeof registry.listProviders !== "function") throw new Error("REGISTRY_REQUIRED");
  if (!egress || typeof egress.check !== "function" || typeof egress.setPolicy !== "function" || typeof egress.listPolicies !== "function") throw new Error("EGRESS_POLICY_REQUIRED");
  const audit = createAuditChain({ filePath: dir ? path.join(dir, "provider-egress-audit.jsonl") : null, now });
  const stats = { allowed: 0, denied: 0 };

  function desiredPolicy(p) {
    const r = { ...(p.kind === "LOCAL" ? DEFAULT_LOOPBACK_ROUTE : DEFAULT_CLOUD_ROUTE), ...(Object.hasOwn(routes, p.id) ? routes[p.id] : {}) };
    const raw = p.kind === "LOCAL"
      ? { providerId: p.id, loopback: true, hosts: [LOOPBACK_HOST], ports: r.ports, methods: r.methods, pathPrefixes: r.pathPrefixes, maxBodyBytes: r.maxBodyBytes, description: "model provider " + p.id + " (registry-derived, loopback)" }
      : { providerId: p.id, hosts: [...p.egressHosts], ports: r.ports, methods: r.methods, pathPrefixes: r.pathPrefixes, maxBodyBytes: r.maxBodyBytes, description: "model provider " + p.id + " (registry-derived)" };
    if (p.kind === "LOCAL" && !sameList(p.egressHosts, [LOOPBACK_HOST])) return { error: "LOCAL_PROVIDER_NOT_LOOPBACK" };
    return normaliseEgressPolicy(raw);
  }

  /** Desired policy changes. Pure: changes nothing. */
  function proposals() {
    const providers = new Map(registry.listProviders().map(p => [p.id, p]));
    const enabled = registry.listModels().filter(m => m.enabled === true);
    const byProvider = new Map(); for (const m of enabled) { if (!byProvider.has(m.providerId)) byProvider.set(m.providerId, []); byProvider.get(m.providerId).push(m.id); }
    const current = new Map(egress.listPolicies().map(p => [p.providerId, p]));
    const out = [];
    for (const [pid, models] of byProvider) {
      const p = providers.get(pid);
      if (!p) { out.push({ providerId: pid, action: "NONE", state: "NOT_REPRESENTABLE", reason: "PROVIDER_MISSING_FROM_REGISTRY", models }); continue; }
      const n = desiredPolicy(p);
      if (n.error) { out.push({ providerId: pid, action: "NONE", state: "NOT_REPRESENTABLE", reason: n.error, models }); continue; }
      const subject = policySubject(n.policy), cur = current.get(pid), applied = Boolean(cur) && policySubject(cur) === subject;
      out.push({ providerId: pid, action: applied ? "NONE" : "EGRESS_POLICY_SET", state: applied ? "APPLIED" : cur ? "STALE_POLICY_IN_FORCE" : "NO_POLICY", subject, policy: n.policy, models });
    }
    for (const [pid] of current) if (!byProvider.has(pid) && providers.has(pid)) out.push({ providerId: pid, action: "EGRESS_POLICY_REMOVE", state: "POLICY_WITHOUT_ENABLED_MODEL", subject: removeSubject(pid), models: [] });
    return out.sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  /** Apply one proposal. egress-policy verifies the signed owner approval (and consumes it); a wrong/replayed/absent approval is refused there. */
  function applyProposal(providerId, { ownerApproval = null } = {}) {
    if (typeof providerId !== "string" || !ID_RE.test(providerId)) return { ok: false, reason: "PROVIDER_ID_INVALID" };
    const p = proposals().find(x => x.providerId === providerId);
    if (!p || p.action === "NONE") { audit.append("PROPOSAL_NOT_APPLICABLE", { providerId, state: p?.state ?? "NO_PROPOSAL" }); return { ok: false, reason: p ? "NOTHING_TO_APPLY:" + p.state : "NO_PROPOSAL" }; }
    try {
      if (p.action === "EGRESS_POLICY_SET") egress.setPolicy(p.policy, { ownerApproval }); else egress.removePolicy(providerId, { ownerApproval });
    } catch (e) { const reason = String(e?.message ?? e).slice(0, 160); audit.append("PROPOSAL_REFUSED", { providerId, action: p.action, subject: p.subject, reason }); return { ok: false, reason, subject: p.subject, action: p.action }; }
    audit.append("PROPOSAL_APPLIED", { providerId, action: p.action, subject: p.subject, models: p.models });
    return { ok: true, providerId, action: p.action, subject: p.subject };
  }

  function record(allowed, reason, info) {
    allowed ? stats.allowed++ : stats.denied++;
    const d = { allowed, reason, modelId: info.modelId ?? null, providerId: info.providerId ?? null, host: info.host ?? null, method: info.method ?? null, path: info.path ?? null, egressDecisionSeq: info.egressDecisionSeq ?? null };
    try { const e = audit.append(allowed ? "MODEL_EGRESS_ALLOW" : "MODEL_EGRESS_DENY", d); d.auditSeq = e.seq; }
    catch { if (allowed) return { ...d, allowed: false, reason: "AUDIT_UNAVAILABLE" }; }      // no audit, no egress
    return d;
  }

  /** Never throws. */
  function checkModelRequest(request) {
    const r = request && typeof request === "object" ? request : {};
    const info = { modelId: typeof r.modelId === "string" ? r.modelId.slice(0, PROVIDER_EGRESS_LIMITS.maxModelId) : null, method: typeof r.method === "string" ? r.method.slice(0, 10).toUpperCase() : r.method === undefined ? "GET" : null };
    const D = reason => record(false, reason, info);
    try {
      if (typeof r.modelId !== "string" || !ID_RE.test(r.modelId)) return D("MODEL_ID_INVALID");
      const m = registry.getModel(r.modelId); if (!m) return D("UNKNOWN_MODEL");
      info.providerId = m.providerId;
      if (m.enabled !== true) return D("MODEL_DISABLED");
      const p = registry.listProviders().find(x => x.id === m.providerId); if (!p) return D("PROVIDER_MISSING_FROM_REGISTRY");
      if (!sameList(m.egressHosts, p.egressHosts)) return D("MODEL_HOSTS_DIFFER_FROM_PROVIDER");      // a model must not carry its own private host list
      const host = rawHost(r.url); info.host = host;
      if (!host) return D("URL_INVALID");
      if (!m.egressHosts.includes(host)) return D("HOST_NOT_IN_REGISTRY");                             // exact match only
      const g = gate({ external: m.kind !== "LOCAL" }); if (g && g.allowed === false) return D("EMERGENCY_STOP:" + g.reason);
      const e = egress.check({ providerId: m.providerId, url: r.url, method: r.method, bodyBytes: r.bodyBytes, resolvedAddresses: r.resolvedAddresses });
      Object.assign(info, { path: e.path ?? null, egressDecisionSeq: e.decisionSeq ?? null, host: e.host ?? host });
      if (!e.allowed) return D("EGRESS_" + e.reason);
      const d = record(true, null, info); if (d.allowed && e.pinTo) d.pinTo = e.pinTo; return d;
    } catch (e) { return D("CHECK_ERROR"); }
  }

  const summary = () => { const ps = proposals(); return { state: "IMPLEMENTED_NOT_CONNECTED", live: false, ...stats, pending: ps.filter(p => p.action !== "NONE").length, notRepresentable: ps.filter(p => p.state === "NOT_REPRESENTABLE").length, auditHead: audit.head(), note: "Decision bridge only; no model gateway consults it yet." }; };
  return { proposals, applyProposal, checkModelRequest, summary, audit: () => audit.entries(), auditVerify: () => audit.verifyFile() };
}
