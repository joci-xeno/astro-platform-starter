// W6 Global Business §2: owner-approved source allowlist (empty by default, deny by default, per-country approval, signed + replay-proof).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSourceAllowlist, normaliseSourceEntry, entrySubject, countrySubject, dissectUrl } from "../atlasz-addons/source-allowlist.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import * as ac from "../atlasz-addons/audit-chain.mjs";
import { tmp, rm } from "./helpers.mjs";

const kp = generateOwnerKeyPair(), other = generateOwnerKeyPair();
const ap = (action, subject, key = kp) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const ENTRY = { sourceId: "fixture-tenders", hosts: ["tenders.fixture-portal.org"], country: "CA", category: "PROCUREMENT", licenceNote: "Synthetic fixture source; open data licence note recorded by owner", rateLimit: { maxRequestsPerHour: 3, minIntervalMs: 0 }, pathPrefixes: ["/notices"] };
function mk(o = {}) {
  const dir = tmp("srcallow-"), auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 });
  let t = Date.parse("2026-10-10T00:00:00Z");
  const open = (x = {}) => createSourceAllowlist({ ownerAuth: auth, stateDir: dir, nowFn: () => t, ...o, ...x });
  return { dir, auth, al: open(), open, tick: ms => { t += ms; }, done: () => rm(dir) };
}
function approveAll(t, entry = ENTRY) {
  const n = normaliseSourceEntry(entry).entry;
  assert.equal(t.al.allowSource(entry, { approval: ap("SOURCE_ALLOW", entrySubject(n)) }).ok, true);
  assert.equal(t.al.approveCountry(entry.country, { approval: ap("SOURCE_COUNTRY_ALLOW", countrySubject(entry.country)) }).ok, true);
}
const URL_OK = "https://tenders.fixture-portal.org/notices?q=web";

test("empty by default: every check is denied and the summary says no discovery is possible", () => {
  const t = mk(); try {
    assert.equal(t.al.list().length, 0);
    const d = t.al.check("fixture-tenders", URL_OK); assert.equal(d.allowed, false); assert.equal(d.reason, "SOURCE_NOT_ALLOWLISTED");
    const s = t.al.summary(); assert.equal(s.entries, 0); assert.match(s.note, /no external discovery/); assert.equal(s.state, "IMPLEMENTED_NOT_CONNECTED");
  } finally { t.done(); }
});

test("an approved entry is NOT effective until its country is approved too (per-country approval)", () => {
  const t = mk(); try {
    const n = normaliseSourceEntry(ENTRY).entry;
    assert.equal(t.al.allowSource(ENTRY, { approval: ap("SOURCE_ALLOW", entrySubject(n)) }).countryApproved, false);
    assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "COUNTRY_NOT_APPROVED:CA");
    t.al.approveCountry("CA", { approval: ap("SOURCE_COUNTRY_ALLOW", countrySubject("CA")) });
    const d = t.al.check("fixture-tenders", URL_OK); assert.equal(d.allowed, true); assert.match(d.licenceNote, /Synthetic/);
    // approving another country does not open this one after revocation
    t.al.revokeCountry("CA"); assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "COUNTRY_NOT_APPROVED:CA");
  } finally { t.done(); }
});

test("missing, bare-boolean, wrong-key (forged), wrong-subject and wrong-action approvals are refused", () => {
  const t = mk(); try {
    const subj = entrySubject(normaliseSourceEntry(ENTRY).entry);
    assert.equal(t.al.allowSource(ENTRY).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(t.al.allowSource(ENTRY, { approval: true }).detail, "BARE_BOOLEAN_REJECTED");
    assert.equal(t.al.allowSource(ENTRY, { approval: ap("SOURCE_ALLOW", subj, other) }).detail, "SIGNATURE_INVALID");
    assert.equal(t.al.allowSource(ENTRY, { approval: ap("SOURCE_ALLOW", "source:fixture-tenders:deadbeef") }).detail, "SUBJECT_MISMATCH");
    assert.equal(t.al.allowSource(ENTRY, { approval: ap("SOURCE_COUNTRY_ALLOW", subj) }).detail, "ACTION_MISMATCH");
    const forged = { ...ap("SOURCE_ALLOW", subj), signature: Buffer.alloc(64).toString("base64") };
    assert.equal(t.al.allowSource(ENTRY, { approval: forged }).detail, "SIGNATURE_INVALID");
    assert.equal(t.al.list().length, 0);
  } finally { t.done(); }
});

test("a replayed approval is refused live, and a copied-in duplicate record in the log is ignored on fold", () => {
  const t = mk(); try {
    const n = normaliseSourceEntry(ENTRY).entry, a = ap("SOURCE_ALLOW", entrySubject(n));
    assert.equal(t.al.allowSource(ENTRY, { approval: a }).ok, true);
    t.al.disableSource("fixture-tenders");
    assert.equal(t.al.allowSource(ENTRY, { approval: a }).detail, "REPLAY_DETECTED");
    // attacker appends a correctly chained SOURCE_ALLOWED record reusing the old approval: the nonce was already seen in the log -> ignored
    const chain = t.al.audit(), last = chain.at(-1);
    const e = { seq: last.seq + 1, at: new Date().toISOString(), event: "SOURCE_ALLOWED", data: { entry: n, subject: entrySubject(n), approval: a }, prevHash: last.hash }; e.hash = ac.hashEntry(e);
    fs.appendFileSync(path.join(t.dir, "source-allowlist-audit.jsonl"), JSON.stringify(e) + "\n");
    t.al.approveCountry("CA", { approval: ap("SOURCE_COUNTRY_ALLOW", countrySubject("CA")) });
    assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "SOURCE_NOT_ALLOWLISTED");
    assert.match(t.al.summary().integrity, /UNVERIFIED_RECORDS_IGNORED/);
  } finally { t.done(); }
});

test("a hand-edited allowlist record (host widened) invalidates the chain and nothing is allowed (fail closed)", () => {
  const t = mk(); try {
    approveAll(t);
    const f = path.join(t.dir, "source-allowlist-audit.jsonl"), lines = fs.readFileSync(f, "utf8").trim().split("\n");
    const i = lines.findIndex(l => l.includes("SOURCE_ALLOWED")); const e = JSON.parse(lines[i]); e.data.entry.hosts.push("evil.example.net"); lines[i] = JSON.stringify(e);
    fs.writeFileSync(f, lines.join("\n") + "\n");
    const d = t.al.check("fixture-tenders", URL_OK); assert.equal(d.allowed, false); assert.equal(t.al.summary().integrity, "ALLOWLIST_LOG_TAMPERED");
  } finally { t.done(); }
});

test("a re-chained forged record (valid hashes, entry changed after signing) is ignored because the subject no longer matches", () => {
  const t = mk(); try {
    approveAll(t);
    const f = path.join(t.dir, "source-allowlist-audit.jsonl"), entries = fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l));
    let prev = ac.GENESIS; for (const e of entries) { if (e.event === "SOURCE_ALLOWED") e.data.entry.hosts = ["evil.example.net"]; e.prevHash = prev; e.hash = ac.hashEntry(e); prev = e.hash; }
    fs.writeFileSync(f, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
    assert.equal(t.al.check("fixture-tenders", "https://evil.example.net/notices").allowed, false);
    assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "SOURCE_NOT_ALLOWLISTED");
  } finally { t.done(); }
});

test("non-allowlisted hosts and look-alikes are denied (exact host match only)", () => {
  const t = mk(); try {
    approveAll(t);
    for (const u of ["https://evil.example.net/notices", "https://tenders.fixture-portal.org.evil.net/notices", "https://evil-tenders.fixture-portal.org/notices", "https://fixture-portal.org/notices", "https://sub.tenders.fixture-portal.org/notices"])
      assert.equal(t.al.check("fixture-tenders", u).reason, "HOST_NOT_ALLOWLISTED", u);
  } finally { t.done(); }
});

test("URL tricks are refused: http, userinfo, IP literals, ports, IDN, trailing dot, traversal, encoded separators", () => {
  const t = mk(); try {
    approveAll(t);
    const cases = { "http://tenders.fixture-portal.org/notices": "SCHEME_NOT_ALLOWED", "https://user@tenders.fixture-portal.org/notices": "USERINFO_REFUSED", "https://127.0.0.1/notices": "IP_LITERAL_REFUSED",
      "https://[::1]/notices": "IP_LITERAL_REFUSED", "https://tenders.fixture-portal.org:8443/notices": "PORT_NOT_ALLOWED", "https://tеnders.fixture-portal.org/notices": "NON_ASCII_OR_WHITESPACE_IN_URL",
      "https://tenders.fixture-portal.org./notices": "TRAILING_DOT_HOST_REFUSED", "https://tenders.fixture-portal.org/notices/../admin": "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR", "https://tenders.fixture-portal.org/notices%2f..%2fadmin": "PATH_TRAVERSAL_OR_ENCODED_SEPARATOR",
      "https://tenders.fixture-portal.org/admin": "PATH_NOT_ALLOWLISTED", "https://0x7f.1/notices": "IP_LITERAL_REFUSED", "ftp://tenders.fixture-portal.org/notices": "SCHEME_NOT_ALLOWED" };
    for (const [u, r] of Object.entries(cases)) assert.equal(t.al.check("fixture-tenders", u, { consume: false }).reason, r, u);
    assert.equal(dissectUrl(123).error, "URL_INVALID");
  } finally { t.done(); }
});

test("redirects: other host / scheme / port refused; same-host redirect is checked like a fresh request", () => {
  const t = mk(); try {
    approveAll(t);
    assert.equal(t.al.checkRedirect("fixture-tenders", URL_OK, "https://evil.example.net/notices").reason, "REDIRECT_TO_OTHER_HOST");
    assert.equal(t.al.checkRedirect("fixture-tenders", URL_OK, "http://tenders.fixture-portal.org/notices").reason, "REDIRECT_SCHEME_NOT_ALLOWED");
    assert.equal(t.al.checkRedirect("fixture-tenders", URL_OK, "//evil.example.net/x").reason, "REDIRECT_TO_OTHER_HOST");
    assert.equal(t.al.checkRedirect("fixture-tenders", URL_OK, "../admin").reason, "REDIRECT_RELATIVE_PATH_REFUSED");
    assert.equal(t.al.checkRedirect("fixture-tenders", URL_OK, "/admin").reason, "PATH_NOT_ALLOWLISTED");
    assert.equal(t.al.checkRedirect("fixture-tenders", URL_OK, "/notices/page2").allowed, true);
  } finally { t.done(); }
});

test("rate limit: hourly cap and minimum interval; dry runs do not consume", () => {
  const t = mk(); try {
    approveAll(t, { ...ENTRY, rateLimit: { maxRequestsPerHour: 2, minIntervalMs: 1000 } });
    assert.equal(t.al.check("fixture-tenders", URL_OK).allowed, true);
    assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "RATE_LIMIT_INTERVAL");
    t.tick(1500); assert.equal(t.al.check("fixture-tenders", URL_OK, { consume: false }).allowed, true);
    assert.equal(t.al.check("fixture-tenders", URL_OK).allowed, true);
    t.tick(1500); assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "RATE_LIMIT_HOURLY");
    t.tick(3600 * 1000); assert.equal(t.al.check("fixture-tenders", URL_OK).allowed, true);
  } finally { t.done(); }
});

test("credential reference: a source needing a credential is denied until the vault reports the NAME as configured; values are refused", () => {
  let has = false; const t = mk({ hasCredential: ref => has && ref === "TENDER_API_KEY" }); try {
    approveAll(t, { ...ENTRY, requiresCredentialRef: "TENDER_API_KEY" });
    assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "CREDENTIAL_NOT_CONFIGURED:TENDER_API_KEY");
    has = true; assert.equal(t.al.check("fixture-tenders", URL_OK).allowed, true);
    assert.equal(normaliseSourceEntry({ ...ENTRY, requiresCredentialRef: "sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2" }).error, "CREDENTIAL_REF_MUST_BE_A_NAME");
  } finally { t.done(); }
});

test("entry validation: wildcards, IPs, private TLDs, bad country/category, missing licence note, oversized lists, prototype keys", () => {
  const bad = [[{ hosts: ["*.fixture-portal.org"] }, /HOST_INVALID/], [{ hosts: ["10.0.0.1"] }, /HOST_INVALID/], [{ hosts: ["intranet.corp"] }, /HOST_NOT_PUBLIC/], [{ hosts: ["Tenders.Fixture-Portal.org"] }, /HOST_INVALID/],
    [{ country: "Canada" }, /COUNTRY/], [{ category: "DARKWEB" }, /CATEGORY/], [{ licenceNote: "" }, /LICENCE_NOTE/], [{ hosts: Array.from({ length: 11 }, (_, i) => `h${i}.fixture-portal.org`) }, /HOSTS_REQUIRED/],
    [{ sourceId: "__proto__" }, /SOURCE_ID/], [{ rateLimit: { maxRequestsPerHour: 0 } }, /RATE_LIMIT/], [{ rateLimit: { maxRequestsPerHour: 1e9 } }, /RATE_LIMIT/], [{ pathPrefixes: ["/a/../b"] }, /PATH_PREFIX/], [null, /OBJECT/]];
  for (const [patch, re] of bad) assert.match(normaliseSourceEntry(patch === null ? null : { ...ENTRY, ...patch }).error, re, JSON.stringify(patch));
  assert.ok(normaliseSourceEntry(ENTRY).entry);
});

test("changing an approved entry needs a NEW approval bound to the new hash (old approval cannot cover a widened host list)", () => {
  const t = mk(); try {
    approveAll(t);
    const widened = { ...ENTRY, hosts: [...ENTRY.hosts, "evil.example.net"] };
    const oldSubj = entrySubject(normaliseSourceEntry(ENTRY).entry), newSubj = entrySubject(normaliseSourceEntry(widened).entry);
    assert.notEqual(oldSubj, newSubj);
    assert.equal(t.al.allowSource(widened, { approval: ap("SOURCE_ALLOW", oldSubj) }).detail, "SUBJECT_MISMATCH");
    assert.equal(t.al.check("fixture-tenders", "https://evil.example.net/notices").reason, "HOST_NOT_ALLOWLISTED");
  } finally { t.done(); }
});

test("emergency stop and a throwing stop probe deny everything", () => {
  let stop = false; const t = mk({ isStopped: () => stop }); try {
    approveAll(t); stop = true; assert.equal(t.al.check("fixture-tenders", URL_OK).reason, "OWNER_STOP");
    const t2 = mk({ isStopped: () => { throw new Error("x"); } }); try { approveAll(t2); assert.equal(t2.al.check("fixture-tenders", URL_OK).reason, "OWNER_STOP"); } finally { t2.done(); }
  } finally { t.done(); }
});

test("persistence: a new instance rebuilds the allowlist from the signed log; disable needs no approval and survives restart", () => {
  const t = mk(); try {
    approveAll(t);
    const again = t.open(); assert.equal(again.check("fixture-tenders", URL_OK).allowed, true);
    again.disableSource("fixture-tenders"); assert.equal(t.open().check("fixture-tenders", URL_OK).reason, "SOURCE_NOT_ALLOWLISTED");
    assert.equal(t.open().auditVerify().ok, true);
  } finally { t.done(); }
});

test("an allowlist built without an owner-auth verifier cannot be created; an unconfigured owner key approves nothing", () => {
  assert.throws(() => createSourceAllowlist({}), /OWNER_AUTH_REQUIRED/);
  const al = createSourceAllowlist({ ownerAuth: createOwnerAuth({}) });
  assert.equal(al.allowSource(ENTRY, { approval: ap("SOURCE_ALLOW", entrySubject(normaliseSourceEntry(ENTRY).entry)) }).detail, "OWNER_AUTH_NOT_CONFIGURED");
  assert.equal(al.check("fixture-tenders", URL_OK).allowed, false);
});
