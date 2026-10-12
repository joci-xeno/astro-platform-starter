// ATLASZ incident response: a CONFIRMED serious security incident is contained by code, independently of any AI model:
//   1 BLOCK     the affected (agent, tool) pair, the agent entirely, or a named operation is added to a persistent block list that the Agent Tool Broker consults before every call (fail closed);
//   2 ISOLATE   the agent is paused in the registry and its running tasks are suspended through the Master (injected callbacks; a failing callback is reported, never ignored);
//   3 PRESERVE  an evidence bundle (incident record + audit/black-box tail supplied by the host + file hashes) is written read-only (0400) with a SHA-256 manifest and an audit-chain entry;
//   4 ALERT     the owner is alerted (injected sink) and the incident stays in `open()` until the owner clears it.
// Unconfirmed or low/medium incidents are recorded and alerted but never contained automatically (so one noisy signal cannot lock the system). Clearing needs a signed, single-use, subject-bound owner approval;
// evidence is never deleted. Honest limit: containment covers the paths that consult this module (Agent Tool Broker, registry, Master). Code running outside them is not contained by it.
import fs from "node:fs"; import path from "node:path"; import { createHash, randomBytes } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { scrub } from "./secret-patterns.mjs";

export const SEVERITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const CLEAR_ACTION = "CLEAR_INCIDENT";
export const clearSubject = id => "incident-clear:" + id;
const sha = b => createHash("sha256").update(b).digest("hex");
const clean = (v, n = 200) => scrub(String(v ?? "")).slice(0, n);

export function createIncidentResponse({ dir, registry = null, suspendAgentTasks = null, evidenceProvider = null, alert = () => {}, ownerAuth = null, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("INCIDENT_DIR_REQUIRED");
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true, mode: 0o700 });
  const audit = createAuditChain({ filePath: path.join(dir, "incidents-audit.jsonl"), headPinFile: path.join(dir, "incidents-audit.headpin.json"), now });
  const FILE = path.join(dir, "incidents.json");
  let S = { incidents: {}, blocks: [] };
  if (fs.existsSync(FILE)) { try { S = JSON.parse(fs.readFileSync(FILE, "utf8")); if (!S.incidents || !Array.isArray(S.blocks)) throw new Error("shape"); } catch { throw new Error("INCIDENT_STORE_UNREADABLE"); } }
  const save = () => { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(S), { mode: 0o600 }); fs.renameSync(t, FILE); };
  const tellOwner = a => { try { alert(a); return true; } catch { return false; } };

  /** Is this call blocked right now? Returns a short reason or null. Pure lookup, no side effects. */
  function isBlocked({ agentId = null, tool = null, operation = null } = {}) {
    for (const b of S.blocks) {
      if (b.agentId && b.agentId !== agentId) continue;
      if (b.tool && b.tool !== tool) continue;
      if (b.operation && b.operation !== operation) continue;
      return b.incident;
    }
    return null;
  }
  function evidenceBundle(id, rec) {
    const d = path.join(dir, "evidence", id); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    let tail = null; try { tail = evidenceProvider ? evidenceProvider({ agentId: rec.agentId, tool: rec.tool }) : null; } catch (e) { tail = { error: clean(e?.message) }; }
    const files = { "incident.json": JSON.stringify(rec, null, 1), "context.json": JSON.stringify(tail ?? { note: "no evidence provider connected" }, null, 1) };
    const manifest = {};
    for (const [n, c] of Object.entries(files)) { const p = path.join(d, n); fs.writeFileSync(p, scrub(c), { mode: 0o400 }); manifest[n] = sha(fs.readFileSync(p)); }
    fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ incident: id, files: manifest }, null, 1), { mode: 0o400 });
    return { dir: d, manifest };
  }

  function declare({ kind, severity = "MEDIUM", confirmed = false, agentId = null, tool = null, operation = null, detail = "", evidence = null } = {}) {
    if (!SEVERITIES.includes(severity)) throw new Error("SEVERITY_INVALID");
    if (!kind || typeof kind !== "string") throw new Error("KIND_REQUIRED");
    const id = "inc-" + Date.now().toString(36) + "-" + randomBytes(3).toString("hex");
    const serious = severity === "HIGH" || severity === "CRITICAL", contain = serious && confirmed === true;
    const rec = { id, at: now(), kind: clean(kind, 80), severity, confirmed: Boolean(confirmed), agentId: agentId ? clean(agentId, 40) : null, tool: tool ? clean(tool, 80) : null, operation: operation ? clean(operation, 80) : null, detail: clean(detail), evidence: evidence == null ? null : clean(JSON.stringify(evidence), 600),
      state: contain ? "CONTAINED_AWAITING_OWNER" : "RECORDED", containment: { blocked: false, agentIsolated: false, tasksSuspended: 0, errors: [] } };
    if (contain) {
      if (rec.agentId || rec.tool || rec.operation) { S.blocks.push({ incident: id, agentId: rec.agentId, tool: rec.tool, operation: rec.operation }); rec.containment.blocked = true; }
      if (rec.agentId && registry?.setPaused) { try { const r = registry.setPaused(rec.agentId, true, "INCIDENT:" + id); rec.containment.agentIsolated = r?.ok !== false; if (r?.ok === false) rec.containment.errors.push("PAUSE_REFUSED:" + clean(r.reason, 60)); } catch (e) { rec.containment.errors.push("PAUSE_FAILED:" + clean(e?.message, 60)); } }
      if (rec.agentId && typeof suspendAgentTasks === "function") { try { rec.containment.tasksSuspended = Number(suspendAgentTasks(rec.agentId, "INCIDENT:" + id)) || 0; } catch (e) { rec.containment.errors.push("SUSPEND_FAILED:" + clean(e?.message, 60)); } }
    }
    try { rec.evidenceBundle = contain || serious ? evidenceBundle(id, rec).manifest : null; } catch (e) { rec.containment.errors.push("EVIDENCE_FAILED:" + clean(e?.message, 60)); }
    rec.ownerAlerted = tellOwner({ at: rec.at, level: severity, incident: id, kind: rec.kind, agentId: rec.agentId, text: (contain ? "CONTAINED: " : "RECORDED: ") + rec.kind + (rec.agentId ? " (" + rec.agentId + ")" : "") + " - owner action required" + (contain ? " to release" : "") });
    S.incidents[id] = rec; audit.append("INCIDENT_" + (contain ? "CONTAINED" : "RECORDED"), { id, kind: rec.kind, severity, agentId: rec.agentId, tool: rec.tool, blocked: rec.containment.blocked, isolated: rec.containment.agentIsolated, errors: rec.containment.errors.length });
    save(); return structuredClone(rec);
  }
  /** Owner-only release: needs a signed single-use approval bound to this incident id. Evidence stays. */
  function clear(id, { ownerApproval = null } = {}) {
    const rec = S.incidents[id]; if (!rec) return { ok: false, reason: "UNKNOWN_INCIDENT" };
    if (rec.state === "CLEARED") return { ok: false, reason: "ALREADY_CLEARED" };
    if (!ownerAuth || typeof ownerAuth.verifyApproval !== "function") return { ok: false, reason: "OWNER_AUTH_NOT_CONFIGURED" };
    const v = ownerAuth.verifyApproval(ownerApproval, { action: CLEAR_ACTION, subject: clearSubject(id) });
    if (!v.allowed) { audit.append("INCIDENT_CLEAR_DENIED", { id, reason: v.reason }); return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason }; }
    S.blocks = S.blocks.filter(b => b.incident !== id);
    if (rec.containment.agentIsolated && rec.agentId && registry?.setPaused && !S.blocks.some(b => b.agentId === rec.agentId)) { try { registry.setPaused(rec.agentId, false, "INCIDENT_CLEARED:" + id); } catch { /* the agent stays paused; the owner sees it in the registry */ } }
    rec.state = "CLEARED"; rec.clearedAt = now(); audit.append("INCIDENT_CLEARED", { id }); save(); return { ok: true, id };
  }
  const list = () => Object.values(S.incidents).map(x => structuredClone(x));
  const open = () => list().filter(x => x.state !== "CLEARED");
  return { declare, clear, isBlocked, list, open, blocks: () => S.blocks.map(b => ({ ...b })), verify: () => audit.verify(), auditEntries: () => audit.entries(), evidenceDir: id => path.join(dir, "evidence", id) };
}
