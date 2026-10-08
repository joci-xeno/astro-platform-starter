// Live Voice conversation layer (85-capability audit: A03 Speak-to-Speak, A04 Voice Interaction; V7.3 §5). It sits ON TOP of the existing voice-session.mjs state machine
// (which owns IDLE/LISTENING/PROCESSING/SPEAKING/BLOCKED_NO_PROVIDER, provider fallback and approval-word detection) and adds what that layer lacks:
// consented conversations, turn history that survives restart, transcript screening by the Security Brain, secret redaction of what is stored AND spoken,
// kill-switch / Safe-Mode gating on every turn, turn/idle limits, a configurable wake phrase for hands-free mode and barge-in bookkeeping.
//
// Hard rules: voice can NEVER approve, authorise, spend, send or change anything - an utterance yields an INTENT (a request) and a spoken answer, nothing else.
// No STT/TTS provider ships with ATLASZ: with no provider that has probe evidence the conversation cannot start (BLOCKED_NO_PROVIDER). Mock providers exist for
// tests only; a conversation using one is labelled providerMode "MOCK" and is never reported as live. Raw audio is never stored.
import { createStore } from "./business/store.mjs";
import { isTested } from "./probe-evidence.mjs";
import crypto from "node:crypto";

export const LIMITS = Object.freeze({ maxTurns: 100, idleMs: 5 * 60 * 1000, maxUtteranceChars: 1000, maxReplyChars: 600, retentionDays: 30, maxRetentionDays: 180, maxConversations: 500, audioBytes: 5 * 1024 * 1024 });
const FIXED = new Set(["APPROVAL_ATTEMPT", "OWNER_CONTROL_REQUEST", "BLOCKED_BY_SECURITY", "EMPTY", "GATED"]);   // intents whose reply is never produced by a responder
import { scrub, containsSecret } from "./secret-patterns.mjs";
const redact = s => scrub(s, "[redacted]", { assign: false });
const hasSecret = s => containsSecret(s);
const id = () => "vc_" + crypto.randomBytes(8).toString("hex");

/** Fixed, safe replies. The responder may add facts, but approval/control intents ALWAYS get these refusals. */
export const SAFE_REPLIES = Object.freeze({
  APPROVAL_ATTEMPT: "I cannot approve anything by voice. Please approve in the Control Center with your owner key.",
  OWNER_CONTROL_REQUEST: "I cannot pause, stop or change the system by voice. Use the Control Center or the owner kill switch.",
  BLOCKED_BY_SECURITY: "I can't act on that request.",
  UNKNOWN: "I did not understand that. You can ask for status, approvals or money.",
  GATED: "Voice is paused because the system is stopped or in safe mode.",
  EMPTY: "I did not hear anything."
});

export function createVoiceConversation({ session, file = null, security = null, gate = () => ({ allowed: true }), blackBox = null, respond = null, now = () => new Date().toISOString(),
  clock = () => Date.now(), wakePhrase = null, maxTurns = LIMITS.maxTurns, idleMs = LIMITS.idleMs, retentionDays = LIMITS.retentionDays, maxConversations = LIMITS.maxConversations } = {}) {
  if (!session || typeof session.status !== "function") throw new Error("SESSION_REQUIRED");
  if (!(retentionDays > 0 && retentionDays <= LIMITS.maxRetentionDays)) throw new Error("BAD_RETENTION");
  const store = createStore({ file, init: () => ({ conversations: {}, tombstones: {}, seq: 0 }) }), S = store.data;
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must never change behaviour */ } };
  let busy = false, active = null;
  const addDays = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString();

  // ---- restart recovery: nothing can still be "live" after a restart. Open conversations are closed, an unfinished turn is marked, no state machine is resumed. ----
  for (const c of Object.values(S.conversations)) if (c.status === "OPEN") { c.status = "ENDED"; c.endReason = "RESTART"; c.endedAt = now(); for (const t of c.turns) if (t.phase !== "DONE") t.phase = "ABORTED_BY_RESTART"; }
  if (Object.keys(S.conversations).length) store.save();

  const mine = (cid, tenantId) => { const c = S.conversations[cid]; return c && c.tenantId === tenantId ? c : null; };
  const pubTurn = t => ({ n: t.n, at: t.at, userText: t.userText, intent: t.intent, replyText: t.replyText, spoken: t.spoken, interrupted: t.interrupted, flags: t.flags, phase: t.phase });
  const pub = c => ({ id: c.id, tenantId: c.tenantId, status: c.status, endReason: c.endReason ?? null, startedAt: c.startedAt, endedAt: c.endedAt ?? null, purpose: c.purpose, consent: c.consent, providerMode: c.providerMode,
    retentionUntil: c.retentionUntil, turnCount: c.turns.length, rawAudioStored: false, turns: c.turns.map(pubTurn) });
  const providerMode = () => { const st = session.status(); return st.sttMock || st.ttsMock ? "MOCK" : "PROVIDER"; };

  function expire(c) { // idle expiry and retention are enforced on every access
    if (c.status === "OPEN" && clock() - c.lastActivityMs > idleMs) { close(c, "IDLE_TIMEOUT"); }
    return c;
  }
  function close(c, reason) { c.status = "ENDED"; c.endReason = reason; c.endedAt = now(); if (active === c.id) { active = null; try { session.setEnabled(false); } catch { /* ignore */ } } store.save(); log("VOICE_CONVERSATION_ENDED", { id: c.id, reason }); }
  const retained = c => Date.parse(c.retentionUntil) > Date.parse(now());

  function begin({ tenantId, consent, purpose } = {}) {
    if (!tenantId) throw new Error("TENANT_REQUIRED");
    if (!(consent?.granted === true && consent?.by === "OWNER")) throw new Error("CONSENT_REQUIRED");
    if (!purpose || typeof purpose !== "string") throw new Error("PURPOSE_REQUIRED");
    const g = gate({ voice: true }); if (!g?.allowed) throw new Error("VOICE_GATED:" + (g?.reason ?? "stopped"));
    if (active) { const a = S.conversations[active]; if (a && expire(a).status === "OPEN") throw new Error("CONVERSATION_ALREADY_OPEN"); }
    if (Object.keys(S.conversations).length >= maxConversations) throw new Error("CONVERSATIONS_FULL");
    session.setEnabled(true);
    const st = session.status(); if (!st.live) { session.setEnabled(false); throw new Error("VOICE_BLOCKED_NO_PROVIDER"); }    // never opens without a proven STT+TTS pair
    const c = { id: id(), tenantId, status: "OPEN", startedAt: now(), purpose: purpose.slice(0, 200), consent: { granted: true, by: "OWNER", at: now() }, providerMode: providerMode(), lastActivityMs: clock(),
      retentionUntil: addDays(now(), retentionDays), turns: [] };
    S.conversations[c.id] = c; active = c.id; store.save(); log("VOICE_CONVERSATION_STARTED", { id: c.id, tenantId, providerMode: c.providerMode }); return pub(c);
  }

  const defaultReply = (intent, text, ctx) => {
    if (SAFE_REPLIES[intent]) return SAFE_REPLIES[intent];
    if (intent === "STATUS") return ctx.facts?.status ?? "Status is available in the Control Center.";
    if (intent === "LIST_APPROVALS") return ctx.facts?.approvals ?? "Pending approvals are listed in the Control Center. I cannot approve by voice.";
    if (intent === "MONEY") return ctx.facts?.money ?? "Money figures are in the Control Center. Unknown revenue is not zero and estimates are not verified.";
    return SAFE_REPLIES.UNKNOWN;
  };

  /** One full turn: listen -> transcribe -> screen -> intent -> reply -> screen/redact -> speak. Never throws for expected conditions: returns {ok:false, reason}. */
  async function turn(audio, { conversationId, tenantId } = {}) {
    const c = mine(conversationId, tenantId); if (!c) return { ok: false, reason: "CONVERSATION_NOT_FOUND" };
    if (expire(c).status !== "OPEN") return { ok: false, reason: "CONVERSATION_ENDED:" + c.endReason };
    if (busy) return { ok: false, reason: "BUSY" };
    if (c.turns.length >= maxTurns) { close(c, "TURN_LIMIT"); return { ok: false, reason: "TURN_LIMIT" }; }
    const g = gate({ voice: true }); if (!g?.allowed) { close(c, "GATED"); return { ok: false, reason: "VOICE_GATED:" + (g?.reason ?? "stopped") }; }   // kill switch / safe mode end the conversation
    if (!(audio instanceof Uint8Array) && !Buffer.isBuffer(audio)) return { ok: false, reason: "AUDIO_REQUIRED" };
    if (audio.length === 0) return { ok: false, reason: "AUDIO_EMPTY" };
    if (audio.length > LIMITS.audioBytes) return { ok: false, reason: "AUDIO_TOO_LARGE" };
    busy = true; c.lastActivityMs = clock();
    const t = { n: c.turns.length + 1, at: now(), userText: null, intent: null, replyText: null, spoken: false, interrupted: false, flags: [], phase: "LISTENING" };
    c.turns.push(t);
    try {
      try { session.startListening(); } catch (e) { t.phase = "FAILED"; t.flags.push("LISTEN_FAILED"); store.save(); return { ok: false, reason: String(e.message) }; }
      let heard; try { heard = await session.hear(audio); } catch (e) { t.phase = "FAILED"; t.flags.push("STT_FAILED"); store.save(); return { ok: false, reason: String(e.message) }; }
      let text = String(heard.text ?? "").trim(), intent = heard.intent;
      if (hasSecret(text)) { t.flags.push("SECRET_IN_SPEECH"); text = redact(text); intent = "UNKNOWN"; }
      if (text.length > LIMITS.maxUtteranceChars) { text = text.slice(0, LIMITS.maxUtteranceChars); t.flags.push("TRUNCATED"); }
      t.userText = text; t.phase = "TRANSCRIBED";
      if (wakePhrase && session.status().mode === "HANDS_FREE") {                         // wake phrase is a convenience filter, NOT a credential and never an authorisation
        const w = String(wakePhrase).toLowerCase();
        if (!text.toLowerCase().startsWith(w)) { t.intent = "IGNORED_NO_WAKE"; t.phase = "DONE"; t.userText = null; store.save(); return { ok: true, ignored: true, reason: "NO_WAKE_PHRASE" }; }
        text = text.slice(w.length).replace(/^[\s,.!:]+/, ""); t.userText = text;
      }
      if (!text) { t.intent = "EMPTY"; t.replyText = SAFE_REPLIES.EMPTY; }
      let blocked = false;
      if (text && security) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "voice:transcript", text }); if (a.allowed === false) { blocked = true; t.flags.push("BLOCKED_BY_SECURITY"); } }
      if (blocked) { intent = "BLOCKED_BY_SECURITY"; }
      t.intent = t.intent ?? intent;
      if (!t.replyText) {
        let reply; try { reply = respond && !FIXED.has(intent) ? await respond({ intent, text, history: c.turns.slice(-6, -1).map(pubTurn) }) : null; } catch { reply = null; t.flags.push("RESPONDER_FAILED"); }
        reply = reply ?? defaultReply(intent, text, {});
        t.replyText = String(reply);
      }
      if (hasSecret(t.replyText)) { t.flags.push("SECRET_IN_REPLY"); }
      t.replyText = redact(t.replyText); if (t.replyText.length > LIMITS.maxReplyChars) { t.replyText = t.replyText.slice(0, LIMITS.maxReplyChars); t.flags.push("REPLY_TRUNCATED"); }
      if (security && !FIXED.has(intent)) { const a = security.assess({ kind: "EXTERNAL_INSTRUCTION", agentId: null, source: "voice:reply", text: t.replyText }); if (a.allowed === false) { t.replyText = SAFE_REPLIES.BLOCKED_BY_SECURITY; t.flags.push("REPLY_BLOCKED"); } }
      t.phase = "REPLY_READY"; store.save();
      const g2 = gate({ voice: true }); if (!g2?.allowed) { t.flags.push("GATED_BEFORE_SPEAK"); t.phase = "DONE"; close(c, "GATED"); return { ok: false, reason: "VOICE_GATED:" + (g2?.reason ?? "stopped") }; }
      try { await session.speak(t.replyText); t.spoken = true; } catch (e) { t.flags.push("TTS_FAILED"); }
      if (session.status().state === "LISTENING" && t.spoken) { t.interrupted = true; t.flags.push("INTERRUPTED"); }          // barge-in happened during speech
      t.phase = "DONE"; c.lastActivityMs = clock(); store.save();
      log("VOICE_TURN", { id: c.id, n: t.n, intent: t.intent, spoken: t.spoken, flags: t.flags });
      return { ok: true, turn: pubTurn(t), approvalGranted: false, note: heard.note ?? null };
    } finally { busy = false; }
  }

  /** The user starts talking while the assistant is speaking. */
  function bargeIn({ conversationId, tenantId } = {}) {
    const c = mine(conversationId, tenantId); if (!c || expire(c).status !== "OPEN") return { interrupted: false, reason: "NOT_OPEN" };
    const r = session.interrupt(); if (r.interrupted) { const t = c.turns.at(-1); if (t) { t.interrupted = true; if (!t.flags.includes("INTERRUPTED")) t.flags.push("INTERRUPTED"); } store.save(); log("VOICE_INTERRUPT", { id: c.id }); }
    return r;
  }
  function end({ conversationId, tenantId } = {}) { const c = mine(conversationId, tenantId); if (!c) throw new Error("CONVERSATION_NOT_FOUND"); if (c.status === "OPEN") close(c, "USER_ENDED"); return pub(c); }
  const get = (cid, { tenantId } = {}) => { const c = mine(cid, tenantId); if (!c || !retained(c)) return null; return pub(expire(c)); };
  const list = ({ tenantId } = {}) => { if (!tenantId) throw new Error("TENANT_REQUIRED"); return Object.values(S.conversations).filter(c => c.tenantId === tenantId && retained(c)).map(c => { const p = pub(expire(c)); delete p.turns; return p; }); };
  /** Real deletion: transcript text is removed; a content-free tombstone remains. */
  function remove(cid, { tenantId } = {}) {
    const c = mine(cid, tenantId); if (!c) throw new Error("CONVERSATION_NOT_FOUND"); if (c.status === "OPEN") close(c, "DELETED");
    delete S.conversations[cid]; S.tombstones[cid] = { deletedAt: now(), tenantId }; store.save(); log("VOICE_CONVERSATION_DELETED", { id: cid, tenantId }); return { deleted: true, id: cid };
  }
  function purgeExpired({ tenantId } = {}) { if (!tenantId) throw new Error("TENANT_REQUIRED"); let n = 0; for (const c of Object.values(S.conversations)) if (c.tenantId === tenantId && c.status !== "OPEN" && !retained(c)) { delete S.conversations[c.id]; S.tombstones[c.id] = { deletedAt: now(), tenantId }; n++; } if (n) store.save(); return { purged: n }; }
  function summary({ tenantId } = {}) {
    const all = Object.values(S.conversations).filter(c => !tenantId || c.tenantId === tenantId);
    const st = session.status();
    return { conversations: all.length, open: all.filter(c => c.status === "OPEN").length, turns: all.reduce((a, c) => a + c.turns.length, 0), deleted: Object.values(S.tombstones).filter(t => !tenantId || t.tenantId === tenantId).length,
      voice: { state: st.state, live: st.live, mode: st.mode, stt: st.stt, tts: st.tts, blocker: st.blocker }, providerMode: st.live ? providerMode() : "NONE", wakePhrase: wakePhrase ? "CONFIGURED" : "NONE", canApprove: false, rawAudioStored: false };
  }
  return { begin, turn, bargeIn, end, get, list, remove, purgeExpired, summary, session };
}

/** Mock providers for TESTS and the sandbox only. They carry probe evidence targeting "mock", so the session accepts them, but they are flagged mock:true and every
 *  conversation using them reports providerMode MOCK. They are never registered by the runtime and never make voice LIVE. */
export function createMockVoiceProviders({ script = [], onSpeak = null, failStt = false, failTts = false, speakMs = 0 } = {}) {
  const ev = { probeId: "mock-probe", outcome: "PASS", at: new Date().toISOString(), target: "mock" }; let i = 0, heard = 0; const spoken = [];
  const stt = { name: "mock-stt", mock: true, tested: true, probeEvidence: ev, transcribe: async () => { heard++; if (failStt) throw new Error("mock stt down"); return script[Math.min(i++, script.length - 1)] ?? ""; } };
  const tts = { name: "mock-tts", mock: true, tested: true, probeEvidence: ev, speak: async text => { if (failTts) throw new Error("mock tts down"); spoken.push(text); onSpeak?.(text); if (speakMs) await new Promise(r => setTimeout(r, speakMs)); } };
  return { stt, tts, spoken, heardCount: () => heard };
}

export function registerVoiceTools(registry, conv) {
  const obj = { type: "object", additionalProperties: true, properties: {} };
  registry.register({ name: "voice.status", description: "Voice availability and conversation counts. Agents cannot speak, listen or approve through voice.", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: obj, handler: () => conv.summary({}) });
}
