// V7.3 §Conversation-First / Daily Brief: a deterministic startup brief built ONLY from current durable state. No invented events.
// The greeting and phrase are owner-configurable; the phrase is a friendly signature, never a credential.
import { assertNoFalseClaims } from "./human-core.mjs";

export const DEFAULT_PREFS = Object.freeze({ language: "hu", greetingName: "Joci", signaturePhrase: "Indul a mandula!", enabled: true });
const T = {
  hu: { greet: (n, p) => `Szia ${n} — ${p}`, run: "Futás", notRunning: "az ATLASZ jelenleg nem fut", agents: "ügynökök", approvals: "jóváhagyásra vár", none: "nincs", blockers: "Blokkolók", money: "Pénz", verified: "igazolt bevétel", cost: "dokumentált költség", net: "igazolt nettó profit", safe: "Safe Mode", stop: "Vészleállítás", pipeline: "nem igazolt (nem bevétel)", queue: "sor", dead: "elakadt (DLQ)", honest: "Csak igazolt adatot mutatok; ami nincs bekötve, azt nem állítom." },
  en: { greet: (n, p) => `Hello ${n} — ${p}`, run: "Runtime", notRunning: "ATLASZ is not running", agents: "agents", approvals: "waiting for approval", none: "none", blockers: "Blockers", money: "Money", verified: "verified revenue", cost: "documented costs", net: "verified net profit", safe: "Safe Mode", stop: "Emergency stop", pipeline: "unconfirmed (not revenue)", queue: "queue", dead: "dead-lettered", honest: "I only report verified data; anything not connected is not claimed." }
};
const usd = v => "$" + Number(v ?? 0).toFixed(2);
/** status: Control Center status(); finance: ledger summary; approvals: {pending:[]} */
export function buildDailyBrief({ status, finance, approvals, prefs = {} } = {}) {
  const p = { ...DEFAULT_PREFS, ...prefs }, t = T[p.language] ?? T.en, lines = [];
  lines.push(t.greet(p.greetingName, p.signaturePhrase));
  const rt = status?.runtime;
  lines.push(rt?.reachable ? `${t.run}: ${rt.status} (v${rt.version}) — ${status.topology.actualSearch} SEARCH + ${status.topology.actualExecution} EXECUTION` : `${t.run}: ${t.notRunning}`);
  if (status?.emergency?.mode && status.emergency.mode !== "RUNNING") lines.push(`${t.stop}: ${status.emergency.mode}`);
  if (status?.safeMode?.mode === "SAFE_MODE") lines.push(`${t.safe}: ${status.safeMode.reason ?? ""}`);
  const pend = approvals?.pending ?? [];
  lines.push(`${t.approvals}: ${pend.length ? pend.length : t.none}${pend.slice(0, 3).map(r => `\n  • ${r.what}`).join("")}`);
  if (status?.queue) lines.push(`${t.queue}: ${status.queue.ready} ready / ${status.queue.done} done / ${t.dead}: ${status.queue.dead}`);
  if (finance) lines.push(`${t.money}: ${t.verified} ${usd(finance.revenue.verifiedReceivedUsd)}, ${t.cost} ${usd(finance.costs.totalUsd)}, ${t.net} ${usd(finance.profit.verifiedNetUsd)}; ${t.pipeline}: ${usd(finance.revenue.unconfirmedPipelineUsd)}`);
  const blockers = status?.blockers ?? [];
  if (blockers.length) lines.push(`${t.blockers}: ${blockers.map(b => b.code).join(", ")}`);
  lines.push(t.honest);
  const text = lines.join("\n"), check = assertNoFalseClaims(text);
  return { text, language: p.language, generatedAt: new Date().toISOString(), basis: "CURRENT_DURABLE_STATE", falseClaimCheck: check.ok };
}
/** Minimal, honest command interpreter for the Home panel (no language model attached): answers only from state, never executes risky actions. */
export function answerQuery(q = "", { status, finance, approvals } = {}) {
  const s = String(q).toLowerCase();
  if (/(approv|jóváhagy)/.test(s)) return { intent: "APPROVALS", text: (approvals?.pending ?? []).length ? approvals.pending.map(r => `• ${r.what} — ${r.risk?.level ?? "?"} risk`).join("\n") : "No approvals are waiting." };
  if (/(money|profit|revenue|pénz|bevétel|profit)/.test(s)) return { intent: "MONEY", text: finance ? `Verified revenue ${usd(finance.revenue.verifiedReceivedUsd)}; documented costs ${usd(finance.costs.totalUsd)}; verified net profit ${usd(finance.profit.verifiedNetUsd)}. Unconfirmed pipeline ${usd(finance.revenue.unconfirmedPipelineUsd)} is not revenue.` : "Ledger unavailable." };
  if (/(status|állapot|health|how are you)/.test(s)) return { intent: "STATUS", text: status?.runtime?.reachable ? `Runtime ${status.runtime.status}; ${status.topology.actualSearch}+${status.topology.actualExecution} agents; safe mode ${status.safeMode.mode}; emergency ${status.emergency.mode}.` : "The runtime is not running." };
  if (/(pause|stop|resume|emergency|leáll|szünet)/.test(s)) return { intent: "OWNER_CONTROL", text: "Pause/stop/resume need your passphrase: use the red buttons in Owner Controls. I will not do this from chat." };
  return { intent: "UNKNOWN", text: "I can answer: status, approvals, money. No language model is connected, so I do not guess." };
}
