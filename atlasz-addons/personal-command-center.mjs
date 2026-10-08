// Personal Command Center (V7.3 Personal ATLASZ; feeds the Daily Brief; 85-cap A08/A11/P20 inputs).
// Tasks, reminders and deadlines in one durable, tenant-scoped list. It stores what the owner (or an authorised tool) put there and NOTHING else:
// the agenda is computed from those records and the current clock, never invented. There is no notification provider, so a due reminder is
// SURFACED (brief / Control Center) and stays "due" until acknowledged; it is never reported as delivered to a phone or inbox.
import { createStore } from "./business/store.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { ownProp } from "./safe-keys.mjs";

export const TYPES = Object.freeze(["TASK", "REMINDER", "DEADLINE"]);
export const PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const CLASSES = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL", "SECRET"]);
const PRI = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const SOURCES = Object.freeze(["OWNER", "AGENT", "SCHEDULER", "SYSTEM"]);
const t = s => Date.parse(s);

export function createPersonalCommandCenter({ file = null, tenantId = "ATLASZ", now = () => new Date().toISOString(), blackBox = null, utcOffsetMinutes = 0 } = {}) {
  const store = createStore({ file, init: () => ({ items: {}, seq: 0 }) }), S = store.data;   // unreadable file => STORE_UNREADABLE, never replaced
  // The runtime (scheduler/tools) and the Control Center may both hold this file: re-read it before every operation so one process never overwrites the
  // other's items from a stale copy. A synchronous read-modify-write per operation leaves only a tiny cross-process window (disclosed, not claimed solved).
  const reload = () => { if (!file || !fs.existsSync(file)) return; let d; try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("STORE_UNREADABLE:" + file.split(/[\\/]/).pop()); } S.items = d.items ?? {}; S.seq = d.seq ?? 0; };
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit must not change behaviour */ } };
  const mine = () => Object.values(S.items).filter(i => i.tenantId === tenantId);
  const own = id => { const i = ownProp(S.items, id); return i && i.tenantId === tenantId ? i : null; };
  const iso = (v, field) => { if (!Number.isFinite(t(v))) throw new Error(field.toUpperCase() + "_INVALID"); return new Date(t(v)).toISOString(); };

  function add({ type, title, dueAt = null, remindAt = null, priority = "NORMAL", project = null, notes = "", classification = "PERSONAL", source = "OWNER" } = {}) {
    reload();
    if (!TYPES.includes(type)) throw new Error("TYPE_INVALID");
    const ti = String(title ?? "").trim(); if (!ti) throw new Error("TITLE_REQUIRED"); if (ti.length > 200) throw new Error("TITLE_TOO_LONG");
    if (!PRIORITIES.includes(priority)) throw new Error("PRIORITY_INVALID");
    if (!CLASSES.includes(classification)) throw new Error("CLASSIFICATION_INVALID");
    if (!SOURCES.includes(source)) throw new Error("SOURCE_INVALID");
    if (type === "DEADLINE" && dueAt == null) throw new Error("DEADLINE_REQUIRES_DUE_AT");
    if (type === "REMINDER" && remindAt == null) throw new Error("REMINDER_REQUIRES_REMIND_AT");
    const id = "pcc-" + (++S.seq) + "-" + crypto.randomBytes(3).toString("hex");
    S.items[id] = { id, tenantId, type, title: ti, dueAt: dueAt == null ? null : iso(dueAt, "dueAt"), remindAt: remindAt == null ? null : iso(remindAt, "remindAt"), priority, project: project ? String(project).slice(0, 80) : null,
      notes: String(notes).slice(0, 2000), classification, status: "OPEN", source, createdAt: now(), completedAt: null, ackedAt: null, history: [{ at: now(), event: "CREATED", by: source }] };
    store.save(); log("PCC_ADDED", { id, type, source }); return structuredClone(S.items[id]);
  }
  function setStatus(id, status, by) {
    reload();
    const i = own(id); if (!i) return null; if (i.status !== "OPEN") return { error: "INVALID_STATE:" + i.status };
    i.status = status; i.completedAt = now(); i.history.push({ at: now(), event: status, by }); store.save(); log("PCC_" + status, { id }); return structuredClone(i);
  }
  const complete = (id, by = "OWNER") => setStatus(id, "DONE", by);
  const cancel = (id, by = "OWNER") => setStatus(id, "CANCELLED", by);
  function reschedule(id, { dueAt, remindAt } = {}, by = "OWNER") {
    reload();
    const i = own(id); if (!i) return null; if (i.status !== "OPEN") return { error: "INVALID_STATE:" + i.status };
    if (dueAt !== undefined) { if (dueAt === null && i.type === "DEADLINE") throw new Error("DEADLINE_REQUIRES_DUE_AT"); i.dueAt = dueAt === null ? null : iso(dueAt, "dueAt"); }
    if (remindAt !== undefined) { if (remindAt === null && i.type === "REMINDER") throw new Error("REMINDER_REQUIRES_REMIND_AT"); i.remindAt = remindAt === null ? null : iso(remindAt, "remindAt"); i.ackedAt = null; }
    i.history.push({ at: now(), event: "RESCHEDULED", by }); store.save(); return structuredClone(i);
  }
  /** Acknowledge a due reminder: it stops being surfaced. This records the owner's acknowledgement, not that anything was delivered anywhere. */
  function ack(id) { reload(); const i = own(id); if (!i) return null; if (i.status !== "OPEN" || !i.remindAt) return { error: "NOT_AN_OPEN_REMINDER" }; i.ackedAt = now(); i.history.push({ at: now(), event: "ACKED", by: "OWNER" }); store.save(); return structuredClone(i); }

  const get = id => (reload(), own(id)) ? structuredClone(own(id)) : null;
  const list = ({ status = null, type = null, project = null } = {}) => (reload(), mine()).filter(i => (!status || i.status === status) && (!type || i.type === type) && (!project || i.project === project)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(i => structuredClone(i));

  /** Agenda computed from stored records and the clock. "Today" = the owner's local day via utcOffsetMinutes (set from preferences; default UTC). */
  function agenda({ at = now(), horizonHours = 48 } = {}) {
    reload();
    const nowMs = t(at), off = utcOffsetMinutes * 60000, dayStart = Math.floor((nowMs + off) / 86400000) * 86400000 - off, dayEnd = dayStart + 86400000, horizon = nowMs + horizonHours * 3600000;
    const open = mine().filter(i => i.status === "OPEN"), order = (a, b) => (PRI[a.priority] - PRI[b.priority]) || (t(a.dueAt ?? a.remindAt ?? "9999-01-01") - t(b.dueAt ?? b.remindAt ?? "9999-01-01"));
    const slim = i => ({ id: i.id, type: i.type, title: i.title, dueAt: i.dueAt, remindAt: i.remindAt, priority: i.priority, project: i.project, classification: i.classification, source: i.source });
    const dated = open.filter(i => i.dueAt);
    return {
      at, tenantId, utcOffsetMinutes,
      overdue: dated.filter(i => t(i.dueAt) < nowMs).sort(order).map(slim),
      dueToday: dated.filter(i => t(i.dueAt) >= nowMs && t(i.dueAt) < dayEnd).sort(order).map(slim),
      upcoming: dated.filter(i => t(i.dueAt) >= dayEnd && t(i.dueAt) <= horizon).sort(order).map(slim),
      remindersDue: open.filter(i => i.remindAt && !i.ackedAt && t(i.remindAt) <= nowMs).sort(order).map(slim),
      undated: open.filter(i => !i.dueAt && i.type === "TASK").length,
      openTotal: open.length,
      note: "Computed from stored items only. Reminders are surfaced here and in the brief; no notification provider is connected, so none is pushed anywhere."
    };
  }
  const summary = (opts) => { const a = agenda(opts); return { overdue: a.overdue.length, dueToday: a.dueToday.length, upcoming: a.upcoming.length, remindersDue: a.remindersDue.length, undated: a.undated, openTotal: a.openTotal }; };
  return { add, complete, cancel, reschedule, ack, get, list, agenda, summary };
}

/** Register the PCC as typed tools (so the scheduler and models can use it). All are internal, reversible, owner-visible operations. */
export function registerPccTools(registry, pcc) {
  const item = { type: "object", additionalProperties: true, properties: {} }, none = { type: "object", properties: {} };
  registry.register({ name: "pcc.agenda", description: "Today's agenda: overdue, due today, upcoming, reminders due.", operation: "READ_STATUS", input: { type: "object", properties: { horizonHours: { type: "integer", minimum: 1, maximum: 720 } } }, output: item, handler: a => pcc.agenda(a) });
  registry.register({ name: "pcc.add", description: "Create a task, reminder or deadline.", operation: "INTERNAL_COMPUTE", input: { type: "object", required: ["type", "title"], properties: { type: { enum: [...TYPES] }, title: { type: "string", minLength: 1, maxLength: 200 }, dueAt: { type: "string", maxLength: 40 }, remindAt: { type: "string", maxLength: 40 }, priority: { enum: [...PRIORITIES] }, project: { type: "string", maxLength: 80 }, notes: { type: "string", maxLength: 2000 } } }, output: item, handler: a => pcc.add({ ...a, source: "AGENT" }) });
  registry.register({ name: "pcc.complete", description: "Mark an open item done.", operation: "INTERNAL_COMPUTE", input: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 80 } } }, output: item, handler: a => pcc.complete(a.id, "AGENT") ?? { error: "NOT_FOUND" } });
  registry.register({ name: "pcc.summary", description: "Counts only.", operation: "READ_STATUS", input: none, output: item, handler: () => pcc.summary() });
}
