// ATLASZ durable dead-letter store: a failed task is never lost when a process restarts, crashes or the computer reboots.
// Storage: ONE hash-chained, fsynced, head-pinned audit chain (atlasz-addons/audit-chain.mjs). State is the replay of its events, so the audit history IS the data.
// Guarantees:
//  - original task identity is preserved (taskId); the same task dead-lettered twice is ONE record with an occurrence counter (no duplicate record, no duplicate retry);
//  - failure reason + timestamps are kept; secrets in item/error are redacted before they are written;
//  - retry is authorised by a signed, single-use, subject-bound owner approval; at most ONE retry is in flight per record; a retry interrupted by a crash comes back as OPEN (needs a NEW authorisation, never re-run automatically);
//  - a damaged or truncated chain is never trusted or silently reset: the store goes CORRUPT, new failures still land in an append-only overflow file (nothing lost), and only a signed owner approval archives the damaged chain and rebuilds from the overflow;
//  - the store never executes anything itself: retry hands the item to a caller-supplied runner.
import fs from "node:fs"; import path from "node:path"; import { randomUUID } from "node:crypto";
import { createAuditChain } from "./audit-chain.mjs";
import { scrub } from "./secret-patterns.mjs";

export const RETRY_ACTION = "DEAD_LETTER_RETRY", RECOVER_ACTION = "DEAD_LETTER_RECOVER_STORE";
export const retrySubject = id => "dead-letter-retry:" + id;
export const recoverSubject = "dead-letter-store:recover";
export const STATES = Object.freeze(["OPEN", "RETRY_AUTHORIZED", "RETRYING", "RESOLVED"]);
const MAX_ITEM_BYTES = 64 * 1024;

function redactDeep(v, depth = 0) {
  if (depth > 8) return "[depth-limit]";
  if (typeof v === "string") return scrub(v).slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 100).map(x => redactDeep(x, depth + 1));
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v).slice(0, 100)) o[scrub(k).slice(0, 100)] = redactDeep(x, depth + 1); return o; }
  return typeof v === "function" || typeof v === "symbol" || typeof v === "bigint" ? String(v) : v;
}

export function createDurableDeadLetters({ dir, ownerAuth = null, alert = () => {}, now = () => new Date().toISOString() } = {}) {
  if (!dir) throw new Error("DEAD_LETTER_DIR_REQUIRED");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const chainFile = path.join(dir, "dead-letters.jsonl"), pinFile = path.join(dir, "dead-letters.headpin.json"), overflowFile = path.join(dir, "dead-letters-overflow.jsonl");
  let chain = null, corrupt = null, R = new Map();
  const tell = a => { try { alert(a); } catch { /* alerting is best effort; the state itself is durable */ } };

  function apply(e) {
    const d = e.data ?? {};
    switch (e.event) {
      case "DL_CREATED": R.set(d.id, { id: d.id, taskId: d.taskId, item: d.item, error: d.error, attempts: d.attempts, traceId: d.traceId, status: "OPEN", createdAt: e.at, updatedAt: e.at, occurrences: 1, lastError: d.error, history: [{ at: e.at, event: "CREATED" }], retryCount: 0 }); break;
      case "DL_SEEN": { const r = R.get(d.id); if (r) { r.occurrences++; r.lastError = d.error; r.attempts = Math.max(r.attempts, d.attempts); r.updatedAt = e.at; r.history.push({ at: e.at, event: "SEEN_AGAIN" }); } break; }
      case "DL_RETRY_AUTHORIZED": { const r = R.get(d.id); if (r) { r.status = "RETRY_AUTHORIZED"; r.updatedAt = e.at; r.history.push({ at: e.at, event: "RETRY_AUTHORIZED" }); } break; }
      case "DL_RETRY_STARTED": { const r = R.get(d.id); if (r) { r.status = "RETRYING"; r.retryToken = d.token; r.retryCount++; r.updatedAt = e.at; r.history.push({ at: e.at, event: "RETRY_STARTED" }); } break; }
      case "DL_RETRY_FAILED": { const r = R.get(d.id); if (r) { r.status = "OPEN"; r.retryToken = null; r.lastError = d.error; r.updatedAt = e.at; r.history.push({ at: e.at, event: "RETRY_FAILED" }); } break; }
      case "DL_RETRY_INTERRUPTED": { const r = R.get(d.id); if (r) { r.status = "OPEN"; r.retryToken = null; r.interruptedRetry = true; r.updatedAt = e.at; r.history.push({ at: e.at, event: "RETRY_INTERRUPTED" }); } break; }
      case "DL_RESOLVED": { const r = R.get(d.id); if (r) { r.status = "RESOLVED"; r.retryToken = null; r.resolution = d.note; r.resolvedAt = e.at; r.updatedAt = e.at; r.history.push({ at: e.at, event: "RESOLVED" }); } break; }
      default: break;      // unknown future events never change state
    }
  }
  function open() {
    try { chain = createAuditChain({ filePath: chainFile, headPinFile: pinFile, now }); corrupt = null; R = new Map(); for (const e of chain.entries()) apply(e); }
    catch (e) { chain = null; corrupt = String(e.message).slice(0, 200); tell({ level: "HIGH", kind: "DEAD_LETTER_STORE_CORRUPT", text: "dead-letter store damaged: " + corrupt + " - new failures go to the overflow file; owner recovery required" }); }
  }
  open();
  // A restart means every in-flight retry belonged to a dead process: back to OPEN, flagged, never auto-run.
  if (chain) for (const r of [...R.values()]) if (r.status === "RETRYING") { const ev = chain.append("DL_RETRY_INTERRUPTED", { id: r.id }); apply(ev); }
  const ev = (event, data) => { const e = chain.append(event, data); apply(e); return e; };
  const view = r => structuredClone(r);

  function deadLetter({ item, error, attempts, traceId, taskId } = {}) {
    const count = Number(attempts); if (!Number.isInteger(count) || count < 0) throw new Error("INVALID_DEAD_LETTER_ATTEMPTS");
    const safeItem = redactDeep(item ?? null); if (Buffer.byteLength(JSON.stringify(safeItem ?? null)) > MAX_ITEM_BYTES) throw new Error("DEAD_LETTER_ITEM_TOO_LARGE");
    const tid = String(taskId ?? item?.taskId ?? item?.id ?? "").slice(0, 120) || null, err = scrub(String(error?.message || error || "UNKNOWN")).slice(0, 1000);
    if (corrupt) { const rec = { at: now(), id: randomUUID(), taskId: tid, item: safeItem, error: err, attempts: count, traceId: traceId ? String(traceId).slice(0, 100) : null }; fs.appendFileSync(overflowFile, JSON.stringify(rec) + "\n", { mode: 0o600 }); return { ...rec, status: "OPEN", storedIn: "OVERFLOW_STORE_CORRUPT" }; }
    if (tid) for (const r of R.values()) if (r.taskId === tid && r.status !== "RESOLVED") { ev("DL_SEEN", { id: r.id, error: err, attempts: count }); return view(R.get(r.id)); }
    const id = randomUUID(); ev("DL_CREATED", { id, taskId: tid, item: safeItem, error: err, attempts: count, traceId: traceId ? String(traceId).slice(0, 100) : null });
    return view(R.get(id));
  }
  const list = (status = "OPEN") => [...R.values()].filter(x => !status || x.status === status).map(view);
  function resolve(id, note, { actor = "owner" } = {}) {
    if (corrupt) throw new Error("DEAD_LETTER_STORE_CORRUPT"); const r = R.get(id); if (!r) throw new Error("DEAD_LETTER_NOT_FOUND");
    if (r.status === "RETRYING") throw new Error("DEAD_LETTER_RETRY_IN_FLIGHT");
    ev("DL_RESOLVED", { id, note: scrub(String(note ?? "")).slice(0, 500), actor: String(actor).slice(0, 40) }); return view(R.get(id));
  }
  /** Owner authorisation for ONE retry. */
  function authorizeRetry(id, { ownerApproval = null } = {}) {
    if (corrupt) return { ok: false, reason: "DEAD_LETTER_STORE_CORRUPT" }; const r = R.get(id); if (!r) return { ok: false, reason: "DEAD_LETTER_NOT_FOUND" };
    if (r.status !== "OPEN") return { ok: false, reason: "NOT_OPEN:" + r.status };
    if (!ownerAuth?.verifyApproval) return { ok: false, reason: "OWNER_AUTH_NOT_CONFIGURED" };
    const v = ownerAuth.verifyApproval(ownerApproval, { action: RETRY_ACTION, subject: retrySubject(id) }); if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason };
    ev("DL_RETRY_AUTHORIZED", { id }); return { ok: true, id };
  }
  /** Runs the retry through a caller-supplied runner. Only an AUTHORIZED record can run, and only once per authorisation (status flips to RETRYING before the runner is called). */
  async function retry(id, runner) {
    if (corrupt) return { ok: false, reason: "DEAD_LETTER_STORE_CORRUPT" }; const r = R.get(id); if (!r) return { ok: false, reason: "DEAD_LETTER_NOT_FOUND" };
    if (r.status !== "RETRY_AUTHORIZED") return { ok: false, reason: "RETRY_NOT_AUTHORIZED:" + r.status };
    if (typeof runner !== "function") return { ok: false, reason: "RUNNER_REQUIRED" };
    const token = randomUUID(); ev("DL_RETRY_STARTED", { id, token });
    let out; try { out = await runner(structuredClone(r.item), { id, taskId: r.taskId, idempotencyKey: "dl:" + id + ":" + token }); } catch (e) { out = { ok: false, error: e?.message ?? "RUNNER_THREW" }; }
    if (out && out.ok === true) { ev("DL_RESOLVED", { id, note: "retry succeeded", actor: "retry" }); return { ok: true, id, status: "RESOLVED" }; }
    ev("DL_RETRY_FAILED", { id, error: scrub(String(out?.error ?? out?.reason ?? "RETRY_FAILED")).slice(0, 500) }); return { ok: false, id, status: "OPEN", reason: "RETRY_FAILED" };
  }
  /** After corruption: archive the damaged files (never delete), start a fresh chain, replay the overflow into it. Needs a signed owner approval. */
  function recoverStore({ ownerApproval = null } = {}) {
    if (!corrupt) return { ok: false, reason: "STORE_NOT_CORRUPT" };
    if (!ownerAuth?.verifyApproval) return { ok: false, reason: "OWNER_AUTH_NOT_CONFIGURED" };
    const v = ownerAuth.verifyApproval(ownerApproval, { action: RECOVER_ACTION, subject: recoverSubject }); if (!v.allowed) return { ok: false, reason: "OWNER_APPROVAL_REQUIRED:" + v.reason };
    const stamp = now().replace(/[:.]/g, "-"), archive = path.join(dir, "corrupt-" + stamp); fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
    for (const f of [chainFile, pinFile]) if (fs.existsSync(f)) fs.renameSync(f, path.join(archive, path.basename(f)));
    const overflow = fs.existsSync(overflowFile) ? fs.readFileSync(overflowFile, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
    if (fs.existsSync(overflowFile)) fs.renameSync(overflowFile, path.join(archive, "dead-letters-overflow.jsonl"));
    open(); if (corrupt) return { ok: false, reason: "STILL_CORRUPT:" + corrupt };
    for (const o of overflow) ev("DL_CREATED", { id: o.id, taskId: o.taskId, item: o.item, error: o.error, attempts: o.attempts, traceId: o.traceId });
    return { ok: true, archivedTo: archive, restoredFromOverflow: overflow.length, note: "records before the damage are in the archive; they are not silently re-created" };
  }
  return { deadLetter, list, resolve, authorizeRetry, retry, recoverStore, get: id => (R.has(id) ? view(R.get(id)) : null), verify: () => (chain ? chain.verify() : { ok: false, reason: corrupt }),
    status: () => ({ state: corrupt ? "CORRUPT" : "OK", corrupt, open: [...R.values()].filter(x => x.status === "OPEN").length, total: R.size, durable: true }), auditEntries: () => (chain ? chain.entries() : []) };
}
