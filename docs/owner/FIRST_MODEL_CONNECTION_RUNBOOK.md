# First live AI model connection — runbook (nothing is connected yet)

Status today (runtime evidence, `core.modelRegistry()`): 0 models registered, 0 LIVE, vault LOCKED (no `ATLASZ_VAULT_KEY`), no credential stored, no egress policy. Nothing was contacted and nothing was bought.

## Decision for the owner (one of)
| Option | Cost | What you do | Notes |
|---|---|---|---|
| A. Existing API key you already pay for | none new | store the key in the vault (step 2) | A chat subscription (e.g. a consumer plan) is **not** an API key; if you have no API key for a provider this option is unavailable without a new purchase. |
| B. Local model via Ollama on your machine | none | install Ollama yourself, run it on `127.0.0.1:11434` | Provider `ollama-local`, loopback only; no key, no internet. Capability is limited by your hardware. |
| C. Stay without a model | none | nothing | Agents keep using their deterministic local executors. Everything else works. |

Nothing below is done until you choose. Model IDs are never invented: they are discovered from the provider after authentication (`GET` model list, allowed by the route policy), then registered by you.

## Steps for A (cloud provider with a key you already have)
1. **Host key (once):** set `ATLASZ_VAULT_KEY` (base64 of 32 random bytes) in the server environment — never in the repository or chat.
2. **Store the credential:** Control Center → Vault → store under the expected reference (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, …). The key is encrypted at rest, never logged, never shown to agents; only the credential broker releases it, and only past the execution boundary.
3. **Register + enable one model:** Control Center → Models → add the provider's model ID you read from its console → `enable` (signed owner approval).
4. **Approve the host (signed):** Models → egress proposal for that provider. The policy is derived from the wire profile: that provider's host only, port 443, **POST to the chat path** and **GET to the model-list path** only, 1 MiB request cap. The approval is bound to the policy hash.
5. **Set a spend cap first:** Models → `setSpendCap` (default per-request budget is 0, so no paid call can happen before you raise it).
6. **Probe:** Models → `probe`. A model becomes LIVE_OPERATIONAL only when ATLASZ's own authenticated call succeeds through a real transport; fixtures never count.

## What is already enforced (by code)
Execution boundary and incident blocks before the broker; DNS-pinned HTTPS; redirects never followed; secrets scrubbed from errors; per-request budget guard; every call in a hash-chained ledger; the owner stop halts all calls.

## What I could not verify
No real provider was contacted (no credentials, no approved host); the sandbox has no model access. Live behaviour, latency and billing are unverified.
