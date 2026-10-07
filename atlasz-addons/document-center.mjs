// V7.3 §Document Center / Document Intelligence: durable document registry with safe, honest text extraction.
// Supported extraction: .txt .md .csv .tsv .json .html .xml .log (plain parsing). PDF/DOCX/XLSX/images are registered but
// marked UNSUPPORTED_FORMAT until an extractor adapter is injected. Files are copied, never executed. Secrets found -> SECRET class, hidden from search snippets.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const CLASSIFICATIONS = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL", "SECRET"]);
export const DOC_TYPES = Object.freeze(["GENERIC", "INVOICE", "RECEIPT", "CONTRACT", "JOB_DOCUMENT", "RESEARCH", "SPREADSHEET", "RECORD"]);
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".log"]);
const BINARY_KNOWN = new Set([".pdf", ".docx", ".xlsx", ".xls", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".zip"]);
const MAX_BYTES = 5 * 1024 * 1024;
const SECRET = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bghp_[A-Za-z0-9]{30,}/, /\bxox[bp]-[A-Za-z0-9-]{20,}/];
const sha = b => createHash("sha256").update(b).digest("hex");
const tokens = s => [...new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 2))];

export function stripHtml(h) { return h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
/** Amount candidates are UNVERIFIED hints for a human/QA; they never become revenue/cost on their own. */
export function candidateAmounts(text) { return [...text.matchAll(/(?:total|amount|sum|due|összesen|végösszeg)\D{0,15}\$?\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?)/gi)].slice(0, 5).map(m => ({ raw: m[0].trim().slice(0, 60), value: Number(m[1].replace(/[ ,]/g, "")), status: "UNVERIFIED_CANDIDATE" })); }

export function createDocumentCenter({ dir, extractors = {}, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DIR_REQUIRED");
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const indexFile = path.join(dir, "index.json");
  let docs = {}; if (fs.existsSync(indexFile)) docs = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const save = () => { const t = indexFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(docs)); fs.renameSync(t, indexFile); };
  const roleOk = (d, role) => d.allowedRoles.includes("*") || d.allowedRoles.includes(role);
  const pub = d => ({ id: d.id, name: d.name, ext: d.ext, size: d.size, sha256: d.sha256, type: d.type, classification: d.classification, tenantId: d.tenantId, entity: d.entity, jobId: d.jobId, evidenceRefs: d.evidenceRefs,
    extraction: d.extraction, ingestedAt: d.ingestedAt, hints: d.hints });

  async function ingest({ filePath, name = null, tenantId = "JOCI", entity = "ATLASZ_EXTERNAL", type = "GENERIC", classification = "CONFIDENTIAL", allowedRoles = ["OWNER"], jobId = null, evidenceRefs = [] } = {}) {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error("FILE_NOT_FOUND");
    if (!DOC_TYPES.includes(type)) throw new Error("BAD_DOC_TYPE"); if (!CLASSIFICATIONS.includes(classification)) throw new Error("BAD_CLASSIFICATION");
    const st = fs.statSync(filePath); if (st.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
    const buf = fs.readFileSync(filePath), ext = path.extname(name ?? filePath).toLowerCase(), hash = sha(buf);
    const dup = Object.values(docs).find(d => d.sha256 === hash && d.tenantId === tenantId); if (dup) return { ...pub(dup), duplicate: true };
    const id = randomUUID(), stored = path.join(dir, "files", id + (BINARY_KNOWN.has(ext) || TEXT_EXT.has(ext) ? ext : ".bin"));
    fs.writeFileSync(stored, buf, { mode: 0o600 });
    let text = null, extraction;
    if (TEXT_EXT.has(ext)) {
      const raw = buf.toString("utf8"); text = ext === ".html" || ext === ".htm" || ext === ".xml" ? stripHtml(raw) : raw;
      if (ext === ".json") { try { JSON.parse(raw); } catch { extraction = { status: "PARSE_ERROR", note: "Invalid JSON; stored as raw text" }; } }
      extraction ??= { status: "EXTRACTED", method: "PLAIN_TEXT", chars: text.length };
    } else if (typeof extractors[ext] === "function") {
      try { text = String(await extractors[ext](stored)); extraction = { status: "EXTRACTED", method: "ADAPTER:" + ext, chars: text.length }; } catch (e) { extraction = { status: "EXTRACTOR_FAILED", note: String(e.message).slice(0, 120) }; }
    } else extraction = { status: "UNSUPPORTED_FORMAT", note: (BINARY_KNOWN.has(ext) ? ext : "unknown") + " needs an extractor adapter; not pretending to read it" };
    let cls = classification;
    if (text && SECRET.some(r => r.test(text))) cls = "SECRET";
    const d = { id, name: path.basename(name ?? filePath), ext, size: st.size, sha256: hash, type, classification: cls, tenantId, entity, jobId, evidenceRefs: [...evidenceRefs], allowedRoles: cls === "SECRET" ? ["OWNER"] : allowedRoles,
      stored, extraction, tokens: text ? tokens(text) : [], textFile: null, ingestedAt: now(), hints: text && ["INVOICE", "RECEIPT", "CONTRACT"].includes(type) ? { amounts: candidateAmounts(text), note: "Hints are unverified" } : null };
    if (text) { d.textFile = path.join(dir, "files", id + ".txt"); fs.writeFileSync(d.textFile, text, { mode: 0o600 }); }
    docs[id] = d; save(); return { ...pub(d), secretDetected: cls === "SECRET" && classification !== "SECRET" };
  }
  function list({ tenantId, role = "OWNER", jobId = null, type = null } = {}) { return Object.values(docs).filter(d => d.tenantId === tenantId && roleOk(d, role) && (!jobId || d.jobId === jobId) && (!type || d.type === type)).map(pub); }
  function search({ query, tenantId, role = "OWNER", limit = 10 } = {}) {
    if (!query || !tenantId) throw new Error("QUERY_TENANT_REQUIRED");
    const q = tokens(query);
    return Object.values(docs).filter(d => d.tenantId === tenantId && roleOk(d, role)).map(d => ({ d, hit: q.filter(t => d.tokens.includes(t)).length })).filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, limit)
      .map(({ d, hit }) => { let snippet = null; if (d.classification !== "SECRET" && d.textFile) { const txt = fs.readFileSync(d.textFile, "utf8"), i = txt.toLowerCase().indexOf(q.find(t => d.tokens.includes(t))); snippet = txt.slice(Math.max(0, i - 40), i + 120).replace(/\s+/g, " "); }
        return { ...pub(d), score: hit / q.length, snippet: snippet ?? (d.classification === "SECRET" ? "[hidden: SECRET]" : null) }; });
  }
  function get(id, { tenantId, role = "OWNER" } = {}) { const d = docs[id]; if (!d || d.tenantId !== tenantId || !roleOk(d, role)) return null; return { ...pub(d), text: d.textFile && d.classification !== "SECRET" ? fs.readFileSync(d.textFile, "utf8") : null }; }
  function associate(id, { tenantId, jobId = undefined, evidenceRef = undefined } = {}) {
    const d = docs[id]; if (!d || d.tenantId !== tenantId) throw new Error("UNKNOWN_DOCUMENT");
    if (jobId !== undefined) d.jobId = jobId; if (evidenceRef) d.evidenceRefs = [...new Set([...d.evidenceRefs, evidenceRef])]; save(); return pub(d);
  }
  const summary = () => { const all = Object.values(docs); return { total: all.length, byType: Object.fromEntries(DOC_TYPES.map(t => [t, all.filter(d => d.type === t).length])), unsupported: all.filter(d => d.extraction.status === "UNSUPPORTED_FORMAT").length, secret: all.filter(d => d.classification === "SECRET").length }; };
  return { ingest, list, search, get, associate, summary };
}
