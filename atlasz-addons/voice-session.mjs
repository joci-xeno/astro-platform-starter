// V7.3 §5 Speak-to-Speak session layer (provider-agnostic). This is the SESSION STATE MACHINE only: no microphone, STT or TTS is included.
// With no tested provider chain the session reports BLOCKED_NO_PROVIDER and cannot LISTEN or SPEAK. Voice can never approve anything:
// a spoken "approve" returns NEEDS_STRONG_AUTH and creates no approval.
import fs from "node:fs";
import path from "node:path";
import { isTested } from "./probe-evidence.mjs";

export const VOICE_STATES = Object.freeze(["IDLE", "LISTENING", "PROCESSING", "SPEAKING", "BLOCKED_NO_PROVIDER"]);
export const MODES = Object.freeze(["PUSH_TO_TALK", "HANDS_FREE"]);
const APPROVAL_WORDS = /(approve|yes do it|confirm|go ahead|jóváhagy|igen csináld|rendben mehet)/i;
const INTENTS = [[/(status|állapot)/i, "STATUS"], [/(approval|jóváhagyás)/i, "LIST_APPROVALS"], [/(money|profit|pénz)/i, "MONEY"], [/(pause|stop|leáll|szünet)/i, "OWNER_CONTROL_REQUEST"]];

export function createVoiceSession({ sttChain = [], ttsChain = [], transcriptDir = null, mode = "PUSH_TO_TALK", clock = () => Date.now(), now = () => new Date().toISOString() } = {}) {
  if (!MODES.includes(mode)) throw new Error("BAD_MODE");
  let state = "IDLE", enabled = false, turn = null, seq = 0; const metrics = [], health = {};
  const pick = chain => chain.find(p => isTested(p.tested, p.probeEvidence) && health[p.name] !== "DOWN") ?? null;     // fallback: first proven, not-failed provider
  const sttP = () => pick(sttChain), ttsP = () => pick(ttsChain);
  const log = (kind, data) => { if (transcriptDir) { fs.mkdirSync(transcriptDir, { recursive: true }); fs.appendFileSync(path.join(transcriptDir, "voice-transcript.jsonl"), JSON.stringify({ seq: ++seq, at: now(), kind, ...data }) + "\n", { mode: 0o600 }); } };
  const status = () => ({ state: state === "IDLE" && enabled && !(sttP() && ttsP()) ? "BLOCKED_NO_PROVIDER" : state, enabled, mode, live: Boolean(enabled && sttP() && ttsP()),
    stt: sttP()?.name ?? null, tts: ttsP()?.name ?? null, providers: Object.fromEntries([...sttChain, ...ttsChain].map(p => [p.name, !isTested(p.tested, p.probeEvidence) ? "UNPROVEN" : (health[p.name] ?? "HEALTHY")])),
    blocker: sttP() && ttsP() ? null : "No STT+TTS provider with probe evidence is attached (EXTERNAL: provider credentials).", latency: summarize() });
  function summarize() { if (!metrics.length) return { turns: 0 }; const t = metrics.map(m => m.totalMs).sort((a, b) => a - b); return { turns: t.length, medianMs: t[Math.floor(t.length / 2)], maxMs: t[t.length - 1] }; }
  function setEnabled(on) { enabled = Boolean(on); if (!enabled) { state = "IDLE"; turn = null; } return status(); }
  function startListening() {
    if (!enabled) throw new Error("VOICE_OFF"); if (!sttP() || !ttsP()) { state = "IDLE"; throw new Error("VOICE_BLOCKED_NO_PROVIDER"); }
    if (state === "SPEAKING") interrupt();                                       // barge-in
    state = "LISTENING"; turn = { startedAt: clock() }; return status();
  }
  function interrupt() { if (state !== "SPEAKING") return { interrupted: false }; state = "LISTENING"; turn = { startedAt: clock(), interrupted: true }; log("INTERRUPT", {}); return { interrupted: true }; }
  /** audio -> transcript -> intent. Intents are REQUESTS; nothing consequential happens from voice. */
  async function hear(audio) {
    if (state !== "LISTENING") throw new Error("NOT_LISTENING");
    const p = sttP(); state = "PROCESSING"; const t0 = clock();
    let text; try { text = await p.transcribe(audio); } catch (e) { health[p.name] = "DOWN"; state = "IDLE"; log("STT_FAILED", { provider: p.name, error: String(e.message).slice(0, 80) }); throw new Error("STT_FAILED_FALLBACK_NEXT_TURN"); }
    const t1 = clock(); log("USER", { text, provider: p.name });
    const approval = APPROVAL_WORDS.test(text);
    const intent = approval ? "APPROVAL_ATTEMPT" : (INTENTS.find(([r]) => r.test(text))?.[1] ?? "UNKNOWN");
    turn = { ...turn, sttMs: t1 - t0, text, intent };
    return { text, intent, approvalGranted: false, note: approval ? "NEEDS_STRONG_AUTH: voice identity cannot approve; use the Control Center with your key." : null };
  }
  async function speak(text) {
    const p = ttsP(); if (!p) throw new Error("VOICE_BLOCKED_NO_PROVIDER");
    state = "SPEAKING"; const t0 = clock();
    try { await p.speak(text); } catch (e) { health[p.name] = "DOWN"; state = "IDLE"; log("TTS_FAILED", { provider: p.name }); throw new Error("TTS_FAILED"); }
    if (state === "SPEAKING") state = "IDLE";
    const end = clock(); metrics.push({ sttMs: turn?.sttMs ?? null, ttsMs: end - t0, totalMs: end - (turn?.startedAt ?? t0) }); log("ASSISTANT", { text, provider: p.name }); return { spoken: true };
  }
  const recover = name => { delete health[name]; };
  return { status, setEnabled, startListening, interrupt, hear, speak, recover, setMode: m => { if (!MODES.includes(m)) throw new Error("BAD_MODE"); mode = m; return status(); } };
}
