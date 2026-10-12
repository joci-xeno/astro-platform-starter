// Registrations: the AI Model Manager (registry > egress policy > gateway/resilience > billing guard) and the model-evolution lifecycle. Nothing here calls a model on its own and nothing is
// ever reported LIVE except by the gateway's own passing probe. No provider credential passes through these capabilities (the vault resolves a credential reference at call time).
import path from "node:path";
import { ANY, str, num, int, bool, arr, obj, cap, POLICY } from "./_util.mjs";
import { createModelEvolution } from "../model-evolution.mjs";

const plain = x => JSON.parse(JSON.stringify(x ?? null));
export function registerModels(broker, ctx) {
  const P = () => ctx.modelPanel(), reg = () => P().registry();
  broker.register({ id: "ai-model-manager", source: "atlasz-control-center/model-registry-panel.mjs", manager: "AI_MODEL_MANAGER", lifecycle: "CONTINUOUS", policy: POLICY.external,
    purpose: "The ONE path to AI models: owner-managed registry (providers, models, versions, agent assignments, role defaults) > egress policy > gateway/resilience with probe-based LIVE evidence > billing guard (one paid request key is billed once; no-spend by default). Enabling a cloud/paid model, a spend cap and egress hosts are signed owner actions and are not exposed here.",
    capabilities: [
      cap("status", "READ_STATUS", () => { const s = reg().status(); return plain({ providers: s.providers, models: s.models, enabled: s.enabled, live: s.live, assigned: s.assigned, integrity: s.integrity, readOnly: s.readOnly }); }, { description: "Counts from the registry; `live` comes only from the gateway's own probe evidence." }),
      cap("models", "READ_STATUS", a => ({ models: plain(reg().listModels().slice(0, a.limit ?? 100).map(m => ({ id: m.id, providerId: m.providerId, family: m.family, version: m.version, enabled: m.enabled, live: m.live, usable: m.usable, costClass: m.costClass, blockers: m.blockers }))), total: reg().listModels().length }), { input: obj({ limit: int({ minimum: 1, maximum: 500 }) }) }),
      cap("resolve", "READ_STATUS", a => plain(reg().resolve({ agentId: a.agentId, capability: a.capability ?? "text", maxCostUsd: a.maxCostUsd ?? 0 })), { input: obj({ agentId: str({ maxLength: 40 }), capability: str({ maxLength: 40 }), maxCostUsd: num({ minimum: 0 }) }, ["agentId"]), description: "Dry-run routing: which models WOULD serve this agent within the budget, and why others are skipped." }),
      cap("usage", "READ_STATUS", () => plain(reg().billing.usage())),
      cap("evidence", "READ_STATUS", () => { const e = P().view().evidence; return plain({ counts: e.counts, liveOperational: e.liveOperational, ledger: e.ledger, models: e.models.slice(0, 200).map(m => ({ modelId: m.modelId, state: m.state, reached: m.reached, blockers: m.blockers, transport: m.transport, realCalls: m.realCalls, lastRealCallAt: m.lastRealCallAt })), meaning: e.meaning }); }, { description: "Evidence ladder per model: REGISTERED / CONFIGURED / AUTHENTICATED / CALL_VERIFIED / LIVE_OPERATIONAL / BLOCKED. Only REAL authenticated calls count; fixtures never do." }),
      cap("probe", "EXTERNAL_READ", async () => plain(await P().action({ op: "probe" })), { description: "Probe every enabled registry model through its adapter (free: loopback Ollama or the provider's model-list endpoint; providers without a credential answer NO_CREDENTIAL without any network call).", timeoutMs: 120000 })
    ],
    selfTest: { capability: "status", needs: () => (ctx.usableModelCount?.() > 0 ? null : "at least one enabled, credentialed model with a passing probe (0 LIVE models today; provider credentials and owner enable-approvals are pending)"), expect: r => (typeof r.models === "number" && r.live >= 0 ? true : "status shape") } });
  let evo = null; const evolution = () => (evo ??= createModelEvolution({ dir: path.join(ctx.stateDir, "models", "evolution"), registry: reg(), ownerAuth: ctx.ownerAuthOrNull?.() }));
  broker.register({ id: "model-evolution", source: "atlasz-addons/model-evolution.mjs", manager: "AI_MODEL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.external,
    purpose: "Model candidate lifecycle (DISCOVERED > BENCHMARKING > RECOMMENDED > APPROVED_FOR_ROLLOUT > ROLLED_OUT / REJECTED / ROLLED_BACK): catalogue discovery adds candidates to the registry DISABLED, compatibility and benchmark evidence, deprecation records, and a policy that starts MANUAL. Rollout and any paid benchmark need signed owner approvals (not exposed); nothing is upgraded in place.",
    capabilities: [
      cap("summary", "READ_STATUS", () => plain(evolution().summary())),
      cap("policy", "READ_STATUS", () => plain(evolution().policy())),
      cap("candidates", "READ_STATUS", () => ({ candidates: plain(evolution().list().map(c => ({ candidateId: c.candidateId, state: c.state, modelId: c.modelId ?? null }))) })),
      cap("discover", "INTERNAL_BRAIN_ACTION", a => plain(evolution().discoverFromCatalogue(a.catalogue, { sourceId: a.sourceId ?? "catalogue" })), { input: obj({ catalogue: str({ maxLength: 2000000 }), sourceId: str({ maxLength: 60 }) }, ["catalogue"]), description: "Validate an injected catalogue JSON and add NEW models to the registry as DISABLED candidates (no network, no enabling)." })
    ],
    selfTest: { capability: "policy", expect: r => (r && r.mode === "MANUAL" ? true : "the default policy must be MANUAL: " + JSON.stringify(r).slice(0, 80)) } });
  broker.register({ id: "multi-model-brain", source: "atlasz-addons/multi-model-brain.mjs", manager: "AI_MODEL_MANAGER", lifecycle: "SUPERSEDED", supersededBy: "ai-model-manager", policy: POLICY.external,
    purpose: "Process-local provider registry and router (legacy).", rationale: "The AI Model Manager (registry, egress policy, gateway with probe evidence, billing guard) is the single governed path to models; this legacy router has its own provider map without those controls, so activating it would create a second, unguarded route." });
  broker.register({ id: "owner-control/money-state-guard", source: "atlasz-addons/owner-control/money-state-guard.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "INTERNAL_LIBRARY", consumer: "owner-control", policy: POLICY.money,
    purpose: "Money state guard inside the owner-control stack: forbids marking money states (PAID, VERIFIED ...) without the evidence the state requires; enforced by the control chain for every money operation." });
}
