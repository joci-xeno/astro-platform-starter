// Document Center + quarantine pre-scan: a blocking structural finding is held in quarantine and never stored/extracted/indexed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createQuarantine, prescan } from "../atlasz-addons/quarantine.mjs";
import { tmp, rm } from "./helpers.mjs";

const put = (d, name, content) => { const p = path.join(d, name); fs.writeFileSync(p, content); return p; };
// minimal stored-ZIP builder (one entry, no compression)
function zip1(name, data) {
  const n = Buffer.from(name), raw = Buffer.from(data), lh = Buffer.alloc(30), ch = Buffer.alloc(46), eocd = Buffer.alloc(22);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28);
  const cd = Buffer.concat([ch, n]); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(30 + n.length + raw.length, 16);
  return Buffer.concat([lh, n, raw, cd, eocd]);
}
test("a path-traversal archive and a disguised executable are quarantined on ingest and never stored or indexed; a plain document still ingests", async () => {
  const d = tmp("dcq-"), q = tmp("dcqq-"), src = tmp("dcqs-");
  try {
    const quarantine = createQuarantine({ dir: q }), dc = createDocumentCenter({ dir: d, quarantine });
    const bad = put(src, "bundle.zip", zip1("../../evil.txt", "x"));
    await assert.rejects(() => dc.ingest({ filePath: bad, tenantId: "T" }), e => e.message === "QUARANTINED_ON_INGEST" && e.quarantined === true && /^[0-9a-f]{64}$/.test(e.sha256));
    const exe = put(src, "invoice.pdf", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]));
    await assert.rejects(() => dc.ingest({ filePath: exe, tenantId: "T" }), e => e.message === "QUARANTINED_ON_INGEST");
    for (const nm of ["invoice", "invoice.", "notes.txt"]) await assert.rejects(() => dc.ingest({ filePath: put(src, nm.replace(/\.$/, "_dot"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 2)])), name: nm, tenantId: "T" }), e => e.message === "QUARANTINED_ON_INGEST", nm);   // native executable content blocks whatever the name
    assert.equal(dc.summary().total, 0);                                                      // nothing stored or indexed
    assert.equal(fs.readdirSync(path.join(d, "files")).length, 0);
    assert.ok(quarantine.list().filter(r => r.status === "QUARANTINED").length >= 2);
    const ok = await dc.ingest({ filePath: put(src, "note.txt", "Total: $10 plain note"), tenantId: "T" });
    assert.equal(ok.extraction.status, "EXTRACTED");
  } finally { rm(d); rm(q); rm(src); }
});
test("without a quarantine attached behaviour is unchanged, and prescan is pure", async () => {
  const d = tmp("dcq-"), src = tmp("dcqs-");
  try {
    const dc = createDocumentCenter({ dir: d });
    const r = await dc.ingest({ filePath: put(src, "bundle.zip", zip1("../../evil.txt", "x")), tenantId: "T" });
    assert.ok(r.id);
    assert.equal(prescan(zip1("../../evil.txt", "x"), "b.zip").blocking, true);
    assert.equal(prescan(Buffer.from("hello"), "a.txt").blocking, false);
    assert.equal(prescan(zip1("word/document.xml", "<w:p><w:t>Invoice</w:t></w:p>"), "inv.docx").blocking, false);       // an ordinary office document is not blocked
  } finally { rm(d); rm(src); }
});
