// Staging validation of start:canonical (supervisor-safe.mjs): in-process + a real server process.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmp, rm } from "./helpers.mjs";

process.env.ATLASZ_TEST_MODE = "1";                       // supervisor-safe must not start its server on import
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(HERE, "..", "atlasz-runtime");
const { createRuntime, qualify, VERSION } = await import("../atlasz-runtime/supervisor-safe.mjs");

const hit = (id, text, daysAgo = 1) => ({ objectID: id, created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), comment_text: text + " [ref " + id + "]", story_title: "Ask HN: Freelancer?" });
const goodText = "We are looking for a developer for a freelance project: need help with a website, remote, budget $2,000. Contact jobs@example.com";
const fakeFetch = hits => async () => ({ ok: true, status: 200, json: async () => ({ hits }) });

test("canonical topology is exactly 5 SEARCH + 25 EXECUTION = 30 and nothing claims spend/outreach/payment", () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: fakeFetch([]) });
    const a = rt.state.agents;
    assert.equal(a.length, 30); assert.equal(a.filter(x => x.role === "SEARCH").length, 5); assert.equal(a.filter(x => x.role === "EXECUTION").length, 25);
    assert.equal(new Set(a.map(x => x.id)).size, 30);
    const dash = rt.dashboard();
    assert.equal(dash.status, "PARTIAL_BLOCKED"); assert.equal(dash.capabilities.emailSending, false); assert.equal(dash.capabilities.paymentVerification, false);
    assert.equal(dash.capabilities.aiExecution, false); assert.equal(dash.metrics.outreachSent, 0); assert.equal(dash.metrics.won, 0);
    assert.ok(dash.blockers.some(b => b.code === "AI_EXECUTION_DISABLED_NO_SPEND")); assert.ok(dash.blockers.some(b => b.code === "PAYMENT_VERIFICATION_NOT_CONNECTED"));
    assert.equal(dash.internalAddons.externalSideEffects, false);
  } finally { rm(d); }
});

test("search -> screening produces evidence-bearing leads, never a sent offer", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: fakeFetch([hit("1", goodText), hit("2", "I am available for hire, see my portfolio"), hit("3", goodText, 90)]) });
    await rt.search(0);
    assert.equal(rt.state.candidates.length, 3);
    for (let i = 5; i < 8; i++) await rt.execute(i);
    const by = Object.fromEntries(rt.state.candidates.map(c => [c.id, c]));
    assert.equal(by["hn-1"].status, "NEEDS_VERIFICATION"); assert.equal(by["hn-2"].status, "REJECTED"); assert.equal(by["hn-3"].status, "REJECTED");
    assert.ok(by["hn-2"].assessment.reject.includes("SELLER_NOT_BUYER")); assert.ok(by["hn-3"].assessment.reject.includes("STALE_OR_UNDATED"));
    const lead = rt.state.leads[0]; assert.equal(lead.outreachStatus, "NOT_SENT"); assert.equal(lead.projectStatus, "NOT_WON"); assert.equal(lead.paidValue, null);
    assert.match(rt.state.artifacts[0].qa, /PASSED/); assert.equal(qualify(by["hn-1"]).leadValue.amount, 2000);
  } finally { rm(d); }
});

test("source failure is reported as BLOCKED with the error, not hidden", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: async () => { throw new Error("ENETUNREACH"); } });
    await rt.search(1);
    assert.equal(rt.state.agents[1].status, "BLOCKED"); assert.equal(rt.state.sourceErrors["SEARCH-2"], "ENETUNREACH");
    assert.equal(rt.dashboard().search.runningOrScheduled < 5, true);
  } finally { rm(d); }
});

test("restart: state is restored, candidates stuck in PROCESSING (crash) are returned to the queue, no duplicates", async () => {
  const d = tmp(); try {
    const rt = createRuntime({ dataDir: d, fetchImpl: fakeFetch([hit("11", goodText), hit("12", goodText)]) });
    await rt.search(0); rt.state.candidates[0].status = "PROCESSING"; rt.save();        // simulates a crash mid-screening
    const rt2 = createRuntime({ dataDir: d, fetchImpl: fakeFetch([hit("11", goodText), hit("12", goodText)]) });
    assert.equal(rt2.recoveredStalled, 1); assert.equal(rt2.state.candidates.length, 2);
    await rt2.search(0); assert.equal(rt2.state.candidates.length, 2, "same ids are not re-added");
    await rt2.execute(5); await rt2.execute(6); assert.equal(rt2.state.leads.length, 2);
  } finally { rm(d); }
});

test("refuses to start on a corrupted state file instead of overwriting it", () => {
  const d = tmp(); try {
    fs.writeFileSync(path.join(d, "atlasz-state.json"), JSON.stringify({ leads: "oops", candidates: [] }));
    assert.throws(() => createRuntime({ dataDir: d, fetchImpl: fakeFetch([]) }), /Invalid saved state/);
  } finally { rm(d); }
});

test("update-freeze gate stops external search dispatch but not internal screening", async () => {
  const d = tmp(); try {
    let frozen = true; let calls = 0;
    const rt = createRuntime({ dataDir: d, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => ({ hits: [hit("21", goodText)] }) }; },
      updateGate: ({ external }) => (frozen && external ? { allowed: false, reason: "UPDATE_FREEZE:test" } : { allowed: true, reason: null }) });
    await rt.search(0); assert.equal(calls, 0); assert.equal(rt.state.agents[0].status, "HALTED_BY_OWNER_STOP");
    frozen = false; await rt.search(0); assert.equal(calls, 1); assert.equal(rt.state.candidates.length, 1);
  } finally { rm(d); }
});

function get(port, p) { return new Promise((res, rej) => { http.get({ port, path: p, host: "127.0.0.1" }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { try { res({ status: r.statusCode, body: JSON.parse(b) }); } catch (e) { rej(e); } }); }).on("error", rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) { const t = Date.now(); let last; while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(150); } throw new Error("TIMEOUT " + (last?.message || "")); }

test("REAL PROCESS: canonical server boots, serves read-only status, obeys an external owner kill switch, resumes, shuts down cleanly", async () => {
  const dir = tmp(), keyDir = tmp(), port = 18000 + Math.floor(Math.random() * 1000);
  const keyFile = path.join(keyDir, "owner.pem");
  const pub = execFileSync("node", [path.join(RUNTIME, "owner-cli.mjs"), "keygen", "--out", keyFile], { encoding: "utf8" }).trim().split("\n").pop();
  const child = spawn("node", [path.join(RUNTIME, "supervisor-safe.mjs")], { env: { ...process.env, ATLASZ_TEST_MODE: "0", PORT: String(port), ATLASZ_STATE_DIR: dir, ATLASZ_OWNER_PUBLIC_KEY: pub }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", d => out += d);
  const exited = new Promise(r => child.on("exit", (code, sig) => r({ code, sig })));
  try {
    const h = await waitFor(async () => { const r = await get(port, "/health"); return r.status === 200 ? r.body : null; });
    assert.equal(h.ok, true); assert.equal(h.version, VERSION);
    const st = (await get(port, "/status")).body;
    assert.equal(st.agents.length, 30); assert.equal(st.search.configured, 5); assert.equal(st.execution.configured, 25);
    assert.equal(st.emergency.mode, "RUNNING"); assert.equal(st.internalAddons.externalSideEffects, false);
    const post = await new Promise((res, rej) => { const rq = http.request({ port, host: "127.0.0.1", method: "POST", path: "/status" }, r => { r.resume(); res(r.statusCode); }); rq.on("error", rej); rq.end(); });
    assert.equal(post, 405, "server must be read-only");
    assert.equal((await get(port, "/nope")).status, 404);

    execFileSync("node", [path.join(RUNTIME, "owner-cli.mjs"), "emergency", "--key", keyFile, "--state-dir", dir, "--mode", "PAUSE_ALL", "--reason", "staging drill"]);
    const halted = await waitFor(async () => { const s = (await get(port, "/status")).body; return s.emergency.mode === "PAUSE_ALL" && s.agents.slice(5).every(a => a.status === "HALTED_BY_OWNER_STOP") ? s : null; });
    assert.equal(halted.emergency.banner, "EMERGENCY STOP ACTIVE");
    assert.ok(halted.agents.slice(0, 5).every(a => ["HALTED_BY_OWNER_STOP", "BLOCKED", "RUNNING", "SCHEDULED", "WAITING_FOR_INPUT"].includes(a.status)), "search agents may be idle between cycles (SCHEDULED) when the source is reachable; every dispatch is gated: " + JSON.stringify(halted.agents.slice(0, 5).map(a => a.status)));

    execFileSync("node", [path.join(RUNTIME, "owner-cli.mjs"), "emergency", "--key", keyFile, "--state-dir", dir, "--mode", "RUNNING", "--confirm", "RESUME"]);
    await waitFor(async () => { const s = (await get(port, "/status")).body; return s.emergency.mode === "RUNNING" && s.agents.slice(5).some(a => a.status !== "HALTED_BY_OWNER_STOP") ? s : null; });

    child.kill("SIGTERM");
    const ex = await Promise.race([exited, sleep(8000).then(() => "HUNG")]);
    assert.notEqual(ex, "HUNG", "must exit on SIGTERM"); if (process.platform === "win32") assert.ok(ex !== "HUNG"); else assert.equal(ex.code, 0);   // Windows has no POSIX SIGTERM: kill() terminates the process, so graceful-exit code 0 is only asserted on POSIX
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "atlasz-state.json"), "utf8")); assert.equal(saved.agents.length, 30);
    const chain = fs.readFileSync(path.join(dir, "emergency-audit.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(chain.filter(e => e.event === "EMERGENCY_MODE_CHANGED").length, 2);
  } finally { if (child.exitCode === null) child.kill("SIGKILL"); rm(dir); rm(keyDir); }
});
