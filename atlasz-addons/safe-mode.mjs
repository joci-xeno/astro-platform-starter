// ATLASZ Safe Mode + crash-loop protection (V7.3 §52, §17).
// SAFE_MODE blocks every external action and every dispatch; reads/status stay available.
// The SYSTEM may enter Safe Mode by itself (moving to a safer state never needs approval); LEAVING it needs a signed owner
// approval (SAFE_MODE_EXIT) AND a passing self-check supplied by the caller. A missing/unreadable state file fails SAFE.
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { getDefaultOwnerAuth } from "./owner-auth.mjs";

export function createSafeMode({ statePath = null, auditPath = null, ownerAuth = getDefaultOwnerAuth(), now = () => Date.now(),
  crashLoop = { maxBoots: 3, windowMs: 120000 } } = {}) {
  const audit = createAuditChain({ filePath: auditPath });
  let st = { mode: "NORMAL", reason: null, since: null, boots: [], healthyAt: null };
  const iso = () => new Date(now()).toISOString();
  function persist() {
    if (!statePath) return;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = statePath + ".tmp", fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeSync(fd, JSON.stringify(st)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, statePath);
    seenMtime = fs.statSync(statePath).mtimeMs;
  }
  function enter(reason, detail = {}) {
    load();
    if (st.mode === "SAFE_MODE") return status();
    st = { ...st, mode: "SAFE_MODE", reason: String(reason), since: iso() };
    audit.append("SAFE_MODE_ENTERED", { reason: String(reason), ...detail });
    persist();
    return status();
  }
  let seenMtime = -1;
  function load() {
    if (!statePath || !fs.existsSync(statePath)) return;
    const m = fs.statSync(statePath).mtimeMs;
    if (m === seenMtime) return;
    seenMtime = m;
    try {
      const f = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (!["NORMAL", "SAFE_MODE"].includes(f.mode) || !Array.isArray(f.boots)) throw new Error("bad");
      st = f;
    } catch { st = { mode: "NORMAL", reason: null, since: null, boots: [], healthyAt: null }; enter("STATE_FILE_UNREADABLE"); }
  }
  load();
  // Call once per process start. N boots inside the window without markHealthy() in between => crash loop => Safe Mode.
  function recordBoot() {
    load();
    const t = now();
    st.boots = [...st.boots.filter(b => t - b < crashLoop.windowMs), t];
    audit.append("BOOT_RECORDED", { bootsInWindow: st.boots.length });
    if (st.boots.length >= crashLoop.maxBoots) enter("CRASH_LOOP", { boots: st.boots.length, windowMs: crashLoop.windowMs });
    persist();
    return status();
  }
  // Call after the process has run healthily for a while: clears the crash counter.
  function markHealthy() { st.boots = []; st.healthyAt = iso(); persist(); }
  function exit({ ownerApproval = null, selfCheck = null } = {}) {
    load();
    if (st.mode !== "SAFE_MODE") return status();
    const deny = why => { audit.append("SAFE_MODE_EXIT_DENIED", { why }); throw new Error("SAFE_MODE_EXIT_DENIED:" + why); };
    if (!selfCheck || selfCheck.level === "FAIL" || selfCheck.ok === false) deny("SELF_CHECK_NOT_PASSING");
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "SAFE_MODE_EXIT", subject: "NORMAL" });
    if (!v.allowed) deny(v.reason);
    st = { ...st, mode: "NORMAL", reason: null, since: null, boots: [], healthyAt: iso() };
    audit.append("SAFE_MODE_EXITED", { nonce: ownerApproval.nonce });
    persist();
    return status();
  }
  function gate({ external = false, write = false } = {}) {
    load();
    if (st.mode === "SAFE_MODE" && (external || write)) return { allowed: false, reason: "SAFE_MODE:" + st.reason };
    return { allowed: true, reason: null };
  }
  function status() { load(); return { mode: st.mode, reason: st.reason, since: st.since, recentBoots: st.boots.length, healthyAt: st.healthyAt, auditHead: audit.head() }; }
  return { enter, exit, gate, recordBoot, markHealthy, status, auditVerify: () => audit.verify(), auditEntries: () => audit.entries() };
}
