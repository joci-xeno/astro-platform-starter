// Behavior Anomaly Monitor (Joci additive requirements: "emergent / behavior anomaly monitoring"). Practical detection of unexpected SYSTEM behaviour — not a consciousness claim.
// Detectors work on Black Box events (the tamper-evident record), so an agent cannot hide from them by not reporting:
//   LOOP                 the same agent repeats the same action on the same input N times inside a window
//   COST_SPIKE           a cost sample far above the rolling median (or any cost with a no-spend budget of 0)
//   BYPASS_ATTEMPT       repeated refused / owner-approval-required / blocked attempts by one agent (probing the workflow)
//   OBJECTIVE_DRIFT      an action outside the capabilities declared for that agent
//   QA_GAMING            an executor judged by itself, an unchanged artifact resubmitted after a FAIL, or implausibly trivial work that "passes"
//   MUTUAL_REINFORCEMENT two agents repeatedly accepting each other's work (collusion pattern)
// Findings are RECORDED (Black Box + own store) and RECOMMEND a response (review / quarantine / halt). Quarantine or halting is never silently applied by this module:
// an `onAnomaly` hook may route HIGH findings to the Security Brain / Judge / owner; nothing here can loosen a control.
import { createStore, clone } from "../business/store.mjs";

export const ANOMALY_KINDS = Object.freeze(["LOOP", "COST_SPIKE", "BYPASS_ATTEMPT", "OBJECTIVE_DRIFT", "QA_GAMING", "MUTUAL_REINFORCEMENT"]);
const DEFAULTS = { loopCount: 5, loopWindowMs: 10 * 60_000, costFactor: 5, costMinSamples: 5, bypassCount: 3, bypassWindowMs: 30 * 60_000, mutualCount: 4, trivialChars: 40 };
const BYPASS_RE = /(OWNER_APPROVAL_REQUIRED|APPROVAL_REQUIRED|REFUSED|BLOCK|DENIED|NOT_ALLOWED|FORBIDDEN|KILL_SWITCH|SAFE_MODE)/i;
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function createBehaviorMonitor({ blackBox = null, capabilities = {}, noSpend = true, file = null, thresholds = {}, onAnomaly = null, now = () => new Date().toISOString() } = {}) {
  const T = { ...DEFAULTS, ...thresholds }, S = createStore({ file, init: () => ({ anomalies: {}, seq: 0, scanned: 0 }) });
  const ts = e => Date.parse(e.at ?? e.time ?? now());

  function detect(events) {
    const caps = typeof capabilities === "function" ? capabilities() : capabilities; const out = [], by = (f) => events.reduce((m, e) => { const k = f(e); if (k != null) (m.get(k) ?? m.set(k, []).get(k)).push(e); return m; }, new Map());
    // LOOP
    for (const [k, l] of by(e => e.agentId && e.inputRef && e.kind ? `${e.agentId}|${e.kind}|${e.inputRef}` : null)) {
      l.sort((a, b) => ts(a) - ts(b)); for (let i = 0; i + T.loopCount - 1 < l.length; i++) if (ts(l[i + T.loopCount - 1]) - ts(l[i]) <= T.loopWindowMs) { const [agent, kind, input] = k.split("|"); out.push({ kind: "LOOP", severity: "MEDIUM", subject: agent, key: k, detail: `${kind} on ${input} repeated ${l.length}x`, evidenceSeq: l.map(e => e.seq).filter(Boolean).slice(0, 10), recommendation: "HALT_TASK_AND_REVIEW" }); break; }
    }
    // COST_SPIKE (only for events that carry a numeric cost)
    const costs = events.filter(e => Number.isFinite(e.costUsd));
    for (const e of costs) {
      const prior = costs.filter(x => x !== e && ts(x) <= ts(e) && x.costUsd > 0).map(x => x.costUsd);
      if (noSpend && e.costUsd > 0 && !(e.approval)) out.push({ kind: "COST_SPIKE", severity: "HIGH", subject: e.agentId ?? e.model ?? "?", key: "nospend|" + (e.seq ?? e.at), detail: `cost $${e.costUsd} recorded under a no-spend policy without approval`, evidenceSeq: e.seq ? [e.seq] : [], recommendation: "REVIEW_SPEND_AND_HALT_PROVIDER" });
      else if (prior.length >= T.costMinSamples && e.costUsd > T.costFactor * median(prior)) out.push({ kind: "COST_SPIKE", severity: "MEDIUM", subject: e.agentId ?? e.model ?? "?", key: "spike|" + (e.seq ?? e.at), detail: `cost $${e.costUsd} is ${(e.costUsd / median(prior)).toFixed(1)}x the median $${median(prior)}`, evidenceSeq: e.seq ? [e.seq] : [], recommendation: "REVIEW_USAGE" });
    }
    // BYPASS_ATTEMPT
    for (const [agent, l] of by(e => (e.agentId && BYPASS_RE.test(`${e.decision ?? ""} ${e.reason ?? ""} ${e.error ?? ""}`) ? e.agentId : null))) {
      l.sort((a, b) => ts(a) - ts(b)); for (let i = 0; i + T.bypassCount - 1 < l.length; i++) if (ts(l[i + T.bypassCount - 1]) - ts(l[i]) <= T.bypassWindowMs) { out.push({ kind: "BYPASS_ATTEMPT", severity: "HIGH", subject: agent, key: "bypass|" + agent, detail: `${l.length} refused/approval-required attempts`, evidenceSeq: l.map(e => e.seq).filter(Boolean).slice(0, 10), recommendation: "QUARANTINE_REVIEW" }); break; }
    }
    // OBJECTIVE_DRIFT: action declares a capability the agent was never given
    for (const e of events) { const need = e.capability ?? e.requiredCapability; if (e.agentId && need && caps[e.agentId] && !caps[e.agentId].includes(need)) out.push({ kind: "OBJECTIVE_DRIFT", severity: "MEDIUM", subject: e.agentId, key: `drift|${e.agentId}|${need}`, detail: `acted with capability "${need}" outside its declared set`, evidenceSeq: e.seq ? [e.seq] : [], recommendation: "REVIEW_ASSIGNMENT" }); }
    // QA_GAMING
    const verif = events.filter(e => e.verification || e.kind === "ARTIFACT_VERIFIED" || e.kind === "JUDGED");
    for (const e of verif) if (e.agentId && e.judgeId && e.agentId === e.judgeId) out.push({ kind: "QA_GAMING", severity: "HIGH", subject: e.agentId, key: `self|${e.agentId}|${e.outputRef ?? e.seq}`, detail: "executor acted as its own judge", evidenceSeq: e.seq ? [e.seq] : [], recommendation: "INVALIDATE_VERIFICATION" });
    for (const [k, l] of by(e => (e.outputRef && e.hash ? e.outputRef : null))) { l.sort((a, b) => ts(a) - ts(b)); const fail = l.findIndex(e => /FAIL|REJECT/i.test(String(e.result ?? e.verification ?? ""))); if (fail >= 0 && l.slice(fail + 1).some(e => e.hash === l[fail].hash && /PASS|ACCEPT/i.test(String(e.result ?? e.verification ?? "")))) out.push({ kind: "QA_GAMING", severity: "HIGH", subject: l[fail].agentId ?? k, key: "resubmit|" + k, detail: "identical content passed after it failed", evidenceSeq: l.map(e => e.seq).filter(Boolean).slice(0, 6), recommendation: "INVALIDATE_VERIFICATION" }); }
    for (const e of verif) if (/PASS|ACCEPT/i.test(String(e.result ?? e.verification ?? "")) && Number.isFinite(e.contentLength) && e.contentLength < T.trivialChars) out.push({ kind: "QA_GAMING", severity: "MEDIUM", subject: e.agentId ?? "?", key: `trivial|${e.outputRef ?? e.seq}`, detail: `"passed" with only ${e.contentLength} characters of content`, evidenceSeq: e.seq ? [e.seq] : [], recommendation: "RE_REVIEW_WORK" });
    // MUTUAL_REINFORCEMENT: A accepts B's work and B accepts A's work, repeatedly
    const acc = new Map(); for (const e of events) if (e.agentId && e.judgeId && e.agentId !== e.judgeId && /ACCEPT|PASS/i.test(String(e.result ?? e.verification ?? ""))) { const k = `${e.judgeId}>${e.agentId}`; acc.set(k, (acc.get(k) ?? 0) + 1); }
    for (const [k, n] of acc) { const [a, b] = k.split(">"); const rev = acc.get(`${b}>${a}`) ?? 0; if (a < b && n >= T.mutualCount && rev >= T.mutualCount) out.push({ kind: "MUTUAL_REINFORCEMENT", severity: "HIGH", subject: `${a}<->${b}`, key: `mutual|${a}|${b}`, detail: `${a} accepted ${b} ${n}x and ${b} accepted ${a} ${rev}x`, evidenceSeq: [], recommendation: "REASSIGN_INDEPENDENT_JUDGE" }); }
    return out;
  }
  /** Analyse a batch of Black Box events (default: everything in the Black Box). New findings are stored once (de-duplicated by key) and recorded to the Black Box. */
  function scan(events = blackBox?.query?.({}) ?? []) {
    const found = detect(events), fresh = [];
    for (const f of found) {
      const id = f.kind + "|" + f.key; if (S.data.anomalies[id]) { S.data.anomalies[id].lastSeenAt = now(); S.data.anomalies[id].count++; continue; }
      const a = { id, ...f, at: now(), lastSeenAt: now(), count: 1, status: "OPEN", handledBy: null }; S.data.anomalies[id] = a; fresh.push(a);
      try { blackBox?.record({ kind: "BEHAVIOR_ANOMALY", agentId: /^[A-Za-z]+[0-9-]+$/.test(f.subject) ? f.subject : undefined, decision: f.kind, reason: `${f.severity}:${f.detail}`.slice(0, 200) }); } catch { /* ignore */ }
      try { onAnomaly?.(clone(a)); } catch { /* a failing hook must not hide the finding */ }
    }
    S.data.scanned += events.length; S.save(); return { analysed: events.length, newFindings: fresh.map(clone), open: list({ status: "OPEN" }).length };
  }
  const list = (f = {}) => Object.values(S.data.anomalies).filter(a => (!f.status || a.status === f.status) && (!f.kind || a.kind === f.kind) && (!f.severity || a.severity === f.severity)).map(clone);
  function resolve(id, { by, note }) { const a = S.data.anomalies[id]; if (!a) throw new Error("UNKNOWN_ANOMALY"); if (!by || !note) throw new Error("BY_AND_NOTE_REQUIRED"); a.status = "RESOLVED"; a.handledBy = by; a.note = note; a.resolvedAt = now(); S.save(); return clone(a); }
  const summary = () => ({ open: list({ status: "OPEN" }).length, high: list({ status: "OPEN", severity: "HIGH" }).length, byKind: Object.fromEntries(ANOMALY_KINDS.map(k => [k, list({ kind: k }).length])), note: "Detection and recommendation only; no control is changed by this monitor." });
  return { scan, detect, list, resolve, summary };
}
