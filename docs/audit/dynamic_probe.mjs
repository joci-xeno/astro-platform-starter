// Task 3 dynamic probe (reproducible): boots the runtime and the Control Center in a temp dir and records what is ACTUALLY reachable and how it responds.
// Read-only: GET every route with the token; POST routes are only probed WITHOUT a token / with a wrong token (must be 401) so no state is changed. Run from repo root: node docs/audit/dynamic_probe.mjs
process.env.ATLASZ_TEST_MODE = "1";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; import net from "node:net";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { createRuntime } = await import(root + "/atlasz-runtime/supervisor-safe.mjs");
const { createControlCenterServer } = await import(root + "/atlasz-control-center/server.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aud-"));
const rt = createRuntime({ dataDir: path.join(tmp, "rt"), retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
const out = { runtime: { agents: rt.state.agents.length, teams: rt.state.agents.reduce((a, x) => (a[x.role] = (a[x.role] || 0) + 1, a), {}), tools: rt.tools.describe().map(t => ({ name: t.name, operation: t.operation })) } };
const free = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const cc = createControlCenterServer({ stateDir: path.join(tmp, "s"), configDir: path.join(tmp, "c"), port: await free() });
const { port, token } = await cc.listen();
const call = (method, p, tok, host) => new Promise(res => { const rq = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: host ?? "127.0.0.1:" + port, ...(tok ? { "x-atlasz-token": tok } : {}), "content-type": "application/json" } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ status: r.statusCode, body: b })); }); rq.on("error", e => res({ status: 0, body: String(e) })); rq.end(method === "POST" ? "{}" : undefined); });
const routes = JSON.parse(fs.readFileSync(path.join(root, "docs/audit/static_scan.json"), "utf8")).routes; out.routes = {};
for (const r of Object.keys(routes)) {
  const g = await call("GET", r, token); const isGet = g.status !== 404 && g.status !== 405;
  const rec = { method: isGet ? "GET" : "POST" };
  if (isGet) { rec.noToken = (await call("GET", r, null)).status; rec.wrongToken = (await call("GET", r, "wrong")).status; rec.withToken = g.status; try { JSON.parse(g.body); rec.json = true; } catch { rec.json = false; } rec.bytes = g.body.length; rec.reportsError = /"state":"(UNREADABLE|ERROR)"|"error":/.test(g.body); }
  else { rec.noToken = (await call("POST", r, null)).status; rec.wrongToken = (await call("POST", r, "wrong")).status; }
  out.routes[r] = rec;
}
out.hostRebinding = (await call("GET", "/api/status", token, "evil.example.com")).status;
out.indexHtml = (await call("GET", "/", null)).status;
await cc.close?.(); fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(root, "docs/audit/dynamic_probe.json"), JSON.stringify(out, null, 1));
const R = Object.entries(out.routes);
console.log("tools", out.runtime.tools.length, "agents", out.runtime.agents, out.runtime.teams);
console.log("routes", R.length, "GET", R.filter(([, v]) => v.method === "GET").length, "POST", R.filter(([, v]) => v.method === "POST").length);
console.log("GET not 200:", R.filter(([, v]) => v.method === "GET" && v.withToken !== 200).map(([k, v]) => k + ":" + v.withToken));
console.log("GET open without token:", R.filter(([, v]) => v.method === "GET" && v.noToken === 200).map(([k]) => k));
console.log("POST not 401 w/o token:", R.filter(([, v]) => v.method === "POST" && (v.noToken !== 401 || v.wrongToken !== 401)).map(([k, v]) => k + ":" + v.noToken + "/" + v.wrongToken));
console.log("GET reporting error state:", R.filter(([, v]) => v.reportsError).map(([k]) => k)); console.log("host rebinding status", out.hostRebinding, "index", out.indexHtml);
process.exit(0);
