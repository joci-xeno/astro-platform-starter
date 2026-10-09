import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditAccessibility, contrast, contrastRatio, parseHex, luminance, LIMITS } from "../atlasz-addons/a11y-audit.mjs";

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "atlasz-control-center", "public");
const GOOD_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>App</title></head><body><nav aria-label="Sections"></nav><main></main></body></html>';
const rules = a => a.findings.map(f => f.rule);

test("contrast math matches the WCAG reference values", () => {
  assert.equal(contrast("#000", "#fff"), 21); assert.equal(contrast("#fff", "#000"), 21); assert.equal(contrast("#fff", "#fff"), 1);
  assert.equal(contrast("#767676", "#ffffff"), 4.54); assert.equal(contrast("#777777", "#ffffff"), 4.48); assert.equal(contrast("#777", "#fff"), 4.48);
  assert.deepEqual(parseHex("#fa0"), [255, 170, 0]); assert.deepEqual(parseHex(" #FFAA00 "), [255, 170, 0]);
  for (const bad of ["#ffff", "#12345", "red", "rgb(1,2,3)", "", "#gggggg", null, undefined, 5]) assert.equal(parseHex(bad), null, String(bad));
  assert.equal(contrast("red", "#fff"), null); assert.equal(contrast("#fff", "var(--x)"), null);
  assert.equal(luminance([0, 0, 0]), 0); assert.equal(Math.round(luminance([255, 255, 255]) * 1000) / 1000, 1);
  assert.equal(Math.round(luminance([10, 10, 10]) * 100000) / 100000, 0.00304, "low channel values use the linear segment (c/12.92)"); assert.ok(luminance([255, 0, 0]) > luminance([0, 0, 255]), "channel weights differ");
});

test("css: a failing pair is reported per theme; the dark block overrides the base; selector lists are split; large text needs 3:1", () => {
  const css = ":root{--bg:#ffffff;--ink:#000000;--mute:#999999;--panel:#ffffff;--a:#6ea2ff}@media (prefers-color-scheme:dark){:root{--bg:#000000;--ink:#ffffff;--mute:#222222;--panel:#000000}}.sub{color:var(--mute)}button.primary,nav button.cur{background:var(--a);color:#fff}";
  const a = auditAccessibility({ html: GOOD_HTML, css }); const f = a.findings.filter(x => x.rule === "CONTRAST");
  assert.equal(a.verdict, "FAIL_FOUND"); assert.ok(f.some(x => x.theme === "light" && x.selector === ".sub" && x.ratio === 2.85 && x.required === 4.5), JSON.stringify(f));
  assert.ok(f.some(x => x.theme === "dark" && x.selector === ".sub"), "the dark :root override (#222 on black) is checked in the dark theme"); assert.ok(f.some(x => x.theme === "light" && x.selector === "button.primary"), "white on #6ea2ff");
  const dark = f.filter(x => x.theme === "dark" && x.selector === ".sub")[0]; assert.equal(dark.ratio, 1.32);
  const okCss = ":root{--bg:#fff;--panel:#fff;--ink:#000;--x:#6e6e6e}.big{color:var(--x);font-size:24px}.bold{color:var(--x);font-size:19px;font-weight:700}.small{color:var(--x);font-size:14px}";
  const b = auditAccessibility({ html: GOOD_HTML, css: okCss }).findings.filter(x => x.rule === "CONTRAST").map(x => x.selector); assert.deepEqual(b, []);
  const c = auditAccessibility({ html: GOOD_HTML, css: ":root{--bg:#fff;--panel:#fff;--ink:#000;--x:#8a8a8a}.big{color:var(--x);font-size:24px}.bold{color:var(--x);font-size:19px;font-weight:700}.mid{color:var(--x);font-size:19px}.small{color:var(--x);font-size:14px}.edge{color:var(--x);font-size:18px;font-weight:700}" }).findings.filter(x => x.rule === "CONTRAST");
  assert.deepEqual(c.map(x => x.selector).sort(), [".edge", ".mid", ".small"], "ratio 3.45: fine for large text (24px, or bold from 18.66px), failing for normal text");
  // a base rule that is fixed in the dark block no longer fails there
  const fixed = auditAccessibility({ html: GOOD_HTML, css: ":root{--bg:#fff;--panel:#fff;--ink:#000;--a:#6ea2ff}@media (prefers-color-scheme:dark){:root{--bg:#000;--panel:#000;--ink:#fff}button.primary{color:#000}}button.primary{background:var(--a);color:#fff}" }).findings.filter(x => x.rule === "CONTRAST");
  assert.deepEqual(fixed.map(x => x.theme), ["light"], "only the light theme fails; the dark override fixes the pair");
  assert.deepEqual(auditAccessibility({ html: GOOD_HTML, css: "/* :root{--ink:#000} */" }).findings, [], "comments are ignored");
});

test("css parsing details: comments, other media queries, uppercase properties, spaces, background-color, :root own colours, empty selectors, fg-only pairs, background-only pairs", () => {
  const f = css => auditAccessibility({ html: GOOD_HTML, css }); const sels = css => f(css).findings.filter(x => x.rule === "CONTRAST").map(x => x.theme + ":" + x.selector);
  const T = ":root{--bg:#fff;--panel:#fff;--ink:#000;--bad:#ccc;--dim:#888}";
  assert.deepEqual(sels(T + "/* .x{color:#ccc} */ .y{color:#000}"), [], "a commented-out rule is ignored"); assert.deepEqual(sels(T + "/* c */ .x{color:#ccc}"), ["light:.x"]);
  assert.deepEqual(sels(T + "@media (max-width:760px){.x{color:#ccc}}"), ["light:.x"], "a non-dark media block applies to the light theme"); assert.deepEqual(sels(T + "@media (prefers-color-scheme : dark){.x{color:#ccc}}"), ["dark:.x"], "spaces inside the dark media condition are fine");
  assert.deepEqual(sels(T + ".x{COLOR:#ccc}"), ["light:.x"], "property names are case-insensitive"); assert.deepEqual(sels(T + ".x{ color : var(--bad) ; }"), ["light:.x"], "spaces around names and values"); assert.deepEqual(sels(T + ".x{color:var(--bad);}"), ["light:.x"]);
  assert.deepEqual(sels(T + ".x{background-color:var(--bad);color:#fff}"), ["light:.x"], "background-color counts as a background"); assert.deepEqual(sels(T + ".x{background:#222}"), ["light:.x"], "background only: text takes the ink colour (black on #222)");
  assert.deepEqual(sels(":root{--bg:#fff;--panel:#fff;--ink:#000;color:#ccc;background:#fff}"), ["light::root"], ":root's own colours are checked");
  assert.deepEqual(sels(T + "a,,.x,{color:#ccc}"), ["light:a", "light:.x"], "empty selector parts are dropped");
  const bgOnly = f(":root{--bg:#fff;--panel:#fff;--ink:#000}.x{background:transparent}.y{background:linear-gradient(#000,#fff)}"); assert.deepEqual([bgOnly.contrast.unresolved, bgOnly.findings.length], [0, 0], "non-hex backgrounds are not counted as unresolved pairs");
  assert.deepEqual(f(".x{background:#000}").contrast, { pairsChecked: 0, unresolved: 0, unresolvedPairs: [], notEvaluated: ["light: .x (background without a known text colour)"] }, "no ink token: a background-only rule has no foreground to check"); assert.equal(f(":root{--bg:#fff;--panel:#eee;--ink:#000}.x{color:var(--missing)}").contrast.unresolved, 2, "an unknown token is an unresolved pair on page and panel, not a pass");
  // text-only rules are checked against BOTH the page and the panel background
  assert.deepEqual(sels(":root{--bg:#ffffff;--panel:#000000;--ink:#000}.p{color:#888888}"), ["light:.p"], "fails on the white page only"); assert.deepEqual(sels(":root{--bg:#000000;--panel:#ffffff;--ink:#000}.p{color:#888888}"), ["light:.p"], "fails on the white panel only");
  // large-text boundaries and bold keyword
  const big = (px, w) => sels(":root{--bg:#fff;--panel:#fff;--ink:#000}.t{color:#949494;font-size:" + px + "px" + (w ? ";font-weight:" + w : "") + "}"); assert.deepEqual(big(18.66, "bold"), [], "18.66px bold is large text"); assert.deepEqual(big(18.65, "bold"), ["light:.t"]); assert.deepEqual(big(24), []); assert.deepEqual(big(23.9), ["light:.t"]); assert.deepEqual(big(19, "700"), []); assert.deepEqual(big(19, "600"), ["light:.t"]); assert.deepEqual(big(19, "bolder"), ["light:.t"]);
  // the threshold uses the unrounded ratio
  const probe = (lo, hi) => { for (let r = 100; r < 140; r++) for (let g = 100; g < 140; g++) for (let b = 100; b < 140; b++) { const h = "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join(""), raw = contrastRatio(h, "#ffffff"); if (contrast(h, "#ffffff") === 4.5 && raw >= lo && raw < hi) return h; } return null; };
  const below = probe(0, 4.5), above = probe(4.5, 9); assert.ok(below && above, "colours that both display as 4.50:1 exist"); assert.deepEqual(sels(":root{--bg:#fff;--panel:#fff;--ink:#000}.t{color:" + below + "}"), ["light:.t"], "4.499 is below 4.5 even though it displays as 4.50"); assert.deepEqual(sels(":root{--bg:#fff;--panel:#fff;--ink:#000}.t{color:" + above + "}"), []);
  assert.ok(contrastRatio("#000", "#fff") > 20.99 && contrastRatio("#000", "#fff") < 21.01); assert.equal(contrastRatio("x", "#fff"), null);
});

test("html: lang, title, viewport zoom, landmarks, nav label, img alt, positive tabindex", () => {
  assert.equal(auditAccessibility({ html: GOOD_HTML }).verdict, "INCOMPLETE_AUDIT", "html only: no stylesheet was audited, so a clean result is never reported");
  const bad = h => rules(auditAccessibility({ html: h }));
  assert.ok(bad(GOOD_HTML.replace(' lang="en"', "")).includes("HTML_LANG")); assert.ok(bad(GOOD_HTML.replace('lang="en"', 'lang=""')).includes("HTML_LANG")); assert.ok(bad(GOOD_HTML.replace('lang="en"', 'lang="x"')).includes("HTML_LANG")); assert.ok(!bad(GOOD_HTML.replace('lang="en"', 'lang="hu"')).includes("HTML_LANG")); assert.ok(!bad(GOOD_HTML.replace('lang="en"', 'lang="en-US"')).includes("HTML_LANG"));
  assert.ok(bad(GOOD_HTML.replace("<title>App</title>", "")).includes("TITLE")); assert.ok(bad(GOOD_HTML.replace("<title>App</title>", "<title>  </title>")).includes("TITLE"));
  assert.ok(bad(GOOD_HTML.replace(/<meta name="viewport"[^>]*>/, "")).includes("VIEWPORT")); assert.ok(bad(GOOD_HTML.replace("initial-scale=1", "user-scalable=no")).includes("ZOOM_BLOCKED")); assert.ok(bad(GOOD_HTML.replace("initial-scale=1", "maximum-scale=1")).includes("ZOOM_BLOCKED")); assert.ok(!bad(GOOD_HTML.replace("initial-scale=1", "maximum-scale=5")).includes("ZOOM_BLOCKED"));
  for (const [v, blocked] of [["maximum-scale=1.0", true], ["maximum-scale=1.5", true], ["maximum-scale=1.99", true], ["maximum-scale=2", false], ["maximum-scale=2.0", false], ["maximum-scale=10", false], ["user-scalable=0", true], ["user-scalable=yes", false], ["MAXIMUM-SCALE = 1", true]]) assert.equal(bad(GOOD_HTML.replace("initial-scale=1", v)).includes("ZOOM_BLOCKED"), blocked, v);
  assert.ok(bad(GOOD_HTML.replace("<main></main>", "")).includes("LANDMARK_MAIN")); assert.ok(bad(GOOD_HTML.replace(' aria-label="Sections"', "")).includes("NAV_LABEL")); assert.ok(!bad(GOOD_HTML.replace("<nav", "<div").replace("</nav>", "</div>")).includes("NAV_LABEL"));
  assert.ok(bad(GOOD_HTML.replace("<main>", '<main><img src="x.png">')).includes("IMG_ALT")); assert.ok(!bad(GOOD_HTML.replace("<main>", '<main><img src="x.png" alt="">')).includes("IMG_ALT"));
  assert.ok(bad(GOOD_HTML.replace("<main>", '<main tabindex="3">')).includes("TABINDEX_POSITIVE")); assert.ok(!bad(GOOD_HTML.replace("<main>", '<main tabindex="-1">')).includes("TABINDEX_POSITIVE")); assert.ok(!bad(GOOD_HTML.replace("<main>", '<main tabindex="0">')).includes("TABINDEX_POSITIVE"));
});

test("html tokeniser: comments, quoting styles, case, text after <title>, hostile repetition stays fast", () => {
  const r = h => rules(auditAccessibility({ html: h })), G = GOOD_HTML;
  assert.deepEqual(r(G.replace("<main>", '<main><!-- <img src="x"> -->')), [], "tags inside comments are ignored"); assert.ok(r(G.replace("<main>", '<main><!-- unterminated <img src="x">')).length === 0, "an unterminated comment swallows the rest instead of crashing");
  assert.ok(r(G.replace("<main>", '<main><IMG SRC="x">')).includes("IMG_ALT"), "tag and attribute names are case-insensitive"); assert.ok(!r(G.replace("<main>", "<main><img src=x alt=pic>")).includes("IMG_ALT"), "unquoted attribute values"); assert.ok(!r(G.replace("<main>", "<main><img src='x' alt='pic'>")).includes("IMG_ALT"), "single quotes");
  assert.ok(r(G.replace("<main>", '<main><img data-alt="x" src="y">')).includes("IMG_ALT"), "data-alt is not alt"); assert.ok(r(G.replace("<main>", '<main><img src="x" alt-text="y">')).includes("IMG_ALT"));
  assert.ok(!r(G.replace("</head>", '</head><!-- <title></title> -->')).includes("TITLE")); assert.ok(r(G.replace("<title>App</title>", "<!-- <title>App</title> -->")).includes("TITLE"), "a commented-out title is no title");
  assert.ok(r(G.replace("<title>App</title>", "<title></title><b>App</b>")).includes("TITLE"), "title text must be inside the title"); assert.ok(!r(G.replace("<title>App</title>", "<TITLE>App</TITLE>")).includes("TITLE"));
  assert.ok(!r(G.replace('lang="en"', "lang=en")).includes("HTML_LANG"), "unquoted lang"); assert.ok(r(G.replace('lang="en"', 'data-lang="en"')).includes("HTML_LANG")); assert.ok(r(G.replace("<html", "<div").replace("</html>", "</div>")).includes("HTML_LANG"), "no <html> element");
  assert.ok(r(G.replace('name="viewport"', 'name="Viewport"').replace("initial-scale=1", "user-scalable=no")).includes("ZOOM_BLOCKED"), "viewport name is case-insensitive"); assert.ok(r(G.replace('name="viewport"', 'name="description"')).includes("VIEWPORT"));
  assert.ok(r(G.replace(' aria-label="Sections"', ' aria-labelledby="h"')).every(x => x !== "NAV_LABEL")); assert.ok(r(G.replace("<main>", '<main><a tabindex=2>x</a>')).includes("TABINDEX_POSITIVE")); assert.ok(r(G.replace("<main></main>", "<p>x</p>")).includes("LANDMARK_MAIN")); assert.ok(r(G.replace("<main>", "<main><br/><hr>")).length === 0);
  const t0 = Date.now(); for (const html of ["<title>".repeat(100000), "<img>".repeat(100000), "<html ".repeat(100000), "<!--".repeat(100000)]) auditAccessibility({ html }); auditAccessibility({ css: "/*".repeat(200000) + "a{".repeat(200000) }); auditAccessibility({ js: 'h("input", {'.repeat(50000) + 'h("button", {}, "")'.repeat(30000) });
  assert.ok(Date.now() - t0 < 10000, "hostile repetition runs in linear time: " + (Date.now() - t0) + " ms");
  assert.ok(auditAccessibility({ html: "<p>".repeat(LIMITS.maxTags + 5) }).ok, "tag count is bounded");
});

test("focus outlines and script-built controls", () => {
  const css = sel => auditAccessibility({ html: GOOD_HTML, css: sel });
  assert.ok(rules(css("button{outline:none}")).includes("FOCUS_REMOVED")); assert.ok(rules(css("input{outline:0}")).includes("FOCUS_REMOVED")); assert.ok(rules(css("a{outline: none}")).includes("FOCUS_REMOVED")); assert.ok(rules(css("button{outline:NONE}")).includes("FOCUS_REMOVED"), "values are case-insensitive");
  assert.ok(rules(css("button:focus-visible{outline:none}")).includes("FOCUS_REMOVED"), "hiding the outline ON focus-visible is still a failure"); assert.ok(!rules(css("button:focus:not(:focus-visible){outline:none}")).includes("FOCUS_REMOVED"), "the :not(:focus-visible) idiom is fine");
  assert.ok(!rules(css("button{outline:none;box-shadow:0 0 0 2px #00f}")).includes("FOCUS_REMOVED")); assert.ok(!rules(css("main{outline:none}")).includes("FOCUS_REMOVED"), "a programmatic focus target (tabindex -1) may hide its outline"); assert.ok(!rules(css("button{outline:2px solid #00f}")).includes("FOCUS_REMOVED"));
  const js = o => rules(auditAccessibility({ html: GOOD_HTML, js: o }));
  assert.ok(js('h("input", { placeholder: "name" })').includes("PLACEHOLDER_ONLY_LABEL")); assert.ok(js('h("textarea", { placeholder: "x" })').includes("PLACEHOLDER_ONLY_LABEL"));
  assert.ok(!js('h("input", { placeholder: "name", "aria-label": "Name" })').includes("PLACEHOLDER_ONLY_LABEL")); assert.ok(!js('h("input", { id: "n", placeholder: "name" })').includes("PLACEHOLDER_ONLY_LABEL"));
  assert.ok(!js('h("input", { placeholder: "name" }); if (x) e.setAttribute("aria-label", String(attrs.placeholder));').includes("PLACEHOLDER_ONLY_LABEL"), "a helper that copies the placeholder into aria-label counts as a name");
  assert.ok(!js('h("input", { placeholder: "name" }); if (x) e.setAttribute("aria-label", String(attrs.placeholder));').includes("NO_LABEL_ELEMENTS"), "no <label> warning when the helper names controls");
  assert.ok(!js('h("input", { type: "text" })').includes("PLACEHOLDER_ONLY_LABEL"), "a control without any placeholder is not a placeholder-only control"); assert.equal(auditAccessibility({ html: GOOD_HTML, js: "var x = 1;" }).findings.length, 0, "no inputs, no label warning");
  assert.ok(js('h("input", { type: "text" })').includes("NO_LABEL_ELEMENTS")); assert.ok(!js('h("input", { type: "text" }); h("label", {}, "x")').includes("NO_LABEL_ELEMENTS"));
  assert.ok(js('h("button", { class: "x" }, "")').includes("BUTTON_NAME")); assert.ok(!js('h("button", { class: "x" }, "Go")').includes("BUTTON_NAME"));
  const many = auditAccessibility({ html: GOOD_HTML, js: 'h("input", { placeholder: "a" }); h("input", { placeholder: "b" });' }).findings.find(f => f.rule === "PLACEHOLDER_ONLY_LABEL"); assert.equal(many.count, 2);
});

test("verdicts, limits and input validation; the verdict never says 'accessible'", () => {
  const a = auditAccessibility({ html: GOOD_HTML, css: "", js: "" }); assert.deepEqual([a.ok, a.verdict, a.counts], [true, "INCOMPLETE_AUDIT", { FAIL: 0, WARN: 0, INFO: 0 }]); assert.match(a.notes[0], /not a statement that the interface is accessible/);
  assert.equal(auditAccessibility({ html: GOOD_HTML, css: ":root{--bg:#fff;--panel:#fff;--ink:#000}body{color:var(--ink)}", js: 'h("input", { placeholder: "a" })' }).verdict, "WARNINGS_ONLY"); assert.equal(auditAccessibility({ html: "<p>x</p>" }).verdict, "FAIL_FOUND");
  for (const bad of [{ html: 5 }, { css: {} }, { js: null }, { html: "x".repeat(LIMITS.maxInputChars + 1) }]) assert.equal(auditAccessibility(bad).reason, "INPUT_INVALID_OR_TOO_LARGE");
  assert.equal(auditAccessibility().ok, true);
  const exact = "/* */".padEnd(LIMITS.maxInputChars, " "); assert.equal(exact.length, LIMITS.maxInputChars); assert.equal(auditAccessibility({ html: GOOD_HTML, css: exact }).ok, true, "exactly the limit is accepted");
  const noisy = auditAccessibility({ html: GOOD_HTML, js: 'h("button", {}, "")\n'.repeat(LIMITS.maxFindings + 20) }); assert.equal(noisy.findings.length, LIMITS.maxFindings); assert.equal(noisy.truncated, true); assert.equal(auditAccessibility({ html: GOOD_HTML, js: 'h("button", {}, "")\n'.repeat(5) }).truncated, false);
  const counted = auditAccessibility({ html: "<p></p>" }); assert.equal(counted.counts.FAIL + counted.counts.WARN, counted.findings.length);
});

test("the real Control Center passes its own accessibility checks in both themes (regression guard)", () => {
  const r = auditAccessibility({ html: fs.readFileSync(path.join(PUB, "index.html"), "utf8"), css: fs.readFileSync(path.join(PUB, "style.css"), "utf8"), js: fs.readFileSync(path.join(PUB, "app.js"), "utf8"), cssSources: ["/style.css"] });
  assert.equal(r.verdict, "NO_FAILS_BY_THESE_CHECKS", JSON.stringify(r.findings)); assert.ok(r.contrast.pairsChecked >= 15, "the stylesheet's colour pairs were actually evaluated: " + r.contrast.pairsChecked);
});

test("mutation hardening: comment edges, unclosed rules, background-color, tabindex 0, html comments", () => {
  const T = ":root{--bg:#fff;--panel:#fff;--ink:#000}";
  const sels = css => auditAccessibility({ html: GOOD_HTML, css }).findings.filter(x => x.rule === "CONTRAST").map(x => x.selector);
  assert.deepEqual(sels(T + "/**/.x{color:#ccc}"), [".x"], "an empty comment leaves no stray character before the selector");
  assert.deepEqual(sels(T + ".ok{color:#000}/* unterminated .y{color:#ccc}"), [], "an unterminated comment swallows the rest, including what looks like a rule");
  assert.deepEqual(sels(T + ".x{color:#ccc}.y{color:#ccc"), [".x"], "an unclosed final rule is ignored without hanging");
  assert.deepEqual(sels(T + ".x{background-color:#000;color:#222}"), [".x"], "background-color is honoured when background is absent");
  const tab = h => auditAccessibility({ html: h, css: T }).findings.filter(x => x.rule === "TABINDEX_POSITIVE").length;
  const withBtn = a => GOOD_HTML.replace("</body>", `<button ${a}>Go</button></body>`);
  assert.equal(tab(withBtn('tabindex="0"')), 0); assert.equal(tab(withBtn('tabindex="-1"')), 0); assert.equal(tab(withBtn('tabindex="3"')), 1);
  const imgs = h => auditAccessibility({ html: h, css: T }).findings.filter(x => x.rule === "IMG_ALT").length;
  const bad = '<img src="a.png">';
  assert.equal(imgs(GOOD_HTML.replace("</body>", bad + "</body>")), 1, "control: a missing alt is found");
  assert.equal(imgs(GOOD_HTML.replace("</body>", "<!-- " + bad + " --></body>")), 0, "markup inside an html comment is ignored");
  assert.equal(imgs(GOOD_HTML.replace("</body>", "<!-- a > b " + bad + " --></body>")), 0, "a > inside a comment does not end the comment early");
  assert.equal(imgs(GOOD_HTML.replace("</body>", "<!----><img src=\"a.png\"></body>")), 1, "the tag right after an empty comment is still inspected");
  assert.equal(imgs(GOOD_HTML.replace("</body>", "<!-- unterminated " + bad)), 0, "an unterminated html comment swallows the rest");
});

test("R6 verification regressions: dark-token selectors, conditional overrides, background order, tokenizer tricks and markup checks can no longer hide a failure behind a clean verdict", () => {
  const BODY = "body{color:var(--ink);background:var(--bg)}", fails = (css, html = GOOD_HTML, js = "") => auditAccessibility({ html, css, js }), rules = r => r.findings.map(f => f.rule);
  // dark tokens declared under :root:not([data-theme=light]) inside the dark media query, and under html[data-theme=dark]
  let r = fails(":root{--ink:#000;--bg:#fff}@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]){--ink:#222;--bg:#111}}" + BODY); assert.ok(r.findings.some(f => f.rule === "CONTRAST" && f.theme === "dark"), "dark pair #222 on #111 fails");
  r = fails(":root{--ink:#000;--bg:#fff}html[data-theme=\"dark\"]{--ink:#222;--bg:#111}" + BODY); assert.ok(r.findings.some(f => f.rule === "CONTRAST" && f.theme === "dark"));
  // a conditional @media override does not hide the base failure
  r = fails(":root{--ink:#fff;--bg:#fff}@media (min-width:900px){:root{--ink:#000}}" + BODY); assert.ok(r.findings.some(f => f.rule === "CONTRAST" && !f.condition), "the base white-on-white is reported"); assert.equal(r.verdict, "FAIL_FOUND");
  // ... and a failure that exists only under the condition is found too
  r = fails(":root{--ink:#000;--bg:#fff}@media (min-width:900px){:root{--ink:#fff}}" + BODY); assert.ok(r.findings.some(f => f.rule === "CONTRAST" && /min-width:900px/.test(f.condition ?? "")), JSON.stringify(r.findings));
  // background shorthand vs background-color: the later declaration wins
  r = fails(".a{color:#fff;background:#000;background-color:#fff}"); assert.ok(r.findings.some(f => f.rule === "CONTRAST" && f.selector === ".a"));
  assert.ok(!fails(".a{color:#fff;background-color:#fff;background:#000}").findings.some(f => f.rule === "CONTRAST" && f.selector === ".a"), "last declaration wins in this order");
  // tokenizer
  const shell = body => GOOD_HTML.replace("</body>", body + "</body>");
  assert.ok(rules(fails("", shell("<!--><img src=x>"))).includes("IMG_ALT"), "<!--> is an empty comment");
  assert.ok(rules(fails("", shell('<script>var s="<!--";</script><img src=x>'))).includes("IMG_ALT"), "a comment opener inside a script does not hide the page");
  assert.ok(rules(fails("", shell('<img src=x title="alt=x">'))).includes("IMG_ALT"), "text inside another attribute value is not an alt attribute");
  assert.ok(!rules(fails("", shell('<img src=x alt="">'))).includes("IMG_ALT"));
  // markup checks and inline / embedded styles
  assert.ok(rules(fails("", shell("<input type=text>"))).includes("INPUT_LABEL")); assert.ok(!rules(fails("", shell('<label for=q>Q</label><input id=q>'))).includes("INPUT_LABEL")); assert.ok(!rules(fails("", shell('<label>Q <input></label>'))).includes("INPUT_LABEL"));
  assert.ok(rules(fails("", shell("<button></button>"))).includes("BUTTON_NAME")); assert.ok(!rules(fails("", shell('<button aria-label="Go"></button>'))).includes("BUTTON_NAME")); assert.ok(!rules(fails("", shell("<button>Go</button>"))).includes("BUTTON_NAME"));
  assert.ok(rules(fails("", shell('<p id=a></p><p id=a></p>'))).includes("DUPLICATE_ID")); assert.ok(rules(fails("", shell('<a href=x aria-hidden="true">x</a>'))).includes("ARIA_HIDDEN_FOCUSABLE"));
  assert.ok(rules(fails("", shell('<p style="color:#fff;background:#fff">x</p>'))).includes("CONTRAST"), "inline style evaluated");
  assert.ok(rules(fails("", shell("<style>.z{color:#fff;background:#fff}</style>"))).includes("CONTRAST"), "<style> block evaluated");
  const partial = fails(":root{--ink:#000;--bg:#fff}" + BODY, shell('<p style="color:#fff">x</p>')); assert.equal(partial.complete, false); assert.ok(partial.incomplete.some(x => x.startsWith("COLOUR_RULES_NOT_EVALUATED")), "an inline colour that cannot be evaluated makes the audit incomplete");
  const kf = fails(":root{--ink:#000;--bg:#fff}" + BODY + "@keyframes k{from{color:#fff}to{color:#000}}"); assert.ok(kf.incomplete.includes("KEYFRAME_COLOURS_NOT_EVALUATED"));
  const local = fails(":root{--ink:#000;--bg:#fff}" + BODY + ".card{--ink:#fff}"); assert.ok(local.incomplete.some(x => x.startsWith("LOCAL_CUSTOM_PROPERTY_NOT_EVALUATED")));
  // script-built controls in single quotes
  assert.ok(rules(fails(":root{--ink:#000;--bg:#fff}" + BODY, GOOD_HTML, "h('input', {type:'text', placeholder:'x'});")).includes("PLACEHOLDER_ONLY_LABEL") || rules(fails(":root{--ink:#000;--bg:#fff}" + BODY, GOOD_HTML, "h('input', {type:'text', placeholder:'x'});")).includes("NO_LABEL_ELEMENTS"));
  assert.ok(rules(fails(":root{--ink:#000;--bg:#fff}" + BODY, GOOD_HTML, "h('button', {}, '')")).includes("BUTTON_NAME"));
});

test("R6 verification regressions: external stylesheets, --!> comments and aria-hidden containers are never silently clean", () => {
  const C = ":root{--bg:#fff;--ink:#000}body{color:var(--ink);background:var(--bg)}", H = b => "<html lang=en><head><title>t</title><meta name=viewport content='width=device-width'></head><body><main>" + b + "</main></body></html>";
  const a = (h, c = C) => auditAccessibility({ html: h, css: c });
  const l = a(H("<link rel=stylesheet href=x.css><p>x")); assert.equal(l.complete, false); assert.ok(l.incomplete.some(x => x.startsWith("EXTERNAL_STYLESHEET")));
  assert.equal(auditAccessibility({ html: H("<link rel=stylesheet href=x.css><p>x"), css: C, cssSources: ["x.css"] }).complete, true, "a link whose text the caller supplied is covered");
  const i = a(H("<p>x"), "@import url(x.css);" + C); assert.equal(i.complete, false); assert.ok(i.incomplete.some(x => x.startsWith("EXTERNAL_STYLESHEET")));
  assert.ok(a(H("<!-- x --!><input>")).findings.some(f => f.rule === "INPUT_LABEL"), "a comment closed by --!> does not swallow the page");
  assert.ok(a(H("<div aria-hidden=true><a href=#>x</a></div>")).findings.some(f => f.rule === "ARIA_HIDDEN_FOCUSABLE"));
  assert.ok(a(H("<div aria-hidden=TRUE><div><span></span></div><button>b</button></div>")).findings.some(f => f.rule === "ARIA_HIDDEN_FOCUSABLE"));
  assert.ok(!a(H("<div aria-hidden=true><div><span></span></div></div><a href=#>x</a>")).findings.some(f => f.rule === "ARIA_HIDDEN_FOCUSABLE"), "focusable content after the hidden container is fine");
});
