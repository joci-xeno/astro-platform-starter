// ATLASZ recovery source mapping (V7.3 §50). Resolves each recovery category to a REAL local directory, or leaves it NOT_CONFIGURED with the exact
// reason. Nothing is invented: a candidate is mapped only if it exists, is a real directory (not a symlink escaping the allowed roots), is readable,
// and is not a secret store. Categories with no real directory stay NOT_CONFIGURED (EXISTS != RESTORABLE; restorability is proven by the drill).
import fs from "node:fs";
import path from "node:path";
import { RECOVERY_CATEGORIES } from "./recovery-points.mjs";

const SECRET_DIRS = Object.freeze(["vault", "secrets", ".secrets", "keys"]);
// category -> [root, relative dir, why]. Roots: "data" (runtime state dir) or "app" (installed code).
export const CANDIDATES = Object.freeze({
  APPLICATION_VERSION: [["app", "atlasz-addons", "installed ATLASZ add-on code (the application release)"]],
  AGENT_WORKFLOWS: [["data", "brain", "Brain state: durable jobs (jobs.json), plans, checkpoints"]],
  CRITICAL_SYSTEM_STATE: [["data", "ledger", "financial ledger (revenue/cost truth)"]],
  // No dedicated directory exists in the current runtime for these; the capability graph lives inside brain/ (covered by AGENT_WORKFLOWS).
  CONFIGURATION: [], DATABASE_SCHEMA: [], MODEL_ROUTING: [], CONNECTOR_CONFIGURATION: []
});

export function validateSource(dir, allowedRoots) {
  const checks = [];
  const add = (name, ok, detail = null) => { checks.push({ name, ok, detail }); return ok; };
  let real = null;
  if (!add("EXISTS", fs.existsSync(dir), "PATH_DOES_NOT_EXIST")) return { ok: false, checks };
  try { real = fs.realpathSync(dir); } catch { add("RESOLVABLE", false, "REALPATH_FAILED"); return { ok: false, checks }; }
  if (!add("IS_DIRECTORY", fs.statSync(real).isDirectory(), "NOT_A_DIRECTORY")) return { ok: false, checks };
  if (!add("INSIDE_ALLOWED_ROOT", allowedRoots.some(r => { try { const rr = fs.realpathSync(r); return real === rr || real.startsWith(rr + path.sep); } catch { return false; } }), "OUTSIDE_ALLOWED_ROOTS")) return { ok: false, checks };
  if (!add("NOT_A_SECRET_STORE", !real.split(path.sep).some(p => SECRET_DIRS.includes(p.toLowerCase())), "SECRET_STORE_NEVER_BACKED_UP_AS_PLAINTEXT")) return { ok: false, checks };
  try { fs.accessSync(real, fs.constants.R_OK); add("READABLE", true); } catch { add("READABLE", false, "NOT_READABLE"); return { ok: false, checks }; }
  return { ok: true, checks, real };
}

export function mapRecoverySources({ dataDir, appDir = null, candidates = CANDIDATES } = {}) {
  const roots = { data: dataDir, app: appDir };
  const allowed = Object.values(roots).filter(Boolean);
  const sources = {}, report = [];
  for (const cat of RECOVERY_CATEGORIES) {
    const list = candidates[cat] ?? [];
    if (!list.length) { report.push({ category: cat, status: "NOT_CONFIGURED", reason: "NO_LOCAL_SOURCE_EXISTS_FOR_CATEGORY", path: null }); continue; }
    let mapped = null, last = null;
    for (const [root, rel, why] of list) {
      if (!roots[root]) { last = { reason: "ROOT_NOT_PROVIDED:" + root }; continue; }
      const dir = path.join(roots[root], rel), v = validateSource(dir, allowed);
      if (v.ok) { mapped = { dir: v.real, why, checks: v.checks }; break; }
      last = { reason: v.checks.find(c => !c.ok).detail, path: dir };
    }
    if (mapped) { sources[cat] = mapped.dir; report.push({ category: cat, status: "MAPPED", path: mapped.dir, why: mapped.why, checks: mapped.checks.map(c => c.name) }); }
    else report.push({ category: cat, status: "NOT_CONFIGURED", reason: last?.reason ?? "NO_CANDIDATE", path: last?.path ?? null });
  }
  return { sources, report, mapped: report.filter(r => r.status === "MAPPED").length, notConfigured: report.filter(r => r.status === "NOT_CONFIGURED").length };
}
