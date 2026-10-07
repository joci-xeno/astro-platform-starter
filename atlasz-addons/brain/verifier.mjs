// Independent Verification Layer (V7.3 Brain §7): "I did it" never means "verified completed".
// The executor reports a CLAIM + EVIDENCE; this layer checks the evidence itself and returns ACCEPT / REJECT / RETRY / ESCALATE.
import fs from "node:fs";
import crypto from "node:crypto";

export const VERDICTS = Object.freeze(["ACCEPT", "REJECT", "RETRY", "ESCALATE"]);
export const EVIDENCE_STATUSES = Object.freeze(["VERIFIED", "NOT_VERIFIED", "FAILED_VERIFICATION", "EXTERNAL_VERIFICATION_REQUIRED", "UNKNOWN"]);
export const CLAIM_TYPES = Object.freeze(["INTERNAL_RECORD", "ARTIFACT", "FILE_DELIVERY", "SEND_STATE", "INVOICE", "PAYMENT", "BACKUP_INTEGRITY", "RESTORE_INTEGRITY", "RUNTIME_HEALTH", "UPDATE_SUCCESS", "JOB_COMPLETION", "AGENT_CLAIM", "MODEL_CLAIM", "EXTERNAL_ACTION"]);

export function createVerifier({ id = "VERIFIER", now = () => Date.now(), lookups = {}, healthMaxAgeMs = 120000 } = {}) {
  /** lookups (all optional, injected by the host): paymentConfirmed(ref)->{confirmed, amountUsd}, backupVerify(ref)->{ok}, restoreVerify(ref)->{ok}, updateVerify(ref)->{ok}, deliveryRecord(ref)->{delivered}
      Without a lookup the claim type cannot be verified here: the result is ESCALATE, never an automatic ACCEPT. */
  const stats = { checked: 0, accept: 0, reject: 0, retry: 0, escalate: 0, falseSuccess: 0, selfVerification: 0 };
  const out = (verdict, reason, extra = {}) => { stats.checked++; stats[verdict.toLowerCase()]++; return { verdict, reason, independent: true, verifierId: id, ...extra }; };
  const ev = e => (e && typeof e === "object" ? e : {});

  function checkArtifact(claim, e) {
    if (!claim.path) return ["REJECT", "NO_ARTIFACT_PATH"];
    let st; try { st = fs.statSync(claim.path); } catch { return ["REJECT", "ARTIFACT_MISSING"]; }
    if (!st.isFile()) return ["REJECT", "NOT_A_FILE"];
    if (st.size < (claim.minBytes ?? 1)) return ["REJECT", "ARTIFACT_TOO_SMALL"];
    if (claim.sha256 && crypto.createHash("sha256").update(fs.readFileSync(claim.path)).digest("hex") !== claim.sha256) return ["REJECT", "ARTIFACT_HASH_MISMATCH"];
    return ["ACCEPT", "ARTIFACT_PRESENT_AND_MATCHES"];
  }
  const checks = {
    ARTIFACT: (c, e) => checkArtifact(c, e),
    SEND_STATE: (c, e) => (e.providerMessageId && e.state === "ACCEPTED" ? ["ACCEPT", "PROVIDER_ACCEPTANCE_PRESENT"] : e.state === "QUEUED" ? ["RETRY", "QUEUED_IS_NOT_SENT"] : ["REJECT", "NO_PROVIDER_ACCEPTANCE_EVIDENCE"]),
    FILE_DELIVERY: (c, e) => { const a = checkArtifact(c, e); if (a[0] !== "ACCEPT") return a; if (!lookups.deliveryRecord) return ["ESCALATE", "NO_DELIVERY_LOOKUP"]; return lookups.deliveryRecord(e.deliveryRef)?.delivered === true ? ["ACCEPT", "DELIVERY_RECORDED"] : ["REJECT", "DELIVERY_NOT_RECORDED"]; },
    INVOICE: (c, e) => { if (!c.invoiceId) return ["REJECT", "NO_INVOICE_ID"]; const a = c.path ? checkArtifact(c, e) : ["ACCEPT"]; return a[0] === "ACCEPT" ? ["ACCEPT", "INVOICE_ARTIFACT_OK"] : a; },
    PAYMENT: (c, e) => { if (!lookups.paymentConfirmed) return ["ESCALATE", "NO_PAYMENT_EVIDENCE_SOURCE"]; const r = lookups.paymentConfirmed(c.ref); if (!r?.confirmed) return ["REJECT", "PAYMENT_NOT_CONFIRMED"]; if (c.amountUsd !== undefined && Number(r.amountUsd) !== Number(c.amountUsd)) return ["REJECT", "PAYMENT_AMOUNT_MISMATCH"]; return ["ACCEPT", "PAYMENT_CONFIRMED_BY_LEDGER"]; },
    BACKUP_INTEGRITY: (c) => (lookups.backupVerify ? (lookups.backupVerify(c.ref)?.ok ? ["ACCEPT", "BACKUP_VERIFIED"] : ["REJECT", "BACKUP_CORRUPT_OR_UNVERIFIED"]) : ["ESCALATE", "NO_BACKUP_VERIFIER"]),
    RESTORE_INTEGRITY: (c) => (lookups.restoreVerify ? (lookups.restoreVerify(c.ref)?.ok ? ["ACCEPT", "RESTORE_VERIFIED"] : ["REJECT", "RESTORE_NOT_VERIFIED"]) : ["ESCALATE", "NO_RESTORE_VERIFIER"]),
    UPDATE_SUCCESS: (c) => (lookups.updateVerify ? (lookups.updateVerify(c.ref)?.ok ? ["ACCEPT", "UPDATE_VERIFIED"] : ["REJECT", "UPDATE_NOT_VERIFIED"]) : ["ESCALATE", "NO_UPDATE_VERIFIER"]),
    RUNTIME_HEALTH: (c, e) => { const t = Date.parse(e.probeAt); if (!Number.isFinite(t) || now() - t > healthMaxAgeMs) return ["RETRY", "HEALTH_PROBE_STALE_OR_MISSING"]; return e.ok === true ? ["ACCEPT", "FRESH_HEALTH_PROBE_OK"] : ["REJECT", "HEALTH_PROBE_FAILED"]; },
    JOB_COMPLETION: (c, e) => {
      const crit = c.criteria ?? []; if (!crit.length) return ["REJECT", "NO_ACCEPTANCE_CRITERIA"];
      for (const k of crit) { const r = (checks[k.type] ?? (() => ["ESCALATE", "UNKNOWN_CRITERION"]))(k, ev(k.evidence)); if (r[0] !== "ACCEPT") return [r[0], "CRITERION_FAILED:" + k.type + ":" + r[1]]; }
      return ["ACCEPT", "ALL_CRITERIA_VERIFIED"];
    },
    // Internal evidence sources (job ledger, cost/profit ledgers, queue, artifacts, backup/restore/update state, health, black box, approvals) are injected by the host
    // as lookups.internalRecord(claim) -> {status: VERIFIED|NOT_VERIFIED|FAILED_VERIFICATION|EXTERNAL_VERIFICATION_REQUIRED|UNKNOWN, reason?}. Missing source => ESCALATE, never ACCEPT.
    INTERNAL_RECORD: (c) => {
      if (!lookups.internalRecord) return ["ESCALATE", "NO_INTERNAL_EVIDENCE_SOURCE"];
      let r; try { r = lookups.internalRecord(c); } catch (x) { return ["ESCALATE", "EVIDENCE_SOURCE_ERROR:" + String(x.message).slice(0, 60)]; }
      const st = EVIDENCE_STATUSES.includes(r?.status) ? r.status : "UNKNOWN", why = r?.reason ?? st;
      return st === "VERIFIED" ? ["ACCEPT", "INTERNAL_RECORD_VERIFIED:" + why] : st === "FAILED_VERIFICATION" ? ["REJECT", "INTERNAL_RECORD_FAILED:" + why] : st === "NOT_VERIFIED" ? ["RETRY", "INTERNAL_RECORD_NOT_VERIFIED:" + why] : ["ESCALATE", st + ":" + why];
    },
    EXTERNAL_ACTION: (c, e) => (e.providerRef && e.state === "ACCEPTED" ? ["ACCEPT", "PROVIDER_REF_PRESENT"] : ["REJECT", "NO_EXTERNAL_RECEIPT"]),
    AGENT_CLAIM: () => ["REJECT", "AGENT_CLAIM_NEEDS_TYPED_EVIDENCE"],
    MODEL_CLAIM: () => ["REJECT", "MODEL_CLAIM_NEEDS_TYPED_EVIDENCE"]
  };
  /** p: {claimType, claim, evidence, executorId, claimText?, highValue?, generatorFamily?, judge?} judge(claim)->{pass, family} must be a different family for highValue. */
  function verify(p = {}) {
    if (!CLAIM_TYPES.includes(p.claimType)) return out("ESCALATE", "UNKNOWN_CLAIM_TYPE");
    if (p.executorId && p.executorId === id) { stats.selfVerification++; return out("REJECT", "SELF_VERIFICATION_NOT_ALLOWED", { independent: false }); }
    const claim = ev(p.claim), evidence = ev(p.evidence);
    if (!Object.keys(claim).length && !Object.keys(evidence).length) { stats.falseSuccess++; return out("REJECT", "FALSE_SUCCESS_CLAIM_NO_EVIDENCE", { claimText: p.claimText ?? null }); }
    let [verdict, reason] = checks[p.claimType](claim, evidence);
    if (verdict === "REJECT" && /NO_|MISSING|NOT_/.test(reason)) stats.falseSuccess++;
    let judged = null;
    if (verdict === "ACCEPT" && p.highValue) {
      if (typeof p.judge !== "function") { verdict = "ESCALATE"; reason = "HIGH_VALUE_NEEDS_INDEPENDENT_JUDGE"; }
      else { judged = p.judge(claim); if (!judged || judged.family === undefined || judged.family === p.generatorFamily) { verdict = "ESCALATE"; reason = "JUDGE_NOT_INDEPENDENT_OF_GENERATOR"; } else if (judged.pass !== true) { verdict = "REJECT"; reason = "INDEPENDENT_JUDGE_REJECTED"; } }
    }
    return out(verdict, reason, { claimType: p.claimType, judged });
  }
  return { verify, stats: () => ({ ...stats }), id };
}
