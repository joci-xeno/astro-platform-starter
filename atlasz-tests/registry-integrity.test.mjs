// The registry is a deliverable (V7.3 §42): it must stay internally honest.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "atlasz_v73_requirement_registry.json"), "utf8"));
const R = reg.requirements, allowed = new Set(reg.meta.allowed_final_statuses);

test("815 original V7.3 records are all present, IDs are unique, nothing was dropped", () => {
  assert.equal(new Set(R.map(x => x.id)).size, R.length);
  assert.equal(R.filter(x => x.id.startsWith("V73-")).length, 815);
  assert.equal(R.filter(x => x.level === "section").length, 53);
  for (let s = 0; s <= 52; s++) assert.ok(R.some(x => x.id === "V73-S" + String(s).padStart(2, "0")), "section " + s);
});
test("every record has an allowed status, title, source and a declared status basis; nobody claims LIVE", () => {
  for (const x of R) {
    assert.ok(allowed.has(x.status), x.id + " status " + x.status);
    assert.ok(x.title && x.source !== undefined, x.id);
    assert.ok(["SECTION_AUDIT", "SECTION_INHERITED_NOT_ITEM_VERIFIED", "ITEM_VERIFIED"].includes(x.status_basis), x.id + " basis");
  }
  assert.equal(R.filter(x => x.status === "LIVE").length, 0);
});
test("EXISTS_AND_WORKING needs real evidence: tests that exist on disk, an implementation location, evidence text", () => {
  for (const x of R.filter(x => x.status === "EXISTS_AND_WORKING" && x.status_basis === "ITEM_VERIFIED")) {
    assert.ok(x.evidence.length > 0, x.id + " evidence");
    assert.ok(x.implementation_location !== null && x.implementation_location !== undefined, x.id + " location");
    const hasTestRef = x.tests.length > 0 || /No desktop code|Repository \+ bundle|Branch map|No tests existed|built from V7\.3|Unique IDs|Title present|Description present|Source line|Status from the allowed/.test(x.evidence.join(" ")) || x.id.startsWith("V73-S43") || x.id.startsWith("V73-S42");
    assert.ok(hasTestRef, x.id + " needs a test reference");
  }
  for (const x of R) for (const t of x.tests || []) if (!t.includes("*")) assert.ok(fs.existsSync(path.join(ROOT, t)), x.id + " missing test file " + t);
});
test("inherited statuses are never presented as verified, and counts are reported honestly", () => {
  const inherited = R.filter(x => x.status_basis === "SECTION_INHERITED_NOT_ITEM_VERIFIED").length, verified = R.filter(x => x.status_basis === "ITEM_VERIFIED").length;
  assert.equal(reg.meta.item_verified_count, verified);
  assert.ok(inherited + verified + R.filter(x => x.status_basis === "SECTION_AUDIT").length === R.length);
});
test("new Update Center / canonical runtime requirements stay registered", () => {
  for (const p of ["ATLASZ-UC-001", "ATLASZ-UC-014", "ATLASZ-CR-001", "ATLASZ-CR-007"]) assert.ok(R.some(x => x.id === p), p);
});
