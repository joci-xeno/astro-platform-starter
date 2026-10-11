// Phase 5: the REAL local executors the 25 EXECUTION agents can be given (digital work that needs no network and no spend), each paired with an INDEPENDENT verifier recomputation.
//   executor = { id, description, run(input, ctx) -> {files:{name:Buffer|string}, meta}, recompute(input, ctx) -> same shape (used by the checker, never by the maker's code path state) }
//   * Deterministic executors (csv_to_json, extract_summary) are verified by recomputing the output from the stored input snapshot and comparing file hashes.
//   * code.module_with_tests runs the supplied test script under Node's permission model (read-only, own folder, no spawn, no network where the host supports it; fails closed when it cannot
//     restrict the child) and the checker re-runs it itself. Source comes from the OWNER/plan or, when a model is available, from the model bridge (provenance then names the model; a simulated
//     model is labelled SIMULATED). With neither, the task is BLOCKED (never invented).
//   * Inputs are DATA: size-capped, never evaluated except inside the restricted child process for the module executor.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { restrictedNodeCommand } from "./restricted-node.mjs";
import { containsSecret } from "./secret-patterns.mjs";
import { inferRequirements, assessListing } from "./global-discovery.mjs";

export const EXEC_LIMITS = Object.freeze({ maxCsvChars: 200_000, maxRows: 5000, maxCols: 60, maxTextChars: 100_000, maxSourceChars: 40_000, maxTestMs: 20_000, maxSummarySentences: 10 });
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const err = (code, detail = "") => Object.assign(new Error(code), { code, detail: String(detail).slice(0, 120) });

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF). Returns rows of strings. Rejects unterminated quotes. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false, i = 0, wasQ = false; const s = String(text).replace(/^﻿/, "");
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === "") { q = true; wasQ = true; } else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "" || wasQ) rows.push(row); row = []; wasQ = false; } else cell += c;
    if (rows.length > EXEC_LIMITS.maxRows + 1) throw err("CSV_TOO_MANY_ROWS");
  }
  if (q) throw err("CSV_UNTERMINATED_QUOTE");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const inferType = vals => { const v = vals.filter(x => x !== ""); if (!v.length) return "empty"; if (v.every(x => /^-?(0|[1-9]\d{0,14})$/.test(x))) return "integer"; if (v.every(x => /^-?(0|[1-9]\d{0,14})\.\d{1,10}$/.test(x) && Number.isFinite(Number(x)))) return "number"; if (v.every(x => /^(true|false)$/i.test(x))) return "boolean"; return "string"; };

const csvToJson = {
  id: "csv_to_json", description: "Convert owner-provided CSV text into a JSON array plus an inferred schema and statistics.",
  validate(input) {
    if (typeof input?.csv !== "string" || !input.csv.trim()) return "CSV_REQUIRED"; if (input.csv.length > EXEC_LIMITS.maxCsvChars) return "CSV_TOO_LARGE"; if (containsSecret(input.csv)) return "SECRET_IN_INPUT"; return null;
  },
  run(input) {
    const rows = parseCsv(input.csv); if (rows.length < 2) throw err("CSV_NEEDS_HEADER_AND_ROWS");
    const head = rows[0].map(h => h.trim()); if (head.length > EXEC_LIMITS.maxCols || new Set(head).size !== head.length || head.some(h => !h || ["__proto__", "constructor", "prototype"].includes(h))) throw err("CSV_HEADER_INVALID");
    const body = rows.slice(1); if (body.some(r => r.length !== head.length)) throw err("CSV_RAGGED_ROWS");
    const cols = head.map((h, j) => ({ name: h, type: inferType(body.map(r => r[j])), empty: body.filter(r => r[j] === "").length }));
    const conv = (v, t) => (v === "" ? null : t === "integer" || t === "number" ? Number(v) : t === "boolean" ? v.toLowerCase() === "true" : v);
    const out = body.map(r => Object.fromEntries(head.map((h, j) => [h, conv(r[j], cols[j].type)])));
    return { files: { "output.json": JSON.stringify(out, null, 1), "schema.json": JSON.stringify({ rows: out.length, columns: cols }, null, 1) }, meta: { rows: out.length, columns: head.length } };
  }
};
const SENT = /(?<=[.!?])\s+/;
const STOP = new Set("the a an and or of to in on for with is are was were be been it this that as at by from not but if then so we you they he she i".split(" "));
const extractSummary = {
  id: "extract_summary", description: "Deterministic extractive summary (top sentences by term frequency) with word count and top terms.",
  validate(input) { if (typeof input?.text !== "string" || input.text.trim().length < 20) return "TEXT_REQUIRED"; if (input.text.length > EXEC_LIMITS.maxTextChars) return "TEXT_TOO_LARGE"; if (containsSecret(input.text)) return "SECRET_IN_INPUT"; const n = input.sentences ?? 3; if (!Number.isInteger(n) || n < 1 || n > EXEC_LIMITS.maxSummarySentences) return "SENTENCES_OUT_OF_RANGE"; return null; },
  run(input) {
    const n = input.sentences ?? 3, sents = input.text.replace(/\s+/g, " ").trim().split(SENT).filter(x => x.length > 3);
    const words = input.text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [], freq = new Map();
    for (const w of words) if (!STOP.has(w) && w.length > 2) freq.set(w, (freq.get(w) ?? 0) + 1);
    const score = s => (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.sqrt((s.split(" ").length) || 1);
    const ranked = sents.map((s, i) => ({ s, i, sc: score(s) })).sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, n).sort((a, b) => a.i - b.i);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([term, count]) => ({ term, count }));
    return { files: { "summary.json": JSON.stringify({ sentences: ranked.map(r => r.s), sourceSentences: sents.length, wordCount: words.length, topTerms: top }, null, 1) }, meta: { sentences: ranked.length, wordCount: words.length } };
  }
};

/** Run a plain script that throws on failure, inside Node's permission model. Returns {pass, exit, signal, isolation}. Fails closed (BLOCKED) when the host cannot restrict the child. */
export function runRestrictedScript(dirPath, scriptName, { timeoutMs = EXEC_LIMITS.maxTestMs, nodeBin = process.execPath } = {}) {
  const script = path.join(dirPath, scriptName);
  const rc = restrictedNodeCommand({ nodeBin, script, readDirs: [dirPath], requireHostIsolation: true, maxLifetimeSec: Math.ceil(timeoutMs / 1000) + 5, env: { NODE_ENV: "test" } });
  if (!rc.ok) return Promise.reject(err("SANDBOX_UNAVAILABLE", rc.reason));
  // Asynchronous on purpose: a runaway script must never freeze the host process; it is killed at the deadline.
  return new Promise(resolve => {
    const child = spawn(rc.cmd, rc.args, { cwd: dirPath, env: rc.env, stdio: ["ignore", "ignore", "pipe"] }); let tail = "", done = false;
    const finish = (status, signal) => { if (done) return; done = true; clearTimeout(timer); resolve({ pass: status === 0, exit: status, signal: signal ?? null, isolation: { level: rc.level, networkBlocked: rc.networkBlocked, filesystemRestricted: rc.filesystemRestricted }, stderrTail: tail.slice(-300) }); };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } finish(null, "SIGKILL"); }, timeoutMs); timer.unref?.();
    child.stderr.on("data", d => { tail = (tail + d).slice(-2000); }); child.on("error", () => finish(null, "SPAWN_ERROR")); child.on("close", (code, sig) => finish(code, sig));
  });
}
const moduleWithTests = {
  id: "module_with_tests", description: "Run an owner/plan/model-supplied JS module and its test script in a restricted sandbox; the artifact is the source, the tests and the signed-off result.",
  validate(input) {
    for (const k of ["source", "testSource"]) { if (typeof input?.[k] !== "string" || !input[k].trim()) return k.toUpperCase() + "_REQUIRED"; if (input[k].length > EXEC_LIMITS.maxSourceChars) return k.toUpperCase() + "_TOO_LARGE"; if (containsSecret(input[k])) return "SECRET_IN_INPUT"; }
    if (!/(from\s*|import\s*\(?\s*)['"]\.\/module\.mjs['"]/.test(input.testSource)) return "TEST_MUST_IMPORT_THE_MODULE"; if (/process\s*\.\s*(exit|reallyExit|abort|kill)|process\s*\[/.test(input.testSource)) return "TEST_MAY_NOT_EXIT_THE_PROCESS";
    return null;
  },
  async run(input) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "atlasz-exec-"));
    try {
      fs.writeFileSync(path.join(d, "module.mjs"), input.source, { mode: 0o600 }); fs.writeFileSync(path.join(d, "module.test.mjs"), input.testSource, { mode: 0o600 });
      const res = await runRestrictedScript(d, "module.test.mjs");
      if (!res.pass) throw err("TESTS_FAILED", "exit " + res.exit + " " + res.stderrTail.replace(/\s+/g, " ").slice(0, 80));
      return { files: { "module.mjs": input.source, "module.test.mjs": input.testSource, "result.json": JSON.stringify({ testScriptExitedZero: true, note: "The test script imported the module and exited 0 inside the restricted sandbox; this is not a coverage claim.", exit: 0, isolation: res.isolation, sourceSha256: sha(input.source), testSha256: sha(input.testSource) }, null, 1) }, meta: { testScriptExitedZero: true, isolation: res.isolation.level } };
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  },
  // The checker does not trust result.json: it re-runs the tests itself on the files it finds in the artifact.
  async verifyFiles(files) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "atlasz-chk-"));
    try { fs.writeFileSync(path.join(d, "module.mjs"), files["module.mjs"], { mode: 0o600 }); fs.writeFileSync(path.join(d, "module.test.mjs"), files["module.test.mjs"], { mode: 0o600 }); const r = await runRestrictedScript(d, "module.test.mjs"); return { ok: r.pass, evidence: { exit: r.exit, isolation: r.isolation.level } }; }
    catch (e) { return { ok: false, evidence: { error: e.code ?? String(e.message).slice(0, 60) }, blocked: e.code === "SANDBOX_UNAVAILABLE" }; }
    finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
};

// ---- Opportunity deliverables (deterministic, recomputed by the checker). Both are DRAFTS prepared from the recorded source text only: no invented credentials, prices, references or dates.
const OPP_KEYS = ["title", "sourceRef", "description", "jurisdiction", "currency", "valueAmount", "valueKind", "deadline", "publishedAt", "buyer", "language", "kindHint", "tags", "assessedAt", "retrieval", "sourceId"];
const oppValidate = input => {
  const o = input?.opportunity; if (!o || typeof o !== "object") return "OPPORTUNITY_REQUIRED"; if (typeof o.title !== "string" || !o.title.trim()) return "TITLE_REQUIRED"; if (typeof o.description !== "string" || o.description.trim().length < 10) return "DESCRIPTION_REQUIRED";
  if (o.description.length > EXEC_LIMITS.maxTextChars) return "DESCRIPTION_TOO_LARGE"; if (containsSecret(JSON.stringify(o))) return "SECRET_IN_INPUT"; if (!Number.isFinite(Date.parse(o.assessedAt))) return "ASSESSED_AT_REQUIRED";
  if (Object.keys(o).some(k => !OPP_KEYS.includes(k))) return "UNKNOWN_FIELD"; return null;
};
const sentencesOf = t => String(t).replace(/\s+/g, " ").trim().split(/(?<=[.!?;])\s+/).filter(x => x.length > 12);
const MODAL = /\b(shall|must|should|require[sd]?|provide|deliver|develop|implement|support|ensure|produce|prepare|evaluate|analy[sz]e|design|build|integrate|test|report)\b/i;
function analyse(o) {
  const text = o.title + " . " + o.description, req = inferRequirements(text), a = assessListing({ title: o.title, description: o.description, tags: o.tags, deadline: o.deadline, kindHint: o.kindHint }, o.assessedAt);
  const sents = sentencesOf(o.description), reqs = (sents.filter(x => MODAL.test(x)).length ? sents.filter(x => MODAL.test(x)) : sents).slice(0, 12);
  const days = o.deadline ? Math.floor((Date.parse(o.deadline) - Date.parse(o.assessedAt)) / 86400000) : null;
  return { req, a, reqs, days };
}
const implementationPlan = {
  id: "implementation_plan", description: "Draft technical implementation plan derived only from the recorded opportunity text (requirements quoted, phases, risks, open questions). A plan is not a commitment.",
  validate: oppValidate,
  run(input) {
    const o = input.opportunity, { req, a, reqs, days } = analyse(o);
    const phases = [
      { phase: "1 Clarify scope", activities: ["Confirm the requirements below with the buyer through the owner (no contact is made by ATLASZ)", "Resolve every open question"], produces: ["confirmed requirement list"] },
      { phase: "2 Design", activities: ["Choose the approach for the requirements ATLASZ can cover", "Write acceptance criteria per requirement"], produces: ["design note", "acceptance criteria"] },
      { phase: "3 Build", activities: req.skills.length ? req.skills.map(k => "Use ATLASZ capability " + k) : ["No ATLASZ executor matched the text: the owner must decide whether to proceed"], produces: ["deliverable artifacts with hashes"] },
      { phase: "4 Independent quality check", activities: ["A different agent recomputes or re-runs every deliverable", "Record accept/reject with evidence"], produces: ["maker-checker record"] },
      { phase: "5 Delivery", activities: ["Owner reviews and delivers; ATLASZ does not send anything outside"], produces: ["delivery record (owner-supplied evidence)"] }];
    const risks = [...(a.fraud.level !== "NONE" ? ["Scam indicators: " + a.fraud.indicators.join(", ")] : []), ...(a.geoRestrictions.length ? ["Geographic or registration restrictions found in the text: " + a.geoRestrictions.join(" | ")] : ["Geographic eligibility is UNKNOWN: it is not assumed"]), ...req.unsupported.map(u => "Outside ATLASZ capability: " + u), ...(days !== null && days < 7 ? ["Deadline in " + days + " day(s) at assessment time"] : []), ...(req.skills.length === 0 ? ["No capability match on the source text"] : []), "Capability coverage beyond the matched skills is UNASSESSED"];
    const openQuestions = ["Is the owner eligible to bid (jurisdiction, registration, insurance)?", "What price and timeline will the owner commit to?", ...(o.deadline ? [] : ["What is the submission deadline?"]), "Which parts of the requirement are in scope?", ...(o.currency ? ["Payment currency is " + o.currency + "; how will payment be received and verified?"] : ["Payment currency and method are not stated"])];
    const doc = { status: "DRAFT_NOT_A_COMMITMENT", source: { ref: o.sourceRef, buyer: o.buyer ?? null, publishedAt: o.publishedAt ?? null, deadline: o.deadline ?? null, language: o.language ?? null, retrieval: o.retrieval ?? null }, requirementsQuotedFromSource: reqs, matchedCapabilities: req.skills, unsupported: req.unsupported, phases, risks, openQuestions, estimates: { hours: null, cost: null, margin: null, note: "NOT ESTIMATED: there is no evidence-based basis in the source text." }, basis: req.basis };
    const md = ["# Implementation plan (DRAFT - not a commitment)", "", "Source: " + o.sourceRef, "Title: " + o.title, "", "## Requirements quoted from the source", ...reqs.map(x => "- " + x), "", "## Matched ATLASZ capabilities", ...(req.skills.length ? req.skills.map(x => "- " + x) : ["- none"]), "", "## Phases", ...phases.flatMap(p => ["### " + p.phase, ...p.activities.map(x => "- " + x), "Produces: " + p.produces.join(", "), ""]), "## Risks", ...risks.map(x => "- " + x), "", "## Open questions for the owner", ...openQuestions.map(x => "- " + x), "", "Estimates: NOT ESTIMATED (no basis)."].join("\n");
    return { files: { "implementation_plan.json": JSON.stringify(doc, null, 1), "implementation_plan.md": md }, meta: { requirements: reqs.length, matched: req.skills.length, risks: risks.length } };
  }
};
const proposalDraft = {
  id: "proposal_draft", description: "Owner-reviewable proposal DRAFT. Never sent by ATLASZ; every credential, price and date is a placeholder for the owner to supply.",
  validate: oppValidate,
  run(input) {
    const o = input.opportunity, { req, a, reqs } = analyse(o);
    const md = ["# PROPOSAL DRAFT - NOT SENT - requires the owner's review and approval", "", "> ATLASZ prepared this from the published notice only. Nothing here has been sent to anyone. Placeholders in [brackets] must be completed by the owner.", "", "## Reference", "- Notice: " + o.title, "- Source: " + o.sourceRef, ...(o.buyer ? ["- Buyer: " + o.buyer] : []), ...(o.deadline ? ["- Published deadline: " + o.deadline] : ["- Deadline: [OWNER TO CONFIRM]"]), "",
      "## Our understanding of the requirement (quoted from the notice)", ...reqs.map(x => "> " + x), "", "## Proposed approach", ...(req.skills.length ? req.skills.map(x => "- Deliver the part covered by capability " + x + " with an independent quality check") : ["- [OWNER TO DECIDE: no ATLASZ capability matched the notice text]"]), "",
      "## Deliverables", "- [OWNER TO CONFIRM against the confirmed scope]", "", "## Timeline", "- [OWNER TO SET]", "", "## Price", "- [OWNER TO SET]" + (o.valueAmount != null ? " (buyer-published figure: " + o.valueAmount + " " + (o.currency ?? "?") + ", " + (o.valueKind ?? "unspecified kind") + "; this is not a quote and not our income)" : ""), "",
      "## Qualifications and references", "- [OWNER TO PROVIDE: legal entity, registrations, insurance, references. ATLASZ does not invent credentials, clients or a portfolio.]", "", "## Eligibility and compliance checklist for the owner", ...(a.geoRestrictions.length ? a.geoRestrictions.map(x => "- Check: " + x) : ["- Geographic eligibility not stated: verify before bidding"]), "- Supplier registration or account requirements of the portal: verify", ...(a.fraud.level !== "NONE" ? ["- SCAM INDICATORS PRESENT: " + a.fraud.indicators.join(", ") + " - do not proceed without verification"] : []), "", "## Assumptions and exclusions", "- Only the requirements quoted above are assumed; everything else is out of scope until confirmed."].join("\n");
    return { files: { "proposal_draft.md": md, "proposal_draft.json": JSON.stringify({ status: "DRAFT_NOT_SENT", sourceRef: o.sourceRef, placeholders: (md.match(/\[OWNER[^\]]*\]/g) ?? []).length, sentToAnyone: false }, null, 1) }, meta: { draft: true, sent: false } };
  }
};
export const BUILTIN_EXECUTORS = Object.freeze({ csv_to_json: csvToJson, extract_summary: extractSummary, module_with_tests: moduleWithTests, implementation_plan: implementationPlan, proposal_draft: proposalDraft });
export const executorSkill = id => ({ csv_to_json: "data.csv_to_json", extract_summary: "doc.extract_summary", module_with_tests: "code.module_with_tests", implementation_plan: "plan.implementation_plan", proposal_draft: "doc.proposal_draft" })[id] ?? null;
