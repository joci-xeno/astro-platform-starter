// Zero-dependency document text extractors (Document Intelligence, package §24). Pure functions over a Buffer; nothing is executed, nothing is written to disk, no network.
//   DOCX / XLSX / PPTX / ODT / ODS / ODP (ZIP + XML), RTF, basic PDF (text-layer only).
// Honest limits: scanned or encrypted PDFs and images are NOT read (status says so; OCR needs a separate adapter). Hostile archives are bounded: entry count, per-entry and total
// uncompressed size, and a compression-ratio cap, so a zip bomb is refused instead of expanded.
import zlib from "node:zlib";

export const LIMITS = Object.freeze({ maxEntries: 2000, maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxRatio: 200, maxTextChars: 2_000_000 });
const fail = (code, note) => Object.assign(new Error(code + (note ? ":" + note : "")), { code });

/** Read the ZIP central directory and return a lazy reader. */
export function openZip(buf, limits = LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw fail("NOT_A_ZIP");
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw fail("NOT_A_ZIP", "no end-of-central-directory");
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count > limits.maxEntries) throw fail("ZIP_TOO_MANY_ENTRIES");
  const entries = new Map(); let p = cdOff, total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw fail("ZIP_CORRUPT", "central directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8"); p += 46 + nlen + elen + clen;
    if (usize > limits.maxEntryBytes) throw fail("ZIP_ENTRY_TOO_LARGE", name);
    if (csize > 0 && usize / csize > limits.maxRatio && usize > 1024 * 1024) throw fail("ZIP_BOMB_RATIO", name);
    total += usize; if (total > limits.maxTotalBytes) throw fail("ZIP_TOTAL_TOO_LARGE");
    entries.set(name, { name, method, csize, usize, lho });
  }
  const read = name => {
    const e = entries.get(name); if (!e) return null;
    if (e.lho + 30 > buf.length || buf.readUInt32LE(e.lho) !== 0x04034b50) throw fail("ZIP_CORRUPT", "local header " + name);
    const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28), raw = buf.slice(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) { const out = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(e.usize + 1024, limits.maxEntryBytes) }); if (out.length > limits.maxEntryBytes) throw fail("ZIP_ENTRY_TOO_LARGE", name); return out; }
    throw fail("ZIP_UNSUPPORTED_METHOD", String(e.method));
  };
  return { names: () => [...entries.keys()], has: n => entries.has(n), read, text: n => read(n)?.toString("utf8") ?? null };
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m)));
const strip = x => unxml(x.replace(/<[^>]+>/g, ""));

function docx(z) {
  const main = z.text("word/document.xml"); if (main == null) throw fail("NOT_A_DOCX");
  const paras = [...main.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => strip(m[0].replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<\/w:t>/g, "</w:t>")).trim());
  const extra = z.names().filter(n => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(n)).map(n => strip(z.text(n) ?? "").trim()).filter(Boolean);
  return { text: [...paras.filter(Boolean), ...extra].join("\n"), meta: { paragraphs: paras.filter(Boolean).length } };
}
function xlsx(z) {
  if (!z.has("xl/workbook.xml")) throw fail("NOT_AN_XLSX");
  const ss = z.text("xl/sharedStrings.xml"), shared = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => strip(m[1])) : [];
  const wb = z.text("xl/workbook.xml"), names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(m => unxml(m[1]));
  const sheets = z.names().filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const out = []; let cells = 0;
  sheets.forEach((sn, idx) => {
    out.push(`## ${names[idx] ?? "Sheet" + (idx + 1)}`);
    for (const row of z.text(sn).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const vals = []; for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = /t="(\w+)"/.exec(c[1])?.[1], f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(c[2] ?? "")?.[1], v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1], isv = /<is>([\s\S]*?)<\/is>/.exec(c[2] ?? "")?.[1];
        let val = t === "s" ? shared[Number(v)] ?? "" : isv != null ? strip(isv) : v != null ? unxml(v) : ""; if (f && v == null) val = "=" + strip(f); vals.push(val); cells++;
      }
      if (vals.some(x => x !== "")) out.push(vals.join("\t"));
    }
  });
  return { text: out.join("\n"), meta: { sheets: sheets.length, cells, note: "Values are as stored; formulas are not recalculated." } };
}
function pptx(z) {
  const slides = z.names().filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (!slides.length) throw fail("NOT_A_PPTX");
  const notes = z.names().filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  const out = slides.map((n, i) => `## Slide ${i + 1}\n` + [...z.text(n).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(m => strip(m[1]).trim()).filter(Boolean).join("\n"));
  for (const n of notes) { const t = [...z.text(n).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => unxml(m[1])).join(" ").trim(); if (t) out.push("Notes: " + t); }
  return { text: out.join("\n"), meta: { slides: slides.length } };
}
function odf(z) {
  const c = z.text("content.xml"); if (c == null) throw fail("NOT_AN_ODF");
  const text = unxml(c.replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n").replace(/<\/(text:p|text:h|table:table-row)>/g, "\n").replace(/<\/table:table-cell>/g, "\t").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, meta: {} };
}
function rtf(buf) {
  let s = buf.toString("latin1"); if (!/^\{\\rtf/.test(s)) throw fail("NOT_AN_RTF");
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\par[d]?\b ?/g, "\n").replace(/\\tab ?/g, "\t").replace(/\{\\\*[^{}]*\}/g, "").replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCodePoint(n < 0 ? Number(n) + 65536 : Number(n))).replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
  return { text: s.replace(/\n{3,}/g, "\n\n").trim(), meta: {} };
}
/** Text layer of a simple PDF: Flate/uncompressed content streams, Tj / TJ / ' operators. Not a full PDF engine: encrypted files, scanned images and exotic font encodings are reported, never guessed. */
function pdf(buf) {
  const head = buf.slice(0, 1024).toString("latin1"); if (!/%PDF-/.test(head)) throw fail("NOT_A_PDF");
  const all = buf.toString("latin1"); if (/\/Encrypt\b/.test(all)) throw fail("PDF_ENCRYPTED");
  const parts = []; let streams = 0, total = 0;
  for (const m of all.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = all.indexOf("endstream", start); if (end < 0) continue; streams++;
    const dictStart = all.lastIndexOf("<<", m.index), dict = all.slice(dictStart, m.index); let data = buf.slice(start, end);
    if (/\/FlateDecode/.test(dict)) { try { data = zlib.inflateSync(data, { maxOutputLength: LIMITS.maxEntryBytes }); } catch { continue; } } else if (/\/(DCTDecode|JPXDecode|CCITTFaxDecode|ASCII85Decode|LZWDecode)/.test(dict)) continue;
    total += data.length; if (total > LIMITS.maxTotalBytes) throw fail("PDF_TOO_LARGE");
    const c = data.toString("latin1"); if (!/\bBT\b/.test(c)) continue;
    const ps = s => s.replace(/\\([nrtbf()\\])/g, (_, ch) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[ch] ?? ch)).replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) {
      let line = ""; for (const op of bt[1].matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm)\b/g)) {
        if (op[1] != null) line += [...op[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g)].map(x => x[1] != null ? ps(x[1]) : (Number(x[2]) < -200 ? " " : "")).join("");
        else if (op[2] != null) line += ps(op[2]); else if (line && !line.endsWith("\n")) line += "\n";
      }
      if (line.trim()) parts.push(line.trim());
    }
  }
  const text = parts.join("\n");
  if (!text) throw fail("PDF_NO_TEXT_LAYER", streams ? "scanned or image-only; OCR adapter needed" : "no content streams");
  return { text, meta: { streams, note: "Text layer only; layout, tables and unusual font encodings are not reconstructed." } };
}

export const EXTRACTORS = Object.freeze({
  ".docx": b => docx(openZip(b)), ".xlsx": b => xlsx(openZip(b)), ".pptx": b => pptx(openZip(b)), ".odt": b => odf(openZip(b)), ".ods": b => odf(openZip(b)), ".odp": b => odf(openZip(b)), ".rtf": rtf, ".pdf": pdf
});
/** Extract from a Buffer by extension. Returns {ok:true,text,meta,truncated} or {ok:false,code,note}. Never throws. */
export function extractBuffer(buf, ext) {
  const f = EXTRACTORS[String(ext).toLowerCase()]; if (!f) return { ok: false, code: "NO_EXTRACTOR", note: `${ext} has no built-in extractor` };
  try { const r = f(buf); let text = r.text ?? ""; const truncated = text.length > LIMITS.maxTextChars; if (truncated) text = text.slice(0, LIMITS.maxTextChars); if (!text.trim()) return { ok: false, code: "EMPTY", note: "document contains no text" }; return { ok: true, text, meta: r.meta ?? {}, truncated }; }
  catch (e) { return { ok: false, code: e.code ?? "EXTRACTION_FAILED", note: String(e.message).slice(0, 160) }; }
}
