// TEST FAKES: every provider here is a fake that exists only in this file. Nothing is LIVE in the product from these.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createCircuitBreaker, createProviderResilience } from "../atlasz-addons/provider-resilience.mjs";
import { createFinancialLedger } from "../atlasz-addons/financial-ledger.mjs";
import { tmp, rm } from "./helpers.mjs";

const open = () => ({ allowed: true });
const fake = (id, o = {}) => ({ id, family: o.family ?? id, costClass: o.costClass ?? "FREE", capabilities: o.capabilities ?? ["chat", "judge"], probe: o.probe ?? (async () => ({ ok: true })), invoke: o.invoke ?? (async () => ({ output: "from " + id, tokensIn: 10, tokensOut: 5 })) });

test("circuit breaker: opens after N failures, half-opens after cooldown, closes on success, re-opens on a failed trial", () => {
  let t = 0; const b = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, clock: () => t });
  b.failure(); assert.equal(b.state(), "CLOSED"); b.failure(); assert.equal(b.state(), "OPEN"); assert.equal(b.allow(), false);
  t = 1000; assert.equal(b.state(), "HALF_OPEN"); assert.equal(b.allow(), true); b.failure(); assert.equal(b.state(), "OPEN");
  t = 2100; assert.equal(b.state(), "HALF_OPEN"); b.success(); assert.equal(b.state(), "CLOSED");
});
test("nothing is usable until OUR probe passes; a provider cannot declare itself LIVE", async () => {
  const r = createProviderResilience({ gate: open }); r.register({ ...fake("a"), tested: true, probeEvidence: { probeId: "x", outcome: "PASS", at: "now", target: "a" } });
  assert.equal(r.health()[0].state, "CONNECTED_UNTESTED"); assert.equal((await r.invoke({ capability: "chat" })).reason, "NO_ELIGIBLE_PROVIDER");
  assert.deepEqual(await r.probeAll(), { a: "PASS" }); assert.equal(r.health()[0].state, "LIVE"); assert.equal((await r.invoke({ capability: "chat" })).providerId, "a");
});
test("fallback on failure, breaker isolates the bad provider, and recovery after cooldown + probe", async () => {
  let t = 0, bad = true; const r = createProviderResilience({ gate: open, clock: () => t, breaker: { failureThreshold: 2, cooldownMs: 500 } });
  r.register(fake("primary", { invoke: async () => { if (bad) throw new Error("503"); return { output: "p" }; } })); r.register(fake("backup", { costClass: "FREE" }));
  await r.probeAll();
  for (let i = 0; i < 2; i++) { const x = await r.invoke({ capability: "chat" }); assert.equal(x.providerId, i === 0 ? "primary" === x.providerId ? "primary" : "backup" : x.providerId); }
  const x = await r.invoke({ capability: "chat" }); assert.equal(x.ok, true); assert.equal(x.providerId, "backup");
  assert.ok(r.health().find(h => h.id === "primary").state.startsWith("DEGRADED")); assert.ok(x.skipped.some(s => s.why === "BREAKER_OPEN") || x.attempts.length === 0);
  bad = false; t = 600; await r.probeAll(); assert.equal(r.health().find(h => h.id === "primary").state, "LIVE");
});
test("no-spend default: paid providers are skipped without a budget; with a budget the cheapest eligible is used and cost goes to the ledger with evidence", async () => {
  const d = tmp("pr-"); const ledger = createFinancialLedger({ dir: d });
  try {
    const r = createProviderResilience({ gate: open, ledger });
    r.register(fake("paid", { costClass: "LOW", invoke: async () => ({ output: "ok", costUsd: 0.02, tokensIn: 100, tokensOut: 50, providerRef: "req_1" }) })); await r.probeAll();
    const none = await r.invoke({ capability: "chat" }); assert.equal(none.ok, false); assert.deepEqual(none.skipped, [{ id: "paid", why: "NEEDS_SPEND_APPROVAL" }]);
    const ok = await r.invoke({ capability: "chat", budgetUsd: 1, estimateCostUsd: 0.05, jobId: "j1" }); assert.equal(ok.ok, true);
    const s = ledger.summary(); assert.equal(s.costs.byProvider.paid, 0.02); assert.equal(s.costs.tokensIn, 100); assert.equal(s.costs.byJob.j1, 0.02);
  } finally { rm(d); }
});
test("kill switch blocks dispatch; independent judge needs a different provider FAMILY, else it says it is not independent", async () => {
  let stopped = false; const r = createProviderResilience({ gate: () => (stopped ? { allowed: false, reason: "PAUSE_ALL" } : { allowed: true }) });
  r.register(fake("m1", { family: "famA" })); r.register(fake("m2", { family: "famA" })); await r.probeAll();
  assert.equal((await r.judge({ workerProviderId: "m1", prompt: "check" })).independent, false);           // same family only
  r.register(fake("j1", { family: "famB" })); await r.probeAll();
  const j = await r.judge({ workerProviderId: "m1", prompt: "check" }); assert.equal(j.independent, true); assert.equal(j.judgeProvider, "j1");
  stopped = true; await assert.rejects(r.invoke({ capability: "chat" }), /DISPATCH_BLOCKED_BY_OWNER_STOP/);
});
