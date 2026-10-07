// Knowledge Intelligence (V7.3 Brain §5): typed, provenance-tracked, tenant-isolated knowledge. Model guesses are never silently stored as facts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const KINDS = Object.freeze(["FACT", "INFERENCE", "ASSUMPTION", "UNVERIFIED", "OWNER_DECISION", "APPROVED_POLICY", "HISTORICAL_RESULT"]);
export const SOURCE_TYPES = Object.freeze(["DOCUMENT", "OWNER", "SYSTEM", "MODEL", "WEB", "EXPERIENCE", "AGENT"]);
const tok = s => String(s ?? "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

export function createKnowledgeBrain({ file = null, ownerAuth = null, now = () => new Date().toISOString(), defaultTtlDays = 90 } = {}) {
  let db = { items: {}, lessons: {} };
  if (file && fs.existsSync(file)) { try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("KNOWLEDGE_STORE_UNREADABLE"); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, file); };
  const ownerOk = (ap, action, subject) => Boolean(ownerAuth && ap && ownerAuth.verifyApproval(ap, { action, subject }).allowed);
  const ageDays = i => (Date.parse(now()) - Date.parse(i.createdAt)) / 86400000;
  const stale = i => i.ttlDays !== null && ageDays(i) > (i.ttlDays ?? defaultTtlDays);

  /** i: {tenantId, key, value, kind, source:{type, ref?}, evidenceRef?, confidence?, projectId?, jobId?, ttlDays?, shareable?, ownerApproval?}
      Downgrade rules (never upgrade): FACT needs a non-model source AND an evidence reference; model/agent-sourced content is at most INFERENCE;
      OWNER_DECISION / APPROVED_POLICY need a signed owner approval bound to the key. */
  function assertItem(i = {}) {
    if (!i.tenantId || !i.key || i.value === undefined) throw new Error("TENANT_KEY_VALUE_REQUIRED");
    if (!KINDS.includes(i.kind)) throw new Error("BAD_KIND");
    if (!i.source || !SOURCE_TYPES.includes(i.source.type)) throw new Error("SOURCE_REQUIRED");
    let kind = i.kind; const notes = [];
    if (["OWNER_DECISION", "APPROVED_POLICY"].includes(kind) && !ownerOk(i.ownerApproval, "KNOWLEDGE_" + kind, i.key)) throw new Error("OWNER_APPROVAL_REQUIRED:" + kind);
    if (kind === "FACT" && (["MODEL", "AGENT"].includes(i.source.type) || !i.evidenceRef)) { kind = ["MODEL", "AGENT"].includes(i.source.type) ? "INFERENCE" : "UNVERIFIED"; notes.push("DOWNGRADED_FROM_FACT:" + (i.evidenceRef ? "MODEL_SOURCE" : "NO_EVIDENCE")); }
    if (kind === "HISTORICAL_RESULT" && !i.evidenceRef) { kind = "UNVERIFIED"; notes.push("DOWNGRADED_FROM_HISTORICAL_RESULT:NO_EVIDENCE"); }
    const id = "k-" + crypto.randomUUID().slice(0, 10), item = { id, tenantId: i.tenantId, key: i.key, value: i.value, kind, requestedKind: i.kind, notes, source: i.source, evidenceRef: i.evidenceRef ?? null, confidence: Math.min(1, Math.max(0, Number(i.confidence ?? (kind === "FACT" || kind === "OWNER_DECISION" || kind === "APPROVED_POLICY" ? 0.9 : 0.4)))),
      projectId: i.projectId ?? null, jobId: i.jobId ?? null, ttlDays: i.ttlDays === null ? null : (i.ttlDays ?? (["OWNER_DECISION", "APPROVED_POLICY"].includes(kind) ? null : defaultTtlDays)), shareable: i.shareable === true, createdAt: now(), supersededBy: null };
    db.items[id] = item; save(); return structuredClone(item);
  }
  /** Retrieval is tenant-scoped; other projects only if the item is shareable AND the caller asks for cross-project. Stale items are excluded unless asked. */
  function retrieve({ tenantId, query = "", projectId = null, jobId = null, crossProject = false, includeStale = false, kinds = null, limit = 10 } = {}) {
    if (!tenantId) throw new Error("TENANT_REQUIRED");
    const q = new Set(tok(query)); const rows = [];
    for (const i of Object.values(db.items)) {
      if (i.tenantId !== tenantId || i.supersededBy) continue;
      if (projectId && i.projectId && i.projectId !== projectId && !(crossProject && i.shareable)) continue;
      if (jobId && i.jobId && i.jobId !== jobId && !(crossProject && i.shareable)) continue;
      if (kinds && !kinds.includes(i.kind)) continue;
      const st = stale(i); if (st && !includeStale) continue;
      const words = new Set(tok(i.key + " " + (typeof i.value === "string" ? i.value : JSON.stringify(i.value)))); let hit = 0; for (const w of q) if (words.has(w)) hit++;
      if (q.size && !hit) continue;
      rows.push({ ...structuredClone(i), stale: st, score: (q.size ? hit / q.size : 1) * (0.5 + 0.5 * i.confidence) * (i.kind === "OWNER_DECISION" || i.kind === "APPROVED_POLICY" ? 1.2 : 1) });
    }
    return rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }
  /** Same key, different value, both current and both of a "belief" kind => conflict. Owner decisions/policies win over everything else (reported, not auto-resolved). */
  function conflicts(tenantId) {
    const groups = {}; for (const i of Object.values(db.items)) if (i.tenantId === tenantId && !i.supersededBy && !stale(i)) (groups[i.key] ??= []).push(i);
    return Object.entries(groups).map(([key, l]) => ({ key, vals: [...new Set(l.map(x => JSON.stringify(x.value)))], items: l })).filter(g => g.vals.length > 1)
      .map(g => ({ key: g.key, items: g.items.map(x => ({ id: x.id, kind: x.kind, value: x.value, confidence: x.confidence })), authoritative: g.items.find(x => x.kind === "OWNER_DECISION" || x.kind === "APPROVED_POLICY")?.id ?? null, resolution: "NEEDS_REVIEW" }));
  }
  const staleItems = tenantId => Object.values(db.items).filter(i => i.tenantId === tenantId && !i.supersededBy && stale(i)).map(i => ({ id: i.id, key: i.key, ageDays: Math.floor(ageDays(i)) }));
  function supersede(oldId, newId) { if (!db.items[oldId] || !db.items[newId]) throw new Error("UNKNOWN_ITEM"); db.items[oldId].supersededBy = newId; save(); }
  // lessons: proposed by experience, usable only after owner approval
  function proposeLesson({ tenantId, text, evidenceRef = null, jobId = null }) { if (!tenantId || !text) throw new Error("TENANT_AND_TEXT_REQUIRED"); const id = "l-" + crypto.randomUUID().slice(0, 8); db.lessons[id] = { id, tenantId, text, evidenceRef, jobId, state: "PROPOSED", proposedAt: now() }; save(); return structuredClone(db.lessons[id]); }
  function approveLesson(id, ownerApproval) { const l = db.lessons[id]; if (!l) throw new Error("UNKNOWN_LESSON"); if (!ownerOk(ownerApproval, "ADOPT_LESSON", id)) throw new Error("OWNER_APPROVAL_REQUIRED:ADOPT_LESSON"); l.state = "APPROVED"; l.approvedAt = now(); save(); return structuredClone(l); }
  const lessonsFor = (tenantId, query = "") => { const q = new Set(tok(query)); return Object.values(db.lessons).filter(l => l.tenantId === tenantId && l.state === "APPROVED" && (!q.size || tok(l.text).some(w => q.has(w)))).map(l => structuredClone(l)); };
  const summary = tenantId => { const l = Object.values(db.items).filter(i => !tenantId || i.tenantId === tenantId); return { total: l.length, byKind: Object.fromEntries(KINDS.map(k => [k, l.filter(i => i.kind === k).length])), stale: l.filter(i => !i.supersededBy && stale(i)).length, lessons: Object.values(db.lessons).filter(x => !tenantId || x.tenantId === tenantId).length }; };
  return { assertItem, retrieve, conflicts, staleItems, supersede, proposeLesson, approveLesson, lessonsFor, summary };
}
