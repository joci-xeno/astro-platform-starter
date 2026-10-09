import test from "node:test";
import assert from "node:assert/strict";
import { renderChart, renderDiagram, renderTextPreview, checkSvgSafe, svgToDataUri, validateAnnotations, renderAnnotationOverlay, buildGuidance, renderGuidanceStep, esc, LIMITS } from "../atlasz-addons/render.mjs";
import { chooseDetail } from "../atlasz-addons/detail-level.mjs";
import { analyze } from "../atlasz-addons/analyst.mjs";

const EVIL = `"><script>alert(1)</script><img src=x onerror=alert(2)>' onload='x' javascript:alert(3) </text><foreignObject>`;
const tagsOnly = svg => svg.replace(/>[^<]*</g, "><");                       // drop text nodes: only real markup is checked
const noActive = svg => !/<script|<foreignObject|<image|\son[a-z]+\s*=|javascript:|href=/i.test(tagsOnly(svg));
const SHORT_EVIL = `"><script>x</script>' onload='1'`;

// ---------- M13 / C09 renderer
test("charts: bar/histogram/line/scatter render valid inert SVG with title+desc; the SVG self-check passes; output is deterministic", () => {
  const specs = [{ type: "bar", title: "B", labels: ["a", "b", "c"], values: [3, 5, 2] }, { type: "histogram", title: "H", values: [1, 2, 2, 3, 3, 3, 4, 9] }, { type: "line", title: "L", values: [1, 3, 2, 5] }, { type: "line", title: "L2", x: [0, 10, 20], values: [1, 3, 2] }, { type: "scatter", title: "S", points: [[1, 2], [2, 4], [3, 5]] }];
  for (const s of specs) { const r = renderChart(s); assert.equal(r.ok, true, JSON.stringify(s)); assert.match(r.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/); assert.match(r.svg, /<title id="t">/); assert.match(r.svg, /role="img"/); assert.equal(checkSvgSafe(r.svg).safe, true); assert.equal(renderChart(s).svg, r.svg); assert.ok(!/NaN|Infinity|undefined/.test(r.svg)); }
  assert.match(svgToDataUri(renderChart(specs[0]).svg), /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
});
test("charts: hostile labels/titles are escaped (no markup injection); invalid or oversized data is refused, never rendered half-way", () => {
  const r = renderChart({ type: "bar", title: EVIL, labels: [EVIL, "x"], values: [1, 2] }); assert.equal(r.ok, true);
  assert.ok(!r.svg.includes("<script") && !r.svg.includes("<img") && noActive(r.svg), "markup must be escaped"); assert.ok(r.svg.includes("&lt;script&gt;")); assert.equal(checkSvgSafe(r.svg).safe, true);
  for (const bad of [null, {}, { type: "pie" }, { type: "bar", labels: ["a"], values: [1, 2] }, { type: "bar", labels: ["a"], values: [NaN] }, { type: "bar", labels: [], values: [] }, { type: "line", values: [1] }, { type: "scatter", points: [[1, "2"]] }, { type: "histogram", values: [] }, { type: "scatter", points: Array.from({ length: LIMITS.maxPoints + 1 }, () => [1, 1]) }, { type: "bar", labels: Array(51).fill("a"), values: Array(51).fill(1) }]) assert.equal(renderChart(bad).ok, false, JSON.stringify(bad)?.slice(0, 60));
  assert.equal(renderChart({ type: "bar", labels: ["a"], values: [1] }, { width: 5000 }).reason, "SIZE_INVALID");
  assert.equal(renderChart({ type: "bar", labels: ["one = 1"], values: [1] }).ok, true, "ordinary text like 'one = 1' must not trip the self-check");
});
test("charts built from a real analysis (analyst -> renderer) all render", () => {
  const a = analyze("region,units,price\nN,10,2.5\nS,20,2.4\nN,30,2.2\nE,25,2.3\nS,15,2.45\n"); assert.ok(a.charts.length >= 3);
  for (const c of a.charts) { const r = renderChart(c); assert.equal(r.ok, true, c.type); }
});
test("the safety checker really catches active content (mutation-style: each dangerous construct is flagged)", () => {
  const cases = { SCRIPT: "<svg><script>1</script></svg>", EVENT_HANDLER: '<svg><rect onclick="x"/></svg>', JAVASCRIPT_URL: '<svg><a href="javascript:1"/></svg>', FOREIGN_OBJECT: "<svg><foreignObject/></svg>", DOCTYPE_OR_ENTITY: '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', IMAGE_ELEMENT: '<svg><image href="#a"/></svg>', EMBED: "<svg><iframe/></svg>", EXTERNAL_HREF: '<svg><use xlink:href="http://e/x.svg#a"/></svg>', CSS_URL: '<svg><rect fill="url(http://e/x)"/></svg>', CSS_IMPORT: "<svg><style>@import 'x'</style></svg>", STYLE_ELEMENT: "<svg><style>a{}</style></svg>", ANIMATION: "<svg><animate/></svg>" };
  for (const [k, svg] of Object.entries(cases)) assert.ok(checkSvgSafe(svg).problems.includes(k), k);
  assert.equal(checkSvgSafe('<svg><use href="#local"/></svg>').safe, true, 'same-document references are allowed');
  assert.equal(checkSvgSafe('<svg><rect fill="url(#g)"/></svg>').safe, true);
});
test("diagrams: ranks, cycles are survivable, hostile labels escaped, unknown edge/duplicate id/limits refused", () => {
  const ok = renderDiagram({ title: "Flow", nodes: [{ id: "a", label: "Start" }, { id: "b", label: EVIL }, { id: "c" }], edges: [{ from: "a", to: "b", label: "x" }, { from: "b", to: "c" }, { from: "c", to: "a" }] }); assert.equal(ok.ok, true); assert.ok(noActive(ok.svg)); assert.equal(ok.nodes, 3);
  assert.equal(renderDiagram({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "zz" }] }).reason, "EDGE_REFERENCES_UNKNOWN_NODE"); assert.equal(renderDiagram({ nodes: [{ id: "a" }, { id: "a" }] }).reason, "NODE_ID_INVALID");
  assert.equal(renderDiagram({ nodes: [] }).ok, false); assert.equal(renderDiagram({ nodes: Array.from({ length: LIMITS.maxNodes + 1 }, (_, i) => ({ id: "n" + i })) }).ok, false);
  const chain = renderDiagram({ nodes: [{ id: "1" }, { id: "2" }, { id: "3" }], edges: [{ from: "1", to: "2" }, { from: "2", to: "3" }] }); const ys = [...chain.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"/g)].map(m => +m[1]); assert.ok(ys[0] < ys[1] && ys[1] < ys[2], "ranks must go top-down");
});
test("text preview: fully escaped, paragraph structure only, truncation reported", () => {
  const r = renderTextPreview(EVIL + "\n\nsecond <b>para</b>"); assert.ok(!r.html.includes("<script") && !r.html.includes("<b>") && r.html.includes("&lt;b&gt;") && (r.html.match(/<p>/g) || []).length === 2);
  assert.equal(renderTextPreview("x".repeat(30000)).truncated, true); assert.equal(renderTextPreview(5).ok, false); assert.equal(esc("\u0000a\u0007b"), "ab");
});

// ---------- P18 / A07
test("annotations: validated relative regions; bad type/color/range/label are refused with the index; overlay is inert and sized to the display", () => {
  const good = [{ type: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.2, color: "red", label: "Check this" }, { type: "ellipse", x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, { type: "arrow", x1: 0.1, y1: 0.9, x2: 0.4, y2: 0.6, color: "blue" }, { type: "marker", x: 0.8, y: 0.2, label: "1" }, { type: "text", x: 0.2, y: 0.8, label: SHORT_EVIL }];
  const o = renderAnnotationOverlay(good, { width: 800, height: 600 }); assert.equal(o.ok, true); assert.equal(o.count, 5); assert.ok(o.svg.includes('viewBox="0 0 800 600"')); assert.ok(noActive(o.svg)); assert.equal(checkSvgSafe(o.svg).safe, true);
  const rect = o.svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/); assert.deepEqual(rect.slice(1).map(Number), [80, 60, 240, 120]);
  const bad = [{ type: "circle" }, { type: "rect", x: 0.9, y: 0.1, w: 0.3, h: 0.2 }, { type: "rect", x: 0.1, y: 0.1, w: 0, h: 0.2 }, { type: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1, color: "javascript:x" }, { type: "arrow", x1: 2, y1: 0, x2: 0, y2: 0 }, { type: "text", x: 0.1, y: 0.1 }, { type: "marker", x: 0.1, y: 0.1, label: "x".repeat(81) }, { type: "marker", x: NaN, y: 0 }];
  bad.forEach((b, i) => { const v = validateAnnotations([b]); assert.equal(v.ok, false, "case " + i); assert.equal(v.problems[0].index, 0); });
  assert.equal(validateAnnotations(Array(LIMITS.maxAnnotations + 1).fill(good[1])).reason, "TOO_MANY_ANNOTATIONS"); assert.equal(validateAnnotations("x").reason, "LIST_REQUIRED"); assert.equal(renderAnnotationOverlay(good, { width: 10 }).reason, "SIZE_INVALID");
});
test("guidance: ordered steps with optional regions; ATLASZ never performs the step; per-step overlay; invalid steps/regions refused", () => {
  const g = buildGuidance({ title: "Export the report", steps: [{ text: "Open the File menu", region: { type: "rect", x: 0.0, y: 0.0, w: 0.1, h: 0.05 } }, { text: "Choose Export" }, { text: "Click Save", region: { type: "marker", x: 0.5, y: 0.5 } }] });
  assert.equal(g.ok, true); assert.deepEqual(g.steps.map(s => s.n), [1, 2, 3]); assert.ok(g.steps.every(s => s.performedByAtlasz === false)); assert.equal(g.steps[1].region, null);
  assert.equal(renderGuidanceStep(g, 1).ok, true); assert.equal(renderGuidanceStep(g, 2).count, 0); assert.equal(renderGuidanceStep(g, 3).ok, true); assert.equal(renderGuidanceStep(g, 9).reason, "STEP_NOT_FOUND");
  for (const bad of [{ title: "", steps: [{ text: "x" }] }, { title: "t", steps: [] }, { title: "t", steps: [{ text: "" }] }, { title: "t", steps: [{ text: "x", region: { type: "rect", x: 2, y: 0, w: 1, h: 1 } }] }, { title: "t", steps: Array(31).fill({ text: "x" }) }]) assert.equal(buildGuidance(bad).ok, false);
});

// ---------- P15 detail level
test("detail level: no provider -> metadata only; CONFIDENTIAL never goes external; PERSONAL never FULL externally; not-free external with budget 0 refused; size reduces detail; unknown privacy -> CONFIDENTIAL; always spend 0", () => {
  const MB = 1024 * 1024;
  assert.equal(chooseDetail({ modality: "image", bytes: MB, privacy: "PUBLIC", purpose: "AUDIT", provider: "NONE" }).level, "METADATA_ONLY");
  const c = chooseDetail({ modality: "image", bytes: MB, privacy: "CONFIDENTIAL", purpose: "AUDIT", provider: "EXTERNAL" }); assert.deepEqual([c.level, c.providerUsed], ["METADATA_ONLY", false]);
  assert.equal(chooseDetail({ modality: "image", bytes: MB, privacy: "CONFIDENTIAL", purpose: "AUDIT", provider: "LOCAL" }).level, "FULL");
  assert.notEqual(chooseDetail({ modality: "document", bytes: MB, privacy: "PERSONAL", purpose: "AUDIT", provider: "EXTERNAL" }).level, "FULL");
  assert.equal(chooseDetail({ modality: "video", bytes: MB, privacy: "PUBLIC", purpose: "SUMMARY", provider: "EXTERNAL", providerFree: false, budgetUsd: 0 }).level, "METADATA_ONLY");
  assert.equal(chooseDetail({ modality: "video", bytes: MB, privacy: "PUBLIC", purpose: "SUMMARY", provider: "EXTERNAL", providerFree: false, budgetUsd: 5 }).providerUsed, true);
  assert.equal(chooseDetail({ modality: "video", bytes: 500 * MB, privacy: "PUBLIC", purpose: "AUDIT", provider: "LOCAL" }).level, "SAMPLE");
  const u = chooseDetail({ modality: "audio", bytes: 1, privacy: "TOP SECRET", provider: "EXTERNAL" }); assert.equal(u.privacy, "CONFIDENTIAL"); assert.equal(u.level, "METADATA_ONLY"); assert.equal(u.spendUsd, 0);
  for (const bad of [{}, { modality: "x", bytes: 1 }, { modality: "image", bytes: -1 }, { modality: "image", bytes: 1, purpose: "X" }, { modality: "image", bytes: 1, provider: "CLOUD" }, { modality: "image", bytes: 1, budgetUsd: -1 }]) assert.equal(chooseDetail(bad).ok, false);
});
test("hardening: odd inputs are refused not thrown; huge magnitudes never yield NaN markup; invalid XML characters are dropped; output carries a content hash", async () => {
  const R = await import("../atlasz-addons/render.mjs");
  const hostile = { toString() { throw new Error("boom"); } }, nullo = Object.create(null);
  assert.equal(R.renderChart({ type: "bar", labels: [hostile, nullo], values: [1, 2] }).ok, true, "hostile toString is rendered as ?");
  assert.equal(R.renderChart({ type: "line", values: [1, 2, 3], x: "abc" }).ok, true, "a non-array x falls back to the index");
  for (const big of [1e308, -1e308, 1e16]) { const r = R.renderChart({ type: "line", values: [big, 1, 2] }); assert.equal(r.ok, false, String(big)); assert.equal(r.reason, "LINE_DATA_INVALID"); }
  const r1 = R.renderChart({ type: "scatter", points: [[1e15, -1e15], [0, 0]] }); assert.equal(r1.ok, true); assert.doesNotMatch(r1.svg, /NaN|Infinity/);
  const r2 = R.renderChart({ type: "bar", labels: ["a￾b\uD800c", "ok"], values: [1, 2], title: "t￿\uDC00" }); assert.equal(r2.ok, true); assert.doesNotMatch(r2.svg, /[￾￿\uD800-\uDFFF]/);
  assert.match(r2.sha256, /^[0-9a-f]{64}$/); const r2b = R.renderChart({ type: "bar", labels: ["a\uFFFEb\uD800c", "ok"], values: [1, 2], title: "t\uFFFF\uDC00" }); assert.equal(r2b.sha256, r2.sha256, "same input, same hash"); assert.notEqual(R.renderChart({ type: "bar", labels: ["x", "ok"], values: [1, 2] }).sha256, r2.sha256);
  assert.deepEqual(R.renderDiagram({ nodes: [{ id: "a", label: hostile }], edges: [] }).ok, true);
  for (const bad of [null, undefined, 5, "x", [], { nodes: 5 }]) { assert.doesNotThrow(() => R.renderDiagram(bad)); assert.equal(R.renderDiagram(bad).ok, false); }
  assert.equal(R.renderAnnotationOverlay([{ type: "text", x: 0.1, y: 0.1, label: hostile }]).ok, true); assert.doesNotThrow(() => R.buildGuidance({ title: "t", steps: [{ text: "s", region: 5 }, null] }));
  assert.equal(R.renderTextPreview("a\uD800b").html.includes("\uD800"), false);
  assert.equal(R.renderChart({ type: "histogram", values: [1e15, -1e15, 0] }).ok, true);
});
test("hardening: esc drops each XML-invalid character class individually", () => {
  assert.equal(esc("a￾b"), "ab"); assert.equal(esc("a￿b"), "ab"); assert.equal(esc("a\uD800b"), "ab", "lone high surrogate"); assert.equal(esc("a\uDC00b"), "ab", "lone low surrogate"); assert.equal(esc("a😀b"), "a😀b", "a valid pair survives"); assert.equal(esc("x\uD800"), "x"); assert.equal(esc("\uDC00y"), "y"); assert.equal(esc("\uD83D😀"), "😀", "high surrogate before a pair is the lone one");
});

test("verification fix R-1: near-identical, huge and tiny values never hang or explode the tick loop", () => {
  const cases = [[1e16, 1e16 + 2], [1e15, 1e15 + 0.0001], [1, 1 + 1e-12], [5e-324, 1e-323], [1e308, 1.7e308], [0, 0], [-3, -3]];
  for (const [a, b] of cases) for (const type of ["line", "scatter", "bar"]) {
    const spec = type === "bar" ? { type, title: "t", labels: ["a", "b"], values: [a, b] } : type === "line" ? { type, title: "t", values: [a, b] } : { type, title: "t", points: [[a, a], [b, b]] };
    const t0 = Date.now(); const r = renderChart(spec); assert.ok(Date.now() - t0 < 500, `${type} ${a} ${b} took too long`); if (!r.ok) { assert.match(r.reason, /INVALID|RANGE|SELF_CHECK/, `${type} ${a} ${b} refused cleanly`); continue; } assert.ok(r.svg.length < 100000); assert.equal(checkSvgSafe(r.svg).safe, true);
  }
});

test("verification fixes R-4/R-5: sparse arrays are refused; palette names are own properties only", () => {
  for (const spec of [{ type: "bar", labels: new Array(3), values: new Array(3) }, { type: "line", values: new Array(3) }, { type: "line", values: [1, 2, 3], x: new Array(3) }, { type: "scatter", points: new Array(2) }, { type: "scatter", points: [new Array(2), [1, 2]] }, { type: "histogram", values: new Array(5) }]) assert.equal(renderChart(spec).ok, false, JSON.stringify(spec));
  assert.equal(renderChart({ type: "bar", labels: ["a"], values: [1] }).ok, true);
  for (const color of ["constructor", "__proto__", "toString", 5, {}]) assert.equal(validateAnnotations([{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, color }]).ok, false, String(color));
  assert.equal(validateAnnotations([{ type: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: "red" }]).ok, true);
});

test("round-4 fixes: negative-only bars are drawn inside the plot; a mismatched x array is refused; sparse annotation lists are refused", () => {
  const r = renderChart({ type: "bar", labels: ["a", "b"], values: [-5, -9], title: "neg" }); assert.equal(r.ok, true);
  const rects = [...r.svg.matchAll(/<rect x="[^"]+" y="([-\d.]+)" width="[^"]+" height="([-\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])]); assert.equal(rects.length, 2);
  for (const [y, h] of rects) { assert.ok(y >= 0 && y + h <= 420 + 0.01, "bar inside canvas: " + y + "/" + h); }
  assert.equal(renderChart({ type: "line", values: [1, 2, 3], x: [1, "a", 3] }).reason, "LINE_DATA_INVALID"); assert.equal(renderChart({ type: "line", values: [1, 2, 3], x: [1, 2] }).reason, "LINE_DATA_INVALID");
  assert.equal(validateAnnotations(new Array(50)).reason, "SPARSE_ARRAY");
});
