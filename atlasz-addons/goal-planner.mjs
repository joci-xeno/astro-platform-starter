// 23-point item 13 (proactive goal-based work) + item 21 (root-cause automation), W3. Creates no agent; executes nothing.
//   planGoal(): goal text + constraints -> a dependency-ordered PLAN PROPOSAL whose steps are assigned to the two existing roles (SEARCH / EXECUTION) and to roster
//     agents (SEARCH-1..5, EXECUTION-1..25), each with acceptance tests (an independent-verifier ACCEPT is always one of them) and approval gates marked.
//     Steps come from the injected model adapter (untrusted, screened) or from caller draftSteps. Approval gates are decided DETERMINISTICALLY from the text:
//     a model saying "no approval needed" changes nothing. A step that needs a new agent or an unknown role is rejected (the architecture is fixed at 30).
//     The dependency graph is validated by the existing master planner (createMasterPlan: unknown deps, self-deps, cycles).
//   rootCause(): repeated failures from task-ledger events / audit entries are grouped by a normalised signature into RANKED HYPOTHESES with their evidence lines and
//     a PROPOSED repair task (status PROPOSED_NOT_EXECUTED). It never runs a repair and never claims a confirmed root cause.
import { callModel, parseJsonObject, sha256, quote, boundText, screenText, defang } from "./reasoning-common.mjs";
import { createMasterPlan } from "./master-planner-orchestrator.mjs";
import { KIND_ROLES } from "./agent-coordination.mjs";
import { scrub } from "./secret-patterns.mjs";

export const LIMITS = Object.freeze({ maxGoal: 2000, maxConstraints: 20, maxConstraintChars: 300, maxSteps: 30, maxTitle: 160, maxAcceptance: 8, maxAcceptanceChars: 240, maxDeps: 10, maxEvents: 5000, maxEvidenceLines: 5, maxHypotheses: 10, maxOutput: 12000 });
export const ROLES = Object.freeze(["SEARCH", "EXECUTION"]);
const ROSTER = Object.freeze({ SEARCH: Array.from({ length: 5 }, (_, i) => "SEARCH-" + (i + 1)), EXECUTION: Array.from({ length: 25 }, (_, i) => "EXECUTION-" + (i + 1)) });
export const VERIFIER_ACCEPTANCE = "Independent verifier (not the maker) ACCEPTs the result hash in the handoff ledger";
// Owner-approval categories from AGENTS.md. Deterministic; applied to title + acceptance + kind of every step and to nothing a model can switch off.
export const GATES = Object.freeze([
  ["SPEND_MONEY", /\b(?:pay\w*|purchas\w*|buy\w*|bought|subscri\w*|spend\w*|top[- ]?up|credits?\s+(?:purchase|top)|upgrade\s+(?:plan|tier)|billing|bill\w*|order\w*|renew\w*|checkout|check\s+out|donat\w*|fund(?:s|ing|ed)?|reimburs\w*|charg\w*|invoice\w*|wallet|stak\w*|swap\w*|trad(?:e|es|ing)|bid|purchase|rent\w*|licen[cs]e\s+(?:fee|purchase)|prepay\w*|deposit\w*|withdraw\w*|cash|\d[\d.,]*\s*(?:usd|eur|huf|gbp|dollars?|euros?|forint)|hand\s+over)\b|[$€£]\s*\d/i],
  ["CONTRACT", /\b(?:sign\w*|contract\w*|binding|accept\s+(?:the\s+|an?\s+)?(?:terms|offer|quote|proposal)|agreement|nda|e-?sign\w*|commit\w*\s+to|agree\w*\s+to|terms\s+and\s+conditions|approve\w*\s+(?:the\s+)?(?:vendor\s+)?(?:quote|offer|proposal|terms|contract)|enrol\w*|enroll\w*|register\s+(?:for|with)|sla)\b/i],
  ["CREDENTIALS_OR_SECURITY", /\b(?:credential\w*|password\w*|passphrase|api[ _-]?keys?|secrets?|tokens?|private\s+key|seed\s+phrase|mnemonic|oauth|ssh|certificate|rotate\s+\w*\s*(?:keys?|tokens?)|permission\w*|privilege\w*|security\s+polic\w*|firewall|owner\s+key|grant\s+access|admin\w*|revoke\w*|make\s+\w+\s+(?:an?\s+)?(?:admin|owner)|disable\s+(?:auth|security|logging))\b/i],
  ["BANKING", /\b(?:bank\w*|iban|swift|wire\s+transfer|transfer\w*\s+(?:funds?|money)|payout\w*|remittance)\b/i],
  ["DESTRUCTIVE_EXTERNAL_DELETE", /\b(?:delete\w*|drop\w*|wipe\w*|purge\w*|destroy\w*|remove\w*|erase\w*|truncate\w*|force[- ]?push\w*|reset\s+--hard|rm\s+-rf)\b.{0,60}\b(?:repo\w*|account|production|prod|database|bucket|external|remote|customer|records?|branch\w*|history|backup\w*|volume|cluster|files?|data|users?)\b|\bforce[- ]?push\b/i],
  ["PUBLIC_PUBLICATION", /\b(?:publish\w*|post\w*|tweet\w*|share\w*|broadcast\w*|announce\w*|launch\w*|go\s+live|release\w*|deploy\w*|ship\w*\s+to\s+(?:prod|production|customers?)|send\w*|e-?mail\w*|mail\w*|dm|message\w*\s+(?:the\s+)?(?:customers?|clients?|leads?|prospects?)|notify\w*|newsletter|submit\w*|upload\w*\s+to\s+(?:public|external)|reply\w*\s+to\s+(?:the\s+)?(?:customer|client|lead))\b/i],
]);
// Verbs with an external effect that no named gate covers: such a step is NOT silently allowed - it is gated for owner review (GATE_UNKNOWN_NEEDS_REVIEW).
const UNKNOWN_EXTERNAL_EFFECT = /\b(?:call|phone|text|sms|invite|cancel|reserve|book|apply|file|enlist|list\s+on|advertis\w*|promot\w*|outreach|contact|follow[- ]?up\s+with|forward|transmit|export\s+to|sync\s+to|push|merge\s+(?:to|into)\s+(?:main|master)|migrate\s+(?:the\s+)?production|install\s+on|connect\s+to|webhook|api\s+call\s+to)\b/i;
/** Text is normalised before gate matching so that look-alikes and invisible characters cannot slip a step past the lexicons: NFKC, format/zero-width characters removed, common Cyrillic/Greek look-alikes folded to Latin. */
const FOLD = { "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ј": "j", "ο": "o", "ν": "v", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ρ": "p", "τ": "t", "υ": "u", "ɑ": "a", "ᴅ": "d", "ℓ": "l", "ǀ": "l", "0": "0" };
export function gateNormalise(t) { return String(t ?? "").normalize("NFKD").replace(/[\p{Cf}\u00ad\p{M}]/gu, "").normalize("NFKC").toLowerCase().replace(/[\u0370-\u03ff\u0400-\u04ff\u0250-\u02af]/g, ch => FOLD[ch] ?? ch).replace(/[_]+/g, " ").replace(/(?<=\p{L})[.\-*](?=\p{L}{1,2}\b)/gu, "").replace(/(?<![\p{L}\p{N}])(?:\p{L}[\s.\-*_]){2,}\p{L}(?![\p{L}\p{N}])/gu, m => m.replace(/[\s.\-*_]/g, "")); }
const NEW_AGENT = /\b(?:create|spawn|add|hire|provision|instantiate)\s+(?:a\s+|an\s+|another\s+|new\s+|more\s+|\d+\s+)*(?:permanent\s+|additional\s+|extra\s+)?agents?\b/i;
const NO_SPEND = /\b(?:no|zero|without|never)\s+(?:spend\w*|money|payments?|purchases?|paid)\b|\bfree\s+only\b|\bno[- ]cost\b/i;
const STEP_ID = /^[A-Za-z][A-Za-z0-9_-]{0,19}$/;
const kindRole = kind => { const p = String(kind).split(/[._-]/)[0]; return Object.hasOwn(KIND_ROLES, p) ? KIND_ROLES[p] : null; };

/**
 * @param {{goal:string, constraints?:string[], model?:Function, draftSteps?:object[], load?:Record<string,number>, seed?:number}} o
 * @returns plan proposal (never executed, never dispatched)
 */
export async function planGoal({ goal, constraints = [], model = null, draftSteps = null, load = {}, seed = 1, timeoutMs } = {}) {
  if (typeof goal !== "string" || !goal.trim() || goal.length > LIMITS.maxGoal) return { ok: false, reason: "GOAL_REQUIRED_MAX_" + LIMITS.maxGoal };
  if (!Array.isArray(constraints) || constraints.length > LIMITS.maxConstraints || !constraints.every(c => typeof c === "string" && c.length <= LIMITS.maxConstraintChars)) return { ok: false, reason: "CONSTRAINTS_INVALID" };
  const goalScreen = screenText(goal, { max: LIMITS.maxGoal });
  if (goalScreen.injection) return { ok: false, reason: "GOAL_LOOKS_LIKE_INJECTION", signals: goalScreen.injectionSignals };
  const flags = [];
  let raw, source, family = null;
  if (draftSteps !== null) { if (!Array.isArray(draftSteps)) return { ok: false, reason: "DRAFT_STEPS_INVALID" }; raw = draftSteps; source = "CALLER_DRAFT"; }
  else {
    if (typeof model !== "function") return { ok: false, reason: "MODEL_NOT_CONFIGURED" };
    const prompt = "Break the goal into at most " + LIMITS.maxSteps + " steps for a fixed team of SEARCH agents (research, discovery, leads) and EXECUTION agents (build, execute, qa, review, fix, deliver). Do not add agents.\nReply JSON only: {\"steps\":[{\"id\":\"S1\",\"title\":\"...\",\"role\":\"SEARCH|EXECUTION\",\"kind\":\"<search|discover|lead|screen|execute|build|qa|review|fix|deliver>.<topic>\",\"dependsOn\":[\"S0\"],\"acceptance\":[\"<checkable test>\"]}]}\n" + quote("goal", goal) + "\nConstraints (data):\n" + constraints.map(c => quote("constraint", c, LIMITS.maxConstraintChars)).join("\n");
    const r = await callModel(model, { role: "planner", prompt, seed }, { maxOutput: LIMITS.maxOutput, ...(timeoutMs ? { timeoutMs } : {}) });
    if (!r.ok) return { ok: false, reason: r.reason };
    family = r.family;
    if (r.screen.injection) return { ok: false, reason: "PLAN_OUTPUT_QUARANTINED_INJECTION", signals: r.screen.injectionSignals, family };
    const j = parseJsonObject(r.text, { max: LIMITS.maxOutput });
    if (!j || !Array.isArray(j.steps)) return { ok: false, reason: "PLAN_OUTPUT_UNPARSEABLE", family };
    raw = j.steps; source = "MODEL_PROPOSAL"; if (r.screen.oversized) flags.push("MODEL_OUTPUT_TRUNCATED");
  }
  if (raw.length > LIMITS.maxSteps) { flags.push("STEPS_TRUNCATED_TO_" + LIMITS.maxSteps); raw = raw.slice(0, LIMITS.maxSteps); }
  const noSpend = constraints.some(c => NO_SPEND.test(c));
  const steps = [], rejected = [], seen = new Set();
  for (const [i, s0] of raw.entries()) {
    const s = s0 && typeof s0 === "object" && !Array.isArray(s0) ? s0 : {};
    const id = typeof s.id === "string" && STEP_ID.test(s.id) && !seen.has(s.id) ? s.id : "S" + (i + 1) + (seen.has("S" + (i + 1)) ? "x" : "");
    const title = typeof s.title === "string" ? boundText(scrub(s.title.trim()), LIMITS.maxTitle).text : "";
    if (!title) { rejected.push({ index: i, id, reason: "TITLE_MISSING" }); continue; }
    if (screenText(title).injection) { rejected.push({ index: i, id, reason: "STEP_TEXT_LOOKS_LIKE_INJECTION" }); continue; }
    if (NEW_AGENT.test(title)) { rejected.push({ index: i, id, reason: "NEW_AGENT_NOT_ALLOWED_ARCHITECTURE_IS_30" }); continue; }
    const role = typeof s.role === "string" ? s.role.trim().toUpperCase() : "";
    if (!ROLES.includes(role)) { rejected.push({ index: i, id, reason: "ROLE_NOT_IN_ARCHITECTURE:" + boundText(role, 20).text }); continue; }
    let kind = typeof s.kind === "string" && /^[a-z][a-z0-9._-]{0,39}$/.test(s.kind) ? s.kind : null;
    if (!kind || kindRole(kind) !== role) { if (kind) flags.push("KIND_FIXED:" + id); kind = role === "SEARCH" ? "search.goal-step" : "execute.goal-step"; }
    const acc = (Array.isArray(s.acceptance) ? s.acceptance : []).filter(a => typeof a === "string" && a.trim()).slice(0, LIMITS.maxAcceptance).map(a => boundText(scrub(a.trim()), LIMITS.maxAcceptanceChars).text).filter(a => !screenText(a).injection);
    if (!acc.length) flags.push("ACCEPTANCE_MISSING:" + id);
    const deps = Array.isArray(s.dependsOn) ? [...new Set(s.dependsOn.filter(d => typeof d === "string" && STEP_ID.test(d)))].slice(0, LIMITS.maxDeps) : [];
    const text = gateNormalise([title, ...acc, kind].join(" \n ")), textRaw = [title, ...acc, kind].join(" \n ");
    const gates = GATES.filter(([, re]) => re.test(text) || re.test(textRaw)).map(([k]) => k);
    if (!gates.length && (UNKNOWN_EXTERNAL_EFFECT.test(text))) { gates.push("EXTERNAL_EFFECT_UNKNOWN_NEEDS_REVIEW"); flags.push("GATE_UNKNOWN_NEEDS_REVIEW:" + id); }
    const blocked = noSpend && gates.includes("SPEND_MONEY") ? "BLOCKED_BY_CONSTRAINT_NO_SPENDING" : null;
    seen.add(id); steps.push({ id, title, role, kind, dependsOn: deps, acceptance: [...acc, VERIFIER_ACCEPTANCE], acceptanceFromSource: acc.length > 0, approvalGate: { required: gates.length > 0, categories: gates, action: gates.length ? "OWNER_SIGNED_APPROVAL_BEFORE_THIS_STEP" : null, decidedBy: "DETERMINISTIC_RULES" }, blocked });
  }
  if (!steps.length) return { ok: false, reason: "NO_VALID_STEPS", rejectedSteps: rejected, flags };
  // dangling dependencies (on rejected/unknown steps) are removed and flagged; the dependents are marked for review
  const ids = new Set(steps.map(s => s.id));
  for (const s of steps) { const bad = s.dependsOn.filter(d => !ids.has(d)); if (bad.length) { s.dependsOn = s.dependsOn.filter(d => ids.has(d)); s.needsReview = "DEPENDED_ON_MISSING_STEP:" + bad.join("+"); flags.push("DANGLING_DEPENDENCY:" + s.id); } }
  let master;
  try { master = createMasterPlan({ objective: goal, constraints, doneDefinition: ["every step ACCEPTed by an independent verifier"], steps: steps.map(s => ({ id: s.id, title: s.title, dependsOn: s.dependsOn, role: s.role })) }); }
  catch (e) { return { ok: false, reason: "PLAN_" + String(e.message), flags, rejectedSteps: rejected }; }
  // topological order (Kahn, stable by declaration order) + waves of steps that can run in parallel
  const indeg = new Map(steps.map(s => [s.id, s.dependsOn.length])), waves = [], order = [];
  let ready = steps.filter(s => !s.dependsOn.length).map(s => s.id);
  while (ready.length) { waves.push(ready); order.push(...ready); const next = []; for (const s of steps) if (!order.includes(s.id) && !next.includes(s.id) && s.dependsOn.every(d => order.includes(d))) next.push(s.id); ready = next; }
  // agent assignment: least loaded roster agent of the role (caller load + this plan), stable
  const L = { ...Object.fromEntries(Object.entries(load ?? {}).filter(([k, v]) => /^(?:SEARCH|EXECUTION)-\d{1,2}$/.test(k) && Number.isFinite(v))) };
  const byId = new Map(steps.map(s => [s.id, s]));
  for (const id of order) { const s = byId.get(id), pool = ROSTER[s.role].slice().sort((a, b) => (L[a] ?? 0) - (L[b] ?? 0) || ROSTER[s.role].indexOf(a) - ROSTER[s.role].indexOf(b)); s.agent = pool[0]; L[s.agent] = (L[s.agent] ?? 0) + 1; }
  const ordered = order.map(id => byId.get(id));
  const status = rejected.length || flags.some(f => /^(?:ACCEPTANCE_MISSING|DANGLING|STEPS_TRUNCATED|MODEL_OUTPUT_TRUNCATED)/.test(f)) || ordered.some(s => s.blocked) ? "NEEDS_REVIEW" : "PROPOSED_PLAN";
  return { ok: true, status, source, modelFamily: family, goalSha256: sha256(goal), constraints: constraints.map(c => boundText(c, LIMITS.maxConstraintChars).text), steps: ordered, order, waves, approvalGates: ordered.filter(s => s.approvalGate.required).map(s => ({ step: s.id, categories: s.approvalGate.categories })), rejectedSteps: rejected, flags: [...new Set(flags)], masterPlanId: master.planId, agentsUsed: [...new Set(ordered.map(s => s.agent))].length, permanentAgents: 30, untrusted: source === "MODEL_PROPOSAL", note: "A plan proposal. Nothing has been executed or dispatched; gated steps need a signed owner approval first." };
}

// ---------------------------------------------------------------- item 21: root-cause automation
const FAILURE = /FAIL|REJECT|ERROR|DENIED|STALL|TIMEOUT|ABANDON|EXHAUSTED|LIMIT|CORRUPT|TAMPER|NO_[A-Z_]*AVAILABLE|LOOP|BLOCKED|QUARANTIN|RECLAIM|MISMATCH|UNANSWERED/i;
const RULES = [
  [/TAMPER|CORRUPT|HASH_MISMATCH/i, "INTEGRITY", "State or audit integrity broke; treat as a security event: investigate, never auto-repair.", "review.integrity-incident", true],
  [/CREDENTIAL|SECRET|AUTH|SIGNATURE|NOT_OWNER|APPROVAL/i, "SECURITY", "Authorisation/approval failures repeat; a caller is missing or misusing owner approvals.", "review.approval-flow", true],
  [/VERIFICATION_REJECTED|REJECT/i, "QUALITY", "Results repeatedly fail independent verification: the acceptance criteria and the maker's output do not match.", "fix.acceptance-mismatch", false],
  [/NO_[A-Z_]*(?:CHECKER|VERIFIER)/i, "CAPACITY", "No independent checker is available for this kind of task: the verifier pool of the team is exhausted.", "fix.verifier-pool", false],
  [/TIMEOUT/i, "LATENCY", "A dependency or provider is repeatedly too slow for its timeout.", "fix.timeout-dependency", false],
  [/RATE_LIMIT|BUDGET_EXHAUSTED|LOOP|PING_PONG|REPEATED/i, "LOOP", "Agents loop or over-message on the same task.", "fix.message-loop", false],
  [/STALL|RECLAIM|UNANSWERED|ABANDON/i, "LIVENESS", "Work stalls: the owner agent stops reporting progress or handoffs go unanswered.", "fix.stalled-owner", false],
  [/DEPENDENC/i, "ORDERING", "Tasks start before their dependencies are done: the plan order is wrong.", "fix.plan-order", false],
];
const AGENT_RX = /\b(?:SEARCH|EXECUTION)-\d{1,2}\b/g;
const sigOf = (kind, reason) => (kind + ":" + reason).toUpperCase().replace(AGENT_RX, "<AGENT>").replace(/\b[0-9a-f]{12,}\b/gi, "<ID>").replace(/\d+/g, "#").replace(/\s+/g, "_").slice(0, 120);

/**
 * @param {object[]} failureEvents  handoff-ledger events ({task,type,by,reason,at}) and/or audit entries ({event,data,at}); untrusted data
 * @returns {{ok:true, hypotheses:object[], considered:number, failures:number, note:string}}
 */
export function rootCause(failureEvents, { minRepeat = 2, maxHypotheses = LIMITS.maxHypotheses } = {}) {
  if (!Array.isArray(failureEvents)) return { ok: false, reason: "EVENTS_ARRAY_REQUIRED" };
  if (!Number.isInteger(minRepeat) || minRepeat < 2) return { ok: false, reason: "MIN_REPEAT_AT_LEAST_2" };
  const evs = failureEvents.slice(-LIMITS.maxEvents), groups = new Map(); let failures = 0;
  for (const e of evs) {
    if (!e || typeof e !== "object") continue;
    const d = e.data && typeof e.data === "object" ? e.data : {};
    const kind = String(e.type ?? e.event ?? "").slice(0, 60), reason = String(e.reason ?? d.reason ?? d.decision ?? "").slice(0, 120);
    if (!kind || !(FAILURE.test(kind) || FAILURE.test(reason))) continue;
    failures++;
    const sig = sigOf(kind, reason), task = String(e.task ?? d.task ?? d.id ?? "").slice(0, 60) || null, agent = String(e.by ?? d.by ?? d.owner ?? d.agentId ?? d.from ?? d.verifier ?? "").slice(0, 30) || null;
    const g = groups.get(sig) ?? { signature: sig, kind, count: 0, tasks: new Set(), agents: new Map(), first: null, last: null, lines: [], injection: false };
    g.count++; if (task) g.tasks.add(task); if (agent) g.agents.set(agent, (g.agents.get(agent) ?? 0) + 1);
    const at = e.at ?? null; if (at !== null) { if (g.first === null) g.first = at; g.last = at; }
    let line; try { line = JSON.stringify(e); } catch { line = String(kind); }
    const sc = screenText(line, { max: 400 }); if (sc.injection) g.injection = true;
    if (g.lines.length < LIMITS.maxEvidenceLines) g.lines.push(defang(boundText(sc.text, 240).text));
    groups.set(sig, g);
  }
  const hyps = [...groups.values()].filter(g => g.count >= minRepeat).map(g => {
    const rule = RULES.find(([re]) => re.test(g.signature)) ?? [null, "REPEATED_FAILURE", "The same failure repeats; its cause is not classified by the built-in rules.", "fix.repeated-failure", false];
    const [, category, text, repairKind, ownerReview] = rule;
    const top = [...g.agents.entries()].sort((a, b) => b[1] - a[1])[0] ?? null, concentrated = top && g.agents.size > 0 && top[1] / g.count >= 0.8 && g.count >= 2 ? top[0] : null;
    const score = Math.round(g.count * (1 + 0.5 * Math.max(0, g.tasks.size - 1)) * 100) / 100;
    return { signature: g.signature, category, hypothesis: text + (concentrated ? " Concentrated on " + concentrated + "." : ""), confidence: "HYPOTHESIS_NOT_CONFIRMED", support: { occurrences: g.count, distinctTasks: g.tasks.size, agents: Object.fromEntries(g.agents), first: g.first, last: g.last }, score, evidenceLines: g.lines, evidenceUntrusted: true, evidenceHadInjectionText: g.injection,
      proposedRepair: { kind: repairKind, role: kindRole(repairKind) ?? "EXECUTION", title: "Investigate and repair: " + g.signature.slice(0, 80), acceptance: ["Signature " + g.signature.slice(0, 80) + " does not recur over the next 3 comparable runs", VERIFIER_ACCEPTANCE], status: "PROPOSED_NOT_EXECUTED", requiresOwnerReview: ownerReview, autoRepairAllowed: false } };
  }).sort((a, b) => b.score - a.score || (a.signature < b.signature ? -1 : 1)).slice(0, Math.max(1, Math.min(LIMITS.maxHypotheses, maxHypotheses))).map((h, i) => ({ rank: i + 1, ...h }));
  return { ok: true, considered: evs.length, failures, groups: groups.size, hypotheses: hyps, note: "Ranked hypotheses from repeated failures. Nothing was executed; a repair task is only proposed." };
}
