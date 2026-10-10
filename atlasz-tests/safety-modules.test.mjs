import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createSecretVault, generateVaultKey } from "../atlasz-addons/secret-vault.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { createWatchdog } from "../atlasz-addons/watchdog.mjs";
import { runStartupSelfCheck } from "../atlasz-addons/startup-self-check.mjs";
import { createDurableQueue } from "../atlasz-addons/durable-queue.mjs";
import { tmp, rm } from "./helpers.mjs";

function owner() {
  const k = generateOwnerKeyPair();
  const auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  return { auth, ap: (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject }) };
}

// ---------------- Secret Vault ----------------
test("vault: set needs signed owner approval; value is encrypted at rest and never in audit", () => {
  const d = tmp(), { auth, ap } = owner(), key = generateVaultKey();
  try {
    const v = createSecretVault({ dir: d, keyB64: key, ownerAuth: auth });
    assert.throws(() => v.set("STRIPE", "fixture-secret-value-0001"), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => v.set("STRIPE", "fixture-secret-value-0001", { ownerApproval: true }), /OWNER_APPROVAL_REQUIRED/);
    assert.throws(() => v.set("STRIPE", "fixture-secret-value-0001", { ownerApproval: ap("VAULT_SET", "OTHER") }), /OWNER_APPROVAL_REQUIRED/);
    v.set("STRIPE", "fixture-secret-value-0001", { ownerApproval: ap("VAULT_SET", "STRIPE") });
    assert.equal(v.get("STRIPE", { purpose: "test" }), "fixture-secret-value-0001");
    const disk = fs.readFileSync(path.join(d, "vault.enc.json"), "utf8") + fs.readFileSync(path.join(d, "vault-audit.jsonl"), "utf8");
    assert.equal(disk.includes("fixture-secret-value-0001"), false);
    assert.deepEqual(v.list(), ["STRIPE"]);
    assert.equal(v.auditVerify().ok ?? true, true);
  } finally { rm(d); }
});
test("vault: locked without key; wrong key / tampered entry / swapped entries are detected; purpose required", () => {
  const d = tmp(), { auth, ap } = owner(), key = generateVaultKey();
  try {
    const v = createSecretVault({ dir: d, keyB64: key, ownerAuth: auth });
    v.set("A", "value-aaaaaa", { ownerApproval: ap("VAULT_SET", "A") });
    v.set("B", "value-bbbbbb", { ownerApproval: ap("VAULT_SET", "B") });
    assert.throws(() => v.get("A"), /PURPOSE_REQUIRED/);
    const locked = createSecretVault({ dir: d, keyB64: null, ownerAuth: auth });
    assert.equal(locked.status().state, "LOCKED");
    assert.throws(() => locked.get("A", { purpose: "x" }), /VAULT_LOCKED/);
    const wrong = createSecretVault({ dir: d, keyB64: generateVaultKey(), ownerAuth: auth });
    assert.equal(wrong.status().state, "LOCKED");      // M1: the key is verified at start, so a wrong key means LOCKED (it used to open and fail per entry)
    assert.throws(() => wrong.get("A", { purpose: "x" }), /VAULT_LOCKED_NO_KEY|TAMPERED_OR_WRONG_KEY/);
    const f = path.join(d, "vault.enc.json"), s = JSON.parse(fs.readFileSync(f, "utf8"));
    [s.entries.A, s.entries.B] = [s.entries.B, s.entries.A];            // swap ciphertexts between names
    fs.writeFileSync(f, JSON.stringify(s));
    const swapped = createSecretVault({ dir: d, keyB64: key, ownerAuth: auth });
    assert.throws(() => swapped.get("A", { purpose: "x" }), /TAMPERED_OR_WRONG_KEY/);
  } finally { rm(d); }
});
test("vault: redact scrubs known secret values; delete needs approval; rotate is recorded", () => {
  const d = tmp(), { auth, ap } = owner();
  try {
    const v = createSecretVault({ dir: d, keyB64: generateVaultKey(), ownerAuth: auth });
    v.set("K", "topsecret-123", { ownerApproval: ap("VAULT_SET", "K") });
    assert.equal(v.redact("error calling api with topsecret-123 failed"), "error calling api with [REDACTED:K] failed");
    assert.equal(v.set("K", "topsecret-456", { ownerApproval: ap("VAULT_SET", "K") }).rotated, true);
    assert.throws(() => v.remove("K", { ownerApproval: ap("VAULT_SET", "K") }), /OWNER_APPROVAL_REQUIRED/);
    assert.equal(v.remove("K", { ownerApproval: ap("VAULT_DELETE", "K") }), true);
    assert.equal(v.has("K"), false);
    assert.throws(() => v.set("bad name!", "x", { ownerApproval: ap("VAULT_SET", "bad name!") }), /INVALID_NAME/);
  } finally { rm(d); }
});

// ---------------- Safe Mode ----------------
test("safe mode: system can enter; external and write actions blocked, reads allowed; exit needs signed approval + passing self-check", () => {
  const d = tmp(), { auth, ap } = owner();
  try {
    const sm = createSafeMode({ statePath: path.join(d, "sm.json"), auditPath: path.join(d, "sm-audit.jsonl"), ownerAuth: auth });
    assert.equal(sm.gate({ external: true }).allowed, true);
    sm.enter("TEST");
    assert.equal(sm.gate({ external: true }).allowed, false);
    assert.equal(sm.gate({ write: true }).allowed, false);
    assert.equal(sm.gate({}).allowed, true);
    assert.throws(() => sm.exit({ ownerApproval: ap("SAFE_MODE_EXIT", "NORMAL"), selfCheck: { level: "FAIL" } }), /SELF_CHECK_NOT_PASSING/);
    assert.throws(() => sm.exit({ ownerApproval: true, selfCheck: { level: "OK" } }), /SAFE_MODE_EXIT_DENIED/);
    assert.throws(() => sm.exit({ ownerApproval: ap("SAFE_MODE_EXIT", "WRONG"), selfCheck: { level: "OK" } }), /SAFE_MODE_EXIT_DENIED/);
    assert.equal(sm.status().mode, "SAFE_MODE");
    // persists across restart
    assert.equal(createSafeMode({ statePath: path.join(d, "sm.json"), auditPath: path.join(d, "sm-audit.jsonl"), ownerAuth: auth }).status().mode, "SAFE_MODE");
    sm.exit({ ownerApproval: ap("SAFE_MODE_EXIT", "NORMAL"), selfCheck: { level: "DEGRADED" } });
    assert.equal(sm.status().mode, "NORMAL");
  } finally { rm(d); }
});
test("safe mode: crash loop (3 boots in window without healthy mark) enters Safe Mode; healthy mark clears the counter", () => {
  const d = tmp(); let t = 1000;
  try {
    const mk = () => createSafeMode({ statePath: path.join(d, "sm.json"), now: () => t });
    mk().recordBoot(); t += 1000;
    const s2 = mk(); s2.recordBoot(); s2.markHealthy(); t += 1000;                 // healthy: counter cleared
    assert.equal(mk().recordBoot().mode, "NORMAL");
    t += 1000; assert.equal(mk().recordBoot().mode, "NORMAL");
    t += 1000; assert.equal(mk().recordBoot().mode, "SAFE_MODE");                  // 3rd rapid boot
    assert.equal(mk().status().reason, "CRASH_LOOP");
    t += 10 * 60 * 1000;                                                           // old boots age out but SAFE stays until owner exits
    assert.equal(mk().status().mode, "SAFE_MODE");
  } finally { rm(d); }
});
test("safe mode: unreadable state file fails SAFE, not open", () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, "sm.json"), "{not json");
    assert.equal(createSafeMode({ statePath: path.join(d, "sm.json") }).status().mode, "SAFE_MODE");
  } finally { rm(d); }
});

// ---------------- Watchdog ----------------
test("watchdog: stale heartbeat, failing probe and HANGING probe are unhealthy; critical escalates after N; recovery reported", async () => {
  let t = 0, hang = false, bad = false; const esc = [];
  const w = createWatchdog({ now: () => t, probeTimeoutMs: 20, failuresToEscalate: 2, onEscalate: e => esc.push(e.id) });
  w.register({ id: "sched", critical: true, heartbeatMaxAgeMs: 100 });
  w.register({ id: "disk", probe: async () => (bad ? { ok: false, detail: "FULL" } : { ok: true }) });
  w.register({ id: "net", probe: () => (hang ? new Promise(() => {}) : { ok: true }) });
  w.beat("sched"); await w.tick();
  assert.equal(w.status().overall, "HEALTHY");
  t = 500; bad = true; hang = true;
  await w.tick();
  let s = Object.fromEntries(w.status().components.map(c => [c.id, c]));
  assert.equal(s.sched.detail, "HEARTBEAT_STALE"); assert.equal(s.disk.detail, "FULL"); assert.equal(s.net.detail, "PROBE_TIMEOUT");
  assert.deepEqual(esc, []);                       // 1 failure only
  await w.tick();
  assert.deepEqual(esc, ["sched"]);                // critical, 2 failures, escalated exactly once
  await w.tick(); assert.deepEqual(esc, ["sched"]);
  bad = false; hang = false; w.beat("sched");
  await w.tick();
  assert.equal(w.status().overall, "HEALTHY");
});

// ---------------- Startup self-check ----------------
test("self-check: clean dir is OK/DEGRADED(no owner key); corrupt journal / tampered audit / wrong topology FAIL", () => {
  const d = tmp(), auth = createOwnerAuth({});
  try {
    const r = runStartupSelfCheck({ stateDir: d, ownerAuth: auth, expectedAgents: { search: 5, execution: 25 } });
    assert.equal(r.level, "DEGRADED"); assert.equal(r.ok, true);
    assert.equal(r.checks.find(c => c.id === "owner-auth").status, "DEGRADED");
    assert.equal(runStartupSelfCheck({ stateDir: d, expectedAgents: { search: 4, execution: 26 } }).level, "FAIL");
    const q = createDurableQueue({ dir: path.join(d, "queue") }); q.enqueue({ id: "a" }); q.enqueue({ id: "b" });
    assert.equal(runStartupSelfCheck({ stateDir: d }).level, "OK");
    const jp = path.join(d, "queue", "queue-journal.jsonl"), lines = fs.readFileSync(jp, "utf8").split("\n");
    lines[0] = lines[0].replace('"id":"a"', '"id":"z"'); fs.writeFileSync(jp, lines.join("\n"));
    const bad = runStartupSelfCheck({ stateDir: d });
    assert.equal(bad.level, "FAIL"); assert.equal(bad.checks.find(c => c.id === "queue-journal").status, "FAIL");
  } finally { rm(d); }
});
test("self-check: unreadable runtime state and missing state dir FAIL", () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, "atlasz-state.json"), "garbage");
    assert.equal(runStartupSelfCheck({ stateDir: d }).level, "FAIL");
    assert.equal(runStartupSelfCheck({}).level, "FAIL");
  } finally { rm(d); }
});
