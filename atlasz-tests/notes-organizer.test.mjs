import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createNotesOrganizer, normTags, LIMITS } from "../atlasz-addons/notes-organizer.mjs";
import { tmp, rm } from "./helpers.mjs";

test("tags: normalised (case, #, spaces), deduplicated, sorted; bad tags refused", () => {
  assert.deepEqual(normTags(["#Foo Bar", "foo-bar", "ÁRVÍZ", "  X  "]), { ok: true, tags: ["foo-bar", "x", "árvíz"] });
  for (const bad of [["a/b"], ["<x>"], [""], ["a".repeat(33)], [5], [null], "x", null]) assert.equal(normTags(bad).ok, false, JSON.stringify(bad));
  assert.equal(normTags(Array.from({ length: 13 }, (_, i) => "t" + i)).reason, "TOO_MANY_TAGS"); assert.equal(normTags(Array.from({ length: 12 }, (_, i) => "t" + i)).ok, true);
});
test("organizer: notes with tags, search by ALL tags + text + kind, tag cloud, durable across a restart, tenant-scoped", () => {
  const d = tmp("no-"), f = path.join(d, "n.json");
  try {
    const o = createNotesOrganizer({ file: f }), T = { tenantId: "T" };
    const n1 = o.addNote({ ...T, title: "Warehouse rent", text: "4200 per month", tags: ["Finance", "warehouse"] }).id, n2 = o.addNote({ ...T, title: "Hiring", text: "two packers", tags: ["warehouse"] }).id;
    o.addIdea({ ...T, title: "Cold storage", tags: ["warehouse", "idea"], links: [n1] });
    const r = createNotesOrganizer({ file: f });
    assert.equal(r.search({ ...T, tags: ["warehouse"] }).total, 3); assert.equal(r.search({ ...T, tags: ["warehouse", "finance"] }).total, 1);
    assert.deepEqual(r.search({ ...T, q: "PACKERS" }).items.map(x => x.id), [n2]); assert.equal(r.search({ ...T, kind: "idea" }).total, 1); assert.equal(r.search({ ...T, kind: "note", q: "cold" }).total, 0);
    assert.deepEqual(r.tagCloud(T), [{ tag: "warehouse", count: 3 }, { tag: "finance", count: 1 }, { tag: "idea", count: 1 }]);
    assert.equal(r.search({ tenantId: "OTHER" }).total, 0); assert.equal(r.get(n1, { tenantId: "OTHER" }).reason, "NOT_FOUND"); assert.equal(r.tag(n1, { tenantId: "OTHER", add: ["x"] }).reason, "NOT_FOUND"); assert.equal(r.remove(n1, { tenantId: "OTHER" }).reason, "NOT_FOUND");
    assert.deepEqual(r.tag(n1, { ...T, add: ["Q1"], remove: ["finance"] }).tags, ["q1", "warehouse"]); assert.equal(r.search({ ...T, tags: ["finance"] }).total, 0);
    assert.equal(r.search({ ...T, tags: ["bad/tag"] }).ok, false); assert.equal(r.search({ q: "x" }).reason, "TENANT_REQUIRED");
    assert.ok(!("tenantId" in r.get(n1, T).item), "tenant id is never returned");
  } finally { rm(d); }
});
test("reading list: status and progress rules (pages bounded, auto READING/DONE, timestamps), takeaways, progress percent", () => {
  let t = 0; const o = createNotesOrganizer({ now: () => "2026-10-0" + (++t) }), T = { tenantId: "T" };
  const b = o.addBook({ ...T, title: "Deep Work", author: "C. Newport", totalPages: 300, tags: ["focus"] }).id;
  assert.equal(o.addBook({ ...T, title: "x", totalPages: 0 }).reason, "PAGES_INVALID"); assert.equal(o.addBook({ ...T, title: "x", totalPages: 1.5 }).reason, "PAGES_INVALID");
  assert.equal(o.setReading(b, { ...T, pagesRead: 301 }).reason, "PAGES_INVALID"); assert.equal(o.setReading(b, { ...T, pagesRead: -1 }).reason, "PAGES_INVALID"); assert.equal(o.setReading(b, { ...T, status: "WAT" }).reason, "STATUS_INVALID");
  let it = o.setReading(b, { ...T, pagesRead: 75 }).item; assert.deepEqual([it.status, it.pagesRead, it.startedAt !== null, it.finishedAt], ["READING", 75, true, null]);
  assert.deepEqual(o.readingList(T).progress, [{ id: b, title: "Deep Work", percent: 25 }]);
  it = o.setReading(b, { ...T, pagesRead: 300 }).item; assert.deepEqual([it.status, it.finishedAt !== null], ["DONE", true]);
  const b2 = o.addBook({ ...T, title: "Short", totalPages: 10 }).id; it = o.setReading(b2, { ...T, status: "DONE" }).item; assert.equal(it.pagesRead, 10);
  const b3 = o.addBook({ ...T, title: "Unknown length" }).id; assert.equal(o.setReading(b3, { ...T, pagesRead: 99999 }).ok, true);
  assert.equal(o.addTakeaway(b, { ...T, text: "Depth beats breadth" }).count, 1); assert.equal(o.addTakeaway(b, { ...T, text: " " }).reason, "TEXT_INVALID"); assert.equal(o.addTakeaway(b, { ...T, text: "x".repeat(1001) }).reason, "TEXT_INVALID");
  const L = o.readingList(T); assert.deepEqual([L.done.length, L.reading.length, L.toRead.length], [2, 1, 0]);
  assert.equal(o.setReading("nope", T).reason, "NOT_FOUND"); const note = o.addNote({ ...T, title: "n" }).id; assert.equal(o.setReading(note, { ...T, status: "DONE" }).reason, "NOT_FOUND", "only books have a reading state");
});
test("ideas: status lifecycle, links only to the caller's own items, deleting an item removes dangling links", () => {
  const o = createNotesOrganizer(), A = { tenantId: "A" }, B = { tenantId: "B" };
  const n = o.addNote({ ...A, title: "n" }).id, foreign = o.addNote({ ...B, title: "theirs" }).id;
  assert.equal(o.addIdea({ ...A, title: "i", links: [foreign] }).reason, "LINK_INVALID"); assert.equal(o.addIdea({ ...A, title: "i", links: ["nope"] }).reason, "LINK_INVALID");
  assert.equal(o.addIdea({ ...A, title: "i", links: Array(21).fill(n) }).reason, "LINK_INVALID");
  const i = o.addIdea({ ...A, title: "i", links: [n, n] }).id; assert.deepEqual(o.get(i, A).item.links, [n]);
  assert.equal(o.setIdeaStatus(i, { ...A, status: "EXPLORING" }).ok, true); assert.equal(o.setIdeaStatus(i, { ...A, status: "BOGUS" }).reason, "STATUS_INVALID"); assert.equal(o.setIdeaStatus(i, { ...B, status: "DONE" }).reason, "NOT_FOUND");
  assert.equal(o.search({ ...A, status: "EXPLORING" }).total, 1); assert.equal(o.search({ ...A, status: "NEW" }).total, 0);
  assert.equal(o.remove(n, A).ok, true); assert.deepEqual(o.get(i, A).item.links, []); assert.equal(o.get(n, A).ok, false);
});
test("organizer: validation, secret redaction on disk, markdown export, limits", () => {
  const d = tmp("no2-"), f = path.join(d, "n.json");
  try {
    const o = createNotesOrganizer({ file: f }), T = { tenantId: "T" };
    assert.equal(o.addNote({ title: "x" }).reason, "TENANT_REQUIRED"); assert.equal(o.addNote({ ...T, title: "  " }).reason, "TITLE_REQUIRED"); assert.equal(o.addNote({ ...T, title: "t", text: "x".repeat(LIMITS.maxText + 1) }).reason, "TEXT_INVALID"); assert.equal(o.addNote({ ...T, title: "t", text: 5 }).reason, "TEXT_INVALID");
    assert.equal(o.addNote({ ...T, title: "t", tags: ["a/b"] }).reason, "TAG_INVALID"); assert.equal(o.addNote({ ...T, title: "t".repeat(400) }).item.title.length, LIMITS.maxTitle);
    o.addNote({ ...T, title: "creds", text: "my key " + "s" + "k-ABCDEFGHIJKLMNOPQRSTUVWX", tags: ["x"] }); o.addBook({ ...T, title: "Book", author: "A", tags: ["b"] });
    const disk = fs.readFileSync(f, "utf8"); assert.ok(!disk.includes("k-ABCDEFGH") && disk.includes("[redacted]"));
    const md = o.exportMarkdown(T); assert.match(md, /## Notes/); assert.match(md, /- \*\*Book\*\* — A \[TO_READ\] #b/); assert.ok(!md.includes("k-ABCDEFGH")); assert.equal(o.exportMarkdown({ tenantId: "OTHER" }).includes("Book"), false);
    assert.equal(o.search({ ...T, limit: 1 }).items.length, 1); assert.equal(o.search({ ...T, limit: 9999 }).ok, true);
    const m = createNotesOrganizer(); for (let i = 0; i < LIMITS.maxItems; i++) if (!m.addNote({ tenantId: "T", title: "n" }).ok) assert.fail("limit hit early " + i);
    assert.equal(m.addNote({ tenantId: "T", title: "n" }).reason, "TOO_MANY_ITEMS");
  } finally { rm(d); }
});
test("organizer: exact boundaries - takeaways 100, links 20, tags 12 via tag(), text length, percent rounds DOWN, search limit clamps at 200, equal-count tags sort alphabetically", () => {
  const o = createNotesOrganizer(), T = { tenantId: "T" };
  const b = o.addBook({ ...T, title: "B", totalPages: 200 }).id; for (let i = 0; i < 100; i++) assert.equal(o.addTakeaway(b, { ...T, text: "t" + i }).ok, true);
  assert.equal(o.addTakeaway(b, { ...T, text: "one more" }).reason, "TOO_MANY_TAKEAWAYS");
  const n = o.addNote({ ...T, title: "n" }).id, ids = Array.from({ length: 20 }, () => o.addNote({ ...T, title: "l" }).id);
  assert.equal(o.addIdea({ ...T, title: "i", links: ids }).ok, true); assert.equal(o.addIdea({ ...T, title: "i", links: [...ids, n] }).reason, "LINK_INVALID");
  assert.equal(o.tag(n, { ...T, add: Array.from({ length: 12 }, (_, i) => "t" + i) }).ok, true); assert.equal(o.tag(n, { ...T, add: ["extra"] }).reason, "TOO_MANY_TAGS");
  assert.equal(o.tag(n, { ...T, add: ["extra"], remove: ["t0"] }).ok, true, "removal is applied before the limit check");
  assert.equal(o.addNote({ ...T, title: "edge", text: "x".repeat(LIMITS.maxText) }).ok, true);
  o.setReading(b, { ...T, pagesRead: 133 }); assert.equal(o.readingList(T).progress[0].percent, 66);
  const big = createNotesOrganizer(); for (let i = 0; i < 250; i++) big.addNote({ tenantId: "T", title: "n" + i });
  assert.equal(big.search({ tenantId: "T", limit: 9999 }).items.length, 200); assert.equal(big.search({ tenantId: "T", limit: 0 }).items.length, 1); assert.equal(big.search({ tenantId: "T" }).items.length, 50);
  const c = createNotesOrganizer(); c.addNote({ tenantId: "T", title: "a", tags: ["zeta"] }); c.addNote({ tenantId: "T", title: "b", tags: ["alpha"] }); c.addNote({ tenantId: "T", title: "c", tags: ["mid"] });
  assert.deepEqual(c.tagCloud({ tenantId: "T" }).map(x => x.tag), ["alpha", "mid", "zeta"]);
});

test("verification fixes: the item cap is per tenant; newlines in a title cannot forge export structure", () => {
  const o = createNotesOrganizer({}); for (let i = 0; i < LIMITS.maxItems; i++) o.addNote({ tenantId: "A", title: "n" + i, text: "x" });
  assert.equal(o.addNote({ tenantId: "A", title: "one more", text: "x" }).reason, "TOO_MANY_ITEMS"); assert.equal(o.addNote({ tenantId: "B", title: "mine", text: "x" }).ok, true, "another tenant is not affected");
  const n = o.addNote({ tenantId: "B", title: "Hi\n\n## Ideas\n- **forged idea** [DONE]", text: "x" }); assert.ok(!n.item.title.includes("\n"));
});

test("round-3 fixes: book author whitespace is collapsed", () => {
  const o = createNotesOrganizer(); const id = o.addBook({ tenantId: "T", title: "Deep Work", author: "  C.\n\t Newport   " }).id;
  assert.equal(o.get(id, { tenantId: "T" }).item.author, "C. Newport");
});
