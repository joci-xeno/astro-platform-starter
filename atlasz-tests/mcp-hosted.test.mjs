// C06 slice hosted by the real Control Center over HTTP: MCP server folders are discovered only under <config>/mcp-servers, starting needs the owner passphrase, calls are bound to exact arguments.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-server"), PW = "correct horse battery", caps = detectNodeRestrictions();
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const raw = (port, p, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: p, method, headers }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); q.on("error", reject); if (body) q.write(body); q.end(); });
test("HTTP: MCP - discovery, owner-passphrase start, per-call approval, hostile output contained, kill switch stops the server", { skip: !(caps.permission && caps.namespace) && "host cannot isolate network" }, async () => {
  const base = tmp("mcph-"), stateDir = path.join(base, "s"), configDir = path.join(base, "c"); fs.mkdirSync(stateDir, { recursive: true });
  const dir = path.join(configDir, "mcp-servers", "local-demo"); fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.cpSync(FIX, dir, { recursive: true }); fs.writeFileSync(path.join(dir, "mcp-server.json"), JSON.stringify({ entry: "server.mjs", description: "demo" }));
  fs.mkdirSync(path.join(configDir, "mcp-servers", "no-config"), { recursive: true });
  const cc = createControlCenterServer({ stateDir, configDir, port: await freePort() }); const { port, token } = await cc.listen(); const H = { host: "127.0.0.1:" + port };
  const post = (p, b, t = token) => raw(port, p, { method: "POST", headers: { ...H, "content-type": "application/json", ...(t ? { "x-atlasz-token": t } : {}) }, body: JSON.stringify(b) });
  const get = (p, t = token) => raw(port, p, { headers: { ...H, ...(t ? { "x-atlasz-token": t } : {}) } });
  const J = async r => JSON.parse(r.body), P = async (p, b) => (await J(await post(p, b))).result;   // actions come back as {ok, result:{ok, result}}
  try {
    assert.equal((await get("/api/mcp", null)).status, 401);
    await post("/api/owner-key", { passphrase: PW });
    const v = await J(await get("/api/mcp")); assert.deepEqual(v.servers.map(x => [x.id, x.running]), [["local-demo", false]]); assert.deepEqual(v.rejected.map(x => x.name), ["no-config"]);
    for (const body of [{ id: "local-demo" }, { id: "local-demo", passphrase: "wrong wrong wrong" }]) { const r = await P("/api/mcp/start", body); assert.equal(Boolean(r.ok && r.result?.ok), false); }
    assert.equal((await J(await get("/api/mcp"))).servers[0].running, false);
    const st = await P("/api/mcp/start", { id: "local-demo", passphrase: PW }); assert.equal(st.result.ok, true, JSON.stringify(st)); assert.ok(st.result.tools.some(t => t.name === "echo"));
    assert.equal((await P("/api/mcp/call", { id: "local-demo", tool: "echo", args: { text: "hi" } })).result.ok, false, "no passphrase, no call");
    const c1 = await P("/api/mcp/call", { id: "local-demo", tool: "echo", args: { text: "hi" }, passphrase: PW }); assert.deepEqual([c1.result.ok, c1.result.text, c1.result.untrusted], [true, "echo:hi", true]);
    const ev = await P("/api/mcp/call", { id: "local-demo", tool: "evil", args: {}, passphrase: PW }); assert.ok(ev.result.injectionSignals >= 1 && !ev.result.text.includes("ABCDEFGHIJKLMNOPQRSTUV"));
    const bad = await P("/api/mcp/call", { id: "local-demo", tool: "add", args: { a: "x", b: 1 }, passphrase: PW }); assert.equal(bad.result.reason, "INVALID_ARGUMENTS");
    assert.equal(JSON.parse((await post("/api/emergency", { mode: "PAUSE_ALL", passphrase: PW })).body).ok, true);
    const stopped = await P("/api/mcp/call", { id: "local-demo", tool: "echo", args: { text: "x" }, passphrase: PW }); assert.equal(stopped.result.reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    assert.equal((await J(await get("/api/mcp"))).servers[0].running, false, "the kill switch stopped the server");
    for (const id of ["../x", "a/b", "Local"]) assert.equal(Boolean((await P("/api/mcp/start", { id, passphrase: PW })).result?.ok), false, id);
  } finally { await cc.close?.(); rm(base); }
});
