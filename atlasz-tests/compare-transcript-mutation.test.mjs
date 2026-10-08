// Targeted tests that pin down behaviours the main compare-transcript tests left unobserved (found by mutation testing).
import test from "node:test";
import assert from "node:assert/strict";
import { comparePages, toPlainText } from "../atlasz-addons/text-compare.mjs";
import { parseTranscript, analyzeTranscript } from "../atlasz-addons/transcript-actions.mjs";

const cmp = (a, b) => comparePages([{ label: "A", text: a }, { label: "B", text: b }]);

test("toPlainText: an HTML comment containing '>' is removed whole", () => {
  const t = toPlainText("<p>keep</p><!-- a > b hidden -->tail");
  assert.ok(!/hidden|b -->|-->/.test(t)); assert.match(t, /keep/); assert.match(t, /tail/);
});
test("lcs tie-break: a replaced line is reported as removal before addition", () => {
  assert.deepEqual(cmp("x", "y").pairs[0].changes, [{ op: "del", text: "x" }, { op: "add", text: "y" }]);
});
test("similarity divides by the longer page", () => {
  assert.equal(cmp("one", "one\ntwo").pairs[0].similarity, 0.5);
  assert.equal(cmp("one\ntwo", "one").pairs[0].similarity, 0.5);
});
test("numbers and headings: only the non-shared ones are listed, per side", () => {
  const p = cmp("<h2>Shared</h2><h2>OnlyA</h2><p>5 and 7</p>", "<h2>Shared</h2><h2>OnlyB</h2><p>7 and 9</p>").pairs[0];
  assert.deepEqual(p.numbersOnlyInA, ["5"]); assert.deepEqual(p.numbersOnlyInB, ["9"]);
  assert.deepEqual(p.headingsOnlyInA, ["OnlyA"]); assert.deepEqual(p.headingsOnlyInB, ["OnlyB"]);
});
test("term tables: uniqueTerms excludes shared words, stop words are dropped everywhere", () => {
  const r = cmp("alpha shared with the zebra", "beta shared with the lion");
  assert.deepEqual(r.uniqueTerms.A, ["alpha", "zebra"]); assert.deepEqual(r.uniqueTerms.B, ["beta", "lion"]);
  assert.deepEqual(r.commonTerms, ["shared"]);
});

test("parseTranscript: more than maxCues cues is rejected", () => {
  assert.equal(parseTranscript(Array(20001).fill("a").join("\n\n")).reason, "TOO_MANY_CUES");
  assert.equal(parseTranscript(Array(20000).fill("a").join("\n\n")).ok, true);
});
test("chapter label keeps the three most distinctive terms", () => {
  const r = analyzeTranscript("alpha alpha alpha alpha beta beta beta gamma gamma delta epsilon");
  assert.equal(r.chapters[0].label, "alpha, beta, gamma");
});
test("summary: sentences under six words are ignored", () => {
  const s = analyzeTranscript("Alpha beta gamma delta epsilon.\n\nAlpha beta gamma delta epsilon zeta.").summary;
  assert.deepEqual(s.map(x => x.text), ["Alpha beta gamma delta epsilon zeta."]);
});
test("summary: chosen sentences come back in transcript order, not score order", () => {
  const t = ["Banana banana banana smoothie recipe today is nice.", "Zebra quartz jungle monster walks by quickly.", "Banana smoothie banana mixing banana blender taste.", "Quartz zebra quartz zebra quartz zebra quartz zebra tiny sparkling crystals."].join("\n\n");
  assert.deepEqual(analyzeTranscript(t, { summarySentences: 2 }).summary.map(x => x.text), ["Banana smoothie banana mixing banana blender taste.", "Quartz zebra quartz zebra quartz zebra quartz zebra tiny sparkling crystals."]);
});
test("summary: score is normalised by sentence length", () => {
  const t = "Alpha alpha alpha beta beta beta.\n\nGamma gamma gamma delta delta epsilon epsilon zeta theta.";
  assert.deepEqual(analyzeTranscript(t, { summarySentences: 1 }).summary.map(x => x.text), ["Alpha alpha alpha beta beta beta."]);
});
test("steps: two-word imperatives are skipped; leading filler words are stripped", () => {
  const r = analyzeTranscript("Click here. So click the green button. Okay, open the settings menu. And save the file now.");
  assert.deepEqual(r.steps.map(s => s.step), ["click the green button", "open the settings menu", "save the file now"]);
});
