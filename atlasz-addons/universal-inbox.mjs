// V7.3 §25 Universal Inbox: one durable inbox for email, agent messages, system alerts, approval requests, job events, payment events, connector events.
// Rules: external SENDING is disabled unless a connector has probe evidence AND the owner approved that exact send AND the kill switch allows it.
// A payment event in the inbox is an unverified CLAIM; it never counts as money (the financial ledger does).
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { isTested } from "./probe-evidence.mjs";
import { emergencyGate } from "./emergency-stop.mjs";

export const SOURCES = Object.freeze(["EMAIL", "AGENT_MESSAGE", "SYSTEM_ALERT", "APPROVAL_REQUEST", "JOB_EVENT", "PAYMENT_EVENT", "CONNECTOR_EVENT"]);
export const STATUSES = Object.freeze(["NEW", "READ", "ACTIONED", "ARCHIVED"]);
const PRIORITY_RULES = [[/(emergency|safe mode|tamper|corrupt|crash|failed)/i, "CRITICAL"], [/(approval|urgent|deadline|payment|invoice|asap|sürgős)/i, "HIGH"], [/(reply|question|quote|job)/i, "NORMAL"]];
const classify = (source, text) => (source === "APPROVAL_REQUEST" || source === "SYSTEM_ALERT" && /safe mode|tamper|emergency/i.test(text)) ? "CRITICAL" : (PRIORITY_RULES.find(([r]) => r.test(text))?.[1] ?? "LOW");

export function createUniversalInbox({ dir, ownerAuth = null, gate = emergencyGate, now = () => new Date().toISOString() } = {}) {
  const chain = createAuditChain({ filePath: dir ? path.join(dir, "inbox.jsonl") : null, now });
  const state = () => {                                                       // fold the append-only log into current item state
    chain.reload(); const items = new Map();
    for (const e of chain.entries()) {
      if (e.event === "INGEST") items.set(e.data.id, { ...e.data, status: "NEW", drafts: [], sent: [] });
      else if (e.event === "STATUS" && items.has(e.data.id)) items.get(e.data.id).status = e.data.status;
      else if (e.event === "DRAFT" && items.has(e.data.id)) items.get(e.data.id).drafts.push(e.data.draft);
      else if (e.event === "SENT" && items.has(e.data.id)) items.get(e.data.id).sent.push(e.data.evidence);
    }
    return items;
  };
  function ingest({ source, externalId, from = null, subject = "", body = "", meta = {} } = {}) {
    if (!SOURCES.includes(source)) throw new Error("UNKNOWN_SOURCE"); if (!externalId) throw new Error("EXTERNAL_ID_REQUIRED");
    const id = source + ":" + externalId;
    if (state().has(id)) return { id, duplicate: true };
    const item = { id, source, externalId, from, subject: String(subject).slice(0, 300), body: String(body).slice(0, 20000), meta, priority: classify(source, subject + " " + body), receivedAt: now() };
    if (source === "PAYMENT_EVENT") item.verification = "UNVERIFIED_CLAIM";          // never treated as received money
    chain.append("INGEST", item); return { id, duplicate: false, priority: item.priority };
  }
  function list({ source = null, status = null, minPriority = null } = {}) {
    const order = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
    return [...state().values()].filter(i => (!source || i.source === source) && (!status || i.status === status) && (!minPriority || order[i.priority] >= order[minPriority]))
      .sort((a, b) => order[b.priority] - order[a.priority] || a.receivedAt.localeCompare(b.receivedAt));
  }
  function mark(id, status) { if (!STATUSES.includes(status)) throw new Error("BAD_STATUS"); if (!state().has(id)) throw new Error("UNKNOWN_ITEM"); chain.append("STATUS", { id, status }); return { id, status }; }
  /** Drafts are text only: DRAFT != SENT. */
  function draftReply(id, text) { if (!state().has(id)) throw new Error("UNKNOWN_ITEM"); chain.append("DRAFT", { id, draft: { text: String(text).slice(0, 20000), at: now(), state: "DRAFT_NOT_SENT" } }); return { id, state: "DRAFT_NOT_SENT" }; }
  /** Real sending: connector must be probe-tested, the owner must approve THIS send, and the owner kill switch must allow external actions. */
  async function send(id, { connector = null, ownerApproval = null } = {}) {
    const it = state().get(id); if (!it) throw new Error("UNKNOWN_ITEM"); if (!it.drafts.length) throw new Error("NO_DRAFT_TO_SEND");
    if (!connector || typeof connector.send !== "function") return { sent: false, reason: "EXTERNAL_SENDING_DISABLED_NO_CONNECTOR" };
    if (!isTested(connector.tested, connector.probeEvidence)) return { sent: false, reason: "CONNECTOR_NOT_PROVEN_LIVE" };
    const g = gate({ external: true }); if (!g.allowed) return { sent: false, reason: "BLOCKED_BY_STOP:" + g.reason };
    if (!ownerAuth) return { sent: false, reason: "OWNER_AUTH_REQUIRED" };
    const draft = it.drafts[it.drafts.length - 1];
    const v = ownerAuth.verifyApproval(ownerApproval, { action: "INBOX_SEND", subject: id }); if (!v.allowed) return { sent: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason };
    const r = await connector.send({ to: it.from, subject: "Re: " + it.subject, text: draft.text });
    if (!r || !r.providerMessageId) return { sent: false, reason: "NO_PROVIDER_ACCEPTANCE_EVIDENCE" };      // QUEUED != SENT
    chain.append("SENT", { id, evidence: { providerMessageId: r.providerMessageId, at: now() } }); return { sent: true, providerMessageId: r.providerMessageId };
  }
  const counts = () => { const l = list(); return { total: l.length, new: l.filter(i => i.status === "NEW").length, critical: l.filter(i => i.priority === "CRITICAL" && i.status !== "ARCHIVED").length, bySource: Object.fromEntries(SOURCES.map(s => [s, l.filter(i => i.source === s).length])) }; };
  /** Idempotently mirror live system conditions (pending approvals, blockers, safe mode, dead letters) into the inbox. */
  function syncSystem({ approvals = [], status = null } = {}) {
    let added = 0; const add = x => { if (!ingest(x).duplicate) added++; };
    for (const r of approvals) add({ source: "APPROVAL_REQUEST", externalId: r.id, from: r.requestedBy, subject: r.what, body: r.why ?? "" });
    if (status?.safeMode?.mode === "SAFE_MODE") add({ source: "SYSTEM_ALERT", externalId: "safe-mode:" + (status.safeMode.enteredAt ?? status.safeMode.reason), subject: "Safe Mode active", body: status.safeMode.reason ?? "" });
    if (status?.queue?.dead > 0) add({ source: "SYSTEM_ALERT", externalId: "dead:" + status.queue.dead, subject: "Dead-lettered jobs: " + status.queue.dead, body: "Jobs exhausted their retries" });
    for (const b of status?.blockers ?? []) add({ source: "SYSTEM_ALERT", externalId: "blocker:" + b.code, subject: "Blocker: " + b.code, body: b.detail ?? "" });
    return { added };
  }
  return { ingest, list, mark, draftReply, send, counts, syncSystem, verify: () => { chain.reload(); return chain.verify(); } };
}
