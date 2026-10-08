// V7.3 §Conversation-First / Daily Brief: a deterministic startup brief built ONLY from current durable state. No invented events.
// The greeting and phrase are owner-configurable; the phrase is a friendly signature, never a credential.
import fs from "node:fs";
import path from "node:path";
import { assertNoFalseClaims } from "./human-core.mjs";

export const DEFAULT_PREFS = Object.freeze({ language: "hu", greetingName: "Joci", signaturePhrase: "Indul a mandula!", enabled: true });
const T = {
  hu: { greet: (n, p) => `Szia ${n} — ${p}`, run: "Futás", notRunning: "az ATLASZ jelenleg nem fut", agents: "ügynökök", approvals: "jóváhagyásra vár", none: "nincs", blockers: "Blokkolók", money: "Pénz", verified: "igazolt bevétel", cost: "dokumentált költség", net: "igazolt nettó profit", safe: "Safe Mode", stop: "Vészleállítás", pipeline: "nem igazolt (nem bevétel)", queue: "sor", dead: "elakadt (DLQ)", honest: "Csak igazolt adatot mutatok; ami nincs bekötve, azt nem állítom." },
  en: { greet: (n, p) => `Hello ${n} — ${p}`, run: "Runtime", notRunning: "ATLASZ is not running", agents: "agents", approvals: "waiting for approval", none: "none", blockers: "Blockers", money: "Money", verified: "verified revenue", cost: "documented costs", net: "verified net profit", safe: "Safe Mode", stop: "Emergency stop", pipeline: "unconfirmed (not revenue)", queue: "queue", dead: "dead-lettered", honest: "I only report verified data; anything not connected is not claimed." }
};
const usd = v => "$" + Number(v ?? 0).toFixed(2);
/** status: Control Center status(); finance: ledger summary; approvals: {pending:[]} */
const T2 = {
  hu: { me: "Money Engine", notConn: "nincs csatlakoztatva — számot nem állítok", sent: "elküldött megkeresés", won: "megnyert", pay: "igazolt befizetés", claimed: "nem igazolt (állítás)", unread: "olvashatatlan állapot", inbox: "Beérkezők", owner: "tulajdonosra vár", quar: "karanténban", fu: "lejárt követés", beh: "Viselkedés-figyelő", open: "nyitott", high: "magas", sbx: "SANDBOX nem számít bevételnek" },
  en: { me: "Money Engine", notConn: "not connected — no figures claimed", sent: "outreach sent", won: "won", pay: "verified payments", claimed: "claimed, unverified", unread: "unreadable state", inbox: "Inbox", owner: "need you", quar: "quarantined", fu: "overdue follow-ups", beh: "Behaviour monitor", open: "open", high: "high", sbx: "SANDBOX is never counted as revenue" }
};
const T3 = {
  hu: { today: "Ma", overdue: "Lejárt", due: "Esedékes ma", upcoming: "Közelgő határidők", rem: "Emlékeztetők", none: "nincs bejegyzett teendő", undated: "határidő nélküli feladat" },
  en: { today: "Today", overdue: "Overdue", due: "Due today", upcoming: "Upcoming deadlines", rem: "Reminders due", none: "nothing recorded", undated: "tasks without a date" }
};
/** Personal Command Center agenda -> brief lines. Only stored items are listed; an empty agenda says "nothing recorded", never "all clear". */
function agendaLines(t3, agenda) {
  if (!agenda) return [];
  const f = l => l.slice(0, 3).map(i => `\n  • ${i.title}${i.dueAt ? " (" + i.dueAt.slice(0, 16).replace("T", " ") + "Z)" : ""}`).join("") + (l.length > 3 ? `\n  … +${l.length - 3}` : "");
  const out = [];
  if (!agenda.overdue.length && !agenda.dueToday.length && !agenda.upcoming.length && !agenda.remindersDue.length && !agenda.undated) return [`${t3.today}: ${t3.none}`];
  if (agenda.overdue.length) out.push(`${t3.overdue}: ${agenda.overdue.length}${f(agenda.overdue)}`);
  if (agenda.dueToday.length) out.push(`${t3.due}: ${agenda.dueToday.length}${f(agenda.dueToday)}`);
  if (agenda.remindersDue.length) out.push(`${t3.rem}: ${agenda.remindersDue.length}${f(agenda.remindersDue)}`);
  if (agenda.upcoming.length) out.push(`${t3.upcoming}: ${agenda.upcoming.length}${f(agenda.upcoming)}`);
  if (agenda.undated) out.push(`${agenda.undated} ${t3.undated}`);
  return out;
}
/** Optional engine sections come straight from the persisted-state views (money-views / brain-views). A missing or unreadable section is reported as such, never as zero. */
function engineLines(t2, { moneyEngine, crmInbox, behavior }) {
  const out = [];
  if (moneyEngine) {
    if (moneyEngine.state === "NOT_CONNECTED") out.push(`${t2.me}: ${t2.notConn}`);
    else {
      const l = moneyEngine.live ?? {}, won = l.deals?.WON ?? 0;
      out.push(`${t2.me}: ${t2.sent} ${l.outreachSent ?? 0}, ${t2.won} ${won}, ${t2.pay} ${l.payments?.VERIFIED ?? 0} ($${Number(l.verifiedReceivedUsd ?? 0).toFixed(2)}), ${t2.claimed} $${Number(l.claimedNotVerifiedUsd ?? 0).toFixed(2)}${moneyEngine.unreadable?.length ? `; ${t2.unread}: ${moneyEngine.unreadable.join(",")}` : ""} (${t2.sbx})`);
    }
  }
  if (crmInbox) {
    const i = crmInbox.inbox, f = crmInbox.followups;
    if (i?.state === "CONNECTED") out.push(`${t2.inbox}: ${i.needsOwner} ${t2.owner}, ${i.quarantined} ${t2.quar}`);
    if (f?.state === "CONNECTED" && f.overdue) out.push(`${t2.fu}: ${f.overdue}`);
  }
  if (behavior?.state === "CONNECTED" && behavior.open) out.push(`${t2.beh}: ${behavior.open} ${t2.open}, ${behavior.high} ${t2.high}`);
  return out;
}
/** Startup brief shows on the first interaction of a local day (or when forced). The gate state is one tiny file; an unreadable file means "show it". */
export function briefDue({ file, now = new Date(), force = false } = {}) {
  const day = now.toISOString().slice(0, 10);
  let last = null; try { last = JSON.parse(fs.readFileSync(file, "utf8")).lastShownDay; } catch { /* unreadable or absent -> due */ }
  return { due: force || last !== day, day, lastShownDay: last };
}
export function markBriefShown({ file, now = new Date() } = {}) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ lastShownDay: now.toISOString().slice(0, 10), at: now.toISOString() })); }
export function buildDailyBrief({ status, finance, approvals, prefs = {}, moneyEngine, crmInbox, behavior, agenda } = {}) {
  const p = { ...DEFAULT_PREFS, ...prefs }, t = T[p.language] ?? T.en, lines = [];
  lines.push(t.greet(p.greetingName, p.signaturePhrase));
  const rt = status?.runtime;
  lines.push(rt?.reachable ? `${t.run}: ${rt.status} (v${rt.version}) — ${status.topology.actualSearch} SEARCH + ${status.topology.actualExecution} EXECUTION` : `${t.run}: ${t.notRunning}`);
  if (status?.emergency?.mode && status.emergency.mode !== "RUNNING") lines.push(`${t.stop}: ${status.emergency.mode}`);
  if (status?.safeMode?.mode === "SAFE_MODE") lines.push(`${t.safe}: ${status.safeMode.reason ?? ""}`);
  lines.push(...agendaLines(T3[p.language] ?? T3.en, agenda));
  const pend = approvals?.pending ?? [];
  lines.push(`${t.approvals}: ${pend.length ? pend.length : t.none}${pend.slice(0, 3).map(r => `\n  • ${r.what}`).join("")}`);
  if (status?.queue) lines.push(`${t.queue}: ${status.queue.ready} ready / ${status.queue.done} done / ${t.dead}: ${status.queue.dead}`);
  if (finance) lines.push(`${t.money}: ${t.verified} ${usd(finance.revenue.verifiedReceivedUsd)}, ${t.cost} ${usd(finance.costs.totalUsd)}, ${t.net} ${usd(finance.profit.verifiedNetUsd)}; ${t.pipeline}: ${usd(finance.revenue.unconfirmedPipelineUsd)}`);
  lines.push(...engineLines(T2[p.language] ?? T2.en, { moneyEngine, crmInbox, behavior }));
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
