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
export function packContext({ pinned = [], turns = [], maxTokens, reserveOutput = 0, requireNewest = false } = {}) {
  if (!Number.isInteger(maxTokens) || maxTokens < 16) return { ok: false, reason: "MAX_TOKENS_INVALID" };
  if (!Number.isInteger(reserveOutput) || reserveOutput < 0) return { ok: false, reason: "RESERVE_INVALID" };
  const budget = maxTokens - reserveOutput; if (budget < 16) return { ok: false, reason: "BUDGET_TOO_SMALL" };
  const itemOk = x => x && typeof x === "object" && typeof x.text === "string";
  if (!Array.isArray(pinned) || !Array.isArray(turns) || !pinned.every(itemOk) || !turns.every(itemOk)) return { ok: false, reason: "ITEMS_INVALID" };   // null rows, non-arrays and non-string text are refused, never thrown on
  const t = x => estimateTokens(x.text) + 4;                                  // +4: role/formatting overhead per item
  const pinTokens = pinned.reduce((a, x) => a + t(x), 0);
  if (pinTokens > budget) return { ok: false, reason: "PINNED_EXCEEDS_BUDGET", pinnedTokens: pinTokens, budget };
  let left = budget - pinTokens; const keptRev = [], keptIdx = new Set(), truncatedIds = [];
  const MARKER_COST = 24;                                                    // room kept back so the omission marker always fits when something has to be dropped
  if (turns.reduce((a, x) => a + t(x), 0) > left && left > MARKER_COST + 16) left -= MARKER_COST;
  const idOf = (x, i) => (typeof x?.id === "string" && x.id ? x.id : "#" + i);   // a turn without an id is still reported (by position)
  for (let i = turns.length - 1; i >= 0; i--) {
    const x = turns[i], c = t(x);
    if (c <= left) { keptRev.push(x); keptIdx.add(i); left -= c; continue; }
    if (keptRev.length === 0 && left > 8) {                                   // the newest turn is never dropped: keep its head
      const chars = Math.max(1, (left - 4 - 4 - 2) * 4);   // 2 tokens held back for the closing fence that may be re-added below
      let head = String(x.text).slice(0, chars); if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1);   // never end on half a surrogate pair
      const open = /^<</.test(head) && !/<<END>>\s*$/.test(head);              // a cut fence is closed again so the rest of the context cannot be read as part of it
      keptRev.push({ ...x, text: head + " [truncated]" + (open ? "\n<<END>>" : ""), truncated: true }); keptIdx.add(i); truncatedIds.push(idOf(x, i)); left = 0;
    }
    break;                                                                    // contiguous suffix only: never keep a turn after skipping an older one
  }
  const kept = keptRev.reverse(), droppedIds = turns.map((x, i) => (keptIdx.has(i) ? null : idOf(x, i))).filter(x => x !== null);
  let marker = null;
  if (droppedIds.length && left + MARKER_COST >= 12) { marker = { id: "omitted", role: "system", text: `[${droppedIds.length} earlier turn(s) omitted to fit the context window]`, synthetic: true }; left = Math.max(0, left - t(marker)); }
  if (requireNewest && turns.length && !keptIdx.has(turns.length - 1)) return { ok: false, reason: "NO_ROOM_FOR_NEWEST_TURN", budget };
  let items = [...pinned, ...(marker ? [marker] : []), ...kept], total = items.reduce((a, x) => a + t(x), 0);
  if (total > budget && marker) { marker = null; items = [...pinned, ...kept]; total = items.reduce((a, x) => a + t(x), 0); }   // the result never exceeds the budget: no room => no marker (droppedIds still says what was omitted)
  return { ok: true, items, tokens: total, budget, droppedIds, truncatedIds, omittedMarker: Boolean(marker), tokenNote: TOKEN_NOTE };
}

/** Per-conversation usage ledger. record() never throws; invalid input is rejected with a reason. */
export function createUsageLedger({ now = () => new Date().toISOString() } = {}) {
  const rows = [], MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,79}$/;
  const num = v => Number.isFinite(v) && v >= 0;
  function record({ conversationId, modelId = "unknown", promptTokens = 0, completionTokens = 0, source = "ESTIMATE", costUsd = null, budgetUsd = 0, tokensEstimated = true } = {}) {
    if (!conversationId || typeof conversationId !== "string") return { ok: false, reason: "CONVERSATION_REQUIRED" };
    if (typeof modelId !== "string" || !MODEL_ID.test(modelId)) modelId = "unknown";                       // free text never becomes a ledger key
    if (!["ESTIMATE", "PROVIDER"].includes(source)) return { ok: false, reason: "SOURCE_INVALID" };
    const costKnown = costUsd !== null; if (!costKnown) costUsd = 0;                  // null = the provider did not report a cost: recorded as UNKNOWN, never as a real zero
    if (![promptTokens, completionTokens, costUsd, budgetUsd].every(num) || [promptTokens, completionTokens].some(v => v > 1e9) || costUsd > 1e7 || budgetUsd > 1e7) return { ok: false, reason: "NUMBERS_INVALID" };   // absurd magnitudes cannot overflow the sums to Infinity
    if (source === "ESTIMATE" && costUsd > 0) return { ok: false, reason: "COST_ONLY_FROM_PROVIDER_REPORT" };
    const unapprovedSpend = costUsd > budgetUsd;                               // flagged, never hidden
    const row = { at: now(), conversationId, modelId, promptTokens, completionTokens, source, costUsd, costKnown, tokensEstimated: tokensEstimated !== false, unapprovedSpend }; rows.push(row); return { ok: true, row };
  }
  function summary(conversationId) {
    const r = rows.filter(x => x.conversationId === conversationId), sum = k => r.reduce((a, x) => a + x[k], 0);
    const byModel = Object.create(null); for (const x of r) { const m = byModel[x.modelId] ??= { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, unknownCostCalls: 0 }; m.calls++; if (x.costKnown !== true) m.unknownCostCalls++; m.promptTokens += x.promptTokens; m.completionTokens += x.completionTokens; m.costUsd += x.costUsd; }
    return { conversationId, calls: r.length, promptTokens: sum("promptTokens"), completionTokens: sum("completionTokens"), totalTokens: sum("promptTokens") + sum("completionTokens"), costUsd: r.length && r.every(x => x.costKnown !== true) ? null : sum("costUsd"), unknownCostCalls: r.filter(x => x.costKnown !== true).length, costNote: "costUsd is the sum of REPORTED costs only; calls with unknown cost are counted in unknownCostCalls",
      estimatedCalls: r.filter(x => x.source === "ESTIMATE").length, providerReportedCalls: r.filter(x => x.source === "PROVIDER").length, unapprovedSpendCalls: r.filter(x => x.unapprovedSpend).length, byModel: Object.fromEntries(Object.entries(byModel).map(([k, m]) => [k, m.unknownCostCalls === m.calls ? { ...m, costUsd: null } : m])), tokenEstimatedCalls: r.filter(x => x.tokensEstimated !== false).length, tokenNote: TOKEN_NOTE };
  }
  return { record, summary, rows: () => rows.map(x => ({ ...x })), load: list => {                                                                    // persisted rows are validated; anything malformed is skipped, never summed
    rows.length = 0; const n = v => Number.isFinite(v) && v >= 0;
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || typeof x !== "object" || typeof x.conversationId !== "string" || !["ESTIMATE", "PROVIDER"].includes(x.source) || ![x.promptTokens, x.completionTokens, x.costUsd].every(n) || (x.source === "ESTIMATE" && x.costUsd > 0)) continue;
      rows.push({ at: typeof x.at === "string" ? x.at : "", conversationId: x.conversationId, modelId: typeof x.modelId === "string" && MODEL_ID.test(x.modelId) ? x.modelId : "unknown", promptTokens: x.promptTokens, completionTokens: x.completionTokens, source: x.source, costUsd: x.costUsd, costKnown: x.costKnown === true, tokensEstimated: x.tokensEstimated !== false, unapprovedSpend: x.unapprovedSpend === true });
    }
  } };
}
