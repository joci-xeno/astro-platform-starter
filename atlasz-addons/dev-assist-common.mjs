// Shared, deterministic building blocks for the W2 developer-assist engines (test-intelligence, architecture-assessor, doc-sync, data-quality, migration-planner).
// What this is: a READ-ONLY folder walk (re-uses repo-analyzer walkRepo: lstat everywhere, symlinks/special/hidden/vendored skipped, hard caps), a confined relative-path resolver,
// a small JavaScript tokenizer of our own, an ESM/CommonJS import-export extractor and a static import graph.
// Honest limits: the tokenizer is not a full JS parser (no AST). Regex-vs-division after "}" is guessed; JSX text, decorators and TypeScript generics are tokenised as punctuation; computed
// exports (export default of an expression, Object.assign(module.exports, ...)) are seen only as "default" / not at all. Only RELATIVE import specifiers are resolved (bare packages are external).
// Nothing here executes, imports or modifies the analysed project; file content is untrusted data (secret-shaped text is scrubbed in every evidence snippet).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { walkRepo } from "./repo-analyzer.mjs";
import { scrub } from "./secret-patterns.mjs";

export const LIMITS = Object.freeze({ maxSourceBytes: 512 * 1024, maxTokens: 200000, maxParamTokens: 400, maxScan: 400, maxRel: 400, maxTemplateDepth: 16, maxGraphFiles: 3000, snippet: 160 });
export const JS_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;
export const TEST_FILE = /(^|\/)(tests?|__tests__|spec|atlasz-tests)\/.*\.(mjs|cjs|js|ts)$|\.(test|spec)\.(mjs|cjs|js|ts)$/i;
export const isTestFile = rel => TEST_FILE.test(rel);
export const sha256 = x => createHash("sha256").update(x).digest("hex");
export const clean = s => scrub(String(s ?? "")).slice(0, LIMITS.snippet);
/** Deterministic JSON (sorted keys) used for every hash a plan or approval is bound to. */
export const canonical = v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
export const MODEL_NOT_CONFIGURED = "MODEL_NOT_CONFIGURED";

/** A root must be a real directory (not a symlink). Returns {ok, abs, real} or {ok:false, reason}. */
export function realRoot(root) {
  if (typeof root !== "string" || !root || root.includes("\0")) return { ok: false, reason: "ROOT_INVALID" };
  let st; try { st = fs.lstatSync(root); } catch { return { ok: false, reason: "ROOT_NOT_FOUND" }; }
  if (!st.isDirectory()) return { ok: false, reason: "ROOT_MUST_BE_A_REAL_DIRECTORY" };
  return { ok: true, abs: path.resolve(root), real: fs.realpathSync(root) };
}

/** Confine a caller-supplied relative path to root: no absolute/drive paths, no "..", no NUL/backslash, no symlink anywhere on the way. */
export function safeRel(root, rel, { allowMissingParents = false } = {}) {
  if (typeof rel !== "string" || !rel || rel.length > LIMITS.maxRel || /[\0\\]/.test(rel) || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return { ok: false, reason: "PATH_INVALID" };
  const norm = path.posix.normalize(rel);
  if (norm === ".." || norm.startsWith("../") || norm.split("/").includes("..") || norm === ".") return { ok: false, reason: "PATH_TRAVERSAL_REFUSED" };
  const r = realRoot(root); if (!r.ok) return r;
  let cur = r.real; const parts = norm.split("/");
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]); let st;
    try { st = fs.lstatSync(cur); } catch { return i === parts.length - 1 || allowMissingParents ? { ok: true, rel: norm, abs: path.join(r.real, ...parts), exists: false } : { ok: false, reason: "PATH_NOT_FOUND" }; }
    if (st.isSymbolicLink()) return { ok: false, reason: "SYMLINK_REFUSED" };
    if (i < parts.length - 1 && !st.isDirectory()) return { ok: false, reason: "PATH_NOT_FOUND" };
    if (i === parts.length - 1) return { ok: true, rel: norm, abs: cur, exists: true, isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs };
  }
  return { ok: false, reason: "PATH_INVALID" };
}

/** Read a confined text file with a byte cap. Binary (NUL in the first 4 KiB) is refused. */
export function readConfined(root, rel, maxBytes = LIMITS.maxSourceBytes) {
  const p = safeRel(root, rel); if (!p.ok) return p;
  if (!p.exists) return { ok: false, reason: "FILE_NOT_FOUND" };
  if (!p.isFile) return { ok: false, reason: "NOT_A_REGULAR_FILE" };
  if (p.size > maxBytes) return { ok: false, reason: "FILE_TOO_LARGE", size: p.size, maxBytes };
  let b; try { b = fs.readFileSync(p.abs); } catch { return { ok: false, reason: "FILE_UNREADABLE" }; }
  if (b.length > maxBytes) return { ok: false, reason: "FILE_TOO_LARGE", size: b.length, maxBytes };          // grew between stat and read
  if (b.subarray(0, 4096).includes(0)) return { ok: false, reason: "BINARY_FILE_REFUSED" };
  return { ok: true, rel: p.rel, abs: p.abs, text: b.toString("utf8"), bytes: b.length, mtimeMs: p.mtimeMs, sha256: sha256(b) };
}

// ---------------- tokenizer ----------------
const KW_BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);
const IDENT_START = /[A-Za-z_$À-￿]/, IDENT = /[A-Za-z0-9_$À-￿]/;
const MULTI = ["...", "=>", "===", "!==", "==", "!=", "&&", "||", "??", "?.", "<=", ">="];

/** Tokens: {t: "id"|"str"|"tpl"|"num"|"re"|"p", v, line}. Comments and whitespace dropped. Never throws; bounded by maxTokens. */
export function tokenize(src, { maxTokens = LIMITS.maxTokens } = {}) {
  const s = String(src ?? ""), n = s.length, toks = []; let i = 0, line = 1, truncated = false, unterminated = 0;
  const nl = (a, b) => { for (let k = a; k < b; k++) if (s.charCodeAt(k) === 10) line++; };
  const regexOk = () => { const p = toks[toks.length - 1]; if (!p) return true; if (p.t === "p") return !(p.v === ")" || p.v === "]"); if (p.t === "id") return KW_BEFORE_REGEX.has(p.v); return false; };
  const readTemplate = (start, depth) => {     // returns index after the closing backtick
    let k = start + 1;
    while (k < n) {
      const c = s[k];
      if (c === "\\") { k += 2; continue; }
      if (c === "`") return k + 1;
      if (c === "$" && s[k + 1] === "{") {
        k += 2; let br = 1;
        while (k < n && br > 0) {
          const d = s[k];
          if (d === "\\") { k += 2; continue; }
          if (d === "{") br++; else if (d === "}") br--;
          else if (d === "'" || d === '"') { const q = d; k++; while (k < n && s[k] !== q && s[k] !== "\n") k += s[k] === "\\" ? 2 : 1; }
          else if (d === "`") { if (depth >= LIMITS.maxTemplateDepth) return n; k = readTemplate(k, depth + 1); continue; }
          k++;
        }
        continue;
      }
      k++;
    }
    unterminated++; return n;
  };
  while (i < n) {
    if (toks.length >= maxTokens) { truncated = true; break; }
    const c = s[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === "﻿" || c === " ") { i++; continue; }
    if (c === "/" && s[i + 1] === "/") { while (i < n && s[i] !== "\n") i++; continue; }
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2), end = e < 0 ? n : e + 2; if (e < 0) unterminated++; nl(i, end); i = end; continue; }
    if (c === "#" && i === 0 && s[1] === "!") { while (i < n && s[i] !== "\n") i++; continue; }
    if (c === '"' || c === "'") {
      let k = i + 1, v = "";
      while (k < n && s[k] !== c && s[k] !== "\n") { if (s[k] === "\\" && k + 1 < n) { const e = s[k + 1]; v += e === "n" ? "\n" : e === "t" ? "\t" : e; k += 2; continue; } v += s[k]; k++; }
      if (s[k] !== c) unterminated++;
      toks.push({ t: "str", v, line }); i = Math.min(k + 1, n); continue;
    }
    if (c === "`") { const end = readTemplate(i, 0), startLine = line; nl(i, end); toks.push({ t: "tpl", v: s.slice(i + 1, Math.max(i + 1, end - 1)), line: startLine }); i = end; continue; }
    if (IDENT_START.test(c)) { let k = i + 1; while (k < n && IDENT.test(s[k])) k++; toks.push({ t: "id", v: s.slice(i, k), line }); i = k; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) { let k = i + 1; while (k < n && /[0-9A-Za-z_.]/.test(s[k])) k++; toks.push({ t: "num", v: s.slice(i, k), line }); i = k; continue; }
    if (c === "/" && regexOk()) {
      let k = i + 1, cls = false;
      while (k < n && s[k] !== "\n") { const d = s[k]; if (d === "\\") { k += 2; continue; } if (d === "[") cls = true; else if (d === "]") cls = false; else if (d === "/" && !cls) break; k++; }
      if (s[k] === "/") { k++; while (k < n && /[a-z]/.test(s[k])) k++; toks.push({ t: "re", v: s.slice(i, k), line }); i = k; continue; }
      // not a regex after all: fall through as punctuation
    }
    const m = MULTI.find(op => s.startsWith(op, i));
    if (m) { toks.push({ t: "p", v: m, line }); i += m.length; continue; }
    toks.push({ t: "p", v: c, line }); i++;
  }
  return { tokens: toks, truncated, unterminated };
}

/** Render a token slice as stable text (used for signatures). */
export function renderTokens(ts) {
  let out = "";
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k], v = t.t === "str" ? JSON.stringify(t.v) : t.t === "tpl" ? "`" + t.v + "`" : t.v, prev = ts[k - 1];
    if (!prev) { out += v; continue; }
    const word = x => x && (x.t === "id" || x.t === "num" || x.t === "str" || x.t === "tpl");
    if (t.t === "p" && [",", ")", "]", "}", ":", ".", "?."].includes(t.v)) out += v;
    else if (t.t === "p" && ["=", "=>"].includes(t.v)) out += " " + v;
    else if (prev.t === "p" && [",", ":", "=", "=>"].includes(prev.v)) out += " " + v;
    else if (word(prev) && word(t)) out += " " + v;
    else out += v;
  }
  return out;
}

const matchClose = (ts, open, maxScan = LIMITS.maxParamTokens) => {     // index of the bracket closing ts[open]
  const pair = { "(": ")", "[": "]", "{": "}" }, o = ts[open]?.v, c = pair[o]; if (!c) return -1; let d = 0;
  for (let k = open; k < ts.length && k - open <= maxScan; k++) { if (ts[k].t !== "p") continue; if (ts[k].v === "(" || ts[k].v === "[" || ts[k].v === "{") d++; else if (ts[k].v === ")" || ts[k].v === "]" || ts[k].v === "}") { d--; if (d === 0) return ts[k].v === c ? k : -1; } }
  return -1;
};
const splitTop = ts => { const parts = []; let d = 0, cur = []; for (const t of ts) { if (t.t === "p" && "([{".includes(t.v)) d++; if (t.t === "p" && ")]}".includes(t.v)) d--; if (d === 0 && t.t === "p" && t.v === ",") { parts.push(cur); cur = []; } else cur.push(t); } if (cur.length) parts.push(cur); return parts; };
/** Parameter list of the "(" at index open: {params:[text], text, end} or null. */
export function paramsAt(ts, open) {
  if (ts[open]?.v !== "(") return null; const close = matchClose(ts, open); if (close < 0) return { params: [], text: "(?)", end: open, truncated: true };
  const params = splitTop(ts.slice(open + 1, close)).map(p => renderTokens(p)).filter(Boolean);
  return { params, text: "(" + params.join(", ") + ")", end: close };
}

/** Extract imports, exports (with signatures) and referenced identifiers from JS source. */
export function parseModule(src) {
  const { tokens: ts, truncated, unterminated } = tokenize(src), imports = [], exports = [], idents = new Set(), identCounts = new Map(), members = new Set();
  const notMember = k => !(ts[k - 1]?.t === "p" && (ts[k - 1].v === "." || ts[k - 1].v === "?."));
  const addExport = (e, tok) => { if (exports.length < 2000) exports.push({ line: tok.line, ...e }); };
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t.t === "id") { if (notMember(k)) { idents.add(t.v); identCounts.set(t.v, (identCounts.get(t.v) ?? 0) + 1); } else if (ts[k - 2]?.t === "id") members.add(ts[k - 2].v + "." + t.v); }
    if (t.t !== "id" || !notMember(k)) continue;
    if (t.v === "import") {
      const nx = ts[k + 1];
      if (nx?.v === "(" && nx.t === "p") { if (ts[k + 2]?.t === "str" && ts[k + 3]?.v === ")") imports.push({ spec: ts[k + 2].v, kind: "dynamic", names: [], line: t.line }); else if (ts[k + 2]) imports.push({ spec: null, kind: "dynamic-computed", names: [], line: t.line }); continue; }
      if (nx?.t === "p" && nx.v === ".") continue;        // import.meta
      if (nx?.t === "str") { imports.push({ spec: nx.v, kind: "side-effect", names: [], line: t.line }); continue; }
      const names = []; let ns = null, def = null, j = k + 1, found = null;
      if (ts[j]?.t === "id" && ts[j].v === "type") j++;
      for (; j < ts.length && j - k < LIMITS.maxScan; j++) {
        const u = ts[j];
        if (u.t === "id" && u.v === "from" && ts[j + 1]?.t === "str") { found = ts[j + 1].v; break; }
        if (u.t === "p" && u.v === ";") break;
        if (u.t === "p" && u.v === "*" && ts[j + 1]?.v === "as" && ts[j + 2]?.t === "id") { ns = ts[j + 2].v; j += 2; continue; }
        if (u.t === "p" && u.v === "{") { const c = matchClose(ts, j); if (c < 0) break; for (const part of splitTop(ts.slice(j + 1, c))) { const ids = part.filter(x => x.t === "id" || x.t === "str"); if (!ids.length) continue; const imported = ids[0].v === "type" && ids.length > 1 ? ids[1].v : ids[0].v, asI = part.findIndex(x => x.v === "as"); names.push({ imported, local: asI >= 0 && part[asI + 1] ? part[asI + 1].v : imported }); } j = c; continue; }
        if (u.t === "id" && def === null && !ns && names.length === 0) def = u.v;
      }
      if (found !== null) imports.push({ spec: found, kind: "static", names, ns, default: def, line: t.line });
      continue;
    }
    if (t.v === "require" && ts[k + 1]?.v === "(" && ts[k + 2]?.t === "str" && ts[k + 3]?.v === ")") { imports.push({ spec: ts[k + 2].v, kind: "require", names: [], line: t.line }); continue; }
    if (t.v !== "export") continue;
    let j = k + 1, u = ts[j];
    if (!u) continue;
    if (u.t === "id" && u.v === "default") {
      let a = j + 1; if (ts[a]?.v === "async") a++;
      if (ts[a]?.v === "function") { let b = a + 1; if (ts[b]?.v === "*") b++; const nm = ts[b]?.t === "id" ? ts[b].v : null, pi = nm ? b + 1 : b, p = paramsAt(ts, pi); addExport({ name: "default", kind: "function", local: nm, params: p?.params ?? [], signature: (nm ?? "default") + (p?.text ?? "()") }, t); }
      else if (ts[a]?.v === "class") addExport({ name: "default", kind: "class", local: ts[a + 1]?.t === "id" ? ts[a + 1].v : null, params: [], signature: "class " + (ts[a + 1]?.t === "id" ? ts[a + 1].v : "default") }, t);
      else addExport({ name: "default", kind: "value", params: [], signature: "default" }, t);
      continue;
    }
    if (u.t === "p" && u.v === "*") {   // export * from "x" | export * as ns from "x"
      let nm = null, a = j + 1; if (ts[a]?.v === "as" && ts[a + 1]?.t === "id") { nm = ts[a + 1].v; a += 2; }
      if (ts[a]?.v === "from" && ts[a + 1]?.t === "str") { imports.push({ spec: ts[a + 1].v, kind: "reexport", names: [], reexportAll: !nm, line: t.line }); if (nm) addExport({ name: nm, kind: "namespace", params: [], signature: nm, from: ts[a + 1].v }, t); }
      continue;
    }
    if (u.t === "p" && u.v === "{") {
      const c = matchClose(ts, j); if (c < 0) continue; const from = ts[c + 1]?.v === "from" && ts[c + 2]?.t === "str" ? ts[c + 2].v : null, names = [];
      for (const part of splitTop(ts.slice(j + 1, c))) { const ids = part.filter(x => x.t === "id"); if (!ids.length) continue; const asI = part.findIndex(x => x.v === "as"), local = ids[0].v, exported = asI >= 0 && part[asI + 1] ? part[asI + 1].v : local; names.push({ imported: local, local: exported }); addExport({ name: exported, kind: "binding", local, params: [], signature: exported, ...(from ? { from } : {}) }, t); }
      if (from) imports.push({ spec: from, kind: "reexport", names, line: t.line });
      continue;
    }
    if (u.t === "id" && u.v === "type" && ts[j + 1]?.t === "id") continue;    // TS type export: not runtime API
    if (u.t === "id" && u.v === "async") { j++; u = ts[j]; }
    if (u?.t === "id" && u.v === "function") { let b = j + 1; if (ts[b]?.v === "*") b++; if (ts[b]?.t !== "id") continue; const p = paramsAt(ts, b + 1); addExport({ name: ts[b].v, kind: "function", params: p?.params ?? [], signature: ts[b].v + (p?.text ?? "()") }, t); continue; }
    if (u?.t === "id" && u.v === "class") { if (ts[j + 1]?.t === "id") addExport({ name: ts[j + 1].v, kind: "class", params: [], signature: "class " + ts[j + 1].v }, t); continue; }
    if (u?.t === "id" && (u.v === "const" || u.v === "let" || u.v === "var")) {
      let b = j + 1;
      for (let guard = 0; guard < 50 && b < ts.length; guard++) {
        const d = ts[b];
        if (d?.t === "p" && (d.v === "{" || d.v === "[")) { const c = matchClose(ts, b); if (c < 0) break; for (let q = b + 1; q < c; q++) if (ts[q].t === "id" && ts[q + 1]?.v !== ":" && ts[q - 1]?.v !== "=") addExport({ name: ts[q].v, kind: "const", params: [], signature: ts[q].v }, t); b = c + 1; }
        else if (d?.t === "id") {
          const nm = d.v; let a = b + 1; if (ts[a]?.v === ":") { while (a < ts.length && a - b < 40 && ts[a].v !== "=") a++; }
          if (ts[a]?.v !== "=") { addExport({ name: nm, kind: "const", params: [], signature: nm }, t); b = a; }
          else {
            let e = a + 1; if (ts[e]?.v === "async") e++;
            let kind = "const", p = null;
            if (ts[e]?.v === "function") { let f = e + 1; if (ts[f]?.v === "*") f++; if (ts[f]?.t === "id") f++; p = paramsAt(ts, f); kind = "function"; }
            else if (ts[e]?.v === "(") { const c = matchClose(ts, e); if (c > 0 && ts[c + 1]?.v === "=>") { p = paramsAt(ts, e); kind = "function"; } }
            else if (ts[e]?.t === "id" && ts[e + 1]?.v === "=>") { p = { params: [ts[e].v], text: "(" + ts[e].v + ")" }; kind = "function"; }
            addExport({ name: nm, kind, params: p?.params ?? [], signature: kind === "function" ? nm + p.text : nm }, t);
            b = e;
          }
        } else break;
        // skip the initialiser up to a top-level "," (another declarator) or the end of the statement
        let depth = 0, more = false;
        for (; b < ts.length && b - j < 20000; b++) {
          const x = ts[b];
          if (x.t === "p" && "([{".includes(x.v)) depth++; else if (x.t === "p" && ")]}".includes(x.v)) { if (depth === 0) break; depth--; }
          else if (depth === 0 && x.t === "p" && x.v === ";") break;
          else if (depth === 0 && x.t === "p" && x.v === ",") { more = true; b++; break; }
          else if (depth === 0 && x.t === "id" && (x.v === "export" || x.v === "import") && x.line > ts[b - 1].line) break;
        }
        if (!more) break;
      }
    }
  }
  return { imports, exports, idents, identCounts, members, truncated, unterminated, tokenCount: ts.length };
}

const EXTS = [".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".cts"];
/** Resolve a relative import specifier against the set of known files. {rel} | {external:true} | {escapes:true} | {unresolved:true} */
export function resolveImport(fromRel, spec, fileSet) {
  if (typeof spec !== "string") return { unresolved: true };
  if (!spec.startsWith("./") && !spec.startsWith("../") && spec !== "." && spec !== "..") return { external: true };
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec.split("?")[0]));
  if (base === ".." || base.startsWith("../")) return { escapes: true };
  const cands = [base, ...EXTS.map(e => base + e), ...EXTS.map(e => base + "/index" + e)];
  if (/\.js$/.test(base)) cands.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  for (const c of cands) if (fileSet.has(c)) return { rel: c };
  return { unresolved: true };
}

/** Static import graph of every JS-like file under root. Read-only. */
export function buildGraph(root, { maxFiles = LIMITS.maxGraphFiles, maxFileBytes = LIMITS.maxSourceBytes, include = null } = {}) {
  const r = realRoot(root); if (!r.ok) return r;
  const w = walkRepo(r.real); if (!w.ok) return w;
  const files = new Map(), notParsed = { oversize: 0, binary: 0, unreadable: 0, pastFileLimit: 0 };
  const cand = w.files.filter(f => JS_EXT.test(f.rel) && !/\.d\.ts$/.test(f.rel) && (!include || include(f.rel)));
  for (const f of cand) {
    if (files.size >= Math.min(maxFiles, LIMITS.maxGraphFiles)) { notParsed.pastFileLimit++; continue; }
    if (f.size > maxFileBytes) { notParsed.oversize++; continue; }
    let b; try { b = fs.readFileSync(f.abs); } catch { notParsed.unreadable++; continue; }
    if (b.subarray(0, 4096).includes(0)) { notParsed.binary++; continue; }
    const text = b.toString("utf8"), m = parseModule(text);
    files.set(f.rel, { rel: f.rel, lines: text.split("\n").length, bytes: b.length, sha256: sha256(b), text, ...m });
  }
  const set = new Set(files.keys()), edges = new Map(), reverse = new Map(), unresolved = [], escapes = [], external = {};
  for (const k of set) { edges.set(k, new Set()); reverse.set(k, new Set()); }
  for (const [rel, m] of files) for (const im of m.imports) {
    const res = resolveImport(rel, im.spec, set);
    if (res.rel) { edges.get(rel).add(res.rel); reverse.get(res.rel).add(rel); im.resolved = res.rel; }
    else if (res.external) { const pkg = String(im.spec); external[pkg] = (external[pkg] ?? 0) + 1; }
    else if (res.escapes) escapes.push({ from: rel, spec: clean(im.spec), line: im.line });
    else unresolved.push({ from: rel, spec: clean(im.spec), line: im.line });
  }
  const h = createHash("sha256"); for (const k of [...set].sort()) h.update(k + "\0" + files.get(k).sha256 + "\n");
  return { ok: true, root: r.real, files, edges, reverse, unresolved: unresolved.slice(0, 500), escapes: escapes.slice(0, 500), external, notParsed, walk: { skipped: w.skipped, capped: w.capped, total: w.files.length }, allFiles: w.files.map(f => f.rel), hash: h.digest("hex") };
}

/** Breadth-first distances from `starts` following `adj` (bounded). Map rel -> depth. */
export function bfs(adj, starts, maxDepth = 50) {
  const dist = new Map(), q = []; for (const s of starts) if (adj.has(s) && !dist.has(s)) { dist.set(s, 0); q.push(s); }
  for (let h = 0; h < q.length; h++) { const u = q[h], d = dist.get(u); if (d >= maxDepth) continue; for (const v of adj.get(u) ?? []) if (!dist.has(v)) { dist.set(v, d + 1); q.push(v); } }
  return dist;
}

/** Tarjan strongly-connected components, iterative (no recursion depth limit). Returns arrays of rels (only components with >1 node or a self-loop). */
export function stronglyConnected(edges) {
  let idx = 0; const index = new Map(), low = new Map(), on = new Set(), stack = [], out = [];
  for (const start of [...edges.keys()].sort()) {
    if (index.has(start)) continue;
    const work = [[start, [...(edges.get(start) ?? [])].sort(), 0]]; index.set(start, idx); low.set(start, idx); idx++; stack.push(start); on.add(start);
    while (work.length) {
      const fr = work[work.length - 1], [v, nbrs] = fr;
      if (fr[2] < nbrs.length) {
        const w = nbrs[fr[2]++];
        if (!index.has(w)) { index.set(w, idx); low.set(w, idx); idx++; stack.push(w); on.add(w); work.push([w, [...(edges.get(w) ?? [])].sort(), 0]); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop(); if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
        if (low.get(v) === index.get(v)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v); if (comp.length > 1 || edges.get(v)?.has(v)) out.push(comp.sort()); }
      }
    }
  }
  return out;
}

/** Status words used by every W2 engine. Code being present is not "connected", tests passing here are not "live". */
export const W2_STATUS = Object.freeze({ completionState: "CODE_ADDED", tests: "UNIT_TESTED_ON_SYNTHETIC_FIXTURES", controlCenterWiring: "NOT_CONNECTED", live: "NOT_LIVE", note: "Deterministic part implemented and unit-tested on synthetic fixtures only; not wired into the Control Center / Integration Hub; no run against a real project is recorded." });
