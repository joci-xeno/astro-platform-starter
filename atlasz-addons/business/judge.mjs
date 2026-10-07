// Independent Judge abstraction (package §11). Extends Independent Verification with pluggable judge kinds:
//   SAME_PROVIDER_MODEL | DIFFERENT_PROVIDER_MODEL | DETERMINISTIC | EXTERNAL_AUTHORITATIVE | HUMAN_OWNER
// Independence rules: the executor is never its own judge; a model judge must be a different model instance than the generator;
// high-value work needs a DIFFERENT PROVIDER (or deterministic / external / human) judge. No eligible judge => NOT_INDEPENDENTLY_VERIFIED.
// An unavailable judge is reported as unavailable — nothing is assumed to exist.
export const JUDGE_KINDS = Object.freeze(["SAME_PROVIDER_MODEL", "DIFFERENT_PROVIDER_MODEL", "DETERMINISTIC", "EXTERNAL_AUTHORITATIVE", "HUMAN_OWNER"]);
export const JUDGE_STATUSES = Object.freeze(["INDEPENDENTLY_VERIFIED", "NOT_INDEPENDENTLY_VERIFIED", "REJECTED", "ESCALATE"]);
const STRONG = new Set(["DETERMINISTIC", "EXTERNAL_AUTHORITATIVE", "HUMAN_OWNER", "DIFFERENT_PROVIDER_MODEL"]);

export function createJudgePanel({ blackBox = null, now = () => new Date().toISOString() } = {}) {
  const judges = new Map();
  /** j: {id, kind, family?(provider), modelId?, available?:()=>bool, judge:(work)=>{pass, reason?, evidence?}} — judge() is supplied by the host adapter. */
  function register(j = {}) {
    if (!j.id || !JUDGE_KINDS.includes(j.kind) || typeof j.judge !== "function") throw new Error("JUDGE_ID_KIND_FN_REQUIRED");
    if (["SAME_PROVIDER_MODEL", "DIFFERENT_PROVIDER_MODEL"].includes(j.kind) && (!j.family || !j.modelId)) throw new Error("MODEL_JUDGE_NEEDS_FAMILY_AND_MODEL_ID");
    judges.set(j.id, { ...j }); return { registered: j.id };
  }
  const unregister = id => judges.delete(id);
  function eligible(work) {
    const out = [], why = [];
    for (const j of judges.values()) {
      if (j.id === work.executorId) { why.push({ id: j.id, reason: "JUDGE_IS_EXECUTOR" }); continue; }
      if (j.available && !j.available()) { why.push({ id: j.id, reason: "JUDGE_UNAVAILABLE" }); continue; }
      if (["SAME_PROVIDER_MODEL", "DIFFERENT_PROVIDER_MODEL"].includes(j.kind)) {
        if (j.modelId && j.modelId === work.generatorModelId) { why.push({ id: j.id, reason: "SAME_MODEL_AS_GENERATOR" }); continue; }
        if (j.kind === "DIFFERENT_PROVIDER_MODEL" && j.family === work.generatorFamily) { why.push({ id: j.id, reason: "CLAIMS_DIFFERENT_PROVIDER_BUT_SAME_FAMILY" }); continue; }
      }
      if (work.highValue && !STRONG.has(j.kind)) { why.push({ id: j.id, reason: "HIGH_VALUE_NEEDS_STRONGER_JUDGE" }); continue; }
      if (work.requireKinds && !work.requireKinds.includes(j.kind)) { why.push({ id: j.id, reason: "KIND_NOT_ALLOWED" }); continue; }
      out.push(j);
    }
    return { eligible: out, rejected: why };
  }
  /** work: {id, executorId, generatorModelId?, generatorFamily?, highValue?, requireKinds?, claim, artifact?} */
  function judge(work = {}) {
    if (!work.id || !work.executorId) throw new Error("WORK_ID_AND_EXECUTOR_REQUIRED");
    const { eligible: el, rejected } = eligible(work), order = [...el].sort((a, b) => JUDGE_KINDS.indexOf(b.kind) - JUDGE_KINDS.indexOf(a.kind));
    const log = (decision, extra) => { try { blackBox?.record({ kind: "JUDGE_DECISION", resource: work.id, agentId: work.executorId, decision, ...extra }); } catch { /* ignore */ } };
    if (!order.length) { log("NOT_INDEPENDENTLY_VERIFIED", { reason: "NO_ELIGIBLE_INDEPENDENT_JUDGE" }); return { status: "NOT_INDEPENDENTLY_VERIFIED", independent: false, reason: "NO_ELIGIBLE_INDEPENDENT_JUDGE", rejected, at: now() }; }
    const j = order[0]; let r; try { r = j.judge(work); } catch (e) { log("ESCALATE", { reason: "JUDGE_ERROR" }); return { status: "ESCALATE", independent: false, judgeId: j.id, reason: "JUDGE_ERROR:" + String(e.message).slice(0, 80), rejected, at: now() }; }
    if (r?.pass === true) { log("INDEPENDENTLY_VERIFIED", { reason: j.kind }); return { status: "INDEPENDENTLY_VERIFIED", independent: true, judgeId: j.id, judgeKind: j.kind, evidence: r.evidence ?? null, reason: r.reason ?? "PASS", at: now() }; }
    if (r?.pass === false) { log("REJECTED", { reason: r.reason ?? "FAIL" }); return { status: "REJECTED", independent: true, judgeId: j.id, judgeKind: j.kind, reason: r.reason ?? "FAIL", at: now() }; }
    log("ESCALATE", { reason: "JUDGE_INCONCLUSIVE" }); return { status: "ESCALATE", independent: false, judgeId: j.id, reason: "JUDGE_INCONCLUSIVE", at: now() };
  }
  /** Shape accepted by the existing verifier's `judge(claim)` parameter ({pass, family}). */
  const asVerifierJudge = work => claim => { const r = judge({ ...work, claim }); return { pass: r.status === "INDEPENDENTLY_VERIFIED", family: judges.get(r.judgeId)?.family ?? r.judgeKind ?? undefined }; };
  /** Converts a judge result into the verification object jobs/artifacts expect. NOT_INDEPENDENTLY_VERIFIED never yields independent:true. */
  const toVerification = r => ({ verdict: r.status === "INDEPENDENTLY_VERIFIED" ? "ACCEPT" : r.status === "REJECTED" ? "REJECT" : "ESCALATE", independent: r.independent === true, verifierId: r.judgeId ?? null, reason: r.reason });
  return { register, unregister, judge, eligible, asVerifierJudge, toVerification, list: () => [...judges.values()].map(j => ({ id: j.id, kind: j.kind, family: j.family ?? null })) };
}
