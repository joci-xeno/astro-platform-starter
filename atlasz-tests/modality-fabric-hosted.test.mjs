// Multimodal fabric as hosted: Document Center records media as METADATA_ONLY (no text, nothing searchable), agents inspect only what they may read, Control Center view.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createModalityFabric } from "../atlasz-addons/modality-fabric.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { PNG, JPEG, WAV, MP4, exifBlock } from "./media-fixtures.mjs";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const AGENT = { actor: { type: "AGENT", id: "E9" } };
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } res({ status: r.statusCode, body: j }); }); }); q.on("error", rej); if (data) q.write(data); q.end(); });
const put = (d, n, c) => { const p = path.join(d, n); fs.writeFileSync(p, c); return p; };

test("Document Center + fabric: images/audio/video become METADATA_ONLY records (no text, not searchable); without a fabric they stay UNSUPPORTED_FORMAT", async () => {
  const d = tmp("mf-"), src = tmp("mfs-");
  try {
    const dc = createDocumentCenter({ dir: path.join(d, "a"), media: createModalityFabric() }), plain = createDocumentCenter({ dir: path.join(d, "b") });
    const img = await dc.ingest({ filePath: put(src, "trip.jpg", JPEG(800, 600, exifBlock({ gps: true }))), tenantId: "T" });
    assert.equal(img.extraction.status, "METADATA_ONLY"); assert.equal(img.extraction.meta.width, 800); assert.equal(img.extraction.meta.privacy.exifGps, true); assert.match(img.extraction.note, /external provider/);
    assert.equal(dc.get(img.id, { tenantId: "T" }).text, null); assert.equal(dc.search({ query: "trip jpeg 800 600 TestCam", tenantId: "T" }).length, 0, "metadata is not fake text content");
    const wav = await dc.ingest({ filePath: put(src, "memo.wav", WAV(1.5)), tenantId: "T" }); assert.equal(wav.extraction.meta.durationSec, 1.5);
    const mp4 = await dc.ingest({ filePath: put(src, "clip.mp4", MP4(3, 640, 360)), tenantId: "T" }); assert.equal(mp4.extraction.meta.height, 360);
    const liar = await dc.ingest({ filePath: put(src, "photo.png", JPEG(3, 3)), tenantId: "T" }); assert.equal(liar.extraction.meta.format, "jpeg"); assert.equal(liar.extraction.meta.extensionMismatch, true);
    const junk = await dc.ingest({ filePath: put(src, "blob.png", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), tenantId: "T" }); assert.equal(junk.extraction.status, "UNSUPPORTED_FORMAT");   // .png name does not make it a PNG
    assert.equal((await plain.ingest({ filePath: put(src, "p2.png", PNG(2, 2)), tenantId: "T" })).extraction.status, "UNSUPPORTED_FORMAT");
    assert.equal(dc.readBytes(img.id, { tenantId: "T" }).length > 0, true); assert.equal(dc.readBytes(img.id, { tenantId: "OTHER" }), null); assert.equal(dc.readBytes(img.id, { tenantId: "T", role: "AGENT" }), null);
    const sec = await dc.ingest({ filePath: put(src, "k.txt", "key sk-" + "z".repeat(30)), tenantId: "T" }); assert.equal(sec.classification, "SECRET"); assert.equal(dc.readBytes(sec.id, { tenantId: "T", role: "OWNER" }), null, "SECRET bytes are never handed out, even to the owner path");
  } finally { rm(d); rm(src); }
});

test("hosted: agents inspect media only through media.* typed tools and only what the Document Center lets the AGENT role read; SECRET and owner-only files are not available", async () => {
  const dir = tmp("mfh-"), src = tmp("mfhs-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const names = rt.tools.describe().map(t => t.name); assert.ok(names.includes("media.inspect_document") && names.includes("media.status"));
    const shared = await rt.documents.ingest({ filePath: put(src, "site.png", PNG(320, 200)), tenantId: "JOCI", allowedRoles: ["*"] });
    const mine = await rt.documents.ingest({ filePath: put(src, "private.jpg", JPEG(10, 10, exifBlock({ gps: true }))), tenantId: "JOCI" });               // OWNER-only by default
    const secret = await rt.documents.ingest({ filePath: put(src, "keys.txt", "key sk-" + "a".repeat(30)), tenantId: "JOCI", allowedRoles: ["*"] });
    const ok = await rt.tools.invoke("media.inspect_document", { documentId: shared.id }, AGENT); assert.equal(ok.status, "OK"); assert.equal(ok.result.format, "png"); assert.equal(ok.result.metadata.width, 320); assert.equal(ok.result.understanding.ocr.status, "EXTERNAL_PROVIDER_REQUIRED");
    assert.ok(!JSON.stringify(ok.result).includes("PNG\r\n"));
    for (const id of [mine.id, secret.id, "nope"]) assert.equal((await rt.tools.invoke("media.inspect_document", { documentId: id }, AGENT)).result.status, "NOT_AVAILABLE");
    assert.equal((await rt.tools.invoke("media.inspect_document", { documentId: shared.id, tenantId: "X" }, AGENT)).status, "INVALID_ARGUMENTS");
    const st = (await rt.tools.invoke("media.status", {}, AGENT)).result; assert.ok(st.slots.every(s => s.state === "NOT_CONNECTED")); assert.equal(rt.dashboard().modality.externalSlotsNotLive.length, 6);
    rt.stop?.();
  } finally { rm(dir); rm(src); }
});

test("Control Center: the multimodal view is token-protected and lists metadata-only media with privacy hints and the unconnected provider slots", async () => {
  const base = tmp("mfc-"), src = tmp("mfcs-"), stateDir = path.join(base, "s"), cc = createControlCenterServer({ stateDir, configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen();
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/media")).status, 401);
    await createDocumentCenter({ dir: path.join(stateDir, "documents"), media: createModalityFabric() }).ingest({ filePath: put(src, "holiday.jpg", JPEG(100, 50, exifBlock({ gps: true }))), tenantId: "JOCI" });
    const v = (await call(port, token, "GET", "/api/media")).body; assert.equal(v.state, "CONNECTED"); assert.equal(v.documents.length, 1); assert.equal(v.documents[0].width, 100); assert.match(v.documents[0].privacy.hint, /identifying metadata/);
    assert.equal(v.slots.length, 6); assert.ok(v.slots.every(s => s.state === "NOT_CONNECTED")); assert.match(v.note, /none is connected/);
  } finally { await cc.close?.(); rm(base); rm(src); }
});
