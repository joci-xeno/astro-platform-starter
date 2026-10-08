// Research Ledger (85-capability audit: M08, C08, G02, GE04, P13, G03, P10). A durable, tamper-evident record of research:
// questions -> findings (claims) -> evidence (verifiable citations) -> contradictions -> unresolved questions.
//
// NOTHING is duplicated: sources live in Knowledge Projects (documents via the Document Center, notes, web snapshots with URL + retrievedAt) and every
// evidence item is a Knowledge-Projects citation re-checked against the CURRENT source through the caller's permissions.
//
// Truth rules:
//  * A finding's status is COMPUTED at read time from re-verified evidence, never stored and never set by its author.
//  * VERIFIED needs >=1 supporting citation that verifies OK now, is not aged out, and whose quote covers the claim's terms. Otherwise the claim is
//    UNSUPPORTED / ASSUMPTION / OUTDATED / UNVERIFIABLE / CONFLICTED / REFUTED and is listed in its own section of the report - never among the facts.
//  * Confidence reflects number of independent verified sources and freshness - NOT truth. Author-claimed confidence does not exist.
//  * Contradictions (declared, same-topic/different-value, or supporting-vs-refuting evidence) keep a finding CONFLICTED until the OWNER resolves them.
//  * Retrieval underneath is keyword-based (not semantic); this ledger does no semantic judgement of its own: it checks quote coverage of claim terms.
import { createStore } from "./business/store.mjs";
import { terms } from "./knowledge-projects.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

export const FINDING_KINDS = Object.freeze(["CLAIM", "ASSUMPTION"]);
export const RELATIONS = Object.freeze(["SUPPORTS", "REFUTES"]);
export const STATUSES = Object.freeze(["VERIFIED", "UNSUPPORTED", "ASSUMPTION", "OUTDATED", "CONFLICTED", "REFUTED", "REJECTED", "UNVERIFIABLE"]);
export const LIMITS = Object.freeze({ questionChars: 500, claimChars: 1000, noteChars: 1000, topicChars: 120, valueChars: 200, evidencePerFinding: 50, minCoverage: 0.5, freshnessDays: 30 });
import { scrub, containsSecret } from "./secret-patterns.mjs";
const looksSecret = v => { const t = String(v ?? ""); return containsSecret(t) || scrub(t, "[r]") !== t; };
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const norm = s => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function createResearchLedger({ file = null, knowledge, security = null, blackBox = null, now = () => new Date().toISOString(), freshnessDays = LIMITS.freshnessDays } = {}) {
  if (!knowledge || typeof knowledge.verifyCitation !== "function") throw new Error("KNOWLEDGE_PROJECTS_REQUIRED");
  const store = createStore({ file, init: () => ({ questions: {}, findings: {}, contradictions: {}, events: [], seq: 0 }) }), S = store.data;   // unreadable file => STORE_UNREADABLE, never replaced
  const reload = () => { if (!file) return; let d; try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return; throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop()); } if (!d || typeof d !== "object" || Array.isArray(d) || ["questions", "findings", "contradictions"].some(k => d[k] !== undefined && (typeof d[k] !== "object" || d[k] === null || Array.isArray(d[k]))) || (d.events !== undefined && !Array.isArray(d.events))) throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop());   // a wrong-shaped file is refused, never overwritten
    for (const k of ["questions", "findings", "contradictions"]) S[k] = d[k] ?? {}; S.events = d.events ?? []; S.seq = d.seq ?? 0; };
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  const id = p => p + "-" + (++S.seq) + "-" + crypto.randomBytes(3).toString("hex");
  /** Append-only, hash-chained event log: every write is recorded with who/what/when; verifyChain() detects edits, deletions and reordering. */
  function event(type, by, d) {
    const prev = S.events.length ? S.events[S.events.length - 1].hash : "GENESIS", e = { n: S.events.length + 1, at: now(), type, by, ...d, prev };
    e.hash = sha(prev + JSON.stringify({ ...e, hash: undefined })); S.events.push(e); log("RESEARCH_" + type, { by, ...d }); return e;
  }
  function verifyChain() {
    let prev = "GENESIS";
    for (const e of S.events) { const { hash, ...rest } = e; if (e.prev !== prev || sha(prev + JSON.stringify({ ...rest, hash: undefined })) !== hash) return { ok: false, brokenAt: e.n }; prev = hash; }
    return { ok: true, events: S.events.length };
  }
  const who = w => ({ tenantId: w?.tenantId, role: w?.role ?? "OWNER", forAgent: Boolean(w?.forAgent) });
  const byOf = (w, by) => (who(w).forAgent ? "AGENT" : (typeof by === "string" && by ? by : "OWNER"));   // an agent can never name itself OWNER (or anyone else)
  function access(projectId, w) {                                   // the caller must be allowed to use the project (tenant + role), else it does not exist for them
    if (!w?.tenantId) throw new Error("TENANT_REQUIRED");
    if (!knowledge.list({ tenantId: w.tenantId, role: who(w).role }).some(p => p.id === projectId)) throw new Error("PROJECT_NOT_PERMITTED");
  }
  const question = (qid, w) => { const q = S.questions[qid]; if (!q || q.tenantId !== w?.tenantId) throw new Error("UNKNOWN_QUESTION"); access(q.projectId, w); return q; };
  const finding = (fid, w) => { const f = S.findings[fid]; if (!f || f.tenantId !== w?.tenantId) throw new Error("UNKNOWN_FINDING"); question(f.questionId, w); return f; };
  function vet(text, max, field, by) {
    const t = String(text ?? "").trim(); if (!t) throw new Error(field + "_REQUIRED"); if (t.length > max) throw new Error(field + "_TOO_LONG");
    if (looksSecret(t)) throw new Error(field + "_CONTAINS_SECRET");
    let sc = { decision: "NOT_SCREENED" }; if (security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "research:" + field, text: t }); sc = { decision: a.decision }; if (a.allowed === false && by !== "OWNER") throw new Error(field + "_BLOCKED_BY_SECURITY"); }
    return { text: t, screening: sc.decision };
  }

  function openQuestion({ projectId, text, by } = {}, w) {
    reload(); access(projectId, w); const b = byOf(w, by), v = vet(text, LIMITS.questionChars, "QUESTION", b);
    const q = { id: id("rq"), tenantId: w.tenantId, projectId, text: v.text, screening: v.screening, createdBy: b, createdAt: now() }; S.questions[q.id] = q;
    event("QUESTION_OPENED", b, { id: q.id, projectId }); store.save(); return structuredClone(q);
  }
  /** Add a source to a question's project through Knowledge Projects (web snapshot needs URL + retrievedAt; screened as untrusted input). */
  function addSource(projectId, { kind = "webpage", url, retrievedAt, title, text, by } = {}, w) {
    reload(); access(projectId, w); const b = byOf(w, by);
    const m = kind === "note" ? knowledge.addNote(projectId, { tenantId: w.tenantId, title, text, createdBy: b }) : knowledge.addWebSnapshot(projectId, { tenantId: w.tenantId, url, retrievedAt, title, text, createdBy: b });
    event("SOURCE_ADDED", b, { projectId, member: m.id, kind: m.kind }); store.save(); return m;
  }
  function addFinding(qid, { claim, kind = "CLAIM", topic = null, value = null, by } = {}, w) {
    reload(); const q = question(qid, w), b = byOf(w, by); if (!FINDING_KINDS.includes(kind)) throw new Error("KIND_INVALID");
    const c = vet(claim, LIMITS.claimChars, "CLAIM", b); if ((topic == null) !== (value == null)) throw new Error("TOPIC_AND_VALUE_TOGETHER");
    if (topic != null && (looksSecret(topic) || looksSecret(value))) throw new Error("TOPIC_OR_VALUE_CONTAINS_SECRET");
    if (topic != null && (String(topic).length > LIMITS.topicChars || String(value).length > LIMITS.valueChars)) throw new Error("TOPIC_OR_VALUE_TOO_LONG");
    const f = { id: id("rf"), tenantId: w.tenantId, questionId: q.id, claim: c.text, kind, topic: topic == null ? null : norm(topic), value: value == null ? null : norm(value), screening: c.screening, createdBy: b, createdAt: now(), evidence: [] };
    S.findings[f.id] = f; event("FINDING_ADDED", b, { id: f.id, questionId: q.id, kind, claimSha: sha(f.claim) }); store.save(); return structuredClone(f);
  }
  /** Attach a Knowledge-Projects citation. It must verify OK right now, belong to the question's project and actually cover the claim's terms. */
  function attachEvidence(fid, { citation, relation = "SUPPORTS", by } = {}, w) {
    reload(); const f = finding(fid, w), q = S.questions[f.questionId], b = byOf(w, by);
    if (f.kind === "ASSUMPTION") throw new Error("ASSUMPTION_CANNOT_HAVE_EVIDENCE");
    if (!RELATIONS.includes(relation)) throw new Error("RELATION_INVALID"); if (!citation || citation.projectId !== q.projectId) throw new Error("CITATION_NOT_IN_PROJECT");
    if (f.evidence.length >= LIMITS.evidencePerFinding) throw new Error("TOO_MUCH_EVIDENCE");
    if (f.evidence.some(e => e.citation.memberId === citation.memberId && e.citation.start === citation.start && e.citation.end === citation.end && e.relation === relation)) throw new Error("ALREADY_ATTACHED");
    const v = knowledge.verifyCitation(citation, w); if (v.status !== "OK") throw new Error("CITATION_" + v.status);
    const ct = new Set(terms(f.claim)), qt = new Set(terms(citation.quote)), cov = ct.size ? [...ct].filter(t => qt.has(t)).length / ct.size : 0;
    if (cov < LIMITS.minCoverage) throw new Error("EVIDENCE_DOES_NOT_COVER_CLAIM");
    const meta = knowledge.summary(q.projectId, w).members.find(m => m.id === citation.memberId);
    const e = { id: id("re"), relation, citation: { projectId: citation.projectId, memberId: citation.memberId, kind: citation.kind, title: citation.title, version: citation.version, sha256: citation.sha256, url: citation.url ?? null, start: citation.start, end: citation.end, quote: citation.quote },
      retrievedAt: meta?.retrievedAt ?? null, coverage: Number(cov.toFixed(2)), addedBy: b, addedAt: now() };
    f.evidence.push(e); event("EVIDENCE_ATTACHED", b, { findingId: f.id, evidence: e.id, relation, member: citation.memberId }); store.save(); return { id: e.id, relation, coverage: e.coverage };
  }
  function declareContradiction(aId, bId, { note = "", by } = {}, w) {
    reload(); const a = finding(aId, w), c = finding(bId, w), b = byOf(w, by); if (a.id === c.id) throw new Error("SAME_FINDING");
    if (a.questionId !== c.questionId) throw new Error("DIFFERENT_QUESTIONS");
    if (Object.values(S.contradictions).some(x => x.state === "OPEN" && [x.a, x.b].sort().join() === [a.id, c.id].sort().join())) throw new Error("ALREADY_DECLARED");
    const n = vet(note || "declared", LIMITS.noteChars, "NOTE", b), k = { id: id("rc"), tenantId: w.tenantId, questionId: a.questionId, a: a.id, b: c.id, note: n.text, state: "OPEN", declaredBy: b, declaredAt: now(), resolution: null };
    S.contradictions[k.id] = k; event("CONTRADICTION_DECLARED", b, { id: k.id, a: a.id, b: c.id }); store.save(); return structuredClone(k);
  }
  /** Only the OWNER resolves a contradiction (agents and models cannot make a conflict disappear). winner = one of the two findings, or null if they do not truly conflict. */
  function resolveContradiction(kid, { winner = null, note } = {}, w) {
    reload(); if (who(w).forAgent || who(w).role !== "OWNER") throw new Error("OWNER_ONLY");
    const k = S.contradictions[kid]; if (!k || k.tenantId !== w.tenantId) throw new Error("UNKNOWN_CONTRADICTION"); question(k.questionId, w); if (k.state !== "OPEN") throw new Error("ALREADY_RESOLVED");
    if (winner != null && ![k.a, k.b].includes(winner)) throw new Error("WINNER_NOT_IN_CONTRADICTION"); const n = vet(note, LIMITS.noteChars, "NOTE", "OWNER");
    k.state = "RESOLVED"; k.resolution = { winner, note: n.text, by: "OWNER", at: now() }; event("CONTRADICTION_RESOLVED", "OWNER", { id: k.id, winner }); store.save(); return structuredClone(k);
  }

  const ageDays = r => r ? (Date.parse(now()) - Date.parse(r)) / 86400000 : null;
  /** Re-verify a finding's evidence NOW through the caller's permissions and compute its status. */
  function evaluate(f, w) {
    const q = S.questions[f.questionId], base = { id: f.id, questionId: f.questionId, claim: f.claim, kind: f.kind, topic: f.topic, value: f.value, createdBy: f.createdBy, createdAt: f.createdAt };
    if (f.kind === "ASSUMPTION") return { ...base, status: "ASSUMPTION", confidence: "NONE", reasons: ["AUTHOR_MARKED_ASSUMPTION"], evidence: [] };
    const ev = f.evidence.map(e => { const v = knowledge.verifyCitation(e.citation, w), age = ageDays(e.retrievedAt), aged = age != null && age > freshnessDays;
      return { id: e.id, relation: e.relation, title: e.citation.title, kind: e.citation.kind, url: e.citation.url, version: e.citation.version, quote: v.status === "SOURCE_UNAVAILABLE" && who(w).role !== "OWNER" ? "[withheld: source not readable by this role]" : e.citation.quote, retrievedAt: e.retrievedAt, verification: v.status, aged, ok: v.status === "OK" && !aged, memberId: e.citation.memberId, addedBy: e.addedBy }; });
    const sup = ev.filter(e => e.relation === "SUPPORTS" && e.ok), ref = ev.filter(e => e.relation === "REFUTES" && e.ok), reasons = [];
    const pairs = Object.values(S.contradictions).filter(k => k.tenantId === f.tenantId && (k.a === f.id || k.b === f.id));
    const rejected = pairs.some(k => k.state === "RESOLVED" && k.resolution.winner && k.resolution.winner !== f.id);
    const open = pairs.filter(k => k.state === "OPEN");
    const autoConf = f.topic ? Object.values(S.findings).filter(o => o.id !== f.id && o.questionId === f.questionId && o.kind === "CLAIM" && o.topic === f.topic && o.value !== f.value && !pairs.some(k => k.state === "RESOLVED" && [k.a, k.b].includes(o.id))) : [];
    let status;
    if (rejected) { status = "REJECTED"; reasons.push("OWNER_RESOLVED_CONTRADICTION_AGAINST_THIS_FINDING"); }
    else if (open.length || autoConf.length) { status = "CONFLICTED"; if (open.length) reasons.push("OPEN_CONTRADICTION:" + open.map(k => k.id).join(",")); if (autoConf.length) reasons.push("SAME_TOPIC_DIFFERENT_VALUE:" + autoConf.map(o => o.id).join(",")); }
    else if (sup.length && ref.length) { status = "CONFLICTED"; reasons.push("SUPPORTING_AND_REFUTING_EVIDENCE"); }
    else if (ref.length) { status = "REFUTED"; reasons.push("VERIFIED_REFUTING_EVIDENCE"); }
    else if (sup.length) { status = "VERIFIED"; }
    else if (!ev.length) { status = "UNSUPPORTED"; reasons.push("NO_EVIDENCE"); }
    else if (ev.some(e => e.verification === "STALE_SOURCE" || e.aged)) { status = "OUTDATED"; reasons.push(...[...new Set(ev.filter(e => e.verification === "STALE_SOURCE" || e.aged).map(e => e.verification === "STALE_SOURCE" ? "SOURCE_CHANGED_OR_SUPERSEDED" : "RETRIEVED_MORE_THAN_" + freshnessDays + "_DAYS_AGO"))]); }
    else { status = "UNVERIFIABLE"; reasons.push(...[...new Set(ev.map(e => e.verification))]); }
    // A finding built on sources this caller cannot read must not leak their content through the claim text either.
    const redact = who(w).role !== "OWNER" && ev.some(e => e.verification === "SOURCE_UNAVAILABLE"); if (redact) { base.claim = "[withheld: finding rests on a source this role cannot read]"; reasons.push("CLAIM_REDACTED_FOR_ROLE"); }
    const distinct = new Set(sup.map(e => e.memberId)).size;
    const confidence = status === "VERIFIED" ? (distinct >= 2 ? "HIGH" : "MEDIUM") : status === "CONFLICTED" ? "LOW" : "NONE";
    return { ...base, status, confidence, independentSources: distinct, reasons, evidence: ev, note: "Status is recomputed from the current sources on every read. Confidence = independent verified sources + freshness, not proof of truth." };
  }
  /** Structured report: facts only from VERIFIED findings; every other class is listed separately. */
  function report(qid, w) {
    reload(); const q = question(qid, w), fs = Object.values(S.findings).filter(f => f.questionId === qid && f.tenantId === w.tenantId).map(f => evaluate(f, w)), by = s => fs.filter(f => f.status === s);
    const contradictions = Object.values(S.contradictions).filter(k => k.questionId === qid).map(k => structuredClone(k));
    const state = by("VERIFIED").length && !by("CONFLICTED").length ? "ANSWERED" : by("CONFLICTED").length ? "CONTESTED" : "UNRESOLVED";
    return { question: { id: q.id, text: q.text, projectId: q.projectId, createdAt: q.createdAt }, state, verifiedFacts: by("VERIFIED"), conflicted: by("CONFLICTED"), refuted: by("REFUTED"), outdated: by("OUTDATED"), unverifiable: by("UNVERIFIABLE"),
      unsupported: by("UNSUPPORTED"), assumptions: by("ASSUMPTION"), rejected: by("REJECTED"), contradictions, asOf: now(),
      note: state === "ANSWERED" ? "Answered only by findings whose evidence verifies against the current sources." : "Not answered: no verified, uncontested finding. Unsupported claims and assumptions are NOT facts." };
  }
  const unresolved = (w, { projectId = null } = {}) => { reload(); return Object.values(S.questions).filter(q => q.tenantId === w?.tenantId && (!projectId || q.projectId === projectId)).filter(q => { try { access(q.projectId, w); return true; } catch { return false; } })
    .map(q => { const r = report(q.id, w); return { id: q.id, text: q.text, projectId: q.projectId, state: r.state, counts: { verified: r.verifiedFacts.length, conflicted: r.conflicted.length, unsupported: r.unsupported.length, assumptions: r.assumptions.length, outdated: r.outdated.length } }; }).filter(x => x.state !== "ANSWERED"); };
  function list(w, { projectId = null } = {}) { reload(); return Object.values(S.questions).filter(q => q.tenantId === w?.tenantId && (!projectId || q.projectId === projectId)).filter(q => { try { access(q.projectId, w); return true; } catch { return false; } }).map(q => ({ id: q.id, text: q.text, projectId: q.projectId, createdBy: q.createdBy, createdAt: q.createdAt })); }
  function summary(w) { const l = list(w), u = unresolved(w); return { questions: l.length, unresolved: u.length, answered: l.length - u.length, events: S.events.length, chain: verifyChain(), method: "EXTRACTIVE_CITATIONS_OVER_KEYWORD_RETRIEVAL" }; }
  const events = (w, { limit = 100 } = {}) => { reload(); if (who(w).forAgent) throw new Error("OWNER_ONLY"); return S.events.slice(-Math.min(limit, 500)).map(e => structuredClone(e)); };
  return { openQuestion, addSource, addFinding, attachEvidence, declareContradiction, resolveContradiction, report, unresolved, list, summary, events, verifyChain: () => (reload(), verifyChain()) };
}
