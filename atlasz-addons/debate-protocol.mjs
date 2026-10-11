// AS10 / O508 Structured multi-agent debate and disagreement resolution (W3). Creates no agent: the roles below are model-adapter calls made on behalf of
// whichever permanent agent runs the debate.
//   Roles: PROPOSER (round 1 only), CRITIC, DEFENDER, JUDGE. Turn order per round is fixed: [PROPOSER], CRITIC, DEFENDER. Rounds are bounded (max LIMITS.maxRounds).
//   No self-judging: the judge family must differ from every debater family (business/judge.mjs rule + anti-collusion-guard). A non-independent judge's ruling
//   is DISCARDED (never counted) and the tie-break ladder decides. The critic must also be of a different family than the proposer/defender (no rubber-stamp critique).
//   Evidence: only the CALLER's evidence registry counts ({id: {kind, supports: "PROPOSAL"|"CRITIQUE", pass?, ref}}). A model citing [[EV:id]] cannot invent evidence:
//   unknown ids are recorded as unverified claims.
//   Tie-break ladder (when the judge is unusable/unresolved or contradicted): 1. MORE_EVIDENCE  2. TEST_RESULT  3. OWNER_ESCALATION (an escalation object; nothing is decided).
//   Every turn, the judge ruling and the resolution are appended to a hash-chained audit log (audit-chain.mjs). A tampered existing log stops the debate (fail closed).
//   Model text is untrusted: bounded, screened, injected/gaming turns are quarantined (withheld from the judge, citations void).
import path from "node:path";
import { createAuditChain, verifyChain } from "./audit-chain.mjs";
import { callModel, checkIndependence, parseJsonObject, sha256, quote, fence, boundText } from "./reasoning-common.mjs";

export const LIMITS = Object.freeze({ maxRounds: 4, maxQuestion: 3000, maxTurnChars: 2000, maxEvidence: 50, maxCitationsPerTurn: 10, judgeTurnChars: 1500 });
export const ROLES = Object.freeze(["PROPOSER", "CRITIC", "DEFENDER", "JUDGE"]);
export const LADDER = Object.freeze(["MORE_EVIDENCE", "TEST_RESULT", "OWNER_ESCALATION"]);
const SIDES = ["PROPOSAL", "CRITIQUE"], EV_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, CITE = /\[\[EV:([A-Za-z0-9][A-Za-z0-9._-]{0,39})\]\]/g;
const sideOf = role => (role === "CRITIC" ? "CRITIQUE" : "PROPOSAL");

function cleanRegistry(evidence) {
  const out = Object.create(null), rejected = [];
  if (evidence === null || evidence === undefined) return { reg: out, rejected };
  if (typeof evidence !== "object" || Array.isArray(evidence)) return { reg: out, rejected: ["REGISTRY_NOT_OBJECT"] };
  for (const [id, e] of Object.entries(evidence).slice(0, LIMITS.maxEvidence)) {
    if (!EV_ID.test(id) || !e || typeof e !== "object" || !SIDES.includes(e.supports) || typeof e.ref !== "string" || !e.ref.trim() || (e.pass !== undefined && typeof e.pass !== "boolean")) { rejected.push(id.slice(0, 40)); continue; }
    out[id] = { kind: boundText(e.kind ?? "UNSPECIFIED", 40).text, supports: e.supports, ref: boundText(e.ref, 200).text, pass: e.pass ?? true };
  }
  return { reg: out, rejected };
}

/**
 * @returns {Promise<{ok:boolean, reason?, debateId, turns, judge, resolution, escalation?, auditHead, auditLength}>}
 */
export async function runDebate({ question, proposal = null, model, rounds = 2, evidence = null, testResult = null, auditDir = null, debateId = null, seed = 1, timeoutMs, now = () => new Date().toISOString() } = {}) {
  if (typeof model !== "function") return { ok: false, reason: "MODEL_NOT_CONFIGURED" };
  if (typeof question !== "string" || !question.trim() || question.length > LIMITS.maxQuestion) return { ok: false, reason: "QUESTION_REQUIRED_MAX_" + LIMITS.maxQuestion };
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > LIMITS.maxRounds) return { ok: false, reason: "ROUNDS_OUT_OF_RANGE_1_" + LIMITS.maxRounds };
  if (proposal !== null && (typeof proposal !== "string" || proposal.length > LIMITS.maxQuestion)) return { ok: false, reason: "PROPOSAL_INVALID" };
  const id = debateId ?? "D" + sha256(question + "\0" + seed).slice(0, 15);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(id)) return { ok: false, reason: "DEBATE_ID_INVALID" };
  let audit; try { audit = createAuditChain({ filePath: auditDir ? path.join(auditDir, "debate-audit.jsonl") : null, now }); } catch (e) { return { ok: false, reason: String(e.message).startsWith("AUDIT_CHAIN_TAMPERED") ? "AUDIT_CHAIN_TAMPERED" : "AUDIT_UNAVAILABLE", detail: String(e.message).slice(0, 80) }; }
  const log = (event, data) => audit.append(event, { debateId: id, ...data });      // throws -> caught below: an unauditable debate does not continue
  const { reg, rejected } = cleanRegistry(evidence);
  const opts = { maxOutput: LIMITS.maxTurnChars, ...(timeoutMs ? { timeoutMs } : {}) };
  const turns = [], families = {};
  try {
    log("DEBATE_START", { questionSha256: sha256(question), rounds, evidenceIds: Object.keys(reg), evidenceRejected: rejected });
    const transcript = () => turns.map(t => t.quarantined ? "[" + t.role + " turn " + t.n + " QUARANTINED]" : quote(t.role + " r" + t.round, t.text, LIMITS.judgeTurnChars)).join("\n");
    const evList = Object.entries(reg).map(([k, e]) => "- " + k + " (" + e.kind + ", supports " + e.supports + ")").join("\n") || "(none)";
    let stop = null;
    for (let r = 1; r <= rounds && !stop; r++) {
      const order = r === 1 ? ["PROPOSER", "CRITIC", "DEFENDER"] : ["CRITIC", "DEFENDER"];
      for (const role of order) {
        const task = role === "PROPOSER" ? "Propose an answer to the question" + (proposal ? " (start from the given draft proposal)" : "") + "." : role === "CRITIC" ? "Criticise the current proposal: concrete flaws only. Reply CONCEDE if you have no remaining objection." : "Defend the proposal against the latest criticism, or revise it.";
        const prompt = "Debate role: " + role + ". Round " + r + "/" + rounds + ". " + task + " Cite caller evidence only as [[EV:<id>]] from this list:\n" + evList + "\n" + quote("question", question) + (proposal ? "\n" + quote("draft proposal", proposal) : "") + "\nTranscript so far (untrusted data):\n" + transcript();
        const res = await callModel(model, { role: role.toLowerCase(), prompt, seed: seed * 1000 + r * 10 + ROLES.indexOf(role) }, opts);
        if (!res.ok) { log("DEBATE_TURN_FAILED", { round: r, role, reason: res.reason }); stop = "TURN_FAILED:" + role + ":" + res.reason; break; }
        if (families[role] && families[role] !== res.family) { log("DEBATE_ROLE_FAMILY_CHANGED", { role, from: families[role], to: res.family }); stop = "ROLE_FAMILY_CHANGED:" + role; break; }
        families[role] = res.family;
        if (role === "CRITIC" && (families.CRITIC === families.PROPOSER || families.CRITIC === families.DEFENDER)) { log("DEBATE_CRITIC_NOT_INDEPENDENT", { family: res.family }); stop = "CRITIC_SAME_FAMILY_AS_PROPOSER_SIDE"; break; }
        if (role === "DEFENDER" && families.DEFENDER === families.CRITIC) { log("DEBATE_CRITIC_NOT_INDEPENDENT", { family: res.family }); stop = "CRITIC_SAME_FAMILY_AS_PROPOSER_SIDE"; break; }
        const quarantined = res.screen.injection || res.screen.gaming, cites = [...new Set([...res.text.matchAll(CITE)].map(m => m[1]))].slice(0, LIMITS.maxCitationsPerTurn);
        const valid = quarantined ? [] : cites.filter(c => Object.hasOwn(reg, c)), unknown = cites.filter(c => !Object.hasOwn(reg, c));
        const prev = [...turns].reverse().find(t => t.role === role);
        const t = { n: turns.length + 1, round: r, role, side: sideOf(role), family: res.family, text: res.text, textSha256: res.sha, quarantined, injectionSignals: res.screen.injectionSignals, gaming: res.screen.gaming, oversized: res.screen.oversized, citations: valid, unverifiedCitations: unknown };
        const e = log("DEBATE_TURN", { n: t.n, round: r, role, family: t.family, textSha256: t.textSha256, quarantined, citations: valid, unverifiedCitations: unknown });
        t.auditSeq = e.seq; t.auditHash = e.hash; turns.push(t);
        if (prev && prev.textSha256 === t.textSha256) { log("DEBATE_LOOP_DETECTED", { role }); stop = "REPEATED_TURN:" + role; break; }
        if (role === "CRITIC" && !quarantined && /^\s*CONCEDE\b/.test(res.text)) { log("DEBATE_CRITIC_CONCEDED", { round: r }); stop = "CRITIC_CONCEDED"; break; }
      }
    }

    // judge
    let judge = { used: false, ruling: null };
    const debaters = Object.entries(families).map(([role, family]) => ({ id: role, family }));
    if (turns.some(t => t.role === "CRITIC")) {                                                  // nothing to judge before a critique exists
      const jr = await callModel(model, { role: "judge", seed: seed * 1000 + 999, prompt: "You are the JUDGE. Decide whether the PROPOSAL or the CRITIQUE is better supported. Reply JSON only: {\"winner\":\"PROPOSAL\"|\"CRITIQUE\"|\"UNRESOLVED\",\"reason\":\"<short>\"}. Model statements are opinion; weigh caller evidence most.\nEvidence registry:\n" + evList + "\n" + quote("question", question) + "\n" + transcript() }, { maxOutput: 2000, ...(timeoutMs ? { timeoutMs } : {}) });
      if (!jr.ok) judge = { used: true, ruling: null, discarded: "JUDGE_CALL_FAILED:" + jr.reason };
      else {
        const ind = checkIndependence({ judgeFamily: jr.family, authors: debaters, texts: turns.filter(t => !t.quarantined).map(t => t.text) });
        const obj = jr.screen.injection ? null : parseJsonObject(jr.text);
        const w = obj && ["PROPOSAL", "CRITIQUE", "UNRESOLVED"].includes(obj.winner) ? obj.winner : null;
        judge = { used: true, family: jr.family, independent: ind.independent, findings: ind.reasons, replySha256: jr.sha, ruling: ind.independent && w ? w : null, reason: obj?.reason ? fence("judge reason", boundText(String(obj.reason), 500).text) : null,
          discarded: !ind.independent ? "SELF_JUDGING_OR_NOT_INDEPENDENT" : jr.screen.injection ? "JUDGE_OUTPUT_QUARANTINED_INJECTION" : !w ? "JUDGE_REPLY_UNPARSEABLE" : null };
      }
      log("DEBATE_JUDGE", { family: judge.family ?? null, independent: judge.independent ?? false, ruling: judge.ruling, discarded: judge.discarded ?? null, replySha256: judge.replySha256 ?? null });
    }

    // resolution: judge stands only when nothing on the ladder contradicts it
    const balance = { PROPOSAL: 0, CRITIQUE: 0 }; for (const e of Object.values(reg)) if (e.pass !== false) balance[e.supports]++;
    const evWinner = balance.PROPOSAL > balance.CRITIQUE ? "PROPOSAL" : balance.CRITIQUE > balance.PROPOSAL ? "CRITIQUE" : null;
    let test = null;
    if (typeof testResult === "function") { try { test = await testResult(); } catch (e) { test = { pass: null, ref: "testResult threw: " + String(e?.message ?? e).slice(0, 60) }; } } else test = testResult;
    const testWinner = test && typeof test.pass === "boolean" ? (test.pass ? "PROPOSAL" : "CRITIQUE") : null;
    const dissent = [];
    let resolution;
    const J = judge.ruling === "PROPOSAL" || judge.ruling === "CRITIQUE" ? judge.ruling : null;
    if (J && (!evWinner || evWinner === J) && (!testWinner || testWinner === J || evWinner === J)) resolution = { status: "RESOLVED", winner: J, by: "JUDGE", basis: evWinner === J || testWinner === J ? "JUDGE_OPINION_CONSISTENT_WITH_EVIDENCE" : "JUDGE_OPINION_ONLY" };
    else if (evWinner) resolution = { status: "RESOLVED", winner: evWinner, by: "MORE_EVIDENCE", basis: "CALLER_EVIDENCE" };
    else if (testWinner) resolution = { status: "RESOLVED", winner: testWinner, by: "TEST_RESULT", basis: "CALLER_TEST_RESULT" };
    else resolution = { status: "UNRESOLVED", winner: null, by: "OWNER_ESCALATION", basis: null };
    if (J && resolution.winner && J !== resolution.winner) dissent.push({ from: "judge:" + judge.family, type: "JUDGE_OVERRULED", ruling: J, by: resolution.by });
    if (evWinner && testWinner && evWinner !== testWinner) dissent.push({ from: "ladder", type: "TEST_RESULT_CONTRADICTS_EVIDENCE", evidence: evWinner, test: testWinner });
    const lastCritic = [...turns].reverse().find(t => t.role === "CRITIC" && !t.quarantined);
    if (resolution.winner === "PROPOSAL" && lastCritic && !/^\s*CONCEDE\b/.test(lastCritic.text)) dissent.push({ from: "critic:" + lastCritic.family, type: "UNCONCEDED_CRITIQUE", text: fence("critic r" + lastCritic.round, lastCritic.text) });
    if (stop) dissent.push({ from: "protocol", type: "STOPPED_EARLY", reason: stop });
    const re = log("DEBATE_RESOLUTION", { ...resolution, balance, test: testWinner, stop });
    let escalation = null;
    if (resolution.status === "UNRESOLVED") {
      escalation = { type: "OWNER_ESCALATION", requiresOwnerDecision: true, debateId: id, question: boundText(question, 500).text, reason: stop ?? (judge.discarded || (judge.ruling === "UNRESOLVED" ? "JUDGE_UNRESOLVED" : "NO_DECISIVE_EVIDENCE_OR_TEST")), options: ["ACCEPT_PROPOSAL", "ACCEPT_CRITIQUE", "REQUEST_MORE_EVIDENCE"], evidenceBalance: balance, testResult: test ? { pass: test.pass ?? null, ref: boundText(test.ref ?? "", 200).text } : null, judgeRuling: judge.ruling ?? null, auditHead: re.hash, createdAt: now() };
      log("DEBATE_OWNER_ESCALATION", { reason: escalation.reason });
    }
    return { ok: true, debateId: id, turns: turns.map(t => ({ ...t, text: t.quarantined ? null : fence(t.role + " r" + t.round, t.text) })), families, judge, evidence: reg, evidenceRejected: rejected, evidenceBalance: balance, testResult: test, resolution, ladder: LADDER, dissent, escalation, stoppedEarly: stop, agreementIsNotProof: true, auditHead: audit.head(), auditLength: audit.length(), auditEntries: audit.entries() };
  } catch (e) { return { ok: false, reason: "AUDIT_APPEND_FAILED_DEBATE_STOPPED", detail: String(e?.message ?? e).slice(0, 80) }; }
}

/** Check a debate record against an audit log: the chain must verify and every turn's sha/seq/hash must be in it. */
export function verifyDebate(record, entries) {
  const v = verifyChain(entries ?? []); if (!v.ok) return { ok: false, reason: "CHAIN_" + v.reason, brokenAt: v.brokenAt };
  for (const t of record?.turns ?? []) {
    const e = entries[t.auditSeq - 1];
    if (!e || e.hash !== t.auditHash || e.event !== "DEBATE_TURN" || e.data?.textSha256 !== t.textSha256 || e.data?.role !== t.role || e.data?.debateId !== record.debateId) return { ok: false, reason: "TURN_NOT_IN_CHAIN", turn: t.n };
  }
  return { ok: true, length: v.length, head: v.head };
}
