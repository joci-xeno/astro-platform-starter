// Runs directive demonstrations A-H (scripts/demonstrations.mjs) as a test, so the evidence file is reproducible and cannot silently rot. Local isolated runs only.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { runDemonstrations } from "../scripts/demonstrations.mjs";
test("demonstrations A-H: every check passes; blocked parts carry an explicit blocker; origin of data is always stated", { timeout: 60000 }, async () => {
  const res = await runDemonstrations(); assert.deepEqual(res.map(r => r.id), ["A", "B", "C", "D", "E", "F", "G", "H"]);
  for (const r of res) { assert.ok(r.origin.length > 10, r.id); assert.deepEqual(r.checks.filter(c => !c.ok).map(c => c.name), [], "demo " + r.id); }
  for (const id of ["A", "F", "G"]) assert.ok(res.find(r => r.id === id).blocker, id + " must state its blocker honestly");
  const ev = JSON.parse(fs.readFileSync(new URL("../docs/audit/demonstrations_evidence.json", import.meta.url), "utf8")); assert.equal(ev.demonstrations.length, 8);
});
