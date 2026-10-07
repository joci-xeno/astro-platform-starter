import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmp, rm } from "./helpers.mjs";
import { createControlCenterCore } from "../atlasz-control-center/core.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createUniversalInbox } from "../atlasz-addons/universal-inbox.mjs";

test("Control Center systems panels reflect real module state and stay honest when nothing is attached", async () => {
  const base = tmp("ccs-"), configDir = path.join(base, "c"), stateDir = path.join(base, "s");
  const core = createControlCenterCore({ stateDir, configDir });
  try {
    // empty: nothing is live, nothing invented
    assert.equal(core.documents().summary.total, 0);
    assert.equal(core.inbox().counts.total, 0);
    const v = core.voice(); assert.equal(v.live, false); assert.match(v.note, /BLOCKED/);
    const c = core.connectors(); assert.equal(c.live, 0); assert.ok(c.blockedNoCredentials >= 7); assert.ok(c.noSafeProbe + c.blockedNoCredentials === c.total || c.total >= 12);
    assert.equal(core.techWatch().status, "NO_FEED");
    // real data written through the modules shows up
    const f = path.join(base, "note.txt"); fs.writeFileSync(f, "Invoice total 120.50 for job 7");
    createDocumentCenter({ dir: path.join(stateDir, "documents") }).ingest({ filePath: f, tenantId: "JOCI" });
    createUniversalInbox({ dir: path.join(stateDir, "inbox") }).ingest({ source: "SYSTEM_ALERT", subject: "disk low", body: "x", externalId: "a1", priority: "HIGH" });
    assert.equal(core.documents().summary.total, 1); assert.equal(core.documents().items[0].name, "note.txt");
    assert.equal(core.inbox().counts.total, 1); assert.notEqual(core.inbox().chain.ok, false);
    // tech watch reads a feed and compares to the installed baseline pack
    fs.mkdirSync(path.join(configDir, "tech-watch"), { recursive: true });
    fs.writeFileSync(path.join(configDir, "tech-watch", "f.json"), JSON.stringify({ entries: [{ componentId: "atlasz-extension-pack", version: "9.0.0", severity: "RECOMMENDED" }] }));
    const t = core.techWatch(); assert.equal(t.status, "OK"); assert.equal(t.advisories[0].available, "9.0.0");
  } finally { rm(base); }
});
