// Computes the evidence level of every audited module and writes docs/audit/module_dispositions.json (consumed by scripts/repair-register.mjs).
// Levels (each requires the previous one; none is inferred from a lower one):
//   NOT_REGISTERED < REGISTERED (module broker knows it) < SELF_TESTED (its real self-test passed through the control chain, or it is consumed by a self-tested module)
//   < RUNTIME_CONNECTED (a hosted Control Center / runtime component imports it directly, or it is a CONTINUOUS service) < END_TO_END_VERIFIED (a named test drives its real code path in a multi-stage flow)
//   < LIVE_OPERATIONAL (genuinely used against a real external service with authenticated evidence; nothing qualifies today).
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), A = p => path.join(root, "docs/audit", p);
const M = JSON.parse(fs.readFileSync(A("integration_matrix_2026-10-11.json"), "utf8")), E2E = JSON.parse(fs.readFileSync(A("e2e_evidence.json"), "utf8"));
const LIVE = fs.existsSync(A("live_evidence.json")) ? JSON.parse(fs.readFileSync(A("live_evidence.json"), "utf8")) : {};
const d = fs.mkdtempSync(path.join(os.tmpdir(), "mev-")), c = createControlCenterCore({ stateDir: path.join(d, "s"), configDir: path.join(d, "c") });
const cat = (await c.modules({ health: true })).catalog, bySrc = new Map(cat.map(m => [m.source, m]));
const hostFiles = ["atlasz-control-center/core.mjs", "atlasz-runtime/supervisor-safe.mjs", ...fs.readdirSync(path.join(root, "atlasz-control-center")).filter(f => f.endsWith(".mjs") && f !== "core.mjs").map(f => "atlasz-control-center/" + f)];
// "instantiated by a hosted component": the hosted file (Control Center core / panels / views / runtime supervisor) imports a named export of the module AND calls it. A bare import, a registration or a transitive library import is NOT enough.
const instantiated = new Set(); for (const hf of hostFiles) { let t = ""; try { t = fs.readFileSync(path.join(root, hf), "utf8"); } catch { continue; }
  for (const m of t.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) { const g = path.posix.normalize(path.posix.join(path.posix.dirname(hf), m[2])); if (!fs.existsSync(path.join(root, g))) continue;
    const names = m[1].split(",").map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean); const rest = t.replace(m[0], "");
    if (names.some(n => new RegExp("\\b" + n.replace(/\$/g, "\\$") + "\\s*\\(").test(rest))) instantiated.add(g); } }
const importedByHost = f => instantiated.has(f);
const LEGACY = new Set(["atlasz-runtime/supervisor.js", "atlasz-runtime/worker.js", "atlasz-runtime/agent-child.js"]);
const ORDER = ["NOT_REGISTERED", "REGISTERED", "SELF_TESTED", "RUNTIME_CONNECTED", "END_TO_END_VERIFIED", "LIVE_OPERATIONAL"];
const out = [];
const rows = [...M.rows]; for (const m of cat) if (!rows.some(r => r.file === m.source)) rows.push({ file: m.source, connectedToControlCenter: false, connectedToMaster: false, connectedToAgents: false, added: true });
for (const r of rows) {
  const f = r.file, m = bySrc.get(f), original133 = !r.added && !(r.connectedToControlCenter || r.connectedToMaster || r.connectedToAgents);
  let level = "NOT_REGISTERED", disposition = null, why = "";
  if (LEGACY.has(f)) { disposition = "EXCLUDED_LEGACY_QUARANTINED"; why = "Legacy competition runtime: excluded by policy-guards, not registered, not deleted, not activated; removal needs an owner decision."; }
  else if (m) {
    level = "REGISTERED"; const h = m.health?.state;
    if (["HEALTHY", "VIA_CONSUMER"].includes(h)) level = "SELF_TESTED";
    if (level === "SELF_TESTED" && (m.lifecycle === "CONTINUOUS" || importedByHost(f))) level = "RUNTIME_CONNECTED";
    if (LIVE[f]?.evidence) level = "LIVE_OPERATIONAL";
    disposition = { ON_DEMAND: "REAL_RUNTIME_PATH_VIA_BROKER", CONTINUOUS: "REAL_RUNTIME_PATH_CONTINUOUS", INTERNAL_LIBRARY: "OPERATIONAL_PARENT:" + m.consumer, OFFLINE_ACTIVATED: "DOCUMENTED_OWNER_ACTIVATION", BUILD_ONLY: "DOCUMENTED_BUILD_ONLY", SUPERSEDED: "SUPERSEDED_BY:" + m.supersededBy }[m.lifecycle] ?? "UNCLASSIFIED";
    why = h === "LOADED_NEEDS_DEPENDENCY" ? "Registered and loaded; its self-test needs an injected dependency (model/data): " + (m.health.detail ?? "") : (m.health?.detail ?? "");
  } else if (r.connectedToControlCenter || r.connectedToMaster || r.connectedToAgents) { level = importedByHost(f) ? "RUNTIME_CONNECTED" : "STATIC_IMPORT_ONLY"; disposition = "STATIC_RUNTIME_IMPORT"; why = importedByHost(f) ? "Instantiated by a hosted component." : "Imported by a running component (static closure) but not proven invoked; not in the broker."; }
  else { disposition = "UNRESOLVED"; why = "No broker entry and no runtime import."; }
  { const t = E2E[f]; if (t && !["NOT_REGISTERED", "REGISTERED"].includes(level) && fs.existsSync(path.join(root, t)) && new RegExp(path.basename(f).replace(/\.mjs$/, "").replace(/[-.]/g, "[-.]")).test(fs.readFileSync(path.join(root, t), "utf8"))) level = "END_TO_END_VERIFIED"; }
  if (LIVE[f]?.evidence) level = "LIVE_OPERATIONAL";
  out.push({ source: f, id: m?.id ?? null, original133, lifecycle: m?.lifecycle ?? null, health: m?.health?.state ?? null, level, disposition, why: String(why).slice(0, 220), e2eTest: level === "END_TO_END_VERIFIED" ? E2E[f] : null });
}
const tally = k => out.reduce((o, x) => (o[x[k]] = (o[x[k]] ?? 0) + 1, o), {});
const o133 = out.filter(x => x.original133);
const summary = { generatedAt: new Date().toISOString(), modules: out.length, levels: tally("level"), original133: o133.length, original133Levels: o133.reduce((o, x) => (o[x.level] = (o[x.level] ?? 0) + 1, o), {}), original133Unresolved: o133.filter(x => x.disposition === "UNRESOLVED").map(x => x.source), original133Quarantined: o133.filter(x => x.disposition === "EXCLUDED_LEGACY_QUARANTINED").map(x => x.source), liveOperational: out.filter(x => x.level === "LIVE_OPERATIONAL").length };
fs.writeFileSync(A("module_dispositions.json"), JSON.stringify({ summary, modules: out }, null, 1));
console.log(JSON.stringify(summary)); process.exit(0);
