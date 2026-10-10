// ATLASZ V7.3 M6 demonstration. Runs the REAL Control Center server process (the same entry the Electron shell wraps), the real coordinator, the real market-data / ORB / backtest / paper-trading
// modules and the real memory store, in a throw-away state directory. Nothing touches a network, a broker, a credential or the owner's real state.  Usage: node docs/demo/m6_demo.mjs [evidence.json]
// Honest limits are printed in the evidence: no live market data exists (SIMULATED/HISTORICAL only), no Windows run was possible here, agent "work" is the real coordinator workflow with real computations (not a language-model session).
process.env.ATLASZ_TEST_MODE = "1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createCoordinator } from "../../atlasz-addons/agent-coordination.mjs";
import { generateSimulated, makeDataset } from "../../atlasz-addons/market-data.mjs";
import { runBacktest } from "../../atlasz-addons/backtest.mjs";
import { createPaperTrader } from "../../atlasz-addons/paper-trader.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../../atlasz-addons/owner-auth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), PW = "demo passphrase only";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atlasz-m6-demo-")), stateDir = path.join(home, "state"), ev = { generatedAt: new Date().toISOString(), host: `${os.platform()} ${os.arch()} node ${process.version}`, items: {} };
const sha = t => crypto.createHash("sha256").update(t).digest("hex"), sleep = ms => new Promise(r => setTimeout(r, ms)), CFG = { anchor: "UTC_ASIA" };
const log = (k, v) => { ev.items[k] = v; console.log(`\n== ${k}\n${JSON.stringify(v, null, 1).slice(0, 1800)}`); };

// 1. launch ----------------------------------------------------------------------------------------------------------------------------------------------------------
const child = spawn(process.execPath, [path.join(root, "atlasz-control-center/server.mjs")], { env: { ...process.env, ATLASZ_HOME: home, ATLASZ_OPEN_BROWSER: "0", ATLASZ_CC_PORT: "0", ATLASZ_RUNTIME_PORT: "0", ATLASZ_TRADING_TICK_MS: "1000" }, stdio: ["ignore", "pipe", "pipe"] });
const url = await new Promise((res, rej) => { let b = ""; child.stdout.on("data", d => { b += d; const m = /(http:\/\/127\.0\.0\.1:\d+\/#\w+)/.exec(b); if (m) res(m[1]); }); child.on("exit", c => rej(new Error("server exited " + c))); setTimeout(() => rej(new Error("launch timeout")), 15000); });
const base = url.split("#")[0], token = url.split("#")[1], H = { "x-atlasz-token": token };
const get = async p => (await fetch(base.slice(0, -1) + p, { headers: H })).json(), post = async (p, b) => (await fetch(base.slice(0, -1) + p, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(b) })).json();
const act = async b => (await post("/api/trading/action", b)).result;
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
log("1_launch", { serverProcess: "node atlasz-control-center/server.mjs started and answering on 127.0.0.1 with a per-launch token", status200: Boolean((await get("/api/status")).runtime), electronShellPresent: fs.existsSync(path.join(root, "atlasz-control-center/electron/main.mjs")), electronScripts: Object.keys(pkg.scripts ?? {}).filter(k => /electron|control|win/i.test(k)),
  windows: "NOT VERIFIED HERE: this session runs on Linux. The Windows installer build is manual-only and was not run; the same server entry the Electron shell wraps was launched." });
await post("/api/owner-key", { passphrase: PW });

// 2/3. agents + one complete authorised workflow (maker-checker over a real backtest) -------------------------------------------------------------------------------
const before = await get("/api/agents/activity"); const co = createCoordinator({ dir: path.join(stateDir, "coordination"), toolsOf: () => ["notes"] });
const sim = generateSimulated({ instrument: "SIM-BTCUSD", interval: "5m", seed: 42, days: 60, drift: 0.0001 }).dataset;
const maker = co.connect("EXECUTION-3"), checker = co.connect("EXECUTION-4");
maker.register({ id: "wf-orb-1", kind: "build.orb-backtest", payload: { dataset: sim.sha256, config: CFG } }); maker.start("wf-orb-1");
const mid = await get("/api/agents/activity"); const result = runBacktest({ dataset: sim, config: CFG }); const out = maker.complete("wf-orb-1", result.resultSha256);
const verifierId = co.verifierOf("wf-orb-1"), ver = co.connect(verifierId), recheck = runBacktest({ dataset: sim, config: CFG });      // the checker re-runs the computation from the same inputs
const accepted = ver.verify("wf-orb-1", { decision: recheck.resultSha256 === result.resultSha256 ? "ACCEPT" : "REJECT", resultSha256: recheck.resultSha256 }); const after = await get("/api/agents/activity");
const st = a => Object.fromEntries(a.agents.filter(x => x.state !== "IDLE" && x.state !== "UNKNOWN").map(x => [x.id, x.state]));
log("2_agent_status", { before: { available: before.available, counts: before.counts }, duringWorkflow: { counts: mid.counts, nonIdle: st(mid) }, after: { counts: after.counts, recentEvents: after.recentEvents.slice(-4) } });
log("3_authorised_workflow", { task: "wf-orb-1 (build.orb-backtest)", maker: "EXECUTION-3", checker: verifierId, completed: out.ok, checkerDecision: accepted, resultSha256: result.resultSha256, trades: result.metrics.trades, note: "Real coordinator hand-offs and a real independent re-computation; no language model was involved in this demo." });

// 4/5. charts with identified sources + reproducible backtest --------------------------------------------------------------------------------------------------------
await act({ op: "generate", id: "demo-sim", seed: 42, days: 60, drift: 0.0001 }); const c1 = await get(`/api/trading/candles?dataset=demo-sim&limit=288&config=${encodeURIComponent(JSON.stringify(CFG))}&markers=backtest`);
const b1 = await act({ op: "backtest", dataset: "demo-sim", config: CFG }), b2 = await act({ op: "backtest", dataset: "demo-sim", config: CFG });
log("4_charts", { banner: c1.banner, source: c1.dataset.source, kind: c1.dataset.kind, datasetSha256: c1.dataset.sha256, freshness: c1.freshness.label, candles: c1.candles.length, orbLevels: c1.levels.length, markers: c1.markers.length, liveData: (await get("/api/trading")).liveData });
log("5_backtest", { resultSha256: b1.resultSha256, repeatedRunIdentical: b1.resultSha256 === b2.resultSha256, matchesWorkflowHash: b1.resultSha256 === result.resultSha256, metrics: b1.metrics, assumptions: b1.assumptions, label: b1.label });

// 6/7. autonomous paper session (the server's own scheduler feeds it) ------------------------------------------------------------------------------------------------
const verdict = await act({ op: "evaluate", dataset: "demo-sim", config: CFG }); const add = await act({ op: "paperAdd", id: "demo-orb", dataset: "demo-sim", config: CFG, passphrase: verdict.status === "REJECTED" ? PW : undefined });
const t0 = (await get("/api/trading")).paper.feeds["demo-orb"].cursor; await sleep(6000); const t1 = await get("/api/trading"); await act({ op: "paperTick", candles: 4000 }); const t2 = await get("/api/trading");
log("6_autonomous_paper_session", { verdict: verdict.status, reasons: verdict.reasons, admittedBy: add.basis, cursorBefore: t0, cursorAfter6s: t1.paper.feeds["demo-orb"].cursor, advancedWithoutManualStart: t1.paper.feeds["demo-orb"].cursor > t0, label: t2.paper.label });
log("7_pnl_and_risk", { account: t2.paper.account, trades: t2.paper.trades.length, last3: t2.paper.trades.slice(-3).map(t => ({ side: t.side, r: +t.r.toFixed(2), pnl: +t.pnl.toFixed(2), reason: t.exitReason, dataKind: t.dataKind })), warnings: t2.paper.warnings, auditChainOk: t2.paperAuditOk });
// risk-limit suspension (strict limits, separate in-memory account): shows automatic suspension + signed resume
{ const kp = generateOwnerKeyPair(), ap = (a, s) => issueOwnerApproval({ privateKeyPem: kp.privateKeyPem, action: a, subject: s }), dir = fs.mkdtempSync(path.join(home, "risk-")), pt = createPaperTrader({ dir, ownerAuth: createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), limits: { dailyLossPct: 0.4 } });
  pt.addStrategy({ id: "risk-demo", instrument: "SIM-BTCUSD", interval: "5m", config: { ...CFG, spreadBps: 0, slippageBps: 0, commissionBps: 0, minRangeBps: 0 }, evaluation: { status: "SIMULATED_ONLY_NO_EDGE_CLAIM", evidenceSha256: "d".repeat(64) } });
  const D0 = Date.UTC(2026, 0, 6), cs = [[100, 101, 99, 100], [100, 102, 99.5, 101], [101, 101.5, 98, 100], [100, 103.5, 100, 103], [103.2, 104, 97, 98]]; cs.forEach(([o, h, l, c], i) => pt.onCandle("risk-demo", { t: D0 + i * 300000, o, h, l, c, v: 100 }));
  const s = pt.report().strategies[0], sub = pt.resumeSubject("risk-demo"), resumeNoAuth = pt.resume("risk-demo", null), resumed = pt.resume("risk-demo", ap(sub.action, sub.subject)), replay = pt.resume("risk-demo", ap(sub.action, sub.subject));
  log("7b_risk_limit_and_signed_resume", { statusAfterLoss: s.status, reason: s.suspendedReason, resumeWithoutApproval: resumeNoAuth.reason, resumeWithSignedApproval: resumed.ok, secondResume: replay.reason, liveTradingRequest: pt.requestLiveTrading("demo").reason }); }

// 8. real agent-memory retrieval ------------------------------------------------------------------------------------------------------------------------------------------
const note = await post("/api/memory/action", { op: "addNote", title: "ORB research finding", body: "Opening range breakout on simulated drift data: expectancy depends on costs; never treat it as proof of profit.", classification: "PERSONAL" });
const found = await post("/api/memory/action", { op: "search", query: "opening range breakout expectancy costs" }); const mem = await get("/api/memory");
log("8_memory_retrieval", { noteWritten: note.result?.ok, hits: found.result?.results?.map(r => ({ title: r.title, classification: r.classification, lexical: r.lexical })), retrieval: found.result?.retrieval, backend: found.result?.backend, semantic: found.result?.semantic, neuralStatus: mem.indexing?.semantic?.reason ?? mem.indexing?.semantic, note: "Neural embeddings are NOT active (owner approval EMBEDDING_ACTIVATE + a local model are required). The n-gram similarity is labelled non-neural." });

// 9. owner approvals + security controls ------------------------------------------------------------------------------------------------------------------------------
const live = await act({ op: "liveRequest", why: "demo" }), noPass = await post("/api/trading/action", { op: "paperResume", id: "demo-orb" }), emerg = await post("/api/owner-safety/action", { action: "EMERGENCY_STOP", passphrase: PW }), frozen = await act({ op: "paperTick", candles: 5 });
log("9_owner_controls", { liveTrading: live.reason, resumeWithoutPassphrase: noPass.error ?? noPass, emergencyStop: Boolean(emerg.ok), paperTradingAfterStop: frozen.reason, approvals: Object.keys((await get("/api/approvals"))).slice(0, 4), note: "Kill switch recovery is owner-only; this demo state directory is discarded." });

// 10. revenue reporting ---------------------------------------------------------------------------------------------------------------------------------------------------
const rev = await get("/api/revenue-dashboard");
log("10_revenue_reporting", { realBusiness: { state: rev.realBusiness.state, verifiedReceivedUsd: rev.realBusiness.verifiedReceivedUsd, unconfirmedPipelineUsd: rev.realBusiness.unconfirmedPipelineUsd }, simulatedPaperTrading: { label: rev.simulatedPaperTrading.label, realisedPnlSimUsd: +rev.simulatedPaperTrading.realisedPnl.toFixed(2) }, combinedTotal: rev.combinedTotal, separation: rev.separationNote });

child.kill(); const file = process.argv[2]; if (file) fs.writeFileSync(file, JSON.stringify(ev, null, 1)); fs.rmSync(home, { recursive: true, force: true }); console.log("\nDEMO COMPLETE" + (file ? " -> " + file : "")); process.exit(0);
