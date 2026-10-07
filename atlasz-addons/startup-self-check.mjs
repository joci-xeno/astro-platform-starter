// ATLASZ Startup Self-Check (V7.3 §52). Read-only: verifies the environment and durable state BEFORE the runtime dispatches work.
// Result level: OK | DEGRADED (runs, but something honest must be shown) | FAIL (must enter Safe Mode).
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { createDurableQueue } from "./durable-queue.mjs";

const ok = (id, detail = null) => ({ id, status: "OK", detail });
const warn = (id, detail) => ({ id, status: "DEGRADED", detail });
const fail = (id, detail) => ({ id, status: "FAIL", detail });

export function runStartupSelfCheck({ stateDir, ownerAuth = null, expectedAgents = null, vault = null, minNodeMajor = 20, minFreeBytes = 50 * 1024 * 1024 } = {}) {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(major >= minNodeMajor ? ok("node-version", process.versions.node) : fail("node-version", process.versions.node + " < " + minNodeMajor));
  if (!stateDir) checks.push(fail("state-dir", "STATE_DIR_NOT_SET"));
  else {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const probe = path.join(stateDir, ".selfcheck-" + process.pid);
      const fd = fs.openSync(probe, "w"); fs.writeSync(fd, "x"); fs.fsyncSync(fd); fs.closeSync(fd); fs.unlinkSync(probe);
      checks.push(ok("state-dir-writable", stateDir));
    } catch (e) { checks.push(fail("state-dir-writable", String(e.message))); }
    try {
      const s = fs.statfsSync(stateDir), free = Number(s.bavail) * Number(s.bsize);
      checks.push(free >= minFreeBytes ? ok("disk-free", free + " bytes") : warn("disk-free", "LOW:" + free + " bytes"));
    } catch { checks.push(warn("disk-free", "UNKNOWN")); }
    const stateFile = path.join(stateDir, "atlasz-state.json");
    if (fs.existsSync(stateFile)) {
      try { const s = JSON.parse(fs.readFileSync(stateFile, "utf8")); checks.push(Array.isArray(s.leads) && Array.isArray(s.candidates) ? ok("runtime-state") : fail("runtime-state", "STATE_SHAPE_INVALID")); }
      catch { checks.push(fail("runtime-state", "STATE_UNREADABLE")); }
    } else checks.push(ok("runtime-state", "FRESH_START"));
    const journal = path.join(stateDir, "queue", "queue-journal.jsonl");
    if (fs.existsSync(journal)) {
      try { createDurableQueue({ dir: path.dirname(journal) }); checks.push(ok("queue-journal")); }
      catch (e) { checks.push(fail("queue-journal", String(e.message))); }
    } else checks.push(ok("queue-journal", "FRESH_START"));
    for (const f of ["owner-auth-audit.jsonl", "emergency-audit.jsonl", "update-center-audit.jsonl", "safe-mode-audit.jsonl"]) {
      const p = path.join(stateDir, f);
      if (!fs.existsSync(p)) continue;
      try { createAuditChain({ filePath: p }).verify(); checks.push(ok("audit:" + f)); }
      catch (e) { checks.push(fail("audit:" + f, String(e.message))); }
    }
    const es = path.join(stateDir, "emergency-stop.json");
    if (fs.existsSync(es)) {
      try { const m = JSON.parse(fs.readFileSync(es, "utf8")).mode; checks.push(m === "RUNNING" ? ok("emergency-stop", m) : warn("emergency-stop", "ACTIVE:" + m)); }
      catch { checks.push(fail("emergency-stop", "STATE_UNREADABLE")); }
    }
  }
  if (ownerAuth) {
    const st = ownerAuth.status().state;
    checks.push(st === "PLACEHOLDER_UNCONNECTED" ? warn("owner-auth", "NO_OWNER_PUBLIC_KEY: critical actions are denied") : ok("owner-auth", st));
  }
  if (vault) { const v = vault.status(); checks.push(v.state === "LOCKED" ? warn("secret-vault", "LOCKED") : ok("secret-vault", v.entries + " entries")); }
  if (expectedAgents) {
    const good = expectedAgents.search === 5 && expectedAgents.execution === 25;
    checks.push(good ? ok("topology", "5+25=30") : fail("topology", JSON.stringify(expectedAgents)));
  }
  const level = checks.some(c => c.status === "FAIL") ? "FAIL" : checks.some(c => c.status === "DEGRADED") ? "DEGRADED" : "OK";
  return { level, ok: level !== "FAIL", at: new Date().toISOString(), checks };
}
