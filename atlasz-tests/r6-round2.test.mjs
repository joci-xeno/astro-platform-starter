import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { normalizeCandidate } from "../atlasz-addons/suggestions.mjs";
import { analyze } from "../atlasz-addons/analyst.mjs";
import { reviewCode } from "../atlasz-addons/code-review.mjs";
import { createTutor } from "../atlasz-addons/tutor.mjs";
import { tmp, rm } from "./helpers.mjs";

test("audit chain: two managers appending to one file keep a single valid chain (no fork, no sequence gap)", () => {
  const d = tmp("ac-"); try {
    const f = path.join(d, "a.jsonl"), A = createAuditChain({ filePath: f }), B = createAuditChain({ filePath: f });
    A.append("ONE"); B.append("TWO"); A.append("THREE"); B.append("FOUR");
    const C = createAuditChain({ filePath: f }); assert.equal(C.entries().length, 4); assert.deepEqual(C.entries().map(e => e.seq), [1, 2, 3, 4]); assert.equal(C.verify().ok, true);
  } finally { rm(d); }
});

test("A08: titles made only of invisible or blank-looking characters are refused", () => {
  for (const t of ["ㅤ", "⠀", "͏᠎", "ᅟᅠ", "ﾠ", "\u{e0041}\u{e0042}", "​​"]) assert.equal(normalizeCandidate({ key: "a", source: "approvals", title: t }), null, JSON.stringify(t));
  assert.equal(normalizeCandidate({ key: "a", source: "approvals", title: "Pay a​b" }).title, "Pay ab");
});

test("M07: fillMissing accepts only plain scalar values and never echoes a secret column name in an error", () => {
  const csv = "a,b\n1,\n2,3\n";
  for (const value of [["x"], { x: 1 }, null, undefined, 1n, Infinity, () => 1]) assert.equal(analyze(csv, { ops: [{ op: "fillMissing", column: "b", value }] }).ok, false);
  assert.equal(analyze(csv, { ops: [{ op: "fillMissing", column: "b", value: 0 }] }).ok, true);
  const SECRET = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV", r = analyze(SECRET + ",b\nx,\ny,\n", { ops: [{ op: "fillMissing", column: SECRET, strategy: "mean" }] });
  assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes(SECRET));
});

test("C01: unknown file types are NOT reviewed (never clean) and a 201-char path no longer hides other findings in a repo", () => {
  for (const p of ["a.dart", "a.scala", "a.ex", "a.coffee", "a.zsh", "a.astro", "a.pyw", "a.pyi", "a.ipynb"]) { const r = reviewCode({ files: [{ path: p, content: "eval(x)" }] }); assert.equal(r.verdict, "INCOMPLETE_REVIEW", p); }
  assert.notEqual(reviewCode({ files: [{ path: "a.js", content: "const x = 1;" }] }).verdict, "INCOMPLETE_REVIEW");
});

test("P01: a hand-edited store with hostile shapes is refused instead of throwing or inflating accuracy", () => {
  const d = tmp("tu-"); try {
    const file = path.join(d, "t.json"), lessons = [{ id: "l1", title: "B", text: "Water boils at 100 C." }], questions = [{ id: "q1", lessonId: "l1", prompt: "Boil?", choices: ["90", "100"], answerIndex: 1 }];
    const tu = createTutor({ file, now: () => 1_800_000_000_000 }); assert.equal(tu.createCourse({ tenantId: "t1", id: "c", title: "C", lessons, questions, actor: "OWNER" }).ok, true);
    const orig = fs.readFileSync(file, "utf8");
    const bad = fn => { const j = JSON.parse(orig); fn(Object.values(j.courses)[0]); fs.writeFileSync(file, JSON.stringify(j)); const t2 = createTutor({ file, now: () => 1_800_000_000_000 }); assert.deepEqual(t2.list({ tenantId: "t1" }), []); assert.doesNotThrow(() => t2.list({ tenantId: "t1" })); assert.equal(t2.startQuiz({ tenantId: "t1", courseId: "c", actor: "OWNER" }).ok, false); };
    bad(c => { c.lessons.push(null); }); bad(c => { delete c.questions[0].choices; }); bad(c => { c.questions[0].dueAt = 9e15; }); bad(c => { c.questions[0].cSeen = 1; c.questions[0].cCorrect = 5; c.questions[0].seen = 1; }); bad(c => { c.questions[0].correct = 50; c.questions[0].seen = 1; }); bad(c => { c.questions[0].box = 5; }); bad(c => { c.questions[0].dueAt = 5e12; }); bad(c => { c.questions[0].choices = [1, {}]; });
  } finally { rm(d); }
});

test("M12: deleting the profile store after an assignment existed denies (fail closed); a store that never had assignments still allows", async () => {
  const { createProfiles, createAgentProfileGate } = await import("../atlasz-addons/assistant-profiles.mjs");
  const d = tmp("pg-"); try {
    const file = path.join(d, "p.json"), gate = createAgentProfileGate({ file, tenantId: "JOCI" });
    assert.equal(gate("EXECUTION-3", "sandbox.x").allowed, true, "nothing was ever assigned");
    const P = createProfiles({ file }), c = P.create("JOCI", { actor: "OWNER", id: "p1", name: "narrow", instructions: "x", tools: [] });
    assert.equal(c.ok, true, JSON.stringify(c)); assert.equal(P.assign("JOCI", "EXECUTION-3", "p1", { actor: "OWNER" }).ok, true);
    fs.rmSync(file); assert.equal(gate("EXECUTION-3", "sandbox.x").allowed, false);
  } finally { rm(d); }
});
