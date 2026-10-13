// SEC-GAP-5: local child processes are gated by the SAME independent execution boundary as tools, network and credentials.
// Two parts: (1) an ambient actor (AsyncLocalStorage) set by the typed-tool registry while a tool handler runs, so a spawn made on behalf of an agent is attributed to that agent and
// an incident block on that agent stops it; (2) `processGate.check()` called at every spawn choke point (restrictedNodeCommand, code sandbox, malware scanner).
// Honest limits: a module that spawns without calling this gate is not covered (enforcement-coverage.test lists them); this is not OS-level isolation; before `configure()` runs the gate
// ALLOWS (so tools used outside the runtime, e.g. unit tests and owner scripts, keep working) and reports enforced:false.
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();
let boundary = null; const stats = { checked: 0, refused: 0, unenforced: 0 };
export const processGate = Object.freeze({
  configure(b) { boundary = b && typeof b.check === "function" ? b : null; return Boolean(boundary); },
  isEnforced: () => Boolean(boundary),
  /** Run `fn` with an ambient actor so nested spawns are attributed to it. */
  runAs(actor, fn) { return als.run({ agentId: actor?.agentId ?? null, onBehalfOf: actor?.onBehalfOf ?? null, taskId: actor?.taskId ?? null }, fn); },
  actor: () => als.getStore() ?? null,
  /** check({tool}) -> {allowed, enforced, reason}. Fails closed when configured and the boundary errors. */
  check({ tool = "process.spawn", agentId = null, taskId = null } = {}) {
    stats.checked++;
    if (!boundary) { stats.unenforced++; return { allowed: true, enforced: false, reason: null }; }
    const a = als.getStore() ?? {};
    let d; try { d = boundary.check({ agentId: agentId ?? a.agentId ?? null, onBehalfOf: a.onBehalfOf ?? null, tool, operation: "PROCESS_SPAWN", opClass: "TOOL_EXECUTION", taskId: taskId ?? a.taskId ?? null }); } catch { d = { allowed: false, reason: "BOUNDARY_ERROR" }; }
    if (!d.allowed) stats.refused++;
    return { allowed: d.allowed === true, enforced: true, reason: d.allowed ? null : d.reason };
  },
  stats: () => ({ ...stats, enforced: Boolean(boundary) })
});
