// Registrations: scheduling, recovery and the Master's own runtime tools. Each wraps the REAL object the running Control Center uses (ctx.scheduler(), ctx.ownerControl().recovery, ctx.superviseNow).
import { str, int, arr, obj, cap, POLICY } from "./_util.mjs";
import { RECOVERY_CATEGORIES } from "../owner-control/recovery-points.mjs";

export function registerRuntime(broker, ctx) {
  const rec = () => ctx.ownerControl().recovery;
  broker.register({ id: "recovery-points", source: "atlasz-addons/owner-control/recovery-points.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Restore points and verified backups per recovery category (real local source directories), last-known-good registry; restore itself needs a signed owner approval and is NOT exposed here.",
    capabilities: [
      cap("readiness", "READ_STATUS", () => JSON.parse(JSON.stringify(rec().readiness())), { description: "Per-category backup/verification state and overall restore readiness (NOT_CONFIGURED is reported as such)." }),
      cap("create_point", "CREATE_RESTORE_POINT", () => JSON.parse(JSON.stringify(rec().createRestorePoint())), { description: "Create a restore point for every configured category (owner-free, additive, never overwrites)." , timeoutMs: 60000}),
      cap("verify", "VERIFY_BACKUP", () => JSON.parse(JSON.stringify(rec().verifyBackups())), { description: "Verify the latest backup of every configured category by manifest hash and a real restore into scratch.", timeoutMs: 60000 })
    ],
    selfTest: { capability: "readiness", expect: r => (Array.isArray(r.categories) && r.categories.length === RECOVERY_CATEGORIES.length ? true : "category list incomplete") } });
  if (typeof ctx.backups === "function") broker.register({ id: "state-backup", source: "atlasz-addons/backup-recovery.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Hash-manifested backups of the whole application state (outside the state directory) and real restore drills into scratch; restoring over live state is NOT exposed here (needs a signed owner approval).",
    capabilities: [
      cap("status", "READ_STATUS", () => { const b = ctx.backups(); return { count: b.items.length, allVerified: b.items.every(x => x.ok), latest: b.items.at(-1)?.id ?? null, lastDrill: ctx.lastDrill?.() ?? null }; }),
      cap("create", "CREATE_RESTORE_POINT", () => JSON.parse(JSON.stringify(ctx.backupNow({ label: "scheduled" }))), { description: "Create a manifest-verified backup of the state directory.", timeoutMs: 120000 }),
      cap("drill", "VERIFY_BACKUP", () => { const r = ctx.drill(); return { passed: r.passed === true, files: r.files, mismatches: r.mismatches ?? 0 }; }, { description: "Restore the newest backup into scratch and compare every file hash.", timeoutMs: 120000 })
    ],
    selfTest: { capability: "status", expect: r => (typeof r.count === "number" ? true : "status shape") } });
  broker.register({ id: "scheduler", source: "atlasz-addons/scheduler.mjs", manager: "TASK_SCHEDULER", lifecycle: "CONTINUOUS", policy: POLICY.draft,
    purpose: "Durable scheduler: persisted ONCE/INTERVAL/DAILY jobs that can only call registered typed tools through the control chain (actor SCHEDULER); driven by the Master supervision loop; at-least-once delivery.",
    capabilities: [
      cap("summary", "READ_STATUS", () => JSON.parse(JSON.stringify(ctx.scheduler().summary())), { description: "Job counts by state, next due job and jobs awaiting approval." }),
      cap("list", "READ_STATUS", () => ({ jobs: ctx.scheduler().list().map(j => ({ id: j.id, name: j.name, kind: j.kind, tool: j.tool, state: j.state, nextRunAt: j.nextRunAt, lastResult: j.lastResult ?? null })) })),
      cap("tick", "INTERNAL_COMPUTE", async () => JSON.parse(JSON.stringify(await ctx.scheduler().tick())), { description: "Run every due job once (kill switch / safe mode halts the tick).", timeoutMs: 60000 }),
      cap("create", "DRAFT", a => JSON.parse(JSON.stringify(ctx.scheduler().create({ name: a.name, kind: a.kind, spec: a.spec, tool: a.tool, args: a.args ?? {}, createdBy: "MASTER" }))),
        { input: obj({ name: str({ maxLength: 120 }), kind: str({ maxLength: 12 }), spec: obj({ everyMs: int({ minimum: 60000 }), time: str({ maxLength: 5 }), at: str({ maxLength: 40 }) }), tool: str({ maxLength: 64 }), args: { type: "object", additionalProperties: true } }, ["name", "kind", "spec", "tool"]), description: "Create a schedule for an already registered tool (it still goes through the control chain on every run)." })
    ],
    selfTest: { capability: "summary", expect: r => (typeof r.total === "number" ? true : "summary shape") } });
  broker.register({ id: "master-runtime", source: "atlasz-addons/master-coordinator.mjs", manager: "MASTER_COORDINATOR", lifecycle: "CONTINUOUS", policy: POLICY.low,
    purpose: "The Master's own recurring actions as typed tools so the scheduler can run them under the control chain: supervise (probe managers, check pending verification) and module health sweep.",
    capabilities: [
      cap("supervise", "INTERNAL_COMPUTE", async () => { const r = await ctx.superviseNow(); return { ok: true, at: new Date().toISOString(), managers: r?.managers?.length ?? r?.summary ?? null }; }, { description: "One Master supervision pass.", timeoutMs: 60000 }),
      cap("status", "READ_STATUS", () => ({ modules: broker.summary().modules, tools: broker.summary().tools }), { description: "Module/tool counts (cheap, used as this module's self-test so a health sweep cannot recurse)." }),
      cap("module_health", "READ_STATUS", async () => { const out = (await broker.healthAll()).filter(o => o.id !== "master-runtime"); const bad = out.filter(o => !["HEALTHY", "VIA_CONSUMER", "OFFLINE_BY_DESIGN", "SUPERSEDED"].includes(o.state)); return { checked: out.length, unhealthy: bad.map(b => ({ id: b.id, state: b.state, detail: b.detail })) }; }, { description: "Self-test every registered module and list the unhealthy ones.", timeoutMs: 60000 })
    ],
    selfTest: { capability: "status", expect: r => (r.modules >= 1 ? true : "no modules") } });
}
