// Unified programme M6: the REAL operational state of the 30 permanent agents, derived read-only from the coordination ledger and coordinator state the runtime writes.
//   Nothing is invented: an agent with no task in the ledger is IDLE; a state is only reported when a ledger task or a coordinator record supports it, and every state carries the task id and timestamps that justify it.
//   If the coordination files do not exist (runtime never started) every agent is reported UNKNOWN with the reason - not "idle" and not "busy".
//   States: IDLE, SEARCHING, RESEARCHING, CODING, TESTING, REVIEWING, EXECUTING_AUTHORIZED_TASK, WAITING_FOR_CHECKER, BLOCKED, UNKNOWN. COMPLETED / FAILED are reported as the agent's last outcome (with time), not as a standing state.
//   WAITING_FOR_APPROVAL is not derived here: owner approvals are not tied to a single agent in the ledger, so they are shown in the approvals list instead of being guessed per agent.
import fs from "node:fs";
import { AGENT_ID_RE } from "./agent-tool-policy.mjs";

export const ROSTER = Object.freeze([...Array.from({ length: 5 }, (_, i) => `SEARCH-${i + 1}`), ...Array.from({ length: 25 }, (_, i) => `EXECUTION-${i + 1}`)]);
const STALL_MS = 15 * 60_000;
const readJson = f => { try { return { ok: true, data: JSON.parse(fs.readFileSync(f, "utf8")), mtime: fs.statSync(f).mtimeMs }; } catch (e) { return { ok: false, reason: e.code === "ENOENT" ? "NOT_FOUND" : "UNREADABLE" }; } };
const kindState = kind => { const k = String(kind); if (/^search\./.test(k)) return "SEARCHING"; if (/^research\./.test(k)) return "RESEARCHING"; if (/^(code|dev|build)\./.test(k)) return "CODING"; if (/^(test|qa)\./.test(k)) return "TESTING"; if (/^(review|screen|verify|audit)\./.test(k)) return "REVIEWING"; return "EXECUTING_AUTHORIZED_TASK"; };

export function agentActivity({ ledgerFile, coordFile, tenantId = "JOCI", now = Date.now() } = {}) {
  const led = readJson(ledgerFile), co = coordFile ? readJson(coordFile) : { ok: false, reason: "NOT_CONFIGURED" };
  if (!led.ok) return { ok: true, available: false, reason: "COORDINATION_LEDGER_" + led.reason, note: "The runtime has not written any coordination state; agent states are UNKNOWN, not idle.", agents: ROSTER.map(id => ({ id, role: id.split("-")[0], state: "UNKNOWN" })), counts: { UNKNOWN: ROSTER.length }, tasks: {} };
  const t = led.data?.tenants?.[tenantId] ?? { tasks: {}, events: [] }, tasks = Object.values(t.tasks ?? {}), events = Array.isArray(t.events) ? t.events : [];
  let cs = {}; if (co.ok) { try { cs = JSON.parse(co.data.body ?? "{}"); } catch { cs = {}; } }
  const beats = cs.beats ?? {}, verifiers = cs.verifiers ?? {}, subs = Object.values(cs.subs ?? {}), byStatus = {}; for (const k of tasks) byStatus[k.status] = (byStatus[k.status] ?? 0) + 1;
  const done = id => (t.tasks[id]?.status === "DONE");
  const agents = ROSTER.map(id => {
    const mine = tasks.filter(k => k.owner === id), checks = Object.entries(verifiers).filter(([tid, a]) => a === id && t.tasks[tid]?.status === "VERIFYING").map(([tid]) => tid);
    const running = mine.filter(k => k.status === "IN_PROGRESS"), queued = mine.filter(k => k.status === "ASSIGNED"), pending = mine.filter(k => k.status === "HANDOFF_PENDING"), verifying = mine.filter(k => k.status === "VERIFYING");
    const mineEvents = events.filter(e => e.by === id || t.tasks[e.task]?.owner === id), lastBeat = Number.isFinite(beats[id]) ? beats[id] : null; let state = "IDLE", task = null, why = "no open task owned by this agent";
    if (checks.length) { state = "REVIEWING"; task = checks[0]; why = "assigned independent verifier of " + checks[0]; }
    else if (running.length) { const k = running[0]; task = k.id; if (lastBeat !== null && now - lastBeat > STALL_MS) { state = "BLOCKED"; why = `no heartbeat for ${Math.round((now - lastBeat) / 60000)} min while running ${k.id}`; } else { state = kindState(k.kind); why = `owns IN_PROGRESS task ${k.id} (${k.kind})`; } }
    else if (queued.length) { const k = queued[0], waiting = (k.dependsOn ?? []).filter(d => !done(d)); task = k.id; if (waiting.length) { state = "BLOCKED"; why = `task ${k.id} waits for dependencies ${waiting.join(",")}`; } else { state = "IDLE"; why = `has assigned task ${k.id} not started yet`; } }
    else if (pending.length) { state = "IDLE"; task = pending[0].id; why = `handoff of ${task} awaits the receiving agent`; }
    else if (verifying.length) { state = "WAITING_FOR_CHECKER"; task = verifying[0].id; why = `submitted ${task}; waiting for the independent checker`; }
    const lastDone = [...mineEvents].reverse().find(e => e.type === "VERIFIED_DONE"), lastFail = [...mineEvents].reverse().find(e => /REJECTED|FAILED|ABANDON/.test(e.type));
    return { id, role: id.split("-")[0], state, task, why, queued: queued.length, openTasks: mine.filter(k => ["ASSIGNED", "IN_PROGRESS", "HANDOFF_PENDING", "VERIFYING"].includes(k.status)).length, lastHeartbeat: lastBeat ? new Date(lastBeat).toISOString() : null,
      lastCompleted: lastDone ? { task: lastDone.task, at: lastDone.at } : null, lastFailed: lastFail ? { task: lastFail.task, at: lastFail.at, type: lastFail.type } : null, activeSubAgents: subs.filter(s => s.parent === id && s.status === "ACTIVE").length,
      recentActions: mineEvents.slice(-8).map(e => ({ at: e.at, type: e.type, task: e.task })) };
  });
  const counts = {}; for (const a of agents) counts[a.state] = (counts[a.state] ?? 0) + 1;
  return { ok: true, available: true, source: { ledgerUpdatedAt: new Date(led.mtime).toISOString(), coordinatorUpdatedAt: co.ok ? new Date(co.mtime).toISOString() : null, ledgerAgeMs: now - led.mtime }, permanentAgents: 30, agents, counts, tasks: byStatus,
    recentEvents: events.slice(-30).map(e => ({ at: e.at, type: e.type, task: e.task, by: e.by })), note: "Derived from the coordination ledger; idle means no open task is recorded for the agent." };
}
export const isRosterId = id => AGENT_ID_RE.test(String(id));
