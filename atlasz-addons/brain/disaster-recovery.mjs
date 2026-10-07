// Disaster Recovery Command (V7.3 Brain §12): incident state machine + recovery readiness.
// DETECT -> CONTAIN -> FREEZE UNSAFE ACTIONS -> PRESERVE EVIDENCE -> CHECKPOINT IF SAFE -> DIAGNOSE -> SAFE REPAIR -> RETEST -> ROLLBACK TO LKG IF REQUIRED -> VERIFY -> RESUME -> INCIDENT REPORT
// A backup is "PROVEN" only after a verified restore drill; "exists" is not "recoverable".
export const INCIDENT_FLOW = Object.freeze(["DETECT", "CONTAIN", "FREEZE", "PRESERVE_EVIDENCE", "CHECKPOINT", "DIAGNOSE", "REPAIR", "RETEST", "ROLLBACK_TO_LKG", "VERIFY", "RESUME", "REPORT"]);

export function createDisasterRecovery({ actions = {}, governance = null, blackBox = null, now = () => new Date().toISOString(), maxBackupAgeMs = 7 * 86400000, maxDrillAgeMs = 30 * 86400000, clock = () => Date.now() } = {}) {
  const incidents = [];
  /** actions: contain(inc), freeze(inc), preserveEvidence(inc), checkpoint(inc)->{ok}, safeToCheckpoint(inc)->bool, diagnose(inc)->{cause, repairable}, repair(inc)->{ok}, retest(inc)->{ok}, rollbackToLkg(inc)->{ok}, verify(inc)->{ok}, resume(inc) */
  async function runIncident({ type, detail = "", severity = "HIGH", ownerApproval = null } = {}) {
    if (!type) throw new Error("INCIDENT_TYPE_REQUIRED");
    const inc = { id: "inc-" + (incidents.length + 1), type, detail, severity, startedAt: now(), stages: [], status: "OPEN", resumed: false }; incidents.push(inc);
    const log = (stage, status, extra = {}) => { inc.stages.push({ stage, status, at: now(), ...extra }); blackBox?.record({ kind: "DR_" + stage, jobId: inc.id, result: status, reason: extra.note, recovery: stage }); };
    const call = async (stage, fn, ...a) => { if (typeof fn !== "function") { log(stage, "NOT_CONNECTED"); return { ok: false, notConnected: true }; } try { const r = (await fn(inc, ...a)) ?? { ok: true }; log(stage, r.ok === false ? "FAILED" : "DONE", { note: r.note }); return r; } catch (e) { log(stage, "ERROR", { note: String(e.message).slice(0, 120) }); return { ok: false, error: true }; } };
    log("DETECT", "DONE", { note: type });
    await call("CONTAIN", actions.contain);
    const fr = await call("FREEZE", actions.freeze);
    if (!fr.ok) { inc.status = "CONTAINMENT_NOT_CONFIRMED"; log("REPORT", "DONE", { note: "Freeze not confirmed; no repair or rollback attempted." }); return finish(inc); }
    await call("PRESERVE_EVIDENCE", actions.preserveEvidence);           // always before repair/rollback
    const safe = typeof actions.safeToCheckpoint === "function" ? (await actions.safeToCheckpoint(inc)) === true : false;
    if (safe) await call("CHECKPOINT", actions.checkpoint); else log("CHECKPOINT", "SKIPPED_NOT_SAFE");
    const dg = await call("DIAGNOSE", actions.diagnose);
    let healthy = false;
    if (dg.repairable !== false) { const rp = await call("REPAIR", actions.repair); if (rp.ok) { const rt = await call("RETEST", actions.retest); healthy = rt.ok === true; } }
    if (!healthy) {
      if (!governance) { inc.status = "AWAITING_OWNER_ROLLBACK_APPROVAL"; log("ROLLBACK_TO_LKG", "WAITING_OWNER", { note: "No governance configured" }); return finish(inc); }
      const g = governance.authorize({ brain: "RECOVERY", action: "ROLLBACK", subject: inc.id, ownerApproval });
      if (!g.allowed) { inc.status = "AWAITING_OWNER_ROLLBACK_APPROVAL"; log("ROLLBACK_TO_LKG", "WAITING_OWNER", { note: g.reason }); return finish(inc); }
      const rb = await call("ROLLBACK_TO_LKG", actions.rollbackToLkg); healthy = rb.ok === true;
    }
    const vf = await call("VERIFY", actions.verify);
    if (healthy && vf.ok === true) { await call("RESUME", actions.resume); inc.resumed = true; inc.status = "RESOLVED_VERIFIED"; } else inc.status = "UNRESOLVED_SYSTEM_STAYS_FROZEN";
    log("REPORT", "DONE");
    return finish(inc);
  }
  const finish = inc => { inc.endedAt = now(); inc.report = { id: inc.id, type: inc.type, status: inc.status, stages: inc.stages.map(s => s.stage + ":" + s.status), resumed: inc.resumed }; return structuredClone(inc); };
  /** backups: [{id, createdAt, verifiedAt?, verifyOk?}]  drills: [{at, ok}]. Never reports PROVEN from existence alone. */
  function readiness({ backups = [], drills = [] } = {}) {
    const t = clock(), reasons = [];
    const verified = backups.filter(b => b.verifiedAt && b.verifyOk === true && t - Date.parse(b.verifiedAt) <= maxBackupAgeMs);
    const lastDrill = [...drills].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (!backups.length) reasons.push("NO_BACKUP");
    else if (!backups.some(b => b.verifiedAt && b.verifyOk === true)) reasons.push("BACKUPS_NEVER_VERIFIED");
    else if (!verified.length) reasons.push("VERIFICATION_STALE");
    if (!lastDrill) reasons.push("NO_RESTORE_DRILL"); else if (lastDrill.ok !== true) reasons.push("LAST_DRILL_FAILED"); else if (t - Date.parse(lastDrill.at) > maxDrillAgeMs) reasons.push("DRILL_STALE");
    const status = reasons.length === 0 ? "PROVEN_RECOVERABLE" : reasons.includes("NO_BACKUP") ? "NOT_RECOVERABLE" : reasons.some(r => /NEVER|FAILED/.test(r)) ? "UNPROVEN" : "STALE";
    return { status, reasons, verifiedBackups: verified.length, totalBackups: backups.length, lastDrill: lastDrill ?? null };
  }
  return { runIncident, readiness, incidents: () => incidents.map(i => structuredClone(i)), flow: INCIDENT_FLOW };
}
