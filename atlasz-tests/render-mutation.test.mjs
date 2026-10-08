import test from "node:test";
import assert from "node:assert/strict";
import { renderChart, renderDiagram, validateAnnotations, renderAnnotationOverlay, buildGuidance, esc } from "../atlasz-addons/render.mjs";

// Targeted tests that pin boundaries/branches of render.mjs found by mutation testing.
const nodeYs = svg => [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"/g)].map(m => +m[1]);

test("esc: all five HTML-significant characters are escaped, including the single quote", () => {
  assert.equal(esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(esc("it's"), "it&#39;s");
});
test("histogram: 100000 values accepted, 100001 refused; tiny inputs still use at least 3 bins", () => {
  assert.equal(renderChart({ type: "histogram", values: new Array(100001).fill(1) }).reason, "HISTOGRAM_DATA_INVALID");
  assert.equal(renderChart({ type: "histogram", values: new Array(100000).fill(1) }).ok, true);
  assert.equal(renderChart({ type: "histogram", values: [5] }).points, 3);
  assert.equal(renderChart({ type: "histogram", values: [1, 2] }).points, 3);
});
test("short(): labels longer than the limit are truncated with an ellipsis, labels at the limit are kept", () => {
  const long = "x".repeat(50), exact = "y".repeat(40);
  const r = renderChart({ type: "bar", labels: [long, exact], values: [1, 2] });
  assert.ok(r.svg.includes("x".repeat(39) + "…:"), "50-char label cut to 39 chars + ellipsis");
  assert.ok(!r.svg.includes("x".repeat(40)));
  assert.ok(r.svg.includes(exact + ":") && !r.svg.includes(exact + "…"));
});
test("done(): the SVG self-check failure path returns ok:false instead of markup", () => {
  const r = renderChart({ type: "bar", title: "@import url", labels: ["a"], values: [1] });
  assert.equal(r.ok, false); assert.equal(r.reason, "SVG_SELF_CHECK_FAILED"); assert.ok(r.problems.includes("CSS_IMPORT")); assert.equal(r.svg, undefined);
  const o = renderAnnotationOverlay([{ type: "text", x: 0.1, y: 0.1, label: "@import" }]);
  assert.equal(o.ok, false); assert.equal(o.reason, "SVG_SELF_CHECK_FAILED");
});
test("validateAnnotations: unknown type is rejected (not silently treated as a point annotation)", () => {
  const r = validateAnnotations([{ type: "bogus", x: 0.1, y: 0.1 }]);
  assert.equal(r.ok, false); assert.deepEqual(r.problems, [{ index: 0, reason: "TYPE_INVALID" }]);
  assert.equal(validateAnnotations([{ type: "marker", x: 0.1, y: 0.1 }]).ok, true);
});
test("overlay: size upper bound 4000 enforced, 4000 accepted", () => {
  const l = [{ type: "marker", x: 0.5, y: 0.5 }];
  assert.equal(renderAnnotationOverlay(l, { width: 4001 }).reason, "SIZE_INVALID");
  assert.equal(renderAnnotationOverlay(l, { height: 4001 }).reason, "SIZE_INVALID");
  assert.equal(renderAnnotationOverlay(l, { width: 4000, height: 4000 }).ok, true);
  assert.equal(renderAnnotationOverlay(l, { width: 49 }).reason, "SIZE_INVALID");
});
test("buildGuidance: title over 120 chars and step text over 300 chars are refused; exact limits accepted", () => {
  const step = [{ text: "ok" }];
  assert.equal(buildGuidance({ title: "t".repeat(121), steps: step }).reason, "TITLE_INVALID");
  assert.equal(buildGuidance({ title: "t".repeat(120), steps: step }).ok, true);
  const r = buildGuidance({ title: "t", steps: [{ text: "a" }, { text: "b".repeat(301) }] });
  assert.equal(r.reason, "STEP_TEXT_INVALID"); assert.equal(r.step, 2);
  assert.equal(buildGuidance({ title: "t", steps: [{ text: "b".repeat(300) }] }).ok, true);
});
test("diagram: back edges (cycle, self-loop) are ignored for ranking so layout stays top-down", () => {
  const cyc = renderDiagram({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] });
  assert.deepEqual(nodeYs(cyc.svg), [28, 124]);
  const self = renderDiagram({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "a" }] });
  assert.deepEqual(nodeYs(self.svg), [28]);
  assert.match(self.svg, /height="152"/);
});
