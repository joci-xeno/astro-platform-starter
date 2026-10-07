// ATLASZ Memory Fabric (package §23, V7.3 §12-13): ONE governed facade over the existing memory modules —
//   Knowledge Brain (durable, typed, provenance-tracked)  +  Business Memory  +  Experience Learning  +  Entity Graph.
// It adds no new store of its own. Every record carries source, time, provenance, confidence, scope, owner/tenant and a verification state.
// Rules: unverified model/agent output never becomes a trusted fact (Knowledge Brain downgrades it); only independently VERIFIED outcomes become
// HISTORICAL_RESULT; lessons are candidates until the owner approves them; scopes (PERSONAL / BUSINESS / CUSTOMER / SYSTEM) are separate and a caller sees
// only the scopes it names (default BUSINESS); tenants never see each other's records in ANY backing store.
export const SCOPES = Object.freeze(["PERSONAL", "BUSINESS", "CUSTOMER", "SYSTEM"]);
const TRUSTED_KINDS = new Set(["FACT", "OWNER_DECISION", "APPROVED_POLICY", "HISTORICAL_RESULT"]);
const ns = (tenantId, id) => tenantId + "::" + id;      // tenant-namespaced ids for the (tenant-less) Business Memory module

export function createMemoryFabric({ knowledge, businessMemory = null, experience = null, entityGraph = null, blackBox = null, now = () => new Date().toISOString() } = {}) {
  if (!knowledge) throw new Error("KNOWLEDGE_BRAIN_REQUIRED");
  const rec = (kind, p) => { try { blackBox?.record({ kind, ...p }); } catch { /* observability must not break memory */ } };
  const state = (item, extra = {}) => ({
    id: item.id, tenantId: item.tenantId, owner: item.owner ?? item.tenantId, scope: item.scope ?? "BUSINESS", key: item.key, value: item.value, kind: item.kind,
    source: item.source, time: item.createdAt, provenance: { evidenceRef: item.evidenceRef ?? null, requestedKind: item.requestedKind, notes: item.notes ?? [] }, confidence: item.confidence,
    verificationState: TRUSTED_KINDS.has(item.kind) ? "VERIFIED" : item.kind === "INFERENCE" ? "INFERRED" : "UNVERIFIED", stale: item.stale ?? false, ...extra });

  /** i: knowledge-brain item + {scope, entity?:{type,id,attributes?}, category?, importance?, links?:[{relation,toType,toId}]} */
  function remember(i = {}) {
    const scope = i.scope ?? "BUSINESS"; if (!SCOPES.includes(scope)) throw new Error("BAD_SCOPE");
    const item = knowledge.assertItem({ ...i, scope });
    const out = state(item, { mirrors: [] });
    if (i.entity && businessMemory && scope !== "SYSTEM") {
      // Mirror only a trust-labelled summary; the text carries the verification state so a consumer of Business Memory alone cannot mistake a guess for a fact.
      businessMemory.remember({ entityType: i.entity.type, entityId: ns(i.tenantId, i.entity.id), category: i.category ?? scope, text: `[${out.verificationState}/${item.kind}] ${i.key}: ${typeof i.value === "string" ? i.value : JSON.stringify(i.value)}`,
        importance: i.importance ?? item.confidence, source: { knowledgeId: item.id, type: item.source.type, ref: item.source.ref ?? null, scope } });
      out.mirrors.push("BUSINESS_MEMORY");
    }
    if (i.entity && entityGraph) {
      entityGraph.upsertEntity({ tenantId: i.tenantId, type: i.entity.type, id: i.entity.id, attributes: i.entity.attributes ?? {}, source: `knowledge:${item.id}` });
      for (const l of i.links ?? []) entityGraph.linkEntities({ tenantId: i.tenantId, fromType: i.entity.type, fromId: i.entity.id, toType: l.toType, toId: l.toId, relation: l.relation, evidence: item.evidenceRef ?? null });
      out.mirrors.push("ENTITY_GRAPH");
    }
    rec("MEMORY_WRITE", { tenantId: i.tenantId, decision: item.kind, reason: out.verificationState, resource: item.id });
    return out;
  }

  /** Job outcome -> memory. Only an independently verified outcome becomes a HISTORICAL_RESULT; anything else is stored as UNVERIFIED so it can never teach the system a false lesson.
   *  lessons[] become lesson CANDIDATES (never approved here). */
  function recordOutcome({ tenantId, jobId, projectId = null, agentId = null, taskType, action = null, outcome, verification = null, evidenceRef = null, reward = 0, costUsd = 0, lessons = [], scope = "BUSINESS" } = {}) {
    if (!tenantId || !jobId || !taskType || !outcome) throw new Error("OUTCOME_FIELDS_REQUIRED");
    const verified = verification?.verdict === "ACCEPT" && verification?.independent === true && Boolean(evidenceRef);
    const item = knowledge.assertItem({ tenantId, key: `outcome:${taskType}:${jobId}`, value: { outcome, agentId, action, reward, costUsd }, kind: "HISTORICAL_RESULT", source: { type: "SYSTEM", ref: jobId }, evidenceRef: verified ? evidenceRef : null, confidence: verified ? 0.9 : 0.3, jobId, projectId, scope });
    let exp = null;
    if (experience) exp = experience.recordExperience({ tenantId, agentId, taskType, action, outcome, evidence: verified ? evidenceRef : null, reward: verified ? reward : 0, costUsd, lessons });
    const cands = lessons.map(text => knowledge.proposeLesson({ tenantId, text, evidenceRef: verified ? evidenceRef : null, jobId }));
    rec("MEMORY_OUTCOME", { tenantId, jobId, decision: verified ? "VERIFIED_RESULT" : "UNVERIFIED_RESULT", reason: verified ? "INDEPENDENT_ACCEPT_WITH_EVIDENCE" : "NOT_INDEPENDENTLY_VERIFIED" });
    return { itemId: item.id, kind: item.kind, verified, experienceId: exp?.id ?? null, lessonCandidates: cands.length, learnedFrom: verified ? "VERIFIED_OUTCOME" : "UNVERIFIED_OUTCOME_NOT_USED_FOR_REWARD" };
  }
  const approveLesson = (id, ownerApproval) => knowledge.approveLesson(id, ownerApproval);

  /** Unified recall. scopes defaults to BUSINESS only; PERSONAL / CUSTOMER data must be asked for explicitly. */
  function recall({ tenantId, query = "", scopes = ["BUSINESS"], entity = null, taskType = null, projectId = null, jobId = null, includeStale = false, limit = 10 } = {}) {
    if (!tenantId) throw new Error("TENANT_REQUIRED");
    const items = knowledge.retrieve({ tenantId, query, projectId, jobId, includeStale, scopes, limit }).map(r => state(r, { via: "KNOWLEDGE_BRAIN", score: r.score }));
    const mirrored = [];
    if (entity && businessMemory) for (const m of businessMemory.recall({ entityType: entity.type, entityId: ns(tenantId, entity.id), limit })) if (!m.source?.scope || scopes.includes(m.source.scope)) mirrored.push({ id: m.id, tenantId, scope: m.source?.scope ?? "BUSINESS", text: m.text, time: m.createdAt, provenance: m.source, confidence: m.importance, verificationState: /^\[VERIFIED/.test(m.text) ? "VERIFIED" : "UNVERIFIED", via: "BUSINESS_MEMORY" });
    const lessons = taskType && experience ? experience.lessonsFor({ tenantId, taskType }).map(e => ({ id: e.id, tenantId, text: e.lessons, time: e.at, provenance: { evidence: e.evidence }, confidence: e.evidence ? 0.8 : 0.4, verificationState: e.evidence ? "VERIFIED" : "UNVERIFIED", via: "EXPERIENCE_LEARNING" })) : [];
    const approved = knowledge.lessonsFor(tenantId, query).map(l => ({ id: l.id, tenantId, text: l.text, time: l.approvedAt ?? l.createdAt, provenance: { evidenceRef: l.evidenceRef }, verificationState: "OWNER_APPROVED", via: "APPROVED_LESSON" }));
    const graph = entity && entityGraph ? entityGraph.entityView({ tenantId, type: entity.type, id: entity.id }) : null;
    return { items, mirrored, lessons, approvedLessons: approved, graph, scopes };
  }
  /** Decision history (owner decisions + approved policies) and job/project history from the Knowledge Brain. */
  const decisions = (tenantId, query = "") => knowledge.retrieve({ tenantId, query, kinds: ["OWNER_DECISION", "APPROVED_POLICY"], scopes: SCOPES, limit: 50 }).map(r => state(r));
  const jobHistory = (tenantId, jobId) => knowledge.retrieve({ tenantId, jobId, scopes: SCOPES, includeStale: true, limit: 100 }).filter(r => r.jobId === jobId).map(r => state(r));
  const projectHistory = (tenantId, projectId) => knowledge.retrieve({ tenantId, projectId, scopes: SCOPES, includeStale: true, limit: 100 }).filter(r => r.projectId === projectId).map(r => state(r));
  return { remember, recordOutcome, recall, approveLesson, decisions, jobHistory, projectHistory, conflicts: t => knowledge.conflicts(t), stale: t => knowledge.staleItems(t), summary: t => knowledge.summary(t), scopes: SCOPES };
}
