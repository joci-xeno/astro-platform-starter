import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createApprovalRequests } from "../atlasz-addons/approval-requests.mjs";

test("Home: brief reflects real state; prefs are validated; chat answers from state and refuses owner controls; approvals carry a human-impact verdict", async () => {
  const base = tmp("cch-"), core = createControlCenterCore({ stateDir: path.join(base, "s"), configDir: path.join(base, "c") });
  try {
    let b = await core.brief(); assert.match(b.text, /Indul a mandula!/); assert.match(b.text, /nem fut/); assert.equal(b.falseClaimCheck, true);
    core.setPrefs({ language: "en", signaturePhrase: "Ready when you are", greetingName: "<script>" });          // unsafe name is ignored
    b = await core.brief(); assert.match(b.text, /Hello Joci — Ready when you are/); assert.doesNotMatch(b.text, /script/);
    assert.equal(core.setPrefs({ language: "xx" }).language, "en");
    assert.equal((await core.chat({ q: "please pause everything" })).intent, "OWNER_CONTROL");
    assert.equal((await core.chat({ q: "money" })).intent, "MONEY");
    const store = createApprovalRequests({ dir: path.join(base, "s", "approvals") });
    store.request({ action: "SEND_QUOTE", subject: "q1", requestedBy: "SEARCH-1", what: "Send quote to a client", why: "Won deal", costUsd: 0, risk: { level: "MEDIUM", description: "external" }, externalEffect: "Email goes to client", reversible: false, irreversibleNote: "sent mail", ifOwnerSaysNo: "Nothing sent", noSpendAlternative: "Draft only" });
    const pend = core.approvals().pending; assert.equal(pend.length, 1); 
    assert.equal(pend[0].humanImpact.verdict, "NEEDS_JOCI"); assert.ok(pend[0].humanImpact.reasons.includes("IRREVERSIBLE_EXTERNAL_EFFECT"));
  } finally { rm(base); }
});
