// Knowledge Projects (85-capability audit: M02, G07, GE09, GE01, P03, C07, C11). Named workspaces over the Document Center (+ owner notes and web snapshots)
// with source-traceable retrieval and EXTRACTIVE, cited answers.
//
// Honest scope: retrieval is keyword/BM25-style over chunks - NOT semantic (no embedding provider exists). An answer is only ever passages copied from sources,
// each with a citation {item, version, sha256, start, end, quote}; if the sources do not cover the question the answer is "NO_SUPPORTING_EVIDENCE", never a guess.
// Permissions are enforced at READ time through the Document Center (tenant, role, SECRET hiding, and - for agents/models - Security-Brain ALLOW only), so
// the project never keeps a copy of text a caller was not allowed to see. Web snapshots and notes are untrusted input and are screened on the way in.
import { createStore } from "./business/store.mjs";
import crypto from "node:crypto";

export const KINDS = Object.freeze(["document", "note", "webpage"]);
const STOP = new Set("a an the and or of to in on at for from by with is are was were be been it this that these those as not no do does did i you we they he she them his her our your their what which who whom how when where why can could should would will shall may might must has have had if then than so such into over under about up down out off per via".split(" "));
export const LIMITS = Object.freeze({ chunkChars: 800, overlapChars: 120, noteChars: 200000, maxMembers: 500, maxPassages: 5, quoteChars: 240 });
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
export const terms = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(w => w.length > 1 && !STOP.has(w));
/** Fixed-size chunks with overlap, preferring to end on whitespace; offsets refer to the ORIGINAL text so a citation can be re-checked exactly. */
export function chunk(text, size = LIMITS.chunkChars, overlap = LIMITS.overlapChars) {
  const out = []; let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) { const ws = text.lastIndexOf(" ", end); if (ws > i + size / 2) end = ws; }
    out.push({ start: i, end, text: text.slice(i, end) }); if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

export function createKnowledgeProjects({ file = null, documents, security = null, blackBox = null, now = () => new Date().toISOString() } = {}) {
  if (!documents || typeof documents.get !== "function") throw new Error("DOCUMENT_CENTER_REQUIRED");
  const store = createStore({ file, init: () => ({ projects: {}, seq: 0 }) }), S = store.data;      // unreadable file => STORE_UNREADABLE, never replaced
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  const proj = (id, tenantId) => { const p = S.projects[id]; return p && p.tenantId === tenantId ? p : null; };
  const roleOk = (p, role) => role === "OWNER" || (p.allowedRoles ?? ["OWNER"]).includes(role);
  const pubMember = m => ({ id: m.id, kind: m.kind, title: m.title, ref: m.ref ?? null, addedAt: m.addedAt, screening: m.screening?.decision ?? null, classification: m.classification ?? null });

  function create({ tenantId, name, description = "", allowedRoles = ["OWNER"] } = {}) {
    if (!tenantId) throw new Error("TENANT_REQUIRED"); if (!String(name ?? "").trim()) throw new Error("NAME_REQUIRED");
    if (!Array.isArray(allowedRoles) || !allowedRoles.includes("OWNER")) throw new Error("OWNER_ROLE_REQUIRED");
    const id = "kp-" + (++S.seq) + "-" + crypto.randomBytes(3).toString("hex");
    S.projects[id] = { id, tenantId, name: String(name).slice(0, 120), description: String(description).slice(0, 500), allowedRoles, createdAt: now(), members: [] };
    store.save(); log("KP_CREATED", { id }); return { id, name: S.projects[id].name };
  }
  const list = ({ tenantId, role = "OWNER" } = {}) => Object.values(S.projects).filter(p => p.tenantId === tenantId && roleOk(p, role)).map(p => ({ id: p.id, name: p.name, members: p.members.length, createdAt: p.createdAt }));

  function addMember(p, m) { if (p.members.length >= LIMITS.maxMembers) throw new Error("PROJECT_FULL"); p.members.push(m); store.save(); log("KP_MEMBER_ADDED", { project: p.id, kind: m.kind, id: m.id }); return pubMember(m); }
  /** Link an existing Document Center document. It must exist in the SAME tenant; the project stores only the reference. */
  function addDocument(projectId, { tenantId, documentId } = {}) {
    const p = proj(projectId, tenantId); if (!p) throw new Error("UNKNOWN_PROJECT");
    const d = documents.get(documentId, { tenantId, role: "OWNER" }); if (!d) throw new Error("UNKNOWN_DOCUMENT");
    if (p.members.some(m => m.kind === "document" && m.ref === documentId)) throw new Error("ALREADY_A_MEMBER");
    return addMember(p, { id: "m-" + crypto.randomBytes(4).toString("hex"), kind: "document", ref: documentId, title: d.name, addedAt: now() });
  }
  function screen(text, source) {
    if (!security) return { decision: "NOT_SCREENED", reasons: ["NO_SECURITY_BRAIN_ATTACHED"] };
    const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source, text }); return { decision: a.decision, reasons: a.reasons ?? [], allowed: a.allowed };
  }
  function addText(projectId, { tenantId, kind, title, text, url = null, retrievedAt = null, createdBy = "OWNER" }) {
    const p = proj(projectId, tenantId); if (!p) throw new Error("UNKNOWN_PROJECT");
    if (!String(title ?? "").trim()) throw new Error("TITLE_REQUIRED"); if (typeof text !== "string" || !text.trim()) throw new Error("TEXT_REQUIRED"); if (text.length > LIMITS.noteChars) throw new Error("TEXT_TOO_LONG");
    const sc = screen(text, kind + ":" + title), blocked = sc.allowed === false;
    const secret = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}/.test(text);   // detected before screening can withhold the text
    return addMember(p, { id: "m-" + crypto.randomBytes(4).toString("hex"), kind, title: String(title).slice(0, 160), url, retrievedAt, createdBy, addedAt: now(), classification: secret ? "SECRET" : "PERSONAL",
      screening: { decision: sc.decision, reasons: sc.reasons }, text: blocked || secret ? null : text, sha256: sha(text), withheld: blocked ? "QUARANTINED" : secret ? "SECRET" : null });
  }
  const addNote = (projectId, o = {}) => addText(projectId, { ...o, kind: "note" });
  /** A web page the owner/an authorised fetcher already retrieved. The snapshot (with URL, time and hash) is what citations point at - the live page may change. */
  function addWebSnapshot(projectId, o = {}) {
    if (!/^https?:\/\//i.test(String(o.url ?? ""))) throw new Error("URL_REQUIRED"); if (!Number.isFinite(Date.parse(o.retrievedAt))) throw new Error("RETRIEVED_AT_REQUIRED");
    return addText(projectId, { ...o, kind: "webpage", title: o.title ?? o.url });
  }
  function removeMember(projectId, { tenantId, memberId } = {}) { const p = proj(projectId, tenantId); if (!p) throw new Error("UNKNOWN_PROJECT"); const n = p.members.length; p.members = p.members.filter(m => m.id !== memberId); if (p.members.length === n) throw new Error("UNKNOWN_MEMBER"); store.save(); log("KP_MEMBER_REMOVED", { project: projectId, id: memberId }); return true; }

  /** Text of one member THROUGH the caller's permissions. Returns {text, version, sha256, stale?, latestId?} or {withheld:reason}. */
  function readMember(m, { tenantId, role, forAgent }) {
    if (m.kind === "document") {
      const d = documents.get(m.ref, { tenantId, role, forAgent }); if (!d) return { withheld: "NOT_PERMITTED_OR_MISSING" };
      if (d.text == null) return { withheld: d.withheldFromAgent ?? (d.classification === "SECRET" ? "SECRET" : d.extraction?.status ?? "NO_TEXT") };
      return { text: d.text, version: d.version, sha256: d.sha256, stale: Boolean(d.supersededBy), latestId: d.supersededBy ?? null, title: d.name };
    }
    if (m.withheld) return { withheld: m.withheld };
    if (forAgent && m.screening?.decision !== "ALLOW") return { withheld: "NOT_SCREENED_ALLOW" };
    return { text: m.text, version: 1, sha256: m.sha256, stale: false, title: m.title };
  }
  function corpus(p, ctx) {
    const chunks = [], withheld = [];
    for (const m of p.members) {
      const r = readMember(m, ctx); if (r.withheld) { withheld.push({ member: m.id, title: m.title, reason: r.withheld }); continue; }
      if (r.stale) { withheld.push({ member: m.id, title: m.title, reason: "SUPERSEDED_BY:" + r.latestId }); continue; }       // old versions are not searched; the member is flagged, never silently dropped
      for (const c of chunk(r.text)) chunks.push({ memberId: m.id, kind: m.kind, title: r.title ?? m.title, version: r.version, sha256: r.sha256, url: m.url ?? null, ...c, tokens: terms(c.text) });
    }
    return { chunks, withheld };
  }
  function rank(chunks, q) {
    const N = chunks.length || 1, df = new Map(); for (const t of new Set(q)) df.set(t, chunks.filter(c => c.tokens.includes(t)).length);
    const avg = chunks.reduce((a, c) => a + c.tokens.length, 0) / N || 1;
    return chunks.map(c => { let s = 0; for (const t of new Set(q)) { const f = c.tokens.filter(x => x === t).length; if (!f) continue; const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.tokens.length / avg)); } return { c, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  }
  const cite = (projectId, c, q) => { const body = c.text.toLowerCase(), hit = [...new Set(q)].map(t => body.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0, from = Math.max(0, hit - 60), quote = c.text.slice(from, from + LIMITS.quoteChars);
    return { projectId, memberId: c.memberId, kind: c.kind, title: c.title, version: c.version, sha256: c.sha256, url: c.url, start: c.start + from, end: c.start + from + quote.length, quote }; };

  function ctxOf(projectId, { tenantId, role = "OWNER", forAgent = false }) { const p = proj(projectId, tenantId); if (!p) throw new Error("UNKNOWN_PROJECT"); if (!roleOk(p, role)) throw new Error("ROLE_NOT_PERMITTED"); return { p, ctx: { tenantId, role, forAgent } }; }
  function search(projectId, { query, limit = 10, ...who } = {}) {
    const { p, ctx } = ctxOf(projectId, who), q = terms(query ?? ""); if (!q.length) throw new Error("QUERY_REQUIRED");
    const { chunks, withheld } = corpus(p, ctx), hits = rank(chunks, q).slice(0, Math.min(limit, 50));
    return { method: "KEYWORD_BM25_NOT_SEMANTIC", results: hits.map(({ c, s }) => ({ score: Number(s.toFixed(3)), citation: cite(projectId, c, q), text: c.text })), withheld };
  }
  /** Extractive answer: passages copied from sources with citations. If the sources do not cover the question terms, say so. */
  function answer(projectId, { query, ...who } = {}) {
    const { p, ctx } = ctxOf(projectId, who), q = [...new Set(terms(query ?? ""))]; if (!q.length) throw new Error("QUERY_REQUIRED");
    const { chunks, withheld } = corpus(p, ctx), top = rank(chunks, q).slice(0, LIMITS.maxPassages).map(x => x.c);
    const covered = q.filter(t => top.some(c => c.tokens.includes(t))), coverage = covered.length / q.length;
    if (!top.length || coverage < 0.5) return { answerable: false, reason: "NO_SUPPORTING_EVIDENCE", coverage: Number(coverage.toFixed(2)), missingTerms: q.filter(t => !covered.includes(t)), withheld, method: "EXTRACTIVE_KEYWORD" };
    const conf = coverage >= 0.9 ? "HIGH" : coverage >= 0.7 ? "MEDIUM" : "LOW";
    log("KP_ANSWER", { project: projectId, passages: top.length, coverage });
    return { answerable: true, confidence: conf, coverage: Number(coverage.toFixed(2)), missingTerms: q.filter(t => !covered.includes(t)), passages: top.map(c => ({ text: c.text, citation: cite(projectId, c, q) })), withheld,
      method: "EXTRACTIVE_KEYWORD", note: "Passages are copied from the cited sources. This is keyword retrieval, not semantic understanding; confidence reflects question-term coverage, not truth." };
  }
  /** Re-check a citation against the CURRENT source through the caller's permissions: OK | STALE_SOURCE | QUOTE_MISMATCH | SOURCE_UNAVAILABLE. */
  function verifyCitation(citation, who = {}) {
    let p; try { ({ p } = ctxOf(citation?.projectId, who)); } catch (e) { return { status: "SOURCE_UNAVAILABLE", reason: e.message }; }
    const m = p.members.find(x => x.id === citation.memberId); if (!m) return { status: "SOURCE_UNAVAILABLE", reason: "MEMBER_REMOVED" };
    const r = readMember(m, { tenantId: who.tenantId, role: who.role ?? "OWNER", forAgent: who.forAgent ?? false }); if (r.withheld) return { status: "SOURCE_UNAVAILABLE", reason: r.withheld };
    if (r.stale) return { status: "STALE_SOURCE", reason: "SUPERSEDED_BY_NEWER_VERSION", currentVersion: r.version, latestId: r.latestId };
    if (r.sha256 !== citation.sha256) return { status: "STALE_SOURCE", reason: "SOURCE_CHANGED_SINCE_CITED", currentVersion: r.version, latestId: r.latestId ?? null };
    return r.text.slice(citation.start, citation.end) === citation.quote ? { status: "OK" } : { status: "QUOTE_MISMATCH" };
  }
  function summary(projectId, who = {}) {
    const { p, ctx } = ctxOf(projectId, who), { chunks, withheld } = corpus(p, ctx);
    return { id: p.id, name: p.name, members: p.members.map(pubMember), searchableChunks: chunks.length, withheld, byKind: Object.fromEntries(KINDS.map(k => [k, p.members.filter(m => m.kind === k).length])) };
  }
  return { create, list, addDocument, addNote, addWebSnapshot, removeMember, search, answer, verifyCitation, summary };
}
