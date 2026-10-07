// Read-only views of persisted Brain state for the Control Center (V7.3 Brain §18). The runtime owns the Brain files; this module only reads.
// Nothing here fabricates data: missing state is reported as NOT_CONNECTED / NO_DATA.
import fs from "node:fs";
import path from "node:path";
import { readAuditFile, verifyChain } from "../atlasz-addons/audit-chain.mjs";
import { createDisasterRecovery } from "../atlasz-addons/brain/disaster-recovery.mjs";
import { COMMANDS } from "../atlasz-addons/brain/owner-command.mjs";
import { PIPELINE } from "../atlasz-addons/brain/orchestrator.mjs";
import { STAGES } from "../atlasz-addons/brain/opportunity-intelligence.mjs";

const readJson = f => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; } catch { return { __unreadable: true }; } };
const NC = (why = "No Brain state has been written yet (the runtime has not run, or the Brain is not connected).") => ({ state: "NOT_CONNECTED", note: why });

export function createBrainViews({ stateDir, backups, drills, auditFile = null, liveSummary = async () => null }) {
  const dir = path.join(stateDir, "brain");
  const bbFile = path.join(dir, "blackbox.jsonl");
  function blackBox() {
    if (!fs.existsSync(bbFile)) return null;
    const entries = readAuditFile(bbFile), v = verifyChain(entries);
    return { chainOk: v.ok !== false, events: entries.map(e => ({ seq: e.seq, at: e.at, kind: e.event.replace(/^BB_/, ""), ...e.data })) };
  }
  const by = (ev, f) => ev.filter(f);
  async function all() {
    const live = await liveSummary(), bb = blackBox(), graph = readJson(path.join(dir, "capability-graph.json")), plans = readJson(path.join(dir, "plans.json")), opps = readJson(path.join(dir, "opportunities.json")),
      know = readJson(path.join(dir, "knowledge.json")), svc = readJson(path.join(dir, "services.json")), ev = bb?.events ?? [];
    const nodes = graph && !graph.__unreadable ? Object.values(graph) : null;
    const status = { runtimeReported: live ? "REACHABLE" : "RUNTIME_NOT_REACHABLE_USING_PERSISTED_FILES", topology: live?.topology ?? (nodes ? { agentsInGraph: nodes.filter(n => n.type === "AGENT").length, expected: 30 } : null),
      governanceAuditOk: live?.governanceAudit ?? null, modules: live ? Object.keys(live) : [], note: "The Brain observes and protects the existing 30 agents; it is not yet the dispatch path of their screening loop." };
    return {
      status: live || nodes ? status : NC(),
      orchestrator: { pipeline: PIPELINE, state: live?.orchestrator ?? "UNKNOWN", pipelineEventsRecorded: by(ev, e => e.kind.startsWith("PIPELINE_")).length, note: by(ev, e => e.kind.startsWith("PIPELINE_")).length ? null : "SANDBOX: orchestrator is built and tested but no plan has been executed through it in the runtime." },
      planning: plans && !plans.__unreadable ? Object.values(plans).map(p => { const t = Object.values(p.tasks); return { id: p.id, goal: p.goal, status: p.status, version: p.version, tasks: t.length, done: t.filter(x => x.status === "DONE").length, approvalPoints: p.approvalPoints.length, estCostUsd: p.estCost.knownUsd, costAuthorized: false }; }) : NC("No plans exist yet."),
      capabilityGraph: nodes ? nodes.map(n => ({ id: n.id, type: n.type, capabilities: n.capabilities, health: n.health, available: n.available, probed: Boolean(n.evidence), runs: n.stats.runs, reliability: n.stats.runs ? n.stats.ok / n.stats.runs : null, costClass: n.costClass })) : NC(),
      knowledge: know && !know.__unreadable ? { items: Object.keys(know.items).length, byKind: Object.values(know.items).reduce((m, i) => (m[i.kind] = (m[i.kind] || 0) + 1, m), {}), lessons: Object.keys(know.lessons).length } : NC("No knowledge items stored yet."),
      simulation: { state: "SANDBOX", note: "Simulation Lab is built and tested; runs are in-process and not persisted, so none are listed. Simulation success is never proof of LIVE success.", environments: ["SIMULATION", "STAGING", "LIVE"] },
      verification: { verified: by(ev, e => e.kind === "PIPELINE_VERIFY" && e.verification === "ACCEPT").length, rejected: by(ev, e => e.kind === "PIPELINE_VERIFY" && e.verification && e.verification !== "ACCEPT").length, screeningNotIndependentlyVerified: by(ev, e => e.verification === "NOT_INDEPENDENTLY_VERIFIED").length,
        note: "Screening results are recorded as NOT_INDEPENDENTLY_VERIFIED; nothing counts as completed work without an independent verifier ACCEPT." },
      security: { events: by(ev, e => e.kind.startsWith("SECURITY_")).slice(-30), quarantinedExternalText: by(ev, e => e.kind === "EXTERNAL_TEXT_QUARANTINED").length, summary: live?.security ?? null },
      opportunities: opps && !opps.__unreadable ? { stages: STAGES, items: Object.values(opps).slice(-50).map(o => ({ id: o.id, title: o.title, stage: o.stage, score: o.scoring?.score ?? null, explanation: o.scoring?.explanation ?? "Not scored yet (unknown factors are not guessed)." })) } : NC("No opportunities tracked yet."),
      factory: svc && !svc.__unreadable ? Object.values(svc).map(s => ({ id: s.id, name: s.name, state: s.state, offerType: s.offerType, priceSet: s.pricingInputs.price !== null })) : NC("No service drafts exist. Nothing is published, sold or launched without your approval."),
      observability: bb ? { chainOk: bb.chainOk, events: bb.events.length, timeline: bb.events.slice(-60).reverse(), errors: by(bb.events, e => e.error).length, retries: by(bb.events, e => e.retry).length } : NC("Black box file does not exist yet."),
      disasterRecovery: (() => { const b = backups(); const r = createDisasterRecovery({}).readiness({ backups: b.items.map(i => ({ id: i.id, createdAt: i.createdAt, verifiedAt: new Date().toISOString(), verifyOk: i.ok })), drills: drills() });
        return { ...r, flow: ["DETECT", "CONTAIN", "FREEZE", "PRESERVE_EVIDENCE", "CHECKPOINT", "DIAGNOSE", "REPAIR", "RETEST", "ROLLBACK_TO_LKG", "VERIFY", "RESUME", "REPORT"], lkg: b.lkg ? "PRESENT" : "NONE" }; })(),
      ownerCommand: { commands: Object.entries(COMMANDS).map(([k, v]) => ({ intent: k, consequential: v.consequential })), audit: auditFile && fs.existsSync(auditFile) ? { ok: verifyChain(readAuditFile(auditFile)).ok !== false, entries: readAuditFile(auditFile).length } : { ok: true, entries: 0 } },
      behavior: (() => { const a = readJson(path.join(dir, "behavior-anomalies.json")); if (!a) return NC("No behaviour scan has been persisted yet."); if (a.__unreadable) return { state: "UNREADABLE" }; const l = Object.values(a.anomalies ?? {}); return { state: "CONNECTED", open: l.filter(x => x.status === "OPEN").length, high: l.filter(x => x.status === "OPEN" && x.severity === "HIGH").length, items: l.sort((x, y) => String(y.lastSeenAt).localeCompare(String(x.lastSeenAt))).slice(0, 50).map(x => ({ id: x.id, kind: x.kind, severity: x.severity, subject: x.subject, detail: x.detail, recommendation: x.recommendation, status: x.status, count: x.count })), note: "Detection and recommendation only. Nothing is quarantined or halted by the monitor itself." }; })(),
      health: live?.health ?? (bb ? { note: "Runtime not reachable; showing counts from the persisted black box only.", events: bb.events.length } : NC())
    };
  }
  return { all };
}
