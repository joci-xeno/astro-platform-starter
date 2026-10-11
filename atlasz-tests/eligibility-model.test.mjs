// W6 Global Business §2 / report §5.4: jurisdiction & eligibility evaluator - never guesses; cross-border -> LEGAL_REVIEW_REQUIRED.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateEligibility, validateProfile, profileHash, createCapabilityProfileStore } from "../atlasz-addons/eligibility-model.mjs";
import { validateRecord } from "../atlasz-addons/source-adapters.mjs";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import * as AC from "../atlasz-addons/audit-chain.mjs";
import { tmp, rm } from "./helpers.mjs";

const NOW = Date.parse("2026-10-10T00:00:00Z");
const PROFILE = { profileId: "atlasz-ext", homeCountry: "CA", homeCurrency: "CAD", currencies: ["CAD", "USD"], languages: ["en", "hu"], remoteOnly: true,
  licences: [{ id: "BC-BUSINESS", jurisdiction: "CA", expiresAt: "2027-01-01" }, { id: "OLD-PERMIT", jurisdiction: "CA", expiresAt: "2025-01-01" }],
  insurance: [{ type: "professional-liability", coverage: 1000000, currency: "CAD", expiresAt: "2027-06-01" }],
  registrations: [{ type: "GST", jurisdiction: "CA" }], companyFoundedAt: "2023-03-01" };
const OPP = { country: "CA", currency: "CAD", deadline: "2026-12-01", requirements: { physicalPresence: false, licences: ["bc-business"], insurance: [{ type: "professional-liability", minCoverage: 500000, currency: "CAD" }], registrations: ["gst"], languages: ["en"], minCompanyAgeYears: 2 } };
const ev = (o, p = PROFILE) => evaluateEligibility(o, p, { now: NOW });
const withReq = patch => ({ ...OPP, requirements: { ...OPP.requirements, ...patch } });

test("all requirements known and met at home -> ELIGIBLE, executable, no legal flag", () => {
  const r = ev(OPP); assert.equal(r.verdict, "ELIGIBLE"); assert.equal(r.executable, true); assert.equal(r.legalReviewRequired, false); assert.equal(r.reasons.length, 0);
  assert.equal(r.checks.length, 7); assert.ok(r.checks.every(c => c.result === "PASS"));
});

test("unknown requirements are UNKNOWN_NEEDS_REVIEW, never guessed as met (each criterion separately)", () => {
  for (const k of ["physicalPresence", "licences", "insurance", "registrations", "languages", "minCompanyAgeYears"]) {
    const r = ev(withReq({ [k]: null })); assert.equal(r.verdict, "UNKNOWN_NEEDS_REVIEW", k); assert.equal(r.executable, false, k); assert.ok(r.reasons.some(x => /UNKNOWN/.test(x)), k);
  }
  const noCur = ev({ ...OPP, currency: null }); assert.equal(noCur.verdict, "UNKNOWN_NEEDS_REVIEW"); assert.ok(noCur.reasons.includes("currency:CURRENCY_UNKNOWN"));
});

test("a record straight from source-adapters with missing requirements is UNKNOWN_NEEDS_REVIEW and flagged COUNTRY_UNKNOWN + LEGAL_REVIEW_REQUIRED", () => {
  const rec = validateRecord({ externalId: "N-2", title: "Data migration" }, { kind: "PROCUREMENT", sourceId: "fx" }).record;
  const r = ev(rec); assert.equal(r.verdict, "UNKNOWN_NEEDS_REVIEW"); assert.ok(r.flags.includes("COUNTRY_UNKNOWN")); assert.ok(r.flags.includes("LEGAL_REVIEW_REQUIRED")); assert.equal(r.executable, false);
});

test("physical presence: remote-only profile -> NOT_ELIGIBLE + NOT_EXECUTABLE; presence country listed -> PASS", () => {
  const r = ev(withReq({ physicalPresence: true })); assert.equal(r.verdict, "NOT_ELIGIBLE"); assert.ok(r.flags.includes("NOT_EXECUTABLE"));
  const p2 = { ...PROFILE, remoteOnly: false, presenceCountries: ["CA"] };
  assert.equal(ev(withReq({ physicalPresence: true }), p2).verdict, "ELIGIBLE");
  assert.equal(ev({ ...withReq({ physicalPresence: true }), country: "US", currency: "USD" }, p2).checks.find(c => c.criterion === "physicalPresence").reason, "NO_PRESENCE_IN_US");
});

test("licences: not held, expired, other jurisdiction -> NOT_ELIGIBLE; none required -> PASS", () => {
  assert.match(ev(withReq({ licences: ["electrician"] })).reasons.join(), /LICENCE_NOT_HELD:electrician/);
  assert.match(ev(withReq({ licences: ["old-permit"] })).reasons.join(), /LICENCE_EXPIRED:old-permit/);
  assert.equal(ev({ ...OPP, country: "US", currency: "USD" }).verdict, "NOT_ELIGIBLE", "a CA licence does not cover a US notice");
  assert.equal(ev(withReq({ licences: [] })).verdict, "ELIGIBLE");
});

test("insurance: coverage too low fails; another currency is UNKNOWN (no FX invented); expired cover is not held", () => {
  assert.match(ev(withReq({ insurance: [{ type: "professional-liability", minCoverage: 5000000, currency: "CAD" }] })).reasons.join(), /COVERAGE_TOO_LOW/);
  const fx = ev(withReq({ insurance: [{ type: "professional-liability", minCoverage: 100, currency: "EUR" }] })); assert.equal(fx.verdict, "UNKNOWN_NEEDS_REVIEW"); assert.match(fx.reasons.join(), /OTHER_CURRENCY_NO_FX/);
  const exp = { ...PROFILE, insurance: [{ ...PROFILE.insurance[0], expiresAt: "2026-01-01" }] }; assert.match(ev(OPP, exp).reasons.join(), /INSURANCE_NOT_HELD/);
  assert.equal(ev(withReq({ insurance: [{ type: "cyber" }] })).verdict, "NOT_ELIGIBLE");
});

test("registration, language and currency mismatches each make NOT_ELIGIBLE with a named reason", () => {
  assert.match(ev(withReq({ registrations: ["vat"] })).reasons.join(), /REGISTRATION_MISSING:vat/);
  assert.match(ev(withReq({ languages: ["de"] })).reasons.join(), /LANGUAGE_NOT_COVERED:de/);
  assert.match(ev({ ...OPP, currency: "JPY" }).reasons.join(), /CURRENCY_NOT_ACCEPTED:JPY/);
});

test("minimum company age uses the owner's founding date; unknown founding date is UNKNOWN", () => {
  assert.match(ev(withReq({ minCompanyAgeYears: 5 })).reasons.join(), /COMPANY_TOO_YOUNG:3<5/);
  assert.equal(ev(withReq({ minCompanyAgeYears: 3 })).verdict, "ELIGIBLE");
  const { companyFoundedAt, ...noAge } = PROFILE; assert.match(ev(OPP, noAge).reasons.join(), /COMPANY_FOUNDING_DATE_UNKNOWN/);
});

test("cross-border (other country or other currency) is flagged LEGAL_REVIEW_REQUIRED and never executable, even if every rule passes", () => {
  const p = { ...PROFILE, licences: [...PROFILE.licences, { id: "bc-business", jurisdiction: "US" }], registrations: [...PROFILE.registrations, { type: "gst", jurisdiction: "US" }] };
  const r = ev({ ...OPP, country: "US", currency: "USD" }, p); assert.equal(r.verdict, "ELIGIBLE"); assert.equal(r.legalReviewRequired, true); assert.ok(r.flags.includes("LEGAL_REVIEW_REQUIRED")); assert.equal(r.executable, false);
  assert.equal(ev({ ...OPP, currency: "USD" }).legalReviewRequired, true, "home country, foreign currency");
});

test("a passed deadline is NOT_ELIGIBLE; an unknown deadline is not invented", () => {
  assert.match(ev({ ...OPP, deadline: "2026-01-01" }).reasons.join(), /DEADLINE_PASSED/);
  assert.equal(ev({ ...OPP, deadline: null }).verdict, "ELIGIBLE");
});

test("adversarial inputs: missing/garbage opportunity and malformed requirement types never produce ELIGIBLE", () => {
  for (const o of [null, undefined, 42, "x", {}, { requirements: "all" }, { requirements: { licences: "bc-business" } }, { requirements: { minCompanyAgeYears: -1 } }, { country: "Canada", currency: "CAD" }])
    assert.notEqual(ev(o).verdict, "ELIGIBLE", JSON.stringify(o));
});

test("an invalid profile yields UNKNOWN_NEEDS_REVIEW with PROFILE_INVALID (fail closed), never ELIGIBLE", () => {
  for (const p of [null, {}, { ...PROFILE, homeCountry: "Canada" }, { ...PROFILE, languages: ["english"] }, { ...PROFILE, licences: [{ id: "x" }] }, { ...PROFILE, companyFoundedAt: "long ago" }, { ...PROFILE, insurance: [{ type: "x", coverage: -1, currency: "CAD" }] }]) {
    const r = ev(OPP, p); assert.equal(r.verdict, "UNKNOWN_NEEDS_REVIEW"); assert.ok(r.flags.includes("PROFILE_INVALID"));
  }
  assert.equal(validateProfile(PROFILE).profile.remoteOnly, true);
  assert.equal(validateProfile({ ...PROFILE, remoteOnly: undefined }).profile.remoteOnly, true, "default is remote-only");
});

const kp = generateOwnerKeyPair(), otherKp = generateOwnerKeyPair();
const ap = (s, k = kp) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: "CAPABILITY_PROFILE_SET", subject: s });
const subj = p => "capability-profile:" + profileHash(validateProfile(p).profile);

test("profile store: set needs a signed owner approval bound to the exact profile; forged/replayed/mismatched approvals refused", () => {
  const dir = tmp("elig-"); try {
    const s = createCapabilityProfileStore({ ownerAuth: createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), dir });
    assert.equal(s.evaluate(OPP).reasons[0], "NO_OWNER_APPROVED_PROFILE");
    assert.equal(s.set(PROFILE).reason, "OWNER_APPROVAL_REQUIRED");
    assert.equal(s.set(PROFILE, { approval: ap(subj(PROFILE), otherKp) }).detail, "SIGNATURE_INVALID");
    assert.equal(s.set({ ...PROFILE, languages: ["en", "hu", "de"] }, { approval: ap(subj(PROFILE)) }).detail, "SUBJECT_MISMATCH");
    const a = ap(subj(PROFILE)); assert.equal(s.set(PROFILE, { approval: a }).ok, true); assert.equal(s.set(PROFILE, { approval: a }).detail, "REPLAY_DETECTED");
    assert.equal(s.evaluate(OPP, { now: NOW }).verdict, "ELIGIBLE");
  } finally { rm(dir); }
});

test("profile store: a record edited after signing is ignored on read (signature/subject re-checked)", () => {
  const dir = tmp("elig-"); try {
    const auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), s = createCapabilityProfileStore({ ownerAuth: auth, dir });
    s.set(PROFILE, { approval: ap(subj(PROFILE)) });
    const f = path.join(dir, "capability-profile-audit.jsonl"); const { hashEntry, GENESIS } = AC;
    const es = fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)); let prev = GENESIS;
    for (const e of es) { if (e.event === "PROFILE_SET") e.data.profile.licences.push({ id: "electrician", jurisdiction: "CA", expiresAt: null }); e.prevHash = prev; e.hash = hashEntry(e); prev = e.hash; }
    fs.writeFileSync(f, es.map(e => JSON.stringify(e)).join("\n") + "\n");
    assert.throws(() => createCapabilityProfileStore({ ownerAuth: auth, dir }), /AUDIT_CHAIN_TRUNCATED/, "a re-chained log no longer matches the pinned head");
    fs.rmSync(path.join(dir, "capability-profile-audit.headpin.json"));      // an attacker who also rewrites the pin still fails the signature check
    const c = createCapabilityProfileStore({ ownerAuth: auth, dir }).current(); assert.equal(c.profile, null); assert.match(c.integrity, /UNVERIFIED/);
  } finally { rm(dir); }
});

test("profile store requires an owner-auth verifier", () => { assert.throws(() => createCapabilityProfileStore({}), /OWNER_AUTH_REQUIRED/); });

test("profile store: re-appending an old signed record (same approval nonce) is ignored - replay cannot roll the profile back", () => {
  const dir = tmp("elig-rp-"); try {
    const auth = createOwnerAuth({ publicKeyB64: kp.publicKeyB64 }), s = createCapabilityProfileStore({ ownerAuth: auth, dir });
    assert.equal(s.set(PROFILE, { approval: ap(subj(PROFILE)) }).ok, true);
    const f = path.join(dir, "capability-profile-audit.jsonl"), first = JSON.parse(fs.readFileSync(f, "utf8").trim().split("\n")[0]);
    const P2 = structuredClone(PROFILE); P2.licences = [...P2.licences]; P2.notes = "v2";
    const r2 = s.set(P2, { approval: ap(subj(P2)) }); if (r2.ok) { const log = AC.createAuditChain({ filePath: f, headPinFile: path.join(dir, "capability-profile-audit.headpin.json") }); log.append("PROFILE_SET", first.data); }
    const c = createCapabilityProfileStore({ ownerAuth: auth, dir }).current(); assert.match(c.integrity, /UNVERIFIED_RECORDS_IGNORED:1/);
  } finally { rm(dir); }
});
