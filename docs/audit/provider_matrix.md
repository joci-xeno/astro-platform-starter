# Provider matrix (generated; IMPLEMENTED != CONNECTED != TESTED != LIVE)

| Provider | Kind | Egress host | Connector status | Credential | Model discovery | Health check | Live status |
|---|---|---|---|---|---|---|---|
| openai | CLOUD | api.openai.com | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | OPENAI_API_KEY (vault) | free model-list endpoint (GET /v1/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| anthropic | CLOUD | api.anthropic.com | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (anthropic) | ANTHROPIC_API_KEY (vault) | free model-list endpoint (GET /v1/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| google | CLOUD | generativelanguage.googleapis.com | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (gemini) | GOOGLE_API_KEY (vault) | free model-list endpoint (GET /v1beta/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| xai | CLOUD | api.x.ai | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | XAI_API_KEY (vault) | free model-list endpoint (GET /v1/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| merlin | CLOUD | api.merlin.example | NO_ADAPTER (placeholder host; owner must give the real API host/spec) | MERLIN_API_KEY (vault) | n/a | n/a | NOT_LIVE (no credential/probe evidence) |
| deepseek | CLOUD | api.deepseek.com | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | DEEPSEEK_API_KEY (vault) | free model-list endpoint (GET /models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| mistral | CLOUD | api.mistral.ai | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | MISTRAL_API_KEY (vault) | free model-list endpoint (GET /v1/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| openrouter | CLOUD | openrouter.ai | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | OPENROUTER_API_KEY (vault) | free model-list endpoint (GET /api/v1/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| minimax | CLOUD | api.minimax.io | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | MINIMAX_API_KEY (vault) | NONE (no free list endpoint known) - owner types the model id | PROBE_UNSUPPORTED - never LIVE by probe alone | NOT_LIVE (no credential/probe evidence) |
| glm | CLOUD | open.bigmodel.cn | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | GLM_API_KEY (vault) | NONE (no free list endpoint known) - owner types the model id | PROBE_UNSUPPORTED - never LIVE by probe alone | NOT_LIVE (no credential/probe evidence) |
| perplexity | CLOUD | api.perplexity.ai | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | PERPLEXITY_API_KEY (vault) | NONE (no free list endpoint known) - owner types the model id | PROBE_UNSUPPORTED - never LIVE by probe alone | NOT_LIVE (no credential/probe evidence) |
| huggingface | CLOUD | router.huggingface.co | IMPLEMENTED_TESTED_WITH_FAKE_FETCH (openai-compat) | HF_TOKEN (vault) | free model-list endpoint (GET /v1/models) | model-list probe (free) | NOT_LIVE (no credential/probe evidence) |
| ollama-local | LOCAL | 127.0.0.1 | IMPLEMENTED_TESTED (loopback Ollama adapter, fake fetch) | none | none yet (Ollama /api/tags not wired) | GET /api/version | NOT_LIVE (no credential/probe evidence) |

Common to every provider:
- **Auth:** the credential is read from the encrypted vault at call time only; absent/malformed -> NO_CREDENTIAL and no request is made. The owner stores it; ATLASZ never creates or buys keys.
- **Security:** every request needs an owner-signed egress policy for the exact host/paths (GET model list + POST chat), the kill switch must be off, DNS answers are checked and the connection is pinned to them, redirects are never followed, responses are size-capped and screened as untrusted text.
- **Cost/usage controls:** cloud models are PAID/UNKNOWN until the owner sets a price; enabling needs a signed MODEL_ENABLE bound to the exact config; no-spend default; per-request key billed once; cost is computed only from reported token usage x the owner-set price, otherwise unknown (never 0).
- **Fallback:** per-agent primary + fallbacks and role defaults (model-registry); failover only after a zero-cost failure.
- **Owner can:** add provider/model, enable/disable, assign to agents, upgrade a model version, test connection, apply egress policy, roll back the registry - all in Control Center "Models & Providers" (no reinstall).
- **Required owner actions per provider:** (1) put the API key in the vault under the credential name above, (2) add the model (id + providerModel from the provider's own list), (3) sign enable and the egress policy, (4) press "Test connections".
- **Probe-less providers (MiniMax, GLM, Perplexity):** no free list endpoint is known, so they cannot become LIVE until the owner approves a tiny paid probe (not implemented; needs a separate spend approval design). Until then they stay ENABLED_NOT_PROBED and are never routed.
- **Not done / unknown:** no provider has been contacted from this build; the host/path profiles come from public documentation (checked 2026-10-11 for MiniMax and GLM) and must be confirmed by the first real probe. Merlin has a placeholder host and no adapter. xAI/Gemini/Anthropic/OpenAI profiles are from known public APIs and equally unverified until probed. Perplexity and Hugging Face usage terms and billing are the owner's to confirm.
