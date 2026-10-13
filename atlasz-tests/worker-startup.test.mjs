// Critical startup fix: the worker image starts ONLY the approved safe supervisor. Real child processes (no Docker daemon in the sandbox, so the image BUILD itself is not verified here):
// the files the Dockerfile copies are laid out exactly as in the image, started, health-checked, stopped with SIGTERM, restarted on the same state dir, and security is re-checked after restart.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import http from "node:http"; import { spawn } from "node:child_process";
import { tmp, rm } from "./helpers.mjs";
const ROOT = new URL("..", import.meta.url).pathname, DF = fs.readFileSync(path.join(ROOT, "atlasz-runtime/Dockerfile.worker"), "utf8");
const TOKEN = "t".repeat(32);

test("Dockerfile.worker: safe supervisor only, legacy files not copied or referenced, non-root, durable volume, health check, build context documented", () => {
  const code = DF.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
  assert.match(code, /CMD \["node", "supervisor-safe\.mjs"\]/); assert.doesNotMatch(code, /supervisor\.js|worker\.js|agent-child\.js|COPY \. \./);
  assert.match(code, /USER node/); assert.match(code, /VOLUME \["\/data"\]/); assert.match(code, /ATLASZ_STATE_DIR=\/data/); assert.match(code, /HEALTHCHECK/); assert.match(code, /COPY atlasz-addons/);
  assert.match(DF, /BUILD FROM THE REPOSITORY ROOT/); assert.doesNotMatch(DF, /ATLASZ_RUNTIME_TOKEN=|API_KEY=|SECRET=/, "no secret is baked into the image");
  for (const f of ["supervisor.js", "worker.js", "agent-child.js"]) assert.ok(fs.existsSync(path.join(ROOT, "atlasz-runtime", f)), f + " stays preserved in quarantine");
});
const get = (port, p, token) => new Promise(res => { const r = http.get({ host: "127.0.0.1", port, path: p, headers: token ? { "x-atlasz-token": token } : {} }, x => { let b = ""; x.on("data", c => b += c); x.on("end", () => res({ status: x.statusCode, body: b })); }); r.on("error", e => res({ status: 0, body: String(e.message) })); r.setTimeout(3000, () => r.destroy()); });
const waitHealth = async port => { for (let i = 0; i < 60; i++) { const h = await get(port, "/health"); if (h.status === 200) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
const start = (img, state, port, token = TOKEN) => { const env = { ...process.env, ATLASZ_STATE_DIR: state, PORT: String(port) }; delete env.ATLASZ_TEST_MODE; if (token) env.ATLASZ_RUNTIME_TOKEN = token; else delete env.ATLASZ_RUNTIME_TOKEN; return spawn(process.execPath, ["supervisor-safe.mjs"], { cwd: path.join(img, "atlasz-runtime"), env, stdio: ["ignore", "pipe", "pipe"] }); };
const stop = c => new Promise(res => { const t = Date.now(); c.once("exit", (code, sig) => res({ code, sig, ms: Date.now() - t })); c.kill("SIGTERM"); });

test("image layout starts, serves /health, stops cleanly on SIGTERM, restarts with state restored and security enforced after restart", async () => {
  const img = tmp("img-"), state = tmp("st-"); let c1, c2;
  try {
    fs.mkdirSync(path.join(img, "atlasz-runtime"), { recursive: true });
    for (const f of ["package.json", "supervisor-safe.mjs", "runtime-http.mjs"]) fs.copyFileSync(path.join(ROOT, "atlasz-runtime", f), path.join(img, "atlasz-runtime", f));
    fs.cpSync(path.join(ROOT, "atlasz-addons"), path.join(img, "atlasz-addons"), { recursive: true });
    for (const f of ["supervisor.js", "worker.js", "agent-child.js"]) assert.equal(fs.existsSync(path.join(img, "atlasz-runtime", f)), false);
    const port = 20000 + Math.floor(Math.random() * 20000);
    c1 = start(img, state, port); assert.equal(await waitHealth(port), true, "starts from the image layout (no legacy files present)");
    assert.equal((await get(port, "/status")).status, 401); assert.equal((await get(port, "/status", "wrong".repeat(8))).status, 401); const st = await get(port, "/status", TOKEN); assert.equal(st.status, 200);
    const j = JSON.parse(st.body); assert.equal(j.search.configured, 5); assert.equal(j.execution.configured, 25); assert.equal(j.capabilities.emailSending, false); assert.equal(j.capabilities.paymentVerification, false);
    const x1 = await stop(c1); assert.equal(x1.code, 0, "controlled shutdown exits 0"); assert.ok(x1.ms < 8000);
    assert.ok(fs.existsSync(path.join(state, "atlasz-state.json")), "state flushed to the durable volume");
    for (const d of ["dead-letters", "incidents", "ledger"]) assert.ok(fs.existsSync(path.join(state, d)), d + " persisted");
    c2 = start(img, state, port); assert.equal(await waitHealth(port), true, "restart on the same volume");
    assert.equal((await get(port, "/status")).status, 401, "token check is enforced again after restart"); const j2 = JSON.parse((await get(port, "/status", TOKEN)).body); assert.equal(j2.search.configured, 5); assert.equal(j2.execution.configured, 25);
    assert.equal((await stop(c2)).code, 0);
  } finally { c1?.kill("SIGKILL"); c2?.kill("SIGKILL"); rm(img); rm(state); }
});
test("without a runtime token every protected route fails closed (503) and /health still works", async () => {
  const img = tmp("img-"), state = tmp("st-"); let c;
  try {
    fs.mkdirSync(path.join(img, "atlasz-runtime"), { recursive: true }); for (const f of ["package.json", "supervisor-safe.mjs", "runtime-http.mjs"]) fs.copyFileSync(path.join(ROOT, "atlasz-runtime", f), path.join(img, "atlasz-runtime", f)); fs.cpSync(path.join(ROOT, "atlasz-addons"), path.join(img, "atlasz-addons"), { recursive: true });
    const port = 20000 + Math.floor(Math.random() * 20000); c = start(img, state, port, null); assert.equal(await waitHealth(port), true);
    assert.equal((await get(port, "/status", TOKEN)).status, 503); assert.equal((await stop(c)).code, 0);
  } finally { c?.kill("SIGKILL"); rm(img); rm(state); }
});
