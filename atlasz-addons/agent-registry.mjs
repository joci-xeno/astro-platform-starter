// Phase 5: durable registry of the 30 permanent agents (5 SEARCH/SALES + 25 EXECUTION). The Master Coordinator is orchestration logic and is NOT an entry here.
//   * Exactly 30 fixed identities (SEARCH-1..5, EXECUTION-1..25). Nothing can add, duplicate, rename into another id or remove one; an unknown id is refused.
//   * Each entry is a PROFILE: stable id, human name, role, capability profile (no fixed niche), operational state, model policy reference, authorised tools (derived from the
//     owner-approved tool policy, never widened here), memory permissions, task limits, retry rules, resource/cost limits. The registry stores and enforces profile data; it does not run work.
//   * Persistence: agents.json (sha-bound) + a hash-chained audit log with one REGISTRY_REVISION record per change. On load the file's hash must equal the last audited revision, every entry
//     must be a valid roster id exactly once and every field must validate; otherwise the registry is READ ONLY (integrity MISMATCH / INVALID) and the workforce refuses to dispatch.
//   * Owner controls: pause/resume an agent (safe, no approval), rename, lower any limit; RAISING a cost limit needs a signed owner approval bound to the exact new limits.
//   * "Registered" is not "live": liveness is derived elsewhere from real task events (agent-workforce). A registry entry never claims an agent is working.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { AGENT_ID_RE, roleOf, TOOL_POLICY, permissionFor } from "./agent-tool-policy.mjs";
import { DEFAULT_POLICY as MEMORY_POLICY } from "./agent-memory.mjs";

export const ROSTER = Object.freeze([...Array.from({ length: 5 }, (_, i) => `SEARCH-${i + 1}`), ...Array.from({ length: 25 }, (_, i) => `EXECUTION-${i + 1}`)]);
export const SCHEMA_VERSION = 1;
export const LIMIT_BOUNDS = Object.freeze({ maxOpenTasks: [1, 3], maxRetries: [0, 5], maxStepsPerTask: [1, 50], taskTimeoutMs: [1000, 300000], maxCostUsdPerTask: [0, 100], maxCostUsdPerDay: [0, 1000], maxTokensPerTask: [0, 200000] });
export const DEFAULT_LIMITS = Object.freeze({ maxOpenTasks: 3, maxRetries: 2, maxStepsPerTask: 20, taskTimeoutMs: 60000, maxCostUsdPerTask: 0, maxCostUsdPerDay: 0, maxTokensPerTask: 4000 });
const COST_LIMITS = ["maxCostUsdPerTask", "maxCostUsdPerDay"];
const DEFAULT_RETRY = Object.freeze({ backoffMs: [0, 500, 2000], retryableCodes: ["EXECUTOR_ERROR", "TIMEOUT", "TRANSIENT"], stopOnRepeatedCode: true, afterExhaustion: "DEAD_LETTER_AND_ESCALATE" });
const NAME_RE = /^[\p{L}\p{N} ._-]{1,40}$/u, sha = t => crypto.createHash("sha256").update(t).digest("hex");
const SKILLS = Object.freeze({
  SEARCH: ["opportunity.discovery", "opportunity.research", "opportunity.evaluation", "source.provenance"],
  EXECUTION: ["data.csv_to_json", "doc.extract_summary", "code.module_with_tests", "quality.verification"]
});
const ids = new Set(ROSTER);

function authorisedTools(role) {
  const out = [];
  for (const tool of Object.keys(TOOL_POLICY)) { out.push({ tool, permission: permissionFor(role, tool) }); }
  return out.filter(t => t.permission !== "DENY");
}
function seedProfile(id, createdAt) {
  const team = roleOf(id), n = Number(id.split("-")[1]);
  return {
    id, name: (team === "SEARCH" ? "Search Agent " : "Execution Agent ") + n, team, role: team === "SEARCH" ? "SEARCH/SALES" : "EXECUTION",
    capabilityProfile: { skills: [...SKILLS[team]], fixedNiche: null, assignment: "DYNAMIC_PER_OPPORTUNITY", note: "No permanent industry or niche; skills are the task types this agent may be given." },
    state: { paused: false, pausedReason: null, enabled: true },
    modelPolicy: { capability: "text", source: "model-registry assignment (owner-managed); this agent stays registered while its model dependency is blocked", maxCostUsdPerTask: 0 },
    memory: { tenant: "JOCI", clearance: MEMORY_POLICY.clearance[team], writeCeiling: MEMORY_POLICY.writeCeiling[team], access: "agent-memory gateway only (identity-bound, audited)" },
    limits: { ...DEFAULT_LIMITS }, retry: structuredClone(DEFAULT_RETRY), createdAt, revision: 1
  };
}
function validateLimits(l) {
  if (!l || typeof l !== "object" || Array.isArray(l)) return "LIMITS_INVALID";
  for (const [k, [lo, hi]] of Object.entries(LIMIT_BOUNDS)) { const v = l[k]; if (!Number.isFinite(v) || v < lo || v > hi || (!k.startsWith("maxCost") && !Number.isInteger(v))) return "LIMIT_OUT_OF_BOUNDS:" + k; }
  if (Object.keys(l).some(k => !Object.hasOwn(LIMIT_BOUNDS, k))) return "LIMIT_UNKNOWN_FIELD";
  return null;
}
function validateProfile(p) {
  if (!p || typeof p !== "object" || !ids.has(p.id) || p.team !== roleOf(p.id)) return "PROFILE_ID_OR_TEAM_INVALID";
  if (typeof p.name !== "string" || !NAME_RE.test(p.name)) return "PROFILE_NAME_INVALID";
  if (!p.state || typeof p.state.paused !== "boolean" || typeof p.state.enabled !== "boolean") return "PROFILE_STATE_INVALID";
  const le = validateLimits(p.limits); if (le) return le;
  if (!Array.isArray(p.capabilityProfile?.skills) || p.capabilityProfile.skills.length > 20 || !p.capabilityProfile.skills.every(s => typeof s === "string" && /^[a-z][a-z0-9._-]{1,48}$/.test(s))) return "PROFILE_SKILLS_INVALID";
  if (p.capabilityProfile.fixedNiche !== null) return "FIXED_NICHE_NOT_ALLOWED";
  if (!p.retry || !Array.isArray(p.retry.backoffMs) || p.retry.backoffMs.length > 6 || !p.retry.backoffMs.every(x => Number.isFinite(x) && x >= 0 && x <= 60000)) return "PROFILE_RETRY_INVALID";
  return null;
}
export const limitsSubject = (id, limits) => "agent-limits:" + id + ":" + sha(JSON.stringify(Object.keys(LIMIT_BOUNDS).map(k => [k, limits[k]]))).slice(0, 24);

export function createAgentRegistry({ dir, ownerAuth = null, isStopped = () => false, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, "agents.json");
  let audit, auditProblem = null;
  try { audit = createAuditChain({ filePath: path.join(dir, "agent-registry-audit.jsonl"), headPinFile: path.join(dir, "agent-registry-audit.headpin.json") }); }
  catch (e) { auditProblem = String(e?.message ?? e).slice(0, 80); audit = { head: () => null, entries: () => [], append: () => { throw new Error("AUDIT_UNAVAILABLE"); }, verify: () => ({ ok: false, reason: auditProblem }), reload: () => {} }; }
  let state = null, integrity = "NEW", readOnly = false, note = null;
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const stopped = () => { try { return Boolean(isStopped()); } catch { return true; } };
  const lastRevision = () => { const e = audit.entries().filter(x => x.event === "REGISTRY_REVISION"); return e.length ? e[e.length - 1].data : null; };
  const wrap = body => JSON.stringify({ sha: sha(body), body });
  function persist(event, data) {
    state.revision = (state.revision ?? 0) + 1;
    const body = JSON.stringify(state);
    audit.append("REGISTRY_REVISION", { revision: state.revision, sha: sha(body), event, ...data });
    const t = FILE + "." + crypto.randomBytes(4).toString("hex") + ".tmp"; fs.writeFileSync(t, wrap(body), { mode: 0o600 }); fs.renameSync(t, FILE);
  }
  function seed() {
    const at = now(); state = { schema: SCHEMA_VERSION, revision: 0, agents: Object.fromEntries(ROSTER.map(id => [id, seedProfile(id, at)])) };
    for (const id of ROSTER) audit.append("AGENT_REGISTERED", { id, team: roleOf(id) });
    persist("SEEDED", { count: ROSTER.length });
  }
  function load() {
    if (auditProblem) { integrity = auditProblem.includes("TRUNCATED") ? "AUDIT_CHAIN_TRUNCATED" : "AUDIT_CHAIN_TAMPERED"; readOnly = true; note = "The registry audit chain failed verification; the registry is read only."; state = { schema: SCHEMA_VERSION, revision: 0, agents: {} }; return; }
    try { audit.reload(); } catch (e) { integrity = String(e?.message ?? e).includes("TRUNCATED") ? "AUDIT_CHAIN_TRUNCATED" : "AUDIT_CHAIN_TAMPERED"; readOnly = true; note = "The registry audit chain failed verification; the registry is read only."; state = { schema: SCHEMA_VERSION, revision: 0, agents: {} }; return; }
    const last = lastRevision();
    if (!fs.existsSync(FILE)) {
      if (last) { integrity = "FILE_MISSING"; readOnly = true; note = "agents.json is missing although the audit log records revisions; restore the file or reset deliberately."; state = { schema: SCHEMA_VERSION, revision: 0, agents: {} }; return; }
      seed(); integrity = "OK"; return;
    }
    let parsed, body;
    try { const w = JSON.parse(fs.readFileSync(FILE, "utf8")); body = w.body; if (w.sha !== sha(body)) throw new Error("sha"); parsed = JSON.parse(body); } catch { integrity = "UNREADABLE"; readOnly = true; note = "agents.json is damaged."; state = { schema: SCHEMA_VERSION, revision: 0, agents: {} }; return; }
    if (!last || last.sha !== sha(body)) { integrity = "MISMATCH"; readOnly = true; note = "agents.json does not match the last audited revision (edited outside the registry)."; state = { schema: SCHEMA_VERSION, revision: 0, agents: {} }; return; }
    const keys = Object.keys(parsed.agents ?? {});
    let bad = parsed.schema !== SCHEMA_VERSION ? "SCHEMA" : keys.length !== 30 || !ROSTER.every(id => keys.includes(id)) ? "ROSTER_NOT_EXACTLY_THE_30" : null;
    for (const id of keys) { if (bad) break; const e = validateProfile(parsed.agents[id]); if (e || parsed.agents[id].id !== id) bad = e ?? "ID_KEY_MISMATCH"; }
    if (bad) { integrity = "INVALID"; readOnly = true; note = "Registry content failed validation: " + bad; state = { schema: SCHEMA_VERSION, revision: 0, agents: {} }; return; }
    state = parsed; integrity = "OK";
  }
  load();

  const toolsView = role => { try { return authorisedTools(role); } catch { return []; } };
  const view = p => ({ ...structuredClone(p), authorisedTools: toolsView(p.team), status: statusOf(p) });
  const statusOf = p => (!p.state.enabled ? "DISABLED" : p.state.paused ? "PAUSED" : "REGISTERED_READY");
  const guard = id => { if (readOnly) return fail("REGISTRY_READ_ONLY:" + integrity); if (stopped()) return fail("OWNER_STOP_OR_SAFE_MODE_ACTIVE"); if (!ids.has(id)) return fail("NOT_ONE_OF_THE_30_PERMANENT_AGENTS"); return null; };

  const list = () => ROSTER.filter(id => Object.hasOwn(state.agents, id)).map(id => view(state.agents[id]));
  const get = id => (ids.has(id) && Object.hasOwn(state.agents, id) ? view(state.agents[id]) : null);

  function setPaused(id, paused, reason = "") {
    const g = guard(id); if (g) return g; if (typeof paused !== "boolean") return fail("PAUSED_MUST_BE_BOOLEAN");
    const p = state.agents[id]; p.state.paused = paused; p.state.pausedReason = paused ? String(reason).replace(/[\u0000-\u001f]/g, " ").slice(0, 120) || "owner" : null; p.revision++;
    persist(paused ? "AGENT_PAUSED" : "AGENT_RESUMED", { id }); return { ok: true, status: statusOf(p) };
  }
  function rename(id, name) {
    const g = guard(id); if (g) return g; if (typeof name !== "string" || !NAME_RE.test(name.trim())) return fail("NAME_INVALID");
    if (/^(SEARCH|EXECUTION|COORDINATOR|MASTER)[-_ ]?\d*$/i.test(name.trim()) && name.trim() !== state.agents[id].name) return fail("NAME_LOOKS_LIKE_AN_AGENT_ID"); if (Object.values(state.agents).some(a => a.id !== id && a.name.toLowerCase() === name.trim().toLowerCase())) return fail("NAME_ALREADY_USED");
    const p = state.agents[id]; p.name = name.trim(); p.revision++; persist("AGENT_RENAMED", { id }); return { ok: true, name: p.name };
  }
  /** Change limits. Lowering (or any non-cost change) needs no approval; raising a cost limit needs a signed owner approval bound to the exact new limits. */
  function setLimits(id, patch = {}, { ownerApproval = null } = {}) {
    const g = guard(id); if (g) return g; if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("PATCH_INVALID");
    const p = state.agents[id], next = { ...p.limits, ...patch }, e = validateLimits(next); if (e) return fail(e);
    const raises = COST_LIMITS.filter(k => next[k] > p.limits[k]);
    if (raises.length) {
      if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") return fail("OWNER_AUTH_NOT_CONFIGURED");
      const v = ownerAuth.verifyApproval(ownerApproval, { action: "AGENT_LIMITS_RAISE", subject: limitsSubject(id, next) });
      if (!v.allowed) { audit.append("LIMIT_RAISE_DENIED", { id, reason: v.reason }); return fail("OWNER_APPROVAL_REQUIRED", { detail: v.reason }); }
      p.limits = next; p.revision++; persist("AGENT_LIMITS_RAISED", { id, fields: raises, approval: ownerApproval }); return { ok: true, limits: { ...p.limits } };
    }
    p.limits = next; p.revision++; persist("AGENT_LIMITS_CHANGED", { id, fields: Object.keys(patch) }); return { ok: true, limits: { ...p.limits } };
  }
  const summary = () => ({ state: "IMPLEMENTED_PERSISTENT", integrity, readOnly, note, agents: Object.keys(state.agents).length, search: list().filter(a => a.team === "SEARCH").length, execution: list().filter(a => a.team === "EXECUTION").length,
    paused: list().filter(a => a.state.paused).length, revision: state.revision, auditHead: audit.head(), masterCoordinatorIsAgent: false });
  const verify = () => { try { audit.reload(); return { ok: audit.verify().ok && integrity === "OK", integrity }; } catch (e) { return { ok: false, integrity, reason: String(e?.message ?? e).slice(0, 80) }; } };
  return { list, get, setPaused, rename, setLimits, summary, verify, isUsable: id => !readOnly && ids.has(id) && Object.hasOwn(state.agents, id) && state.agents[id].state.enabled && !state.agents[id].state.paused, auditEntries: () => audit.entries() };
}
