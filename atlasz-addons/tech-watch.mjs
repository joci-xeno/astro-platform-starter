// V7.3 Tech Watch: offline, feed-file-based compatibility monitor + self-inventory / capability-gap detection.
// It only READS owner-dropped feed files (JSON) and registry state. It never downloads or installs anything:
// an advisory is a notice for JOCI/Update Center, not an update. With no feed it says NO_FEED (never invents news).
import fs from "node:fs";
import path from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const cmpVer = (a, b) => { const x = SEMVER.exec(a), y = SEMVER.exec(b); if (!x || !y) return null; for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d < 0 ? -1 : 1; } return 0; };
const SEVERITIES = ["INFO", "RECOMMENDED", "SECURITY"];

export function validateFeedEntry(e) {
  const p = [];
  if (!e || typeof e !== "object") return ["NOT_AN_OBJECT"];
  if (!e.componentId || typeof e.componentId !== "string") p.push("COMPONENT_ID_REQUIRED");
  if (!SEMVER.test(String(e.version ?? ""))) p.push("VERSION_NOT_SEMVER");
  if (e.severity !== undefined && !SEVERITIES.includes(e.severity)) p.push("BAD_SEVERITY");
  if (e.minNode !== undefined && !SEMVER.test(String(e.minNode))) p.push("MINNODE_NOT_SEMVER");
  if (e.source !== undefined && typeof e.source !== "string") p.push("BAD_SOURCE");
  return p;
}

export function createTechWatch({ feedDir, installed = () => [], nodeVersion = process.versions.node, completion = () => [], slots = [], now = () => new Date().toISOString() } = {}) {
  if (!feedDir) throw new Error("FEED_DIR_REQUIRED");
  let last = null;
  function readFeeds() {
    const entries = [], rejected = [], files = [];
    if (!fs.existsSync(feedDir)) return { entries, rejected, files };
    for (const f of fs.readdirSync(feedDir).filter(n => n.endsWith(".json")).sort()) {
      files.push(f);
      let j; try { j = JSON.parse(fs.readFileSync(path.join(feedDir, f), "utf8")); } catch { rejected.push({ file: f, problems: ["INVALID_JSON"] }); continue; }
      for (const e of Array.isArray(j.entries) ? j.entries : []) { const pr = validateFeedEntry(e); (pr.length ? rejected.push({ file: f, problems: pr }) : entries.push({ ...e, severity: e.severity ?? "INFO", feed: f })); }
    }
    return { entries, rejected, files };
  }
  function scan() {
    const { entries, rejected, files } = readFeeds();
    const inst = new Map(installed().map(c => [c.componentId, c.version]));
    const advisories = [];
    for (const e of entries) {
      const cur = inst.get(e.componentId);
      if (cur === undefined) continue;                                   // not something we run
      const c = cmpVer(e.version, cur);
      if (c === null || c <= 0) continue;                                // not newer
      const nodeOk = e.minNode ? cmpVer(nodeVersion, e.minNode) >= 0 : true;
      advisories.push({ componentId: e.componentId, installed: cur, available: e.version, severity: e.severity, breaking: e.breaking === true,
        compatibility: nodeOk ? "COMPATIBLE" : "INCOMPATIBLE_NODE:" + e.minNode, feed: e.feed, notes: e.notes ?? null, action: "DELIVER_AS_LOCAL_UPDATE_PACKAGE_AND_REQUEST_JOCI_APPROVAL" });
    }
    advisories.sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.componentId.localeCompare(b.componentId));
    const items = completion();
    const gaps = items.filter(i => i.state !== "LIVE").map(i => ({ id: i.id, title: i.title, state: i.state, blockedBy: i.blockedBy ?? [] }));
    const emptySlots = slots.filter(s => !s.provider || s.state !== "LIVE").map(s => ({ slot: s.slot ?? s.id, state: s.state ?? "EMPTY" }));
    last = { at: now(), status: files.length ? "OK" : "NO_FEED", feeds: files, advisories, rejected,
      inventory: { components: [...inst].map(([componentId, version]) => ({ componentId, version })), node: nodeVersion },
      capabilityGaps: { notLive: gaps.length, items: gaps.slice(0, 50), emptySlots } };
    return last;
  }
  return { scan, last: () => last };
}
