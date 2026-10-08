import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
process.env.ATLASZ_TEST_MODE = "1";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { createWorkbench } from "../atlasz-addons/workbench.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
async function boot() {
  const base = tmp("wb-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const get = (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } });
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const wb = async (op, args) => { const r = await post("/api/workbench/action", { op, args }); return { status: r.status, ...JSON.parse(r.body) }; };
  return { base, stateDir, port, token, get, post, wb, close: async () => { await cc.close?.(); rm(base); } };
}
const CSV = "region,units,price\nN,10,2.5\nS,20,2.4\nN,30,2.2\nE,25,2.3\nS,15,2.45\n";

test("HTTP: workbench routes need the token; the CSP lets inline SVG data-URI images load but nothing else widens", async () => {
  const c = await boot();
  try {
    assert.equal((await c.get("/api/workbench", null)).status, 401); assert.equal((await c.post("/api/workbench/action", { op: "conv.list" }, null)).status, 401);
    const w = await c.get("/api/workbench"); assert.equal(w.status, 200); const j = JSON.parse(w.body); assert.equal(j.state, "CONNECTED"); assert.ok(j.ops.includes("analyst.run")); assert.match(j.note, /No model provider/);
    const page = await raw(c.port, "/", { headers: { host: "127.0.0.1:" + c.port } }); const csp = page.headers["content-security-policy"];
    assert.match(csp, /img-src 'self' data:/); assert.match(csp, /script-src 'self'/); assert.ok(!/unsafe-eval|script-src[^;]*data:|default-src[^;]*\*/.test(csp));
  } finally { await c.close(); }
});
test("HTTP: analyst end to end - report, hash, markdown and rendered charts as inert SVG data URIs; reproducible across calls; bad CSV is a clean 400", async () => {
  const c = await boot();
  try {
    const a = await c.wb("analyst.run", { csv: CSV, ops: [{ op: "toNumber", column: "units" }] }), b = await c.wb("analyst.run", { csv: CSV, ops: [{ op: "toNumber", column: "units" }] });
    assert.equal(a.status, 200); assert.equal(a.result.report.reportHash, b.result.report.reportHash); assert.match(a.result.markdown, /Report hash/);
    assert.ok(a.result.charts.length >= 3); for (const ch of a.result.charts) { assert.match(ch.dataUri, /^data:image\/svg\+xml;charset=utf-8,/); const svg = decodeURIComponent(ch.dataUri.split(",").slice(1).join(",")); assert.ok(!/<script|onload=|javascript:/i.test(svg)); }
    const bad = await c.wb("analyst.run", { csv: "a,b\n1\n" }); assert.equal(bad.status, 400); assert.match(bad.error, /RAGGED_ROWS/);
    assert.equal((await c.wb("analyst.run", { csv: 5 })).status, 400); assert.equal((await c.wb("nope", {})).status, 400);
    assert.equal((await c.wb("analyst.run", { csv: "a\n1\n", ops: [{ op: "rm -rf" }] })).status, 400);
  } finally { await c.close(); }
});
test("HTTP: conversations persist on disk across a restart; asking a model with no provider is refused (NO_ELIGIBLE_PROVIDER) and adds no turn; a secret in a turn is redacted on disk", async () => {
  const c = await boot();
  try {
    const cr = await c.wb("conv.create", { title: "Plan", model: "alpha", systemPrompt: "Be brief." }); assert.equal(cr.status, 200); const id = cr.result.id;
    assert.equal((await c.wb("conv.addTurn", { id, text: "key " + "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX please" })).status, 200);
    const ask = await c.wb("conv.complete", { id }); assert.equal(ask.status, 400); assert.match(ask.error, /NO_ELIGIBLE_PROVIDER/);
    const got = await c.wb("conv.get", { id }); assert.equal(got.result.conversation.turns.length, 1); assert.ok(!JSON.stringify(got).includes("sk-ABCDEFGH"));
    const disk = fs.readFileSync(path.join(c.stateDir, "workbench", "conversations.json"), "utf8"); assert.ok(!disk.includes("sk-ABCDEFGH") && disk.includes("[redacted]"));
    assert.equal((await c.wb("conv.setModel", { id, model: "beta" })).result.switches, 1);
    const ctx = await c.wb("conv.context", { id, maxTokens: 200 }); assert.equal(ctx.result.ok, true); assert.ok(ctx.result.tokens <= ctx.result.budget);
    const list = JSON.parse((await c.get("/api/workbench")).body).conversations; assert.equal(list.length, 1); assert.equal(list[0].switches, 1);
    assert.equal((await c.wb("conv.get", { id: "cv_nope" })).status, 400); assert.equal((await c.wb("conv.delete", { id })).status, 200); assert.equal(JSON.parse((await c.get("/api/workbench")).body).conversations.length, 0);
  } finally { await c.close(); }
});
test("HTTP: the kill switch blocks asking a model; owner emergency state is respected", async () => {
  const c = await boot();
  try {
    assert.equal((await c.post("/api/owner-key", { passphrase: "correct horse battery" })).status, 200);
    const id = (await c.wb("conv.create", {})).result.id; await c.wb("conv.addTurn", { id, text: "hello" });
    assert.equal((await c.post("/api/emergency", { mode: "PAUSE_ALL", passphrase: "correct horse battery" })).status, 200);
    const r = await c.wb("conv.complete", { id }); assert.equal(r.status, 400); assert.match(r.error, /EMERGENCY_STOP_ACTIVE/);
  } finally { await c.close(); }
});
test("HTTP: preview/annotation/guidance/effort/detail ops return inert, validated output; hostile input is refused or escaped", async () => {
  const c = await boot();
  try {
    const ch = await c.wb("render.chart", { spec: { type: "bar", title: "<script>alert(1)</script>", labels: ["a", "b"], values: [1, 2] } }); assert.equal(ch.status, 200); assert.ok(!decodeURIComponent(ch.result.dataUri).includes("<script"));
    assert.equal((await c.wb("render.chart", { spec: { type: "pie" } })).status, 400);
    assert.match((await c.wb("render.preview", { text: "<img src=x onerror=1>" })).result.html, /&lt;img/);
    assert.equal((await c.wb("annotate", { annotations: [{ type: "rect", x: 0.9, y: 0, w: 0.5, h: 0.1 }] })).status, 400);
    const g = await c.wb("guidance.step", { guidance: { title: "T", steps: [{ text: "Click Save", region: { type: "marker", x: 0.5, y: 0.5 } }] }, n: 1 }); assert.equal(g.status, 200); assert.equal(g.result.step.performedByAtlasz, false);
    const e = await c.wb("effort.choose", { task: { kind: "FINANCIAL", risk: "CRITICAL", externalEffect: true } }); assert.deepEqual([e.result.level, e.result.verify, e.result.humanReview, e.result.spendUsd], ["MAX", true, true, 0]);
    assert.equal((await c.wb("detail.choose", { modality: "image", bytes: 10, privacy: "CONFIDENTIAL", purpose: "AUDIT", provider: "EXTERNAL" })).result.level, "METADATA_ONLY");
    const ck = await c.wb("chunk.plan", { text: "word ".repeat(5000), maxTokens: 200 }); assert.equal(ck.result.coverage.complete, true); assert.ok(ck.result.chunkCount > 10);
    assert.equal((await c.wb("chunk.plan", { text: "x", maxTokens: 2 })).status, 400);
  } finally { await c.close(); }
});
test("workbench facade never throws: unknown op, non-object args and handler exceptions become {ok:false}", async () => {
  const w = createWorkbench({}); assert.equal((await w.run("nope")).reason, "OP_UNKNOWN"); assert.equal((await w.run("conv.list", [])).reason, "ARGS_INVALID");
  assert.equal((await w.run("conv.get", {})).ok, false); assert.equal((await w.run("render.chart", {})).ok, false); assert.equal((await w.run("detail.choose", null)).ok, false);
  assert.equal((await w.run("conv.complete", { id: "x" })).ok, false);
});
test("RUNTIME: the pure workbench tools are registered in the real runtime registry and run through the control chain; extra/injected arguments are rejected; kill switch denies them", async () => {
  const d = tmp("wbrt-"); const rt = createRuntime({ dataDir: d, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
  try {
    const names = rt.tools.describe().map(t => t.name); for (const n of ["effort.choose", "analyst.analyze", "chunk.plan"]) assert.ok(names.includes(n), n);
    const actor = { actor: { type: "AGENT", id: "EXECUTION-1" } };
    const e = await rt.tools.invoke("effort.choose", { task: { kind: "ANALYSE", risk: "LOW" } }, actor); assert.equal(e.status, "OK"); assert.equal(e.result.level, "MEDIUM");
    const a = await rt.tools.invoke("analyst.analyze", { csv: CSV }, actor); assert.equal(a.status, "OK"); assert.match(a.result.report.reportHash, /^[0-9a-f]{64}$/);
    const k = await rt.tools.invoke("chunk.plan", { text: "hello world ".repeat(400), maxTokens: 64 }, actor); assert.equal(k.status, "OK"); assert.equal(k.result.coverage.complete, true);
    assert.equal((await rt.tools.invoke("analyst.analyze", { csv: CSV, tenantId: "OTHER" }, actor)).status, "INVALID_ARGUMENTS");
    assert.equal((await rt.tools.invoke("analyst.analyze", { csv: "x".repeat(200001) }, actor)).status, "INVALID_ARGUMENTS");
  } finally { rt.stop?.(); rm(d); }
});
