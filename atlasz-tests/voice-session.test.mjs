import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createVoiceSession } from "../atlasz-addons/voice-session.mjs";
import { tmp, rm } from "./helpers.mjs";

// TEST FAKES: these providers exist only inside this test file. They are not providers and are not LIVE anywhere.
const ev = { probeId: "t", outcome: "PASS", at: new Date().toISOString(), target: "fake" };
const fakeStt = (name, fn) => ({ name, tested: true, probeEvidence: ev, transcribe: fn });
const fakeTts = (name, fn = async () => {}) => ({ name, tested: true, probeEvidence: ev, speak: fn });

test("no provider chain => BLOCKED_NO_PROVIDER, cannot listen; an UNPROVEN provider is never used", () => {
  const v = createVoiceSession({}); v.setEnabled(true);
  assert.equal(v.status().state, "BLOCKED_NO_PROVIDER"); assert.equal(v.status().live, false); assert.match(v.status().blocker, /EXTERNAL/);
  assert.throws(() => v.startListening(), /VOICE_BLOCKED_NO_PROVIDER/);
  const u = createVoiceSession({ sttChain: [{ name: "x", tested: true, transcribe: async () => "hi" }], ttsChain: [{ name: "y", tested: false, probeEvidence: ev, speak: async () => {} }] }); u.setEnabled(true);
  assert.equal(u.status().live, false); assert.equal(u.status().providers.x, "UNPROVEN");
});
test("a turn: listen -> hear -> speak records transcript and latency; voice can never approve", async () => {
  const d = tmp("voice-"); let t = 0;
  try {
    const v = createVoiceSession({ sttChain: [fakeStt("stt1", async () => "please approve it")], ttsChain: [fakeTts("tts1")], transcriptDir: d, clock: () => (t += 100) });
    v.setEnabled(true); assert.equal(v.status().live, true);
    v.startListening(); const h = await v.hear(Buffer.from("a"));
    assert.equal(h.intent, "APPROVAL_ATTEMPT"); assert.equal(h.approvalGranted, false); assert.match(h.note, /NEEDS_STRONG_AUTH/);
    await v.speak("I cannot approve by voice"); assert.equal(v.status().state, "IDLE"); assert.equal(v.status().latency.turns, 1); assert.ok(v.status().latency.maxMs > 0);
    const lines = fs.readFileSync(path.join(d, "voice-transcript.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.deepEqual(lines.map(l => l.kind), ["USER", "ASSISTANT"]);
    v.startListening(); const s = await v.hear(Buffer.from("a")); assert.equal(s.intent, "APPROVAL_ATTEMPT");
  } finally { rm(d); }
});
test("interrupt (barge-in) while speaking, intents, and mode validation", async () => {
  let release; const slow = fakeTts("tts1", () => new Promise(r => (release = r)));
  const v = createVoiceSession({ sttChain: [fakeStt("s", async () => "what is the status")], ttsChain: [slow] }); v.setEnabled(true);
  v.startListening(); assert.equal((await v.hear(Buffer.from("a"))).intent, "STATUS");
  const speaking = v.speak("long answer"); assert.equal(v.status().state, "SPEAKING");
  assert.equal(v.interrupt().interrupted, true); assert.equal(v.status().state, "LISTENING"); release(); await speaking;
  assert.equal(v.status().state, "LISTENING");                                                  // speak() must not clobber the barge-in
  assert.throws(() => v.setMode("WHISPER"), /BAD_MODE/); assert.equal(v.setMode("HANDS_FREE").mode, "HANDS_FREE");
  assert.throws(() => createVoiceSession({}).startListening(), /VOICE_OFF/);
});
test("provider fallback: a failing STT is marked DOWN and the next proven provider takes over", async () => {
  const v = createVoiceSession({ sttChain: [fakeStt("bad", async () => { throw new Error("503"); }), fakeStt("good", async () => "money")], ttsChain: [fakeTts("t")] }); v.setEnabled(true);
  v.startListening(); await assert.rejects(v.hear(Buffer.from("a")), /STT_FAILED/);
  assert.equal(v.status().providers.bad, "DOWN"); assert.equal(v.status().stt, "good");
  v.startListening(); assert.equal((await v.hear(Buffer.from("a"))).intent, "MONEY");
  v.recover("bad"); assert.equal(v.status().stt, "bad");
});
