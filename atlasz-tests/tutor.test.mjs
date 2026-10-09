import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTutor, LIMITS, BOX_DAYS } from "../atlasz-addons/tutor.mjs";
import { tmp, rm } from "./helpers.mjs";

const O = { actor: "OWNER" }, T = "t1", DAY = 86400000;
const lessons = [{ id: "l1", title: "Basics", text: "Water boils at 100 C at sea level." }, { id: "l2", title: "Advanced", text: "Pressure changes the boiling point." }];
const questions = [
  { id: "q1", lessonId: "l1", prompt: "Boiling point of water at sea level?", choices: ["90 C", "100 C", "110 C"], answerIndex: 1, explanation: "100 C." },
  { id: "q2", lessonId: "l1", prompt: "Water freezes at?", choices: ["0 C", "10 C"], answerIndex: 0 },
  { id: "q3", lessonId: "l2", prompt: "Higher pressure makes boiling point?", choices: ["lower", "higher"], answerIndex: 1 },
];
const mk = (o = {}) => { const clock = { t: 1_800_000_000_000 }; const tu = createTutor({ now: () => clock.t, ...o }); return { tu, clock }; };
const course = (tu, over = {}) => tu.createCourse({ tenantId: T, id: "phys", title: "Physics", lessons, questions, ...O, ...over });

test("course creation: only the owner, strict validation of every lesson and question, secrets refused, nothing stored on refusal", () => {
  const { tu } = mk();
  assert.equal(course(tu, { actor: "SEARCH-1" }).reason, "ONLY_OWNER_MAY_CREATE"); for (const a of ["owner", "OWNER ", undefined, null]) assert.equal(course(tu, { actor: a }).reason, "ONLY_OWNER_MAY_CREATE");
  for (const [patch, why] of [[{ tenantId: "bad tenant" }, "TENANT_INVALID"], [{ id: "Bad Id" }, "COURSE_ID_INVALID"], [{ title: " " }, "TITLE_INVALID"], [{ lessons: [] }, "LESSONS_INVALID"], [{ lessons: new Array(2) }, "LESSONS_INVALID"], [{ questions: [] }, "QUESTIONS_INVALID"],
    [{ lessons: [lessons[0], lessons[0]] }, "LESSON_INVALID"], [{ questions: [{ ...questions[0], lessonId: "nope" }] }, "QUESTION_LESSON_UNKNOWN:q1"], [{ questions: [{ ...questions[0], answerIndex: 3 }] }, "ANSWER_INDEX_INVALID:q1"],
    [{ questions: [{ ...questions[0], choices: ["a"] }] }, "QUESTION_INVALID:q1"], [{ questions: [{ ...questions[0], choices: ["a", "A"] }] }, "DUPLICATE_CHOICES:q1"], [{ questions: [questions[0], questions[0]] }, "QUESTION_INVALID"],
    [{ questions: [{ ...questions[0], answerIndex: 1.5 }] }, "ANSWER_INDEX_INVALID:q1"], [{ lessons: [{ ...lessons[0], text: "x".repeat(LIMITS.maxText + 1) }] }, "LESSON_INVALID"]]) assert.equal(course(tu, patch).reason, why, JSON.stringify(Object.keys(patch)));
  const K = "gh" + "p_" + "a".repeat(36);
  assert.equal(course(tu, { lessons: [{ ...lessons[0], text: "token " + K }] }).reason, "SECRET_IN_INPUT"); assert.equal(course(tu, { questions: [{ ...questions[0], explanation: K }] }).reason, "SECRET_IN_INPUT");
  assert.equal(course(tu, { title: "Course " + K }).reason, "SECRET_IN_INPUT", "the course title is screened like every other text");
  assert.equal(tu.list({ tenantId: T }).length, 0); assert.deepEqual(course(tu), { ok: true, id: "phys", lessons: 2, questions: 3 }); assert.equal(course(tu).reason, "COURSE_EXISTS");
});

test("quiz: answers are never sent with the questions; new questions first, then due ones lowest box first; grading, explanation and spacing follow the Leitner boxes", () => {
  const { tu, clock } = mk(); course(tu);
  const q = tu.startQuiz({ tenantId: T, courseId: "phys", count: 5 }); assert.equal(q.ok, true); assert.equal(q.questions.length, 3); assert.ok(q.questions.every(x => x.due === "NEW"));
  assert.ok(!JSON.stringify(q).includes("answerIndex") && !JSON.stringify(q).includes("explanation"), "no answer leaks before answering");
  assert.equal(tu.answer({ tenantId: T, courseId: "phys", questionId: "q1", choiceIndex: 1, actor: "SEARCH-1" }).reason, "ONLY_OWNER_MAY_ANSWER");
  const a = tu.answer({ tenantId: T, courseId: "phys", questionId: "q1", choiceIndex: 1, ...O }); assert.deepEqual([a.correct, a.correctIndex, a.explanation, a.box], [true, 1, "100 C.", 2]); assert.equal(a.nextReviewAt, new Date(clock.t + BOX_DAYS[2] * DAY).toISOString());
  const w = tu.answer({ tenantId: T, courseId: "phys", questionId: "q2", choiceIndex: 1, ...O }); assert.deepEqual([w.correct, w.box, w.correctIndex], [false, 1, 0]);
  // q2 (wrong, due now) comes before q3 (new) before q1 (not due): due first, then new, then the rest
  assert.deepEqual(tu.startQuiz({ tenantId: T, courseId: "phys" }).questions.map(x => [x.id, x.due]), [["q2", "DUE"], ["q3", "NEW"], ["q1", "NOT_DUE"]]);
  clock.t += 3 * DAY; assert.equal(tu.startQuiz({ tenantId: T, courseId: "phys", count: 1 }).questions[0].id, "q2"); assert.equal(tu.startQuiz({ tenantId: T, courseId: "phys" }).questions.find(x => x.id === "q1").due, "DUE");
  for (const bad of [-1, 3, 1.5, "1", null, undefined, NaN]) assert.equal(tu.answer({ tenantId: T, courseId: "phys", questionId: "q1", choiceIndex: bad, ...O }).reason, "CHOICE_INVALID", String(bad));
  assert.equal(tu.answer({ tenantId: T, courseId: "phys", questionId: "zz", choiceIndex: 0, ...O }).reason, "QUESTION_NOT_FOUND");
  assert.equal(tu.startQuiz({ tenantId: T, courseId: "phys", lessonId: "l2" }).questions.length, 1); assert.equal(tu.startQuiz({ tenantId: T, courseId: "phys", lessonId: "x" }).reason, "LESSON_NOT_FOUND");
  for (const c of [0, 21, 1.5, "3"]) assert.equal(tu.startQuiz({ tenantId: T, courseId: "phys", count: c }).reason, "COUNT_INVALID");
});

test("boxes climb with repeated correct answers up to the last one and a wrong answer drops back to box 1", () => {
  const { tu, clock } = mk(); course(tu); const ans = i => tu.answer({ tenantId: T, courseId: "phys", questionId: "q1", choiceIndex: i, ...O });
  const boxes = []; for (let i = 0; i < 8; i++) { boxes.push(ans(1).box); clock.t += 40 * DAY; } assert.deepEqual(boxes, [2, 3, 4, 5, 6, 6, 6, 6]);
  assert.equal(ans(0).box, 1);
});

test("progress and plan are honest: unseen questions are unknown (null), not zero; mastery means box 4+; the plan puts the neediest lesson first", () => {
  const { tu, clock } = mk(); course(tu);
  let p = tu.progress({ tenantId: T, courseId: "phys" }); assert.ok(p.lessons.every(l => l.masteryPct === null && l.accuracyPct === null && l.unseen === l.questions)); assert.match(p.note, /unknown, not zero/);
  assert.deepEqual(tu.plan({ tenantId: T, courseId: "phys" }).steps.map(s => [s.lessonId, s.action]), [["l1", "READ_THEN_FIRST_QUIZ"], ["l2", "READ_THEN_FIRST_QUIZ"]]);
  const ans = (id, i) => tu.answer({ tenantId: T, courseId: "phys", questionId: id, choiceIndex: i, ...O });
  ans("q1", 1); ans("q2", 1); ans("q3", 1);                 // q1, q3 right; q2 wrong
  for (let k = 0; k < 2; k++) { clock.t += 40 * DAY; ans("q3", 1); }        // q3 reaches exactly box 4 (mastered)
  p = tu.progress({ tenantId: T, courseId: "phys" }); const l1 = p.lessons[0], l2 = p.lessons[1];
  assert.deepEqual([l1.mastered, l1.masteryPct, l1.accuracyPct], [0, 0, 50]); assert.deepEqual([l2.mastered, l2.masteryPct, l2.accuracyPct], [1, 100, 100]);
  const plan = tu.plan({ tenantId: T, courseId: "phys" }).steps; assert.equal(plan[0].lessonId, "l1"); assert.equal(plan[0].action, "REVIEW_DUE"); assert.equal(plan.find(s => s.lessonId === "l2").action, "DONE_FOR_NOW");
});

test("tenant isolation, owner-only removal, lessons readable, restart persistence, corrupt file fails closed, bounded course count", () => {
  const d = tmp("tutor-"), file = path.join(d, "t.json");
  try {
    const { tu } = mk({ file }); course(tu); assert.equal(tu.list({ tenantId: "other" }).length, 0);
    for (const call of [() => tu.lesson({ tenantId: "other", courseId: "phys", lessonId: "l1" }), () => tu.startQuiz({ tenantId: "other", courseId: "phys" }), () => tu.progress({ tenantId: "other", courseId: "phys" }), () => tu.plan({ tenantId: "other", courseId: "phys" }), () => tu.answer({ tenantId: "other", courseId: "phys", questionId: "q1", choiceIndex: 0, ...O })]) assert.equal(call().reason, "COURSE_NOT_FOUND");
    for (const id of ["__proto__", "constructor", "toString"]) assert.equal(tu.progress({ tenantId: T, courseId: id }).reason, "COURSE_NOT_FOUND");
    assert.equal(tu.lesson({ tenantId: T, courseId: "phys", lessonId: "l1" }).lesson.text, lessons[0].text); assert.equal(tu.lesson({ tenantId: T, courseId: "phys", lessonId: "zz" }).reason, "LESSON_NOT_FOUND");
    tu.answer({ tenantId: T, courseId: "phys", questionId: "q1", choiceIndex: 1, ...O });
    const again = createTutor({ file }); assert.equal(again.list({ tenantId: T }).length, 1); assert.equal(again.progress({ tenantId: T, courseId: "phys" }).lessons[0].unseen, 1);
    assert.equal(fs.statSync(file).mode & 0o077, 0, "0600");
    assert.equal(again.remove({ tenantId: T, courseId: "phys", actor: "SEARCH-2" }).reason, "ONLY_OWNER_MAY_DELETE"); assert.equal(again.remove({ tenantId: T, courseId: "phys", ...O }).ok, true); assert.equal(again.list({ tenantId: T }).length, 0);
    fs.writeFileSync(file, "{broken"); assert.throws(() => createTutor({ file }), /STORE_UNREADABLE/);
    const big = mk(); for (let i = 0; i < LIMITS.maxCourses; i++) assert.equal(course(big.tu, { id: "c" + i }).ok, true); assert.equal(course(big.tu, { id: "extra" }).reason, "TOO_MANY_COURSES"); assert.equal(course(big.tu, { id: "extra", tenantId: "t2" }).ok, true);
  } finally { rm(d); }
});

test("plan: a lesson with reviews that are due outranks one that merely has new questions, even when it is listed later", () => {
  const { tu, clock } = mk(); const L = [{ id: "b", title: "B", text: "b" }, { id: "a", title: "A", text: "a" }];
  const Q = [{ id: "qa", lessonId: "a", prompt: "p", choices: ["x", "y"], answerIndex: 0 }, { id: "qb1", lessonId: "b", prompt: "p", choices: ["x", "y"], answerIndex: 0 }, { id: "qb2", lessonId: "b", prompt: "p", choices: ["x", "y"], answerIndex: 0 }];
  assert.equal(tu.createCourse({ tenantId: T, id: "c", title: "C", lessons: L, questions: Q, ...O }).ok, true);
  tu.answer({ tenantId: T, courseId: "c", questionId: "qa", choiceIndex: 0, ...O }); clock.t += 5 * DAY;
  const steps = tu.plan({ tenantId: T, courseId: "c" }).steps; assert.deepEqual(steps.map(s => [s.lessonId, s.action]), [["a", "REVIEW_DUE"], ["b", "READ_THEN_FIRST_QUIZ"]]);
});

test("R6 verification regressions: a broken clock changes nothing, a hand-edited course is refused instead of crashing, and instant repeats cannot inflate accuracy", async () => {
  const { createTutor } = await import("../atlasz-addons/tutor.mjs"); const fs = await import("node:fs"); const path = await import("node:path"); const { tmp, rm } = await import("./helpers.mjs");
  const dir = tmp("tu6-"); const file = path.join(dir, "t.json"); let clock = 1_700_000_000_000;
  try {
    const tu = createTutor({ file, now: () => clock });
    const lessons = [{ id: "l1", title: "L", text: "text" }], questions = [{ id: "q1", lessonId: "l1", prompt: "2+2?", choices: ["3", "4"], answerIndex: 1 }];
    assert.equal(tu.createCourse({ tenantId: "T", id: "c", title: "C", lessons, questions, actor: "OWNER" }).ok, true);
    for (const bad of [NaN, undefined, 8.64e15 + 1, Infinity, -Infinity]) { clock = bad; const before = fs.readFileSync(file, "utf8"); const r = tu.answer({ tenantId: "T", courseId: "c", questionId: "q1", choiceIndex: 1, actor: "OWNER" }); assert.deepEqual([r.ok, r.reason], [false, "CLOCK_INVALID"], String(bad)); assert.equal(fs.readFileSync(file, "utf8"), before, "nothing was written"); }
    clock = 1_700_000_000_000;
    assert.equal(tu.answer({ tenantId: "T", courseId: "c", questionId: "q1", choiceIndex: 1, actor: "OWNER" }).countedForReview, true);
    for (let i = 0; i < 50; i++) tu.answer({ tenantId: "T", courseId: "c", questionId: "q1", choiceIndex: 1, actor: "OWNER" });         // 50 instant repeats
    assert.equal(tu.progress({ tenantId: "T", courseId: "c" }).lessons[0].accuracyPct, 100, "one counted answer, right");
    assert.equal(tu.answer({ tenantId: "T", courseId: "c", questionId: "q1", choiceIndex: 0, actor: "OWNER" }).correct, false);       // a wrong answer always counts
    assert.equal(tu.progress({ tenantId: "T", courseId: "c" }).lessons[0].accuracyPct, 50, "1 right of 2 counted answers, not 51 of 52");
    const j = JSON.parse(fs.readFileSync(file, "utf8")); const c = Object.values(j.courses)[0]; c.attempts = "x"; fs.writeFileSync(file, JSON.stringify(j));
    const tu2 = createTutor({ file, now: () => clock }); assert.equal(tu2.answer({ tenantId: "T", courseId: "c", questionId: "q1", choiceIndex: 1, actor: "OWNER" }).reason, "COURSE_NOT_FOUND"); assert.equal(tu2.progress({ tenantId: "T", courseId: "c" }).reason, "COURSE_NOT_FOUND");
    c.attempts = []; c.questions[0].box = 99; fs.writeFileSync(file, JSON.stringify(j)); assert.equal(createTutor({ file, now: () => clock }).progress({ tenantId: "T", courseId: "c" }).reason, "COURSE_NOT_FOUND", "an impossible box value is refused");
  } finally { rm(dir); }
});
