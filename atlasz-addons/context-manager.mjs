// Context-window management and token accounting (85-capability programme: G13 Context and Cost Optimization, supports M03 / P16).
// What it does: packs a conversation into a token budget WITHOUT silently losing anything that must stay (pinned items), keeps the newest contiguous turns,
// says exactly what was dropped or truncated, and keeps a per-conversation usage ledger. Token counts are ESTIMATES (ceil(chars/4)) unless a provider reported
// real usage; every figure is labelled with its source. Provider-side prompt caching is outside ATLASZ and is NOT claimed. Nothing here spends money: a positive
// cost is only ever RECORDED from a provider report and is flagged when no budget was approved.
export const TOKEN_NOTE = "ESTIMATE: ceil(chars/4); provider-reported usage is labelled PROVIDER";
export const estimateTokens = text => Math.ceil(String(text ?? "").length / 4);

/**
 * packContext({pinned, turns, maxTokens, reserveOutput})
 * pinned: [{id, role, text}] always kept (fails closed if they alone exceed the budget); turns: oldest -> newest.
 * Returns {ok, items, tokens, budget, droppedIds, truncatedIds, omittedMarker}. Newest turn is kept even if it must be truncated; older turns are dropped as a whole.
 */
export function packContext({ pinned = [], turns = [], maxTokens, reserveOutput = 0 } = {}) {
  if (!Number.isInteger(maxTokens) || maxTokens < 16) return { ok: false, reason: "MAX_TOKENS_INVALID" };
  if (!Number.isInteger(reserveOutput) || reserveOutput < 0) return { ok: false, reason: "RESERVE_INVALID" };
  const budget = maxTokens - reserveOutput; if (budget < 16) return { ok: false, reason: "BUDGET_TOO_SMALL" };
  const t = x => estimateTokens(x.text) + 4;                                  // +4: role/formatting overhead per item
  const pinTokens = pinned.reduce((a, x) => a + t(x), 0);
  if (pinTokens > budget) return { ok: false, reason: "PINNED_EXCEEDS_BUDGET", pinnedTokens: pinTokens, budget };
  let left = budget - pinTokens; const keptRev = [], truncatedIds = [];
  const MARKER_COST = 24;                                                    // room kept back so the omission marker always fits when something has to be dropped
  if (turns.reduce((a, x) => a + t(x), 0) > left && left > MARKER_COST + 16) left -= MARKER_COST;
  for (let i = turns.length - 1; i >= 0; i--) {
    const x = turns[i], c = t(x);
    if (c <= left) { keptRev.push(x); left -= c; continue; }
    if (keptRev.length === 0 && left > 8) {                                   // the newest turn is never dropped: keep its head
      const chars = Math.max(1, (left - 4 - 4) * 4); keptRev.push({ ...x, text: String(x.text).slice(0, chars) + " [truncated]", truncated: true }); truncatedIds.push(x.id); left = 0;
    }
    break;                                                                    // contiguous suffix only: never keep a turn after skipping an older one
  }
  const kept = keptRev.reverse(), keptIds = new Set(kept.map(x => x.id)), droppedIds = turns.filter(x => !keptIds.has(x.id)).map(x => x.id);
  let marker = null;
  if (droppedIds.length && left + MARKER_COST >= 12) { marker = { id: "omitted", role: "system", text: `[${droppedIds.length} earlier turn(s) omitted to fit the context window]`, synthetic: true }; left = Math.max(0, left - t(marker)); }
  const items = [...pinned, ...(marker ? [marker] : []), ...kept];
  return { ok: true, items, tokens: items.reduce((a, x) => a + t(x), 0), budget, droppedIds, truncatedIds, omittedMarker: Boolean(marker), tokenNote: TOKEN_NOTE };
}

/** Per-conversation usage ledger. record() never throws; invalid input is rejected with a reason. */
export function createUsageLedger({ now = () => new Date().toISOString() } = {}) {
  const rows = [];
  const num = v => Number.isFinite(v) && v >= 0;
  function record({ conversationId, modelId = "unknown", promptTokens = 0, completionTokens = 0, source = "ESTIMATE", costUsd = 0, budgetUsd = 0 } = {}) {
    if (!conversationId || typeof conversationId !== "string") return { ok: false, reason: "CONVERSATION_REQUIRED" };
    if (!["ESTIMATE", "PROVIDER"].includes(source)) return { ok: false, reason: "SOURCE_INVALID" };
    if (![promptTokens, completionTokens, costUsd, budgetUsd].every(num)) return { ok: false, reason: "NUMBERS_INVALID" };
    if (source === "ESTIMATE" && costUsd > 0) return { ok: false, reason: "COST_ONLY_FROM_PROVIDER_REPORT" };
    const unapprovedSpend = costUsd > budgetUsd;                               // flagged, never hidden
    const row = { at: now(), conversationId, modelId, promptTokens, completionTokens, source, costUsd, unapprovedSpend }; rows.push(row); return { ok: true, row };
  }
  function summary(conversationId) {
    const r = rows.filter(x => x.conversationId === conversationId), sum = k => r.reduce((a, x) => a + x[k], 0);
    const byModel = {}; for (const x of r) { const m = byModel[x.modelId] ??= { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }; m.calls++; m.promptTokens += x.promptTokens; m.completionTokens += x.completionTokens; m.costUsd += x.costUsd; }
    return { conversationId, calls: r.length, promptTokens: sum("promptTokens"), completionTokens: sum("completionTokens"), totalTokens: sum("promptTokens") + sum("completionTokens"), costUsd: sum("costUsd"),
      estimatedCalls: r.filter(x => x.source === "ESTIMATE").length, providerReportedCalls: r.filter(x => x.source === "PROVIDER").length, unapprovedSpendCalls: r.filter(x => x.unapprovedSpend).length, byModel, tokenNote: TOKEN_NOTE };
  }
  return { record, summary, rows: () => rows.map(x => ({ ...x })), load: list => { rows.length = 0; for (const x of list ?? []) rows.push({ ...x }); } };
}
