// Personal learning tutor (85-capability programme: P01): courses made of lessons and multiple-choice questions THE OWNER SUPPLIES, quizzes that adapt to what is
// not yet known (Leitner boxes with growing review intervals), honest progress and a study plan. It never invents lessons or answers (no model, no network, no spend):
// the tutor schedules and grades; the content comes from the owner's own notes/material. Tenant-scoped, owner-only mutation, secrets refused, everything bounded.
import { createStore, clone } from "./business/store.mjs";
import { ownProp } from "./safe-keys.mjs";
import { scrub } from "./secret-patterns.mjs";

export const LIMITS = Object.freeze({ maxCourses: 50, maxLessons: 100, maxQuestions: 500, maxText: 20000, maxPrompt: 1000, maxChoice: 300, maxChoices: 6, maxAttempts: 2000, maxQuiz: 20 });
export const BOX_DAYS = Object.freeze([0, 0, 1, 3, 7, 14, 30]);            // index = box (1..6); a wrong answer returns to box 1 and is due again immediately
const ID = /^[a-z][a-z0-9_-]{0,39}$/, TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, DAY = 86400000;
const bad = s => scrub(String(s)) !== String(s);

export function createTutor({ file = null, now: nowFn = () => Date.now() } = {}) {
  const now = () => { const v = nowFn(); return typeof v === "number" ? v : Date.parse(v); };       // accepts a ms clock or an ISO-string clock
  const store = createStore({ file, init: () => ({ courses: {} }), mode: 0o600 }), d = store.data;
  const key = (t, id) => t + "\u0000" + id;
  const tenantOk = t => typeof t === "string" && TENANT.test(t);
  // A course whose stored shape is wrong (hand-edited file) is treated as absent instead of crashing half way through a write.
  const sane = c => c && typeof c === "object" && Array.isArray(c.lessons) && Array.isArray(c.questions) && Array.isArray(c.attempts) && c.questions.every(q => q && typeof q === "object" && Number.isInteger(q.box) && q.box >= 0 && q.box < BOX_DAYS.length && Number.isFinite(q.dueAt) && Number.isInteger(q.seen) && Number.isInteger(q.correct));
  const course = (t, id) => { if (!(tenantOk(t) && typeof id === "string")) return null; const c = ownProp(d.courses, key(t, id)) ?? null; return sane(c) ? c : null; };
  const owner = actor => actor === "OWNER";
  const str = (v, n) => typeof v === "string" && v.trim() !== "" && v.length <= n;

  function createCourse({ tenantId, id, title, lessons, questions, actor } = {}) {
    if (!owner(actor)) return { ok: false, reason: "ONLY_OWNER_MAY_CREATE" };
    if (!tenantOk(tenantId)) return { ok: false, reason: "TENANT_INVALID" };
    if (typeof id !== "string" || !ID.test(id)) return { ok: false, reason: "COURSE_ID_INVALID" };
    if (!str(title, 160)) return { ok: false, reason: "TITLE_INVALID" };
    if (bad(title)) return { ok: false, reason: "SECRET_IN_INPUT" };
    if (course(tenantId, id)) return { ok: false, reason: "COURSE_EXISTS" };
    if (Object.values(d.courses).filter(c => c.tenantId === tenantId).length >= LIMITS.maxCourses) return { ok: false, reason: "TOO_MANY_COURSES" };
    if (!Array.isArray(lessons) || !lessons.length || lessons.length > LIMITS.maxLessons || Object.keys(lessons).length !== lessons.length) return { ok: false, reason: "LESSONS_INVALID" };
    if (!Array.isArray(questions) || !questions.length || questions.length > LIMITS.maxQuestions || Object.keys(questions).length !== questions.length) return { ok: false, reason: "QUESTIONS_INVALID" };
    const lessonIds = new Set(), L = [];
    for (const l of lessons) {
      if (!l || typeof l !== "object" || typeof l.id !== "string" || !ID.test(l.id) || lessonIds.has(l.id) || !str(l.title, 160) || !str(l.text, LIMITS.maxText)) return { ok: false, reason: "LESSON_INVALID" };
      if (bad(l.title) || bad(l.text)) return { ok: false, reason: "SECRET_IN_INPUT" };
      lessonIds.add(l.id); L.push({ id: l.id, title: l.title.trim(), text: l.text });
    }
    const qIds = new Set(), Q = [];
    for (const q of questions) {
      if (!q || typeof q !== "object" || typeof q.id !== "string" || !ID.test(q.id) || qIds.has(q.id)) return { ok: false, reason: "QUESTION_INVALID" };
      if (typeof q.lessonId !== "string" || !lessonIds.has(q.lessonId)) return { ok: false, reason: "QUESTION_LESSON_UNKNOWN:" + q.id };
      if (!str(q.prompt, LIMITS.maxPrompt) || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > LIMITS.maxChoices || Object.keys(q.choices).length !== q.choices.length || !q.choices.every(c => str(c, LIMITS.maxChoice))) return { ok: false, reason: "QUESTION_INVALID:" + q.id };
      if (new Set(q.choices.map(c => c.trim().toLowerCase())).size !== q.choices.length) return { ok: false, reason: "DUPLICATE_CHOICES:" + q.id };
      if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.choices.length) return { ok: false, reason: "ANSWER_INDEX_INVALID:" + q.id };
      const expl = q.explanation === undefined ? "" : q.explanation; if (typeof expl !== "string" || expl.length > 1000) return { ok: false, reason: "EXPLANATION_INVALID:" + q.id };
      if (bad(q.prompt) || q.choices.some(bad) || bad(expl)) return { ok: false, reason: "SECRET_IN_INPUT" };
      qIds.add(q.id); Q.push({ id: q.id, lessonId: q.lessonId, prompt: q.prompt.trim(), choices: q.choices.map(c => c.trim()), answerIndex: q.answerIndex, explanation: expl, box: 0, dueAt: 0, seen: 0, correct: 0 });
    }
    d.courses[key(tenantId, id)] = { tenantId, id, title: title.trim(), lessons: L, questions: Q, attempts: [], createdAt: now() }; store.save();
    return { ok: true, id, lessons: L.length, questions: Q.length };
  }

  const view = c => ({ id: c.id, title: c.title, lessons: c.lessons.map(l => ({ id: l.id, title: l.title })), questions: c.questions.length });
  const list = ({ tenantId } = {}) => (tenantOk(tenantId) ? Object.values(d.courses).filter(c => c.tenantId === tenantId).map(view) : []);
  function lesson({ tenantId, courseId, lessonId } = {}) {
    const c = course(tenantId, courseId); if (!c) return { ok: false, reason: "COURSE_NOT_FOUND" };
    const l = c.lessons.find(x => x.id === lessonId); return l ? { ok: true, lesson: clone(l) } : { ok: false, reason: "LESSON_NOT_FOUND" };
  }

  /** Pick questions: due ones first (lowest box first), then never-seen ones, then the rest by earliest due. Deterministic. The answer is NOT included. */
  function startQuiz({ tenantId, courseId, lessonId = null, count = 5 } = {}) {
    const c = course(tenantId, courseId); if (!c) return { ok: false, reason: "COURSE_NOT_FOUND" };
    if (!Number.isInteger(count) || count < 1 || count > LIMITS.maxQuiz) return { ok: false, reason: "COUNT_INVALID" };
    if (lessonId !== null && !c.lessons.some(l => l.id === lessonId)) return { ok: false, reason: "LESSON_NOT_FOUND" };
    const t = now(), pool = c.questions.filter(q => lessonId === null || q.lessonId === lessonId);
    const rank = q => (q.seen === 0 ? [1, 0, 0] : q.dueAt <= t ? [0, q.box, q.dueAt] : [2, q.dueAt, q.box]);
    const picked = [...pool].sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return a.id < b.id ? -1 : 1; }).slice(0, count);
    return { ok: true, questions: picked.map(q => ({ id: q.id, lessonId: q.lessonId, prompt: q.prompt, choices: [...q.choices], due: q.seen === 0 ? "NEW" : q.dueAt <= t ? "DUE" : "NOT_DUE" })) };
  }

  function answer({ tenantId, courseId, questionId, choiceIndex, actor } = {}) {
    if (!owner(actor)) return { ok: false, reason: "ONLY_OWNER_MAY_ANSWER" };
    const c = course(tenantId, courseId); if (!c) return { ok: false, reason: "COURSE_NOT_FOUND" };
    const q = c.questions.find(x => x.id === questionId); if (!q) return { ok: false, reason: "QUESTION_NOT_FOUND" };
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= q.choices.length) return { ok: false, reason: "CHOICE_INVALID" };
    const t = now(); if (!Number.isFinite(t) || Math.abs(t) > 8.64e15 - 40 * DAY * 1000) return { ok: false, reason: "CLOCK_INVALID" };       // nothing is changed on a broken clock
    const right = choiceIndex === q.answerIndex;
    const wasDue = q.seen === 0 || q.dueAt <= t;     // answering again before the review is due is practice only: it cannot raise the box (no gaming "mastery" with instant repeats)
    q.seen++; if (wasDue || !right) { q.cSeen = (q.cSeen ?? 0) + 1; if (right) q.cCorrect = (q.cCorrect ?? 0) + 1; }       // accuracy counts only answers that counted for review: instant repeats are practice and cannot inflate it
    if (right) { q.correct++; if (wasDue) q.box = Math.min(BOX_DAYS.length - 1, Math.max(q.box, 1) + 1); } else q.box = 1;
    if (wasDue || !right) q.dueAt = t + BOX_DAYS[q.box] * DAY;
    c.attempts.push({ at: t, questionId, right }); if (c.attempts.length > LIMITS.maxAttempts) c.attempts.splice(0, c.attempts.length - LIMITS.maxAttempts);
    store.save();
    return { ok: true, correct: right, countedForReview: wasDue || !right, correctIndex: q.answerIndex, explanation: q.explanation, box: q.box, nextReviewAt: new Date(q.dueAt).toISOString() };
  }

  /** Mastery of a lesson = share of its questions that reached box >= 4. Unseen questions are reported as unseen, never counted as failed or known. */
  function lessonStats(c, l) {
    const qs = c.questions.filter(q => q.lessonId === l.id), seen = qs.filter(q => q.seen > 0), t = now();
    const mastered = qs.filter(q => q.box >= 4).length, answers = seen.reduce((s, q) => s + (q.cSeen ?? q.seen), 0), right = seen.reduce((s, q) => s + (q.cSeen !== undefined ? q.cCorrect ?? 0 : q.correct), 0);
    return { lessonId: l.id, title: l.title, questions: qs.length, unseen: qs.length - seen.length, due: seen.filter(q => q.dueAt <= t).length, mastered, masteryPct: seen.length ? Math.round((mastered / qs.length) * 100) : null, accuracyPct: answers ? Math.round((right / answers) * 100) : null };
  }
  function progress({ tenantId, courseId } = {}) {
    const c = course(tenantId, courseId); if (!c) return { ok: false, reason: "COURSE_NOT_FOUND" };
    const lessons = c.lessons.map(l => lessonStats(c, l)), answered = c.attempts.length;
    return { ok: true, courseId, lessons, answeredRecent: answered, note: answered ? "Mastery counts questions that reached review box 4+; null = nothing answered yet (not zero)." : "Nothing answered yet: mastery is unknown, not zero." };
  }
  /** Study plan: lessons ordered by what most needs work (unknown mastery counts as needing a first pass), with the next concrete action. */
  function plan({ tenantId, courseId } = {}) {
    const c = course(tenantId, courseId); if (!c) return { ok: false, reason: "COURSE_NOT_FOUND" };
    const rows = c.lessons.map((l, i) => ({ s: lessonStats(c, l), i })).map(({ s, i }) => ({ ...s, i, need: s.due * 3 + s.unseen * 2 + (s.masteryPct === null ? 0 : (100 - s.masteryPct) / 25) })).sort((a, b) => b.need - a.need || a.i - b.i);
    return { ok: true, courseId, steps: rows.map(r => ({ lessonId: r.lessonId, title: r.title, action: r.due > 0 ? "REVIEW_DUE" : r.unseen > 0 ? (r.unseen === r.questions ? "READ_THEN_FIRST_QUIZ" : "QUIZ_NEW_QUESTIONS") : r.masteryPct !== null && r.masteryPct < 100 ? "PRACTISE_WEAK" : "DONE_FOR_NOW", due: r.due, unseen: r.unseen, masteryPct: r.masteryPct })) };
  }
  function remove({ tenantId, courseId, actor } = {}) {
    if (!owner(actor)) return { ok: false, reason: "ONLY_OWNER_MAY_DELETE" };
    if (!course(tenantId, courseId)) return { ok: false, reason: "COURSE_NOT_FOUND" };
    delete d.courses[key(tenantId, courseId)]; store.save(); return { ok: true };
  }
  return { createCourse, list, lesson, startQuiz, answer, progress, plan, remove };
}
