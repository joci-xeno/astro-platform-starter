import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, clean, linearRegression, groupBy, chartSpecs, LIMITS } from "../atlasz-addons/analyst.mjs";

test("analyst mutation: a quote only opens a quoted cell at the start of a cell", () => {
  assert.deepEqual(parseCsv('h\nab"c"d').rows, [['ab"c"d']]);
});
test("analyst mutation: exact row cap and trailing blank rows are dropped", () => {
  assert.equal(parseCsv("a\n" + "1\n".repeat(LIMITS.maxRows)).ok, true);
  assert.equal(parseCsv("a\n" + "1\n".repeat(LIMITS.maxRows + 1)).reason, "TOO_MANY_ROWS");
  assert.deepEqual(parseCsv("a\n1\n\n\n").rows, [["1"]]);
});
test("analyst mutation: exact column cap", () => {
  const hdr = n => Array.from({ length: n }, (_, i) => "c" + i).join(",");
  assert.equal(parseCsv(hdr(LIMITS.maxCols)).ok, true);
  assert.equal(parseCsv(hdr(LIMITS.maxCols + 1)).reason, "TOO_MANY_COLUMNS");
});
test("analyst mutation: clean logs and errors", () => {
  assert.equal(clean({ headers: ["a"], rows: [[" x"], ["y"], ["z "]] }, [{ op: "trim" }]).log[0].changed, 2);
  assert.equal(clean({ headers: ["a"], rows: [["x"], [""]] }, [{ op: "fillMissing", column: "a", strategy: "mean" }]).reason, "NO_NUMERIC_VALUES:a");
  const d = clean({ headers: ["a"], rows: [["1"], ["1"], ["2"]] }, [{ op: "dropDuplicates" }]);
  assert.equal(d.rows.length, 2); assert.equal(d.log[0].removed, 1);
});
test("analyst mutation: r2 is r squared (positive for negative correlation)", () => {
  const L = linearRegression([1, 2, 3, 4], [8, 6, 4, 2]);
  assert.ok(Math.abs(L.r2 - 1) < 1e-12);
  const M = linearRegression([1, 2, 3, 4, 5], [5, 3, 4, 1, 2]);
  assert.ok(M.r2 > 0 && M.r2 < 1);
});
test("analyst mutation: groupBy category cap and key ordering", () => {
  const rows = n => Array.from({ length: n }, (_, i) => ["k" + String(i).padStart(3, "0"), "1"]);
  const d = n => ({ headers: ["g", "v"], rows: rows(n) });
  assert.equal(groupBy(d(LIMITS.maxCategories), "g", "v").ok, true);
  assert.equal(groupBy(d(LIMITS.maxCategories + 1), "g", "v").reason, "TOO_MANY_CATEGORIES");
  const g = groupBy({ headers: ["g", "v"], rows: [["b", "1"], ["c", "2"], ["a", "3"], ["b", "4"]] }, "g", "v");
  assert.deepEqual(g.groups.map(x => x.key), ["a", "b", "c"]); assert.equal(g.groups[1].value, 5);
});
test("analyst mutation: chartSpecs picks a usable category column and at most 3 histograms", () => {
  const data = { headers: ["same", "cat", "v"], rows: [["s", "a", "1"], ["s", "b", "2"], ["s", "a", "3"]] };
  const bar = chartSpecs(data).find(s => s.type === "bar");
  assert.equal(bar.title, "v by cat (sum)"); assert.deepEqual(bar.values, [4, 2]);
  const wide = { headers: ["n1", "n2", "n3", "n4"], rows: [["1", "2", "3", "4"], ["5", "6", "7", "9"]] };
  assert.equal(chartSpecs(wide).filter(s => s.type === "histogram").length, 3);
  const many = { headers: ["c", "v"], rows: Array.from({ length: 51 }, (_, i) => ["k" + i, "1"]) };
  assert.equal(chartSpecs(many).some(s => s.type === "bar"), false);
});
