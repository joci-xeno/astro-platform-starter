// ATLASZ claim distinctions (V7.3 Owner Control §6). A weaker state NEVER becomes the stronger one on a claim: it needs an
// independent ACCEPT from the verifier for the matching claim type. No verifier / no evidence source => stays at the weaker state.
export const DISTINCTIONS = Object.freeze([
  ["REQUESTED", "EXECUTED", "EXTERNAL_ACTION"], ["DRAFT", "SENT", "SEND_STATE"], ["QUEUED", "SENT", "SEND_STATE"],
  ["CREATED", "DELIVERED", "FILE_DELIVERY"], ["INVOICE", "PAID", "PAYMENT"], ["CUSTOMER_SAYS_PAID", "VERIFIED_PAYMENT", "PAYMENT"],
  ["SIMULATION", "LIVE", "RUNTIME_HEALTH"], ["CONFIGURED", "TESTED", "RUNTIME_HEALTH"], ["CONNECTED", "LIVE", "RUNTIME_HEALTH"],
].map(([weak, strong, claimType]) => Object.freeze({ weak, strong, claimType })));

export function createClaimTracker({ verifier = null } = {}) {
  const items = new Map();
  const get = id => items.get(id) ?? null;
  function set(id, state) { const known = DISTINCTIONS.some(d => d.weak === state); if (!known) throw new Error("UNKNOWN_WEAK_STATE:" + state); items.set(id, { id, state, history: [{ state, verified: false }] }); return get(id); }
  /** Try to move an item from its weak state to the stronger one. Returns {advanced, state, verdict, reason}. */
  function advance(id, { claim = {}, evidence = {}, executorId = null } = {}) {
    const it = items.get(id); if (!it) throw new Error("UNKNOWN_ITEM");
    const d = DISTINCTIONS.find(x => x.weak === it.state);
    if (!d) return { advanced: false, state: it.state, verdict: "REJECT", reason: "ALREADY_AT_STRONG_OR_UNKNOWN_STATE" };
    if (!verifier) return { advanced: false, state: it.state, verdict: "ESCALATE", reason: "NO_VERIFIER_NOT_VERIFIED" };
    const r = verifier.verify({ claimType: d.claimType, claim, evidence, executorId, claimText: `${d.weak}->${d.strong}` });
    if (r.verdict === "ACCEPT" && r.independent === true) { it.state = d.strong; it.history.push({ state: d.strong, verified: true, reason: r.reason }); return { advanced: true, state: it.state, verdict: r.verdict, reason: r.reason }; }
    return { advanced: false, state: it.state, verdict: r.verdict, reason: r.reason };
  }
  return { set, advance, get, all: () => [...items.values()] };
}
