import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createDocumentCenter, candidateAmounts, stripHtml } from "../atlasz-addons/document-center.mjs";
import { tmp, rm } from "./helpers.mjs";

const f = (d, name, content) => { const p = path.join(d, name); fs.writeFileSync(p, content); return p; };
test("ingest + search + access boundaries: tenant isolation, role gate, duplicate detection, unsupported formats are honest", async () => {
  const d = tmp("doc-"), src = tmp("docsrc-");
  try {
    const dc = createDocumentCenter({ dir: d });
    const inv = await dc.ingest({ filePath: f(src, "inv.txt", "Invoice 17\nClient Alpha\nTotal: $1,250.50 due 2026-11-01"), type: "INVOICE", tenantId: "T1", jobId: "job-1" });
    assert.equal(inv.extraction.status, "EXTRACTED"); assert.equal(inv.hints.amounts[0].value, 1250.5); assert.equal(inv.hints.amounts[0].status, "UNVERIFIED_CANDIDATE");
    assert.equal((await dc.ingest({ filePath: f(src, "inv-copy.txt", "Invoice 17\nClient Alpha\nTotal: $1,250.50 due 2026-11-01"), tenantId: "T1" })).duplicate, true);
    const pdf = await dc.ingest({ filePath: f(src, "x.pdf", "%PDF-1.4 fake"), tenantId: "T1" }); assert.equal(pdf.extraction.status, "UNSUPPORTED_FORMAT");
    assert.equal(dc.search({ query: "alpha invoice", tenantId: "T1" })[0].id, inv.id); assert.match(dc.search({ query: "alpha", tenantId: "T1" })[0].snippet, /Alpha/);
    assert.equal(dc.search({ query: "alpha", tenantId: "T2" }).length, 0);                                       // other tenant sees nothing
    assert.equal(dc.search({ query: "alpha", tenantId: "T1", role: "AGENT" }).length, 0);                       // default allowedRoles = OWNER only
    assert.equal(dc.get(inv.id, { tenantId: "T2" }), null); assert.equal(dc.get(inv.id, { tenantId: "T1", role: "AGENT" }), null);
    assert.equal(dc.list({ tenantId: "T1", jobId: "job-1" }).length, 1);
    dc.associate(inv.id, { tenantId: "T1", evidenceRef: "ledger#4" }); assert.deepEqual(dc.get(inv.id, { tenantId: "T1" }).evidenceRefs, ["ledger#4"]);
    assert.equal(createDocumentCenter({ dir: d }).summary().total, 2);                                          // durable across restart
    assert.equal(dc.summary().unsupported, 1);
  } finally { rm(d); rm(src); }
});
test("a document containing a secret is forced to SECRET, owner-only, and never shown in snippets or text", async () => {
  const d = tmp("doc-"), src = tmp("docsrc-");
  try {
    const dc = createDocumentCenter({ dir: d });
    const r = await dc.ingest({ filePath: f(src, "notes.md", "deploy key sk-" + "q".repeat(30) + " for the server"), tenantId: "T", classification: "PUBLIC", allowedRoles: ["*"] });
    assert.equal(r.classification, "SECRET"); assert.equal(r.secretDetected, true);
    assert.equal(dc.search({ query: "deploy server", tenantId: "T", role: "AGENT" }).length, 0);
    const own = dc.search({ query: "deploy server", tenantId: "T", role: "OWNER" })[0]; assert.equal(own.snippet, "[hidden: SECRET]");
    assert.equal(dc.get(r.id, { tenantId: "T" }).text, null);
  } finally { rm(d); rm(src); }
});
test("limits and safety: size cap, missing file, bad classification; HTML scripts are stripped; extractor adapter is used only when injected", async () => {
  const d = tmp("doc-"), src = tmp("docsrc-");
  try {
    const dc = createDocumentCenter({ dir: d, extractors: { ".docx": async () => "text from adapter" } });
    await assert.rejects(dc.ingest({ filePath: path.join(src, "nope.txt") }), /FILE_NOT_FOUND/);
    await assert.rejects(dc.ingest({ filePath: f(src, "a.txt", "x"), classification: "TOPSECRET" }), /BAD_CLASSIFICATION/);
    fs.writeFileSync(path.join(src, "big.txt"), Buffer.alloc(5 * 1024 * 1024 + 1)); await assert.rejects(dc.ingest({ filePath: path.join(src, "big.txt") }), /FILE_TOO_LARGE/);
    assert.equal(stripHtml("<p>Hi</p><script>alert(1)</script><style>x{}</style>"), "Hi");
    assert.equal((await dc.ingest({ filePath: f(src, "w.docx", "PK-binary"), tenantId: "T" })).extraction.method, "ADAPTER:.docx");
    assert.deepEqual(candidateAmounts("nothing here"), []);
  } finally { rm(d); rm(src); }
});
