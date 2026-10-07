// Capability / Skill Graph (V7.3 Brain §4): durable graph of what each agent, team, model, tool, connector, skill and workflow can do,
// with measured (not claimed) reliability. match() returns the best usable AGENT+MODEL+TOOL+CONNECTOR+WORKFLOW combination and says why others were excluded.
import fs from "node:fs";
import path from "node:path";

export const NODE_TYPES = Object.freeze(["AGENT", "TEAM", "MODEL", "TOOL", "CONNECTOR", "SKILL", "WORKFLOW"]);
const COST = { FREE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, UNKNOWN: 2 };
const EVIDENCE_TYPES = new Set(["MODEL", "CONNECTOR", "TOOL"]);       // these must show a real passing probe to be usable

export function createCapabilityGraph({ file = null, now = () => new Date().toISOString() } = {}) {
  let nodes = {};
  if (file && fs.existsSync(file)) { try { nodes = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("CAPABILITY_GRAPH_UNREADABLE"); } }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + ".tmp"; fs.writeFileSync(t, JSON.stringify(nodes)); fs.renameSync(t, file); };

  /** node: {id, type, capabilities[], provider?, supportedTasks?, limitations?, permissions?, requiredCredentials?, costClass?, speedClass?, family?, canonical?:bool} */
  function upsert(n = {}) {
    if (!n.id || !NODE_TYPES.includes(n.type)) throw new Error("NODE_ID_AND_VALID_TYPE_REQUIRED");
    const old = nodes[n.id];
    nodes[n.id] = { id: n.id, type: n.type, capabilities: [...new Set(n.capabilities ?? old?.capabilities ?? [])], provider: n.provider ?? old?.provider ?? null, supportedTasks: n.supportedTasks ?? old?.supportedTasks ?? [],
      limitations: n.limitations ?? old?.limitations ?? [], permissions: n.permissions ?? old?.permissions ?? [], requiredCredentials: n.requiredCredentials ?? old?.requiredCredentials ?? [],
      costClass: n.costClass ?? old?.costClass ?? "UNKNOWN", speedClass: n.speedClass ?? old?.speedClass ?? "UNKNOWN", family: n.family ?? old?.family ?? n.id, attrs: { ...(old?.attrs ?? {}), ...(n.attrs ?? {}) },
      stats: old?.stats ?? { runs: 0, ok: 0, totalMs: 0, qualitySum: 0, qualityN: 0, recent: [] }, available: old?.available ?? true, health: old?.health ?? "UNKNOWN", evidence: old?.evidence ?? null, credentialsPresent: old?.credentialsPresent ?? false, updatedAt: now() };
    save(); return nodes[n.id];
  }
  const get = id => nodes[id] ?? null;
  const mut = (id, f) => { const n = nodes[id]; if (!n) throw new Error("UNKNOWN_NODE"); f(n); n.updatedAt = now(); save(); return n; };
  /** Evidence must come from a real probe: {probeId, outcome:"PASS", at, target}. Anything else clears it. */
  const setEvidence = (id, ev) => mut(id, n => { const ok = ev && ev.outcome === "PASS" && ev.probeId && ev.target && Number.isFinite(Date.parse(ev.at)); n.evidence = ok ? ev : null; n.health = ok ? "HEALTHY" : "UNKNOWN"; });
  const setHealth = (id, health, available = true) => mut(id, n => { n.health = health; n.available = available; });
  const setCredentials = (id, present) => mut(id, n => { n.credentialsPresent = Boolean(present); });
  function recordOutcome(id, { ok, ms = 0, quality = null }) {
    return mut(id, n => { const s = n.stats; s.runs++; if (ok) s.ok++; s.totalMs += Number(ms) || 0; if (Number.isFinite(quality)) { s.qualitySum += quality; s.qualityN++; } s.recent.push(ok ? 1 : 0); if (s.recent.length > 20) s.recent.shift(); });
  }
  const reliability = n => (n.stats.runs ? n.stats.ok / n.stats.runs : null);
  const view = n => ({ ...n, reliability: reliability(n), avgMs: n.stats.runs ? Math.round(n.stats.totalMs / n.stats.runs) : null, quality: n.stats.qualityN ? n.stats.qualitySum / n.stats.qualityN : null,
    usable: usability(n).usable, unusableReasons: usability(n).reasons });
  function usability(n, { sandbox = false } = {}) {
    const reasons = [];
    if (!n.available) reasons.push("UNAVAILABLE");
    if (n.health === "DOWN" || n.health === "DEGRADED_BREAKER_OPEN") reasons.push("HEALTH_" + n.health);
    if (n.requiredCredentials.length && !n.credentialsPresent) reasons.push("NO_CREDENTIALS");
    if (EVIDENCE_TYPES.has(n.type) && !n.evidence && !sandbox) reasons.push("NOT_PROBED_LIVE");
    return { usable: reasons.length === 0, reasons };
  }
  const score = n => { const r = reliability(n) ?? 0.5, q = n.stats.qualityN ? n.stats.qualitySum / n.stats.qualityN : 0.5; return 0.5 * r + 0.3 * q - 0.05 * COST[n.costClass] + (n.stats.runs ? 0 : -0.02); };
  /** req: {capabilities[], task?, allowCost?:bool (false => only FREE), sandbox?:bool (allows un-probed MODEL/TOOL/CONNECTOR), exclude?:[ids], preferFamilyNot?:string}
      Returns {matched, combination:{AGENT,MODEL,TOOL,CONNECTOR,WORKFLOW}, excluded:[{id,reasons}], needsApproval:[...]}.
      A requirement is satisfied by the best usable node of a type that offers it. Missing coverage is reported, never invented. */
  function match(req = {}) {
    const need = req.capabilities ?? [], ex = new Set(req.exclude ?? []), excluded = [], covered = new Set(), combo = {}, needsApproval = [];
    const cands = Object.values(nodes).filter(n => need.some(c => n.capabilities.includes(c)) || (req.task && n.supportedTasks.includes(req.task)));
    const ok = [];
    for (const n of cands) {
      const u = usability(n, { sandbox: req.sandbox }), r = [...u.reasons];
      if (ex.has(n.id)) r.push("EXCLUDED_BY_CALLER");
      if (!req.allowCost && COST[n.costClass] > 0 && n.costClass !== "UNKNOWN" && ["MODEL", "TOOL", "CONNECTOR"].includes(n.type)) r.push("NO_SPEND_DEFAULT");
      if (!req.allowCost && n.costClass === "UNKNOWN" && ["MODEL", "TOOL", "CONNECTOR"].includes(n.type)) r.push("UNKNOWN_COST_NO_SPEND_DEFAULT");
      if (req.preferFamilyNot && n.family === req.preferFamilyNot) r.push("SAME_FAMILY_AS_GENERATOR");
      if (r.length) excluded.push({ id: n.id, type: n.type, reasons: r }); else ok.push(n);
    }
    for (const type of ["AGENT", "MODEL", "TOOL", "CONNECTOR", "WORKFLOW", "TEAM", "SKILL"]) {
      const best = ok.filter(n => n.type === type && need.some(c => n.capabilities.includes(c))).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
      if (best) { combo[type] = best.id; best.capabilities.forEach(c => covered.add(c)); if (req.allowCost && COST[best.costClass] > 0) needsApproval.push(best.id); }
    }
    const missing = need.filter(c => !covered.has(c));
    return { matched: missing.length === 0 && Boolean(combo.AGENT || combo.WORKFLOW || combo.TEAM), combination: combo, missingCapabilities: missing, excluded, needsApproval, note: "Recommendation only; execution still passes governance." };
  }
  return { upsert, get, view: id => (nodes[id] ? view(nodes[id]) : null), list: () => Object.values(nodes).map(view), setEvidence, setHealth, setCredentials, recordOutcome, match, remove: id => { delete nodes[id]; save(); },
    summary: () => { const l = Object.values(nodes); return { total: l.length, byType: Object.fromEntries(NODE_TYPES.map(t => [t, l.filter(n => n.type === t).length])), usable: l.filter(n => usability(n).usable).length }; } };
}
