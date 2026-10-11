// ATLASZ named security E2E gate suite (23-point item 22). Twelve gates; each one IMPORTS the real modules and exercises them in-process with synthetic data
// (synthetic owner key pair, synthetic credential, fake fetch that never touches the network, temporary folders). No network, no spending, no real credential.
//
//   G01 secrets never reach agents          vault + credential broker: the agent gets a redacted answer; secret absent from response, audit, summary, grant file
//   G02 deny-by-default tool policy         agent-tool-policy: unknown tool / unknown role / garbage values / pcc.* hard floor -> DENY
//   G03 kill switch blocks everything       emergency-stop PAUSE_ALL (owner-signed) blocks gate, broker, egress, quarantine release, release acceptance; resume needs "RESUME"; tampered state -> PAUSE_ALL
//   G04 approvals single-use                owner-auth replay (same instance and a second instance sharing the nonce store), subject binding, bare booleans
//   G05 audit chain tamper detected         audit-chain edit / delete / reorder detected; a tampered egress policy log yields no policy
//   G06 egress deny-by-default              egress-policy: no policy -> deny; host tricks, userinfo, numeric IP, private DNS answer, cross-host redirect -> deny; loopback only 127.0.0.1
//   G07 quarantine never executes           quarantine: stored read-only without exec bits, no process-spawning import, disguised executable + zip-slip flagged, release needs approval
//   G08 memory classification isolation     memory-store: CONFIDENTIAL invisible to a PERSONAL reader; SECRET class and credential-shaped text refused
//   G09 unsigned update refused             release-signing: unsigned, unknown key, altered file, extra file, replay, downgrade refused; anchors need owner approval
//   G10 simulated money never revenue       paper-trader is SIM-USD / realMoney:false and refuses live trading; ledgers count only confirmed+evidenced PAID
//   G11 exactly 30 agents                   roster, agent-id grammar and an instantiated runtime: 5 SEARCH + 25 EXECUTION
//   G12 bind address stays loopback         control center server binds 127.0.0.1 and refuses foreign Host headers and token-less calls
//
// Status honesty: a PASS means "these checks ran against the real local modules and held" (TESTED, local, in-process). It is not runtime/production evidence (not LIVE), and it
// does not prove the modules are wired into every path (CONNECTED is a separate question - e.g. egress-policy and quarantine are not wired into the runtime yet; G06/G07
// test the engines). G12 covers the LOCAL control center only: the cloud runtime (atlasz-runtime/supervisor-safe.mjs) binds 0.0.0.0 by design for Railway and relies on its
// token-authenticated handler instead; the gate reports that fact as evidence rather than hiding it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "./owner-auth.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "..");
export const SUITE = "ATLASZ-SECURITY-GATES/v1";
const SYNTHETIC_SECRET = "synthetic-gate-credential-" + "Q7".repeat(12);

function owner(stateDir = null) {
  const k = generateOwnerKeyPair();
  return { k, auth: createOwnerAuth({ publicKeyB64: k.publicKeyB64, stateDir }), ap: (action, subject) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action, subject }) };
}
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e?.message ?? e)); } };
const fakeFetch = handler => async (url, init) => { const r = await handler(url, init); return { status: r.status ?? 200, headers: new Headers(r.headers ?? {}), text: async () => r.body ?? "", body: null }; };
const request = (port, { host, token = null, p = "/api/status" }) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port, path: p, method: "GET", headers: { host, ...(token ? { "x-atlasz-token": token } : {}) } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  r.on("error", reject); r.setTimeout(5000, () => r.destroy(new Error("TIMEOUT"))); r.end();
});

// --------------------------------------------------------------------------------------------- gates
const GATES = [
  { id: "G01", name: "secrets never reach agents", async run(t) {
    const { createSecretVault, generateVaultKey } = await import("./secret-vault.mjs");
    const { createCredentialBroker, normaliseGrant, grantSubject } = await import("./credential-broker.mjs");
    const o = owner(), v = createSecretVault({ dir: path.join(t.dir, "vault"), keyB64: generateVaultKey(), ownerAuth: o.auth });
    v.set("SYNTH_API", SYNTHETIC_SECRET, { ownerApproval: o.ap("VAULT_SET", "SYNTH_API") });
    const seen = [];
    const br = createCredentialBroker({ vault: v, ownerAuth: o.auth, gate: () => ({ allowed: true }), stateDir: path.join(t.dir, "broker"),
      fetchImpl: fakeFetch((u, init) => { seen.push(init.headers); return { body: "echo " + init.headers.authorization + " " + encodeURIComponent(SYNTHETIC_SECRET) + " " + Buffer.from(SYNTHETIC_SECRET).toString("base64"), headers: { "content-type": "text/plain", authorization: "leak" } }; }) });
    const G = { id: "g1", credential: "SYNTH_API", agents: ["EXECUTION-1"], roles: [], hosts: ["api.example-data.com"], methods: ["GET"], pathPrefixes: ["/v1"], purpose: "security gate G01", expiresAt: new Date(Date.now() + 864e5).toISOString() };
    br.grant(G, { ownerApproval: o.ap("BROKER_GRANT", grantSubject(normaliseGrant(G).grant)) });
    const r = await br.request({ agentId: "EXECUTION-1", grantId: "g1", url: "https://api.example-data.com/v1/x" });
    t.check(r.ok === true && seen.length === 1 && String(seen[0].authorization).includes(SYNTHETIC_SECRET), "broker attached the credential server-side (fake fetch saw it)");
    const visible = JSON.stringify(r);
    t.check(!visible.includes(SYNTHETIC_SECRET) && !visible.includes(encodeURIComponent(SYNTHETIC_SECRET)) && !visible.includes(Buffer.from(SYNTHETIC_SECRET).toString("base64")), "agent-visible response contains no plain / url-encoded / base64 form of the secret");
    const stateText = JSON.stringify(br.auditEntries()) + JSON.stringify(br.summary()) + JSON.stringify(br.listGrants()) + fs.readFileSync(path.join(t.dir, "broker", "broker-grants.json"), "utf8");
    t.check(!stateText.includes(SYNTHETIC_SECRET), "secret absent from broker audit, summary, grant list and grant file");
    t.check(!Object.keys(br).some(k => /^(get|read|reveal|secret|export)/i.test(k)), "broker exposes no read/reveal method: " + Object.keys(br).join(","));
    const other = await br.request({ agentId: "SEARCH-2", grantId: "g1", url: "https://api.example-data.com/v1/x" });
    t.check(other.ok === false && seen.length === 1, "an agent not named in the grant is refused before any request (" + other.reason + ")");
  } },

  { id: "G02", name: "deny-by-default tool policy", async run(t) {
    const { permissionFor, roleOf, TOOL_POLICY } = await import("./agent-tool-policy.mjs");
    t.check(permissionFor("SEARCH", "no.such.tool") === "DENY" && permissionFor("EXECUTION", "shell.exec") === "DENY", "unlisted tools are DENY for both roles");
    t.check(permissionFor("OWNER", "atlasz.queue") === "DENY" && permissionFor(undefined, "atlasz.queue") === "DENY", "unknown role is DENY even for an allowed tool");
    const hostile = { "pcc.agenda": { tool: "pcc.agenda", SEARCH: "ALLOW", EXECUTION: "ALLOW" }, "x.tool": { tool: "x.tool", SEARCH: "allow", EXECUTION: true } };
    t.check(permissionFor("SEARCH", "pcc.agenda", hostile) === "DENY", "pcc.* stays DENY even if a policy table says ALLOW (hard floor)");
    t.check(permissionFor("SEARCH", "x.tool", hostile) === "DENY" && permissionFor("EXECUTION", "x.tool", hostile) === "DENY", "malformed permission values ('allow', true) are DENY");
    t.check(permissionFor("SEARCH", "__proto__") === "DENY" && permissionFor("SEARCH", "constructor") === "DENY", "prototype keys are DENY");
    t.check(roleOf("SEARCH-6") === null && roleOf("EXECUTION-26") === null && roleOf("EXECUTION-0") === null, "agent ids outside the 5+25 roster have no role");
    t.check(Object.isFrozen(TOOL_POLICY), "the shipped policy table is frozen");
  } },

  { id: "G03", name: "kill switch blocks everything", async run(t) {
    const { createEmergencyStop } = await import("./emergency-stop.mjs");
    const { createCredentialBroker } = await import("./credential-broker.mjs");
    const { createEgressPolicy } = await import("./egress-policy.mjs");
    const { createQuarantine } = await import("./quarantine.mjs");
    const { createReleaseVerifier } = await import("./release-signing.mjs");
    const o = owner(), statePath = path.join(t.dir, "es.json"), auditPath = path.join(t.dir, "es-audit.jsonl");
    const es = createEmergencyStop({ statePath, auditPath, ownerAuth: o.auth });
    t.check(throwsWith(() => es.setMode({ mode: "PAUSE_ALL", ownerAuthenticated: true }), /BARE_BOOLEAN_REJECTED/), "a bare boolean cannot engage or change the stop");
    es.setMode({ mode: "PAUSE_ALL", ownerApproval: o.ap("EMERGENCY_STOP", "PAUSE_ALL"), reason: "gate G03" });
    t.check(es.gate().allowed === false && es.gate({ external: true }).allowed === false, "PAUSE_ALL denies internal and external actions");
    const isStopped = () => es.status().mode !== "RUNNING";
    const br = createCredentialBroker({ vault: { get: () => "x", has: () => true, status: () => ({ state: "UNLOCKED" }) }, ownerAuth: o.auth, gate: es.gate, fetchImpl: async () => { throw new Error("NETWORK_MUST_NOT_BE_CALLED"); } });
    const b = await br.request({ agentId: "EXECUTION-1", grantId: "g1", url: "https://api.example-data.com/v1" });
    t.check(b.ok === false && b.reason === "OWNER_STOP", "credential broker refuses with OWNER_STOP");
    const eg = createEgressPolicy({ ownerAuth: o.auth, isStopped });
    t.check(eg.check({ providerId: "anything", url: "https://api.example-data.com/v1" }).reason === "OWNER_STOP", "egress engine refuses with OWNER_STOP");
    const q = createQuarantine({ dir: path.join(t.dir, "q"), ownerAuth: o.auth, isStopped });
    const held = await q.quarantineBuffer(Buffer.from("hello"), { name: "a.txt", reason: "gate G03" });
    t.check(held.ok === true, "quarantine INTAKE still works while stopped (containment is not action)");
    t.check(q.release(held.record.sha256, { destPath: path.join(t.dir, "out.txt"), ownerApproval: o.ap("QUARANTINE_RELEASE", "x") }).reason === "OWNER_STOP_ACTIVE", "quarantine release refused while stopped");
    const rv = createReleaseVerifier({ ownerAuth: o.auth, isStopped });
    t.check(rv.accept({}, { bundleDir: t.dir }).reasons[0] === "OWNER_STOP", "release acceptance refused while stopped");
    t.check(throwsWith(() => es.setMode({ mode: "RUNNING", ownerApproval: o.ap("EMERGENCY_RESUME", "RUNNING") }), /EXPLICIT_RESUME_CONFIRMATION_REQUIRED/), "resume without the typed RESUME confirmation is refused");
    fs.writeFileSync(statePath, JSON.stringify({ mode: "RUNNING", changedAt: new Date().toISOString(), changedBy: "ATTACKER", reason: "x", approval: null }));
    const fresh = createEmergencyStop({ statePath, auditPath, ownerAuth: o.auth });
    t.check(fresh.status().mode === "PAUSE_ALL" && fresh.gate().allowed === false, "a forged RUNNING state file is not believed: fail-safe PAUSE_ALL (" + fresh.status().integrity + ")");
  } },

  { id: "G04", name: "approvals single-use", async run(t) {
    const shared = path.join(t.dir, "auth"), o = owner(shared);
    const a = o.ap("SPEND_MONEY", "INV-1");
    t.check(o.auth.verifyApproval(a, { action: "SPEND_MONEY", subject: "INV-1" }).allowed === true, "a fresh signed approval is accepted once");
    t.check(o.auth.verifyApproval(a, { action: "SPEND_MONEY", subject: "INV-1" }).reason === "REPLAY_DETECTED", "the same approval is refused the second time (same instance)");
    const second = createOwnerAuth({ publicKeyB64: o.k.publicKeyB64, stateDir: shared });
    t.check(second.verifyApproval(a, { action: "SPEND_MONEY", subject: "INV-1" }).reason === "REPLAY_DETECTED", "a second instance sharing the nonce store also refuses the replay");
    t.check(o.auth.verifyApproval(o.ap("SPEND_MONEY", "INV-1"), { action: "SPEND_MONEY", subject: "INV-2" }).reason === "SUBJECT_MISMATCH", "an approval is bound to its subject");
    t.check(o.auth.verifyApproval(o.ap("SPEND_MONEY", "INV-1"), { action: "SEND_PAYMENT", subject: "INV-1" }).reason === "ACTION_MISMATCH", "an approval is bound to its action");
    t.check(o.auth.verifyApproval(true, { action: "SPEND_MONEY" }).reason === "BARE_BOOLEAN_REJECTED", "bare booleans are refused");
    const forged = o.ap("SPEND_MONEY", "INV-9"); forged.subject = "INV-10";
    t.check(o.auth.verifyApproval(forged, { action: "SPEND_MONEY", subject: "INV-10" }).reason === "SIGNATURE_INVALID", "editing a signed approval breaks its signature");
  } },

  { id: "G05", name: "audit chain tamper detected", async run(t) {
    const { createAuditChain, readAuditFile, verifyChain } = await import("./audit-chain.mjs");
    const f = path.join(t.dir, "chain.jsonl"), c = createAuditChain({ filePath: f });
    for (let i = 0; i < 4; i++) c.append("EVENT", { i });
    t.check(c.verifyFile().ok === true, "an untouched chain verifies");
    const lines = fs.readFileSync(f, "utf8").trim().split("\n");
    const edited = [...lines]; const e = JSON.parse(edited[1]); e.data.i = 99; edited[1] = JSON.stringify(e); fs.writeFileSync(f, edited.join("\n") + "\n");
    t.check(verifyChain(readAuditFile(f)).ok === false && throwsWith(() => createAuditChain({ filePath: f }), /AUDIT_CHAIN_TAMPERED/), "an edited entry is detected and the chain refuses to load");
    fs.writeFileSync(f, [lines[0], lines[2], lines[3]].join("\n") + "\n");
    t.check(verifyChain(readAuditFile(f)).reason === "SEQUENCE_GAP_OR_REORDER", "a deleted entry is detected");
    fs.writeFileSync(f, [lines[1], lines[0], lines[2], lines[3]].join("\n") + "\n");
    t.check(verifyChain(readAuditFile(f)).ok === false, "a reordered chain is detected");
    const { createEgressPolicy, normaliseEgressPolicy, policySubject } = await import("./egress-policy.mjs");
    const o = owner(), d = path.join(t.dir, "egress"), P = { providerId: "synthetic", hosts: ["api.example-data.com"], pathPrefixes: ["/v1"] };
    createEgressPolicy({ ownerAuth: o.auth, stateDir: d }).setPolicy(P, { ownerApproval: o.ap("EGRESS_POLICY_SET", policySubject(normaliseEgressPolicy(P).policy)) });
    const pf = path.join(d, "egress-policy-audit.jsonl"), pl = fs.readFileSync(pf, "utf8").replace("api.example-data.com", "api.evil-data.com"); fs.writeFileSync(pf, pl);
    let loadErr = null; try { createEgressPolicy({ ownerAuth: o.auth, stateDir: d }); } catch (err) { loadErr = err; }
    t.check(Boolean(loadErr) && /AUDIT_CHAIN_TAMPERED/.test(loadErr.message), "a tampered egress policy log refuses to load (no policy can be smuggled in)");
    // a CONSISTENT re-written chain (valid hashes) carrying a policy signed by a non-owner key is still ignored: records are re-verified against the owner signature
    const d2 = path.join(t.dir, "egress2"), forger = owner(), P2 = { providerId: "smuggled", hosts: ["api.evil-data.com"], pathPrefixes: ["/"] }, n2 = normaliseEgressPolicy(P2).policy;
    createAuditChain({ filePath: path.join(d2, "egress-policy-audit.jsonl") }).append("EGRESS_POLICY_SET", { policy: n2, subject: policySubject(n2), approval: forger.ap("EGRESS_POLICY_SET", policySubject(n2)) });
    const eg3 = createEgressPolicy({ ownerAuth: o.auth, stateDir: d2 });
    t.check(eg3.listPolicies().length === 0 && /UNVERIFIED/.test(eg3.summary().integrity) && eg3.check({ providerId: "smuggled", url: "https://api.evil-data.com/", resolvedAddresses: ["93.184.216.34"] }).allowed === false, "a re-hashed chain with a forged policy record grants nothing (" + eg3.summary().integrity + ")");
  } },

  { id: "G06", name: "egress deny-by-default", async run(t) {
    const { createEgressPolicy, normaliseEgressPolicy, policySubject } = await import("./egress-policy.mjs");
    const o = owner(), eg = createEgressPolicy({ ownerAuth: o.auth, stateDir: path.join(t.dir, "eg") });
    const PUB = ["93.184.216.34"];
    t.check(eg.check({ providerId: "synthetic", url: "https://api.example-data.com/v1/a", resolvedAddresses: PUB }).reason === "NO_POLICY_FOR_PROVIDER", "no policy -> deny");
    const P = { providerId: "synthetic", hosts: ["api.example-data.com"], pathPrefixes: ["/v1"], methods: ["GET", "POST"], maxBodyBytes: 100 };
    t.check(throwsWith(() => eg.setPolicy(P, { ownerApproval: true }), /OWNER_APPROVAL_REQUIRED/), "a policy change without a signed owner approval is refused");
    eg.setPolicy(P, { ownerApproval: o.ap("EGRESS_POLICY_SET", policySubject(normaliseEgressPolicy(P).policy)) });
    const c = (url, extra = {}) => eg.check({ providerId: "synthetic", url, resolvedAddresses: PUB, ...extra });
    t.check(c("https://api.example-data.com/v1/a").allowed === true, "exact host + prefix + method is allowed");
    const tricks = { "https://api.example-data.com.evil.net/v1/a": "HOST_NOT_IN_POLICY", "https://evil-api.example-data.com/v1/a": "HOST_NOT_IN_POLICY", "https://api.example-data.com@evil.net/v1/a": "USERINFO_REFUSED",
      "https://2130706433/v1/a": "HOST_NORMALISATION_MISMATCH", "https://api.example-data.com:8443/v1/a": "PORT_NOT_IN_POLICY", "https://api.example-data.com/v1/../admin": "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR",
      "https://xn--pi-7ka.example-data.com/v1/a": "HOST_NOT_IN_POLICY", "https://аpi.example-data.com/v1/a": "NON_ASCII_OR_WHITESPACE_IN_URL", "http://api.example-data.com/v1/a": "SCHEME_NOT_ALLOWED" };
    for (const [u, want] of Object.entries(tricks)) t.check(c(u).reason === want, "refused " + JSON.stringify(u) + " -> " + want);
    t.check(c("https://api.example-data.com/v1/a", { resolvedAddresses: ["169.254.169.254"] }).allowed === false, "DNS answer pointing at cloud metadata (link-local) is refused");
    t.check(c("https://api.example-data.com/v1/a", { resolvedAddresses: ["::ffff:127.0.0.1"] }).allowed === false, "IPv4-mapped loopback DNS answer is refused");
    t.check(eg.check({ providerId: "synthetic", url: "https://api.example-data.com/v1/a" }).reason === "RESOLVED_ADDRESSES_REQUIRED", "without resolved addresses the request is refused (fail closed)");
    t.check(eg.checkRedirect({ providerId: "synthetic", url: "https://api.example-data.com/v1/a", resolvedAddresses: PUB }, "https://evil.net/v1/a").reason === "REDIRECT_TO_OTHER_HOST", "redirect to another host is refused");
    t.check(normaliseEgressPolicy({ providerId: "ollama", loopback: true, hosts: ["localhost"], ports: [11434] }).error === "LOOPBACK_POLICY_HOST_MUST_BE_127_0_0_1_ONLY", "a loopback policy may only name 127.0.0.1");
    const L = { providerId: "ollama", loopback: true, hosts: ["127.0.0.1"], ports: [11434], pathPrefixes: ["/api"], methods: ["POST"], maxBodyBytes: 1000 };
    eg.setPolicy(L, { ownerApproval: o.ap("EGRESS_POLICY_SET", policySubject(normaliseEgressPolicy(L).policy)) });
    t.check(eg.check({ providerId: "ollama", url: "http://127.0.0.1:11434/api/embed", method: "POST", body: "{}" }).allowed === true, "the explicit loopback provider reaches 127.0.0.1:11434 only");
    t.check(eg.check({ providerId: "ollama", url: "http://127.0.0.1:22/api/embed", method: "POST" }).allowed === false && eg.check({ providerId: "synthetic", url: "https://127.0.0.1/v1/a", resolvedAddresses: PUB }).allowed === false, "other loopback ports and IP literals for normal providers are refused");
    t.check(eg.auditVerify().decisions.ok === true && eg.decisions().length >= 15, "every decision is in the hash-chained decision log (" + eg.decisions().length + " entries)");
  } },

  { id: "G07", name: "quarantine never executes", async run(t) {
    const { createQuarantine, inspectArchive, releaseSubject } = await import("./quarantine.mjs");
    const src = fs.readFileSync(path.join(HERE, "quarantine.mjs"), "utf8");
    t.check(!/from\s+["'](?:node:)?(?:child_process|worker_threads|vm|cluster)["']|import\(\s*["'](?:node:)?(?:child_process|worker_threads|vm|cluster)["']|process\.kill\s*\(|\bexecSync\b|\bexecFile\b|\bspawn\s*\(|\bnew Function\b|\beval\s*\(/.test(src), "quarantine.mjs imports no process/VM module and has no exec/spawn/eval/kill call");
    const o = owner(), q = createQuarantine({ dir: path.join(t.dir, "q"), ownerAuth: o.auth });
    const fakeExe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]);                       // synthetic: just the PE magic bytes, not a real program
    const r = await q.quarantineBuffer(fakeExe, { name: "invoice.pdf.exe", reason: "gate G07" });
    const mode = fs.statSync(path.join(t.dir, "q", "files", r.record.sha256 + ".bin")).mode & 0o777;
    t.check((mode & 0o111) === 0 && (mode & 0o222) === 0, "stored copy is read-only with no exec bit (mode " + mode.toString(8) + ")");
    t.check(r.record.assessment === "HIGH_RISK_HOLD" && r.record.findings.some(f => f.code.startsWith("DOUBLE_EXTENSION")), "double extension + executable magic -> HIGH_RISK_HOLD");
    t.check(r.record.scan.status === "NO_SCANNER_CONFIGURED" && !JSON.stringify(r.record).includes("CLEAN"), "without a scanner the record says NO_SCANNER_CONFIGURED and never 'clean'");
    t.check(q.release(r.record.sha256, { destPath: path.join(t.dir, "out.bin"), ownerApproval: null }).reason === "OWNER_APPROVAL_REQUIRED" && !fs.existsSync(path.join(t.dir, "out.bin")), "release without a signed owner approval is refused");
    const other = await q.quarantineBuffer(Buffer.from("other synthetic bytes"), { name: "b.txt", reason: "gate G07" });
    t.check(q.release(other.record.sha256, { destPath: path.join(t.dir, "out.bin"), ownerApproval: o.ap("QUARANTINE_RELEASE", releaseSubject(r.record.sha256, path.join(t.dir, "out.bin"))) }).reason === "OWNER_APPROVAL_REQUIRED", "an approval for one sha256 cannot release another file");
    const zip = syntheticZip([{ name: "../../evil.sh", data: Buffer.from("#!/bin/sh\n") }]);
    t.check(inspectArchive(zip).findings.some(f => f.code === "PATH_TRAVERSAL_DOTDOT"), "zip-slip entry is reported as BLOCK");
    t.check(q.verify().ok === true && q.verify().anyExecBit === false, "quarantine store verifies (chain + hashes), no exec bits");
  } },

  { id: "G08", name: "memory classification isolation", async run(t) {
    const { createMemoryStore } = await import("./memory-store.mjs");
    const m = createMemoryStore({ dir: path.join(t.dir, "mem") });
    try {
      const conf = m.write({ authorId: "OWNER", title: "Synthetic board memo", body: "Synthetic confidential planning text for gate G08.", tags: [], classification: "CONFIDENTIAL", clearance: "CONFIDENTIAL" });
      t.check(conf.ok === true, "owner can store a CONFIDENTIAL note");
      const agent = { id: "EXECUTION-1", clearance: "PERSONAL" }, own = { id: "OWNER", clearance: "CONFIDENTIAL" };
      t.check(m.get(conf.id, agent).ok === false && m.get(conf.id, agent).reason === "NOT_FOUND", "a PERSONAL-clearance reader cannot read it (and cannot tell it exists)");
      t.check(m.get(conf.id, own).ok === true, "the CONFIDENTIAL-clearance reader can");
      const s = m.search({ query: "synthetic confidential planning", reader: agent });
      t.check(!JSON.stringify(s).includes(conf.id), "search does not leak the CONFIDENTIAL note to the PERSONAL reader");
      t.check(m.write({ authorId: "OWNER", title: "k", body: "x", classification: "SECRET" }).reason === "SECRET_NOT_STORABLE_USE_THE_VAULT", "SECRET class is refused (vault only)");
      t.check(m.write({ authorId: "EXECUTION-1", title: "k", body: "key " + "AKIA" + "ABCDEFGHIJKLMNOP", classification: "PERSONAL" }).reason === "SECRET_DETECTED_NOT_STORED", "credential-shaped text is refused");
    } finally { m.close(); }
  } },

  { id: "G09", name: "unsigned update refused", async run(t) {
    const { createReleaseVerifier, generatePublisherKeyPair, buildManifest, signManifest, anchorAddSubject } = await import("./release-signing.mjs");
    const o = owner(), rv = createReleaseVerifier({ ownerAuth: o.auth, stateDir: path.join(t.dir, "rs") });
    const pub = generatePublisherKeyPair(), stranger = generatePublisherKeyPair(), b = path.join(t.dir, "bundle");
    fs.mkdirSync(b); fs.writeFileSync(path.join(b, "module.mjs"), "export const v = 1;\n");
    t.check(throwsWith(() => rv.addTrustAnchor({ publicKeyB64: pub.publicKeyB64, components: ["atlasz-core"] }, { ownerApproval: null }), /OWNER_APPROVAL_REQUIRED/), "adding a trust anchor without owner approval is refused");
    rv.addTrustAnchor({ publicKeyB64: pub.publicKeyB64, components: ["atlasz-core"] }, { ownerApproval: o.ap("RELEASE_TRUST_ANCHOR_ADD", anchorAddSubject(pub.keyId, pub.publicKeyB64, ["atlasz-core"])) });
    const m = buildManifest({ rootDir: b, component: "atlasz-core", version: "1.2.0" });
    t.check(rv.verifyBundle({ manifest: m }, { bundleDir: b }).reasons[0] === "UNSIGNED_OR_MALFORMED", "an unsigned manifest is refused");
    t.check(rv.verifyBundle(signManifest(m, { privateKeyPem: stranger.privateKeyPem }), { bundleDir: b }).reasons[0] === "UNKNOWN_SIGNING_KEY", "a manifest signed by an unknown key is refused");
    const signed = signManifest(m, { privateKeyPem: pub.privateKeyPem });
    t.check(rv.verifyBundle(signed, { bundleDir: b }).ok === true, "the correctly signed, unmodified bundle verifies");
    fs.writeFileSync(path.join(b, "module.mjs"), "export const v = 2;\n");
    t.check(rv.verifyBundle(signed, { bundleDir: b }).reasons.includes("FILE_ALTERED:module.mjs"), "an altered file is refused");
    fs.writeFileSync(path.join(b, "module.mjs"), "export const v = 1;\n"); fs.writeFileSync(path.join(b, "extra.mjs"), "x");
    t.check(rv.verifyBundle(signed, { bundleDir: b }).reasons.includes("EXTRA_FILE:extra.mjs"), "an extra unsigned file is refused");
    fs.unlinkSync(path.join(b, "extra.mjs"));
    t.check(rv.accept(signed, { bundleDir: b }).accepted === true && rv.accept(signed, { bundleDir: b }).reasons.includes("REPLAY_OF_ACCEPTED_MANIFEST"), "an accepted manifest cannot be replayed");
    const old = signManifest(buildManifest({ rootDir: b, component: "atlasz-core", version: "1.1.9" }), { privateKeyPem: pub.privateKeyPem });
    t.check(rv.verifyBundle(old, { bundleDir: b }).reasons.some(r => r.startsWith("DOWNGRADE:")), "a validly signed older version is refused as a downgrade");
  } },

  { id: "G10", name: "simulated money never counted as revenue", async run(t) {
    const { createPaperTrader, CURRENCY } = await import("./paper-trader.mjs");
    const { createFinancialLedger } = await import("./financial-ledger.mjs");
    const { summarize } = await import("./profit-ledger.mjs");
    const pt = createPaperTrader({ dir: path.join(t.dir, "paper") }), rep = pt.report();
    t.check(CURRENCY === "SIM-USD" && rep.realMoney === false && /NOT REAL REVENUE/.test(rep.label), "paper trading is labelled SIM-USD, realMoney:false, NOT REAL REVENUE");
    t.check(pt.requestLiveTrading("gate G10").reason === "LIVE_TRADING_NOT_AUTHORIZED", "live trading request is refused");
    const ptSrc = fs.readFileSync(path.join(HERE, "paper-trader.mjs"), "utf8");
    t.check(!/financial-ledger|profit-ledger|invoice-engine|payment-confirmation/.test(ptSrc), "paper-trader has no code path into any revenue ledger");
    const led = createFinancialLedger({ dir: path.join(t.dir, "ledger") });
    led.recordRevenue({ jobId: "SIM-1", amountUsd: 5000, stage: "PROPOSED" }); led.recordRevenue({ jobId: "SIM-1", amountUsd: 5000, stage: "INVOICED" });
    t.check(throwsWith(() => led.recordRevenue({ jobId: "SIM-1", amountUsd: 5000, stage: "PAID" }), /PAID_REQUIRES_CONFIRMED_RECEIPT/), "PAID without confirmed receipt is refused");
    t.check(throwsWith(() => led.recordRevenue({ jobId: "SIM-1", amountUsd: 5000, stage: "PAID", confirmedReceived: true }), /PAID_REQUIRES_EXTERNAL_EVIDENCE/), "PAID without external evidence is refused");
    const s = led.summary();
    t.check(s.revenue.verifiedReceivedUsd === 0 && s.profit.verifiedNetUsd === 0 && s.revenue.unconfirmedPipelineUsd === 5000, "proposed/invoiced amounts stay pipeline, verified revenue stays 0");
    t.check(summarize([{ stage: "LEAD_VALUE", amountUsd: 100000, costUsd: 0 }]).confirmedPaidUsd === 0, "opportunity (lead) value is not revenue in the profit ledger");
  } },

  { id: "G11", name: "exactly 30 agents", async run(t) {
    const { ROSTER } = await import("./agent-activity.mjs");
    const { AGENT_ID_RE, roleOf } = await import("./agent-tool-policy.mjs");
    t.check(ROSTER.length === 30 && ROSTER.filter(id => roleOf(id) === "SEARCH").length === 5 && ROSTER.filter(id => roleOf(id) === "EXECUTION").length === 25, "roster: 5 SEARCH + 25 EXECUTION = 30");
    const space = [];
    for (const r of ["SEARCH", "EXECUTION", "search", "AGENT"]) for (let i = -1; i <= 40; i++) space.push(r + "-" + i);
    for (const x of ["SEARCH-01", "EXECUTION-05", "SEARCH-1 ", " SEARCH-1", "SEARCH-1\n"]) space.push(x);
    const valid = space.filter(id => AGENT_ID_RE.test(id));
    t.check(valid.length === 30 && valid.every(id => ROSTER.includes(id)), "agent-id grammar admits exactly the 30 roster ids out of " + space.length + " candidates");
    // instantiate the real runtime (test mode: no HTTP server, no start(), no network)
    const prev = process.env.ATLASZ_TEST_MODE; process.env.ATLASZ_TEST_MODE = "1";
    let createRuntime; try { ({ createRuntime } = await import("../atlasz-runtime/supervisor-safe.mjs")); } finally { if (prev === undefined) delete process.env.ATLASZ_TEST_MODE; else process.env.ATLASZ_TEST_MODE = prev; }
    const rt = createRuntime({ dataDir: path.join(t.dir, "rt"), fetchImpl: async () => { throw new Error("NETWORK_DISABLED_IN_GATE"); } });
    try {
      const a = rt.state.agents;
      t.check(a.length === 30 && a.filter(x => x.role === "SEARCH").length === 5 && a.filter(x => x.role === "EXECUTION").length === 25, "instantiated runtime has 30 agents: 5 SEARCH + 25 EXECUTION");
      t.check(a.map(x => x.id).join(",") === ROSTER.join(","), "runtime agent ids equal the roster");
    } finally { rt.stop(); }
  } },

  { id: "G12", name: "bind address stays loopback", async run(t) {
    const { createControlCenterServer } = await import("../atlasz-control-center/server.mjs");
    const cc = createControlCenterServer({ stateDir: path.join(t.dir, "state"), configDir: path.join(t.dir, "config"), port: 1 });
    try {
      const { port, token } = await cc.listen(0);
      const addr = cc.server.address();
      t.check(addr.address === "127.0.0.1" && addr.family === "IPv4", "control center listens on " + addr.address + " only");
      t.check(await request(port, { host: "attacker.example:" + port, token }) === 403, "a foreign Host header (DNS rebinding) is refused with 403");
      t.check(await request(port, { host: "127.0.0.1:" + port }) === 401, "a call without the per-launch token is refused with 401");
      const runtimeSrc = fs.readFileSync(path.join(ROOT, "atlasz-runtime", "supervisor-safe.mjs"), "utf8");
      const cloudBind = /server\.listen\([^)]*"0\.0\.0\.0"/.test(runtimeSrc);
      t.note("scope: local control center only. Cloud runtime supervisor-safe.mjs binds " + (cloudBind ? "0.0.0.0 (Railway; token-authenticated handler, not covered by this gate)" : "a non-0.0.0.0 address"));
    } finally { await cc.close(); await new Promise(r => cc.server.close(() => r())); }
  } }
];

/** Minimal stored (method 0) ZIP writer for synthetic fixtures. Exported for tests. */
export function syntheticZip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"), data = Buffer.from(e.data ?? "");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((e.unix ? 3 : 0) << 8 | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800 | (e.encrypted ? 1 : 0), 8);
    ch.writeUInt32LE(e.csize ?? data.length, 20); ch.writeUInt32LE(e.usize ?? data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38); ch.writeUInt32LE(e.offset ?? off, 42);
    locals.push(lh, name, data); centrals.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export const GATE_IDS = Object.freeze(GATES.map(g => g.id));
export const GATE_NAMES = Object.freeze(Object.fromEntries(GATES.map(g => [g.id, g.name])));

/** Generic runner: each gate is {id, name, run(t)}; t.check(ok, text) records evidence, t.note(text) adds context. A gate PASSES only if it ran at least one check,
 *  every check held and nothing threw. Sequential (low CPU). Never throws. */
export async function runGates(gates, { workRoot = os.tmpdir() } = {}) {
  const startedAt = new Date().toISOString(), results = [];
  for (const g of gates) {
    const evidence = [], notes = [], t0 = Date.now(); let dir = null, error = null;
    const t = { get dir() { return dir; }, check: (ok, text) => { evidence.push({ ok: ok === true, check: String(text) }); return ok === true; }, note: text => notes.push(String(text)) };
    try { dir = fs.mkdtempSync(path.join(workRoot, "atlasz-gate-" + g.id + "-")); await g.run(t); }
    catch (e) { error = String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ").slice(0, 400); }
    finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp */ } } }
    const pass = !error && evidence.length > 0 && evidence.every(e => e.ok);
    results.push({ id: g.id, name: g.name, status: pass ? "PASS" : "FAIL", checks: evidence.length, failedChecks: evidence.filter(e => !e.ok).map(e => e.check), evidence, notes, error, ms: Date.now() - t0 });
  }
  const failed = results.filter(r => r.status !== "PASS").length;
  return { suite: SUITE, startedAt, finishedAt: new Date().toISOString(), node: process.version, total: results.length, passed: results.length - failed, failed, exitCode: failed || !results.length ? 1 : 0, gates: results,
    meaning: "PASS = the named checks ran in-process against the real local modules with synthetic data and held (TESTED locally). Not runtime/production evidence (not LIVE) and not proof of wiring (CONNECTED)." };
}

/** Run the 12 named gates (all, or the ids in `only`). An empty selection is exit code 1: nothing was proven. */
export function runSecurityGates({ only = null, workRoot = os.tmpdir() } = {}) {
  return runGates(only ? GATES.filter(g => only.includes(g.id)) : GATES, { workRoot });
}

// CLI: node atlasz-addons/security-gates.mjs [G01,G02,...]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv[2] ? process.argv[2].split(",").map(s => s.trim().toUpperCase()) : null;
  runSecurityGates({ only }).then(r => {
    for (const g of r.gates) console.log(g.status + " " + g.id + " " + g.name + " (" + g.checks + " checks, " + g.ms + " ms)" + (g.error ? " ERROR " + g.error : "") + (g.failedChecks.length ? " FAILED: " + g.failedChecks.join("; ") : ""));
    console.log(JSON.stringify({ suite: r.suite, total: r.total, passed: r.passed, failed: r.failed, exitCode: r.exitCode }));
    process.exitCode = r.exitCode;
  });
}
