import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createUniversalInbox } from "../atlasz-addons/universal-inbox.mjs";
import { tmp, rm } from "./helpers.mjs";

const key = generateOwnerKeyPair(), ownerAuth = createOwnerAuth({ publicKeyB64: key.publicKeyB64 });
const sign = (a, s) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action: a, subject: s });
const ev = { probeId: "p1", outcome: "PASS", at: new Date().toISOString(), target: "mail" };
const open = { allowed: true };

test("ingest dedupes, prioritises, persists across restart, and a payment event is an UNVERIFIED_CLAIM", () => {
  const d = tmp("inb-");
  try {
    let ib = createUniversalInbox({ dir: d, ownerAuth, gate: () => open });
    assert.equal(ib.ingest({ source: "EMAIL", externalId: "m1", from: "c@x.com", subject: "Question about the quote", body: "please reply" }).priority, "NORMAL");
    assert.equal(ib.ingest({ source: "EMAIL", externalId: "m1", subject: "dup" }).duplicate, true);
    assert.equal(ib.ingest({ source: "PAYMENT_EVENT", externalId: "p1", subject: "Customer says paid invoice 7" }).priority, "HIGH");
    ib.ingest({ source: "SYSTEM_ALERT", externalId: "a1", subject: "Safe mode entered", body: "crash loop" });
    assert.throws(() => ib.ingest({ source: "SMS", externalId: "1" }), /UNKNOWN_SOURCE/);
    ib = createUniversalInbox({ dir: d, ownerAuth, gate: () => open });
    const l = ib.list(); assert.equal(l.length, 3); assert.equal(l[0].priority, "CRITICAL");
    assert.equal(ib.list({ source: "PAYMENT_EVENT" })[0].verification, "UNVERIFIED_CLAIM");
    ib.mark("EMAIL:m1", "READ"); assert.equal(ib.list({ status: "READ" }).length, 1); assert.equal(ib.verify().ok, true);
  } finally { rm(d); }
});
test("DRAFT != SENT: sending needs a proven connector, the kill switch open, an owner approval for THAT item, and provider acceptance evidence", async () => {
  const d = tmp("inb-");
  try {
    let stop = open, calls = 0;
    const ib = createUniversalInbox({ dir: d, ownerAuth, gate: () => stop });
    ib.ingest({ source: "EMAIL", externalId: "m1", from: "c@x.com", subject: "Quote?" });
    await assert.rejects(ib.send("EMAIL:m1", {}), /NO_DRAFT_TO_SEND/);
    ib.draftReply("EMAIL:m1", "Here is the quote");
    assert.equal(ib.list()[0].sent.length, 0);
    const conn = { tested: true, probeEvidence: ev, send: async () => { calls++; return { providerMessageId: "msg-1" }; } };
    assert.equal((await ib.send("EMAIL:m1", {})).reason, "EXTERNAL_SENDING_DISABLED_NO_CONNECTOR");
    assert.equal((await ib.send("EMAIL:m1", { connector: { ...conn, probeEvidence: null } })).reason, "CONNECTOR_NOT_PROVEN_LIVE");
    assert.match((await ib.send("EMAIL:m1", { connector: conn })).reason, /OWNER_APPROVAL_REQUIRED/);
    assert.match((await ib.send("EMAIL:m1", { connector: conn, ownerApproval: sign("INBOX_SEND", "EMAIL:other") })).reason, /OWNER_APPROVAL_REQUIRED/);
    stop = { allowed: false, reason: "PAUSE_ALL" };
    assert.match((await ib.send("EMAIL:m1", { connector: conn, ownerApproval: sign("INBOX_SEND", "EMAIL:m1") })).reason, /BLOCKED_BY_STOP/);
    stop = open; assert.equal(calls, 0);
    assert.equal((await ib.send("EMAIL:m1", { connector: { ...conn, send: async () => ({}) }, ownerApproval: sign("INBOX_SEND", "EMAIL:m1") })).reason, "NO_PROVIDER_ACCEPTANCE_EVIDENCE");
    const r = await ib.send("EMAIL:m1", { connector: conn, ownerApproval: sign("INBOX_SEND", "EMAIL:m1") }); assert.equal(r.sent, true); assert.equal(ib.list()[0].sent[0].providerMessageId, "msg-1");
  } finally { rm(d); }
});
test("syncSystem mirrors approvals, safe mode, dead letters and blockers idempotently", () => {
  const d = tmp("inb-");
  try {
    const ib = createUniversalInbox({ dir: d, ownerAuth, gate: () => open });
    const input = { approvals: [{ id: "ap1", requestedBy: "S1", what: "Send quote", why: "won" }], status: { safeMode: { mode: "SAFE_MODE", reason: "CRASH_LOOP" }, queue: { dead: 2 }, blockers: [{ code: "OUTREACH_NOT_CONNECTED", detail: "none" }] } };
    assert.equal(ib.syncSystem(input).added, 4); assert.equal(ib.syncSystem(input).added, 0);
    assert.equal(ib.counts().bySource.APPROVAL_REQUEST, 1); assert.ok(ib.counts().critical >= 2);
  } finally { rm(d); }
});
