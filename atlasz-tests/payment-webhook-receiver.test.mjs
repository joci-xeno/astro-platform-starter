// Real loopback HTTP against the receive-only webhook endpoint, with signed FIXTURE events: raw-body signature, limits, methods, owner stop, idempotency. No external network, no real Stripe.
import test from "node:test"; import assert from "node:assert/strict"; import path from "node:path"; import http from "node:http"; import { createHmac } from "node:crypto";
import { createWebhookReceiver, WEBHOOK_PATH } from "../atlasz-addons/payment-webhook-receiver.mjs";
import { createPaymentEventLedger } from "../atlasz-addons/business/payment-events.mjs";
import { tmp, rm } from "./helpers.mjs";
const SECRET = "whsec_" + "receiver_fixture_0123456789abcdef", T = Math.floor(Date.now() / 1000);
const sig = (b, t = T, s = SECRET) => "t=" + t + ",v1=" + createHmac("sha256", s).update(t + "." + b).digest("hex");
const evt = (id, o = {}) => JSON.stringify({ id, type: "payment_intent.succeeded", livemode: true, created: T, data: { object: { object: "payment_intent", id: "pi_" + id, amount: 5000, currency: "usd", metadata: { invoice_id: "inv-1" } } }, ...o });
const post = (port, body, headers = {}, { method = "POST", url = WEBHOOK_PATH } = {}) => new Promise((resolve, reject) => { const r = http.request({ host: "127.0.0.1", port, path: url, method, headers: { "content-length": Buffer.byteLength(body ?? ""), ...headers } }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); }); r.on("error", e => resolve({ status: 0, error: e.code })); r.end(body); });
const rig = async (o = {}) => { const d = tmp("whr-"), L = createPaymentEventLedger({ dir: path.join(d, "pe"), secretFor: () => o.noSecret ? null : SECRET }); let stopped = false; const rx = createWebhookReceiver({ ingest: a => L.ingest(a), isStopped: () => stopped, maxBytes: 4096, readTimeoutMs: 400, ...o }); const addr = await rx.start(0); return { d, L, rx, port: addr.port, stop: v => { stopped = v; }, done: async () => { await rx.stop(); rm(d); } }; };

test("a correctly signed event is recorded once; a replay is acknowledged without a second effect", async () => {
  const x = await rig(); try { const b = evt("evt_1"); const r = await post(x.port, b, { "stripe-signature": sig(b) }); assert.equal(r.status, 200); assert.equal(x.L.listPayments().length, 1); assert.equal(x.L.payment("pi_evt_1").state, "PAYMENT_SUCCEEDED");
    assert.equal((await post(x.port, b, { "stripe-signature": sig(b) })).status, 200); assert.equal(x.L.summary().eventsProcessed, 1); assert.equal(x.L.listPayments().length, 1);
    const c = evt("evt_1", { livemode: true, data: { object: { object: "payment_intent", id: "pi_evt_1", amount: 999999, currency: "usd" } } }); assert.equal((await post(x.port, c, { "stripe-signature": sig(c) })).status, 409, "same id, different body = conflict"); assert.equal(x.L.payment("pi_evt_1").amountMinor, 5000);
  } finally { await x.done(); }
});
test("forged, tampered, missing-signature, wrong-secret and malformed requests change nothing", async () => {
  const x = await rig(); try { const b = evt("evt_2");
    assert.equal((await post(x.port, b, {})).status, 401); assert.equal((await post(x.port, b, { "stripe-signature": sig(b, T, "whsec_attacker_attacker_attacker_0123") })).status, 401); assert.equal((await post(x.port, b.replace("5000", "1"), { "stripe-signature": sig(b) })).status, 401);
    assert.equal((await post(x.port, b, { "stripe-signature": sig(b, T - 4000) })).status, 401); const bad = "{not json"; assert.equal((await post(x.port, bad, { "stripe-signature": sig(bad) })).status, 400); assert.equal(x.L.listPayments().length, 0); assert.equal(x.L.verify().ok, true);
  } finally { await x.done(); }
});
test("only POST on the exact path; oversize and slow bodies are cut off; owner stop and missing secret answer 503 and record nothing", async () => {
  const x = await rig(); try { const b = evt("evt_3");
    assert.equal((await post(x.port, "", {}, { method: "GET" })).status, 405); assert.equal((await post(x.port, b, { "stripe-signature": sig(b) }, { url: "/other" })).status, 404); assert.equal((await post(x.port, b, { "stripe-signature": sig(b) }, { url: WEBHOOK_PATH + "?x=1" })).status, 200);
    const big = "x".repeat(5000); assert.ok([413, 0].includes((await post(x.port, big, { "stripe-signature": sig(big) })).status));
    const slow = await new Promise(resolve => { const r = http.request({ host: "127.0.0.1", port: x.port, path: WEBHOOK_PATH, method: "POST", headers: { "content-length": 100 } }, res => resolve(res.statusCode)); r.on("error", () => resolve(0)); r.write("{"); }); assert.ok([408, 0].includes(slow));
    const n0 = x.L.listPayments().length; x.stop(true); const c = evt("evt_4"); assert.equal((await post(x.port, c, { "stripe-signature": sig(c) })).status, 503); assert.equal(x.L.listPayments().length, n0); x.stop(false);
  } finally { await x.done(); }
  const y = await rig({ noSecret: true }); try { const b = evt("evt_5"); assert.equal((await post(y.port, b, { "stripe-signature": sig(b) })).status, 503); assert.equal(y.L.listPayments().length, 0); } finally { await y.done(); }
});
test("the receiver does not start by itself, binds loopback by default, and cannot be started twice", async () => {
  const rx = createWebhookReceiver({ ingest: () => ({ ok: true }) }); const a = await rx.start(0); assert.equal(a.address, "127.0.0.1"); await assert.rejects(() => rx.start(0), /ALREADY_STARTED/); await rx.stop(); assert.throws(() => createWebhookReceiver({}), /INGEST_REQUIRED/);
});
