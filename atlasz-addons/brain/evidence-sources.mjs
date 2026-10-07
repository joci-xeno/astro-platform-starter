// ATLASZ internal evidence sources for Independent Verification (V7.3 §8 / package §1).
// Each reader is an INJECTED read-only view onto a durable internal store. verify(claim) returns
//   { status: VERIFIED | NOT_VERIFIED | FAILED_VERIFICATION | EXTERNAL_VERIFICATION_REQUIRED | UNKNOWN, reason, source, scope, evidence }
// Rules (honesty):
//  * a reader that is not connected => UNKNOWN (never VERIFIED, never "assumed fine");
//  * claims about the outside world (money received, message delivered, customer acceptance) can only be VERIFIED by an authoritative
//    EXTERNAL adapter; without one they are EXTERNAL_VERIFICATION_REQUIRED, whatever the internal records say;
//  * the claimant's own value is never evidence — only what the store itself reports;
//  * a reader that throws yields UNKNOWN:EVIDENCE_SOURCE_ERROR (fail closed).
import crypto from "node:crypto";
import { EVIDENCE_STATUSES } from "./verifier.mjs";

export const EVIDENCE_SOURCES = Object.freeze(["JOB", "COST_LEDGER", "REVENUE_LEDGER", "PROFIT_LEDGER", "QUEUE", "ARTIFACT", "BACKUP", "RESTORE", "UPDATE", "HEALTH", "BLACK_BOX", "APPROVAL", "EXTERNAL"]);
const R = (status, reason, source, scope = "INTERNAL_RECORD", evidence = null) => ({ status, reason, source, scope, evidence });
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");

export function createEvidenceSources({ readers = {}, external = {} } = {}) {
  const connected = () => Object.fromEntries(EVIDENCE_SOURCES.map(s => [s, s === "EXTERNAL" ? Object.keys(external).length ? "PARTIAL:" + Object.keys(external).sort().join(",") : "NOT_CONNECTED" : readers[s] ? "CONNECTED" : "NOT_CONNECTED"]));

  const handlers = {
    JOB(c, rd) {
      const j = rd.get(c.jobId); if (!j) return R("FAILED_VERIFICATION", "JOB_RECORD_NOT_FOUND", "JOB");
      const want = c.expectState ?? "DONE";
      if (j.state !== want) return R(["QUEUED", "PLANNED", "ASSIGNED", "EXECUTING", "VERIFYING", "RETRY_WAIT", "HALTED"].includes(j.state) ? "NOT_VERIFIED" : "FAILED_VERIFICATION", "JOB_STATE_" + j.state + "_NOT_" + want, "JOB", "INTERNAL_RECORD", { state: j.state });
      if (want === "DONE" && !(j.verification?.verdict === "ACCEPT" && j.verification?.independent === true)) return R("NOT_VERIFIED", "JOB_DONE_WITHOUT_INDEPENDENT_VERIFICATION", "JOB");
      return R("VERIFIED", "JOB_RECORD_CONSISTENT", "JOB", "INTERNAL_RECORD", { state: j.state, attempts: j.attempts ?? null });
    },
    COST_LEDGER(c, rd) {
      if (rd.verify && rd.verify().ok === false) return R("FAILED_VERIFICATION", "LEDGER_CHAIN_BROKEN", "COST_LEDGER");
      const row = rd.entries().find(r => r.type === "COST" && (c.seq != null ? r.seq === c.seq : r.jobId === c.jobId && Number(r.amountUsd) === Number(c.amountUsd)));
      if (!row) return R("FAILED_VERIFICATION", "COST_ENTRY_NOT_IN_LEDGER", "COST_LEDGER");
      if (c.amountUsd != null && Number(row.amountUsd) !== Number(c.amountUsd)) return R("FAILED_VERIFICATION", "COST_AMOUNT_MISMATCH", "COST_LEDGER", "INTERNAL_RECORD", { recorded: row.amountUsd });
      if (Number(row.amountUsd) > 0 && !row.evidence) return R("NOT_VERIFIED", "COST_WITHOUT_EVIDENCE", "COST_LEDGER");
      return R("VERIFIED", "COST_ENTRY_RECORDED_WITH_EVIDENCE", "COST_LEDGER", "INTERNAL_RECORD", { seq: row.seq, amountUsd: row.amountUsd });
    },
    REVENUE_LEDGER(c, rd) {
      if (rd.verify && rd.verify().ok === false) return R("FAILED_VERIFICATION", "LEDGER_CHAIN_BROKEN", "REVENUE_LEDGER");
      const rows = rd.entries().filter(r => r.type === "REVENUE" && r.jobId === c.jobId && (!c.stage || r.stage === c.stage));
      if (!rows.length) return R(c.stage === "PAID" ? "NOT_VERIFIED" : "FAILED_VERIFICATION", "NO_MATCHING_REVENUE_ENTRY", "REVENUE_LEDGER");
      const r = rows[rows.length - 1];
      if (c.amountUsd != null && Number(r.amountUsd) !== Number(c.amountUsd)) return R("FAILED_VERIFICATION", "REVENUE_AMOUNT_MISMATCH", "REVENUE_LEDGER");
      // A PAID entry is only trusted for the record; whether the money truly arrived is the payment authority's call.
      if (r.stage === "PAID") return R(r.confirmedReceived === true && r.evidence ? "VERIFIED" : "NOT_VERIFIED", r.confirmedReceived === true && r.evidence ? "PAID_RECORD_WITH_EXTERNAL_EVIDENCE_REFERENCE" : "PAID_WITHOUT_CONFIRMATION", "REVENUE_LEDGER", "INTERNAL_RECORD", { stage: r.stage, evidenceSource: r.evidence?.source ?? null });
      return R("VERIFIED", "PIPELINE_STAGE_RECORDED_NOT_REVENUE", "REVENUE_LEDGER", "INTERNAL_RECORD", { stage: r.stage, countsAsRevenue: false });
    },
    PROFIT_LEDGER(c, rd) {
      const s = rd.summary({ entity: c.entity }); if (s.chain?.ok === false) return R("FAILED_VERIFICATION", "LEDGER_CHAIN_BROKEN", "PROFIT_LEDGER");
      const j = s.profit.byJob[c.jobId]; if (!j) return R("FAILED_VERIFICATION", "NO_RECORDS_FOR_JOB", "PROFIT_LEDGER");
      if (c.verifiedNetProfitUsd != null && Math.abs(j.verifiedNetProfitUsd - Number(c.verifiedNetProfitUsd)) > 1e-9) return R("FAILED_VERIFICATION", "PROFIT_CLAIM_DOES_NOT_MATCH_LEDGER", "PROFIT_LEDGER", "INTERNAL_RECORD", { recomputed: j.verifiedNetProfitUsd });
      return R("VERIFIED", "PROFIT_RECOMPUTED_FROM_LEDGER", "PROFIT_LEDGER", "INTERNAL_RECORD", { verifiedNetProfitUsd: j.verifiedNetProfitUsd, basis: s.profit.basis });
    },
    QUEUE(c, rd) {
      const it = rd.get(c.itemId); if (!it) return R("FAILED_VERIFICATION", "QUEUE_ITEM_NOT_FOUND", "QUEUE");
      return it.state === (c.expectState ?? "DONE") ? R("VERIFIED", "QUEUE_STATE_MATCHES", "QUEUE", "INTERNAL_RECORD", { state: it.state }) : R(["READY", "LEASED"].includes(it.state) ? "NOT_VERIFIED" : "FAILED_VERIFICATION", "QUEUE_STATE_" + it.state, "QUEUE");
    },
    ARTIFACT(c, rd) {
      const a = rd.get(c.artifactId); if (!a) return R("FAILED_VERIFICATION", "ARTIFACT_NOT_FOUND", "ARTIFACT");
      const h = a.content != null ? sha(a.content) : a.hash ?? null;
      if (!h) return R("UNKNOWN", "ARTIFACT_HAS_NO_CONTENT_OR_HASH", "ARTIFACT");
      if (c.hash && c.hash !== h) return R("FAILED_VERIFICATION", "ARTIFACT_HASH_MISMATCH", "ARTIFACT");
      return R("VERIFIED", "ARTIFACT_EXISTS_AND_HASH_MATCHES", "ARTIFACT", "INTERNAL_RECORD", { hash: h, delivered: false });   // existence != delivery
    },
    BACKUP(c, rd) {
      const rdn = rd.readiness(), cat = rdn.categories.find(x => x.category === c.category);
      if (!cat) return R("FAILED_VERIFICATION", "UNKNOWN_CATEGORY", "BACKUP");
      if (cat.backup === "NOT_CONFIGURED") return R("UNKNOWN", "BACKUP_SOURCE_NOT_CONFIGURED", "BACKUP");
      if (!cat.latestPoint) return R("NOT_VERIFIED", "NO_RESTORE_POINT_CREATED", "BACKUP");
      return cat.backup === "VERIFIED" ? R("VERIFIED", "BACKUP_INTEGRITY_AND_DRILL_VERIFIED", "BACKUP", "INTERNAL_RECORD", { point: cat.latestPoint }) : ["FAILED", "UNRESTORABLE", "NO_BACKUP"].includes(cat.backup) ? R("FAILED_VERIFICATION", "BACKUP_" + cat.backup, "BACKUP") : R("NOT_VERIFIED", "BACKUP_EXISTS_BUT_NOT_YET_VERIFIED", "BACKUP");   // EXISTS != RESTORABLE
    },
    RESTORE(c, rd) {
      const rdn = rd.readiness();
      if (c.require === "LKG") return rdn.lkg ? R("VERIFIED", "VERIFIED_LKG_AVAILABLE", "RESTORE", "INTERNAL_RECORD", rdn.lkg) : R("NOT_VERIFIED", "NO_VERIFIED_LKG", "RESTORE");
      return rdn.restoreReadiness === "READY" ? R("VERIFIED", "RESTORE_READY", "RESTORE") : rdn.restoreReadiness === "NOT_READY" ? R("FAILED_VERIFICATION", "RESTORE_NOT_READY", "RESTORE") : R(rdn.restoreReadiness === "NOT_CONFIGURED" ? "UNKNOWN" : "NOT_VERIFIED", "RESTORE_" + rdn.restoreReadiness, "RESTORE");
    },
    UPDATE(c, rd) {
      const u = rd.get(c.updateId); if (!u) return R("FAILED_VERIFICATION", "UPDATE_NOT_FOUND", "UPDATE");
      if (c.expectState === "ROLLED_BACK") return u.state === "ROLLED_BACK" && u.rollback?.verified ? R("VERIFIED", "ROLLBACK_VERIFIED", "UPDATE") : R(u.state === "ROLLED_BACK" ? "NOT_VERIFIED" : "FAILED_VERIFICATION", "ROLLBACK_NOT_VERIFIED", "UPDATE");
      if (u.state !== "INSTALLED") return R(["FAILED", "BLOCKED", "ROLLED_BACK"].includes(u.state) ? "FAILED_VERIFICATION" : "NOT_VERIFIED", "UPDATE_STATE_" + u.state, "UPDATE");
      return u.tests?.passed !== false && u.evidenceCount > 0 ? R("VERIFIED", "UPDATE_INSTALLED_WITH_EVIDENCE", "UPDATE", "INTERNAL_RECORD", { evidenceCount: u.evidenceCount }) : R("NOT_VERIFIED", "UPDATE_INSTALLED_WITHOUT_EVIDENCE", "UPDATE");
    },
    HEALTH(c, rd) {
      const h = rd.probe(c.component); if (!h) return R("UNKNOWN", "NO_PROBE_FOR_COMPONENT", "HEALTH");
      return h.state === "HEALTHY" ? R("VERIFIED", "PROBE_HEALTHY", "HEALTH", "INTERNAL_RECORD", { detail: h.detail ?? null }) : ["BLOCKED", "FAILED", "DOWN", "DEGRADED"].includes(h.state) ? R("FAILED_VERIFICATION", "PROBE_" + h.state, "HEALTH") : R("UNKNOWN", "PROBE_" + h.state, "HEALTH");
    },
    BLACK_BOX(c, rd) {
      const v = rd.verify(); if (v.ok === false) return R("FAILED_VERIFICATION", "BLACK_BOX_CHAIN_BROKEN", "BLACK_BOX");
      const ev = rd.query(c.where ?? {}); const n = c.minEvents ?? 1;
      return ev.length >= n ? R("VERIFIED", "BLACK_BOX_EVENTS_PRESENT_CHAIN_INTACT", "BLACK_BOX", "INTERNAL_RECORD", { events: ev.length }) : R("NOT_VERIFIED", "BLACK_BOX_EVENTS_MISSING", "BLACK_BOX");
    },
    APPROVAL(c, rd) {
      const o = rd.outcome(c.requestId);
      if (o.status === "UNKNOWN") return R("FAILED_VERIFICATION", "APPROVAL_REQUEST_NOT_FOUND", "APPROVAL");
      if (o.status === "APPROVED") return R("VERIFIED", "OWNER_APPROVAL_RECORDED", "APPROVAL", "INTERNAL_RECORD", { signed: !!o.approval });
      return o.status === "PENDING" ? R("NOT_VERIFIED", "APPROVAL_PENDING", "APPROVAL") : R("FAILED_VERIFICATION", "APPROVAL_" + o.status, "APPROVAL");
    }
  };
  // Claims about the world outside ATLASZ. Without an authoritative adapter they can never be verified from internal records.
  const EXTERNAL_KINDS = Object.freeze(["PAYMENT_RECEIVED", "MESSAGE_SENT", "DELIVERY_RECEIVED", "CUSTOMER_ACCEPTED", "CONTRACT_SIGNED"]);

  function verify(claim = {}) {
    const src = String(claim.source ?? "").toUpperCase();
    if (src === "EXTERNAL" || EXTERNAL_KINDS.includes(String(claim.external ?? ""))) {
      const kind = String(claim.external ?? claim.kind ?? "");
      const adapter = external[kind];
      if (!adapter) return R("EXTERNAL_VERIFICATION_REQUIRED", "NO_AUTHORITATIVE_EXTERNAL_SOURCE_FOR_" + (kind || "CLAIM"), "EXTERNAL", "EXTERNAL");
      try { const r = adapter(claim); return R(EVIDENCE_STATUSES.includes(r?.status) ? r.status : "UNKNOWN", r?.reason ?? "EXTERNAL_ADAPTER", "EXTERNAL", "EXTERNAL", r?.evidence ?? null); } catch (e) { return R("UNKNOWN", "EVIDENCE_SOURCE_ERROR:" + String(e.message).slice(0, 80), "EXTERNAL", "EXTERNAL"); }
    }
    if (!handlers[src]) return R("UNKNOWN", "UNSUPPORTED_EVIDENCE_SOURCE:" + (src || "NONE"), src || "NONE");
    const rd = readers[src]; if (!rd) return R("UNKNOWN", "SOURCE_NOT_CONNECTED:" + src, src);
    try { return handlers[src](claim, rd); } catch (e) { const m = String(e.message); return /TAMPER|CHAIN_BROKEN|HASH_MISMATCH/.test(m) ? R("FAILED_VERIFICATION", "EVIDENCE_STORE_INTEGRITY_FAILURE:" + m.slice(0, 80), src) : R("UNKNOWN", "EVIDENCE_SOURCE_ERROR:" + m.slice(0, 80), src); }
  }
  return { verify, connected, sources: EVIDENCE_SOURCES };
}
