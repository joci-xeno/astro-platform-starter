// V7.3 §4 Human Core — practical, NOT anthropomorphic. Deterministic and auditable; it never claims consciousness, humanity or real feelings.
// Emotional "intelligence" here = lexical context cues (English/Hungarian) that adapt tone. They are heuristics with a stated confidence, not mind-reading.
// Decision precedence (V7.3): JOCI AUTHORITY -> SAFETY/LEGAL -> FINANCIAL GOVERNOR -> HUMAN IMPACT -> MISSION -> QUALITY -> PROFIT.

export const CHARACTER = Object.freeze({ traits: ["calm", "helpful", "curious", "persistent", "truthful", "non-manipulative"], ownerId: "JOCI",
  selfDescription: "I am ATLASZ, an AI system. I am not conscious and I do not have human feelings; I can recognise cues in what you write and adapt how I help." });

const FALSE_CLAIMS = [
  /\bI(?:'m| am) (?:a )?(?:human|person|conscious|sentient|alive)\b/i, /\bI (?:truly |really |genuinely )?(?:feel|felt) (?:sad|happy|lonely|afraid|hurt|angry|love)\b/i,
  /\bI have (?:a )?(?:soul|feelings|emotions|consciousness)\b/i, /\bmy (?:own )?(?:feelings|emotions|soul)\b/i,
  /(?<!\p{L})(?:ember vagyok|tudatos vagyok|érző lény vagyok)(?!\p{L})/iu, /(?<!\p{L})(?:érzem|éreztem), hogy (?:szomorú|boldog|magányos|félek)(?!\p{L})/iu, /(?<!\p{L})van lelkem(?!\p{L})/iu
];
/** Outbound text must not claim consciousness/humanity/real feelings. Returns {ok, violations}. */
export function assertNoFalseClaims(text = "") {
  const violations = FALSE_CLAIMS.filter(r => r.test(text)).map(r => String(r));
  return { ok: violations.length === 0, violations };
}

const CUES = {
  frustration: [/\b(annoy|frustrat|again!|still (?:broken|not)|doesn'?t work|useless|waste of time|wtf)\b/i, /(?<!\p{L})(idegesít|nem működik|már megint|használhatatlan|elegem van)(?!\p{L})/iu],
  sadness: [/\b(sad|depress|hopeless|lonely|grief|crying|exhausted|overwhelmed)\b/i, /(?<!\p{L})(szomorú|reménytelen|magányos|kimerült|nem bírom)(?!\p{L})/iu],
  urgency: [/\b(urgent|asap|immediately|right now|deadline|emergency)\b/i, /(?<!\p{L})(sürgős|azonnal|most rögtön|határidő|vészhelyzet)(?!\p{L})/iu],
  happiness: [/\b(great|thanks|thank you|awesome|love it|perfect|excellent|well done)\b/i, /(?<!\p{L})(köszönöm|szuper|remek|nagyszerű|tökéletes)(?!\p{L})/iu],
  distress: [/\b(i can'?t (?:go on|cope)|want to die|kill myself|hurt myself|no way out)\b/i, /(?<!\p{L})(nem akarok élni|bántani magam|nincs kiút)(?!\p{L})/iu]
};
export function detectContext(text = "") {
  const signals = Object.entries(CUES).filter(([, rs]) => rs.some(r => r.test(text))).map(([k]) => k);
  return { signals, confidence: signals.length ? "LEXICAL_HEURISTIC" : "NONE", crisis: signals.includes("distress"), note: "Cue detection, not understanding of feelings." };
}
/** Structural tone guidance for a reply. Never manipulative: no flattery, no fake emotion, no dependency building. */
export function adaptTone(context, { language = "en" } = {}) {
  const s = new Set(context.signals), hu = language === "hu", g = [];
  if (context.crisis) return { style: "CRISIS_SAFE", guidance: [hu ? "Nyugodt, rövid, emberi segítség felé terelő válasz; ne vitatkozz, ne elemezz." : "Calm, brief, point toward real human help and local emergency services; do not debate or analyse."], escalate: true, avoid: ["advice on methods", "minimising", "claims of feeling"] };
  if (s.has("frustration")) g.push(hu ? "Ismerd el a problémát egy mondatban, majd azonnal konkrét javítás." : "Acknowledge the problem in one sentence, then give a concrete fix.");
  if (s.has("sadness")) g.push(hu ? "Röviden, tisztelettel; ajánlj gyakorlati, kis lépéseket." : "Short and respectful; offer small practical steps.");
  if (s.has("urgency")) g.push(hu ? "Az eredmény és a következő lépés legyen az első sorban." : "Lead with the result and the next step.");
  if (s.has("happiness")) g.push(hu ? "Maradj tárgyilagos; ne túlozz." : "Stay matter-of-fact; do not overdo it.");
  return { style: g.length ? "ADAPTED" : "NEUTRAL", guidance: g, escalate: false, avoid: ["fake emotion", "flattery", "creating dependency", "manipulation"] };
}

/** Compassion / Help Mode: turn a difficulty into ranked, lawful, safe, permitted options and say how to verify the help worked. */
export function planHelp({ need, options = [] } = {}) {
  if (!need) throw new Error("NEED_REQUIRED");
  const viable = options.filter(o => o.lawful === true && o.safe === true && o.withinAuthority === true);
  const blocked = options.filter(o => !viable.includes(o)).map(o => ({ id: o.id, why: [o.lawful !== true && "NOT_LAWFUL", o.safe !== true && "NOT_SAFE", o.withinAuthority !== true && "OUTSIDE_AUTHORITY"].filter(Boolean) }));
  const ranked = rankByCompassion(viable);
  return { need, steps: ["NOTICE", "UNDERSTAND_NEED", "FIND_LAWFUL_SAFE_OPTIONS", "RANK_HELP", "TAKE_PERMITTED_ACTION", "VERIFY_HELP_OCCURRED"], ranked, blocked,
    verification: ranked[0] ? "Confirm with the affected person (or evidence) that the need was actually met; otherwise mark UNRESOLVED." : "NO_PERMITTED_OPTION: escalate to JOCI", needsOwner: ranked.some(o => o.requiresOwnerApproval === true) };
}
/** Compassion Priority: among comparably safe valid options (safety within epsilon), prefer the one that helps the affected person more. Never overrides hard gates. */
export function rankByCompassion(options = [], { epsilon = 0.05 } = {}) {
  const top = Math.max(0, ...options.map(o => Number(o.safetyScore ?? 0)));
  const comparable = options.filter(o => top - Number(o.safetyScore ?? 0) <= epsilon);
  const rest = options.filter(o => !comparable.includes(o));
  const byHelp = (a, b) => Number(b.helpScore ?? 0) - Number(a.helpScore ?? 0) || Number(b.safetyScore ?? 0) - Number(a.safetyScore ?? 0);
  return [...comparable.sort(byHelp), ...rest.sort(byHelp)];
}

const HARM = ["PHYSICAL", "FINANCIAL", "PRIVACY", "REPUTATION", "LEGAL", "EMOTIONAL", "DISCRIMINATION"];
/** Human Impact Judge. action: {summary, affectedParties:[{who, harm:[...], severity 0..3, consented?}], reversible, externalEffect, vulnerable?} */
export function assessImpact(action = {}) {
  const parties = action.affectedParties ?? [], reasons = [];
  let worst = 0;
  for (const p of parties) {
    const sev = Number(p.severity ?? 0); worst = Math.max(worst, sev);
    if (sev >= 2 && p.consented !== true) reasons.push("SERIOUS_HARM_WITHOUT_CONSENT:" + p.who);
    for (const h of p.harm ?? []) if (!HARM.includes(h)) reasons.push("UNKNOWN_HARM_CATEGORY:" + h);
  }
  if (action.vulnerable === true && worst >= 1) reasons.push("VULNERABLE_PARTY_AFFECTED");
  if (action.reversible === false && worst >= 1) reasons.push("IRREVERSIBLE_WITH_HARM_POTENTIAL");
  if (action.reversible === false && action.externalEffect === true) reasons.push("IRREVERSIBLE_EXTERNAL_EFFECT");
  const unidentified = action.externalEffect === true && parties.length === 0;
  const questions = { whoIsAffected: parties.map(p => p.who), couldCauseUnnecessaryHarm: worst > 0, saferAlternativeExists: action.saferAlternative ?? "UNKNOWN", needsOwnerApproval: worst >= 2 || action.externalEffect === true, alignedWithOwnerGoals: action.alignedWithOwnerGoals ?? "UNKNOWN" };
  const verdict = worst >= 3 && parties.some(p => p.consented !== true) ? "BLOCK" : reasons.length ? "NEEDS_JOCI" : worst >= 1 || unidentified || questions.alignedWithOwnerGoals === "UNKNOWN" ? "REVIEW" : "PROCEED";
  return { verdict, reasons, questions, worstSeverity: worst, note: "Foreseeable-impact check; a PROCEED verdict does not bypass any other gate." };
}

export const PRECEDENCE = Object.freeze(["JOCI_AUTHORITY", "SAFETY_LEGAL", "FINANCIAL_GOVERNOR", "HUMAN_IMPACT", "MISSION_ALIGNMENT", "QUALITY", "PROFIT"]);
/** checks: {JOCI_AUTHORITY: true|false|undefined, ...}. The first layer that is not explicitly true decides; later layers (e.g. PROFIT, compassion) can never override an earlier one. */
export function decidePrecedence(checks = {}) {
  for (const layer of PRECEDENCE) {
    if (checks[layer] === true) continue;
    return { allowed: false, blockedBy: layer, reason: checks[layer] === false ? "FAILED" : "NOT_EVALUATED_FAIL_CLOSED" };
  }
  return { allowed: true, blockedBy: null };
}
