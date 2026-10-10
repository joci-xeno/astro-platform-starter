// Assistant profiles (85-capability audit M12 Custom AI Assistants): CONFIGURATION for how the existing agents are used, never new agents and never new permissions.
//   * A profile = name, instructions text, a tool allow-list, a skill allow-list and memory scopes. It has no agent id, no budget, no credentials, no network setting.
//   * It can only NARROW: at every use the tool list is intersected with what the owner's tool-permission matrix currently ALLOWS for the role (SEARCH / EXECUTION), so revoking
//     a grant (or an owner decision such as D4/D5/D6) shrinks every profile at once. Tools that are APPROVAL, DENY, disabled, pcc.* or voice.* are never grantable.
//   * Only the OWNER creates, edits, rolls back or deletes a profile. Every edit is a new hashed version; older versions are kept (bounded) and can be restored by the owner.
//   * Instructions are plain text: secrets are redacted and instruction-injection phrases are refused. The fixed 5 SEARCH + 25 EXECUTION topology is untouched.
import crypto from "node:crypto";
import fs from "node:fs";
import { lockMethods } from "./file-lock.mjs";
import { createStore, clone } from "./business/store.mjs";
import { redactSecrets, INJECTION_PATTERNS } from "./text-compare.mjs";
import { TOOL_POLICY, ROLES, permissionFor, roleOf } from "./agent-tool-policy.mjs";
import { okName, own } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({ maxProfiles: 50, maxVersions: 10, maxInstructions: 2000, maxName: 60, maxTools: 40, maxSkills: 20, maxScopes: 20 });
const ID = /^[a-z][a-z0-9-]{0,39}$/, TOOLNAME = /^[a-z][a-z0-9._-]{0,59}$/, SCOPE = /^[a-z][a-z0-9:._-]{0,59}$/, TENANT = /^[A-Za-z0-9._-]{1,64}$/;
const FIELDS = new Set(["id", "name", "instructions", "tools", "skills", "memoryScopes", "actor"]);
const hashOf = v => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const uniqSorted = a => [...new Set(a)].sort();

/** Tools the owner's matrix lets this role use without approval and that are not disabled. */
export const defaultGrantable = (role, policy = TOOL_POLICY) => Object.keys(policy).filter(t => permissionFor(role, t, policy) === "ALLOW" && !policy[t].disabled).sort();   // permissionFor() is DENY for any role that is not SEARCH/EXECUTION

/** What an assignment is pinned to: the profile id and the hash of its CURRENT (last) version, so editing, reordering or truncating the stored versions changes the stamp. */
const stampOf = (tenantRec, pid) => { let h = "none"; try { const vs = own(tenantRec?.profiles ?? {}, pid)?.versions; if (Array.isArray(vs) && vs.length) h = String(vs.at(-1)?.hash); } catch { /* none */ } return String(pid) + ":" + h; };
export function createProfiles({ file = null, grantable = defaultGrantable, skillExists = () => true, now = () => Date.now() } = {}) {
  const store = createStore({ file, init: () => ({ tenants: {} }), mode: 0o600 }), d = store.data;
  const T = tenantId => { if (typeof tenantId !== "string" || !okName(TENANT, tenantId)) throw new Error("TENANT_INVALID"); return (d.tenants[tenantId] ??= { profiles: {}, assignments: {} }); };
  const peek = tenantId => (typeof tenantId === "string" && okName(TENANT, tenantId) ? own(d.tenants, tenantId) ?? null : null);
  const union = () => new Set(ROLES.flatMap(r => { try { return grantable(r); } catch { return []; } }));
  const list = (arr, max, re, what) => (Array.isArray(arr) && arr.length <= max && arr.every(x => typeof x === "string" && re.test(x)) ? null : what);

  function validate(inp) {
    for (const k of Object.keys(inp ?? {})) if (!FIELDS.has(k)) return { ok: false, reason: "UNKNOWN_FIELD:" + String(k).slice(0, 40) };           // e.g. agents, budget, network, credentials
    if (!okName(ID, inp.id)) return { ok: false, reason: "PROFILE_ID_INVALID" };
    if (typeof inp.name !== "string" || !inp.name.trim() || inp.name.length > LIMITS.maxName) return { ok: false, reason: "NAME_INVALID" };
    if (typeof inp.instructions !== "string" || !inp.instructions.trim() || inp.instructions.length > LIMITS.maxInstructions) return { ok: false, reason: "INSTRUCTIONS_INVALID" };
    if (INJECTION_PATTERNS.some(p => p.test(inp.instructions)) || INJECTION_PATTERNS.some(p => p.test(inp.name))) return { ok: false, reason: "INSTRUCTIONS_LOOK_LIKE_INJECTION" };
    const tools = inp.tools ?? [], skills = inp.skills ?? [], scopes = inp.memoryScopes ?? [];
    let bad = list(tools, LIMITS.maxTools, TOOLNAME, "TOOLS_INVALID") ?? list(skills, LIMITS.maxSkills, ID, "SKILLS_INVALID") ?? list(scopes, LIMITS.maxScopes, SCOPE, "MEMORY_SCOPES_INVALID"); if (bad) return { ok: false, reason: bad };
    const g = union(); for (const t of tools) if (!g.has(t)) return { ok: false, reason: "TOOL_NOT_GRANTABLE:" + t };
    for (const s of skills) { let ok = false; try { ok = skillExists(s) === true; } catch { ok = false; } if (!ok) return { ok: false, reason: "SKILL_UNKNOWN:" + s }; }
    return { ok: true, def: { id: inp.id, name: redactSecrets(inp.name.trim()), instructions: redactSecrets(inp.instructions.trim()), tools: uniqSorted(tools), skills: uniqSorted(skills), memoryScopes: uniqSorted(scopes) } };
  }
  // The file may have been damaged since this process loaded it: a write never replaces an unreadable file (the owner must repair or remove it first).
  const writable = () => { if (!file) return true; try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j && typeof j === "object" && j.tenants && typeof j.tenants === "object" && !Array.isArray(j.tenants)) { if (!markerAgrees(file, j.tenants)) return false; d.tenants = j.tenants; } return true; } catch (e) { return e?.code === "ENOENT"; } };      // also adopts what another instance wrote since this one loaded: a stale instance never reverts it
  function save(tenantId, inp, how) {
    if (inp?.actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_EDIT_PROFILES" };
    if (!writable()) return { ok: false, reason: "PROFILE_STORE_UNREADABLE" };
    const v = validate(inp); if (!v.ok) return v; const t = T(tenantId), cur = own(t.profiles, v.def.id);
    if (!cur && Object.keys(t.profiles).length >= LIMITS.maxProfiles) return { ok: false, reason: "TOO_MANY_PROFILES" };
    const hash = hashOf(v.def); if (cur && cur.versions.at(-1).hash === hash) return { ok: true, id: v.def.id, version: cur.versions.at(-1).version, unchanged: true };
    const ver = { version: (cur?.nextVersion ?? 1), hash, definition: v.def, at: new Date(now()).toISOString(), how };
    const p = cur ?? (t.profiles[v.def.id] = { id: v.def.id, versions: [], nextVersion: 1 });
    p.versions.push(ver); p.nextVersion = ver.version + 1; if (p.versions.length > LIMITS.maxVersions) p.versions.splice(0, p.versions.length - LIMITS.maxVersions);
    store.save(); markIfUsed(); return { ok: true, id: p.id, version: ver.version, hash };
  }
  const create = (tenantId, inp) => save(tenantId, inp, "SAVE");
  function rollback(tenantId, id, version, { actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_EDIT_PROFILES" };
    const p = own(peek(tenantId)?.profiles, id); if (!p) return { ok: false, reason: "PROFILE_NOT_FOUND" }; const v = p.versions.find(x => x.version === version); if (!v) return { ok: false, reason: "VERSION_NOT_FOUND" };
    if (hashOf(v.definition) !== v.hash) return { ok: false, reason: "STORED_VERSION_TAMPERED" };
    return save(tenantId, { ...clone(v.definition), actor: "OWNER" }, "ROLLBACK_TO_" + version);   // re-validated against today's grants, stored as a NEW version
  }
  function remove(tenantId, id, { actor } = {}) { if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_EDIT_PROFILES" }; if (!writable()) return { ok: false, reason: "PROFILE_STORE_UNREADABLE" }; const t = peek(tenantId); if (!t || typeof id !== "string" || !Object.hasOwn(t.profiles, id)) return { ok: false, reason: "PROFILE_NOT_FOUND" }; delete t.profiles[id]; store.save(); markIfUsed(); return { ok: true }; }
  const summary = p => { const v = p.versions.at(-1); return { id: p.id, name: v.definition.name, version: v.version, hash: v.hash, versions: p.versions.map(x => x.version), tools: v.definition.tools.length, skills: v.definition.skills.length, memoryScopes: v.definition.memoryScopes.length }; };
  const listAll = tenantId => Object.values(peek(tenantId)?.profiles ?? {}).map(summary);
  function get(tenantId, id) { const p = own(peek(tenantId)?.profiles, id); if (!p) return { ok: false, reason: "PROFILE_NOT_FOUND" }; const v = p.versions.at(-1); return { ok: true, profile: { ...summary(p), definition: clone(v.definition), history: p.versions.map(x => ({ version: x.version, hash: x.hash, at: x.at, how: x.how })) } }; }

  /** Effective capabilities for a role: the stored lists narrowed by today's owner grants. Revoked tools / vanished skills are reported, not silently kept. */
  function resolve(tenantId, id, { role } = {}) {
    if (!ROLES.includes(role)) return { ok: false, reason: "ROLE_INVALID" };
    const p = own(peek(tenantId)?.profiles, id); if (!p) return { ok: false, reason: "PROFILE_NOT_FOUND" }; const v = p.versions.at(-1);
    if (hashOf(v.definition) !== v.hash) return { ok: false, reason: "STORED_VERSION_TAMPERED" };
    let g = new Set(); try { g = new Set(grantable(role)); } catch { g = new Set(); }
    const tools = v.definition.tools.filter(t => g.has(t)), skills = v.definition.skills.filter(s => { try { return skillExists(s) === true; } catch { return false; } });
    return { ok: true, id, role, version: v.version, hash: v.hash, instructions: v.definition.instructions, tools, droppedTools: v.definition.tools.filter(t => !g.has(t)), skills, droppedSkills: v.definition.skills.filter(s => !skills.includes(s)), memoryScopes: [...v.definition.memoryScopes],
      note: "A profile is configuration for the existing agents. It creates no agent and grants nothing beyond the owner's tool matrix." };
  }
  /** Would this profile, used by this role, be allowed to touch `tool` / read memory `scope`? Deny by default. */
  function check(tenantId, id, { role, tool = null, scope = null } = {}) {
    const r = resolve(tenantId, id, { role }); if (!r.ok) return { allowed: false, reason: r.reason };
    if (tool !== null) return r.tools.includes(tool) ? { allowed: true } : { allowed: false, reason: "TOOL_NOT_IN_PROFILE_OR_NOT_GRANTED" };
    if (scope !== null) return r.memoryScopes.includes(scope) ? { allowed: true } : { allowed: false, reason: "SCOPE_NOT_IN_PROFILE" };
    return { allowed: false, reason: "NOTHING_TO_CHECK" };
  }
  /** Agent -> profile assignment (owner only; the 30 ids are the fixed roster, a profile never creates one). A profile can only NARROW what the owner's tool matrix already allows. */
  /** The marker records that a store existed and how many assignments it held, so a deleted OR emptied store can be told from one that never had assignments (the gate fails closed on both). */
  const assignedMap = dd => Object.fromEntries(Object.entries(dd.tenants ?? {}).flatMap(([tn, t]) => Object.entries(t?.assignments ?? {}).filter(([, v]) => v != null).map(([a, v]) => [tn + "/" + a, stampOf(t, v)])).sort());
  const mark = () => { if (file) { try { fs.writeFileSync(file + ".in-use", JSON.stringify(assignedMap(d)), { mode: 0o600 }); } catch { /* the gate then cannot tell a deleted store from a never-used one */ } } };
  const markIfUsed = () => { if (file && (Object.keys(assignedMap(d)).length || fs.existsSync(file + ".in-use"))) mark(); };
  function assign(tenantId, agentId, profileId, { actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_EDIT_PROFILES" };
    if (typeof agentId !== "string" || !roleOf(agentId)) return { ok: false, reason: "UNKNOWN_AGENT" };
    if (!writable()) return { ok: false, reason: "PROFILE_STORE_UNREADABLE" };
    const t = T(tenantId); t.assignments ??= {};
    if (profileId === null) { delete t.assignments[agentId]; store.save(); mark(); return { ok: true, agentId, profileId: null }; }
    if (typeof profileId !== "string" || !own(t.profiles, profileId)) return { ok: false, reason: "PROFILE_NOT_FOUND" };
    t.assignments[agentId] = profileId; store.save(); mark(); return { ok: true, agentId, profileId };
  }
  const assignments = tenantId => { const a = peek(tenantId)?.assignments ?? {}; return Object.keys(a).sort().map(k => ({ agentId: k, profileId: a[k] })); };
  /** The gate used by the tool broker. No assignment -> unchanged behaviour. Assigned -> the tool must be in the profile's CURRENT, still-granted tool list.
   *  A deleted, tampered or unreadable profile FAILS CLOSED (no tools) until the owner re-assigns; deleting a profile never widens an agent. */
  function agentGate(tenantId, agentId, tool) {
    // A store whose SHAPE is wrong (null/array/string where a record belongs) is corruption, not "no assignment": it denies instead of silently dropping the narrowing.
    const plain = x => x !== null && typeof x === "object" && !Array.isArray(x);
    if (!plain(d) || !plain(d.tenants)) return { allowed: false, reason: "PROFILE_STORE_CORRUPT" };
    if (typeof tenantId === "string" && okName(TENANT, tenantId) && Object.hasOwn(d.tenants, tenantId)) { const r0 = d.tenants[tenantId]; if (!plain(r0) || (r0.assignments !== undefined && !plain(r0.assignments)) || (r0.profiles !== undefined && !plain(r0.profiles))) return { allowed: false, reason: "PROFILE_STORE_CORRUPT" }; }
    const pid = own(peek(tenantId)?.assignments ?? {}, agentId); if (pid == null) return { allowed: true, profile: null };
    const role = roleOf(agentId); if (!role) return { allowed: false, reason: "UNKNOWN_AGENT" };
    const r = resolve(tenantId, pid, { role }); if (!r.ok) return { allowed: false, profile: pid, reason: r.reason };
    return r.tools.includes(tool) ? { allowed: true, profile: pid, version: r.version } : { allowed: false, profile: pid, reason: "TOOL_NOT_IN_AGENT_PROFILE" };
  }
  /** Owner-only recovery after the store and the in-use marker disagree (an out-of-band edit): re-stamps the marker from what is on disk and RETURNS what had changed, so the owner decides knowingly. Never runs implicitly. */
  function reconcileMarker({ actor } = {}) {
    if (actor !== "OWNER") return { ok: false, reason: "ONLY_OWNER_MAY_EDIT_PROFILES" }; if (!file) return { ok: true, changed: [] };
    let j; try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { ok: false, reason: "PROFILE_STORE_UNREADABLE" }; }
    if (!j || typeof j !== "object" || !j.tenants || typeof j.tenants !== "object" || Array.isArray(j.tenants)) return { ok: false, reason: "PROFILE_STORE_CORRUPT" };
    const mk = markerKeys(file), now = assignedMap({ tenants: j.tenants }), was = mk && mk !== Infinity ? mk : {}, changed = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(k => was[k] !== now[k]).sort();
    d.tenants = j.tenants; try { fs.rmSync(file + ".in-use", { recursive: true, force: true }); } catch { /* ignore */ } mark(); return { ok: true, changed };
  }
  return lockMethods({ create, rollback, remove, assign, reconcileMarker, assignments, agentGate, list: listAll, get, resolve, check, grantable: role => { try { return [...grantable(role)]; } catch { return []; } }, limits: LIMITS }, file, ["create", "rollback", "remove", "assign", "reconcileMarker"]);
}

/** Broker gate over the shared profiles file. The file is re-read on every call (the Control Center and the runtime are separate processes); an unreadable file denies instead of allowing. */
/** null = no marker (never used); otherwise the map tenant/agent -> profile id recorded at the last owner change (every one must still point at the same profile). An unreadable or odd marker counts as a huge number: fail closed. */
function markerKeys(file) { try { const st = fs.lstatSync(file + ".in-use"); if (!st.isFile()) return Infinity; const a = JSON.parse(fs.readFileSync(file + ".in-use", "utf8")); return a && typeof a === "object" && !Array.isArray(a) && Object.values(a).every(x => typeof x === "string") ? a : Infinity; } catch (e) { return e?.code === "ENOENT" ? null : Infinity; } }
/** True when the in-use marker (if any) agrees with the tenants on disk: every marked assignment still exists with the same profile id and version hash. Used by the gate AND before any write, so a write can never re-stamp the marker over tampered state. */
function markerAgrees(file, tenants) { const mk = markerKeys(file); if (mk === null) return true; if (mk === Infinity) return false; return !Object.entries(mk).some(([key, pid]) => { const [tn, ...r] = key.split("/"), a = r.join("/"); return !(Object.hasOwn(tenants, tn) && tenants[tn] && typeof tenants[tn] === "object" && tenants[tn].assignments && typeof tenants[tn].assignments === "object" && Object.hasOwn(tenants[tn].assignments, a) && stampOf(tenants[tn], tenants[tn].assignments[a]) === pid); }); }
export function createAgentProfileGate({ file, tenantId, grantable = defaultGrantable } = {}) {
  return (agentId, tool) => {
    try {
      if (!file) return { allowed: true, profile: null };
      if (typeof tenantId !== "string" || !tenantId) return { allowed: false, reason: "PROFILE_TENANT_INVALID" };      // a missing tenant id never means 'no restrictions'
      let raw; try { raw = fs.readFileSync(file, "utf8"); } catch (e) { if (e?.code === "ENOENT") { if (markerKeys(file) !== null) return { allowed: false, reason: "PROFILE_STORE_MISSING" }; return { allowed: true, profile: null }; } throw e; }      // no file yet = nothing was ever assigned
      const j = JSON.parse(raw); if (j === null || typeof j !== "object" || Array.isArray(j) || j.tenants === null || typeof j.tenants !== "object" || Array.isArray(j.tenants)) return { allowed: false, reason: "PROFILE_STORE_CORRUPT" };   // a file this module wrote always has a tenants record
      if (!markerAgrees(file, j.tenants)) return { allowed: false, reason: "PROFILE_STORE_ASSIGNMENTS_CHANGED" };    // an assignment was removed or retargeted outside the owner's own assign/unassign
      return createProfiles({ file, grantable }).agentGate(tenantId, agentId, tool);
    }
    catch { return { allowed: false, reason: "PROFILE_STORE_UNREADABLE" }; }
  };
}
