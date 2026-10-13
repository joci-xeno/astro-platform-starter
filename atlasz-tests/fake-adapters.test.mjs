// ATL-WRK-0787 – tests for the deterministic fake model adapter family. Fixture-only: proves the adapters are deterministic, network-free,
// always FIXTURE-marked, reusable with the real plumbing (reasoning-common, provider-adapters, model-gateway) and can never become LIVE evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "../atlasz-addons/reasoning-common.mjs";
import { createCloudAdapter } from "../atlasz-addons/provider-adapters.mjs";
import {
  createScriptedAdapter, createMirrorAdapter, createFaultAdapter, createSlowAdapter, createFakeFetch, createFakeProvider, FAULTS,
  isFixture, markFixture, acceptAsLiveEvidence, evidenceLabel, installNetworkGuard, validateGoldCorpus, FIXTURE_FAMILY_PREFIX
} from "./support/fake-model-adapters.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "..");
const REQ = { role: "tester", prompt: "Mennyi két meg kettő?", seed: 7 };

test("every adapter kind answers FIXTURE-marked with a fixture- family; none is ever live", async () => {
  const adapters = [createScriptedAdapter({ steps: ["négy"] }), createMirrorAdapter(), createSlowAdapter(createMirrorAdapter(), { delayMs: 1 }), createFaultAdapter(createMirrorAdapter(), [null])];
  for (const a of adapters) {
    const r = await a(REQ);
    assert.equal(r.fixture, true); assert.equal(r.live, false); assert.equal(r.evidenceState, "FIXTURE");
    assert.ok(r.family.startsWith(FIXTURE_FAMILY_PREFIX), r.family); assert.ok(isFixture(r)); assert.equal(evidenceLabel(r), "FIXTURE");
    assert.equal(a.fixture, true);
  }
});
test("a caller-supplied family name is still forced into the fixture- namespace", async () => {
  const r = await createScriptedAdapter({ family: "openai", steps: ["x"] })(REQ);
  assert.equal(r.family, "fixture-openai");
  assert.equal((await createMirrorAdapter({ family: "anthropic" })(REQ)).family, "fixture-anthropic");
});
test("determinism: same script + same requests -> identical outputs and identical call records", async () => {
  const run = async () => { const a = createScriptedAdapter({ steps: ["egy", "kettő", r => "mirror:" + r.seed], rules: [{ match: /titok/, reply: "szabály" }] }); const out = []; for (const p of ["a", "b titok", "c", "d"]) out.push((await a({ ...REQ, prompt: p })).text); return { out, calls: a.calls }; };
  const a = await run(), b = await run();
  assert.deepEqual(a.out, ["egy", "szabály", "kettő", "mirror:7"]); assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a.calls[0]).sort(), ["kind", "n", "promptSha", "role", "seed"], "call records hold a hash, not the prompt");
});
test("scripted exhaustion is explicit: throws by default, repeat-last only on request", async () => {
  const a = createScriptedAdapter({ steps: ["csak egy"] }); await a(REQ); await assert.rejects(() => a(REQ), /SCRIPT_EXHAUSTED/);
  const b = createScriptedAdapter({ steps: ["x"], onExhausted: "repeat-last" }); await b(REQ); assert.equal((await b(REQ)).text, "x");
});
test("mirror echoes exactly the prompt it was given (and a transform when supplied)", async () => {
  assert.equal((await createMirrorAdapter()(REQ)).text, REQ.prompt);
  assert.equal((await createMirrorAdapter({ transform: s => s.toUpperCase() })(REQ)).text, REQ.prompt.toUpperCase());
});
test("fault injection: every documented fault kind is reachable and reaches callModel as a clean, secret-free failure", async () => {
  const expected = { throw: "MODEL_ERROR", "bad-response": "MODEL_BAD_RESPONSE", "no-text": "MODEL_BAD_RESPONSE", "missing-family": "MODEL_FAMILY_MISSING_OR_INVALID", "bad-family": "MODEL_FAMILY_MISSING_OR_INVALID", oversize: "MODEL_OUTPUT_OVERSIZED", hang: "MODEL_TIMEOUT" };
  for (const [kind, reason] of Object.entries(expected)) {
    const r = await callModel(createFaultAdapter(createMirrorAdapter(), [kind]), REQ, { timeoutMs: 40 });
    assert.equal(r.ok, false, kind); assert.equal(r.reason, reason, kind);
  }
  const leak = await callModel(createFaultAdapter(createMirrorAdapter(), ["throw-secret"]), REQ);
  assert.equal(leak.reason, "MODEL_ERROR"); assert.ok(!JSON.stringify(leak).includes("fixture-secret-0123456789abcdef"), "secret-shaped text must be scrubbed by the plumbing: " + JSON.stringify(leak));
  const empty = await callModel(createFaultAdapter(createMirrorAdapter(), ["empty"]), REQ); assert.ok(empty.ok === true || typeof empty.reason === "string");
  assert.ok(FAULTS.every(f => f in expected || ["throw-secret", "injection", "empty"].includes(f)), "no fault kind without a test");
});
test("fault plans: by index, by 'at', by 'every'; an unknown kind fails loudly", async () => {
  const a = createFaultAdapter(createMirrorAdapter(), [null, "throw", null]); await a(REQ); await assert.rejects(() => a(REQ), /FAKE_PROVIDER_DOWN/); assert.equal((await a(REQ)).text, REQ.prompt);
  const b = createFaultAdapter(createMirrorAdapter(), { every: 3, kind: "throw" }); await b(REQ); await b(REQ); await assert.rejects(() => b(REQ));
  const c = createFaultAdapter(createMirrorAdapter(), { at: [1], kind: "bad-response" }); await c(REQ); assert.equal(await c(REQ), null);
  await assert.rejects(() => createFaultAdapter(createMirrorAdapter(), ["bogus"])(REQ), /UNKNOWN_FAULT_KIND/);
});
test("injection fault output is untrusted data: callModel flags it and it stays FIXTURE", async () => {
  const r = await callModel(createFaultAdapter(createMirrorAdapter(), ["injection"]), REQ);
  assert.equal(r.ok, true); assert.equal(r.screen.injection, true); assert.ok(r.family.startsWith(FIXTURE_FAMILY_PREFIX));
});
test("slow adapter delays by the configured time and supports virtual time", async () => {
  const t0 = Date.now(); await createSlowAdapter(createMirrorAdapter(), { delayMs: 60 })(REQ); assert.ok(Date.now() - t0 >= 50);
  let slept = 0; await createSlowAdapter(createMirrorAdapter(), { delayMs: 5000, sleep: async ms => { slept += ms; } })(REQ); assert.equal(slept, 5000);
  const r = await callModel(createSlowAdapter(createMirrorAdapter(), { delayMs: 300 }), REQ, { timeoutMs: 40 }); assert.equal(r.reason, "MODEL_TIMEOUT");
});
test("the family survives the real plumbing (callModel), so the mark reaches downstream records", async () => {
  const r = await callModel(createScriptedAdapter({ steps: ["válasz"] }), REQ);
  assert.equal(r.ok, true); assert.ok(r.family.startsWith(FIXTURE_FAMILY_PREFIX)); assert.ok(isFixture(r), "callModel result is recognised as fixture via family");
  assert.deepEqual(acceptAsLiveEvidence(r), { ok: false, reason: "FIXTURE_NOT_LIVE" });
});
test("FIXTURE can never be accepted as live evidence – not even relabelled, copied, nested or in an array", async () => {
  const fx = await createScriptedAdapter({ steps: ["x"] })(REQ);
  assert.equal(acceptAsLiveEvidence(fx).reason, "FIXTURE_NOT_LIVE");
  const relabelled = { ...fx, fixture: false, evidenceState: "LIVE", live: true };                       // flags flipped, family left
  assert.equal(acceptAsLiveEvidence(relabelled).reason, "FIXTURE_NOT_LIVE", "family prefix still marks it");
  const stripped = { text: fx.text, family: "gpt-live", evidenceState: "LIVE", live: true, nested: { source: fx } };
  assert.equal(acceptAsLiveEvidence(stripped).reason, "FIXTURE_NOT_LIVE", "nested fixture taints the record");
  assert.equal(acceptAsLiveEvidence([{ ok: 1 }, fx]).reason, "FIXTURE_NOT_LIVE", "an array holding a fixture is tainted too");
  assert.equal(acceptAsLiveEvidence({ list: [1, 2, { deep: { deeper: fx } }], evidenceState: "LIVE", live: true }).reason, "FIXTURE_NOT_LIVE");
  assert.equal(acceptAsLiveEvidence(null).reason, "NOT_A_RECORD");
  assert.equal(acceptAsLiveEvidence({ evidenceState: "TESTED" }).reason, "NOT_MARKED_LIVE", "unmarked records are not live by default");
  assert.ok(markFixture({ a: 1 }).fixture && Object.isFrozen(markFixture({})), "marks are frozen");
  assert.throws(() => { "use strict"; const m = markFixture({}); m.fixture = false; });
});
test("fake providers must use the fixture- id namespace and honour the provider contract", async () => {
  assert.throws(() => createFakeProvider({ id: "openai" }), /FIXTURE_ID_REQUIRED/);
  const p = createFakeProvider({ id: "fixture-p1", reply: "szia" }); const out = await p.invoke({ prompt: "x" });
  assert.equal(out.output, "szia"); assert.equal(out.costUsd, 0); assert.ok(isFixture(p)); assert.deepEqual(await p.probe(), { ok: true });
  assert.equal((await createFakeProvider({ id: "fixture-p2", fail: true }).probe()).ok, false);
});
test("fake fetch drives the REAL provider-adapters wire code for all three wire styles without network or real key", async () => {
  const KEY = "fixture-key-" + "k".repeat(20);
  const guard = installNetworkGuard();
  try {
    for (const [providerId, style] of [["openai", "openai-compat"], ["anthropic", "anthropic"], ["google", "gemini"]]) {
      const f = createFakeFetch({ style, reply: "helló", usage: [11, 4] });
      const a = createCloudAdapter({ providerId, credentialRef: "REF", getCredential: () => KEY, fetchImpl: f });
      const r = await a.invoke({ model: "m-1", prompt: "szia" });
      assert.equal(r.output, "helló"); assert.equal(r.tokensIn, 11); assert.equal(r.tokensOut, 4); assert.equal(r.costUsd, null, "unknown price stays null, never 0");
      assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.startsWith("https://")); assert.equal(f.calls[0].authHeaderPresent, true); assert.ok(isFixture(f));
      assert.ok(!JSON.stringify(f.calls).includes(KEY), "call records keep a body hash, never the key or body");
    }
    const bad = createFakeFetch({ status: 401 });
    await assert.rejects(() => createCloudAdapter({ providerId: "openai", credentialRef: "R", getCredential: () => KEY, fetchImpl: bad }).invoke({ model: "m", prompt: "q" }), e => e.message === "HTTP_401");
    await assert.rejects(() => createCloudAdapter({ providerId: "openai", credentialRef: "R", getCredential: () => KEY, fetchImpl: createFakeFetch({ raw: { choices: [] } }) }).invoke({ model: "m", prompt: "q" }), /PROVIDER_RESPONSE_SHAPE/);
  } finally { guard.restore(); }
  assert.deepEqual(guard.hits, [], "no network primitive was touched");
});
test("network guard really blocks fetch/https/http while installed, and restores afterwards", async () => {
  const saved = globalThis.fetch, g = installNetworkGuard();
  await assert.rejects(async () => globalThis.fetch("https://example.invalid/"), /NETWORK_FORBIDDEN_IN_FIXTURE_TESTS/);
  const https = (await import("node:https")).default; assert.throws(() => https.request({ host: "example.invalid" }), /NETWORK_FORBIDDEN/);
  g.restore(); assert.equal(globalThis.fetch, saved); assert.equal(g.hits.length, 2);
});
test("all adapter kinds work without any network primitive", async () => {
  const g = installNetworkGuard();
  try { for (const a of [createScriptedAdapter({ steps: ["a"] }), createMirrorAdapter(), createFaultAdapter(createMirrorAdapter(), [null]), createSlowAdapter(createMirrorAdapter(), { delayMs: 1 })]) await callModel(a, REQ); }
  finally { g.restore(); } assert.deepEqual(g.hits, []);
});
test("isolation: no runtime file imports the test-only fake adapters, and the module reads no env/credentials", () => {
  const dirs = ["atlasz-addons", "atlasz-control-center"].map(d => path.join(root, d)).filter(d => fs.existsSync(d)), offenders = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); } else if (/\.(mjs|js|ts)$/.test(e.name) && /fake-model-adapters|hu-gold-corpus/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(root, p)); } };
  dirs.forEach(walk); assert.deepEqual(offenders, []);
  const src = fs.readFileSync(path.join(here, "support/fake-model-adapters.mjs"), "utf8");
  assert.ok(!/process\.env|Date\.now|Math\.random|crypto\.random/.test(src), "no env, clock or randomness in the fake family");
});
test("Hungarian gold corpus skeleton: valid, FIXTURE-marked, honestly UNREVIEWED, and covers every category", () => {
  const c = JSON.parse(fs.readFileSync(path.join(here, "fixtures/hu-gold-corpus.json"), "utf8")), v = validateGoldCorpus(c);
  assert.deepEqual(v.errors, []); assert.equal(v.ok, true); assert.ok(v.count >= 30, "count " + v.count);
  for (const cat of ["szándék", "entitás/szám/dátum", "kétértelműség", "érzelmi jelzés", "injekció/adat≠utasítás", "hamis belső élet állítás", "hu-en váltás", "ékezet nélküli magyar", "megszólítás/regiszter", "jóváhagyás-megkerülés"]) assert.ok(v.categories.includes(cat), cat);
  assert.match(c.honesty, /NEM ellenőrizte/); assert.equal(c.items.every(i => i.annotation_status === "UNREVIEWED"), true);
  assert.ok(isFixture(c), "the corpus itself is fixture-marked"); assert.deepEqual(acceptAsLiveEvidence(c), { ok: false, reason: "FIXTURE_NOT_LIVE" });
  assert.ok(c.items.some(i => /[őűáéíóöüú]/i.test(i.input_hu)), "real diacritics present");
});
test("corpus validator rejects duplicates, bad ids, missing marks and overclaiming status", () => {
  const good = JSON.parse(fs.readFileSync(path.join(here, "fixtures/hu-gold-corpus.json"), "utf8"));
  const dup = structuredClone(good); dup.items.push({ ...dup.items[0] }); assert.ok(validateGoldCorpus(dup).errors.some(e => e.startsWith("DUP_ID")));
  const bad = structuredClone(good); bad.items[0].id = "X1"; assert.ok(validateGoldCorpus(bad).errors.some(e => e.startsWith("BAD_ID")));
  const over = structuredClone(good); over.status = "VERIFIED"; assert.ok(validateGoldCorpus(over).errors.includes("STATUS_MUST_BE_SKELETON_UNTIL_OWNER_REVIEW"));
  const unmarked = structuredClone(good); unmarked.fixture = false; assert.ok(validateGoldCorpus(unmarked).errors.includes("CORPUS_MUST_BE_FIXTURE_MARKED"));
  const rev = structuredClone(good); rev.items[0].annotation_status = "REVIEWED"; assert.ok(validateGoldCorpus(rev).errors.some(e => e.startsWith("ANNOTATION")));
  assert.equal(validateGoldCorpus(null).ok, false);
});
