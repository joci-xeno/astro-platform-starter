// Spaced-repetition study cards (85-capability audit P01 Learning companion: flashcards + scheduling).
// Deterministic SM-2 scheduling, cloze generation from owner-supplied text, tenant-scoped, durable (mode 0600), bounded.
//   * Only the OWNER adds, reviews, edits or deletes cards (agents never study "for" the owner and cannot rewrite the owner's schedule).
//   * Card text is plain data (never executed), secrets are redacted on input, sizes are capped.
//   * No model is used: cloze cards come from explicit {{c1::answer}} markers or from the owner's chosen terms; nothing is invented.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";
import { redactSecrets } from "./text-compare.mjs";
import { okName, own } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({ maxCards: 5000, maxDecks: 100, maxFieldChars: 2000, maxClozePerText: 30, maxDue: 200, maxTags: 10, maxTagChars: 30, maxIntervalDays: 3650, minEase: 1.3, startEase: 2.5, maxReviewLog: 20 });
const DAY = 86400000, TENANT = /^[A-Za-z0-9._-]{1,64}$/, DECK = /^[a-z][a-z0-9-]{0,39}$/, TAG = /^[a-z0-9][a-z0-9-]*$/;
const rid = () => "c" + crypto.randomBytes(6).toString("hex");

/** SM-2 step. grade: 0-5 integer (0-2 = lapse). Returns the next {ease, intervalDays, repetitions, lapses}. Pure. */
export function sm2(card, grade) {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) return null;
  let { ease, intervalDays, repetitions, lapses } = card;
  if (grade < 3) { repetitions = 0; intervalDays = 1; lapses += 1; }
  else { repetitions += 1; intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(intervalDays * ease); }
  ease = Math.max(LIMITS.minEase, ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  intervalDays = Math.min(LIMITS.maxIntervalDays, Math.max(1, intervalDays));
  return { ease: Math.round(ease * 1000) / 1000, intervalDays, repetitions, lapses };
}

/** Turn text with {{c1::answer}} / {{c1::answer::hint}} markers into cards: one card per distinct cloze number, others shown. */
export function clozeCards(text) {
  if (typeof text !== "string" || !text.trim() || text.length > LIMITS.maxFieldChars) return { ok: false, reason: "TEXT_INVALID" };
  const re = /\{\{c(\d{1,2})::([^{}:]{1,200}?)(?:::([^{}]{1,100}))?\}\}/g, hits = [...text.matchAll(re)];
  if (!hits.length) return { ok: false, reason: "NO_CLOZE_MARKERS" };
  const nums = [...new Set(hits.map(m => Number(m[1])))].sort((a, b) => a - b); if (nums.length > LIMITS.maxClozePerText) return { ok: false, reason: "TOO_MANY_CLOZE_NUMBERS" };
  const cards = nums.map(n => {
    const front = text.replace(re, (_, k, ans, hint) => (Number(k) === n ? (hint ? `[... (${hint})]` : "[...]") : ans)), back = text.replace(re, (_, k, ans) => ans);
    const answers = hits.filter(m => Number(m[1]) === n).map(m => m[2]); return { front, back, cloze: n, answers };
  });
  return { ok: true, cards };
}

export function createStudy({ file = null, now = () => Date.now() } = {}) {
  const store = createStore({ file, init: () => ({ tenants: {} }), mode: 0o600 }), d = store.data;
  const T = tenantId => { if (typeof tenantId !== "string" || !okName(TENANT, tenantId)) throw new Error("TENANT_INVALID"); return (d.tenants[tenantId] ??= { cards: {} }); };
  const peek = tenantId => (typeof tenantId === "string" && okName(TENANT, tenantId) ? own(d.tenants, tenantId) ?? null : null);
  const owner = (actor, reason) => (actor === "OWNER" ? null : { ok: false, reason });
  const field = v => typeof v === "string" && v.trim().length > 0 && v.length <= LIMITS.maxFieldChars;
  const tagsOk = t => Array.isArray(t) && t.length <= LIMITS.maxTags && t.every(x => typeof x === "string" && x.length <= LIMITS.maxTagChars && TAG.test(x));
  const view = c => ({ id: c.id, deck: c.deck, front: c.front, back: c.back, tags: [...c.tags], cloze: c.cloze ?? null, ease: c.ease, intervalDays: c.intervalDays, repetitions: c.repetitions, lapses: c.lapses, dueAt: new Date(c.dueMs).toISOString(), createdAt: c.createdAt, suspended: c.suspended, reviews: c.reviews });

  function addCard(tenantId, { deck, front, back, tags = [], cloze = null, actor } = {}) {
    const no = owner(actor, "ONLY_OWNER_MAY_EDIT_CARDS"); if (no) return no;
    if (typeof deck !== "string" || !DECK.test(deck)) return { ok: false, reason: "DECK_INVALID" };
    if (!field(front) || !field(back)) return { ok: false, reason: "CARD_TEXT_INVALID" }; if (!tagsOk(tags)) return { ok: false, reason: "TAGS_INVALID" };
    const t = T(tenantId), cards = Object.values(t.cards); if (cards.length >= LIMITS.maxCards) return { ok: false, reason: "TOO_MANY_CARDS" };
    if (!cards.some(c => c.deck === deck) && new Set(cards.map(c => c.deck)).size >= LIMITS.maxDecks) return { ok: false, reason: "TOO_MANY_DECKS" };
    const f = redactSecrets(front.trim()), b = redactSecrets(back.trim());
    const dup = cards.find(c => c.deck === deck && c.front === f && c.back === b && c.cloze === (cloze ?? null)); if (dup) return { ok: true, id: dup.id, duplicate: true };
    const t0 = now(), c = { id: rid(), deck, front: f, back: b, tags: [...new Set(tags)].sort(), cloze, ease: LIMITS.startEase, intervalDays: 0, repetitions: 0, lapses: 0, dueMs: t0, createdAt: new Date(t0).toISOString(), suspended: false, reviews: [] };
    t.cards[c.id] = c; store.save(); return { ok: true, id: c.id };
  }
  function addCloze(tenantId, { deck, text, tags = [], actor } = {}) {
    const no = owner(actor, "ONLY_OWNER_MAY_EDIT_CARDS"); if (no) return no;
    const g = clozeCards(text); if (!g.ok) return g; const ids = [];
    for (const c of g.cards) { const r = addCard(tenantId, { deck, front: c.front, back: c.back, tags, cloze: c.cloze, actor }); if (!r.ok) return { ...r, created: ids }; ids.push(r.id); }
    return { ok: true, ids };
  }
  function review(tenantId, id, grade, { actor } = {}) {
    const no = owner(actor, "ONLY_OWNER_MAY_REVIEW"); if (no) return no;
    const c = own(peek(tenantId)?.cards, id); if (!c) return { ok: false, reason: "CARD_NOT_FOUND" }; if (c.suspended) return { ok: false, reason: "CARD_SUSPENDED" };
    const n = sm2(c, grade); if (!n) return { ok: false, reason: "GRADE_MUST_BE_INTEGER_0_TO_5" };
    const t0 = now(); Object.assign(c, n, { dueMs: t0 + n.intervalDays * DAY }); c.reviews.push({ at: new Date(t0).toISOString(), grade }); if (c.reviews.length > LIMITS.maxReviewLog) c.reviews.splice(0, c.reviews.length - LIMITS.maxReviewLog);
    store.save(); return { ok: true, id, intervalDays: n.intervalDays, ease: n.ease, dueAt: new Date(c.dueMs).toISOString(), lapse: grade < 3 };
  }
  function due(tenantId, { deck = null, limit = 20 } = {}) {
    const t = peek(tenantId); if (!t) return { ok: true, cards: [], totalDue: 0 }; const t0 = now(), lim = Math.max(1, Math.min(LIMITS.maxDue, Number.isInteger(limit) ? limit : 20));
    const all = Object.values(t.cards).filter(c => !c.suspended && c.dueMs <= t0 && (!deck || c.deck === deck)).sort((a, b) => a.dueMs - b.dueMs || (a.id < b.id ? -1 : 1));
    return { ok: true, cards: all.slice(0, lim).map(c => ({ id: c.id, deck: c.deck, front: c.front, overdueDays: Math.floor((t0 - c.dueMs) / DAY) })), totalDue: all.length };   // back is revealed by get(), not by the due list
  }
  const get = (tenantId, id) => { const c = own(peek(tenantId)?.cards, id); return c ? { ok: true, card: view(c) } : { ok: false, reason: "CARD_NOT_FOUND" }; };
  function setSuspended(tenantId, id, value, { actor } = {}) { const no = owner(actor, "ONLY_OWNER_MAY_EDIT_CARDS"); if (no) return no; const c = own(peek(tenantId)?.cards, id); if (!c) return { ok: false, reason: "CARD_NOT_FOUND" }; c.suspended = Boolean(value); store.save(); return { ok: true, id, suspended: c.suspended }; }
  function remove(tenantId, id, { actor } = {}) { const no = owner(actor, "ONLY_OWNER_MAY_EDIT_CARDS"); if (no) return no; const t = peek(tenantId); if (!t || !own(t.cards, id)) return { ok: false, reason: "CARD_NOT_FOUND" }; delete t.cards[id]; store.save(); return { ok: true }; }
  function stats(tenantId, { deck = null } = {}) {
    const t = peek(tenantId), cards = t ? Object.values(t.cards).filter(c => !deck || c.deck === deck) : [], t0 = now();
    const decks = {}; for (const c of cards) { const x = (decks[c.deck] ??= { cards: 0, due: 0, suspended: 0, new: 0 }); x.cards++; if (c.suspended) x.suspended++; else if (c.dueMs <= t0) x.due++; if (c.repetitions === 0 && c.reviews.length === 0) x.new++; }
    const rev = cards.flatMap(c => c.reviews), good = rev.filter(r => r.grade >= 3).length;
    return { ok: true, cards: cards.length, due: cards.filter(c => !c.suspended && c.dueMs <= t0).length, reviewsLogged: rev.length, retention: rev.length ? Math.round(good / rev.length * 1000) / 1000 : null, decks, note: "Retention counts only the last " + LIMITS.maxReviewLog + " reviews per card." };
  }
  const exportAll = tenantId => { const t = peek(tenantId); return { ok: true, cards: t ? Object.values(t.cards).map(view) : [] }; };
  function forgetAll(tenantId, { actor } = {}) { const no = owner(actor, "ONLY_OWNER_MAY_FORGET"); if (no) return no; if (typeof tenantId !== "string" || !okName(TENANT, tenantId)) return { ok: false, reason: "TENANT_INVALID" }; const had = Boolean(d.tenants[tenantId]); delete d.tenants[tenantId]; store.save(); return { ok: true, deleted: had }; }
  return { addCard, addCloze, review, due, get, setSuspended, remove, stats, exportAll, forgetAll, limits: LIMITS };
}
