import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, verifyCoverage, mapReducePlan } from "../atlasz-addons/chunker.mjs";

const mk = (text, s, e) => ({ start: s, end: e, text: text.slice(s, e) });

test("chunker mutation: exact parameter limits", () => {
  assert.equal(chunkText("hello", { maxTokens: 15, overlapTokens: 0 }).reason, "MAX_TOKENS_INVALID");
  assert.equal(chunkText("hello", { maxTokens: 16, overlapTokens: 0 }).ok, true);
  assert.equal(chunkText("hello", { maxTokens: 100, overlapTokens: 50 }).reason, "OVERLAP_INVALID");
  assert.equal(chunkText("hello", { maxTokens: 100, overlapTokens: 49 }).ok, true);
  assert.equal(chunkText("hello", { maxTokens: 100, overlapTokens: -1 }).reason, "OVERLAP_INVALID");
  assert.equal(chunkText("hello", { maxTokens: 100, overlapTokens: 0 }).ok, true);
});
test("chunker mutation: boundary search is limited to the back half of the window and the first matching boundary class wins", () => {
  const t1 = "A".repeat(10) + "\n\n" + "b ".repeat(40);           // paragraph break only in the front half -> must not be used
  const r1 = chunkText(t1, { maxTokens: 16, overlapTokens: 0 });
  assert.ok(r1.chunks[0].end > 32, "end " + r1.chunks[0].end);
  const t2 = "A".repeat(40) + "\n\n" + "b ".repeat(30);           // paragraph break in the back half beats later word boundaries
  const r2 = chunkText(t2, { maxTokens: 16, overlapTokens: 0 });
  assert.equal(r2.chunks[0].end, 42);
});
test("chunker mutation: chunk count cap is exact", () => {
  const ok = chunkText("z".repeat(64 * 5000), { maxTokens: 16, overlapTokens: 0 });
  assert.equal(ok.ok, true); assert.equal(ok.chunks.length, 5000);
  assert.equal(chunkText("z".repeat(64 * 5000 + 1), { maxTokens: 16, overlapTokens: 0 }).reason, "TOO_MANY_CHUNKS");
});
test("chunker mutation: overlap advance, final chunk stops, overlap starts on a word boundary", () => {
  const r = chunkText("z".repeat(200), { maxTokens: 16, overlapTokens: 4 });
  assert.deepEqual(r.chunks.map(c => [c.start, c.end]), [[0, 64], [48, 112], [96, 160], [144, 200]]);
  const text = Array.from({ length: 200 }, () => "abcde").join(" ");
  const w = chunkText(text, { maxTokens: 16, overlapTokens: 4 });
  assert.ok(w.chunks.length > 3);
  w.chunks.forEach((c, i) => { if (i) assert.match(text[c.start - 1], /\s/, "chunk " + i + " starts mid-word"); });
  assert.equal(w.coverage.complete, true);
});
test("chunker mutation: coverage verifier counts a gap and exact finalTasks/ceil in plan", () => {
  const text = "a".repeat(30);
  const gap = verifyCoverage(text, [mk(text, 0, 10), mk(text, 20, 30)]);
  assert.deepEqual([gap.complete, gap.uncovered], [false, 20]);
  const full = verifyCoverage(text, [mk(text, 0, 20), mk(text, 10, 30)]);
  assert.deepEqual([full.complete, full.uncovered, full.faithful], [true, 0, true]);
  assert.equal(verifyCoverage(text, [mk(text, 0, 30)]).complete, true);
  assert.equal(verifyCoverage(text, [mk(text, 0, 20)]).complete, false);
  assert.deepEqual(mapReducePlan(10, { fanIn: 3 }).stages.map(s => s.tasks), [10, 4, 2, 1]);
  assert.equal(mapReducePlan(10, { fanIn: 3 }).finalTasks, 1);
  assert.equal(mapReducePlan(0).finalTasks, 0); assert.equal(mapReducePlan(1).finalTasks, 1);
  assert.equal(mapReducePlan(5, { fanIn: 2 }).ok, true); assert.equal(mapReducePlan(5, { fanIn: 64 }).ok, true);
  assert.equal(mapReducePlan(5, { fanIn: 65 }).ok, false); assert.equal(mapReducePlan(5, { fanIn: 1 }).ok, false);
  assert.equal(mapReducePlan(0).ok, true); assert.equal(mapReducePlan(-1).ok, false);
});
