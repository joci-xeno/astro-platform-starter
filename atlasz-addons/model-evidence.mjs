// ATLASZ model evidence ladder (Batch 7B). Six separate words that must never be confused:
//   REGISTERED       the model exists in the registry (config only)
//   CONFIGURED       enabled by the owner, egress to its host approved, credential present in the vault (or none needed for a loopback model)
//   AUTHENTICATED    a REAL probe reached the provider/local server and it accepted us
//   CALL_VERIFIED    a REAL task call returned a well-formed answer
//   LIVE_OPERATIONAL CALL_VERIFIED, a recent REAL successful call, spend recorded (or provably free), model still enabled and not failing now
//   BLOCKED          the next step cannot happen until an owner/external blocker is removed (reasons listed; `reached` keeps the highest state proven)
// Fixture transports (injected fetch in tests) NEVER count: they cap the ladder at CONFIGURED with FIXTURE_TRANSPORT.
// The evidence ledger is a hash-chained audit file; the state is derived from it, never stored as a flag that could be edited.
import path from "node:path";
import { createAuditChain } from "./audit-chain.mjs";
import { scrub } from "./secret-patterns.mjs";

export const EVIDENCE_STATES = Object.freeze(["REGISTERED", "CONFIGURED", "AUTHENTICATED", "CALL_VERIFIED", "LIVE_OPERATIONAL", "BLOCKED"]);
export const FRESH_MS = 7 * 24 * 3600 * 1000;

export function createModelEvidenceLedger({ dir, now = () => Date.now() } = {}) {
  if (!dir) throw new Error("EVIDENCE_DIR_REQUIRED");
  const chain = createAuditChain({ filePath: path.join(dir, "model-evidence.jsonl"), headPinFile: path.join(dir, "model-evidence.headpin.json") });
  const KINDS = new Set(["PROBE", "CALL"]);
  function record({ kind, modelId, ok, transport, costUsd = null, reason = null } = {}) {
    if (!KINDS.has(kind) || typeof modelId !== "string" || !modelId || modelId.length > 200) throw new Error("EVIDENCE_RECORD_INVALID");
    chain.append("MODEL_" + kind, { modelId, ok: ok === true, transport: transport === "REAL" ? "REAL" : "FIXTURE", costUsd: Number.isFinite(costUsd) ? costUsd : null, reason: reason ? scrub(String(reason)).slice(0, 120) : null, atMs: now() });
  }
  const events = () => chain.entries().map(e => ({ event: e.event, ...e.data }));
  return { record, events, verify: () => chain.verify() };
}

/** Pure derivation. `events` come from the ledger; `facts` from the registry/egress/vault at this moment. */
export function deriveEvidence({ model, facts, events = [], nowMs = Date.now() } = {}) {
  const f = { enabled: false, egressApproved: false, credentialNeeded: false, credentialPresent: false, adapter: false, transport: "REAL", breakerOpen: false, ...facts };
  const mine = events.filter(e => e.modelId === model.id);
  const real = mine.filter(e => e.transport === "REAL");
  const blockers = [];
  if (!f.enabled) blockers.push("DISABLED_OR_NOT_YET_APPROVED_BY_OWNER");
  if (!f.egressApproved) blockers.push("EGRESS_POLICY_NOT_APPROVED");
  if (f.credentialNeeded && !f.credentialPresent) blockers.push("NO_CREDENTIAL_IN_VAULT");
  if (!f.adapter) blockers.push("NO_PROVIDER_ADAPTER");
  if (f.transport !== "REAL") blockers.push("FIXTURE_TRANSPORT_ONLY");
  const configured = f.enabled && f.egressApproved && (!f.credentialNeeded || f.credentialPresent) && f.adapter;
  const authOk = configured && f.transport === "REAL" && real.some(e => e.kind === "PROBE" && e.ok);
  const lastProbe = [...real].reverse().find(e => e.kind === "PROBE");
  const callOk = authOk && real.some(e => e.kind === "CALL" && e.ok);
  const lastCall = [...real].reverse().find(e => e.kind === "CALL");
  const fresh = callOk && lastCall?.ok === true && nowMs - lastCall.atMs <= FRESH_MS;
  const spendKnown = callOk && real.filter(e => e.kind === "CALL" && e.ok).every(e => e.costUsd !== null);
  const live = fresh && spendKnown && !f.breakerOpen && lastProbe?.ok !== false;
  let reached = "REGISTERED"; if (configured) reached = "CONFIGURED"; if (authOk) reached = "AUTHENTICATED"; if (callOk) reached = "CALL_VERIFIED"; if (live) reached = "LIVE_OPERATIONAL";
  if (configured && f.transport === "REAL" && !authOk) blockers.push(lastProbe && !lastProbe.ok ? "PROBE_FAILED:" + (lastProbe.reason ?? "unknown") : "NOT_PROBED_YET");
  if (authOk && !callOk) blockers.push(lastCall && !lastCall.ok ? "CALL_FAILED:" + (lastCall.reason ?? "unknown") : "NO_REAL_TASK_CALL_YET");
  if (callOk && !live) blockers.push(!fresh ? "NO_RECENT_SUCCESSFUL_CALL" : !spendKnown ? "SPEND_NOT_RECORDED" : f.breakerOpen ? "BREAKER_OPEN" : "LAST_PROBE_FAILED");
  const ownerExternal = new Set(["DISABLED_OR_NOT_YET_APPROVED_BY_OWNER", "EGRESS_POLICY_NOT_APPROVED", "NO_CREDENTIAL_IN_VAULT", "NO_PROVIDER_ADAPTER", "FIXTURE_TRANSPORT_ONLY"]);
  const state = reached === "LIVE_OPERATIONAL" ? reached : (blockers.some(b => ownerExternal.has(b)) || blockers.some(b => /^(PROBE_FAILED|CALL_FAILED)/.test(b))) ? "BLOCKED" : reached;
  return { modelId: model.id, providerId: model.providerId, state, reached, blockers, transport: f.transport, realProbes: real.filter(e => e.kind === "PROBE").length, realCalls: real.filter(e => e.kind === "CALL" && e.ok).length, lastRealCallAt: lastCall ? new Date(lastCall.atMs).toISOString() : null };
}
