// Model & provider registry (23-point items 4, 5, 6, 18; owner requirement "add, edit, enable, disable or upgrade models later without reinstalling ATLASZ").
// This is CONFIGURATION: which providers/models exist, their versions, who may use them, and which one each of the 30 permanent agents is assigned to.
// It never calls a model and never holds a credential value (only a credential REFERENCE name that the vault resolves). LIVE is not a field here: it comes from the model gateway's own
// probe evidence (`liveStatus(modelId)`), so editing this file can never make a model look LIVE.
//
//   addProvider / addModel     data only, created DISABLED (nothing runs, nothing is paid)
//   editModel                  bumps the revision; any change to a risk field of an enabled model disables it again
//   enable                     FREE local model: owner is not asked (nothing leaves the machine, nothing is downloaded by this module);
//                              CLOUD or PAID/UNKNOWN cost: a signed owner approval (MODEL_ENABLE, subject = id@version:configHash) bound to that exact configuration; kill switch honoured
//   disable                    always allowed, also under the kill switch (it can only reduce risk)
//   upgrade                    version must rise; removed capabilities need an explicit acknowledgement; a model that needs approval is disabled again until re-approved for the new version
//   rollback                   owner-approved (MODEL_REGISTRY_ROLLBACK) restore of an earlier snapshot; models that need approval come back DISABLED (a rollback can never resurrect an old spend approval)
//   assignments                exactly the 30 permanent agents (SEARCH-1..5, EXECUTION-1..25); unknown ids are refused; the table can never add an agent
//   resolve                    ordered candidates for (agent, capability, budget) - no-spend by default; disabled / credential-less / not-LIVE models are reported, never silently used
//   billing guard              one request key is billed by one provider attempt at a time; failover only after the earlier attempt settled as failed with zero cost
//   schema versioning          `schemaVersion` + migration chain; a newer schema than this code knows opens READ-ONLY (never rewritten by an older build); backup snapshot before every change
// Truth is the hash-chained audit log: the registry file is checked against the config hash the chain recorded; a hand-edited file opens READ-ONLY (integrity MISMATCH) until the owner rolls back.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { containsSecret } from "./secret-patterns.mjs";
import { emergencyGate } from "./emergency-stop.mjs";
import { compareVersions, parseVersion } from "./update-center.mjs";
import { ROSTER } from "./agent-activity.mjs";

export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({ maxProviders: 100, maxModels: 500, maxCapabilities: 40, maxSnapshots: 25, maxBillingKeys: 5000, maxHosts: 20, maxFallbacks: 5, maxText: 200 });
export const COST_CLASSES = Object.freeze(["FREE", "PAID", "UNKNOWN"]);
export const KINDS = Object.freeze(["CLOUD", "LOCAL"]);
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/, HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PM_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,119}$/;
const CAP_RE = /^[a-z0-9][a-z0-9._:-]{0,39}$/, RISK_FIELDS = ["providerId", "costClass", "kind", "egressHosts", "credentialRef", "costPer1kTokensUsd"];
const sha = v => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const clean = s => typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxText && !/[\u0000-\u001f\u007f\u2028\u2029\p{Cf}]/u.test(s) && !containsSecret(s);
const sorted = o => Array.isArray(o) ? o.map(sorted) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sorted(o[k])])) : o;
export const modelConfigHash = m => sha(sorted({ id: m.id, providerId: m.providerId, version: m.version, kind: m.kind, costClass: m.costClass, capabilities: m.capabilities, contextLimit: m.contextLimit, egressHosts: m.egressHosts, credentialRef: m.credentialRef, costPer1kTokensUsd: m.costPer1kTokensUsd, ...(m.providerModel ? { providerModel: m.providerModel } : {}) })).slice(0, 16);
export const needsApproval = m => m.kind !== "LOCAL" || m.costClass !== "FREE";

/** Starter catalogue. It is DATA the owner edits; the exact list of "13 providers" is not defined anywhere in the repository, so only the providers named by the owner's capability sources are seeded. */
export const SEED_PROVIDERS = Object.freeze([
  { id: "openai", displayName: "OpenAI (GPT family)", kind: "CLOUD", family: "gpt", egressHosts: ["api.openai.com"], credentialRef: "OPENAI_API_KEY" },
  { id: "anthropic", displayName: "Anthropic (Claude family)", kind: "CLOUD", family: "claude", egressHosts: ["api.anthropic.com"], credentialRef: "ANTHROPIC_API_KEY" },
  { id: "google", displayName: "Google (Gemini family)", kind: "CLOUD", family: "gemini", egressHosts: ["generativelanguage.googleapis.com"], credentialRef: "GOOGLE_API_KEY" },
  { id: "xai", displayName: "xAI (Grok family)", kind: "CLOUD", family: "grok", egressHosts: ["api.x.ai"], credentialRef: "XAI_API_KEY" },
  { id: "merlin", displayName: "Merlin AI", kind: "CLOUD", family: "merlin", egressHosts: ["api.merlin.example"], credentialRef: "MERLIN_API_KEY" },
  { id: "deepseek", displayName: "DeepSeek", kind: "CLOUD", family: "deepseek", egressHosts: ["api.deepseek.com"], credentialRef: "DEEPSEEK_API_KEY" },
  { id: "mistral", displayName: "Mistral AI", kind: "CLOUD", family: "mistral", egressHosts: ["api.mistral.ai"], credentialRef: "MISTRAL_API_KEY" },
  { id: "vercel-ai-gateway", displayName: "Vercel AI Gateway (model router)", kind: "CLOUD", family: "vercel-ai-gateway", egressHosts: ["ai-gateway.vercel.sh"], credentialRef: "VERCEL_AI_GATEWAY_KEY" },
  { id: "openrouter", displayName: "OpenRouter (model router)", kind: "CLOUD", family: "openrouter", egressHosts: ["openrouter.ai"], credentialRef: "OPENROUTER_API_KEY" },
  { id: "minimax", displayName: "MiniMax", kind: "CLOUD", family: "minimax", egressHosts: ["api.minimax.io"], credentialRef: "MINIMAX_API_KEY" },
  { id: "glm", displayName: "Zhipu GLM (open.bigmodel.cn)", kind: "CLOUD", family: "glm", egressHosts: ["open.bigmodel.cn"], credentialRef: "GLM_API_KEY" },
  { id: "perplexity", displayName: "Perplexity", kind: "CLOUD", family: "perplexity", egressHosts: ["api.perplexity.ai"], credentialRef: "PERPLEXITY_API_KEY" },
  { id: "huggingface", displayName: "Hugging Face (inference router)", kind: "CLOUD", family: "huggingface", egressHosts: ["router.huggingface.co"], credentialRef: "HF_TOKEN" },
  { id: "ollama-local", displayName: "Ollama (local, loopback only)", kind: "LOCAL", family: "local", egressHosts: ["127.0.0.1"], credentialRef: null }
]);

export function createModelRegistry({ dir, ownerAuth = null, gate = emergencyGate, now = () => new Date().toISOString(), liveStatus = () => false, hasCredential = () => false, roster = ROSTER } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED");
  fs.mkdirSync(path.join(dir, "snapshots"), { recursive: true });
  const FILE = path.join(dir, "registry.json"), audit = createAuditChain({ filePath: path.join(dir, "registry-audit.jsonl") }), BILL = path.join(dir, "billing.json");
  const agentSet = new Set(roster);
  if (agentSet.size !== 30) throw new Error("ROSTER_MUST_BE_EXACTLY_30");
  const fresh = () => ({ schemaVersion: SCHEMA_VERSION, revision: 0, providers: {}, models: {}, assignments: {}, roleDefaults: { SEARCH: [], EXECUTION: [] } });
  const MIGRATIONS = {};      // from schemaVersion N -> N+1: (state) => state ; none exist yet (version 1 is the first)
  let state = fresh(), integrity = "NEW", readOnly = false, note = null;

  const expectedHash = () => { const e = audit.entries().filter(x => x.event === "REGISTRY_REVISION"); return e.length ? e[e.length - 1].data : null; };
  function load() {
    if (!fs.existsSync(FILE)) { integrity = audit.entries().some(x => x.event === "REGISTRY_REVISION") ? "FILE_MISSING" : "NEW"; readOnly = integrity === "FILE_MISSING"; return; }
    let raw, parsed; try { raw = fs.readFileSync(FILE, "utf8"); parsed = JSON.parse(raw); } catch { integrity = "UNREADABLE"; readOnly = true; return; }
    if (!parsed || typeof parsed !== "object" || !Number.isInteger(parsed.schemaVersion)) { integrity = "UNREADABLE"; readOnly = true; return; }
    if (parsed.schemaVersion > SCHEMA_VERSION) { state = parsed; integrity = "NEWER_SCHEMA"; readOnly = true; note = `registry schema ${parsed.schemaVersion} is newer than this build (${SCHEMA_VERSION}); opened read-only`; return; }
    let s = parsed; while (s.schemaVersion < SCHEMA_VERSION) { const f = MIGRATIONS[s.schemaVersion]; if (!f) { integrity = "NO_MIGRATION"; readOnly = true; return; } s = f(structuredClone(s)); s.schemaVersion = (s.schemaVersion ?? 0) + 1; }
    const exp = expectedHash();
    state = s; integrity = exp === null ? "UNCHAINED" : exp.sha256 === sha(raw) ? "OK" : "MISMATCH"; const nonEmpty = s.revision > 0 || Object.keys(s.models ?? {}).length > 0 || Object.keys(s.providers ?? {}).length > 0 || Object.keys(s.assignments ?? {}).length > 0;
    readOnly = integrity === "MISMATCH" || integrity === "UNCHAINED" && (audit.entries().length > 0 || nonEmpty);
    if (integrity === "UNCHAINED" && readOnly) note = "registry has content but no audit history (log deleted or registry copied in); read-only until the owner rolls back to a verified snapshot";
    if (integrity === "MISMATCH") note = "registry.json does not match the hash recorded in the audit chain (hand edit?); read-only until the owner rolls back to a verified snapshot";
  }
  load();
  // Every enabled model that needs approval must have a recorded, still-valid owner signature bound to its exact configuration; otherwise it is forced DISABLED in memory.
  let unapprovedEnabled = [];
  function consistentWithProvider(m) {
    const p = Object.hasOwn(state.providers ?? {}, m.providerId) ? state.providers[m.providerId] : null;
    if (!p || p.kind !== m.kind || (p.credentialRef ?? null) !== (m.credentialRef ?? null) || !Array.isArray(m.egressHosts) || !m.egressHosts.every(h => p.egressHosts.includes(h))) return false;
    if (p.kind === "LOCAL" && (m.credentialRef != null || m.egressHosts.some(h => h !== "127.0.0.1"))) return false;
    if (p.kind === "CLOUD" && m.costClass === "FREE") return false;
    return true;
  }
  function enforceRecordedApprovals() {
    unapprovedEnabled = [];
    const last = new Map(); for (const e of audit.entries()) { if (e.event !== "REGISTRY_REVISION") continue; const d = e.data ?? {}; if (d.event === "MODEL_ENABLED" || d.event === "MODEL_DISABLED") last.set(d.id, d); }
    for (const m of Object.values(state.models ?? {})) {
      if (m.enabled && !consistentWithProvider(m)) { m.enabled = false; unapprovedEnabled.push(m.id); continue; }       // kind/hosts/credential must still be those of the provider (a hand edit cannot turn a cloud model into a "local free" one)
      if (!m.enabled || !needsApproval(m)) continue;
      const d = last.get(m.id); let ok = false;
      try { ok = Boolean(d && d.event === "MODEL_ENABLED" && d.cfg === modelConfigHash(m) && ownerAuth && typeof ownerAuth.verifyRecorded === "function" && ownerAuth.verifyRecorded(d.approval, { action: "MODEL_ENABLE", subject: enableSubject(m) })); } catch { ok = false; }
      if (!ok) { m.enabled = false; unapprovedEnabled.push(m.id); }
    }
    if (unapprovedEnabled.length) note = (note ? note + "; " : "") + "UNAPPROVED_ENABLED: " + unapprovedEnabled.join(",") + " forced disabled (no valid recorded owner approval)";
  }
  enforceRecordedApprovals();

  function persist(event, detail) {
    const next = { ...state, revision: state.revision + 1 }, raw = JSON.stringify(next, null, 1);
    const snap = path.join(dir, "snapshots", String(next.revision).padStart(6, "0") + ".json");
    fs.writeFileSync(snap, raw, { mode: 0o600 });
    const tmpf = FILE + ".tmp"; fs.writeFileSync(tmpf, raw, { mode: 0o600 }); fs.renameSync(tmpf, FILE);
    audit.append("REGISTRY_REVISION", { revision: next.revision, sha256: sha(raw), event, ...detail });
    state = next; integrity = "OK";
    const snaps = fs.readdirSync(path.join(dir, "snapshots")).sort(); while (snaps.length > LIMITS.maxSnapshots) fs.rmSync(path.join(dir, "snapshots", snaps.shift()), { force: true });
  }
  const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const guard = () => readOnly ? refuse("REGISTRY_READ_ONLY:" + integrity, { note }) : null;
  const mutate = (event, detail, fn) => { const g = guard(); if (g) return g; const backup = structuredClone(state); try { const r = fn(); if (r && r.ok === false) { state = backup; return r; } persist(event, detail); return { ok: true, revision: state.revision, ...(r ?? {}) }; } catch (e) { state = backup; return refuse("REGISTRY_ERROR", { error: String(e.message).slice(0, 160) }); } };

  function validHosts(hosts, kind) {
    if (!Array.isArray(hosts) || hosts.length > LIMITS.maxHosts) return false;
    return hosts.every(h => typeof h === "string" && (HOST_RE.test(h) || (kind === "LOCAL" && h === "127.0.0.1")));      // exact host names only (no wildcards, no ports, no userinfo); loopback only for LOCAL
  }
  function addProvider(p = {}) {
    return mutate("PROVIDER_ADDED", { id: p.id }, () => {
      if (!ID_RE.test(p.id ?? "")) return refuse("PROVIDER_ID_INVALID"); if (state.providers[p.id]) return refuse("PROVIDER_EXISTS");
      if (Object.keys(state.providers).length >= LIMITS.maxProviders) return refuse("PROVIDER_LIMIT");
      if (!KINDS.includes(p.kind)) return refuse("KIND_INVALID"); if (!clean(p.displayName)) return refuse("NAME_INVALID");
      if (!validHosts(p.egressHosts ?? [], p.kind) || (p.kind === "CLOUD" && !(p.egressHosts ?? []).length)) return refuse("EGRESS_HOSTS_INVALID");
      if (p.kind === "LOCAL" && (p.egressHosts ?? []).some(h => h !== "127.0.0.1")) return refuse("LOCAL_PROVIDER_MUST_BE_LOOPBACK");
      if (p.kind === "LOCAL" && p.credentialRef != null) return refuse("LOCAL_PROVIDER_CANNOT_HAVE_CREDENTIAL");
      if (p.credentialRef != null && !(typeof p.credentialRef === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(p.credentialRef))) return refuse("CREDENTIAL_REF_MUST_BE_A_NAME");
      state.providers[p.id] = { id: p.id, displayName: p.displayName, kind: p.kind, family: ID_RE.test(p.family ?? "") ? p.family : p.id, egressHosts: [...(p.egressHosts ?? [])], credentialRef: p.credentialRef ?? null, addedAt: now() };
    });
  }
  function seedDefaults() { const out = []; for (const p of SEED_PROVIDERS) if (!state.providers[p.id]) out.push([p.id, addProvider(p).ok]); return out; }
  function addModel(m = {}) {
    return mutate("MODEL_ADDED", { id: m.id }, () => {
      if (!ID_RE.test(m.id ?? "")) return refuse("MODEL_ID_INVALID"); if (state.models[m.id]) return refuse("MODEL_EXISTS");
      if (Object.keys(state.models).length >= LIMITS.maxModels) return refuse("MODEL_LIMIT");
      const p = state.providers[m.providerId]; if (!p) return refuse("UNKNOWN_PROVIDER");
      if (!parseVersion(m.version)) return refuse("VERSION_MUST_BE_SEMVER"); if (!COST_CLASSES.includes(m.costClass ?? "UNKNOWN")) return refuse("COST_CLASS_INVALID");
      const caps = [...new Set(m.capabilities ?? [])]; if (!caps.length || caps.length > LIMITS.maxCapabilities || !caps.every(c => CAP_RE.test(c))) return refuse("CAPABILITIES_INVALID");
      if (!clean(m.displayName ?? m.id)) return refuse("NAME_INVALID");
      const per = m.costPer1kTokensUsd ?? (m.costClass === "FREE" ? 0 : null); if (per !== null && !(Number.isFinite(per) && per >= 0 && per < 1000)) return refuse("COST_INVALID");
      if (m.costClass === "FREE" && p.kind === "CLOUD") return refuse("CLOUD_MODEL_CANNOT_BE_DECLARED_FREE_WITHOUT_EVIDENCE");
      if (m.providerModel !== undefined && (typeof m.providerModel !== "string" || !PM_RE.test(m.providerModel) || m.providerModel.includes(".."))) return refuse("PROVIDER_MODEL_INVALID");
      state.models[m.id] = { id: m.id, displayName: m.displayName ?? m.id, providerId: p.id, family: p.family, kind: p.kind, version: m.version, costClass: m.costClass ?? "UNKNOWN", costPer1kTokensUsd: per, capabilities: caps, contextLimit: Number.isInteger(m.contextLimit) && m.contextLimit > 0 ? m.contextLimit : null,
        egressHosts: [...p.egressHosts], credentialRef: p.credentialRef, ...(m.providerModel ? { providerModel: m.providerModel } : {}), enabled: false, revision: 1, addedAt: now() };
    });
  }
  function editModel(id, patch = {}) {
    return mutate("MODEL_EDITED", { id, fields: Object.keys(patch) }, () => {
      const m = state.models[id]; if (!m) return refuse("UNKNOWN_MODEL");
      const allowed = ["displayName", "capabilities", "contextLimit", "costClass", "costPer1kTokensUsd"], bad = Object.keys(patch).filter(k => !allowed.includes(k)); if (bad.length) return refuse("FIELD_NOT_EDITABLE", { fields: bad });
      const next = { ...m, ...structuredClone(patch) };
      if (patch.displayName !== undefined && !clean(patch.displayName)) return refuse("NAME_INVALID");
      if (patch.capabilities !== undefined) { const c = [...new Set(patch.capabilities)]; if (!Array.isArray(patch.capabilities) || !c.length || c.length > LIMITS.maxCapabilities || !c.every(x => CAP_RE.test(x))) return refuse("CAPABILITIES_INVALID"); next.capabilities = c; }
      if (patch.costClass !== undefined && !COST_CLASSES.includes(patch.costClass)) return refuse("COST_CLASS_INVALID");
      if (patch.costPer1kTokensUsd !== undefined && !(Number.isFinite(patch.costPer1kTokensUsd) && patch.costPer1kTokensUsd >= 0 && patch.costPer1kTokensUsd < 1000)) return refuse("COST_INVALID");
      if (next.costClass === "FREE" && next.kind === "CLOUD") return refuse("CLOUD_MODEL_CANNOT_BE_DECLARED_FREE_WITHOUT_EVIDENCE");
      const riskChanged = RISK_FIELDS.some(f => JSON.stringify(next[f]) !== JSON.stringify(m[f])) || JSON.stringify(next.capabilities) !== JSON.stringify(m.capabilities);
      next.revision = m.revision + 1; if (m.enabled && riskChanged && needsApproval(next)) next.enabled = false;      // needs a fresh approval for the new configuration
      state.models[id] = next; return { disabledBecauseRiskChanged: m.enabled && !next.enabled };
    });
  }
  function verifyOwner(approval, action, subject) {
    if (!ownerAuth) return { ok: false, reason: "OWNER_AUTH_NOT_CONFIGURED" };
    try { const r = ownerAuth.verifyApproval(approval, { action, subject }); return r && r.allowed === true ? { ok: true } : { ok: false, reason: r?.reason ?? "OWNER_APPROVAL_INVALID" }; } catch (e) { return { ok: false, reason: "OWNER_APPROVAL_INVALID" }; }
  }
  function enableSubject(m) { return `model:${m.id}@${m.version}:${modelConfigHash(m)}`; }
  function enable(id, { approval = null } = {}) {
    const g = guard(); if (g) return g; const m = state.models[id]; if (!m) return refuse("UNKNOWN_MODEL"); if (m.enabled) return { ok: true, unchanged: true };
    const gt = gate({ external: m.kind !== "LOCAL" }); if (!gt.allowed) return refuse("EMERGENCY_STOP:" + gt.reason);
    if (needsApproval(m)) { const v = verifyOwner(approval, "MODEL_ENABLE", enableSubject(m)); if (!v.ok) return refuse("OWNER_APPROVAL_REQUIRED", { detail: v.reason, subject: enableSubject(m) }); }
    return mutate("MODEL_ENABLED", { id, version: m.version, cfg: modelConfigHash(m), approved: needsApproval(m), approval: needsApproval(m) ? approval : null }, () => { state.models[id].enabled = true; });
  }
  function disable(id) { return mutate("MODEL_DISABLED", { id }, () => { const m = state.models[id]; if (!m) return refuse("UNKNOWN_MODEL"); m.enabled = false; }); }
  function upgrade(id, { version, capabilities = null, acknowledgeRemovedCapabilities = false } = {}) {
    return mutate("MODEL_UPGRADED", { id, version }, () => {
      const m = state.models[id]; if (!m) return refuse("UNKNOWN_MODEL"); if (!parseVersion(version)) return refuse("VERSION_MUST_BE_SEMVER");
      if (compareVersions(version, m.version) <= 0) return refuse("NOT_AN_UPGRADE", { current: m.version });
      let caps = m.capabilities; if (capabilities !== null) { if (!Array.isArray(capabilities) || !capabilities.length || !capabilities.every(c => CAP_RE.test(c))) return refuse("CAPABILITIES_INVALID"); caps = [...new Set(capabilities)]; }
      const removed = m.capabilities.filter(c => !caps.includes(c)); if (removed.length && !acknowledgeRemovedCapabilities) return refuse("CAPABILITIES_REMOVED_NEEDS_ACK", { removed });
      const inUse = Object.entries(state.assignments).filter(([, a]) => [a.primary, ...(a.fallbacks ?? [])].includes(id) && removed.includes(a.capability)).map(([k]) => k); if (inUse.length) return refuse("REMOVED_CAPABILITY_STILL_ASSIGNED", { agents: inUse });
      const was = m.enabled, previousVersion = m.version; m.version = version; m.capabilities = caps; m.revision += 1; if (needsApproval(m)) m.enabled = false;
      return { previousVersion, requiresReapproval: was && !m.enabled };
    });
  }
  function remove(id) {
    return mutate("MODEL_REMOVED", { id }, () => {
      if (!state.models[id]) return refuse("UNKNOWN_MODEL"); const used = Object.entries(state.assignments).filter(([, a]) => [a.primary, ...(a.fallbacks ?? [])].includes(id)).map(([k]) => k);
      const dflt = Object.entries(state.roleDefaults).filter(([, l]) => l.includes(id)).map(([k]) => k); if (used.length || dflt.length) return refuse("MODEL_STILL_ASSIGNED", { agents: used, roles: dflt }); delete state.models[id];
    });
  }
  function rollbackSubject(rev) { const f = path.join(dir, "snapshots", String(rev).padStart(6, "0") + ".json"); return fs.existsSync(f) ? `registry:${rev}:${sha(fs.readFileSync(f, "utf8")).slice(0, 16)}` : null; }
  function rollback(toRevision, { approval = null } = {}) {
    const subj = rollbackSubject(toRevision); if (!Number.isInteger(toRevision) || !subj) return refuse("SNAPSHOT_NOT_FOUND");
    const v = verifyOwner(approval, "MODEL_REGISTRY_ROLLBACK", subj); if (!v.ok) return refuse("OWNER_APPROVAL_REQUIRED", { detail: v.reason, subject: subj });
    let snap; try { snap = JSON.parse(fs.readFileSync(path.join(dir, "snapshots", String(toRevision).padStart(6, "0") + ".json"), "utf8")); } catch { return refuse("SNAPSHOT_UNREADABLE"); }
    if (!snap || snap.schemaVersion !== SCHEMA_VERSION || typeof snap.models !== "object") return refuse("SNAPSHOT_INCOMPATIBLE");
    { const rawSnap = fs.readFileSync(path.join(dir, "snapshots", String(toRevision).padStart(6, "0") + ".json"), "utf8");
      const rec = audit.entries().filter(x => x.event === "REGISTRY_REVISION" && x.data?.revision === toRevision).at(-1);
      if (!rec) return refuse("SNAPSHOT_UNVERIFIABLE_NO_AUDIT_RECORD"); if (rec.data.sha256 !== sha(rawSnap)) return refuse("SNAPSHOT_TAMPERED"); }
    const wasReadOnly = readOnly; readOnly = false;      // a rollback is the way out of a read-only state
    const backup = structuredClone(state), bi = integrity;
    try { const keepRev = state.revision; state = { ...snap, revision: keepRev }; for (const m of Object.values(state.models)) { if (needsApproval(m)) m.enabled = false; const p = Object.hasOwn(state.providers, m.providerId) ? state.providers[m.providerId] : null;
        if (!p || p.kind !== m.kind || p.credentialRef !== m.credentialRef || !(m.egressHosts ?? []).every(h => p.egressHosts.includes(h)) || (p.kind === "LOCAL" && (m.credentialRef !== null || m.egressHosts.some(h => h !== "127.0.0.1")))) m.enabled = false; }
      note = null; persist("REGISTRY_ROLLED_BACK", { toRevision, from: bi }); return { ok: true, revision: state.revision, restoredFrom: toRevision, note: "models that need approval come back DISABLED" }; }
    catch (e) { state = backup; readOnly = wasReadOnly; return refuse("ROLLBACK_FAILED", { error: String(e.message).slice(0, 120) }); }
  }
  function setAssignment(agentId, { primary, fallbacks = [], capability = "text" } = {}) {
    return mutate("ASSIGNMENT_SET", { agentId, primary }, () => {
      if (!agentSet.has(agentId)) return refuse("NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
      if (typeof primary !== "string" || !Object.hasOwn(state.models, primary)) return refuse("UNKNOWN_MODEL"); if (!Array.isArray(fallbacks) || fallbacks.length > LIMITS.maxFallbacks || fallbacks.some(f => typeof f !== "string" || !Object.hasOwn(state.models, f) || f === primary)) return refuse("FALLBACKS_INVALID");
      if (!CAP_RE.test(capability)) return refuse("CAPABILITY_INVALID"); for (const id of [primary, ...fallbacks]) if (!state.models[id].capabilities.includes(capability)) return refuse("MODEL_LACKS_CAPABILITY", { model: id });
      state.assignments[agentId] = { primary, fallbacks: [...fallbacks], capability, setAt: now() };
    });
  }
  function clearAssignment(agentId) { return mutate("ASSIGNMENT_CLEARED", { agentId }, () => { if (!agentSet.has(agentId)) return refuse("NOT_ONE_OF_THE_30_PERMANENT_AGENTS"); delete state.assignments[agentId]; }); }
  function setRoleDefault(role, modelIds) {
    return mutate("ROLE_DEFAULT_SET", { role }, () => { if (!["SEARCH", "EXECUTION"].includes(role)) return refuse("ROLE_INVALID"); if (!Array.isArray(modelIds) || modelIds.length > LIMITS.maxFallbacks + 1 || modelIds.some(i => typeof i !== "string" || !Object.hasOwn(state.models, i))) return refuse("MODELS_INVALID"); state.roleDefaults[role] = [...modelIds]; });
  }
  const roleOf = id => id.split("-")[0];
  function describe(m) {
    const live = Boolean(liveStatus(m.id)), cred = m.credentialRef === null ? true : Boolean(hasCredential(m.credentialRef));
    const blockers = []; if (!m.enabled) blockers.push("DISABLED"); if (!cred) blockers.push("NO_CREDENTIAL"); if (!live) blockers.push("NOT_LIVE_NO_PASSING_PROBE");
    return { ...m, status: !m.enabled ? "DISABLED" : !cred ? "NO_CREDENTIAL" : live ? "LIVE" : "ENABLED_NOT_PROBED", live, usable: blockers.length === 0, blockers, configHash: modelConfigHash(m), needsOwnerApprovalToEnable: needsApproval(m) };
  }
  /** Ordered candidates for an agent. maxCostUsd=0 means no-spend: only costPer1kTokensUsd===0 models qualify. Unusable models are listed in `skipped` with the reason. */
  function resolve({ agentId, capability = "text", maxCostUsd = 0, estimateTokens = 1000 } = {}) {
    if (!agentSet.has(agentId)) return refuse("NOT_ONE_OF_THE_30_PERMANENT_AGENTS");
    if (readOnly && (integrity === "MISMATCH" || integrity === "UNCHAINED")) return refuse("REGISTRY_UNTRUSTED:" + integrity, { note });      // fail closed: a hand-edited registry routes nothing until the owner rolls back to a verified snapshot
    if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0) return refuse("BUDGET_INVALID"); if (!Number.isFinite(estimateTokens) || estimateTokens < 0) return refuse("ESTIMATE_INVALID");
    const a = state.assignments[agentId], order = [...(a && a.capability === capability ? [a.primary, ...a.fallbacks] : []), ...state.roleDefaults[roleOf(agentId)], ...Object.keys(state.models)];
    const seen = new Set(), candidates = [], skipped = [];
    for (const id of order) { if (seen.has(id)) continue; seen.add(id); const m = state.models[id]; if (!m) continue; if (!m.capabilities.includes(capability)) continue;
      const d = describe(m), est = m.costPer1kTokensUsd === null ? null : m.costPer1kTokensUsd * estimateTokens / 1000;
      if (est === null || est > maxCostUsd) { skipped.push({ id, reason: est === null ? "COST_UNKNOWN" : "OVER_BUDGET", estimateUsd: est }); continue; }
      if (!d.usable) { skipped.push({ id, reason: d.blockers.join("+") }); continue; }
      candidates.push({ id, providerId: m.providerId, family: m.family, version: m.version, estimateUsd: est, assigned: Boolean(a && (a.primary === id || a.fallbacks.includes(id))) }); }
    return { ok: true, agentId, capability, noSpend: maxCostUsd === 0, candidates, skipped, note: candidates.length ? null : "NO_ELIGIBLE_MODEL: nothing is enabled, credentialed and LIVE within the budget" };
  }
  // ---- billing guard: a request key is billed once; failover only after a settled zero-cost failure ----
  function readBill() { try { const b = JSON.parse(fs.readFileSync(BILL, "utf8")); return b && typeof b.keys === "object" && b.keys ? b : { keys: {} }; } catch { return { keys: {} }; } }
  function writeBill(b) { const ks = Object.keys(b.keys); if (ks.length > LIMITS.maxBillingKeys) { let over = ks.length - LIMITS.maxBillingKeys; for (const k of ks) { if (over <= 0) break; if (b.keys[k].state !== "OPEN") { delete b.keys[k]; over--; } } } const t = BILL + ".tmp"; fs.writeFileSync(t, JSON.stringify(b), { mode: 0o600 }); fs.renameSync(t, BILL); }
  const KEY = k => "k:" + k;
  const billing = {
    begin(requestKey, modelId) {
      if (typeof requestKey !== "string" || !/^[\w:.-]{8,100}$/.test(requestKey)) return refuse("REQUEST_KEY_INVALID"); if (typeof modelId !== "string" || !Object.hasOwn(state.models, modelId)) return refuse("UNKNOWN_MODEL");
      const b = readBill(), k = Object.hasOwn(b.keys, KEY(requestKey)) ? b.keys[KEY(requestKey)] : undefined;
      if (!k && Object.keys(b.keys).length >= LIMITS.maxBillingKeys && !Object.values(b.keys).some(v => v.state !== "OPEN")) return refuse("BILLING_TABLE_FULL");
      if (k && !(k.state === "FAILED_NO_COST")) return refuse("DUPLICATE_BILLING_BLOCKED", { existing: { model: k.attempts.at(-1).model, state: k.state } });
      b.keys[KEY(requestKey)] = { state: "OPEN", attempts: [...(k?.attempts ?? []), { model: modelId, at: now() }], costUsd: 0 }; writeBill(b); audit.append("BILLING_BEGIN", { requestKey, modelId }); return { ok: true, attempt: b.keys[KEY(requestKey)].attempts.length };
    },
    settle(requestKey, { ok, costUsd = 0 } = {}) {
      const b = readBill(), k = typeof requestKey === "string" && Object.hasOwn(b.keys, KEY(requestKey)) ? b.keys[KEY(requestKey)] : undefined; if (!k || k.state !== "OPEN") return refuse("NOT_OPEN"); if (!(Number.isFinite(costUsd) && costUsd >= 0)) return refuse("COST_INVALID");
      k.state = ok ? "SETTLED" : costUsd === 0 ? "FAILED_NO_COST" : "FAILED_BILLED"; k.costUsd = costUsd; writeBill(b); audit.append("BILLING_SETTLE", { requestKey, ok: Boolean(ok), costUsd }); return { ok: true, state: k.state, failoverAllowed: k.state === "FAILED_NO_COST" };
    },
    status: requestKey => { const b = readBill(); return typeof requestKey === "string" && Object.hasOwn(b.keys, KEY(requestKey)) ? b.keys[KEY(requestKey)] : null; }
  };
  const snapshots = () => fs.readdirSync(path.join(dir, "snapshots")).sort().map(f => ({ revision: Number(f.slice(0, 6)), subject: rollbackSubject(Number(f.slice(0, 6))) }));
  return {
    addProvider, seedDefaults, addModel, editModel, enable, disable, upgrade, remove, rollback, setAssignment, clearAssignment, setRoleDefault, resolve, billing, snapshots, enableSubject, rollbackSubject,
    getModel: id => state.models[id] ? describe(state.models[id]) : null,
    listModels: () => Object.values(state.models).map(describe), listProviders: () => Object.values(state.providers).map(p => ({ ...p, models: Object.values(state.models).filter(m => m.providerId === p.id).length, credentialConfigured: p.credentialRef === null ? null : Boolean(hasCredential(p.credentialRef)) })),
    assignments: () => structuredClone(state.assignments), roleDefaults: () => structuredClone(state.roleDefaults), agents: () => [...roster],
    status: () => ({ schemaVersion: state.schemaVersion, supportedSchemaVersion: SCHEMA_VERSION, revision: state.revision, integrity, readOnly, note, unapprovedEnabled: [...unapprovedEnabled], providers: Object.keys(state.providers).length, models: Object.keys(state.models).length, enabled: Object.values(state.models).filter(m => m.enabled).length,
      live: Object.values(state.models).filter(m => m.enabled && liveStatus(m.id)).length, assigned: Object.keys(state.assignments).length, agents: roster.length, note2: "LIVE comes only from the model gateway's own passing probe; this registry is configuration." })
  };
}
