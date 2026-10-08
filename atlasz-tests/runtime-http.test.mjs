import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRuntimeHandler, RUNTIME_TOKEN_MIN_LENGTH } from "../atlasz-runtime/runtime-http.mjs";
import { tmp, rm } from "./helpers.mjs";

const TOKEN = "r".repeat(32), RUNTIME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "atlasz-runtime");
const fakeRuntime = () => ({ state: { leads: [{ id: "L1", title: "PRIVATE-LEAD-TITLE", description: "secret desc", assessment: { score: 7, checks: [] } }], events: [{ type: "x" }] }, dashboard: () => ({ status: "OK", moneyEngine: { revenue: 1234 }, agents: new Array(30).fill({}) }) });
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
async function serve(o = {}) { const port = await freePort(), server = http.createServer(createRuntimeHandler({ runtime: fakeRuntime(), version: "9.9.9", ...o })); await new Promise(r => server.listen(port, "127.0.0.1", r)); return { port, close: () => new Promise(r => server.close(r)) }; }
const req = (port, p, { method = "GET", headers = {} } = {}) => new Promise((res, rej) => { const rq = http.request({ host: "127.0.0.1", port, path: p, method, headers }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ status: r.statusCode, body: b, headers: r.headers })); }); rq.on("error", rej); rq.end(); });

test("/health is open but minimal: {ok, version} only - no state, counts, topology or money", async () => {
  const s = await serve({ token: TOKEN });
  try { const r = await req(s.port, "/health"); assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { ok: true, version: "9.9.9" }); }
  finally { await s.close(); }
});
test("every other route requires the token: no token, wrong token, wrong scheme and a prefix of the token are all 401; no private content is ever in a 401 body", async () => {
  const s = await serve({ token: TOKEN, maxFailures: 100000 });
  try {
    for (const p of ["/", "/status", "/revenue", "/opportunities", "/events", "/anything", "/health/../status"]) {
      for (const headers of [{}, { "x-atlasz-token": "wrong" }, { "x-atlasz-token": TOKEN.slice(0, -1) }, { "x-atlasz-token": TOKEN + "x" }, { authorization: "Basic " + TOKEN }, { authorization: "Bearer " }]) {
        const r = await req(s.port, p, { headers }); assert.equal(r.status, 401, p + JSON.stringify(headers)); assert.ok(!/PRIVATE|1234|moneyEngine/.test(r.body));
      }
    }
  } finally { await s.close(); }
});
test("with the right token (header or Bearer) the routes work; unknown routes are 404; non-GET is 405 for everyone", async () => {
  const s = await serve({ token: TOKEN });
  try {
    assert.equal(JSON.parse((await req(s.port, "/status", { headers: { "x-atlasz-token": TOKEN } })).body).status, "OK");
    assert.equal((await req(s.port, "/revenue", { headers: { authorization: "Bearer " + TOKEN } })).status, 200);
    assert.equal(JSON.parse((await req(s.port, "/events", { headers: { "x-atlasz-token": TOKEN } })).body).length, 1);
    const o = JSON.parse((await req(s.port, "/opportunities", { headers: { "x-atlasz-token": TOKEN } })).body); assert.equal(o.count, 1); assert.ok(!("description" in o.opportunities[0]));
    assert.equal((await req(s.port, "/nope", { headers: { "x-atlasz-token": TOKEN } })).status, 404);
    for (const m of ["POST", "PUT", "DELETE", "PATCH"]) { assert.equal((await req(s.port, "/status", { method: m, headers: { "x-atlasz-token": TOKEN } })).status, 405); assert.equal((await req(s.port, "/health", { method: m })).status, 405); }
  } finally { await s.close(); }
});
test("fail closed: no token configured, an empty token or a short token => protected routes are 503 (never 200), /health still works", async () => {
  for (const token of [undefined, "", "short", "x".repeat(RUNTIME_TOKEN_MIN_LENGTH - 1)]) {
    const s = await serve({ token });
    try { for (const h of [{}, { "x-atlasz-token": "" }, { "x-atlasz-token": token ?? "" }]) assert.equal((await req(s.port, "/status", { headers: h })).status, 503); assert.equal((await req(s.port, "/health")).status, 200); }
    finally { await s.close(); }
  }
});
test("brute force is throttled: after maxFailures wrong tokens even the RIGHT token is refused until the window passes", async () => {
  let t = 0; const s = await serve({ token: TOKEN, maxFailures: 3, windowMs: 1000, now: () => t });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await req(s.port, "/status", { headers: { "x-atlasz-token": "bad" + i } })).status, 401);
    assert.equal((await req(s.port, "/status", { headers: { "x-atlasz-token": "bad" } })).status, 429);
    assert.equal((await req(s.port, "/status", { headers: { "x-atlasz-token": TOKEN } })).status, 429);
    assert.equal((await req(s.port, "/health")).status, 200, "health is never throttled");
    t += 1001; assert.equal((await req(s.port, "/status", { headers: { "x-atlasz-token": TOKEN } })).status, 200);
  } finally { await s.close(); }
});
test("a failing runtime never leaks a stack or state through the error response", async () => {
  const s = await serve({ token: TOKEN, runtime: { state: { leads: [], events: [] }, dashboard: () => { throw new Error("SECRET-STACK-DETAIL /home/x"); } } });
  try { const r = await req(s.port, "/status", { headers: { "x-atlasz-token": TOKEN } }); assert.equal(r.status, 500); assert.deepEqual(JSON.parse(r.body), { error: "internal_error" }); } finally { await s.close(); }
});
test("REAL PROCESS: the canonical runtime refuses unauthenticated dashboard access, serves only a minimal /health, and does not boot open when no token is configured", async () => {
  const dir = tmp("rh-"), port = await freePort(), boot = token => spawn("node", [path.join(RUNTIME_DIR, "supervisor-safe.mjs")], { env: { ...process.env, ATLASZ_TEST_MODE: "0", PORT: String(port), ATLASZ_STATE_DIR: dir, ...(token ? { ATLASZ_RUNTIME_TOKEN: token } : { ATLASZ_RUNTIME_TOKEN: "" }) }, stdio: "ignore" });
  const waitUp = async () => { for (let i = 0; i < 100; i++) { try { const r = await req(port, "/health"); if (r.status === 200) return r; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); } throw new Error("DID_NOT_START"); };
  const stop = c => new Promise(r => { c.once("exit", r); c.kill("SIGTERM"); setTimeout(() => c.kill("SIGKILL"), 8000).unref(); });
  try {
    let c = boot(null);
    try { const h = await waitUp(); assert.deepEqual(Object.keys(JSON.parse(h.body)).sort(), ["ok", "version"]); for (const p of ["/", "/status", "/opportunities", "/events", "/revenue"]) assert.equal((await req(port, p)).status, 503, "no token configured => " + p); } finally { await stop(c); }
    c = boot(TOKEN);
    try { await waitUp(); for (const p of ["/", "/status", "/opportunities", "/events", "/revenue"]) { assert.equal((await req(port, p)).status, 401); }
      assert.equal((await req(port, "/status", { headers: { "x-atlasz-token": "nope" } })).status, 401);
      const st = JSON.parse((await req(port, "/status", { headers: { "x-atlasz-token": TOKEN } })).body); assert.equal(st.agents.length, 30); } finally { await stop(c); }
  } finally { rm(dir); }
});

test("a query string does not change routing or bypass auth: /opportunities?x=1 is 401 without token and 200 with it; /health?x is still minimal", async () => {
  const s = await serve({ token: TOKEN, maxFailures: 100000 });
  try {
    assert.equal((await req(s.port, "/opportunities?x=1")).status, 401);
    assert.equal((await req(s.port, "/opportunities?x=1", { headers: { "x-atlasz-token": TOKEN } })).status, 200);
    assert.equal((await req(s.port, "/health?full=1")).status, 200);
    assert.deepEqual(JSON.parse((await req(s.port, "/health?full=1")).body), { ok: true, version: "9.9.9" });
  } finally { await s.close(); }
});
