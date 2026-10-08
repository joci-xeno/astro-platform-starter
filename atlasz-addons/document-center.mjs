// V7.3 §Document Center / Document Intelligence: durable document registry with safe, honest text extraction.
// Built-in zero-dependency extractors (doc-extractors.mjs): .docx .xlsx .pptx .odt .ods .odp .rtf .pdf(text layer). Images and scanned/encrypted PDFs stay honest (not read).
// Every extracted text is SCREENED by the Security Brain before it is searchable or agent-readable; a hostile document is quarantined (text withheld). Versions are kept, never overwritten.
// Supported extraction: .txt .md .csv .tsv .json .html .xml .log (plain parsing). PDF/DOCX/XLSX/images are registered but
// marked UNSUPPORTED_FORMAT until an extractor adapter is injected. Files are copied, never executed. Secrets found -> SECRET class, hidden from search snippets.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { extractBuffer, EXTRACTORS } from "./doc-extractors.mjs";

export const CLASSIFICATIONS = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL", "SECRET"]);
export const DOC_TYPES = Object.freeze(["GENERIC", "INVOICE", "RECEIPT", "CONTRACT", "JOB_DOCUMENT", "RESEARCH", "SPREADSHEET", "RECORD"]);
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".log"]);
const BINARY_KNOWN = new Set([".pdf", ".docx", ".xlsx", ".xls", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".zip"]);
const MAX_BYTES = 5 * 1024 * 1024;
const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}/, /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b/, /(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}/, /(?<![A-Za-z0-9])xox[bp]-[A-Za-z0-9-]{20,}/];
const sha = b => createHash("sha256").update(b).digest("hex");
const tokens = s => [...new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 2))];

export function stripHtml(h) { return h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
/** Amount candidates are UNVERIFIED hints for a human/QA; they never become revenue/cost on their own. */
export function candidateAmounts(text) { return [...text.matchAll(/(?:total|amount|sum|due|összesen|végösszeg)\D{0,15}\$?\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?)/gi)].slice(0, 5).map(m => ({ raw: m[0].trim().slice(0, 60), value: Number(m[1].replace(/[ ,]/g, "")), status: "UNVERIFIED_CANDIDATE" })); }

export function createDocumentCenter({ dir, extractors = {}, media = null, security = null, graph = null, tenantGraphId = null, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED");
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const indexFile = path.join(dir, "index.json");
  let docs = {}; if (fs.existsSync(indexFile)) { try { docs = JSON.parse(fs.readFileSync(indexFile, "utf8")); } catch { throw new Error("DOCUMENT_INDEX_UNREADABLE"); } }       // never silently start empty over a corrupt index
  const save = () => { const t = indexFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(docs)); fs.renameSync(t, indexFile); };
  const roleOk = (d, role) => d.allowedRoles.includes("*") || d.allowedRoles.includes(role);
  const pub = d => ({ id: d.id, name: d.name, ext: d.ext, size: d.size, sha256: d.sha256, type: d.type, classification: d.classification, tenantId: d.tenantId, entity: d.entity, jobId: d.jobId, evidenceRefs: d.evidenceRefs,
    extraction: d.extraction, ingestedAt: d.ingestedAt, hints: d.hints, version: d.version ?? 1, previousId: d.previousId ?? null, supersededBy: d.supersededBy ?? null, screening: d.screening ?? { decision: "NOT_SCREENED" }, links: d.links ?? [] });

  async function ingest({ filePath, name = null, tenantId = "JOCI", entity = "ATLASZ_EXTERNAL", type = "GENERIC", classification = "CONFIDENTIAL", allowedRoles = ["OWNER"], jobId = null, evidenceRefs = [], links = [] } = {}) {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error("FILE_NOT_FOUND");
    if (!DOC_TYPES.includes(type)) throw new Error("BAD_DOC_TYPE"); if (!CLASSIFICATIONS.includes(classification)) throw new Error("BAD_CLASSIFICATION");
    const st = fs.statSync(filePath); if (st.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
    const buf = fs.readFileSync(filePath), ext = path.extname(name ?? filePath).toLowerCase(), hash = sha(buf);
    const dup = Object.values(docs).find(d => d.sha256 === hash && d.tenantId === tenantId); if (dup) return { ...pub(dup), duplicate: true };
    const base = path.basename(name ?? filePath), prev = Object.values(docs).filter(d => d.tenantId === tenantId && d.name === base && !d.supersededBy).sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0] ?? null;
    const id = randomUUID(), stored = path.join(dir, "files", id + (BINARY_KNOWN.has(ext) || TEXT_EXT.has(ext) ? ext : ".bin"));
    fs.writeFileSync(stored, buf, { mode: 0o600 });
    let text = null, extraction;
    if (TEXT_EXT.has(ext)) {
      const raw = buf.toString("utf8"); text = ext === ".html" || ext === ".htm" || ext === ".xml" ? stripHtml(raw) : raw;
      if (ext === ".json") { try { JSON.parse(raw); } catch { extraction = { status: "PARSE_ERROR", note: "Invalid JSON; stored as raw text" }; } }
      extraction ??= { status: "EXTRACTED", method: "PLAIN_TEXT", chars: text.length };
    } else if (typeof extractors[ext] !== "function" && EXTRACTORS[ext]) {
      const r = extractBuffer(buf, ext);
      if (r.ok) { text = r.text; extraction = { status: "EXTRACTED", method: "BUILTIN:" + ext, chars: text.length, truncated: r.truncated, meta: r.meta }; }
      else extraction = { status: r.code === "PDF_NO_TEXT_LAYER" ? "NO_TEXT_LAYER" : "EXTRACTOR_FAILED", code: r.code, note: r.note };
    } else if (typeof extractors[ext] === "function") {
      try { text = String(await extractors[ext](stored)); extraction = { status: "EXTRACTED", method: "ADAPTER:" + ext, chars: text.length }; } catch (e) { extraction = { status: "EXTRACTOR_FAILED", note: String(e.message).slice(0, 120) }; }
    } else {
      // Media fabric (images/audio/video): built-in metadata only. There is NO text, so nothing becomes searchable and no content is claimed; OCR/STT/vision are external providers.
      const md = media && typeof media.describe === "function" ? media.describe(buf, { name: base }) : null;
      extraction = md && md.status === "OK" && ["image", "audio", "video"].includes(md.kind) ? { status: "METADATA_ONLY", method: "MEDIA_FABRIC", meta: { format: md.format, kind: md.kind, ...md.metadata, privacy: md.privacy, ...(md.extensionMismatch ? { extensionMismatch: true } : {}) }, note: "Built-in metadata only. Content understanding (OCR / speech-to-text / vision) needs an external provider that is not connected." }
        : { status: "UNSUPPORTED_FORMAT", note: (BINARY_KNOWN.has(ext) ? ext : "unknown") + " needs an extractor adapter; not pretending to read it" };
    }
    // untrusted until screened: the Security Brain looks at the extracted text BEFORE it becomes searchable or readable by an agent
    const hasSecret = !!(text && SECRET.some(r => r.test(text))); // detected on the raw extraction, before screening can withhold the text
    let screening = { decision: "NOT_SCREENED", reasons: ["NO_SECURITY_BRAIN_ATTACHED"] };
    if (text && security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "document:" + base, text }); screening = { decision: a.decision, reasons: a.reasons ?? [] }; if (!a.allowed) { text = null; extraction = { status: "QUARANTINED", note: "Security Brain withheld the text: " + (a.reasons ?? []).join(",") }; } }
    else if (!text) screening = { decision: "NOTHING_TO_SCREEN", reasons: [] };
    let cls = classification;
    if (hasSecret) cls = "SECRET";
    const d = { id, name: path.basename(name ?? filePath), ext, size: st.size, sha256: hash, type, classification: cls, tenantId, entity, jobId, evidenceRefs: [...evidenceRefs], allowedRoles: cls === "SECRET" ? ["OWNER"] : allowedRoles,
      stored, extraction, screening, version: prev ? (prev.version ?? 1) + 1 : 1, previousId: prev?.id ?? null, supersededBy: null, links: [], tokens: text ? tokens(text) : [], textFile: null, ingestedAt: now(), hints: text && ["INVOICE", "RECEIPT", "CONTRACT"].includes(type) ? { amounts: candidateAmounts(text), note: "Hints are unverified" } : null };
    if (text) { d.textFile = path.join(dir, "files", id + ".txt"); fs.writeFileSync(d.textFile, text, { mode: 0o600 }); }
    if (prev) prev.supersededBy = id;
    docs[id] = d;
    // entity linking: the document becomes a node in the Entity Graph, linked to its job and to any explicit targets (never to another tenant)
    const wanted = [...(jobId ? [{ type: "job", id: jobId, relation: "DOCUMENTS" }] : []), ...links];
    if (graph && wanted.length) for (const l of wanted) { try { graph.upsertEntity({ tenantId: tenantGraphId ?? tenantId, type: "document", id, attributes: { name: base, version: d.version, sha256: hash }, source: "document-center" }); graph.linkEntities({ tenantId: tenantGraphId ?? tenantId, fromType: "document", fromId: id, toType: l.type, toId: l.id, relation: l.relation ?? "DOCUMENTS", evidence: "sha256:" + hash }); d.links.push({ type: l.type, id: l.id, relation: l.relation ?? "DOCUMENTS" }); } catch (e) { d.links.push({ type: l.type, id: l.id, error: String(e.message).slice(0, 80) }); } }
    save(); return { ...pub(d), secretDetected: cls === "SECRET" && classification !== "SECRET" };
  }
  function list({ tenantId, role = "OWNER", jobId = null, type = null, includeSuperseded = false } = {}) { return Object.values(docs).filter(d => d.tenantId === tenantId && roleOk(d, role) && (includeSuperseded || !d.supersededBy) && (!jobId || d.jobId === jobId) && (!type || d.type === type)).map(pub); }
  const versions = (id, { tenantId, role = "OWNER" } = {}) => { let d = docs[id]; if (!d || d.tenantId !== tenantId || !roleOk(d, role)) return []; while (d.previousId && docs[d.previousId]) d = docs[d.previousId]; const out = []; while (d) { out.push(pub(d)); d = d.supersededBy ? docs[d.supersededBy] : null; } return out; };
  function search({ query, tenantId, role = "OWNER", limit = 10 } = {}) {
    if (!query || !tenantId) throw new Error("QUERY_TENANT_REQUIRED");
    const q = tokens(query);
    return Object.values(docs).filter(d => d.tenantId === tenantId && roleOk(d, role) && !d.supersededBy).map(d => ({ d, hit: q.filter(t => d.tokens.includes(t)).length })).filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, limit)
      .map(({ d, hit }) => { let snippet = null; if (d.classification !== "SECRET" && d.textFile) { const txt = fs.readFileSync(d.textFile, "utf8"), i = txt.toLowerCase().indexOf(q.find(t => d.tokens.includes(t))); snippet = txt.slice(Math.max(0, i - 40), i + 120).replace(/\s+/g, " "); }
        return { ...pub(d), score: hit / q.length, snippet: snippet ?? (d.classification === "SECRET" ? "[hidden: SECRET]" : null) }; });
  }
  /** Raw bytes of a stored file, for built-in analysis only. Same gates as get(): tenant, role, never SECRET. For agents the file must not be SECRET and must be role-visible (metadata analysis discloses no content). */
  function readBytes(id, { tenantId, role = "OWNER" } = {}) { const d = docs[id]; if (!d || d.tenantId !== tenantId || !roleOk(d, role) || d.classification === "SECRET" || !d.stored) return null; try { return fs.readFileSync(d.stored); } catch { return null; } }
  /** forAgent:true is the read path for agents/models: the text is returned only when the Security Brain screened it ALLOW. The owner view (default) can read any non-SECRET stored text. */
  function get(id, { tenantId, role = "OWNER", forAgent = false } = {}) { const d = docs[id]; if (!d || d.tenantId !== tenantId || !roleOk(d, role)) return null; const screened = !forAgent || d.screening?.decision === "ALLOW"; return { ...pub(d), text: d.textFile && d.classification !== "SECRET" && screened ? fs.readFileSync(d.textFile, "utf8") : null, withheldFromAgent: forAgent && !screened ? "NOT_SCREENED_ALLOW" : null }; }
  function associate(id, { tenantId, jobId = undefined, evidenceRef = undefined } = {}) {
    const d = docs[id]; if (!d || d.tenantId !== tenantId) throw new Error("UNKNOWN_DOCUMENT");
    if (jobId !== undefined) d.jobId = jobId; if (evidenceRef) d.evidenceRefs = [...new Set([...d.evidenceRefs, evidenceRef])]; save(); return pub(d);
  }
  const summary = () => { const all = Object.values(docs); return { total: all.length, byType: Object.fromEntries(DOC_TYPES.map(t => [t, all.filter(d => d.type === t).length])), unsupported: all.filter(d => d.extraction.status === "UNSUPPORTED_FORMAT").length, secret: all.filter(d => d.classification === "SECRET").length }; };
  return { ingest, list, search, get, versions, associate, summary, readBytes };
}
