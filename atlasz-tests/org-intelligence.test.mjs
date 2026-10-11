// W6 Global Business §3: organisation intelligence store - provenance per field, conflicts preserved, buyer-finder reuse, GDPR-style export/forget.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createOrgIntelligence, ORG_FIELDS } from "../atlasz-addons/org-intelligence.mjs";
import { tmp, rm } from "./helpers.mjs";

const SRC = { a: { sourceId: "fx-registry", url: "https://registry.fixture-gov.org/c/1", observedAt: "2026-10-01T00:00:00Z" }, b: { sourceId: "fx-news", url: "https://news.fixture-media.org/a/2", observedAt: "2026-10-02T00:00:00Z" } };
function mk(o = {}) { const dir = tmp("orgint-"); const open = (x = {}) => createOrgIntelligence({ dir, isSourceApproved: id => ["fx-registry", "fx-news"].includes(id), ...o, ...x }); return { dir, oi: open(), open, done: () => rm(dir) }; }
const contact = { name: "Ada Example", title: "Head of Procurement", email: "ada@fixture-co.org", businessContact: true, confidence: 0.8 };

test("a field asserted by one source is SINGLE_SOURCE with its provenance; unasserted fields are UNKNOWN (null), not guessed", () => {
  const t = mk(); try {
    assert.equal(t.oi.assertField("fixture-co", "legalName", "Fixture Co Ltd", { provenance: SRC.a, confidence: 0.9 }).ok, true);
    const v = t.oi.view("fixture-co");
    assert.equal(v.fields.legalName.status, "SINGLE_SOURCE"); assert.equal(v.fields.legalName.value, "Fixture Co Ltd"); assert.equal(v.fields.legalName.candidates[0].sources[0].url, SRC.a.url);
    assert.equal(v.fields.employeeRange.status, "UNKNOWN"); assert.equal(v.fields.employeeRange.value, null); assert.equal(v.unknown.length, ORG_FIELDS.length - 1);
  } finally { t.done(); }
});

test("two independent sources with the same (normalised) value are CORROBORATED", () => {
  const t = mk(); try {
    t.oi.assertField("fixture-co", "country", "CA", { provenance: SRC.a, confidence: 0.9 }); t.oi.assertField("fixture-co", "country", "ca", { provenance: SRC.b, confidence: 0.6 });
    const f = t.oi.view("fixture-co").fields.country; assert.equal(f.status, "CORROBORATED"); assert.equal(f.candidates[0].independentSources, 2); assert.equal(f.confidence, 0.9);
  } finally { t.done(); }
});

test("conflicting sources are preserved side by side (value null, no silent merge, no majority vote)", () => {
  const t = mk(); try {
    t.oi.assertField("fixture-co", "employeeRange", "11-50", { provenance: SRC.a, confidence: 0.9 });
    t.oi.assertField("fixture-co", "employeeRange", "201-500", { provenance: SRC.b, confidence: 0.95 });
    const v = t.oi.view("fixture-co"); assert.equal(v.fields.employeeRange.status, "CONFLICT"); assert.equal(v.fields.employeeRange.value, null);
    assert.deepEqual(v.fields.employeeRange.candidates.map(c => c.value).sort(), ["11-50", "201-500"]); assert.deepEqual(v.conflicts, ["employeeRange"]);
  } finally { t.done(); }
});

test("a reviewer resolution picks an existing candidate only; the candidates remain visible", () => {
  const t = mk(); try {
    t.oi.assertField("fixture-co", "website", "fixture-co.org", { provenance: SRC.a, confidence: 0.9 }); t.oi.assertField("fixture-co", "website", "fixtureco.net", { provenance: SRC.b, confidence: 0.5 });
    assert.equal(t.oi.resolveConflict("fixture-co", "website", "invented.org", { reviewer: "JOCI" }).reason, "CHOICE_MUST_BE_AN_EXISTING_CANDIDATE");
    assert.equal(t.oi.resolveConflict("fixture-co", "website", "fixture-co.org", {}).reason, "REVIEWER_REQUIRED");
    assert.equal(t.oi.resolveConflict("fixture-co", "website", "fixture-co.org", { reviewer: "JOCI", note: "registry is authoritative" }).ok, true);
    const f = t.oi.view("fixture-co").fields.website; assert.equal(f.status, "CONFLICT_RESOLVED_BY_REVIEW"); assert.equal(f.value, "fixture-co.org"); assert.equal(f.candidates.length, 2);
    assert.equal(t.oi.resolveConflict("fixture-co", "legalName", "x", { reviewer: "JOCI" }).reason, "NO_CONFLICT");
  } finally { t.done(); }
});

test("provenance and confidence are mandatory; non-approved sources are refused (default approves nothing but manual)", () => {
  const t = mk(); try {
    assert.equal(t.oi.assertField("fixture-co", "industry", "software", { provenance: SRC.a }).reason, "CONFIDENCE_REQUIRED_0_TO_1");
    assert.equal(t.oi.assertField("fixture-co", "industry", "software", { confidence: 0.5 }).reason, "PROVENANCE_REQUIRED");
    assert.equal(t.oi.assertField("fixture-co", "industry", "software", { provenance: { ...SRC.a, url: "http://registry.fixture-gov.org/x" }, confidence: 0.5 }).reason, "PROVENANCE_URL_INVALID");
    assert.equal(t.oi.assertField("fixture-co", "industry", "software", { provenance: { ...SRC.a, sourceId: "random-scrape" }, confidence: 0.5 }).reason, "SOURCE_NOT_APPROVED");
    assert.equal(t.oi.assertField("fixture-co", "industry", "software", { provenance: { ...SRC.a, observedAt: "yesterday" }, confidence: 0.5 }).reason, "PROVENANCE_OBSERVED_AT_INVALID");
    assert.equal(t.oi.assertField("fixture-co", "industry", "software", { provenance: SRC.a, confidence: 1.5 }).reason, "CONFIDENCE_REQUIRED_0_TO_1");
    const def = createOrgIntelligence({}); assert.equal(def.assertField("x1", "industry", "s", { provenance: SRC.a, confidence: 0.5 }).reason, "SOURCE_NOT_APPROVED");
    assert.equal(def.assertField("x1", "industry", "s", { provenance: { sourceId: "manual", observedAt: "2026-10-01T00:00:00Z" }, confidence: 0.5 }).reason, "MANUAL_SOURCE_NEEDS_EVIDENCE_NOTE");
    assert.equal(def.assertField("x1", "industry", "s", { provenance: { sourceId: "manual", evidenceNote: "owner call notes", observedAt: "2026-10-01T00:00:00Z" }, confidence: 0.5 }).ok, true);
  } finally { t.done(); }
});

test("personal data and secrets are refused in organisation fields; unknown field names and prototype ids are refused", () => {
  const t = mk(); try {
    assert.equal(t.oi.assertField("fixture-co", "description", "contact ada@fixture-co.org", { provenance: SRC.a, confidence: 0.5 }).reason, "PERSONAL_DATA_NOT_ALLOWED_IN_ORG_FIELD");
    assert.equal(t.oi.assertField("fixture-co", "businessAddress", "call +1 604 555 0199 now", { provenance: SRC.a, confidence: 0.5 }).reason, "PERSONAL_DATA_NOT_ALLOWED_IN_ORG_FIELD");
    assert.equal(t.oi.assertField("fixture-co", "description", "key sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2", { provenance: SRC.a, confidence: 0.5 }).reason, "SECRET_REFUSED");
    assert.equal(t.oi.assertField("fixture-co", "ceoHomeAddress", "x", { provenance: SRC.a, confidence: 0.5 }).reason, "FIELD_NOT_ALLOWED");
    assert.equal(t.oi.assertField("__proto__", "industry", "x", { provenance: SRC.a, confidence: 0.5 }).reason, "ORG_ID_INVALID");
    assert.equal(t.oi.assertField("fixture-co", "industry", "", { provenance: SRC.a, confidence: 0.5 }).reason, "VALUE_REQUIRED_USE_NO_ASSERTION_FOR_UNKNOWN");
    assert.equal(t.oi.assertField("fixture-co", "industry", "x".repeat(600), { provenance: SRC.a, confidence: 0.5 }).reason, "VALUE_INVALID");
  } finally { t.done(); }
});

test("decision makers go through buyer-decision-maker-finder: business contacts only, lawful basis required, verified only with evidence", () => {
  const t = mk(); try {
    assert.equal(t.oi.addContact("fixture-co", contact, { provenance: SRC.a }).reason, "LAWFUL_BASIS_REQUIRED");
    assert.equal(t.oi.addContact("fixture-co", { ...contact, businessContact: false }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "BUSINESS_CONTACT_ONLY");
    assert.equal(t.oi.addContact("fixture-co", { ...contact, email: "not-an-email" }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "CONTACT_EMAIL_INVALID");
    const r = t.oi.addContact("fixture-co", { ...contact, verified: true }, { provenance: SRC.a, lawfulBasis: "PUBLIC_BUSINESS_ROLE" });
    assert.equal(r.ok, true); assert.equal(r.ready, true);
    const dm = t.oi.decisionMakers("fixture-co"); assert.equal(dm.length, 1); assert.equal(dm[0].verified, false, "a caller-supplied verified flag is ignored without evidence"); assert.equal(dm[0].source, "fx-registry"); assert.equal("subjectKeys" in dm[0], false);
    t.oi.addContact("fixture-co", { name: "Bo Example", email: "bo@fixture-co.org", businessContact: true, confidence: 0.4 }, { provenance: SRC.b, lawfulBasis: "LEGITIMATE_INTEREST_B2B", verificationEvidence: "role confirmed on company team page" });
    assert.equal(t.oi.decisionMakers("fixture-co")[0].name, "Bo Example", "verified contacts rank first (rankContacts)");
  } finally { t.done(); }
});

test("buyerQuery is a PLAN only (executable:false) and refuses to build from conflicted identity fields", () => {
  const t = mk(); try {
    t.oi.assertField("fixture-co", "legalName", "Fixture Co Ltd", { provenance: SRC.a, confidence: 0.9 }); t.oi.assertField("fixture-co", "legalName", "Fixture Holdings", { provenance: SRC.b, confidence: 0.9 });
    assert.equal(t.oi.buyerQuery("fixture-co").reason, "NEEDS_UNCONFLICTED_NAME_OR_WEBSITE");
    t.oi.assertField("fixture-co", "website", "https://fixture-co.org", { provenance: SRC.a, confidence: 0.9 });
    const q = t.oi.buyerQuery("fixture-co", { need: "accessibility audit" }); assert.equal(q.ok, true); assert.equal(q.executable, false); assert.equal(q.plan.domain, "fixture-co.org"); assert.equal(q.plan.company, null);
  } finally { t.done(); }
});

test("GDPR-style export returns every record about the person; forget removes them and suppresses re-adding", () => {
  const t = mk(); try {
    t.oi.addContact("fixture-co", contact, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" });
    t.oi.addContact("other-co", { ...contact, title: "Advisor" }, { provenance: SRC.b, lawfulBasis: "LEGITIMATE_INTEREST_B2B" });
    const ex = t.oi.exportSubject("ADA@fixture-co.org"); assert.equal(ex.records.length, 2); assert.deepEqual(ex.records.map(r => r.orgId).sort(), ["fixture-co", "other-co"]);
    const f = t.oi.forgetSubject("ada@fixture-co.org", { requestRef: "DSR-1" }); assert.equal(f.removed, 2);
    assert.equal(t.oi.exportSubject("ada@fixture-co.org").records.length, 0);
    assert.equal(t.oi.addContact("fixture-co", contact, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "SUBJECT_SUPPRESSED_AFTER_FORGET");
    assert.equal(t.oi.addContact("fixture-co", { name: "Ada Example", businessContact: true }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "SUBJECT_SUPPRESSED_AFTER_FORGET", "the name linked to the forgotten e-mail is suppressed too");
  } finally { t.done(); }
});

test("forget leaves no personal data in the store file or the audit log (hashes only)", () => {
  const t = mk(); try {
    t.oi.addContact("fixture-co", contact, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }); t.oi.forgetSubject("ada@fixture-co.org");
    const store = fs.readFileSync(path.join(t.dir, "org-intelligence.json"), "utf8"), log = fs.readFileSync(path.join(t.dir, "org-intelligence-audit.jsonl"), "utf8");
    for (const s of [store, log]) { assert.doesNotMatch(s, /ada@fixture-co\.org/i); assert.doesNotMatch(s, /Ada Example/); }
    assert.equal(t.oi.auditVerify().ok, true);
  } finally { t.done(); }
});

test("persistence across instances; a corrupt store fails closed instead of starting empty", () => {
  const t = mk(); try {
    t.oi.assertField("fixture-co", "legalName", "Fixture Co Ltd", { provenance: SRC.a, confidence: 0.9 });
    assert.equal(t.open().view("fixture-co").fields.legalName.value, "Fixture Co Ltd");
    fs.writeFileSync(path.join(t.dir, "org-intelligence.json"), "{oops"); assert.throws(() => t.open(), /ORG_STORE_UNREADABLE/);
  } finally { t.done(); }
});

test("bounds: assertions per field are capped (oldest dropped) and a throwing source check fails closed", () => {
  const t = mk(); try {
    for (let i = 0; i < 25; i++) t.oi.assertField("fixture-co", "industry", "industry " + i, { provenance: SRC.a, confidence: 0.5 });
    assert.equal(t.oi.view("fixture-co").fields.industry.candidates.length, 20);
    const thr = createOrgIntelligence({ isSourceApproved: () => { throw new Error("x"); } });
    assert.equal(thr.assertField("x1", "industry", "s", { provenance: SRC.a, confidence: 0.5 }).reason, "SOURCE_NOT_APPROVED");
  } finally { t.done(); }
});

test("contacts are bounded per organisation and malformed contact fields (control chars, secrets) are refused", () => {
  const t = mk(); try {
    for (let i = 0; i < 50; i++) assert.equal(t.oi.addContact("fixture-co", { name: "Person " + i, email: `p${i}@fixture-co.org`, businessContact: true, confidence: 0.5 }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).ok, true);
    assert.equal(t.oi.addContact("fixture-co", { name: "One more", businessContact: true }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "CONTACT_LIMIT");
    assert.equal(t.oi.addContact("o2", { name: "x\u0000y", businessContact: true }, { provenance: SRC.a, lawfulBasis: "CONSENT" }).reason, "CONTACT_FIELD_INVALID:name");
    assert.equal(t.oi.addContact("o2", { title: "ghp_" + "a".repeat(36), name: "n", businessContact: true }, { provenance: SRC.a, lawfulBasis: "CONSENT" }).reason, "CONTACT_FIELD_INVALID:title");
    assert.equal(t.oi.addContact("o2", { businessContact: true }, { provenance: SRC.a, lawfulBasis: "CONSENT" }).reason, "CONTACT_NAME_OR_EMAIL_REQUIRED");
  } finally { t.done(); }
});

test("export/forget need a subject key; forgetting an unknown subject is harmless and still suppresses it", () => {
  const t = mk(); try {
    assert.equal(t.oi.exportSubject("").reason, "SUBJECT_KEY_REQUIRED"); assert.equal(t.oi.forgetSubject(null).reason, "SUBJECT_KEY_REQUIRED");
    assert.equal(t.oi.forgetSubject("nobody@fixture-co.org").removed, 0);
    assert.equal(t.oi.addContact("fixture-co", { email: "nobody@fixture-co.org", businessContact: true }, { provenance: SRC.a, lawfulBasis: "CONSENT" }).reason, "SUBJECT_SUPPRESSED_AFTER_FORGET");
    assert.equal(t.oi.summary().state, "IMPLEMENTED_NOT_CONNECTED");
  } finally { t.done(); }
});

test("the module contains no network or scraping code", () => {
  const src = fs.readFileSync(new URL("../atlasz-addons/org-intelligence.mjs", import.meta.url), "utf8").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  for (const re of [/\bfetch\s*\(/, /node:https?/, /node:net/, /child_process/, /puppeteer|playwright|cheerio/]) assert.doesNotMatch(src, re);
});

test("different domains stay different (acme-shop.hu vs acme.shop.hu); same host in different spellings still agrees", () => {
  const t = mk(); try {
    const P = { provenance: SRC.a, confidence: 0.9 }, Q = { provenance: SRC.b, confidence: 0.9 };
    t.oi.assertField("o1", "website", "https://acme-shop.hu", P); t.oi.assertField("o1", "website", "http://acme.shop.hu/", Q);
    assert.equal(t.oi.view("o1").conflicts.length, 1, "two different domains are a conflict, not a merge");
    t.oi.assertField("o2", "website", "https://www.Acme-Shop.hu/", P); t.oi.assertField("o2", "website", "acme-shop.hu", Q);
    assert.equal(t.oi.view("o2").conflicts.length, 0);
  } finally { t.done(); }
});
test("name-only export/forget are CANDIDATES: two people with one name are never removed together; an e-mail key is exact", () => {
  const t = mk(); try {
    const A = { name: "Kovacs Peter", email: "peter.kovacs@a-co.org", businessContact: true }, B = { name: "Kovacs Peter", email: "peter.kovacs@b-co.org", businessContact: true };
    const a = t.oi.addContact("a-co", A, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }), b = t.oi.addContact("b-co", B, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" });
    const ex = t.oi.exportSubject("Kovacs Peter"); assert.equal(ex.match, "NAME_ONLY_CANDIDATES"); assert.equal(ex.records.length, 2); assert.ok(ex.records.every(r => r.candidate));
    const f = t.oi.forgetSubject("Kovacs Peter"); assert.equal(f.ok, false); assert.equal(f.candidates.length, 2);
    assert.equal(t.oi.exportSubject("peter.kovacs@a-co.org").records.length, 1);
    assert.equal(t.oi.forgetSubject("Kovacs Peter", { contactIds: [a.contactId] }).removed, 1); assert.equal(t.oi.exportSubject("peter.kovacs@b-co.org").records.length, 1);
    assert.equal(t.oi.exportSubject("peter kovacs a co org").records.length, 0, "an e-mail-like phrase is not an e-mail key");
  } finally { t.done(); }
});

test("forgetting one person does not block other people who share the name (identity = e-mail); a name-only re-add is still refused", () => {
  const t = mk(); try {
    t.oi.addContact("a-co", { name: "John Smith", email: "john@a-co.org", businessContact: true }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" });
    assert.equal(t.oi.forgetSubject("john@a-co.org").removed, 1);
    assert.equal(t.oi.addContact("b-co", { name: "John Smith", email: "john.smith@b-co.org", businessContact: true }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).ok, true);
    assert.equal(t.oi.addContact("a-co", { name: "John Smith", email: "john@a-co.org", businessContact: true }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "SUBJECT_SUPPRESSED_AFTER_FORGET");
    assert.equal(t.oi.addContact("c-co", { name: "John Smith", businessContact: true }, { provenance: SRC.a, lawfulBasis: "LEGITIMATE_INTEREST_B2B" }).reason, "SUBJECT_SUPPRESSED_AFTER_FORGET");
  } finally { t.done(); }
});
