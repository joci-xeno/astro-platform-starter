// Unified programme M6: Operations Dashboard, Revenue & Business dashboard and Live Agent Activity, composed from the REAL sources only.
//   Revenue rule: real receipts (financial ledger PAID entries with evidence) and simulated paper trading are two separate sections and are NEVER added together. A source that is not connected is reported as such, never as zero.
import path from "node:path";
import { agentActivity } from "../atlasz-addons/agent-activity.mjs";

export function createOpsViews({ stateDir, status, finance, approvals, tradingView, memoryView, ledgerEntries = () => [], now = () => Date.now() } = {}) {
  const coordFiles = { ledgerFile: path.join(stateDir, "coordination", "ledger.json"), coordFile: path.join(stateDir, "coordination", "coordinator.json") };
  const agents = () => agentActivity({ ...coordFiles, now: now() });
  const agent = id => { const a = agents(); const x = a.agents.find(z => z.id === id); return x ? { ok: true, available: a.available, agent: x, source: a.source ?? null } : { ok: false, reason: "NOT_A_ROSTER_AGENT" }; };

  async function operations() {
    const st = await status(), ag = agents(), ap = approvals(); let mem = null; try { const m = memoryView(); mem = m.state === "CONNECTED" ? { state: "CONNECTED", notes: m.store.notes, auditOk: m.store.auditOk, consistent: m.store.consistent, retrieval: m.indexing.semantic?.state ?? m.indexing.semantic ?? null, neural: "NOT ACTIVE unless the owner activated a local embedding model" } : { state: m.state, error: m.error ?? null }; } catch (e) { mem = { state: "ERROR", error: String(e?.message ?? e).slice(0, 120) }; }
    let tr = null; try { const v = tradingView(); tr = { datasets: v.datasets.length, strategies: v.paper.strategies.length, suspended: v.paper.strategies.filter(s => s.status === "SUSPENDED").length, warnings: v.paper.warnings, label: v.paper.label, liveData: v.liveData.state }; } catch { tr = { state: "ERROR" }; }
    const f = finance(), blockers = st.blockers ?? [];
    return { at: new Date(now()).toISOString(), system: { runtime: st.runtime.status, reachable: st.runtime.reachable, reason: st.runtime.reason ?? null, version: st.runtime.version, killSwitch: st.emergency.mode, safeMode: st.safeMode.mode, ownerKey: st.ownerKey.ownerAuthState },
      topology: st.topology, agents: { available: ag.available, reason: ag.reason ?? null, permanent: 30, counts: ag.counts, tasks: ag.tasks, source: ag.source ?? null },
      approvals: { pending: ap.pending.length, items: ap.pending.slice(0, 10).map(x => ({ id: x.id, what: x.what, action: x.action })) },
      events: ag.available ? ag.recentEvents.slice(-15) : [], memory: mem, trading: tr,
      revenue: { verifiedReceivedUsd: f.revenue.source === "LEDGER_UNREADABLE" || f.error ? null : f.revenue.verifiedReceivedUsd, state: f.revenue.source === "LEDGER_UNREADABLE" || f.error ? "LEDGER_UNREADABLE" : f.revenue.paymentRecords ? "VERIFIED_RECEIPTS_RECORDED" : "NO_PAYMENT_EVIDENCE_RECORDED", note: "Paper trading is not revenue and is not included." },
      securityAlerts: [...blockers.map(b => ({ kind: "BLOCKER", text: String(b).slice(0, 200) })), ...(st.emergency.mode !== "RUNNING" ? [{ kind: "KILL_SWITCH", text: "mode " + st.emergency.mode }] : []), ...(st.safeMode.mode !== "NORMAL" ? [{ kind: "SAFE_MODE", text: "mode " + st.safeMode.mode }] : []), ...(f.chain && f.chain.ok === false ? [{ kind: "LEDGER_CHAIN", text: "financial ledger chain failed verification" }] : [])],
      queue: st.queue ?? null };
  }

  async function revenue() {
    const f = finance(), st = await status(), rows = (() => { try { return ledgerEntries(); } catch { return []; } })(), by = {}; for (const r of rows) if (r.type === "REVENUE") by[r.stage] = (by[r.stage] ?? 0) + 1;
    let paper = null; try { const v = tradingView().paper; paper = { label: v.label, currency: v.currency, realMoney: false, realisedPnl: v.account.realisedEquity - v.account.starting, equityMarkedToMarket: v.account.equityMarkedToMarket, drawdownPct: v.account.drawdownPct, trades: v.trades.length, strategies: v.strategies.length }; } catch { paper = { state: "UNAVAILABLE" }; }
    const ledgerOk = f.revenue.source !== "LEDGER_UNREADABLE" && !f.error;
    return { at: new Date(now()).toISOString(),
      realBusiness: { source: "financial ledger (hash-chained); PAID needs authoritative external evidence", state: ledgerOk ? (f.revenue.paymentRecords ? "VERIFIED" : "NO_PAYMENT_EVIDENCE_RECORDED") : "LEDGER_UNREADABLE",
        funnel: { opportunitiesFound: st.metrics?.leads ?? null, outreachSent: st.money.outreachSent, won: st.money.won, stages: by },
        verifiedReceivedUsd: ledgerOk ? f.revenue.verifiedReceivedUsd : null, unconfirmedPipelineUsd: ledgerOk ? f.revenue.unconfirmedPipelineUsd : null, outstandingNote: "Pipeline and invoices are NOT revenue until a PAID entry with evidence exists.", costsUsd: ledgerOk ? f.costs.totalUsd : null, verifiedNetUsd: ledgerOk ? f.profit.verifiedNetUsd : null, paymentRecords: f.revenue.paymentRecords ?? 0, ledgerChainOk: f.chain?.ok ?? null },
      simulatedPaperTrading: paper,
      combinedTotal: null, separationNote: "Simulated trading results and real business revenue are reported separately and are never summed." };
  }
  return { agents, agent, operations, revenue };
}
