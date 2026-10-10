// Research Ledger (85-capability audit: M08, C08, G02, GE04, P13, G03, P10). A durable, tamper-evident record of research:
// questions -> findings (claims) -> evidence (verifiable citations) -> contradictions -> unresolved questions.
//
// NOTHING is duplicated: sources live in Knowledge Projects (documents via the Document Center, notes, web snapshots with URL + retrievedAt) and every
// evidence item is a Knowledge-Projects citation re-checked against the CURRENT source through the caller's permissions.
//
// Truth rules:
//  * A finding's status is COMPUTED at read time from re-verified evidence, never stored and never set by its author.
//  * A literal quotation match is NOT semantic verification. A supporting citation that verifies OK now, is not aged out and covers the claim's terms (numbers present,
//    same polarity) only makes the finding QUOTE_MATCHED. VERIFIED additionally needs the OWNER to confirm that evidence item (confirmEvidence: owner-only, never an agent).
//    Likewise unconfirmed refuting evidence only makes REFUTATION_CLAIMED; REFUTED needs owner confirmation. Everything else is
//    UNSUPPORTED / ASSUMPTION / OUTDATED / UNVERIFIABLE / CONFLICTED and is listed in its own section of the report - never among the facts.
//  * Confidence reflects number of independent verified sources and freshness - NOT truth. Author-claimed confidence does not exist.
//  * Contradictions (declared, same-topic/different-value, or supporting-vs-refuting evidence) keep a finding CONFLICTED until the OWNER resolves them.
//  * Retrieval underneath is keyword-based (not semantic); this ledger does no semantic judgement of its own: it checks quote coverage of claim terms.
import { createStore } from "./business/store.mjs";
import { terms } from "./knowledge-projects.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

export const FINDING_KINDS = Object.freeze(["CLAIM", "ASSUMPTION"]);
export const RELATIONS = Object.freeze(["SUPPORTS", "REFUTES"]);
export const STATUSES = Object.freeze(["VERIFIED", "QUOTE_MATCHED", "REFUTATION_CLAIMED", "UNSUPPORTED", "ASSUMPTION", "OUTDATED", "CONFLICTED", "REFUTED", "REJECTED", "UNVERIFIABLE"]);
const NEG = /\b(not|no|never|none|neither|nor|cannot|without|unable|unavailable|lacks?|lacked|fail(?:s|ed)?|absent|n't|isn't|aren't|doesn't|don't|didn't|won't|wasn't|weren't|hasn't|haven't|nem|nincs|soha|sem)\b|n't\b/gi;
const norm0 = t => String(t).normalize("NFKC").replace(/[\u2018\u2019\u02bc]/g, "'");          // curly apostrophes count as apostrophes
/** Numbers as written: thousands commas are removed, a dot is ALWAYS a decimal point (so 4.200 is not 4200: an ambiguous format never passes as a match). */
const nums = t => new Set((norm0(t).match(/\d[\d.,]*\d|\d/g) ?? []).map(n => n.replace(/,(?=\d{3}\b)/g, "").replace(/[.,]$/, "")));
const FOREIGN_DIGITS = /\p{Nd}/u, ASCII_DIGITS_ONLY = t => !/[^\u0000-\u007f]/.test(String(t).replace(/[^\p{Nd}]/gu, ""));
/** Offline support check (no semantics): a SUPPORTING quote must contain every number the claim states and must not flip its polarity. Lexical overlap alone is NOT entailment. */
function supportMismatch(claim, quote) {
  if (!ASCII_DIGITS_ONLY(claim) || !ASCII_DIGITS_ONLY(quote)) return "EVIDENCE_NON_ASCII_DIGITS";            // digits of other scripts cannot be compared by this check: refused rather than guessed
  claim = norm0(claim); quote = norm0(quote); const q = nums(quote); for (const n of nums(claim)) if (!q.has(n)) return "EVIDENCE_NUMBER_NOT_IN_QUOTE:" + n;
  if ((String(claim).match(NEG) ?? []).length % 2 !== (String(quote).match(NEG) ?? []).length % 2) return "EVIDENCE_NEGATION_MISMATCH";
  return null;
}
export const LIMITS = Object.freeze({ questionChars: 500, claimChars: 1000, noteChars: 1000, topicChars: 120, valueChars: 200, evidencePerFinding: 50, minCoverage: 0.5, freshnessDays: 30 });
import { scrub, containsSecret } from "./secret-patterns.mjs";
const looksSecret = v => { const t = String(v ?? ""); return containsSecret(t) || scrub(t, "[r]") !== t; };
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== "function").sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v) ?? "null";
const norm = s => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function createResearchLedger({ file = null, knowledge, security = null, blackBox = null, now = () => new Date().toISOString(), freshnessDays = LIMITS.freshnessDays } = {}) {
  if (!knowledge || typeof knowledge.verifyCitation !== "function") throw new Error("KNOWLEDGE_PROJECTS_REQUIRED");
  const store = createStore({ file, init: () => ({ questions: {}, findings: {}, contradictions: {}, events: [], seq: 0 }) }), S = store.data;   // unreadable file => STORE_UNREADABLE, never replaced
  let loadTamper = false;      // the file as read does not match its newest seal: no new event may re-seal it
  const reload = () => { if (!file) return; let d; try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return; throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop()); } if (!d || typeof d !== "object" || Array.isArray(d) || ["questions", "findings", "contradictions"].some(k => d[k] !== undefined && (typeof d[k] !== "object" || d[k] === null || Array.isArray(d[k]))) || (d.events !== undefined && !Array.isArray(d.events))) throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop());   // a wrong-shaped file is refused, never overwritten
    for (const k of ["questions", "findings", "contradictions"]) S[k] = d[k] ?? {}; S.events = d.events ?? []; S.seq = d.seq ?? 0; stMemo = null; loadTamper = !stateOk(); };
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  const id = p => p + "-" + (++S.seq) + "-" + crypto.randomBytes(3).toString("hex");
  /** Append-only, hash-chained event log: every write is recorded with who/what/when; verifyChain() detects edits, deletions and reordering. */
  // Head anchor: the newest event's number and hash live in a second file, so a truncated event list (or a deleted anchor) is noticed instead of being extended.
  const headFile = file ? file + ".head" : null, baseSave = store.save;
  const readHead = () => { if (!headFile || !fs.existsSync(headFile)) return null; try { const h = JSON.parse(fs.readFileSync(headFile, "utf8")); return Number.isInteger(h?.n) && typeof h?.hash === "string" ? h : { n: -1, hash: "" }; } catch { return { n: -1, hash: "" }; } };
  store.save = () => { baseSave(); if (headFile && S.events.length) { try { fs.writeFileSync(headFile, JSON.stringify({ n: S.events.length, hash: S.events.at(-1).hash }), { mode: 0o600 }); } catch { /* the store itself is saved */ } } };
  if (headFile && S.events.length && !fs.existsSync(headFile)) store.save();            // a store written before anchors existed adopts one when opened
  const anchorOk = () => { if (!headFile) return true; if (!S.events.length) { const h0 = readHead(); return !(h0 && h0.n > 0); } const h = readHead(); return Boolean(h) && h.n === S.events.length && S.events.at(-1).hash === h.hash; };
  /** Whole-store seal: every event records a hash of questions + findings + contradictions as they were after that change. A store edited outside the ledger no longer matches the newest event. */
  let stMemo = null; const stNow = () => (stMemo ??= sha(canon([S.questions, S.findings, S.contradictions])));
  const stateOk = () => { const last = S.events.at(-1); return !last || typeof last.st !== "string" || last.st === stNow(); };
  function event(type, by, d) {
    if (!anchorOk() || loadTamper) throw new Error("CHAIN_BROKEN");
    stMemo = null;
    const prev = S.events.length ? S.events[S.events.length - 1].hash : "GENESIS", e = { n: S.events.length + 1, at: now(), type, by, ...d, st: stNow(), prev };
    e.hash = sha(prev + JSON.stringify({ ...e, hash: undefined })); S.events.push(e); log("RESEARCH_" + type, { by, ...d }); return e;
  }
  function verifyChain() {
    let prev = "GENESIS";
    for (const e of S.events) { const { hash, ...rest } = e; if (e.prev !== prev || sha(prev + JSON.stringify({ ...rest, hash: undefined })) !== hash) return { ok: false, brokenAt: e.n }; prev = hash; }
    if (!anchorOk()) return { ok: false, brokenAt: S.events.length + 1, reason: readHead() ? "HEAD_ANCHOR_MISMATCH" : "HEAD_ANCHOR_MISSING" };
    if (!stateOk()) return { ok: false, brokenAt: S.events.length, reason: "STORE_ALTERED_OUTSIDE_LEDGER" };      // questions/findings/contradictions no longer match the newest event's seal
    return { ok: true, events: S.events.length };
  }
  // Owner confirmations live in the hash-chained event log (not in a field of the evidence): a hand-edited store cannot create one without also forging the chain AND its head anchor.
  let confMemo = { key: "", set: new Set() };
  /** What the owner actually confirmed: the claim text, the relation, the retrieval date and the quote. Any later edit of one of them (outside the hash chain) voids the confirmation. */
  const bindOf = (f, e) => sha([f.claim, e.relation, e.retrievedAt ?? "", e.citation.quote, e.citation.memberId, e.citation.start, e.citation.end, e.citation.sha256].join("\u0000"));
  const findingSig = f => sha(JSON.stringify([f.tenantId, f.questionId, f.kind, f.topic ?? "", f.value ?? "", f.claim]));      // a structured encoding: no field can shift into its neighbour
  const questionSig = q => sha(JSON.stringify([q.tenantId, q.projectId, q.text]));
  /** What the verified chain says happened (null when the chain is broken): evidence that was attached, contradictions declared and how each was resolved. The store must agree with it. */
  let factMemo = { key: "", v: null };
  const chainFacts = () => { const key = S.events.length + ":" + (S.events.at(-1)?.hash ?? "") + ":" + anchorOk() + stateOk(); if (factMemo.key === key) return factMemo.v;
    let v = null; if (verifyChain().ok && stateOk()) { v = { attached: new Map(), declared: [], resolved: new Map(), findings: new Map(), questions: new Map() };
      for (const e of S.events) { if (e.type === "EVIDENCE_ATTACHED" && typeof e.findingId === "string") { if (!v.attached.has(e.findingId)) v.attached.set(e.findingId, new Set()); v.attached.get(e.findingId).add(e.evidence); } else if (e.type === "QUESTION_OPENED" && typeof e.qsig === "string") v.questions.set(e.id, e.qsig); else if (e.type === "FINDING_ADDED" && typeof e.fsig === "string") v.findings.set(e.id, { fsig: e.fsig, questionId: e.questionId }); else if (e.type === "CONTRADICTION_DECLARED") v.declared.push({ id: e.id, a: e.a, b: e.b }); else if (e.type === "CONTRADICTION_RESOLVED") v.resolved.set(e.id, String(e.winner ?? null)); } }
    factMemo = { key, v }; return v; };
  const confirmedSet = () => { const key = S.events.length + ":" + (S.events.at(-1)?.hash ?? "") + ":" + anchorOk() + stateOk(); if (confMemo.key === key) return confMemo.set; const ok = verifyChain().ok && stateOk(); confMemo = { key, set: new Set(ok ? S.events.filter(e => e.type === "EVIDENCE_CONFIRMED" && e.by === "OWNER" && typeof e.bind === "string").map(e => e.findingId + "|" + e.evidence + "|" + e.bind) : []) }; return confMemo.set; };
  const who = w => ({ tenantId: w?.tenantId, role: w?.role ?? "OWNER", forAgent: Boolean(w?.forAgent) });
  const byOf = (w, by) => (who(w).forAgent ? "AGENT" : (typeof by === "string" && by ? by : "OWNER"));   // an agent can never name itself OWNER (or anyone else)
  function access(projectId, w) {                                   // the caller must be allowed to use the project (tenant + role), else it does not exist for them
    if (!w?.tenantId) throw new Error("TENANT_REQUIRED");
    if (!knowledge.list({ tenantId: w.tenantId, role: who(w).role }).some(p => p.id === projectId)) throw new Error("PROJECT_NOT_PERMITTED");
  }
  const question = (qid, w) => { const q = Object.hasOwn(S.questions, qid) ? S.questions[qid] : null; if (!q || q.tenantId !== w?.tenantId) throw new Error("UNKNOWN_QUESTION"); access(q.projectId, w); return q; };
  const finding = (fid, w) => { const f = Object.hasOwn(S.findings, fid) ? S.findings[fid] : null; if (!f || f.tenantId !== w?.tenantId) throw new Error("UNKNOWN_FINDING"); question(f.questionId, w); return f; };
  function vet(text, max, field, by) {
    const t = String(text ?? "").trim(); if (!t) throw new Error(field + "_REQUIRED"); if (t.length > max) throw new Error(field + "_TOO_LONG");
    if (looksSecret(t)) throw new Error(field + "_CONTAINS_SECRET");
    let sc = { decision: "NOT_SCREENED" }; if (security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "research:" + field, text: t }); sc = { decision: a.decision }; if (a.allowed === false && by !== "OWNER") throw new Error(field + "_BLOCKED_BY_SECURITY"); }
    return { text: t, screening: sc.decision };
  }

  function openQuestion({ projectId, text, by } = {}, w) {
    reload(); access(projectId, w); const b = byOf(w, by), v = vet(text, LIMITS.questionChars, "QUESTION", b);
    const q = { id: id("rq"), tenantId: w.tenantId, projectId, text: v.text, screening: v.screening, createdBy: b, createdAt: now() }; S.questions[q.id] = q;
    event("QUESTION_OPENED", b, { id: q.id, projectId, qsig: questionSig(q) }); store.save(); return structuredClone(q);
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
    S.findings[f.id] = f; event("FINDING_ADDED", b, { id: f.id, questionId: q.id, kind, claimSha: sha(f.claim), fsig: findingSig(f) }); store.save(); return structuredClone(f);
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
    if (relation === "SUPPORTS") { const bad = supportMismatch(f.claim, citation.quote); if (bad) throw new Error(bad); }
    const meta = knowledge.summary(q.projectId, w).members.find(m => m.id === citation.memberId);
    const e = { id: id("re"), relation, citation: { projectId: citation.projectId, memberId: citation.memberId, kind: citation.kind ?? null, title: citation.title ?? null, version: citation.version ?? null, sha256: citation.sha256, url: citation.url ?? null, start: citation.start, end: citation.end, quote: citation.quote },
      retrievedAt: meta?.retrievedAt ?? null, coverage: Number(cov.toFixed(2)), addedBy: b, addedAt: now() };
    f.evidence.push(e); event("EVIDENCE_ATTACHED", b, { findingId: f.id, evidence: e.id, relation, member: citation.memberId }); store.save(); return { id: e.id, relation, coverage: e.coverage };
  }
  /** Only the OWNER turns a quotation match into VERIFIED (or a refutation claim into REFUTED): the ledger itself cannot judge meaning. The citation must still verify now. */
  function confirmEvidence(fid, eid, { note } = {}, w) {
    reload(); if (who(w).forAgent || who(w).role !== "OWNER") throw new Error("OWNER_ONLY");
    const f = finding(fid, w), e = f.evidence.find(x => x.id === eid); if (!e) throw new Error("UNKNOWN_EVIDENCE"); if (confirmedSet().has(f.id + "|" + e.id + "|" + bindOf(f, e))) throw new Error("ALREADY_CONFIRMED");
    const v = knowledge.verifyCitation(e.citation, w); if (v.status !== "OK") throw new Error("CITATION_" + v.status);
    const age = ageDays(e.retrievedAt); if (age != null && (age > freshnessDays || age < -1)) throw new Error("EVIDENCE_AGED_OR_DATED_IN_FUTURE");
    if (e.relation === "SUPPORTS") { const bad = supportMismatch(f.claim, e.citation.quote); if (bad) throw new Error(bad); }
    const n = vet(note, LIMITS.noteChars, "NOTE", "OWNER");
    e.confirmedBy = "OWNER"; e.confirmedAt = now(); e.confirmNote = n.text; e.confirmedQuoteSha = sha(e.citation.quote);
    event("EVIDENCE_CONFIRMED", "OWNER", { findingId: f.id, evidence: e.id, relation: e.relation, quoteSha: e.confirmedQuoteSha, bind: bindOf(f, e) }); store.save(); return { id: e.id, relation: e.relation, confirmed: true };
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
    { const vc = verifyChain(), so = stateOk(); if (!vc.ok || !so) return { ...base, status: "CONFLICTED", confidence: "NONE", independentSources: 0, reasons: [!vc.ok ? "CHAIN_BROKEN:" + (vc.reason ?? "ENTRY_HASH_OR_LINK") : "STORE_ALTERED_OUTSIDE_LEDGER"], evidence: [], note: "The ledger's tamper seal does not match: nothing in it is trusted until the owner restores the files." }; }
    if (f.kind === "ASSUMPTION") return { ...base, status: "ASSUMPTION", confidence: "NONE", reasons: ["AUTHOR_MARKED_ASSUMPTION"], evidence: [] };
    const ev = f.evidence.map(e => { const v = knowledge.verifyCitation(e.citation, w), age = ageDays(e.retrievedAt), aged = age != null && (age > freshnessDays || age < -1);   // a retrieval date in the future cannot be trusted as fresh
      return { id: e.id, relation: e.relation, title: e.citation.title, kind: e.citation.kind, url: e.citation.url, version: e.citation.version, quote: v.status === "SOURCE_UNAVAILABLE" && who(w).role !== "OWNER" ? "[withheld: source not readable by this role]" : e.citation.quote, retrievedAt: e.retrievedAt, verification: v.status, aged, ok: v.status === "OK" && !aged, memberId: e.citation.memberId, addedBy: e.addedBy, confirmed: confirmedSet().has(f.id + "|" + e.id + "|" + bindOf(f, e)) }; });
    const sup = ev.filter(e => e.relation === "SUPPORTS" && e.ok), ref = ev.filter(e => e.relation === "REFUTES" && e.ok), supC = sup.filter(e => e.confirmed), refC = ref.filter(e => e.confirmed), reasons = [];
    const cf = chainFacts(), tamper = [];
    if (cf) { const qm = cf.questions.get(f.questionId); if (qm !== undefined && (!S.questions[f.questionId] || questionSig(S.questions[f.questionId]) !== qm)) tamper.push("QUESTION_ALTERED_OUTSIDE_LEDGER:" + f.questionId); }
    if (cf) { const extra = f.evidence.filter(e => !cf.attached.get(f.id)?.has(e.id)).map(e => e.id); if (extra.length) tamper.push("EVIDENCE_NOT_IN_CHAIN:" + extra.join(",")); }
    if (cf) { const miss = [...(cf.attached.get(f.id) ?? [])].filter(x => !f.evidence.some(e => e.id === x)); if (miss.length) tamper.push("EVIDENCE_REMOVED_OUTSIDE_LEDGER:" + miss.join(",")); }
    const pairs = Object.values(S.contradictions).filter(k => k.tenantId === f.tenantId && (k.a === f.id || k.b === f.id)).map(k => { if (cf && k.state === "RESOLVED" && cf.resolved.get(k.id) !== String(k.resolution?.winner ?? null)) { tamper.push("RESOLUTION_NOT_IN_CHAIN:" + k.id); return { ...k, state: "OPEN" }; } return k; });
    if (cf) for (const dk of cf.declared) if (dk.a === f.id || dk.b === f.id) { const sk = S.contradictions[dk.id]; if (!sk || sk.a !== dk.a || sk.b !== dk.b || sk.tenantId !== f.tenantId) tamper.push("CONTRADICTION_REMOVED_OR_ALTERED_OUTSIDE_LEDGER:" + dk.id); }
    if (cf) for (const [fid, m] of cf.findings) if (m.questionId === f.questionId) { const sf = S.findings[fid]; if (!sf || findingSig(sf) !== m.fsig) tamper.push("FINDING_REMOVED_OR_ALTERED_OUTSIDE_LEDGER:" + fid); }
    const rejected = pairs.some(k => k.state === "RESOLVED" && k.resolution.winner && k.resolution.winner !== f.id);
    const open = pairs.filter(k => k.state === "OPEN");
    const autoConf = f.topic ? Object.values(S.findings).filter(o => o.id !== f.id && o.questionId === f.questionId && o.kind === "CLAIM" && o.topic === f.topic && o.value !== f.value && !pairs.some(k => k.state === "RESOLVED" && [k.a, k.b].includes(o.id))) : [];
    let status;
    if (rejected) { status = "REJECTED"; reasons.push("OWNER_RESOLVED_CONTRADICTION_AGAINST_THIS_FINDING"); }
    else if (open.length || autoConf.length || tamper.length) { status = "CONFLICTED"; if (open.length) reasons.push("OPEN_CONTRADICTION:" + open.map(k => k.id).join(",")); if (tamper.length) reasons.push(...tamper); if (autoConf.length) reasons.push("SAME_TOPIC_DIFFERENT_VALUE:" + autoConf.map(o => o.id).join(",")); }
    else if (sup.length && (ref.length || ev.some(e => e.relation === "REFUTES" && !e.ok))) { status = "CONFLICTED"; reasons.push(ref.length ? "SUPPORTING_AND_REFUTING_EVIDENCE" : "REFUTING_EVIDENCE_NOT_CURRENTLY_VERIFIABLE_NOT_RESOLVED"); }
    else if (refC.length) { status = "REFUTED"; reasons.push("OWNER_CONFIRMED_REFUTING_EVIDENCE"); }
    else if (ref.length) { status = "REFUTATION_CLAIMED"; reasons.push("REFUTING_QUOTE_MATCHED_AWAITING_OWNER_CONFIRMATION"); }
    else if (supC.length) { status = "VERIFIED"; }
    else if (sup.length) { status = "QUOTE_MATCHED"; reasons.push("QUOTE_MATCHES_LEXICALLY_NOT_SEMANTICALLY_VERIFIED_AWAITING_OWNER_CONFIRMATION"); }
    else if (!ev.length) { status = "UNSUPPORTED"; reasons.push("NO_EVIDENCE"); }
    else if (ev.some(e => e.verification === "STALE_SOURCE" || e.aged)) { status = "OUTDATED"; reasons.push(...[...new Set(ev.filter(e => e.verification === "STALE_SOURCE" || e.aged).map(e => e.verification === "STALE_SOURCE" ? "SOURCE_CHANGED_OR_SUPERSEDED" : "RETRIEVED_MORE_THAN_" + freshnessDays + "_DAYS_AGO"))]); }
    else { status = "UNVERIFIABLE"; reasons.push(...[...new Set(ev.map(e => e.verification))]); }
    // A finding built on sources this caller cannot read must not leak their content through the claim text either.
    const redact = who(w).role !== "OWNER" && ev.some(e => e.verification === "SOURCE_UNAVAILABLE"); if (redact) { base.claim = "[withheld: finding rests on a source this role cannot read]"; reasons.push("CLAIM_REDACTED_FOR_ROLE"); }
    const distinct = new Set(supC.map(e => e.memberId)).size;
    const confidence = status === "VERIFIED" ? (distinct >= 2 ? "HIGH" : "MEDIUM") : status === "CONFLICTED" || status === "QUOTE_MATCHED" ? "LOW" : "NONE";
    return { ...base, status, confidence, independentSources: distinct, reasons, evidence: ev, note: "Status is recomputed from the current sources on every read. Confidence = independent verified sources + freshness, not proof of truth. A quotation match is lexical (all claim numbers present, same polarity, term overlap), NOT semantic verification: only an owner-confirmed evidence item makes a finding VERIFIED." };
  }
  /** Structured report: facts only from VERIFIED findings; every other class is listed separately. */
  function report(qid, w) {
    reload(); const q = question(qid, w), fs = Object.values(S.findings).filter(f => f.questionId === qid && f.tenantId === w.tenantId).map(f => evaluate(f, w)), by = s => fs.filter(f => f.status === s);
    const contradictions = Object.values(S.contradictions).filter(k => k.questionId === qid).map(k => structuredClone(k));
    const state = by("VERIFIED").length && !by("CONFLICTED").length ? "ANSWERED" : by("CONFLICTED").length ? "CONTESTED" : "UNRESOLVED";
    return { question: { id: q.id, text: q.text, projectId: q.projectId, createdAt: q.createdAt }, state, verifiedFacts: by("VERIFIED"), conflicted: by("CONFLICTED"), refuted: by("REFUTED"), quoteMatched: by("QUOTE_MATCHED"), refutationClaimed: by("REFUTATION_CLAIMED"), outdated: by("OUTDATED"), unverifiable: by("UNVERIFIABLE"),
      unsupported: by("UNSUPPORTED"), assumptions: by("ASSUMPTION"), rejected: by("REJECTED"), contradictions, asOf: now(),
      note: state === "ANSWERED" ? "Answered only by findings whose evidence verifies against the current sources AND was confirmed by the owner (a quotation match alone is not verification)." : "Not answered: no verified, uncontested finding. Unsupported claims and assumptions are NOT facts." };
  }
  const unresolved = (w, { projectId = null } = {}) => { reload(); return Object.values(S.questions).filter(q => q.tenantId === w?.tenantId && (!projectId || q.projectId === projectId)).filter(q => { try { access(q.projectId, w); return true; } catch { return false; } })
    .map(q => { const r = report(q.id, w); return { id: q.id, text: q.text, projectId: q.projectId, state: r.state, counts: { verified: r.verifiedFacts.length, conflicted: r.conflicted.length, unsupported: r.unsupported.length, assumptions: r.assumptions.length, outdated: r.outdated.length, quoteMatched: r.quoteMatched.length } }; }).filter(x => x.state !== "ANSWERED"); };
  function list(w, { projectId = null } = {}) { reload(); return Object.values(S.questions).filter(q => q.tenantId === w?.tenantId && (!projectId || q.projectId === projectId)).filter(q => { try { access(q.projectId, w); return true; } catch { return false; } }).map(q => ({ id: q.id, text: q.text, projectId: q.projectId, createdBy: q.createdBy, createdAt: q.createdAt })); }
  function summary(w) { const l = list(w), u = unresolved(w); return { questions: l.length, unresolved: u.length, answered: l.length - u.length, events: S.events.length, chain: verifyChain(), method: "EXTRACTIVE_CITATIONS_OVER_KEYWORD_RETRIEVAL" }; }
  const events = (w, { limit = 100 } = {}) => { reload(); if (who(w).forAgent) throw new Error("OWNER_ONLY"); return S.events.slice(-Math.min(limit, 500)).map(e => structuredClone(e)); };
  return { openQuestion, addSource, addFinding, attachEvidence, declareContradiction, resolveContradiction, confirmEvidence, report, unresolved, list, summary, events, verifyChain: () => (reload(), verifyChain()) };
}
