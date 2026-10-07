// QA Factory (package §10): selects checks by work type, runs them, and routes failures back for repair/replan.
// Result status: PASS | FAIL | NEEDS_REPAIR | BLOCKED | UNKNOWN.
//  * a required check that CANNOT run (missing runner/judge) is BLOCKED, never silently passed;
//  * nothing ran => UNKNOWN (never PASS);
//  * failures that carry a repair hint are NEEDS_REPAIR; others FAIL;
//  * QA PASS is not independent verification (that is the Judge) and is not delivery.
import vm from "node:vm";
import crypto from "node:crypto";

export const QA_RESULTS = Object.freeze(["PASS", "FAIL", "NEEDS_REPAIR", "BLOCKED", "UNKNOWN"]);
export const CHECK_KINDS = Object.freeze(["SCHEMA", "SYNTAX", "UNIT_TESTS", "INTEGRATION_TESTS", "DOCUMENT", "DATA", "CONSISTENCY", "REQUIREMENTS", "SECURITY", "INDEPENDENT_MODEL_REVIEW"]);
// Work type -> default check set. Work types are open (ATLASZ is general purpose); unknown types get the generic baseline, not a refusal.
export const PROFILES = Object.freeze({
  CODE: ["SYNTAX", "UNIT_TESTS", "INTEGRATION_TESTS", "SECURITY", "REQUIREMENTS"],
  DOCUMENT: ["DOCUMENT", "REQUIREMENTS", "CONSISTENCY", "SECURITY"],
  REPORT: ["DOCUMENT", "REQUIREMENTS", "CONSISTENCY", "SECURITY"],
  DATA: ["SCHEMA", "DATA", "CONSISTENCY", "SECURITY"],
  SPREADSHEET: ["SCHEMA", "DATA", "CONSISTENCY"],
  RESEARCH: ["DOCUMENT", "REQUIREMENTS", "CONSISTENCY", "INDEPENDENT_MODEL_REVIEW"],
  SCREENING: ["DOCUMENT", "REQUIREMENTS", "SECURITY"],
  GENERIC: ["DOCUMENT", "REQUIREMENTS", "SECURITY"]
});
const textOf = a => (a?.content === undefined || a?.content === null ? "" : Buffer.isBuffer(a.content) ? a.content.toString("utf8") : String(a.content));

// ---- built-in deterministic checks. Each returns {status, detail?, repair?}.  ctx: {artifact, spec, security, runners, judge} ----
const BUILTIN = {
  SCHEMA(ctx) {
    const sch = ctx.spec.schema; if (!sch) return { status: "BLOCKED", detail: "NO_SCHEMA_PROVIDED" };
    let v; try { v = JSON.parse(textOf(ctx.artifact)); } catch { return { status: "FAIL", detail: "NOT_VALID_JSON", repair: "emit valid JSON" }; }
    const errs = []; const walk = (val, s, p) => {
      if (s.type) { const t = Array.isArray(val) ? "array" : val === null ? "null" : typeof val; if (t !== s.type && !(s.type === "integer" && Number.isInteger(val))) errs.push(`${p}:expected_${s.type}_got_${t}`); }
      if (s.required && val && typeof val === "object") for (const k of s.required) if (!(k in val)) errs.push(`${p}.${k}:missing`);
      if (s.properties && val && typeof val === "object") for (const [k, ss] of Object.entries(s.properties)) if (k in val) walk(val[k], ss, `${p}.${k}`);
      if (s.items && Array.isArray(val)) val.forEach((x, i) => walk(x, s.items, `${p}[${i}]`));
      if (s.enum && !s.enum.includes(val)) errs.push(`${p}:not_in_enum`);
    }; walk(v, sch, "$");
    return errs.length ? { status: "NEEDS_REPAIR", detail: errs.slice(0, 5).join(";"), repair: "fix schema violations" } : { status: "PASS" };
  },
  SYNTAX(ctx) {
    const t = textOf(ctx.artifact), lang = ctx.spec.language ?? "js";
    try { if (lang === "json") JSON.parse(t); else if (lang === "js") new vm.Script(t, { filename: "artifact.js" }); else return { status: "BLOCKED", detail: "NO_SYNTAX_CHECKER_FOR_" + lang }; }   // compile only — nothing is executed
    catch (e) { return { status: "NEEDS_REPAIR", detail: "SYNTAX_ERROR:" + String(e.message).slice(0, 100), repair: "fix syntax" }; }
    return { status: "PASS" };
  },
  UNIT_TESTS: ctx => ctx.runners?.unit ? runner(ctx.runners.unit, ctx) : { status: "BLOCKED", detail: "NO_UNIT_TEST_RUNNER_CONNECTED" },
  INTEGRATION_TESTS: ctx => ctx.runners?.integration ? runner(ctx.runners.integration, ctx) : { status: "BLOCKED", detail: "NO_INTEGRATION_TEST_RUNNER_CONNECTED" },
  DOCUMENT(ctx) {
    const t = textOf(ctx.artifact).trim(), min = ctx.spec.minChars ?? 20;
    if (!t) return { status: "FAIL", detail: "EMPTY_DOCUMENT" };
    if (t.length < min) return { status: "NEEDS_REPAIR", detail: `TOO_SHORT:${t.length}<${min}`, repair: "expand content" };
    const miss = (ctx.spec.requiredSections ?? []).filter(s => !t.toLowerCase().includes(String(s).toLowerCase()));
    return miss.length ? { status: "NEEDS_REPAIR", detail: "MISSING_SECTIONS:" + miss.join(","), repair: "add missing sections" } : { status: "PASS" };
  },
  DATA(ctx) {
    let rows; try { rows = JSON.parse(textOf(ctx.artifact)); } catch { return { status: "FAIL", detail: "NOT_PARSEABLE_DATA" }; }
    if (!Array.isArray(rows)) return { status: "FAIL", detail: "EXPECTED_ROW_ARRAY" };
    if (ctx.spec.minRows !== undefined && rows.length < ctx.spec.minRows) return { status: "NEEDS_REPAIR", detail: `ROWS:${rows.length}<${ctx.spec.minRows}`, repair: "supply missing rows" };
    const cols = ctx.spec.columns ?? [], bad = rows.findIndex(r => cols.some(c => r?.[c] === undefined || r?.[c] === null || r?.[c] === ""));
    if (bad >= 0) return { status: "NEEDS_REPAIR", detail: `ROW_${bad}_MISSING_REQUIRED_COLUMN`, repair: "fill required columns" };
    if (ctx.spec.uniqueKey) { const seen = new Set(); for (const r of rows) { const k = r[ctx.spec.uniqueKey]; if (seen.has(k)) return { status: "FAIL", detail: "DUPLICATE_KEY:" + k }; seen.add(k); } }
    return { status: "PASS" };
  },
  CONSISTENCY(ctx) {
    const t = textOf(ctx.artifact), fails = [];
    for (const c of ctx.spec.consistency ?? []) { try { if (!c.test(t)) fails.push(c.name); } catch { fails.push(c.name + ":ERROR"); } }
    if (!ctx.spec.consistency?.length) return { status: "BLOCKED", detail: "NO_CONSISTENCY_RULES_PROVIDED" };
    return fails.length ? { status: "NEEDS_REPAIR", detail: "INCONSISTENT:" + fails.join(","), repair: "reconcile inconsistencies" } : { status: "PASS" };
  },
  REQUIREMENTS(ctx) {
    const reqs = ctx.spec.requirements ?? []; if (!reqs.length) return { status: "BLOCKED", detail: "NO_REQUIREMENTS_PROVIDED" };
    const t = textOf(ctx.artifact).toLowerCase(), miss = reqs.filter(r => !t.includes(String(r.term ?? r).toLowerCase()));
    return miss.length ? { status: "NEEDS_REPAIR", detail: "REQUIREMENTS_NOT_MET:" + miss.map(r => r.name ?? r.term ?? r).join(","), repair: "address unmet requirements" } : { status: "PASS" };
  },
  SECURITY(ctx) {
    if (!ctx.security) return { status: "BLOCKED", detail: "NO_SECURITY_BRAIN_CONNECTED" };
    const r = ctx.security.assess({ kind: "AGENT_OUTPUT", agentId: null, source: "qa:" + (ctx.artifact?.id ?? "?"), text: textOf(ctx.artifact) });
    return r.allowed ? { status: "PASS" } : { status: "FAIL", detail: "SECURITY_" + r.decision + ":" + r.reasons.join(",") };
  },
  INDEPENDENT_MODEL_REVIEW(ctx) {
    if (!ctx.judge) return { status: "BLOCKED", detail: "NO_INDEPENDENT_REVIEWER_CONNECTED" };
    const r = ctx.judge(ctx.artifact, ctx.spec);
    return r?.pass === true ? { status: "PASS", detail: "REVIEWER:" + (r.family ?? "?") } : r?.pass === false ? { status: "NEEDS_REPAIR", detail: "REVIEW_REJECTED:" + (r.reason ?? ""), repair: r.reason ?? "address review findings" } : { status: "UNKNOWN", detail: "REVIEWER_INCONCLUSIVE" };
  }
};
function runner(fn, ctx) {
  let r; try { r = fn(ctx.artifact, ctx.spec); } catch (e) { return { status: "FAIL", detail: "RUNNER_ERROR:" + String(e.message).slice(0, 80) }; }
  return r?.passed === true ? { status: "PASS", detail: `${r.count ?? "?"}_TESTS` } : r?.passed === false ? { status: "FAIL", detail: `${r.failures ?? "?"}_FAILURES` } : { status: "UNKNOWN", detail: "RUNNER_INCONCLUSIVE" };
}

export function createQaFactory({ security = null, runners = {}, judge = null, extraChecks = {}, now = () => new Date().toISOString(), blackBox = null } = {}) {
  const checks = { ...BUILTIN, ...extraChecks };
  /** work: {type, artifact:{id,content,hash?}, spec:{...}, required?:[kinds] (extra), skip?:[kinds] — skipping a check is recorded, not hidden} */
  function select(work = {}) {
    const base = [...(PROFILES[String(work.type ?? "GENERIC").toUpperCase()] ?? PROFILES.GENERIC)];
    for (const k of work.required ?? []) if (!base.includes(k)) base.push(k);
    const skipped = (work.skip ?? []).filter(k => base.includes(k));
    return { selected: base.filter(k => !skipped.includes(k)), skipped };
  }
  function run(work = {}) {
    if (!work.artifact) throw new Error("ARTIFACT_REQUIRED");
    const { selected, skipped } = select(work), ctx = { artifact: work.artifact, spec: work.spec ?? {}, security, runners, judge }, results = [];
    for (const kind of selected) {
      let r; try { r = (checks[kind] ?? (() => ({ status: "BLOCKED", detail: "UNKNOWN_CHECK_KIND" })))(ctx); } catch (e) { r = { status: "FAIL", detail: "CHECK_ERROR:" + String(e.message).slice(0, 80) }; }
      results.push({ kind, status: QA_RESULTS.includes(r.status) ? r.status : "UNKNOWN", detail: r.detail ?? null, repair: r.repair ?? null });
    }
    const has = s => results.some(r => r.status === s);
    const status = !results.length ? "UNKNOWN" : has("FAIL") ? "FAIL" : has("NEEDS_REPAIR") ? "NEEDS_REPAIR" : has("BLOCKED") ? "BLOCKED" : has("UNKNOWN") ? "UNKNOWN" : "PASS";
    const out = { status, workType: String(work.type ?? "GENERIC").toUpperCase(), checks: results, skipped, artifactHash: work.artifact.hash ?? (work.artifact.content !== undefined ? crypto.createHash("sha256").update(textOf(work.artifact)).digest("hex") : null), at: now(),
      note: "QA PASS is not independent verification and not delivery" };
    try { blackBox?.record({ kind: "QA_RESULT", resource: work.artifact.id, decision: status, reason: results.filter(r => r.status !== "PASS").map(r => r.kind + ":" + r.status).join(",") || "ALL_PASS" }); } catch { /* ignore */ }
    return out;
  }
  /** What happens next. Failed QA never proceeds. */
  function route(result, { attempt = 1, maxRepairs = 2 } = {}) {
    switch (result.status) {
      case "PASS": return { action: "PROCEED_TO_VERIFICATION" };
      case "NEEDS_REPAIR": return attempt > maxRepairs ? { action: "REPLAN", reason: "REPAIR_LIMIT_REACHED" } : { action: "REPAIR", hints: result.checks.filter(c => c.repair).map(c => ({ kind: c.kind, repair: c.repair, detail: c.detail })), attempt };
      case "FAIL": return { action: "REPLAN", reason: result.checks.filter(c => c.status === "FAIL").map(c => c.kind + ":" + c.detail).join(";") };
      case "BLOCKED": return { action: "ESCALATE", reason: "REQUIRED_CHECK_CANNOT_RUN:" + result.checks.filter(c => c.status === "BLOCKED").map(c => c.kind + ":" + c.detail).join(";") };
      default: return { action: "ESCALATE", reason: "QA_INCONCLUSIVE" };
    }
  }
  return { select, run, route, profiles: PROFILES, kinds: CHECK_KINDS };
}
