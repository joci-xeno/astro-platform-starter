// First controlled live discovery path: ONE approved source -> bounded GET (global-discovery engine; owner-signed host policy, DNS-pinned, rate-limited) -> normalise -> unified registry via the
// Master intake (10 checks, exactly-once hand-off). Retrieval labels come from the engine, never from here: CONNECTOR only for a real engine run. A first successful live run is recorded separately
// (first-live-discovery.json) and is written ONLY for retrieval=CONNECTOR; fixtures and operator captures can never create it.
import fs from "node:fs";
import path from "node:path";
import { normalizeOpportunity } from "./opportunity-intake.mjs";

/** Exact request each source uses (host is fixed by the signed policy; the query only narrows what is read). */
export const SOURCE_REQUESTS = Object.freeze({
  "hn-algolia": { url: "https://hn.algolia.com/api/v1/search_by_date?tags=comment&query=%22seeking%20freelancer%22&hitsPerPage=50", note: "Public HN Search API, read-only GET, no credentials." }
});
export const SEARCH_AGENTS = Object.freeze(["SEARCH-1", "SEARCH-2", "SEARCH-3", "SEARCH-4", "SEARCH-5"]);

export function createLiveDiscoveryRunner({ dir, engine, intake, registry, now = () => new Date().toISOString() } = {}) {
  if (!dir || !engine || !intake || !registry) throw new Error("RUNNER_NEEDS_DIR_ENGINE_INTAKE_REGISTRY");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const firstFile = path.join(dir, "first-live-discovery.json");
  const first = () => { try { return JSON.parse(fs.readFileSync(firstFile, "utf8")); } catch { return null; } };

  /** ready(sourceId) -> null when the source may run now, else the exact reason (nothing is contacted by asking). */
  function ready(sourceId) {
    if (!Object.hasOwn(SOURCE_REQUESTS, sourceId)) return "NO_REQUEST_DEFINED_FOR_SOURCE";
    const st = engine.sourceState(sourceId); return st && st.state === "READY_APPROVED_HOST" ? null : (st?.state ?? "UNKNOWN_SOURCE");
  }
  async function run({ sourceId, agentId }) {
    const why = ready(sourceId); if (why) return { ok: false, reason: why };
    if (!SEARCH_AGENTS.includes(agentId)) return { ok: false, reason: "SENDER_NOT_A_SEARCH_AGENT" };
    const r = await engine.run(sourceId, { url: SOURCE_REQUESTS[sourceId].url, agentId }); if (!r.ok) return { ok: false, reason: r.reason ?? "RUN_FAILED", detail: r.detail ?? null };
    const out = { ok: true, sourceId, agentId, retrieval: r.retrieval, retrieved: r.items.length, evidenceSha256: r.evidenceSha256, created: 0, updated: 0, duplicate: 0, rejected: 0, held: 0, routed: 0, malformed: 0 };
    for (const item of r.items) {
      const n = normalizeOpportunity(item, { sourceId, retrieval: r.retrieval, evidenceSha256: r.evidenceSha256, discoveredAt: now(), sourceUrl: item.url }); if (!n.ok) { out.malformed++; continue; }
      const h = intake.receive({ agentId, record: n.record });
      if (!h.ok) { out.malformed++; continue; }
      if (h.state === "ROUTED") out.routed++; else if (h.state === "REJECTED") out.rejected++; else if (h.state === "HELD_NEEDS_INFO") out.held++;
      if (h.duplicate || h.dedupe === "DUPLICATE_UNCHANGED") out.duplicate++; else if (h.dedupe === "UPDATED") out.updated++; else if (h.dedupe === "CREATED") out.created++;
    }
    if (r.retrieval === "CONNECTOR" && r.items.length && !first()) fs.writeFileSync(firstFile, JSON.stringify({ sourceId, at: now(), runId: r.runId, evidenceSha256: r.evidenceSha256, items: r.items.length, note: "First successful LIVE discovery through the approved host. Recorded separately from fixtures and operator captures." }, null, 1), { mode: 0o600 });
    return out;
  }
  return { run, ready, firstLive: first };
}
