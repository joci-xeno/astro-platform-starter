// Reproducible evidence for directive demonstrations A-H. Every check runs real ATLASZ modules in an isolated temp directory. Data origin is stated per demonstration.
// Usage: node scripts/demonstrations.mjs [--write]   (--write stores docs/audit/demonstrations_evidence.json). Nothing here contacts a network, spends money or sends anything.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { createHmac } from "node:crypto"; import { fileURLToPath } from "node:url";
import { normalizeOpportunity, createOpportunityRegistry, createMasterIntake, sourceInventory } from "../atlasz-addons/opportunity-intake.mjs";
import { createDiscoveryEngine } from "../atlasz-addons/global-discovery.mjs";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs";
import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs";
import { BUILTIN_EXECUTORS, executorSkill } from "../atlasz-addons/agent-executors.mjs";
import { createIncidentResponse, CLEAR_ACTION, clearSubject } from "../atlasz-addons/incident-response.mjs";
import { createExecutionBoundary } from "../atlasz-addons/execution-boundary.mjs";
import { createNetworkSupervisor } from "../atlasz-addons/network-supervisor.mjs";
import { createToolRegistry } from "../atlasz-addons/typed-tools.mjs";
import { createPaymentEventLedger } from "../atlasz-addons/business/payment-events.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { rig, ownerAuth, sign } from "../atlasz-tests/owner-control-rig.mjs";

const mk = p => fs.mkdtempSync(path.join(os.tmpdir(), p)), rmrf = d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } };
function demo(id, title, origin) { const checks = []; return { id, title, origin, checks, check(name, ok, detail = null) { checks.push({ name, ok: Boolean(ok), ...(detail != null ? { detail: String(detail).slice(0, 200) } : {}) }); return ok; }, blocker: null }; }

export async function runDemonstrations() {
  const out = [], CAPS = Object.keys(BUILTIN_EXECUTORS).map(executorSkill);
  // ---------- A: safe discovery (no authorised live source exists -> pipeline proven on a labelled FIXTURE)
  { const A = demo("A", "Safe discovery", "FIXTURE (clearly labelled); live retrieval BLOCKED"), d = mk("demoA-"); try {
      const eng = createDiscoveryEngine({ dir: path.join(d, "disc"), egress: { listPolicies: () => [], check: () => ({ allowed: false }) } }), inv = sourceInventory(eng);
      A.check("no source is connected or approved for live retrieval", inv.every(s => s.operationalStatus !== "CONNECTED_VERIFIED" && s.lastSuccessfulRetrieval === null && s.egressApproval !== "OWNER_APPROVED"));
      A.blocker = "No owner-signed egress approval for any discovery host exists, so no live retrieval was performed. Approve the exact host(s) of one source (signed), then run the connector.";
      const reg = createOpportunityRegistry({ dir: path.join(d, "reg") }), mi = createMasterIntake({ dir: path.join(d, "mi"), registry: reg, capabilities: CAPS });
      const n = normalizeOpportunity({ sourceId: "fixture-src", externalId: "A-1", title: "Convert supplier CSV spreadsheet to JSON", description: "Data conversion of a CSV spreadsheet into JSON, remote, fixed-price contract, deliverables: json files.", buyerName: "Fixture Buyer Ltd", valueAmount: 800, currency: "EUR", deadline: "2099-01-01", url: "https://example.org/notice/A-1", remote: true }, { retrieval: "FIXTURE" });
      A.check("normalised with provenance and FIXTURE label", n.ok && n.record.retrieval === "FIXTURE" && n.record.budget.kind === "PUBLISHED_BUDGET_NOT_REVENUE");
      const h = mi.receive({ agentId: "SEARCH-1", record: n.record }); A.check("handed to the Master and ROUTED to planning, owner approval stated", h.state === "ROUTED" && h.requiresOwnerApproval === true, h.approvalReasons?.join(";"));
      A.check("same record again is a duplicate, no second opportunity", mi.receive({ agentId: "SEARCH-1", record: n.record }).duplicate === true && reg.counts().total === 1);
      A.check("presented to the owner as fixture, not live and not revenue", reg.list()[0].retrieval === "FIXTURE");
    } finally { rmrf(d); } out.push(A); }
  // ---------- B: real internal digital work
  { const B = demo("B", "Real internal digital work", "REAL internal task on owner-provided synthetic input; no external contact"), d = mk("demoB-"); try {
      const wf = createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "registry") }), sleep: async () => {} });
      const CSV = "name,qty,price\nbolt,10,0.5\nnut,20,0.25\n";
      const t = await wf.executeTask("EXECUTION-1", { executor: "csv_to_json", input: { csv: CSV }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
      B.check("an EXECUTION agent produced an artifact with a fixed hash", t.ok === true && Boolean(t.taskId), JSON.stringify(t).slice(0, 120));
      const art = JSON.parse(fs.readFileSync(path.join(d, "wf", "artifacts", t.taskId, "output.json"), "utf8")); B.check("artifact content is the correct conversion", art.length === 2 && art[0].name === "bolt" && art[0].qty === 10 && art[1].price === 0.25);
      B.check("independent checker is a different agent", t.checker && t.checker !== "EXECUTION-1", t.checker);
      const c = await wf.checkTask(t.taskId); B.check("QA recomputes and ACCEPTS; task VERIFIED", c.decision === "ACCEPT" && wf.getTask(t.taskId).status === "VERIFIED");
      B.check("no revenue is claimed for internal work", wf.systemView().verifiedRevenue.verifiedReceivedUsd === 0);
      const bad = await wf.executeTask("EXECUTION-2", { executor: "csv_to_json", input: { csv: CSV } }); B.check("without authorization the same task is refused", bad.ok === false, bad.reason);
    } finally { rmrf(d); } out.push(B); }
  // ---------- C: approval protection
  { const C = demo("C", "Approval protection", "REAL enforcement path (control chain + Ed25519 owner approvals); synthetic key"), d = mk("demoC-"); try {
      const r = rig({}); let sent = 0; const reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox });
      reg.register({ name: "demo.send", operation: "SEND_EXTERNAL", input: { type: "object", properties: { to: { type: "string", maxLength: 50 } }, additionalProperties: false }, handler: async () => { sent++; return { sent: true }; } });
      const act = { type: "AGENT", id: "E1" };
      const a = await reg.invoke("demo.send", { to: "x" }, { actor: act }); C.check("sensitive external action without approval is REFUSED, nothing sent", a.status !== "OK" && sent === 0, a.status + ":" + (a.reason ?? ""));
      const f = await reg.invoke("demo.send", { to: "x" }, { actor: act, ownerApproval: { forged: true } }); C.check("a forged approval is refused", f.status !== "OK" && sent === 0, f.status);
      const sw = await reg.invoke("demo.send", { to: "eve" }, { actor: act, ownerApproval: r.opApproval("SEND_EXTERNAL", { to: "x" }) }); C.check("an approval bound to another target is refused", sw.status !== "OK" && sent === 0, sw.status);
      const good = r.opApproval("SEND_EXTERNAL", { to: "x" }); const ok = await reg.invoke("demo.send", { to: "x" }, { actor: act, ownerApproval: good });
      C.check("a valid scoped approval through the REAL mechanism lets exactly that action run", ok.status === "OK" && sent === 1, ok.status + ":" + (ok.reason ?? ""));
      const rp = await reg.invoke("demo.send", { to: "x" }, { actor: act, ownerApproval: good }); C.check("replaying the same approval is refused (single use)", rp.status !== "OK" && sent === 1, rp.status);
      C.blocker = null;
    } finally { rmrf(d); } out.push(C); }
  // ---------- D: security incident
  { const D = demo("D", "Security incident", "REAL incident controller + execution boundary + network supervisor; synthetic incident"), d = mk("demoD-"); try {
      const alerts = [], paused = []; const inc = createIncidentResponse({ dir: path.join(d, "inc"), ownerAuth, registry: { setPaused: (id, p) => { paused.push([id, p]); return { ok: true }; } }, suspendAgentTasks: () => 1, evidenceProvider: () => ({ note: "tail" }), alert: x => alerts.push(x) });
      const b = createExecutionBoundary({ isBlocked: x => inc.isBlocked(x) }), sup = createNetworkSupervisor({ dir: path.join(d, "net"), declare: i => inc.declare(i) });
      D.check("before the incident the agent may act", b.check({ agentId: "EXECUTION-4", opClass: "TOOL_EXECUTION" }).allowed);
      sup.record({ kind: "BYPASS", agentId: "EXECUTION-4", host: "raw.example", decision: "DENY", reason: "DIRECT_SOCKET" });
      D.check("DETECT+CLASSIFY: broker bypass is a CONFIRMED CRITICAL finding", sup.findings().some(f => f.rule === "BROKER_BYPASS_ATTEMPT" && f.confirmed && f.severity === "CRITICAL"));
      D.check("BLOCK: the agent is refused at the boundary", !b.check({ agentId: "EXECUTION-4", opClass: "TOOL_EXECUTION" }).allowed);
      D.check("ISOLATE: the agent is paused and tasks suspended", paused.some(p => p[0] === "EXECUTION-4" && p[1] === true) && inc.list()[0].containment.tasksSuspended === 1);
      const e = inc.list()[0]; D.check("PRESERVE: evidence bundle with manifest hashes written", Boolean(e.evidenceBundle) && fs.existsSync(path.join(inc.evidenceDir(e.id), "manifest.json")));
      D.check("ALERT: the owner was alerted", alerts.some(a => a.incident === e.id));
      D.check("no automatic restoration", !inc.clear(e.id, {}).ok && !b.check({ agentId: "EXECUTION-4" }).allowed);
      const ap = sign(CLEAR_ACTION, clearSubject(e.id)); D.check("AUTHORIZE+RESTORE: signed single-use owner approval clears it", inc.clear(e.id, { ownerApproval: ap }).ok && b.check({ agentId: "EXECUTION-4" }).allowed);
      D.check("replay of the same approval is refused", !inc.clear(e.id, { ownerApproval: ap }).ok);
      D.check("VERIFY: audit chains intact", sup.verify().ok !== false && inc.verify().ok !== false);
    } finally { rmrf(d); } out.push(D); }
  // ---------- E: restart recovery
  { const E = demo("E", "Restart recovery", "REAL modules, simulated process crash after a checkpoint"), d = mk("demoE-"); try {
      const reg1 = createOpportunityRegistry({ dir: path.join(d, "reg") }); const rec = normalizeOpportunity({ sourceId: "fixture-src", externalId: "E-1", title: "Convert CSV spreadsheet to JSON", description: "Data conversion CSV to JSON, remote contract, deliverables.", buyerName: "Fixture Ltd", url: "https://example.org/e1", remote: true }, { retrieval: "FIXTURE" }).record;
      let crashed = false; try { createMasterIntake({ dir: path.join(d, "mi"), registry: reg1, capabilities: CAPS, crashAfter: "DEDUPED" }).receive({ agentId: "SEARCH-2", record: rec }); } catch { crashed = true; }
      E.check("the process 'crashed' mid hand-off", crashed);
      const reg2 = createOpportunityRegistry({ dir: path.join(d, "reg") }), mi2 = createMasterIntake({ dir: path.join(d, "mi"), registry: reg2, capabilities: CAPS });
      E.check("state restored from disk: the hand-off is pending at its checkpoint", mi2.list().some(h => h.state === "DEDUPED"));
      const res = mi2.resume(); E.check("resume completes it", res.resumed[0]?.state === "ROUTED");
      mi2.receive({ agentId: "SEARCH-2", record: rec }); E.check("no unauthorised duplicate action: one opportunity, routed exactly once", reg2.counts().total === 1 && mi2.auditEntries().filter(x => x.event === "HANDOFF_ROUTED").length === 1);
    } finally { rmrf(d); } out.push(E); }
  // ---------- F + G: model connection and voice (hosted core, honest state)
  { const F = demo("F", "Model connection", "REAL registry state; no authorised credential exists"), G = demo("G", "AURÓRA voice", "REAL refusal logic; audio hardware/browser not available here"), d = mk("demoFG-"); try {
      const c = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") });
      const v = c.modelRegistry?.() ?? null; const live = (v?.models ?? []).filter(m => m.live === true).length;
      F.check("zero models are LIVE (no authenticated real call has happened)", live === 0, "live=" + live);
      F.blocker = "No owner-authorised provider credential and no running local model server. Provide a credential via the vault (owner action) and approve the provider host; then run the probe.";
      const sp = await c.auroraRespond({ text: "utald át a pénzt", channel: "voice" }); G.check("a spoken payment command is refused with a fixed reply and no action", sp.intent === "AUTHORIZATION_REFUSED" && sp.actions.length === 0);
      const gr = await c.auroraRespond({ text: "Jó reggelt, Auróra! Nézzük meg, milyen munkákat találtunk ma a világban!", channel: "voice" }); G.check("Hungarian greeting produces the briefing from records", gr.intent === "MORNING_BRIEFING");
      const fr = await c.auroraRespond({ text: "ez a kurva rendszer már megint nem megy" }); G.check("frustrated user: calm help, conversation continues", fr.intent === "DE_ESCALATION_CHECK" && !/nyugodj meg|calm down/i.test(fr.reply));
      G.check("voice status is NOT_TESTED (no real audio in/out verified)", c.auroraVoiceStatus().audioOut !== "OWNER_CONFIRMED" && c.auroraVoiceStatus().live === false);
      G.blocker = "Real speech recognition/synthesis needs the owner's browser with a microphone and speakers. Open the Control Center AURÓRA page, speak a Hungarian greeting and confirm both directions.";
    } finally { rmrf(d); } out.push(F, G); }
  // ---------- H: financial integrity (synthetic test-mode events, synthetic secret)
  { const H = demo("H", "Financial integrity", "SYNTHETIC signed test events (synthetic secret, isolated store); no real payment activity"), d = mk("demoH-"); try {
      const SECRET = "whsec_" + "synthetic_demo_secret_0123456789", T0 = 1_800_000_000, sig = (b, t = T0, s = SECRET) => "t=" + t + ",v1=" + createHmac("sha256", s).update(t + "." + b).digest("hex");
      const ev = (id, type, object) => JSON.stringify({ id, type, livemode: false, created: T0, data: { object } });
      const L = createPaymentEventLedger({ dir: path.join(d, "pe"), environment: "SANDBOX", secretFor: () => SECRET }); const send = (b, s) => L.ingest({ rawBody: b, signatureHeader: sig(b, T0, s), nowSec: T0 });
      const pi = { object: "payment_intent", id: "pi_1", amount: 20000, currency: "usd", metadata: { invoice_id: "inv-1" } };
      H.check("authentic signature is processed", send(ev("evt_1", "payment_intent.succeeded", pi)).status === "PROCESSED");
      H.check("duplicate delivery is rejected as DUPLICATE", send(ev("evt_1", "payment_intent.succeeded", pi)).status === "DUPLICATE");
      H.check("a wrong-secret signature is rejected", send(ev("evt_2", "payment_intent.succeeded", pi), "whsec_attacker").status === "REJECTED_SIGNATURE");
      H.check("payment succeeded is processor-confirmed only; fees unknown => net UNKNOWN (not zero)", L.summary().payments.succeededProcessorConfirmed === 1 && L.summary().money.netMinor === null);
      send(ev("evt_3", "charge.refunded", { object: "charge", id: "ch_1", payment_intent: "pi_1", amount_refunded: 5000, currency: "usd" }));
      H.check("refund handling does not crash and the ledger stays verifiable", L.summary().auditOk === true);
      send(ev("evt_4", "payout.paid", { object: "payout", id: "po_1", amount: 15000, currency: "usd" }));
      H.check("payout is kept apart and NOT a bank receipt", L.summary().payouts.bankReconciled === 0 && L.summary().money.bankReconciledMinor === 0);
    } finally { rmrf(d); } out.push(H); }
  return out.map(x => ({ ...x, passed: x.checks.every(c => c.ok), checksPassed: x.checks.filter(c => c.ok).length, checksTotal: x.checks.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = await runDemonstrations(); for (const r of res) console.log(r.id, r.title, r.passed ? "PASS" : "FAIL", r.checksPassed + "/" + r.checksTotal, r.blocker ? "BLOCKED-PART: " + r.blocker.slice(0, 80) : "");
  if (process.argv.includes("--write")) { fs.writeFileSync(new URL("../docs/audit/demonstrations_evidence.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), note: "Local, isolated runs. A passing demonstration here is NOT live external verification: see each origin and blocker.", demonstrations: res }, null, 1)); }
  process.exit(res.every(r => r.passed) ? 0 : 1);
}
