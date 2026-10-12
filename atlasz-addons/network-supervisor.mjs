// ATLASZ per-agent network supervision. Every outbound decision (allowed or refused) is attributed to: agent, task, tool, destination host/port, method, policy decision, timestamp,
// response status, failure reason, security event and cost. Only the HOST is kept (never path/query/body/headers); every string is scrubbed. Records go to a hash-chained audit file.
// Detectors (per agent, sliding windows) turn patterns into incidents through an injected `declare` (the incident controller): repeated refusals, unauthorised destinations, credential
// requests without a grant, attempts to reach the network around the approved broker (a deterministic, CONFIRMED event), unusual traffic volume / destination spread, and excessive tool activity.
// Honest limit: it sees what is reported to it by the wired paths (brokered fetch, provider egress, credential broker, execution boundary). It is not a packet monitor.
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { scrub } from "./secret-patterns.mjs";

export const NET_LIMITS = Object.freeze({ ring: 5000, windowMs: 10 * 60000, repeatedRefusals: 5, unauthorisedDestinations: 3, credentialDenials: 3, bytesOut: 20 * 1024 * 1024, distinctHosts: 15, toolCallsPerMinute: 90, cooldownMs: 10 * 60000 });
const clean = (v, n = 80) => (v == null ? null : scrub(String(v)).slice(0, n));
const UNAUTH = /HOST_NOT|EGRESS_|NO_POLICY|DESTINATION|NOT_IN_REGISTRY|URL_INVALID|HOST_/;

export function createNetworkSupervisor({ dir = null, declare = null, now = () => Date.now(), limits = {} } = {}) {
  const L = { ...NET_LIMITS, ...limits }, ring = [], cool = new Map(), findings = [];
  const audit = createAuditChain({ filePath: dir ? path.join(dir, "network-supervision.jsonl") : null, headPinFile: dir ? path.join(dir, "network-supervision.headpin.json") : null });
  const raise = (rule, agentId, severity, confirmed, detail) => {
    const key = rule + ":" + agentId, t = now(); if ((cool.get(key) ?? 0) > t - L.cooldownMs) return null; cool.set(key, t);
    const f = { rule, agentId, severity, confirmed, detail: clean(detail, 200), at: new Date(t).toISOString(), incident: null };
    if (typeof declare === "function") { try { const i = declare({ kind: "NETWORK_" + rule, severity, confirmed, agentId, detail: f.detail }); f.incident = i?.id ?? null; } catch { f.incident = "DECLARE_FAILED"; } }
    findings.push(f); if (findings.length > 500) findings.shift(); try { audit.append("NETWORK_FINDING", { rule, agentId, severity, confirmed, incident: f.incident }); } catch { /* the finding is still kept in memory */ } return f;
  };
  function evaluate(agentId, e) {
    const t = now(), mine = ring.filter(x => x.agentId === agentId && t - x.ts <= L.windowMs);
    const refused = mine.filter(x => x.decision === "DENY" && x.kind !== "TOOL");
    if (refused.length >= L.repeatedRefusals) raise("REPEATED_BLOCKED_REQUESTS", agentId, "HIGH", false, refused.length + " refused requests in " + Math.round(L.windowMs / 60000) + " min");
    const unauth = refused.filter(x => x.kind === "EGRESS" && UNAUTH.test(x.reason ?? ""));
    if (unauth.length >= L.unauthorisedDestinations) raise("UNAUTHORISED_DESTINATIONS", agentId, "HIGH", false, "destinations: " + [...new Set(unauth.map(x => x.host))].slice(0, 5).join(","));
    const cred = mine.filter(x => x.kind === "CREDENTIAL" && x.decision === "DENY"); if (cred.length >= L.credentialDenials) raise("UNEXPECTED_CREDENTIAL_ACCESS", agentId, "HIGH", false, cred.length + " credential requests refused");
    const out = mine.filter(x => x.decision === "ALLOW" && x.kind !== "TOOL"); const bytes = out.reduce((s, x) => s + (x.bytesOut || 0), 0);
    if (bytes > L.bytesOut) raise("UNUSUAL_OUTBOUND_VOLUME", agentId, "MEDIUM", false, Math.round(bytes / 1024) + " KiB out in window");
    const hosts = new Set(out.map(x => x.host).filter(Boolean)); if (hosts.size > L.distinctHosts) raise("UNUSUAL_DESTINATION_SPREAD", agentId, "MEDIUM", false, hosts.size + " distinct hosts in window");
    const tools = mine.filter(x => x.kind === "TOOL" && t - x.ts <= 60000); if (tools.length > L.toolCallsPerMinute) raise("EXCESSIVE_TOOL_ACTIVITY", agentId, "MEDIUM", false, tools.length + " tool calls in a minute");
    if (e.kind === "BYPASS") raise("BROKER_BYPASS_ATTEMPT", agentId, "CRITICAL", true, "attempted network access outside the approved egress broker");
  }
  /** record({kind: EGRESS|CREDENTIAL|TOOL|BYPASS|FILE, agentId, taskId, tool, host, port, method, decision: ALLOW|DENY, status, reason, bytesOut, costUsd, securityEvent}) - never throws. */
  function record(ev = {}) {
    try {
      const agentId = clean(ev.agentId, 40) ?? "UNATTRIBUTED";
      const e = { ts: now(), kind: ["EGRESS", "CREDENTIAL", "TOOL", "BYPASS", "FILE"].includes(ev.kind) ? ev.kind : "EGRESS", agentId, taskId: clean(ev.taskId), tool: clean(ev.tool), host: clean(ev.host, 120)?.toLowerCase() ?? null, port: Number.isInteger(ev.port) ? ev.port : null, method: clean(ev.method, 10),
        decision: ev.decision === "ALLOW" ? "ALLOW" : "DENY", status: Number.isInteger(ev.status) ? ev.status : null, reason: clean(ev.reason, 80), bytesOut: Number.isFinite(ev.bytesOut) ? Math.max(0, ev.bytesOut) : 0, costUsd: Number.isFinite(ev.costUsd) ? ev.costUsd : null, securityEvent: ev.securityEvent ? clean(ev.securityEvent, 60) : null };
      ring.push(e); if (ring.length > L.ring) ring.shift();
      if (e.kind !== "TOOL" || e.decision === "DENY") { try { audit.append("NETWORK_EVENT", { ...e, ts: new Date(e.ts).toISOString() }); } catch { /* ring still holds it */ } }
      evaluate(agentId, e); return e;
    } catch { return null; }
  }
  const forAgent = (agentId, { sinceMs = L.windowMs } = {}) => ring.filter(x => x.agentId === agentId && now() - x.ts <= sinceMs).map(x => ({ ...x }));
  const summary = () => { const per = {}; for (const x of ring) { const p = (per[x.agentId] ??= { allowed: 0, refused: 0, hosts: new Set(), costUsd: 0 }); x.decision === "ALLOW" ? p.allowed++ : p.refused++; if (x.host) p.hosts.add(x.host); p.costUsd += x.costUsd || 0; }
    return { events: ring.length, findings: findings.length, agents: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { allowed: v.allowed, refused: v.refused, hosts: v.hosts.size, costUsd: v.costUsd }])) }; };
  /** The only fetch to hand to tool code: checks the boundary + a caller-supplied destination check first, records the outcome with attribution, and never follows redirects. */
  function brokeredFetch({ boundary = null, allow = () => ({ allowed: false, reason: "NO_EGRESS_POLICY" }), fetchImpl = globalThis.fetch } = {}) {
    return async (url, init = {}, ctx = {}) => {
      let u; try { u = new URL(String(url)); } catch { record({ kind: "EGRESS", ...ctx, decision: "DENY", reason: "URL_INVALID" }); return { ok: false, reason: "URL_INVALID" }; }
      const base = { kind: "EGRESS", agentId: ctx.agentId, taskId: ctx.taskId, tool: ctx.tool, host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80), method: (init.method ?? "GET").toUpperCase(), bytesOut: init.body ? Buffer.byteLength(String(init.body)) : 0 };
      const b = boundary?.check({ agentId: ctx.agentId, onBehalfOf: ctx.onBehalfOf, tool: ctx.tool, opClass: "NETWORK_REQUEST", taskId: ctx.taskId }); if (b && !b.allowed) { record({ ...base, decision: "DENY", reason: b.reason }); return { ok: false, reason: b.reason }; }
      let a; try { a = allow({ url: String(url), method: base.method, host: u.hostname, ...ctx }); } catch { a = { allowed: false, reason: "POLICY_ERROR" }; }
      if (!a?.allowed) { record({ ...base, decision: "DENY", reason: a?.reason ?? "DENIED" }); return { ok: false, reason: a?.reason ?? "DENIED" }; }
      try { const r = await fetchImpl(String(url), { ...init, redirect: "error" }); record({ ...base, decision: "ALLOW", status: r.status }); return { ok: r.ok, status: r.status, response: r }; }
      catch (e) { record({ ...base, decision: "ALLOW", reason: "UPSTREAM_ERROR:" + clean(e?.message, 40) }); return { ok: false, reason: "UPSTREAM_ERROR" }; }
    };
  }
  return { record, forAgent, findings: () => findings.map(f => ({ ...f })), summary, brokeredFetch, verify: () => audit.verify(), auditEntries: () => audit.entries() };
}
