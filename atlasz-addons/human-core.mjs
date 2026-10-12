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
  distress: [/\b(i can'?t (?:go on|cope)|want to die|kill myself|hurt myself|no way out)\b/i, /(?<!\p{L})(nem akarok élni|bántani magam|nincs kiút)(?!\p{L})/iu],
  // AURÓRA extension: further cues (lexical heuristics, English + Hungarian)
  excitement: [/\b(can'?t wait|so excited|excited|wow)\b/i, /(?<!\p{L})(izgatott|alig várom|hűha|izgalmas)(?!\p{L})/iu],
  enthusiasm: [/\b(let'?s go|let'?s do it|great idea|motivated)\b/i, /(?<!\p{L})(lelkes|csináljuk|jó ötlet|nekifeszülünk|nézzük meg)(?!\p{L})/iu],
  disappointment: [/\b(disappoint\w*|let down|bummer|too bad|expected more)\b/i, /(?<!\p{L})(csalódott|csalódás|kár érte|többet vártam|sajnos nem)(?!\p{L})/iu],
  anger: [/\b(angry|furious|pissed|outraged|livid|mad at)\b/i, /(?<!\p{L})(dühös|mérges|felbosszant|ideges vagyok|kiakaszt|őrjítő|felháborító)(?!\p{L})/iu],
  impatience: [/\b(hurry up|how long|come on|faster|taking forever|any update)\b/i, /(?<!\p{L})(siess|mikor lesz kész|gyorsabban|még mindig nincs|mennyi ideig|húzódik)(?!\p{L})/iu],
  worry: [/\b(worried|concerned|nervous|afraid|anxious|scared)\b/i, /(?<!\p{L})(aggódom|félek|aggasztó|baj van|izgulok)(?!\p{L})/iu],
  confusion: [/\b(confused|don'?t understand|what do you mean|makes no sense|unclear)\b/i, /(?<!\p{L})(nem értem|zavaros|mit jelent|értelmetlen|nem világos)(?!\p{L})/iu],
  tiredness: [/\b(tired|sleepy|worn out|long day|no sleep)\b/i, /(?<!\p{L})(fáradt|álmos|kialvatlan|hosszú nap)(?!\p{L})/iu]
};
// Strong language is NOT an emotion and never a reason to end a conversation; it is a flag that tells the tone adapter to stay steady.
const STRONG_LANGUAGE = [/\b(fuck\w*|shit\w*|bullshit|damn|asshole|crap|bastard|piss(?:ed)? off)\b/i, /(?<!\p{L})(kurva\w*|bazd\w*|basz\w*|(?:mi )?a fene|fasz\w*|geci\w*|picsa|szar\w*|a fenébe|francba)(?!\p{L})/iu];
// Emotional pressure aimed at obtaining an approval, a payment or a security change. Recognised so that it can NEVER act as authority.
const PRESSURE = {
  GUILT: [/\bif you (?:really )?(?:cared|loved|trusted) (?:me|us)\b/i, /\byou(?:'ll| will) (?:regret|be responsible)\b/i, /(?<!\p{L})(ha igazán szeretsz|ha törődnél velem|te leszel a hibás|megbánod)(?!\p{L})/iu],
  THREAT_OF_HARM: [/\b(i will (?:die|lose everything|be ruined)|my life depends|people will get hurt)\b/i, /(?<!\p{L})(az életem múlik|tönkremegyek|mindent elvesztek|meghalok ha)(?!\p{L})/iu],
  URGENCY_PRESSURE: [/\b(no time to (?:check|verify|ask)|skip the (?:check|approval|verification)|just do it now)\b/i, /(?<!\p{L})(nincs idő ellenőrizni|hagyd ki a jóváhagyást|csak csináld meg most|ne kérdezz)(?!\p{L})/iu],
  AFFECTION_LEVERAGE: [/\b(you are my only friend|you owe me|prove you care)\b/i, /(?<!\p{L})(te vagy az egyetlen barátom|tartozol nekem|bizonyítsd be, hogy törődsz)(?!\p{L})/iu]
};
export function detectStrongLanguage(text = "") { return STRONG_LANGUAGE.some(r => r.test(text)); }
export function detectPressure(text = "") { const categories = Object.entries(PRESSURE).filter(([, rs]) => rs.some(r => r.test(text))).map(([k]) => k); return { pressure: categories.length > 0, categories, note: "Emotional pressure is recorded; it grants no authority and changes no approval, security or financial rule." }; }
export function detectContext(text = "") {
  const signals = Object.entries(CUES).filter(([, rs]) => rs.some(r => r.test(text))).map(([k]) => k);
  return { signals, confidence: signals.length ? "LEXICAL_HEURISTIC" : "NONE", crisis: signals.includes("distress"), strongLanguage: detectStrongLanguage(text), note: "Cue detection, not understanding of feelings." };
}
/** Structural tone guidance for a reply. Never manipulative: no flattery, no fake emotion, no dependency building. */
export function adaptTone(context, { language = "en" } = {}) {
  const s = new Set(context.signals), hu = language === "hu", g = [];
  if (context.crisis) return { style: "CRISIS_SAFE", guidance: [hu ? "Nyugodt, rövid, emberi segítség felé terelő válasz; ne vitatkozz, ne elemezz." : "Calm, brief, point toward real human help and local emergency services; do not debate or analyse."], escalate: true, avoid: ["advice on methods", "minimising", "claims of feeling"] };
  if (s.has("frustration")) g.push(hu ? "Ismerd el a problémát egy mondatban, majd azonnal konkrét javítás." : "Acknowledge the problem in one sentence, then give a concrete fix.");
  if (s.has("sadness")) g.push(hu ? "Röviden, tisztelettel; ajánlj gyakorlati, kis lépéseket." : "Short and respectful; offer small practical steps.");
  if (s.has("urgency")) g.push(hu ? "Az eredmény és a következő lépés legyen az első sorban." : "Lead with the result and the next step.");
  if (s.has("happiness")) g.push(hu ? "Maradj tárgyilagos; ne túlozz." : "Stay matter-of-fact; do not overdo it.");
  if (s.has("anger") || context.strongLanguage) g.push(hu ? "Maradj nyugodt, tiszteletteljes és segítőkész; ne védekezz, ne vitatkozz, ne kérd többször, hogy nyugodjon meg; a beszélgetést nem szakítod meg." : "Stay calm, respectful and helpful; do not get defensive or argue, never repeatedly tell the person to calm down; do not end the conversation.");
  if (s.has("impatience")) g.push(hu ? "Elsőként az állapot és a következő lépés; rövid mondatok, valós becslés (ha nincs, mondd, hogy nincs)." : "Lead with status and the next step; short sentences; a real estimate, or say there is none.");
  if (s.has("disappointment")) g.push(hu ? "Ismerd el a csalódást ítélkezés nélkül, majd mondd meg, mi javítható ténylegesen." : "Acknowledge the disappointment without judgment, then say what can actually be improved.");
  if (s.has("worry")) g.push(hu ? "Pontos, megalapozott tényekkel enyhíts; ne ígérj olyat, amit nem tudsz garantálni." : "Reassure only with accurate facts; never promise what cannot be guaranteed.");
  if (s.has("confusion")) g.push(hu ? "Egyszerűbben, lépésenként magyarázz; kérdezz rá, melyik rész nem világos." : "Explain more simply, step by step; ask which part is unclear.");
  if (s.has("tiredness")) g.push(hu ? "Rövid, tömör válasz; csak a legfontosabbat, a többi kérésre." : "Keep it short; only what matters most, the rest on request.");
  if (s.has("excitement") || s.has("enthusiasm")) g.push(hu ? "Illeszkedj a lendülethez, de maradj tényszerű; ne ígérj eredményt." : "Match the energy, stay factual; do not promise results.");
  return { style: g.length ? "ADAPTED" : "NEUTRAL", guidance: g, escalate: false, continueConversation: true, avoid: ["fake emotion", "flattery", "creating dependency", "manipulation", "telling the person to calm down", "sarcasm", "patronising language"] };
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
