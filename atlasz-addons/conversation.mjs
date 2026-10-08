// Multi-model conversation object (85-capability programme: M03 Multi-Model Conversation Interface, P16 Long-Session Continuity; uses G13 context-manager).
// A conversation is a durable, tenant-scoped list of turns. The model can be switched between turns; every assistant turn records WHICH model produced it.
// Model output and tool results are UNTRUSTED text: stored flagged untrusted and fenced when put back into a prompt. Secrets are redacted before storage.
// With no live provider, complete() answers the gateway's honest NO_ELIGIBLE_PROVIDER and adds NO turn - nothing is ever fabricated. No spending: budget is 0 unless
// the caller passes an owner-approved figure (the conversation never raises it). Another tenant's conversation looks exactly like a missing one.
import crypto from "node:crypto";
import { createStore, clone } from "./business/store.mjs";
import { packContext, estimateTokens, createUsageLedger } from "./context-manager.mjs";
import { okName, own } from "./safe-keys.mjs";

export const LIMITS = Object.freeze({ maxConversations: 200, maxTurns: 500, maxTextChars: 20000, maxTitleChars: 120, maxSystemChars: 4000 });
import { scrub, containsSecret } from "./secret-patterns.mjs";
const redact = s => { const out = scrub(s, "[redacted]"); return { text: out, redacted: out !== String(s ?? "") }; };
const rid = p => p + crypto.randomBytes(8).toString("hex");
const ROLES = new Set(["user", "assistant", "tool"]);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,79}$/, modelOk = m => m === null || (typeof m === "string" && MODEL.test(m));

export function createConversationStore({ file = null, now = () => new Date().toISOString() } = {}) {
  const store = createStore({ file, init: () => ({ conversations: {}, usage: [] }) });
  const d = store.data, usage = createUsageLedger({ now }); usage.load(d.usage);
  const find = (id, tenantId) => { const c = own(d.conversations, id); return c && c.tenantId === tenantId ? c : null; };
  const pub = c => ({ id: c.id, title: c.title, model: c.model, turns: c.turns.length, createdAt: c.createdAt, updatedAt: c.updatedAt, switches: c.switches.length });
  const inflight = new Set();
  const persist = () => { d.usage = usage.rows(); store.save(); };

  function create({ tenantId, title = "Conversation", systemPrompt = "", model = null } = {}) {
    if (!tenantId || typeof tenantId !== "string") return { ok: false, reason: "TENANT_REQUIRED" };
    if (!modelOk(model)) return { ok: false, reason: "MODEL_INVALID" };
    if (Object.values(d.conversations).filter(x => x.tenantId === tenantId).length >= LIMITS.maxConversations) return { ok: false, reason: "TOO_MANY_CONVERSATIONS" };
    const sp = redact(String(systemPrompt)); sp.text = sp.text.slice(0, LIMITS.maxSystemChars); const c = { id: rid("cv_"), tenantId, title: redact(String(title)).text.slice(0, LIMITS.maxTitleChars) || "Conversation", systemPrompt: sp.text, model, switches: [], turns: [], createdAt: now(), updatedAt: now() };
    d.conversations[c.id] = c; persist(); return { ok: true, id: c.id, conversation: pub(c) };
  }
  function addTurn(id, { tenantId, role, text, modelId = null } = {}) {
    const c = find(id, tenantId); if (!c) return { ok: false, reason: "NOT_FOUND" };
    if (!ROLES.has(role)) return { ok: false, reason: "ROLE_INVALID" };
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "TEXT_REQUIRED" };
    if (text.length > LIMITS.maxTextChars) return { ok: false, reason: "TEXT_TOO_LONG" };
    if (c.turns.length >= LIMITS.maxTurns) return { ok: false, reason: "TOO_MANY_TURNS" };
    if (!modelOk(modelId ?? null)) return { ok: false, reason: "MODEL_INVALID" };
    const r = redact(text), turn = { id: rid("t_"), role, text: r.text, redacted: r.redacted, untrusted: role !== "user", modelId: role === "assistant" ? (modelId ?? c.model) : null, at: now(), tokens: estimateTokens(r.text) };
    c.turns.push(turn); c.updatedAt = now(); persist(); return { ok: true, turn: clone(turn) };
  }
  function setModel(id, { tenantId, model } = {}) {
    const c = find(id, tenantId); if (!c) return { ok: false, reason: "NOT_FOUND" };
    if (typeof model !== "string" || !MODEL.test(model)) return { ok: false, reason: "MODEL_INVALID" };
    if (c.model !== model) { c.switches.push({ at: now(), from: c.model, to: model, afterTurn: c.turns.length }); c.model = model; c.updatedAt = now(); persist(); }
    return { ok: true, model: c.model, switches: c.switches.length };
  }
  const defuse = x => String(x).replace(/<</g, "\u2039\u2039").replace(/>>/g, "\u203a\u203a");          // text inside a fence can never contain the fence delimiters
  const fence = t => t.role === "user" ? defuse(t.text) : `<<${t.role === "tool" ? "UNTRUSTED TOOL RESULT" : "ASSISTANT (model " + defuse(String(t.modelId ?? "?").slice(0, 80)) + ")"}>>\n${defuse(t.text)}\n<<END>>`;
  function context(id, { tenantId, maxTokens = 4000, reserveOutput = Math.min(500, Math.floor(maxTokens / 4)) } = {}) {
    const c = find(id, tenantId); if (!c) return { ok: false, reason: "NOT_FOUND" };
    const pinned = c.systemPrompt ? [{ id: "system", role: "system", text: defuse(c.systemPrompt), pinned: true }] : [];
    const p = packContext({ pinned, turns: c.turns.map(t => ({ id: t.id, role: t.role, text: fence(t) })), maxTokens, reserveOutput, requireNewest: true });
    return p.ok ? { ...p, conversationId: id, model: c.model } : p;
  }
  /** Ask the gateway for the next assistant turn. Adds a turn only on a real, non-quarantined answer. */
  async function complete(id, { tenantId, gateway, capability = "text", maxTokens = 4000, budgetUsd = 0 } = {}) {
    const c = find(id, tenantId); if (!c) return { ok: false, reason: "NOT_FOUND" };
    if (!gateway || typeof gateway.complete !== "function") return { ok: false, reason: "GATEWAY_REQUIRED" };
    if (typeof budgetUsd !== "number" || !Number.isFinite(budgetUsd) || budgetUsd < 0) return { ok: false, reason: "BUDGET_INVALID" };
    if (!c.turns.length || c.turns.at(-1).role !== "user") return { ok: false, reason: "LAST_TURN_MUST_BE_USER" };
    const ctx = context(id, { tenantId, maxTokens, reserveOutput: Math.min(500, Math.floor(maxTokens / 4)) }); if (!ctx.ok) return ctx;
    const prompt = ctx.items.map(i => (i.role === "system" ? "[SYSTEM] " : "") + i.text).join("\n\n");
    if (inflight.has(id)) return { ok: false, reason: "COMPLETION_ALREADY_RUNNING" };      // one provider call per conversation at a time: no double spend, no interleaved turns
    inflight.add(id); let r;
    try { r = await gateway.complete({ capability, prompt, budgetUsd }); } catch { return { ok: false, reason: "GATEWAY_ERROR", turnAdded: false }; } finally { inflight.delete(id); }
    if (!r || typeof r !== "object") return { ok: false, reason: "GATEWAY_ERROR", turnAdded: false };
    if (!r.ok || r.output == null) { return { ok: false, reason: r.reason ?? (r.quarantined ? "OUTPUT_QUARANTINED" : "NO_OUTPUT"), turnAdded: false, quarantined: Boolean(r.quarantined) }; }
    const mid = modelOk(r.providerId ?? null) && r.providerId ? r.providerId : "unknown";
    const t = typeof r.output === "string" ? addTurn(id, { tenantId, role: "assistant", text: r.output, modelId: mid === "unknown" ? c.model : mid }) : { ok: false, reason: "OUTPUT_NOT_TEXT" };
    const u = usage.record({ conversationId: id, modelId: mid, promptTokens: ctx.tokens, completionTokens: estimateTokens(typeof r.output === "string" ? r.output : ""), source: Number.isFinite(r.costUsd) && r.costUsd >= 0 ? "PROVIDER" : "ESTIMATE", costUsd: Number.isFinite(r.costUsd) && r.costUsd >= 0 ? r.costUsd : null, budgetUsd }); persist();      // spend is recorded even when the answer cannot be stored
    if (!t.ok) return { ok: false, reason: t.reason, turnAdded: false, usageRecorded: u.ok };
    return { ok: true, turn: t.turn, providerId: mid, untrusted: true, droppedTurns: ctx.droppedIds.length, usageRecorded: u.ok };
  }
  const get = (id, { tenantId } = {}) => { const c = find(id, tenantId); return c ? { ok: true, conversation: { ...pub(c), systemPrompt: c.systemPrompt, switchLog: clone(c.switches), turns: clone(c.turns) } } : { ok: false, reason: "NOT_FOUND" }; };
  const list = ({ tenantId } = {}) => Object.values(d.conversations).filter(c => c.tenantId === tenantId).map(pub);
  function remove(id, { tenantId } = {}) { const c = find(id, tenantId); if (!c) return { ok: false, reason: "NOT_FOUND" }; delete d.conversations[id]; usage.load(usage.rows().filter(x => x.conversationId !== id)); persist(); return { ok: true }; }
  const usageSummary = (id, { tenantId } = {}) => find(id, tenantId) ? { ok: true, ...usage.summary(id) } : { ok: false, reason: "NOT_FOUND" };
  return { create, addTurn, setModel, context, complete, get, list, remove, usageSummary };
}
