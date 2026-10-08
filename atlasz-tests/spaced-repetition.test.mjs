import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStudy, sm2, clozeCards, LIMITS } from "../atlasz-addons/spaced-repetition.mjs";
import { tmp, rm } from "./helpers.mjs";

const AGENTS = [...Array.from({ length: 5 }, (_, i) => "SEARCH-" + (i + 1)), ...Array.from({ length: 25 }, (_, i) => "EXECUTION-" + (i + 1))], SPOOF = ["owner", "OWNER ", "SYSTEM", "", null, undefined, {}, ["OWNER"]], DAY = 86400000;
const clock = () => { let t = 1_700_000_000_000; const f = () => t; f.adv = ms => { t += ms; }; return f; };
const O = { actor: "OWNER" }, SK = "s" + "k-ABCDEFGHIJKLMNOPQRSTUV";

test("sm2: first reviews, growth, lapse reset, ease floor, interval cap, grade validation", () => {
  const c0 = { ease: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 };
  const a = sm2(c0, 5); assert.deepEqual([a.repetitions, a.intervalDays, a.ease], [1, 1, 2.6]);
  const b = sm2(a, 5); assert.deepEqual([b.repetitions, b.intervalDays], [2, 6]); const c = sm2(b, 4); assert.deepEqual([c.repetitions, c.intervalDays, c.ease], [3, Math.round(6 * b.ease), b.ease]);
  assert.equal(sm2(c0, 3).ease, 2.36); assert.equal(sm2(c0, 4).ease, 2.5);
  const lapse = sm2({ ease: 2.5, intervalDays: 40, repetitions: 6, lapses: 1 }, 2); assert.deepEqual([lapse.repetitions, lapse.intervalDays, lapse.lapses], [0, 1, 2]);
  assert.equal(sm2({ ease: 1.3, intervalDays: 1, repetitions: 0, lapses: 0 }, 0).ease, 1.3, "ease never drops below 1.3"); assert.equal(sm2({ ease: 1.31, intervalDays: 1, repetitions: 0, lapses: 0 }, 0).ease, 1.3);
  assert.equal(sm2({ ease: 3, intervalDays: 3000, repetitions: 9, lapses: 0 }, 5).intervalDays, LIMITS.maxIntervalDays);
  assert.deepEqual([sm2(c0, 2).lapses, sm2(c0, 3).lapses], [1, 0], "grade 2 is a lapse, 3 is a pass");
  assert.equal(sm2({ ease: 2.5, intervalDays: 7, repetitions: 2, lapses: 0 }, 4).intervalDays, 18, "17.5 rounds to 18 (not floor, not fractional)"); assert.equal(sm2({ ease: 2.5, intervalDays: 7, repetitions: 2, lapses: 0 }, 4).repetitions, 3);
  assert.equal(sm2({ ease: 1.3, intervalDays: 0, repetitions: 5, lapses: 0 }, 3).intervalDays, 1, "an interval is never below one day");
  for (const g of [-1, 6, 2.5, "4", null, undefined, NaN]) assert.equal(sm2(c0, g), null, String(g));
  for (const g of [0, 1, 2, 3, 4, 5]) assert.equal(sm2(c0, g).intervalDays >= 1, true);
});

test("clozeCards: one card per cloze number, hints, shared numbers, refusals", () => {
  const r = clozeCards("The {{c1::mitochondria}} makes {{c2::ATP::molecule}} and {{c1::heat}}."); assert.equal(r.ok, true); assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].front, "The [...] makes ATP and [...]."); assert.deepEqual(r.cards[0].answers, ["mitochondria", "heat"]); assert.equal(r.cards[0].back, "The mitochondria makes ATP and heat.");
  assert.equal(r.cards[1].front, "The mitochondria makes [... (molecule)] and heat."); assert.equal(r.cards[1].cloze, 2);
  for (const bad of [null, "", "   ", 5, "no markers", "{{c1::}}", "x".repeat(LIMITS.maxFieldChars + 1)]) assert.equal(clozeCards(bad).ok, false, String(bad));
  for (const bad of [null, "", "   ", 5, "{{c1::a}}" + "x".repeat(LIMITS.maxFieldChars)]) assert.equal(clozeCards(bad).reason, "TEXT_INVALID", String(bad).slice(0, 20));
  assert.equal(clozeCards("no markers").reason, "NO_CLOZE_MARKERS"); assert.equal(clozeCards(Array.from({ length: 31 }, (_, i) => `{{c${i}::a${i}}}`).join(" ")).reason, "TOO_MANY_CLOZE_NUMBERS");
  assert.equal(clozeCards(Array.from({ length: 30 }, (_, i) => `{{c${i}::a${i}}}`).join(" ")).ok, true);
});

test("owner only: no agent or spoofed actor can add, review, suspend, remove or forget", () => {
  const s = createStudy(), { id } = s.addCard("t", { deck: "d", front: "q", back: "a", ...O });
  for (const actor of [...AGENTS, ...SPOOF]) {
    assert.equal(s.addCard("t", { deck: "d", front: "q2", back: "a2", actor }).reason, "ONLY_OWNER_MAY_EDIT_CARDS", String(actor)); assert.equal(s.addCloze("t", { deck: "d", text: "{{c1::x}}", actor }).reason, "ONLY_OWNER_MAY_EDIT_CARDS");
    assert.equal(s.review("t", id, 5, { actor }).reason, "ONLY_OWNER_MAY_REVIEW"); assert.equal(s.setSuspended("t", id, true, { actor }).reason, "ONLY_OWNER_MAY_EDIT_CARDS"); assert.equal(s.remove("t", id, { actor }).reason, "ONLY_OWNER_MAY_EDIT_CARDS"); assert.equal(s.forgetAll("t", { actor }).reason, "ONLY_OWNER_MAY_FORGET");
  }
  assert.equal(s.addCard("t", { deck: "d", front: "q2", back: "a2" }).reason, "ONLY_OWNER_MAY_EDIT_CARDS"); assert.equal(s.review("t", id, 5).reason, "ONLY_OWNER_MAY_REVIEW"); assert.equal(s.review("t", id, 5, undefined).reason, "ONLY_OWNER_MAY_REVIEW");
  const g = s.get("t", id).card; assert.deepEqual([g.repetitions, g.suspended, s.exportAll("t").cards.length], [0, false, 1]);
});

test("addCard: validation, redaction, duplicates, tags, caps, tenant isolation", () => {
  const s = createStudy();
  for (const [bad, why] of [[{ deck: "D", front: "q", back: "a" }, "DECK_INVALID"], [{ deck: "../x", front: "q", back: "a" }, "DECK_INVALID"], [{ deck: "", front: "q", back: "a" }, "DECK_INVALID"], [{ deck: 5, front: "q", back: "a" }, "DECK_INVALID"], [{ deck: "d", front: "", back: "a" }, "CARD_TEXT_INVALID"], [{ deck: "d", front: "q", back: "  " }, "CARD_TEXT_INVALID"], [{ deck: "d", front: 1, back: "a" }, "CARD_TEXT_INVALID"], [{ deck: "d", front: "x".repeat(LIMITS.maxFieldChars + 1), back: "a" }, "CARD_TEXT_INVALID"],
    [{ deck: "d", front: "q", back: "a", tags: ["A"] }, "TAGS_INVALID"], [{ deck: "d", front: "q", back: "a", tags: "x" }, "TAGS_INVALID"], [{ deck: "d", front: "q", back: "a", tags: Array.from({ length: LIMITS.maxTags + 1 }, (_, i) => "t" + i) }, "TAGS_INVALID"], [{ deck: "d", front: "q", back: "a", tags: ["x".repeat(LIMITS.maxTagChars + 1)] }, "TAGS_INVALID"], [{ deck: "d", front: "q", back: "a", tags: [5] }, "TAGS_INVALID"]])
    assert.equal(s.addCard("t", { ...bad, ...O }).reason, why, JSON.stringify(bad).slice(0, 60));
  assert.equal(s.addCard("t", { deck: "d", front: "x".repeat(LIMITS.maxFieldChars), back: "a", tags: Array.from({ length: LIMITS.maxTags }, (_, i) => "t" + i), ...O }).ok, true);
  const r = s.addCard("t", { deck: "d", front: "key " + SK, back: "back " + SK, tags: ["b", "a", "b"], ...O }); const g = s.get("t", r.id).card; assert.ok(!JSON.stringify(g).includes("ABCDEFGHIJKLMNOPQRSTUV")); assert.deepEqual(g.tags, ["a", "b"]);
  const d1 = s.addCard("t", { deck: "d", front: "same", back: "x", ...O }), d2 = s.addCard("t", { deck: "d", front: "same", back: "x", ...O }); assert.deepEqual([d2.duplicate, d2.id === d1.id], [true, true]); assert.notEqual(s.addCard("t", { deck: "e", front: "same", back: "x", ...O }).id, d1.id);
  assert.notEqual(s.addCard("t", { deck: "d", front: "same", back: "y", ...O }).id, d1.id, "same front, different back is a different card"); assert.notEqual(s.addCard("t", { deck: "d", front: "same2", back: "x", ...O }).id, d1.id);
  const c1 = s.addCard("t", { deck: "d", front: "cz", back: "cz", cloze: 1, ...O }), c2 = s.addCard("t", { deck: "d", front: "cz", back: "cz", cloze: 2, ...O }); assert.notEqual(c1.id, c2.id, "different cloze numbers are different cards"); assert.equal(s.get("t", c1.id).card.ease, 2.5, "new cards start at ease 2.5");
  assert.throws(() => s.addCard("a b", { deck: "d", front: "q", back: "a", ...O }), /TENANT_INVALID/); s.addCard("t2", { deck: "d", front: "other", back: "x", ...O });
  assert.equal(s.exportAll("t2").cards.length, 1); assert.equal(s.get("t2", r.id).reason, "CARD_NOT_FOUND"); assert.equal(s.review("t2", r.id, 5, O).reason, "CARD_NOT_FOUND"); assert.equal(s.remove("t2", r.id, O).reason, "CARD_NOT_FOUND");
  const big = createStudy(); for (let i = 0; i < LIMITS.maxCards; i++) big.addCard("t", { deck: "d" + (i % 100 < 10 ? i % 100 : 0), front: "q" + i, back: "a", ...O }); assert.equal(big.addCard("t", { deck: "d", front: "extra", back: "a", ...O }).reason, "TOO_MANY_CARDS");
  const dk = createStudy(); for (let i = 0; i < LIMITS.maxDecks; i++) assert.equal(dk.addCard("t", { deck: "k" + i, front: "q", back: "a", ...O }).ok, true); assert.equal(dk.addCard("t", { deck: "knew", front: "q", back: "a", ...O }).reason, "TOO_MANY_DECKS"); assert.equal(dk.addCard("t", { deck: "k1", front: "q2", back: "a", ...O }).ok, true, "existing decks still accept cards");
});

test("review flow: due list hides answers, scheduling moves the due date, lapses return the card, suspended cards are skipped", () => {
  const now = clock(), s = createStudy({ now }), a = s.addCard("t", { deck: "d", front: "q1", back: "ans1", ...O }).id, b = s.addCard("t", { deck: "e", front: "q2", back: "ans2", ...O }).id;
  let due = s.due("t"); assert.equal(due.totalDue, 2); assert.ok(!JSON.stringify(due).includes("ans1"), "due list never reveals the back"); assert.equal(s.due("t", { deck: "e" }).cards[0].id, b);
  const r1 = s.review("t", a, 5, O); assert.deepEqual([r1.ok, r1.intervalDays, r1.lapse], [true, 1, false]); assert.equal(s.due("t").totalDue, 1);
  now.adv(DAY - 1); assert.equal(s.due("t", { deck: "d" }).totalDue, 0, "not yet due 1ms before"); now.adv(1); assert.equal(s.due("t", { deck: "d" }).totalDue, 1, "due exactly at the interval");
  assert.equal(s.review("t", a, 5, O).intervalDays, 6); now.adv(6 * DAY); const lap = s.review("t", a, 1, O); assert.deepEqual([lap.lapse, lap.intervalDays], [true, 1]); assert.equal(s.get("t", a).card.lapses, 1);
  assert.equal(s.review("t", a, 9, O).reason, "GRADE_MUST_BE_INTEGER_0_TO_5"); assert.equal(s.review("t", "nope", 3, O).reason, "CARD_NOT_FOUND");
  assert.deepEqual(s.setSuspended("t", b, true, O), { ok: true, id: b, suspended: true }); assert.equal(s.review("t", b, 3, O).reason, "CARD_SUSPENDED"); assert.ok(!s.due("t", { deck: "e" }).cards.length); assert.equal(s.setSuspended("t", "nope", true, O).reason, "CARD_NOT_FOUND");
  s.setSuspended("t", b, false, O); assert.equal(s.due("t", { deck: "e" }).totalDue, 1);
  // ordering: the most overdue first; limit clamp
  const o = createStudy({ now }); const ids = []; for (let i = 0; i < 5; i++) { ids.push(o.addCard("t", { deck: "d", front: "q" + i, back: "a", ...O }).id); now.adv(1000); }
  assert.deepEqual(o.due("t", { limit: 3 }).cards.map(c => c.id), ids.slice(0, 3)); assert.equal(o.due("t", { limit: 3 }).totalDue, 5); assert.equal(o.due("t", { limit: 0 }).cards.length, 1); assert.equal(o.due("t", { limit: -4 }).cards.length, 1); assert.equal(o.due("t", { limit: "x" }).cards.length, 5); assert.equal(o.due("t", { limit: 1e9 }).cards.length, 5);
  assert.equal(o.due("nobody").totalDue, 0); now.adv(3 * DAY); assert.equal(o.due("t").cards[0].overdueDays, 3);
  const many = createStudy({ now }); for (let i = 0; i < LIMITS.maxDue + 5; i++) many.addCard("t", { deck: "d", front: "q" + i, back: "a", ...O }); assert.equal(many.due("t", { limit: 1e9 }).cards.length, LIMITS.maxDue);
});

test("stats and review log: retention, per-deck counts, log bounded; cloze cards through the store", () => {
  const now = clock(), s = createStudy({ now }), ids = s.addCloze("t", { deck: "bio", text: "A {{c1::cell}} has a {{c2::nucleus}}.", tags: ["x"], ...O }).ids; assert.equal(ids.length, 2); assert.equal(s.get("t", ids[0]).card.cloze, 1);
  assert.equal(s.addCloze("t", { deck: "bio", text: "no markers", ...O }).reason, "NO_CLOZE_MARKERS"); assert.equal(s.addCloze("t", { deck: "BAD", text: "{{c1::a}}", ...O }).reason, "DECK_INVALID");
  assert.deepEqual(s.addCloze("t", { deck: "bio", text: "A {{c1::cell}} has a {{c2::nucleus}}.", ...O }).ids, ids, "re-adding the same cloze text creates no duplicates");
  let st = s.stats("t"); assert.deepEqual([st.cards, st.due, st.retention, st.decks.bio.new], [2, 2, null, 2]);
  s.review("t", ids[0], 5, O); s.review("t", ids[1], 1, O); st = s.stats("t"); assert.deepEqual([st.reviewsLogged, st.retention, st.decks.bio.new], [2, 0.5, 0]); assert.equal(s.stats("t", { deck: "none" }).cards, 0); assert.equal(s.stats("nobody").cards, 0);
  for (let i = 0; i < LIMITS.maxReviewLog + 5; i++) { now.adv(400 * DAY); s.review("t", ids[0], 4, O); if (i === LIMITS.maxReviewLog - 1) assert.equal(s.get("t", ids[0]).card.reviews.length, LIMITS.maxReviewLog, "trimmed as soon as the log is longer than the cap"); } assert.equal(s.get("t", ids[0]).card.reviews.length, LIMITS.maxReviewLog);
  s.setSuspended("t", ids[1], true, O); assert.equal(s.stats("t").decks.bio.suspended, 1); assert.equal(s.stats("t").decks.bio.due, s.stats("t").due, "a suspended card is not counted as due in the deck either"); assert.equal(s.stats("t").due, 0, "suspended cards are not counted due");
});

test("retention: grade 3 counts as a pass, the figure is rounded to three decimals", () => {
  const now = clock(), s = createStudy({ now }), id = s.addCard("t", { deck: "d", front: "q", back: "a", ...O }).id;
  for (const g of [3, 3, 2]) { now.adv(400 * DAY); s.review("t", id, g, O); } assert.equal(s.stats("t").retention, 0.667);
});

test("durability and forget: state survives a restart with a private file; forgetAll removes only that tenant; a corrupt file fails closed", () => {
  const dir = tmp("study-"), file = path.join(dir, "study.json");
  try {
    const now = clock(), a = createStudy({ file, now }), id = a.addCard("t", { deck: "d", front: "q", back: "ans", ...O }).id; a.review("t", id, 5, O); a.addCard("u", { deck: "d", front: "q", back: "a", ...O });
    const b = createStudy({ file, now }); assert.deepEqual([b.get("t", id).card.repetitions, b.get("t", id).card.back], [1, "ans"]); if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.deepEqual(b.forgetAll("t", O), { ok: true, deleted: true }); assert.equal(createStudy({ file, now }).exportAll("t").cards.length, 0); assert.equal(createStudy({ file, now }).exportAll("u").cards.length, 1); assert.deepEqual(b.forgetAll("t", O), { ok: true, deleted: false }); assert.equal(b.forgetAll("a b", O).reason, "TENANT_INVALID");
    fs.writeFileSync(file + ".bad", "{x"); assert.throws(() => createStudy({ file: file + ".bad" }), /STORE_UNREADABLE/); assert.equal(fs.readFileSync(file + ".bad", "utf8"), "{x");
  } finally { rm(dir); }
});
