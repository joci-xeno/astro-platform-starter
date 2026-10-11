// Generates docs/audit/provider_matrix.md from the code (SEED_PROVIDERS + PROVIDER_PROFILES) so the matrix cannot drift from what is implemented.
// Run: node docs/audit/provider_matrix.mjs   (writes the file; no network)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_PROVIDERS } from "../../atlasz-addons/model-registry.mjs";
import { PROVIDER_PROFILES } from "../../atlasz-addons/provider-adapters.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const rows = SEED_PROVIDERS.map(p => {
  const pr = Object.hasOwn(PROVIDER_PROFILES, p.id) ? PROVIDER_PROFILES[p.id] : null, local = p.kind === "LOCAL";
  const connector = local ? "IMPLEMENTED_TESTED (loopback Ollama adapter, fake fetch)" : pr ? "IMPLEMENTED_TESTED_WITH_FAKE_FETCH (" + pr.style + ")" : "NO_ADAPTER (placeholder host; owner must give the real API host/spec)";
  const discovery = local ? "none yet (Ollama /api/tags not wired)" : pr?.models ? "free model-list endpoint (GET " + pr.models + ")" : pr ? "NONE (no free list endpoint known) - owner types the model id" : "n/a";
  const health = local ? "GET /api/version" : pr?.models ? "model-list probe (free)" : pr ? "PROBE_UNSUPPORTED - never LIVE by probe alone" : "n/a";
  return `| ${p.id} | ${p.kind} | ${p.egressHosts.join(", ")} | ${connector} | ${p.credentialRef ? p.credentialRef + " (vault)" : "none"} | ${discovery} | ${health} | NOT_LIVE (no credential/probe evidence) |`;
});
const md = `# Provider matrix (generated; IMPLEMENTED != CONNECTED != TESTED != LIVE)

| Provider | Kind | Egress host | Connector status | Credential | Model discovery | Health check | Live status |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

Common to every provider:
- **Auth:** the credential is read from the encrypted vault at call time only; absent/malformed -> NO_CREDENTIAL and no request is made. The owner stores it; ATLASZ never creates or buys keys.
- **Security:** every request needs an owner-signed egress policy for the exact host/paths (GET model list + POST chat), the kill switch must be off, DNS answers are checked and the connection is pinned to them, redirects are never followed, responses are size-capped and screened as untrusted text.
- **Cost/usage controls:** cloud models are PAID/UNKNOWN until the owner sets a price; enabling needs a signed MODEL_ENABLE bound to the exact config; no-spend default; per-request key billed once; cost is computed only from reported token usage x the owner-set price, otherwise unknown (never 0).
- **Fallback:** per-agent primary + fallbacks and role defaults (model-registry); failover only after a zero-cost failure.
- **Owner can:** add provider/model, enable/disable, assign to agents, upgrade a model version, test connection, apply egress policy, roll back the registry - all in Control Center "Models & Providers" (no reinstall).
- **Required owner actions per provider:** (1) put the API key in the vault under the credential name above, (2) add the model (id + providerModel from the provider's own list), (3) sign enable and the egress policy, (4) press "Test connections".
- **Probe-less providers (MiniMax, GLM, Perplexity):** no free list endpoint is known, so they cannot become LIVE until the owner approves a tiny paid probe (not implemented; needs a separate spend approval design). Until then they stay ENABLED_NOT_PROBED and are never routed.
- **Not done / unknown:** no provider has been contacted from this build; the host/path profiles come from public documentation (checked 2026-10-11 for MiniMax and GLM) and must be confirmed by the first real probe. Merlin has a placeholder host and no adapter. xAI/Gemini/Anthropic/OpenAI profiles are from known public APIs and equally unverified until probed. Perplexity and Hugging Face usage terms and billing are the owner's to confirm.
`;
fs.writeFileSync(path.join(here, "provider_matrix.md"), md);
console.log(rows.length + " providers written");
