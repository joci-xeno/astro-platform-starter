import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extractBuffer, openZip, LIMITS } from "../atlasz-addons/doc-extractors.mjs";

function crc32(b) { let c, crc = ~0; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
/** minimal ZIP writer for fixtures: files = {name: string|Buffer}, method 8 (deflate) or 0 (store) */
function zip(files, method = 8) {
  const locals = [], central = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const raw = Buffer.from(data), comp = method === 8 ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp); central.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("DOCX: paragraphs, entities, tabs, header/footer text", () => {
  const b = zip({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Invoice total &amp; terms</w:t></w:r></w:p><w:p><w:r><w:t>Net</w:t></w:r><w:r><w:tab/><w:t>30 days</w:t></w:r></w:p></w:body></w:document>', "word/header1.xml": "<w:hdr><w:p><w:r><w:t>ACME Ltd</w:t></w:r></w:p></w:hdr>" });
  const r = extractBuffer(b, ".docx"); assert.equal(r.ok, true); assert.match(r.text, /Invoice total & terms/); assert.match(r.text, /Net\t30 days/); assert.match(r.text, /ACME Ltd/); assert.equal(r.meta.paragraphs, 2);
});
test("XLSX: shared strings, numbers, inline strings, formulas without cached value are marked, sheet names; values are not recalculated", () => {
  const b = zip({ "xl/workbook.xml": '<workbook><sheets><sheet name="Budget &amp; Q1" sheetId="1"/><sheet name="Notes" sheetId="2"/></sheets></workbook>', "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><t>Hosting</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Cost</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>100.5</v></c><c r="C2"><f>B2*2</f></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>' });
  const r = extractBuffer(b, ".xlsx"); assert.equal(r.ok, true); assert.match(r.text, /## Budget & Q1/); assert.match(r.text, /Item\tCost/); assert.match(r.text, /Hosting\t100.5\t=B2\*2/); assert.match(r.text, /## Notes\nhello/); assert.match(r.meta.note, /not recalculated/);
});
test("PPTX slides in numeric order (slide10 after slide2) plus speaker notes; ODT/ODS content; RTF", () => {
  const s = {}; for (const n of [1, 2, 10]) s[`ppt/slides/slide${n}.xml`] = `<p:sld><a:p><a:r><a:t>Slide ${n} title</a:t></a:r></a:p></p:sld>`; s["ppt/notesSlides/notesSlide1.xml"] = "<p:notes><a:p><a:r><a:t>say hello</a:t></a:r></a:p></p:notes>";
  const p = extractBuffer(zip(s), ".pptx"); assert.ok(p.text.indexOf("Slide 2 title") < p.text.indexOf("Slide 10 title")); assert.match(p.text, /Notes: say hello/); assert.equal(p.meta.slides, 3);
  const o = extractBuffer(zip({ "content.xml": '<office:document-content><text:p>First</text:p><text:p>Second&amp;third</text:p><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell><text:p>B</text:p></table:table-cell></table:table-row></office:document-content>' }), ".odt"); assert.match(o.text, /First\nSecond&third/); assert.match(o.text, /A\t?\s*\n?\s*B|A[\s\S]*B/);
  const r = extractBuffer(Buffer.from("{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}\\f0 Hello \\b World\\b0\\par Caf\\'e9 \\u8364? end}"), ".rtf"); assert.match(r.text, /Hello World/); assert.match(r.text, /Café/); assert.match(r.text, /€/);
});
test("PDF text layer: Flate and plain streams, Tj and TJ with kerning gaps; scanned/image-only and encrypted PDFs are reported, never guessed", () => {
  const content = "BT /F1 12 Tf 72 700 Td (Invoice 2026-001) Tj T* [(Total) -300 (due: 250) 20 (.00)] TJ ET";
  const mk = (stream, dict = "/Filter /FlateDecode") => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} ${dict} >>\nstream\n`, "latin1");
  const flate = Buffer.concat([mk(zlib.deflateSync(content)), zlib.deflateSync(content), Buffer.from("\nendstream\nendobj\n%%EOF")]);
  const r = extractBuffer(flate, ".pdf"); assert.equal(r.ok, true); assert.match(r.text, /Invoice 2026-001/); assert.match(r.text, /Total due: 250\.00/);
  const plain = Buffer.concat([mk(content, ""), Buffer.from(content + "\nendstream\nendobj\n%%EOF")]); assert.match(extractBuffer(plain, ".pdf").text, /Invoice 2026-001/);
  const img = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /DCTDecode >>\nstream\n\xff\xd8\xff\xe0JFIF\nendstream\nendobj\n%%EOF", "latin1"); const si = extractBuffer(img, ".pdf"); assert.equal(si.ok, false); assert.equal(si.code, "PDF_NO_TEXT_LAYER"); assert.match(si.note, /OCR/);
  assert.equal(extractBuffer(Buffer.from("%PDF-1.4\n<< /Encrypt 5 0 R >>\n%%EOF"), ".pdf").code, "PDF_ENCRYPTED"); assert.equal(extractBuffer(Buffer.from("hello"), ".pdf").code, "NOT_A_PDF");
});
test("hostile archives are refused, not expanded: zip bomb (ratio), oversize entry, entry flood, truncated/corrupt zip; wrong type; no throw", () => {
  const bomb = zip({ "word/document.xml": Buffer.alloc(8 * 1024 * 1024, 0x41) }); assert.ok(bomb.length < 100_000); const r = extractBuffer(bomb, ".docx"); assert.equal(r.ok, false); assert.equal(r.code, "ZIP_BOMB_RATIO");
  assert.throws(() => openZip(zip({ "a.xml": Buffer.alloc(2048, 1) }), { ...LIMITS, maxEntryBytes: 1000 }), /ZIP_ENTRY_TOO_LARGE/);
  const many = {}; for (let i = 0; i < 40; i++) many["f" + i] = "x"; assert.throws(() => openZip(zip(many), { ...LIMITS, maxEntries: 10 }), /ZIP_TOO_MANY_ENTRIES/);
  assert.throws(() => openZip(zip({ a: "b", c: "d" }), { ...LIMITS, maxTotalBytes: 1 }), /ZIP_TOTAL_TOO_LARGE/);
  const good = zip({ "word/document.xml": "<w:p><w:t>x</w:t></w:p>" }); assert.equal(extractBuffer(good.slice(0, good.length - 30), ".docx").ok, false); assert.equal(extractBuffer(Buffer.from("not a zip at all, definitely"), ".docx").code, "NOT_A_ZIP");
  assert.equal(extractBuffer(zip({ "x.txt": "hi" }), ".docx").code, "NOT_A_DOCX"); assert.equal(extractBuffer(zip({ "x.txt": "hi" }), ".xlsx").code, "NOT_AN_XLSX"); assert.equal(extractBuffer(Buffer.from("x"), ".png").code, "NO_EXTRACTOR");
  assert.equal(extractBuffer(zip({ "word/document.xml": "<w:p></w:p>" }), ".docx").code, "EMPTY");
  assert.equal(extractBuffer(zip({ "word/document.xml": "<w:p><w:t>stored</w:t></w:p>" }, 0), ".docx").ok, true);                         // method 0 (stored) works too
});
