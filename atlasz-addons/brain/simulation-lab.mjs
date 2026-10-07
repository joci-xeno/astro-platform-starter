// Simulation Lab (V7.3 Brain §6): scenario testing on an isolated CLONE of state. Environments SIMULATION / STAGING / LIVE are distinct and never merged.
// Anything that would touch the outside world is a trap that throws and is recorded. A passing simulation is never proof of LIVE success.
export const ENVIRONMENTS = Object.freeze(["SIMULATION", "STAGING", "LIVE"]);
// Simulation uses the REAL Money Engine states/transitions (money-pipeline-controller) so a simulated path is a valid real path. A customer's "I paid" is not a state: it can never reach PAID_VERIFIED.
export const MONEY_STATES = MONEY_PIPELINE_STATES;
const MONEY_NEXT = MONEY_PIPELINE_ALLOWED;

import fs from "node:fs";
import path from "node:path";
import { MONEY_PIPELINE_STATES, MONEY_PIPELINE_ALLOWED } from "../money-pipeline-controller.mjs";
export class SimulationLiveActionBlocked extends Error { constructor(what) { super("SIMULATION_LIVE_ACTION_BLOCKED:" + what); this.name = "SimulationLiveActionBlocked"; } }

export const SIM_RECORD_VERSION = 2;
/** file: optional durable store. Every run is persisted with id, version, config, input, planned action, result, tests, failures, risk, evidence and timestamp
 *  (SIMULATION / STAGING / LIVE records are kept strictly apart: a record carries its environment and compare() refuses to mix environments). */
export function createSimulationLab({ now = () => new Date().toISOString(), file = null } = {}) {
  let runs = [];
  if (file && fs.existsSync(file)) { try { runs = JSON.parse(fs.readFileSync(file, "utf8")).runs ?? []; } catch { throw new Error("SIMULATION_STORE_UNREADABLE"); } }
  const persist = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify({ version: SIM_RECORD_VERSION, runs })); fs.renameSync(t, file); };
  const riskOf = (violations, attempts) => (attempts.length ? "CRITICAL" : violations.length ? "HIGH" : "LOW");
  const clip = v => { const j = JSON.stringify(v ?? null); return j.length > 20000 ? { truncated: true, bytes: j.length } : JSON.parse(j); };
  /** world.live.<name>() are traps. A scenario that calls them fails the run (and the attempt is recorded). */
  function makeWorld(state, liveNames) {
    const attempts = []; const live = {};
    for (const n of liveNames) live[n] = (...a) => { attempts.push({ call: n, argsCount: a.length }); throw new SimulationLiveActionBlocked(n); };
    return { state: structuredClone(state), live, attempts, env: "SIMULATION" };
  }
  /** scenario: (world) => {violations?:[], notes?:[]}; may mutate world.state only. Returns a record; the caller's `state` is never modified. */
  function run({ name, kind, state = {}, scenario, invariants = [], liveNames = ["sendEmail", "deploy", "charge", "writeProductionConfig", "callProvider", "publish"], environment = "SIMULATION" }) {
    if (!ENVIRONMENTS.includes(environment)) throw new Error("BAD_ENVIRONMENT");
    if (environment === "LIVE") throw new Error("SIMULATION_LAB_CANNOT_RUN_LIVE");
    if (typeof scenario !== "function") throw new Error("SCENARIO_REQUIRED");
    const before = JSON.stringify(state), world = makeWorld(state, liveNames), violations = [], notes = [];
    try { const r = scenario(world) ?? {}; violations.push(...(r.violations ?? [])); notes.push(...(r.notes ?? [])); } catch (e) { violations.push(e instanceof SimulationLiveActionBlocked ? e.message : "SCENARIO_ERROR:" + String(e.message).slice(0, 100)); }
    for (const inv of invariants) { const r = inv.check(world.state); if (r !== true) violations.push("INVARIANT_FAILED:" + inv.name); }
    const rec = { id: "sim-" + (runs.length + 1), recordVersion: SIM_RECORD_VERSION, at: now(), name, kind, environment, config: { liveTraps: [...liveNames], invariants: invariants.map(i => i.name) }, input: clip(state), plannedAction: { name, kind }, tests: invariants.map(i => i.name), failures: violations.length, risk: riskOf(violations, world.attempts), verdict: violations.length ? "FAIL" : "PASS_IN_SIMULATION", violations, notes, liveAttemptsBlocked: world.attempts, isProof: false, stateUntouched: JSON.stringify(state) === before,
      disclaimer: "SIMULATION result. Not proof of STAGING or LIVE behaviour and not an authorization." };
    rec.evidence = { stateUntouched: rec.stateUntouched, liveAttemptsBlocked: world.attempts.length, notProof: true };
    runs.push(rec); persist(); return structuredClone(rec);
  }
  // ---- ready-made scenarios ----
  const providerOutage = ({ providers, outage = [], attempts = 1 }) => run({ name: "provider outage", kind: "PROVIDER_OUTAGE", state: { providers }, scenario: w => {
    const order = w.state.providers, down = new Set(outage); const served = [];
    for (let i = 0; i < attempts; i++) { const p = order.find(x => !down.has(x)); served.push(p ?? null); }
    return { violations: served.includes(null) ? ["NO_PROVIDER_AVAILABLE"] : [], notes: ["served by " + [...new Set(served)].join(",")] }; } });
  const queueFailure = ({ jobs, crashAfter }) => run({ name: "queue failure", kind: "QUEUE_FAILURE", state: { done: [], pending: jobs.map(j => j), journal: [] }, scenario: w => {
    const s = w.state; let n = 0; while (s.pending.length) { const j = s.pending[0]; if (n === crashAfter) { s.crashed = true; break; } s.journal.push({ job: j, status: "DONE" }); s.done.push(j); s.pending.shift(); n++; }
    if (s.crashed) { const recovered = s.journal.map(e => e.job); s.pending = jobs.filter(j => !recovered.includes(j)); while (s.pending.length) { s.done.push(s.pending.shift()); } }
    return {}; }, invariants: [{ name: "no job lost or duplicated", check: s => s.done.length === jobs.length && new Set(s.done).size === jobs.length }] });
  const moneyTransitions = ({ path: seq, evidence = {} }) => run({ name: "money state transitions", kind: "MONEY_TRANSITION", state: { current: seq[0] }, scenario: w => {
    const bad = [];
    for (let i = 1; i < seq.length; i++) {
      const from = seq[i - 1], to = seq[i]; if (!MONEY_STATES.includes(to)) { bad.push("UNKNOWN_STATE:" + to); continue; }
      if (!(MONEY_NEXT[from] ?? []).includes(to)) bad.push("ILLEGAL:" + from + "->" + to);
      if (to === "PAID_VERIFIED" && !evidence.paymentConfirmedByLedger) bad.push("PAID_VERIFIED_WITHOUT_LEDGER_EVIDENCE");
      if (to === "WON" && !evidence.customerAcceptance) bad.push("WON_WITHOUT_CUSTOMER_ACCEPTANCE");
    }
    w.state.current = seq[seq.length - 1]; return { violations: bad }; } });
  const rollback = ({ before, change, rollbackFn }) => run({ name: "rollback", kind: "ROLLBACK", state: before, scenario: w => { change(w.state); rollbackFn(w.state); return {}; }, invariants: [{ name: "state restored exactly", check: s => JSON.stringify(s) === JSON.stringify(before) }] });
  /** Generic change simulation: apply `mutate` to a clone and check invariants. Used for routing/config/update/automation changes. */
  const change = ({ kind, name, state, mutate, invariants }) => run({ name, kind, state, scenario: w => { mutate(w.state); return {}; }, invariants });
  /** Compare two persisted runs. Different environments are never compared (SIMULATION != STAGING != LIVE). */
  function compare(idA, idB) {
    const a = runs.find(r => r.id === idA), b = runs.find(r => r.id === idB);
    if (!a || !b) throw new Error("UNKNOWN_RUN");
    if (a.environment !== b.environment) return { comparable: false, reason: "ENVIRONMENT_MISMATCH:" + a.environment + "_vs_" + b.environment };
    const va = new Set(a.violations), vb = new Set(b.violations);
    return { comparable: true, same: a.verdict === b.verdict && [...va].every(x => vb.has(x)) && [...vb].every(x => va.has(x)), verdicts: [a.verdict, b.verdict], risk: [a.risk, b.risk], newFailures: [...vb].filter(x => !va.has(x)), resolvedFailures: [...va].filter(x => !vb.has(x)), kinds: [a.kind, b.kind] };
  }
  const get = id => { const r = runs.find(x => x.id === id); return r ? structuredClone(r) : null; };
  return { compare, get, run, providerOutage, queueFailure, moneyTransitions, rollback, change, runs: () => runs.map(r => structuredClone(r)), environments: ENVIRONMENTS };
}
