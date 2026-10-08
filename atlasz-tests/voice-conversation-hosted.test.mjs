// Live Voice as hosted by the runtime and the Control Center.
process.env.ATLASZ_TEST_MODE = "1";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { createVoiceConversation, createMockVoiceProviders } from "../atlasz-addons/voice-conversation.mjs";
import { createVoiceSession } from "../atlasz-addons/voice-session.mjs";
import { createControlCenterServer } from "../atlasz-control-center/server.mjs";
import { tmp, rm } from "./helpers.mjs";
const { createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs");

const AGENT = { actor: { type: "AGENT", id: "E4" } }, CONSENT = { granted: true, by: "OWNER" };
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const call = (port, token, method, p, body) => new Promise((res, rej) => { const data = body ? JSON.stringify(body) : null; const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: "127.0.0.1:" + port, "x-atlasz-token": token, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } res({ status: r.statusCode, body: j }); }); }); q.on("error", rej); if (data) q.write(data); q.end(); });

test("hosted: no STT/TTS provider ships, so voice cannot start and is never live; agents get a counts-only status tool and cannot speak, listen or approve", async () => {
  const dir = tmp("vh-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const names = rt.tools.describe().map(t => t.name); assert.ok(names.includes("voice.status"));
    assert.deepEqual(names.filter(n => /^voice\./.test(n)), ["voice.status"], "the only voice tool agents have is status");
    const s = await rt.tools.invoke("voice.status", {}, AGENT); assert.equal(s.status, "OK"); assert.equal(s.result.voice.live, false); assert.equal(s.result.canApprove, false); assert.equal(s.result.providerMode, "NONE"); assert.match(s.result.voice.blocker, /EXTERNAL/);
    assert.equal((await rt.tools.invoke("voice.status", { tenantId: "X" }, AGENT)).status, "INVALID_ARGUMENTS");
    assert.throws(() => rt.voice.begin({ tenantId: "JOCI", consent: CONSENT, purpose: "briefing" }), /VOICE_BLOCKED_NO_PROVIDER/);
    const d = rt.dashboard().voice; assert.equal(d.live, false); assert.equal(d.canApprove, false); assert.equal(d.open, 0);
    rt.stop?.();
  } finally { rm(dir); }
});

test("hosted: Safe Mode gates voice at the runtime (a conversation cannot start while the system is in safe mode)", () => {
  const dir = tmp("vh2-");
  try {
    const rt = createRuntime({ dataDir: dir, retryBaseMs: 0, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    rt.safeMode.enter("TEST_VOICE_GATE", {});
    assert.throws(() => rt.voice.begin({ tenantId: "JOCI", consent: CONSENT, purpose: "briefing" }), /VOICE_GATED:SAFE_MODE/);
    rt.stop?.();
  } finally { rm(dir); }
});

test("Control Center: voice view is honest (BLOCKED, not live); owner reads and deletes mock-provider transcripts; wrong token refused; unreadable store reported and kept", async () => {
  const base = tmp("vc-cc-"), stateDir = path.join(base, "s"), cc = createControlCenterServer({ stateDir, configDir: path.join(base, "c"), port: await freePort() });
  const { port, token } = await cc.listen(), post = b => call(port, token, "POST", "/api/voice/action", b), file = path.join(stateDir, "memory", "voice-conversations.json");
  try {
    assert.equal((await call(port, "wrong", "GET", "/api/voice")).status, 401); assert.equal((await call(port, "wrong", "POST", "/api/voice/action", { op: "purge" })).status, 401);
    const v0 = (await call(port, token, "GET", "/api/voice")).body; assert.equal(v0.live, false); assert.match(v0.note, /BLOCKED/); assert.deepEqual(v0.conversations, []);
    const m = createMockVoiceProviders({ script: ["what is the status"] }), conv = createVoiceConversation({ session: createVoiceSession({ sttChain: [m.stt], ttsChain: [m.tts] }), file });
    const cv = conv.begin({ tenantId: "JOCI", consent: CONSENT, purpose: "briefing" }); await conv.turn(Buffer.from("a"), { conversationId: cv.id, tenantId: "JOCI" }); conv.end({ conversationId: cv.id, tenantId: "JOCI" });
    const v1 = (await call(port, token, "GET", "/api/voice")).body; assert.equal(v1.conversations.length, 1); assert.equal(v1.conversations[0].providerMode, "MOCK"); assert.equal(v1.live, false, "a mock transcript never makes voice live");
    const g = (await post({ op: "get", id: cv.id })).body.result; assert.equal(g.turns[0].intent, "STATUS");
    const mem = (await post({ op: "remember", id: cv.id, turn: 1 })).body.result; assert.equal(mem.text, "Voice note: what is the status"); assert.deepEqual(mem.tags, ["voice"]); assert.equal(mem.source.type, "OWNER"); assert.equal(mem.source.ref.conversationId, cv.id);
    assert.equal((await post({ op: "remember", id: cv.id, turn: 9 })).status, 400); assert.equal((await post({ op: "remember", id: "nope", turn: 1 })).status, 400);
    assert.equal((await call(port, token, "POST", "/api/observations/action", { op: "search", query: "status voice" })).body.result.results.length, 1, "the note is an ordinary, deletable observation");
    assert.equal((await post({ op: "get", id: "nope" })).status, 400); assert.equal((await post({ op: "launch" })).status, 400);
    assert.deepEqual((await post({ op: "delete", id: cv.id })).body.result, { deleted: true, id: cv.id }); assert.ok(!fs.readFileSync(file, "utf8").includes("what is the status"));
    assert.equal((await call(port, token, "GET", "/api/voice")).body.conversations.length, 0);
    fs.writeFileSync(file, "{broken"); const bad = (await call(port, token, "GET", "/api/voice")).body; assert.equal(bad.conversationStore, "UNREADABLE"); assert.equal(fs.readFileSync(file, "utf8"), "{broken");
    assert.equal((await post({ op: "purge" })).status, 400);
  } finally { await cc.close?.(); rm(base); }
});
