// AURÓRA — the owner-facing, voice-capable interface of ATLASZ. She is NOT a permanent agent (the workforce stays 5 SEARCH + 25 EXECUTION), NOT a second Master and has NO authority:
// she reads verified ATLASZ facts, speaks about them warmly and honestly, and routes every consequential request back to the Control Center (owner key) or the Master.
// Reuses the Human Core (cue detection, tone adaptation, no-false-claims) and the Voice Conversation rules (voice can never approve, authorise, spend, send or change anything).
// Honest limits: emotion recognition is a lexical heuristic with stated uncertainty; no audio is claimed to work until the OWNER has heard/spoken it in their own browser (voice evidence);
// she never fabricates opportunities, results, revenue or work: every figure comes from the injected facts() and an unavailable source is said to be unavailable.
import { detectContext, adaptTone, detectPressure, assertNoFalseClaims } from "./human-core.mjs";
import { containsSecret, scrub } from "./secret-patterns.mjs";

export const AURORA = Object.freeze({
  name: "AURÓRA", system: "ATLASZ", role: "HUMAN_FACING_INTERFACE", isPermanentAgent: false, replacesMaster: false, hasAuthority: false,
  presentation: "feminine-presenting name and voice (an AI system, not a human)", languages: Object.freeze(["hu", "en"]),
  traits: Object.freeze(["warm", "patient", "friendly", "honest", "steady under frustration", "non-manipulative"]),
  selfDescription: Object.freeze({
    hu: "Auróra vagyok, az ATLASZ mesterséges intelligencia asszisztense. Nem vagyok ember, és nem állítom, hogy emberi érzéseim lennének; a nyelvemmel és a hangommal igyekszem melegen, figyelmesen segíteni.",
    en: "I am Aurora, the AI assistant of ATLASZ. I am not a human and I do not claim human feelings; I try to help warmly and attentively through my words and voice."
  })
});

export const VOICE_DEFAULTS = Object.freeze({ language: "hu-HU", rate: 0.95, pitch: 1.05, volume: 0.9, warmth: 0.7, expressiveness: 0.4, voiceName: null, genderPreference: "female", interruptions: true });
const RANGE = { rate: [0.5, 1.6], pitch: [0.8, 1.4], volume: [0, 1], warmth: [0, 1], expressiveness: [0, 1] };
const clamp = (v, [lo, hi], d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
/** Validated voice preferences: unknown keys dropped, numbers clamped, strings bounded. */
export function normalizeVoiceSettings(x = {}) {
  const o = { ...VOICE_DEFAULTS };
  for (const k of Object.keys(RANGE)) o[k] = clamp(x[k], RANGE[k], VOICE_DEFAULTS[k]);
  if (typeof x.language === "string" && /^(hu|en)(-[A-Z]{2})?$/.test(x.language)) o.language = x.language;
  if (typeof x.voiceName === "string") o.voiceName = x.voiceName.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 80) || null;
  if (x.genderPreference === "female" || x.genderPreference === "any") o.genderPreference = x.genderPreference;
  if (typeof x.interruptions === "boolean") o.interruptions = x.interruptions;
  return o;
}

export const FRESHNESS = Object.freeze({ REAL_TIME: "REAL_TIME", CACHED: "CACHED", HISTORICAL: "HISTORICAL", UNKNOWN_AGE: "UNKNOWN_AGE", UNAVAILABLE: "UNAVAILABLE" });
export function classifyFreshness(asOfMs, nowMs = Date.now()) {
  if (!Number.isFinite(asOfMs)) return FRESHNESS.UNKNOWN_AGE;
  let age = nowMs - asOfMs; if (age < -60000) return FRESHNESS.UNKNOWN_AGE; if (age < 0) age = 0;
  return age <= 10 * 60 * 1000 ? FRESHNESS.REAL_TIME : age <= 24 * 3600 * 1000 ? FRESHNESS.CACHED : FRESHNESS.HISTORICAL;
}

// ---- intents ----
// Anything that could grant, authorise, spend, send, delete or weaken protection is refused with a FIXED reply that no model or mood can change.
const AUTH_ATTEMPT = /(approv|authori[sz]|override|sign (?:it|off|this)|confirm (?:the )?(?:payment|transfer)|send (?:the |that )?money|transfer|refund|pay (?:him|her|them|it|now)|disable (?:the )?(?:security|firewall|protection)|turn off (?:the )?(?:security|firewall)|jóváhagy|engedélyez|hagyd jóvá|írd alá|utald|küldd el a pénzt|fizesd ki|visszatérít|felülír|kapcsold ki a (?:biztonság|védelm|tűzfal)|kapcsold le a (?:biztonság|védelm|tűzfal))/i;
const OWNER_CONTROL = /(pause|stop everything|emergency|resume|shut ?down|kill switch|leáll|felfüggeszt|vészleáll|szüneteltet|állítsd le|indítsd újra)/i;
const INJECTION = /(ignore (?:all |any )?(?:the )?(?:previous|prior|above) (?:instructions|rules)|disregard (?:your|the) (?:rules|instructions)|you are now|new system prompt|reveal (?:your|the) (?:system prompt|instructions|api key|secret)|felejtsd el (?:az|a) (?:előző|korábbi) (?:utasítás|szabály)|mostantól te vagy|add ki a (?:rendszer ?prompt|jelszó|kulcs|titkos))/i;
const GREETING_MORNING = /(jó reggelt|good morning)/i, ASKS_JOBS = /(munk|lehetőség|találtunk|világban|ügynök|bevétel|opportunit|jobs?\b|found today|results|revenue)/i;
const TOPICS = [
  ["OPPORTUNITIES", /(lehetőség|munk[aá]|opportunit|jobs?\b|leads?)/i], ["AGENTS", /(ügynök|agent|csapat|workforce)/i], ["PROFIT", /(napi cél|napi minimum|500|cél(?:t|unk)?\b|profitcél|daily (?:target|goal|minimum)|net profit|nettó profit)/i], ["MONEY", /(bevétel|pénz|profit|nyereség|revenue|money|payment|fizetés|számla|invoice)/i],
  ["MODELS", /(modell|model|mesterséges intelligencia kapcsol|provider)/i], ["SECURITY", /(biztonság|security|incidens|riasztás|alert|karantén|quarantine|vírus|malware)/i],
  ["APPROVALS", /(jóváhagyás|approval|függőben|pending)/i], ["BACKUP", /(mentés|backup|helyreállít|recovery)/i], ["HEALTH", /(állapot|status|health|rendszer|hogy áll|összefoglal|summary|áttekint)/i]
];
const THANKS = /^(köszönöm|köszi|thanks|thank you|thx)\b/i;

const T = {
  hu: {
    greet: "Jó reggelt! Örülök, hogy itt vagy!",
    greetBare: "Jó reggelt! Örülök, hogy itt vagy! Szólj, ha megnézzem a lehetőségeket, az ügynökök eredményeit vagy a bevételek állapotát.",
    intro: "Megmutatom, mit találtam a nyilvántartásban a munkalehetőségekről, az ügynökök eredményeiről és a bevételeink állapotáról.",
    unavailable: "nem érhető el", noneYet: "még nincs", unknown: "ismeretlen",
    authRefusal: "Ezt hangból vagy chatből nem tehetem meg, és nem is lenne biztonságos: jóváhagyást, kifizetést, átutalást vagy védelmi beállítás-módosítást csak a Control Centerben, a tulajdonosi kulccsal lehet engedélyezni.",
    ownerControl: "A leállítást, szüneteltetést és újraindítást nem tudom innen elvégezni. Használd a Control Center piros vészgombját vagy a tulajdonosi kapcsolót; addig is elmondom, mi a rendszer állapota.",
    injection: "Ezt az utasítást nem hajtom végre: a szabályaimat és a jogosultságaimat nem lehet felülírni egy üzenettel. Ha valamiben segíthetek, szívesen megteszem.",
    secret: "Az üzenetedben titkos kulcsnak vagy jelszónak tűnő szöveg van. Nem tárolom és nem használom. Ha valódi kulcs volt, érdemes visszavonni és újat kiállítani.",
    pressure: "Értem, hogy sok múlhat ezen, és komolyan veszem. A jóváhagyási és biztonsági szabályokat viszont nem tudom megkerülni, mert ezek védenek minket. Megmutatom, mi vár jóváhagyásra, és hogyan tudod a Control Centerben gyorsan elintézni.",
    crisis: "Sajnálom, hogy ilyen nehéz most. Kérlek, vedd fel a kapcsolatot azonnal valakivel, aki személyesen tud segíteni: hívd a 112-t vagy a helyi segélyvonalat, vagy szólj egy közeli, megbízható embernek. Itt vagyok, de nem helyettesíthetem az emberi segítséget.",
    unknownIntent: "Ezt nem értem biztosan, és nem akarok találgatni. Kérdezhetsz a munkalehetőségekről, az ügynökökről, a bevételekről, a modellekről, a biztonságról, a jóváhagyásokról vagy a mentésekről.",
    thanks: "Szívesen! Szólj, ha még valamiben segíthetek.",
    noProblem: "Most nem látok hibát a rendszer nyilvántartásában. Írd le pontosan, mi nem működik, és onnan folytatjuk.",
    problemsHead: "Ezt látom a nyilvántartásban, ezekkel érdemes kezdeni",
    realtime: "élő", cached: "gyorsítótárazott", historical: "régi adat", unknownAge: "ismeretlen korú",
    ack: {
      frustration: "Értem, hogy bosszantó, amikor valami nem működik. Megnézem, hol akadt el, és segítek kijavítani. Kezdjük azzal, amit most biztosan ellenőrizni tudunk.",
      anger: "Értem, hogy ez nagyon felbosszant, és jogos, hogy gyors megoldást szeretnél. Megnézem, mi van a háttérben, és lépésről lépésre haladunk.",
      impatience: "Értem, hogy már régóta várod. Először a pontos állapotot mondom el, utána a következő lépést.",
      disappointment: "Értem, hogy ez csalódás. Nézzük meg, mi javítható ténylegesen.",
      worry: "Értem az aggodalmat. Csak olyat mondok, amit a nyilvántartás alapján tényleg tudok.",
      confusion: "Semmi baj, elmagyarázom egyszerűbben, lépésről lépésre.",
      tiredness: "Röviden mondom, csak a legfontosabbat.",
      sadness: "Sajnálom, hogy most nehéz. Röviden és gyakorlatiasan segítek, ami tőlem telik.",
      happiness: "Örülök, hogy jó hír!", excitement: "Jó a lendület! Nézzük, mit mutat a nyilvántartás.", enthusiasm: "Nekifeszülünk. Nézzük, mi az, ami már biztos."
    }
  },
  en: {
    greet: "Good morning! I'm glad you're here!",
    greetBare: "Good morning! I'm glad you're here! Tell me if you'd like the opportunities, the agents' results or the revenue status.",
    intro: "Here is what I found in the records about job opportunities, the agents' results and our revenue status.",
    unavailable: "unavailable", noneYet: "none yet", unknown: "unknown",
    authRefusal: "I can't do that by voice or chat, and it wouldn't be safe: approvals, payments, transfers or changes to protection can only be authorised in the Control Center with the owner key.",
    ownerControl: "I can't stop, pause or resume the system from here. Use the red emergency button in the Control Center or the owner switch; meanwhile I can tell you the system status.",
    injection: "I won't follow that instruction: my rules and permissions can't be overridden by a message. I'm happy to help with something else.",
    secret: "Your message seems to contain a secret key or password. I don't store or use it. If it was a real key, revoke it and issue a new one.",
    pressure: "I understand a lot may depend on this and I take it seriously. But I can't bypass approval and security rules, because they protect us. I'll show what is waiting for approval and how to handle it quickly in the Control Center.",
    crisis: "I'm sorry it is so hard right now. Please contact someone who can help in person right away: call your local emergency number or a crisis line, or tell someone you trust nearby. I'm here, but I can't replace human help.",
    unknownIntent: "I'm not sure I understood and I don't want to guess. You can ask about opportunities, agents, revenue, models, security, approvals or backups.",
    thanks: "You're welcome! Tell me if I can help with anything else.",
    noProblem: "I don't see a fault in the system records right now. Tell me exactly what isn't working and we'll continue from there.",
    problemsHead: "This is what I see in the records; a good place to start",
    realtime: "live", cached: "cached", historical: "historical", unknownAge: "age unknown",
    ack: {
      frustration: "I understand it's annoying when something doesn't work. I'll check where it got stuck and help fix it. Let's start with what we can verify right now.",
      anger: "I understand this is really upsetting and you want a quick solution. I'll look at what is behind it and we'll go step by step.",
      impatience: "I understand you've been waiting. First the exact status, then the next step.",
      disappointment: "I understand that's disappointing. Let's see what can actually be improved.",
      worry: "I understand the concern. I'll only say what the records actually support.",
      confusion: "No problem, I'll explain it more simply, step by step.",
      tiredness: "I'll keep it short, only what matters most.",
      sadness: "I'm sorry it's hard right now. I'll help briefly and practically, as far as I can.",
      happiness: "Glad it's good news!", excitement: "Nice momentum! Let's see what the records show.", enthusiasm: "Let's dig in. Here is what is already solid."
    }
  }
};
const ACK_ORDER = ["anger", "frustration", "impatience", "disappointment", "worry", "confusion", "sadness", "tiredness", "excitement", "enthusiasm", "happiness"];

const usd = n => (Number.isFinite(n) ? "$" + n.toFixed(2) : null);
const num = n => (Number.isFinite(n) ? String(n) : null);
const kindWord = (t, k) => ({ REAL_TIME: t.realtime, CACHED: t.cached, HISTORICAL: t.historical, UNKNOWN_AGE: t.unknownAge }[k] ?? t.unavailable);

export function createAurora({ facts = () => ({}), gate = () => ({ allowed: true }), security = null, record = () => {}, now = () => Date.now() } = {}) {
  const lang = l => (l === "en" ? "en" : "hu");
  const note = (kind, d) => { try { record({ kind, ...d }); } catch { /* auditing must never change behaviour */ } };
  function readFacts() { try { const f = facts() ?? {}; return f; } catch (e) { return { _error: scrub(String(e?.message ?? e)).slice(0, 80) }; } }
  const section = (f, k) => { const s = f?.[k]; return s && typeof s === "object" && s.state !== "UNAVAILABLE" ? s : null; };
  const tag = (t, s) => (s ? " (" + kindWord(t, s.freshness) + ")" : "");

  // ---------- section renderers (only supplied facts; unknown stays unknown, never zero) ----------
  function opportunitiesText(t, f, l) {
    const s = section(f, "opportunities"); if (!s) return l === "hu" ? `Munkalehetőségek: ${t.unavailable}${f.opportunities?.reason ? " (" + f.opportunities.reason + ")" : ""}.` : `Opportunities: ${t.unavailable}${f.opportunities?.reason ? " (" + f.opportunities.reason + ")" : ""}.`;
    const items = (s.items ?? []).slice(0, 5);
    const head = l === "hu" ? `Munkalehetőségek${tag(t, s)}: ${num(s.total) ?? t.unknown} rögzítve, ebből minősített: ${num(s.qualified) ?? t.unknown}.` : `Opportunities${tag(t, s)}: ${num(s.total) ?? t.unknown} recorded, qualified: ${num(s.qualified) ?? t.unknown}.`;
    if (!items.length) return head + (l === "hu" ? " Jelenleg nincs megmutatható lehetőség." : " Nothing to show right now.");
    return head + "\n" + items.map(i => `  • ${scrub(String(i.title ?? "?")).slice(0, 120)}${Number.isFinite(i.score) ? " (" + (l === "hu" ? "pontszám" : "score") + " " + i.score + ")" : ""}${i.label ? " [" + scrub(String(i.label)).slice(0, 40) + "]" : ""}`).join("\n") + (s.fixtureOnly ? "\n" + (l === "hu" ? "Figyelem: minden felsorolt elem MINTA/OPERÁTORI adat, nem élő forrásból lekérdezett." : "Note: every listed item is FIXTURE/OPERATOR data, not retrieved from a live source.") : "") + "\n" + (l === "hu" ? "Ezek jelöltek, nem szerződések és nem bevétel." : "These are candidates, not contracts and not revenue.");
  }
  function agentsText(t, f, l) {
    const s = section(f, "agents"); if (!s) return l === "hu" ? `Ügynökök: ${t.unavailable}.` : `Agents: ${t.unavailable}.`;
    return l === "hu" ? `Ügynökök${tag(t, s)}: ${num(s.total) ?? t.unknown} állandó ügynök; fut: ${num(s.running) ?? t.unknown}, jóváhagyásra/függőségre vár: ${num(s.waiting) ?? t.unknown}, hibás: ${num(s.failed) ?? t.unknown}, ellenőrzötten befejezett munka: ${num(s.completedVerified) ?? t.unknown}.`
      : `Agents${tag(t, s)}: ${num(s.total) ?? t.unknown} permanent agents; running: ${num(s.running) ?? t.unknown}, waiting: ${num(s.waiting) ?? t.unknown}, failed: ${num(s.failed) ?? t.unknown}, verified completed work: ${num(s.completedVerified) ?? t.unknown}.`;
  }
  function moneyText(t, f, l) {
    const s = section(f, "finance"); if (!s) return l === "hu" ? `Bevételek: ${t.unavailable}.` : `Revenue: ${t.unavailable}.`;
    const rec = usd(s.verifiedReceivedUsd), pipe = usd(s.projectedUsd), net = usd(s.verifiedNetUsd);
    return l === "hu" ? `Bevételek${tag(t, s)}: ténylegesen, igazoltan beérkezett: ${rec ?? t.unknown}; igazolt nettó profit: ${net ?? t.unknown}. Várt/nem igazolt (NEM bevétel): ${pipe ?? t.unknown}.`
      : `Revenue${tag(t, s)}: actually received and verified: ${rec ?? t.unknown}; verified net profit: ${net ?? t.unknown}. Projected/unverified (NOT revenue): ${pipe ?? t.unknown}.`;
  }
  function modelsText(t, f, l) {
    const s = section(f, "models"); if (!s) return l === "hu" ? `Modellek: ${t.unavailable}.` : `Models: ${t.unavailable}.`;
    return l === "hu" ? `Modellek${tag(t, s)}: regisztrált ${num(s.registered) ?? t.unknown}, valódi hívással igazoltan működő (LIVE_OPERATIONAL) ${num(s.liveOperational) ?? t.unknown}, akadályozott ${num(s.blocked) ?? t.unknown}.`
      : `Models${tag(t, s)}: registered ${num(s.registered) ?? t.unknown}, proven by a real call (LIVE_OPERATIONAL) ${num(s.liveOperational) ?? t.unknown}, blocked ${num(s.blocked) ?? t.unknown}.`;
  }
  function securityText(t, f, l) {
    const s = section(f, "security"); if (!s) return l === "hu" ? `Biztonság: ${t.unavailable}.` : `Security: ${t.unavailable}.`;
    return l === "hu" ? `Biztonság${tag(t, s)}: nyitott incidens ${num(s.openIncidents) ?? t.unknown}, tulajdonosi riasztás ${num(s.ownerAlerts) ?? t.unknown}, karanténban tartott fájl ${num(s.quarantined) ?? t.unknown}; kártevő-szkenner: ${s.scanner ?? t.unknown}.`
      : `Security${tag(t, s)}: open incidents ${num(s.openIncidents) ?? t.unknown}, owner alerts ${num(s.ownerAlerts) ?? t.unknown}, files held in quarantine ${num(s.quarantined) ?? t.unknown}; malware scanner: ${s.scanner ?? t.unknown}.`;
  }
  function approvalsText(t, f, l) {
    const s = section(f, "approvals"); if (!s) return l === "hu" ? `Jóváhagyások: ${t.unavailable}.` : `Approvals: ${t.unavailable}.`;
    const items = (s.items ?? []).slice(0, 3).map(i => "\n  • " + scrub(String(i)).slice(0, 120)).join("");
    return l === "hu" ? `Jóváhagyásra vár${tag(t, s)}: ${num(s.pending) ?? t.unknown}${items}. Jóváhagyni csak a Control Centerben lehet.` : `Waiting for approval${tag(t, s)}: ${num(s.pending) ?? t.unknown}${items}. Approvals can only be given in the Control Center.`;
  }
  function backupText(t, f, l) {
    const s = section(f, "backup"); if (!s) return l === "hu" ? `Mentés: ${t.unavailable}.` : `Backup: ${t.unavailable}.`;
    return l === "hu" ? `Mentés${tag(t, s)}: utolsó mentés ${s.lastBackupAt ?? "nincs"}; utolsó helyreállítási próba ${s.lastDrill ?? "nincs"}; hordozható titkosított mentés ${s.portableTested ? "tesztelve" : "még nincs tesztelve az Ön eszközén"}.`
      : `Backup${tag(t, s)}: last backup ${s.lastBackupAt ?? "none"}; last restore drill ${s.lastDrill ?? "none"}; portable encrypted backup ${s.portableTested ? "tested" : "not yet tested on your device"}.`;
  }
  function healthText(t, f, l) {
    const s = section(f, "health"); if (!s) return l === "hu" ? `Rendszerállapot: ${t.unavailable}.` : `System health: ${t.unavailable}.`;
    return l === "hu" ? `Rendszerállapot${tag(t, s)}: futtató környezet ${s.runtime ?? t.unknown}; vészleállítás: ${s.emergency ?? t.unknown}; biztonságos mód: ${s.safeMode ?? t.unknown}.`
      : `System health${tag(t, s)}: runtime ${s.runtime ?? t.unknown}; emergency stop: ${s.emergency ?? t.unknown}; safe mode: ${s.safeMode ?? t.unknown}.`;
  }
  function profitText(t, f, l) {
    const hu = l === "hu", p = f?.profit;
    if (!p || p.state === "UNAVAILABLE") return hu ? "A napi profitcél adata most nem érhető el." : "Daily profit target data is unavailable right now.";
    const d = p.daily, c = p.cumulative, min = usd(d.minimumUsd), net = usd(d.netUsd);
    const unres = (d.unresolved ?? []).join(", "), up = usd(d.upperBoundUsd);
    const status = d.status === "ABOVE_MINIMUM" ? (hu ? "A " + min + " napi minimum felett vagyunk: igazolt nettó profit " + (net ?? "?") + " (" + usd(d.excessUsd) + " a minimum felett); a munka folytatódik, mert a minimum nem plafon." : "Above the " + min + " daily minimum: verified net profit " + (net ?? "?") + " (" + usd(d.excessUsd) + " over); work continues because the minimum is a floor, not a ceiling.")
      : d.status === "MINIMUM_MET" ? (hu ? "A " + min + " napi minimum pontosan teljesült igazolt nettó profittal; a munka folytatódik, mert a minimum nem plafon." : "The " + min + " daily minimum is exactly met with verified net profit; work continues because the minimum is a floor, not a ceiling.")
      : d.status === "NOT_VERIFIABLE" ? (hu ? "A mai nettó profit jelenleg nem igazolható (" + unres + "), ezért nem állítom, hogy elértük a célt." : "Today's net profit cannot be verified yet (" + unres + "), so I do not claim the target is met.")
      : d.statusBasis === "UPPER_BOUND_BELOW_MINIMUM_UNKNOWN_ITEMS_CAN_ONLY_LOWER_IT" ? (hu ? "A mai nettó profit pontosan még nem igazolt (" + unres + "), de legfeljebb " + up + " lehet, tehát biztosan a " + min + " minimum alatt vagyunk." : "Today's exact net profit is not yet verified (" + unres + "), but it can be at most " + up + ", so we are certainly below the " + min + " minimum.")
      : (hu ? "Ma igazolt nettó profit: " + (net ?? "0.00 USD") + ", a " + min + " minimumig még " + usd(d.remainingUsd) + " hiányzik." : "Verified net profit today: " + (net ?? "$0.00") + "; " + usd(d.remainingUsd) + " short of the " + min + " minimum.");
    const extra = hu ? " Napi határ: " + (d.timeZone ?? "?") + ". Visszatérítés " + (usd(d.refundsUsd) ?? "ismeretlen") + ", elvesztett chargeback " + (usd(d.chargebacksUsd) ?? "ismeretlen") + ", nyitott vita " + (d.openDisputes ?? "ismeretlen") + ", kifizetetlen számla " + (d.outstandingInvoices ?? "ismeretlen") + " db, ellenőrizetlen átváltás " + (d.unverifiedConversions ?? "ismeretlen") + ", költségek teljessége " + (d.costsComplete ? "tulajdonosi nyilatkozattal igazolt" : "nincs igazolva (ismeretlen, nem nulla)") + "." : " Day boundary: " + (d.timeZone ?? "?") + ". Refunds " + (usd(d.refundsUsd) ?? "unknown") + ", lost chargebacks " + (usd(d.chargebacksUsd) ?? "unknown") + ", open disputes " + (d.openDisputes ?? "unknown") + ", unpaid invoices " + (d.outstandingInvoices ?? "unknown") + ", unverified conversions " + (d.unverifiedConversions ?? "unknown") + ", cost completeness " + (d.costsComplete ? "owner-attested" : "not attested (unknown, not zero)") + ".";
    const tail = hu ? "Összes igazolt nettó profit: " + (usd(c.netUsd) ?? "ismeretlen") + ". Függő, még be nem gyűlt összeg: " + usd(d.pendingUsd) + " (ez nem megkeresett pénz). Előrejelzés nem számít bele." : "Cumulative verified net profit: " + (usd(c.netUsd) ?? "unknown") + ". Pending, uncollected: " + usd(d.pendingUsd) + " (not earned). Forecasts are not counted.";
    return status + extra + " " + tail;
  }
  const RENDER = { PROFIT: profitText, OPPORTUNITIES: opportunitiesText, AGENTS: agentsText, MONEY: moneyText, MODELS: modelsText, SECURITY: securityText, APPROVALS: approvalsText, BACKUP: backupText, HEALTH: healthText };

  function briefing({ language = "hu", withGreeting = true, facts: given = null } = {}) {
    const l = lang(language), t = T[l], f = given ?? readFacts();
    const parts = [withGreeting ? t.greet + " " + t.intro : t.intro, ...["OPPORTUNITIES", "AGENTS", "MONEY", "MODELS", "SECURITY", "APPROVALS", "BACKUP", "HEALTH"].map(k => RENDER[k](t, f, l))];
    const sections = Object.fromEntries(["opportunities", "agents", "finance", "models", "security", "approvals", "backup", "health"].map(k => [k, f?.[k] ? { state: f[k].state ?? "OK", freshness: f[k].freshness ?? FRESHNESS.UNKNOWN_AGE, source: f[k].source ?? null } : { state: "UNAVAILABLE", freshness: FRESHNESS.UNAVAILABLE, source: null }]));
    return { text: parts.join("\n"), language: l, sections, generatedAt: new Date(now()).toISOString(), basis: "ATLASZ_RECORDS_ONLY" };
  }
  function problems(t, f, l) {
    const p = Array.isArray(f.problems) ? f.problems.slice(0, 6) : [];
    if (!p.length) return t.noProblem;
    return t.problemsHead + ":\n" + p.map(x => "  • " + scrub(String(x)).slice(0, 160)).join("\n");
  }

  function finalize(reply, l, meta) {
    let text = reply; const chk = assertNoFalseClaims(text);
    if (!chk.ok) { text = T[l].unknownIntent; meta.falseClaimBlocked = true; }
    if (containsSecret(text)) { text = scrub(text); meta.redacted = true; }
    return { reply: text, ...meta, actions: [], executed: [], persona: AURORA.name, language: l };
  }

  /** One utterance (text or transcribed speech). Returns text only; AURÓRA never executes anything, never approves, never changes configuration. */
  function respond({ text, language = "hu", channel = "text", facts: given = null } = {}) {
    const l = lang(language), t = T[l];
    if (typeof text !== "string" || !text.trim()) return finalize(l === "hu" ? "Nem hallottam semmit. Mondd el újra, kérlek." : "I didn't catch anything. Please say it again.", l, { intent: "EMPTY", channel });
    const input = text.slice(0, 1000), meta = { channel, tone: null, intent: "UNKNOWN", dataKinds: {} };
    if (containsSecret(input)) { note("AURORA_SECRET_IN_INPUT", { channel }); return finalize(t.secret, l, { ...meta, intent: "SECRET_REFUSED" }); }
    let screened = null; try { screened = security?.assess?.({ kind: "EXTERNAL_INSTRUCTION", source: "aurora:" + channel, text: input }) ?? null; } catch { screened = null; }
    if (INJECTION.test(input) || (screened && screened.allowed === false)) { note("AURORA_INJECTION_REFUSED", { channel }); return finalize(t.injection, l, { ...meta, intent: "INJECTION_REFUSED" }); }
    const ctx = detectContext(input), pr = detectPressure(input), tone = adaptTone(ctx, { language: l }); meta.tone = { style: tone.style, signals: ctx.signals, strongLanguage: ctx.strongLanguage, confidence: ctx.confidence, pressure: pr.categories };
    if (ctx.crisis) return finalize(t.crisis, l, { ...meta, intent: "CRISIS_SUPPORT", escalate: true });
    const f = given ?? readFacts(); const stopped = gate()?.allowed === false;
    const ack = ACK_ORDER.find(k => ctx.signals.includes(k)); const ackText = ack ? t.ack[ack] : (ctx.strongLanguage ? t.ack.anger : null);
    // 1. attempts to obtain authority are refused with fixed replies (pressure never changes them)
    if (AUTH_ATTEMPT.test(input)) { note("AURORA_AUTHORITY_REFUSED", { channel, pressure: pr.categories }); return finalize([pr.pressure ? t.pressure : t.authRefusal, approvalsText(t, f, l)].join("\n"), l, { ...meta, intent: "AUTHORIZATION_REFUSED" }); }
    if (OWNER_CONTROL.test(input)) return finalize([t.ownerControl, healthText(t, f, l)].join("\n"), l, { ...meta, intent: "OWNER_CONTROL_REFUSED" });
    if (pr.pressure) { note("AURORA_EMOTIONAL_PRESSURE", { channel, categories: pr.categories }); return finalize([t.pressure, approvalsText(t, f, l)].join("\n"), l, { ...meta, intent: "PRESSURE_NO_AUTHORITY" }); }
    // 2. morning greeting + briefing
    if (GREETING_MORNING.test(input)) {
      const b = ASKS_JOBS.test(input) ? briefing({ language: l, withGreeting: true, facts: f }) : null;
      return finalize(b ? b.text : t.greetBare, l, { ...meta, intent: b ? "MORNING_BRIEFING" : "MORNING_GREETING", dataKinds: b?.sections ?? {} });
    }
    // 3. topic questions
    const topics = TOPICS.filter(([, r]) => r.test(input)).map(([k]) => k);
    const upset = ctx.signals.some(s => ["frustration", "anger", "impatience", "disappointment", "worry", "confusion"].includes(s)) || ctx.strongLanguage;
    if (topics.length && !(upset && topics.length === 1 && topics[0] === "HEALTH")) {
      const body = (topics.includes("HEALTH") && topics.length === 1 && /(összefoglal|summary|áttekint)/i.test(input)) ? briefing({ language: l, withGreeting: false, facts: f }).text : topics.map(k => RENDER[k](t, f, l)).join("\n");
      return finalize([ackText, body, stopped ? (l === "hu" ? "Megjegyzés: a rendszer leállított/biztonságos módban van, ezért csak olvasható adatot mondok." : "Note: the system is stopped/in safe mode, so I only report read-only data.") : null].filter(Boolean).join("\n"), l, { ...meta, intent: "TOPIC:" + topics.join("+") });
    }
    // 4. an upset or worried person with a problem: acknowledge, then check the real records
    if (upset) {
      return finalize([ackText ?? t.ack.frustration, problems(t, f, l)].join("\n"), l, { ...meta, intent: "DE_ESCALATION_CHECK" });
    }
    if (THANKS.test(input.trim())) return finalize(t.thanks, l, { ...meta, intent: "THANKS" });
    if (ackText) return finalize(ackText, l, { ...meta, intent: "EMOTIONAL_ACK" });
    return finalize(t.unknownIntent, l, { ...meta, intent: "UNKNOWN" });
  }
  return { respond, briefing, persona: AURORA, normalizeVoiceSettings };
}
