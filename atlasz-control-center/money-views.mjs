// Read-only Money Engine / Jobs / Agents views for the Control Center (V7.3 §53, §74). Reads only what the runtime persisted under <state>/money
// (and the brain capability graph); nothing is computed from defaults and nothing is fabricated: no files => NOT_CONNECTED with zeros marked as "no data".
// SANDBOX money is always shown separately from LIVE and is never added to revenue.
import fs from "node:fs";
import path from "node:path";

const read = f => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null; } catch { return { __unreadable: true, file: path.basename(f) }; } };
const vals = o => (o && !o.__unreadable ? Object.values(o) : []);
const count = (list, key) => list.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
const sum = a => a.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);

export function createMoneyViews({ stateDir }) {
  const mdir = path.join(stateDir, "money"), bdir = path.join(stateDir, "brain");
  const load = n => read(path.join(mdir, n));
  function money() {
    if (!fs.existsSync(mdir)) return { state: "NOT_CONNECTED", note: "No Money Engine state exists. Nothing has been discovered, sent, won, delivered, invoiced or paid; all figures are unknown, not zero revenue.", live: null, sandbox: null };
    const files = { jobs: load("jobs-universal.json"), deals: load("deals.json"), invoices: load("invoices.json"), payments: load("payments.json"), comms: load("comms.json"), deliveries: load("deliveries.json") };
    const unreadable = Object.entries(files).filter(([, v]) => v?.__unreadable).map(([k]) => k);
    const jobs = vals(files.jobs?.jobs), deals = vals(files.deals?.deals), invoices = vals(files.invoices?.invoices), payments = vals(files.payments?.payments), comms = vals(files.comms?.msgs), deliveries = vals(files.deliveries?.deliveries);
    const env = e => ({
      deals: count(deals.filter(d => (d.environment ?? "UNLABELLED") === e), "status"),
      jobs: count(jobs.filter(j => (j.environment ?? "UNLABELLED") === e), "status"),
      invoices: count(invoices.filter(i => (i.environment ?? "UNLABELLED") === e), "status"),
      payments: count(payments.filter(p => (p.environment ?? "UNLABELLED") === e), "status"),
      outreachSent: comms.filter(c => (c.environment ?? "UNLABELLED") === e && ["SENT", "DELIVERED_IF_VERIFIABLE"].includes(c.state)).length,
      deliveries: count(deliveries.filter(d => (d.environment ?? "UNLABELLED") === e), "status"),
      claimedNotVerifiedUsd: sum(payments.filter(p => (p.environment ?? "UNLABELLED") === e && ["CLAIMED", "PENDING_VERIFICATION", "UNKNOWN"].includes(p.status)).map(p => p.amount)),
      verifiedReceivedUsd: sum(payments.filter(p => (p.environment ?? "UNLABELLED") === e && p.status === "VERIFIED").map(p => p.amount)),
      actualCostUsd: sum(jobs.filter(j => (j.environment ?? "UNLABELLED") === e).flatMap(j => j.costs ?? []).filter(c => c.class === "ACTUAL").map(c => c.amountUsd)),
      unknownCostEntries: jobs.filter(j => (j.environment ?? "UNLABELLED") === e).flatMap(j => j.costs ?? []).filter(c => c.amountUsd === null).length
    });
    const live = env("LIVE"), sandbox = env("SANDBOX");
    live.verifiedNetProfitUsd = live.verifiedReceivedUsd - live.actualCostUsd;
    live.profitNote = live.payments.VERIFIED ? "Verified received minus recorded actual cost (unknown cost entries make this an upper bound)." : "No verified payment: there is no verified revenue or profit.";
    return { state: unreadable.length ? "PARTIAL_UNREADABLE" : "CONNECTED", unreadable, live, sandbox: { ...sandbox, note: "SANDBOX flow. Never counted as revenue or profit." },
      note: "Opportunity value is not revenue. SENT/WON/PAID appear only where an engine recorded evidence." };
  }
  function recurring() {
    const f = load("subscriptions.json"); if (!f) return { state: "NOT_CONNECTED", note: "No subscriptions recorded." }; if (f.__unreadable) return { state: "UNREADABLE" };
    const subs = vals(f.subs), per = vals(f.periods), env = e => subs.filter(s => (s.environment ?? "UNLABELLED") === e);
    const inv = vals(load("invoices.json")?.invoices), paid = new Set(inv.filter(i => i.status === "VERIFIED_PAID" && (i.environment ?? "UNLABELLED") === "LIVE").map(i => i.id));
    const live = env("LIVE"), liveKeys = new Set(live.map(s => s.id));
    return { state: "CONNECTED", live: { subscriptions: count(live, "status"), contractedMrrUsd: sum(live.filter(s => s.status === "ACTIVE").map(s => s.interval === "WEEKLY" ? s.amount * 52 / 12 : s.amount / ({ MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 }[s.interval] ?? Infinity))), verifiedReceivedUsd: sum(per.filter(p => liveKeys.has(p.subscriptionId) && paid.has(p.invoiceId)).map(p => p.amount)), note: "Contracted MRR is a claim about the future, not revenue." },
      sandbox: { subscriptions: count(env("SANDBOX"), "status"), note: "SANDBOX: never revenue." } };
  }
  /** CRM / entity graph / inbox pipeline: read-only views of what the runtime persisted. Quarantined inbox items carry no body (withheld at ingest). */
  function crmInbox(asOf = new Date().toISOString()) {
    const g = read(path.join(bdir, "entity-graph.json")), fu = load("crm.json"), ip = read(path.join(stateDir, "inbox", "pipeline.json"));
    const graph = !g ? { state: "NOT_CONNECTED" } : g.__unreadable ? { state: "UNREADABLE" } : (() => {
      const ents = vals(g.entities), edges = vals(g.edges);
      return { state: "CONNECTED", entities: count(ents.filter(e => !e.retired), "type"), stubs: ents.filter(e => e.stub && !e.retired).length, retired: ents.filter(e => e.retired).length, edges: edges.length, tenants: [...new Set(ents.map(e => e.tenantId))].length,
        danglingEdges: edges.filter(e => !g.entities[`${e.tenantId}|${e.from.type}|${e.from.id}`] || !g.entities[`${e.tenantId}|${e.to.type}|${e.to.id}`]).length };
    })();
    const followups = !fu ? { state: "NOT_CONNECTED" } : fu.__unreadable ? { state: "UNREADABLE" } : (() => { const f = vals(fu.followups); return { state: "CONNECTED", open: f.filter(x => x.status === "OPEN").length, overdue: f.filter(x => x.status === "OPEN" && Date.parse(x.dueAt) < Date.parse(asOf)).length, done: f.filter(x => x.status === "DONE").length }; })();
    const inboxState = !ip ? { state: "NOT_CONNECTED" } : ip.__unreadable ? { state: "UNREADABLE" } : (() => { const it = vals(ip.items); return { state: "CONNECTED", total: it.length, byKind: count(it, "kind"), byRouteStatus: count(it, "routeStatus"), quarantined: it.filter(i => i.quarantined).length,
      needsOwner: it.filter(i => ["HELD_FOR_OWNER", "QUEUED_FOR_OWNER", "NEEDS_PROVIDER_EVIDENCE", "FAILED"].includes(i.routeStatus)).length,
      recent: it.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 30).map(i => ({ id: i.id, kind: i.kind, priority: i.priority, route: i.route, routeStatus: i.routeStatus, sender: i.entity?.status, deals: i.links?.deals ?? [], quarantined: i.quarantined })) }; })();
    return { graph, followups, inbox: inboxState, note: "Read-only. Replies count only with provider evidence; payment messages are claims; nothing here sends anything." };
  }
  function jobs() {
    const f = load("jobs-universal.json"); if (!f) return { state: "NOT_CONNECTED", items: [] }; if (f.__unreadable) return { state: "UNREADABLE", items: [] };
    return { state: "CONNECTED", items: vals(f.jobs).map(j => ({ id: j.id, goal: j.goal, status: j.status, environment: j.environment ?? "LIVE", agents: j.assignedAgents ?? [], blocked: j.blocked ?? null, dealId: j.dealId ?? null, artifacts: (j.artifacts ?? []).length, updatedAt: j.updatedAt })) };
  }
  function agents() {
    const g = read(path.join(bdir, "capability-graph.json")); if (!g) return { state: "NOT_CONNECTED", expected: 30, items: [] }; if (g.__unreadable) return { state: "UNREADABLE", expected: 30, items: [] };
    const list = Object.values(g).filter(n => n.type === "AGENT").map(n => ({ id: n.id, team: n.team ?? null, capabilities: n.capabilities ?? [], health: n.health ?? "UNKNOWN", available: n.available, runs: n.stats?.runs ?? 0, ok: n.stats?.ok ?? 0 }));
    return { state: "CONNECTED", expected: 30, count: list.length, topologyOk: list.length === 30, items: list };
  }
  return { money, jobs, agents, recurring, crmInbox };
}
