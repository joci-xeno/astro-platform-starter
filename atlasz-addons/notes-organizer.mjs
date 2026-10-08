// Personal knowledge organizer (85-capability programme: P03): notes with tags, a reading list and an ideas inbox, searchable and durable.
// Notes in Knowledge Projects stay the citable source store; this adds the organising model they lacked (tags, books/articles with progress, ideas that link to notes).
// Tenant-scoped (another tenant's item looks missing); secrets are redacted before storage; all text is data. No network, no model, no spend.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";
import { ownProp } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({ maxItems: 5000, maxText: 20000, maxTitle: 160, maxTags: 12, maxTag: 32, maxLinks: 20 });
export const READING_STATUS = Object.freeze(["TO_READ", "READING", "DONE", "ABANDONED"]);
export const IDEA_STATUS = Object.freeze(["NEW", "EXPLORING", "PARKED", "DONE", "DROPPED"]);
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b|(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{30,}/g;
const redact = s => { SECRET.lastIndex = 0; return String(s ?? "").replace(SECRET, "[redacted]"); };
const rid = p => p + crypto.randomBytes(6).toString("hex");
/** Tags are lower-case, 1-32 chars of letters/digits/-/_ ; '#Foo Bar' -> 'foo-bar'. Duplicates are merged. */
export function normTags(tags) {
  if (!Array.isArray(tags)) return { ok: false, reason: "TAGS_MUST_BE_ARRAY" };
  const out = new Set();
  for (const t of tags) {
    if (typeof t !== "string") return { ok: false, reason: "TAG_INVALID" };
    const n = t.trim().replace(/^#+/, "").toLowerCase().replace(/[\s]+/g, "-");
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(n)) return { ok: false, reason: "TAG_INVALID" };
    out.add(n);
  }
  if (out.size > LIMITS.maxTags) return { ok: false, reason: "TOO_MANY_TAGS" };
  return { ok: true, tags: [...out].sort() };
}

export function createNotesOrganizer({ file = null, now = () => new Date().toISOString() } = {}) {
  const store = createStore({ file, init: () => ({ items: {} }), mode: 0o600 }), d = store.data;
  const own = (id, tenantId, kind = null) => { const x = ownProp(d.items, id); return x && x.tenantId === tenantId && (!kind || x.kind === kind) ? x : null; };
  const count = () => Object.keys(d.items).length;
  const tenantItems = (tenantId, kind) => Object.values(d.items).filter(x => x.tenantId === tenantId && (!kind || x.kind === kind));
  const pub = ({ tenantId: _t, ...x }) => clone(x);
  function base(kind, tenantId, tags, title) {
    if (!tenantId || typeof tenantId !== "string") return { ok: false, reason: "TENANT_REQUIRED" };
    if (typeof title !== "string" || !title.trim()) return { ok: false, reason: "TITLE_REQUIRED" };
    if (count() >= LIMITS.maxItems) return { ok: false, reason: "TOO_MANY_ITEMS" };
    const t = normTags(tags ?? []); if (!t.ok) return t;
    return { ok: true, item: { id: rid(kind[0] + "_"), kind, tenantId, title: redact(title).trim().slice(0, LIMITS.maxTitle), tags: t.tags, createdAt: now(), updatedAt: now() } };
  }
  function addNote({ tenantId, title, text = "", tags = [] } = {}) {
    const b = base("note", tenantId, tags, title); if (!b.ok) return b;
    if (typeof text !== "string" || text.length > LIMITS.maxText) return { ok: false, reason: "TEXT_INVALID" };
    const x = { ...b.item, text: redact(text) }; d.items[x.id] = x; store.save(); return { ok: true, id: x.id, item: pub(x) };
  }
  function addBook({ tenantId, title, author = "", tags = [], totalPages = null } = {}) {
    const b = base("book", tenantId, tags, title); if (!b.ok) return b;
    if (totalPages !== null && !(Number.isInteger(totalPages) && totalPages > 0 && totalPages <= 100000)) return { ok: false, reason: "PAGES_INVALID" };
    const x = { ...b.item, author: redact(author).slice(0, LIMITS.maxTitle), status: "TO_READ", totalPages, pagesRead: 0, startedAt: null, finishedAt: null, takeaways: [] }; d.items[x.id] = x; store.save(); return { ok: true, id: x.id, item: pub(x) };
  }
  function setReading(id, { tenantId, status, pagesRead } = {}) {
    const x = own(id, tenantId, "book"); if (!x) return { ok: false, reason: "NOT_FOUND" };
    if (status !== undefined && !READING_STATUS.includes(status)) return { ok: false, reason: "STATUS_INVALID" };
    if (pagesRead !== undefined && !(Number.isInteger(pagesRead) && pagesRead >= 0 && (x.totalPages === null || pagesRead <= x.totalPages))) return { ok: false, reason: "PAGES_INVALID" };
    if (status !== undefined) { x.status = status; if (status === "READING" && !x.startedAt) x.startedAt = now(); if (status === "DONE") { x.finishedAt = now(); if (x.totalPages) x.pagesRead = x.totalPages; } }
    if (pagesRead !== undefined) { x.pagesRead = pagesRead; if (x.status === "TO_READ" && pagesRead > 0) { x.status = "READING"; x.startedAt = x.startedAt ?? now(); } if (x.totalPages && pagesRead === x.totalPages) { x.status = "DONE"; x.finishedAt = now(); } }
    x.updatedAt = now(); store.save(); return { ok: true, item: pub(x) };
  }
  function addTakeaway(id, { tenantId, text } = {}) {
    const x = own(id, tenantId, "book"); if (!x) return { ok: false, reason: "NOT_FOUND" };
    if (typeof text !== "string" || !text.trim() || text.length > 1000) return { ok: false, reason: "TEXT_INVALID" };
    if (x.takeaways.length >= 100) return { ok: false, reason: "TOO_MANY_TAKEAWAYS" };
    x.takeaways.push({ at: now(), text: redact(text) }); x.updatedAt = now(); store.save(); return { ok: true, count: x.takeaways.length };
  }
  function addIdea({ tenantId, title, text = "", tags = [], links = [] } = {}) {
    const b = base("idea", tenantId, tags, title); if (!b.ok) return b;
    if (typeof text !== "string" || text.length > LIMITS.maxText) return { ok: false, reason: "TEXT_INVALID" };
    if (!Array.isArray(links) || links.length > LIMITS.maxLinks || links.some(l => typeof l !== "string" || !own(l, tenantId))) return { ok: false, reason: "LINK_INVALID" };   // links may only point at the caller's own items
    const x = { ...b.item, text: redact(text), status: "NEW", links: [...new Set(links)] }; d.items[x.id] = x; store.save(); return { ok: true, id: x.id, item: pub(x) };
  }
  function setIdeaStatus(id, { tenantId, status } = {}) {
    const x = own(id, tenantId, "idea"); if (!x) return { ok: false, reason: "NOT_FOUND" };
    if (!IDEA_STATUS.includes(status)) return { ok: false, reason: "STATUS_INVALID" };
    x.status = status; x.updatedAt = now(); store.save(); return { ok: true, status };
  }
  function tag(id, { tenantId, add = [], remove = [] } = {}) {
    const x = own(id, tenantId); if (!x) return { ok: false, reason: "NOT_FOUND" };
    const a = normTags(add), r = normTags(remove); if (!a.ok) return a; if (!r.ok) return r;
    const next = new Set([...x.tags, ...a.tags]); for (const t of r.tags) next.delete(t);
    if (next.size > LIMITS.maxTags) return { ok: false, reason: "TOO_MANY_TAGS" };
    x.tags = [...next].sort(); x.updatedAt = now(); store.save(); return { ok: true, tags: [...x.tags] };
  }
  function remove(id, { tenantId } = {}) {
    const x = own(id, tenantId); if (!x) return { ok: false, reason: "NOT_FOUND" };
    delete d.items[id]; for (const o of Object.values(d.items)) if (o.tenantId === tenantId && o.links) o.links = o.links.filter(l => l !== id);   // no dangling links
    store.save(); return { ok: true };
  }
  function get(id, { tenantId } = {}) { const x = own(id, tenantId); return x ? { ok: true, item: pub(x) } : { ok: false, reason: "NOT_FOUND" }; }
  /** Filter by kind, ALL of the given tags, status and a case-insensitive text match on title/text/author; newest first. */
  function search({ tenantId, kind = null, tags = [], status = null, q = "", limit = 50 } = {}) {
    if (!tenantId) return { ok: false, reason: "TENANT_REQUIRED" };
    const t = normTags(tags); if (!t.ok) return t;
    const qq = String(q).toLowerCase().trim(), lim = Math.min(200, Math.max(1, Number.isInteger(limit) ? limit : 50));
    const items = tenantItems(tenantId, kind).filter(x => t.tags.every(g => x.tags.includes(g)) && (!status || x.status === status) && (!qq || [x.title, x.text, x.author].some(s => String(s ?? "").toLowerCase().includes(qq))))
      .sort((a, b) => (b.updatedAt === a.updatedAt ? (b.id < a.id ? -1 : 1) : b.updatedAt < a.updatedAt ? -1 : 1));
    return { ok: true, total: items.length, items: items.slice(0, lim).map(pub) };
  }
  function tagCloud({ tenantId } = {}) {
    const m = new Map(); for (const x of tenantItems(tenantId)) for (const g of x.tags) m.set(g, (m.get(g) ?? 0) + 1);
    return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  }
  function readingList({ tenantId } = {}) {
    const books = tenantItems(tenantId, "book"), by = s => books.filter(b => b.status === s).map(pub);
    return { reading: by("READING"), toRead: by("TO_READ"), done: by("DONE"), abandoned: by("ABANDONED"),
      progress: books.filter(b => b.status === "READING" && b.totalPages).map(b => ({ id: b.id, title: b.title, percent: Math.floor(100 * b.pagesRead / b.totalPages) })) };
  }
  /** Markdown export for the owner (escapes nothing executable: output is plain text). */
  function exportMarkdown({ tenantId } = {}) {
    const lines = ["# Notes, reading list and ideas", ""];
    for (const [title, kind] of [["Notes", "note"], ["Reading list", "book"], ["Ideas", "idea"]]) {
      lines.push("## " + title, ""); for (const x of tenantItems(tenantId, kind)) lines.push(`- **${x.title}**${x.author ? " — " + x.author : ""}${x.status ? " [" + x.status + "]" : ""}${x.tags.length ? " " + x.tags.map(g => "#" + g).join(" ") : ""}`);
      lines.push("");
    }
    return lines.join("\n");
  }
  return { addNote, addBook, setReading, addTakeaway, addIdea, setIdeaStatus, tag, remove, get, search, tagCloud, readingList, exportMarkdown };
}
