import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTechWatch, cmpVer, validateFeedEntry } from "../atlasz-addons/tech-watch.mjs";
import { tmp, rm } from "./helpers.mjs";

test("tech-watch: no feed -> NO_FEED and no advisories (never invents news)", () => {
  const d = tmp();
  try {
    const w = createTechWatch({ feedDir: path.join(d, "none"), installed: () => [{ componentId: "x", version: "1.0.0" }] });
    const r = w.scan();
    assert.equal(r.status, "NO_FEED"); assert.deepEqual(r.advisories, []);
  } finally { rm(d); }
});
test("tech-watch: newer versions flagged with compat; older/equal/unknown components ignored; bad entries rejected", () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, "a.json"), JSON.stringify({ entries: [
      { componentId: "x", version: "1.2.0", severity: "SECURITY", notes: "fix" },
      { componentId: "x", version: "0.9.0" },
      { componentId: "y", version: "2.0.0", minNode: "99.0.0", breaking: true },
      { componentId: "z", version: "5.0.0" },
      { componentId: "x", version: "latest" }, { version: "1.0.0" }, { componentId: "x", version: "1.3.0", severity: "BOGUS" }
    ] }));
    fs.writeFileSync(path.join(d, "bad.json"), "{nope");
    const w = createTechWatch({ feedDir: d, nodeVersion: "22.1.0", installed: () => [{ componentId: "x", version: "1.1.0" }, { componentId: "y", version: "1.0.0" }] });
    const r = w.scan();
    assert.equal(r.status, "OK");
    assert.deepEqual(r.advisories.map(a => a.componentId + ":" + a.available), ["x:1.2.0", "y:2.0.0"]);
    assert.equal(r.advisories[0].severity, "SECURITY");
    assert.match(r.advisories[1].compatibility, /INCOMPATIBLE_NODE/); assert.equal(r.advisories[1].breaking, true);
    assert.equal(r.rejected.length, 4);                       // 3 bad entries + invalid json file
    assert.ok(r.advisories.every(a => /APPROVAL/.test(a.action)));
  } finally { rm(d); }
});
test("tech-watch: capability gaps come from registry state and empty slots; semver helper is strict", () => {
  const d = tmp();
  const w = createTechWatch({ feedDir: d, completion: () => [{ id: "a", title: "A", state: "LIVE" }, { id: "b", title: "B", state: "BLOCKED", blockedBy: ["creds"] }], slots: [{ slot: "stt", state: "EMPTY" }, { slot: "llm", state: "LIVE", provider: "p" }] });
  try {
    const r = w.scan();
    assert.equal(r.capabilityGaps.notLive, 1); assert.equal(r.capabilityGaps.items[0].id, "b");
    assert.deepEqual(r.capabilityGaps.emptySlots.map(s => s.slot), ["stt"]);
    assert.equal(cmpVer("1.10.0", "1.9.0"), 1); assert.equal(cmpVer("1.0", "1.0.0"), null);
    assert.deepEqual(validateFeedEntry({ componentId: "a", version: "1.0.0" }), []);
  } finally { rm(d); }
});
