# ATLASZ AURÓRA V7.3 — TELJES SZÁMOZOTT RENDSZERLELTÁR (meglévő + tervezett)

Generálva: 2026-10-12 · `b5870e8` · sorok: 1047. **A TERVEZETT sorok nem léteznek.** A teljes adat: `inventory_items.csv`. Lekérdezés: `atl_query.py <ATL-id>`.

## AI-modellek és adapterek (28)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 1 | ATL-MDL-0001 | context-manager | PARTIAL | 9 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) \| tervezett bővítések/kapcsolatok: ATL-PLN-0001; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0163 | 4.84 |
| 2 | ATL-MDL-0002 | conversation | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-PLN-0001 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0164 | 3.92 |
| 3 | ATL-MDL-0003 | cost-model-router | PARTIAL | 11 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0165 | 5.3 |
| 4 | ATL-MDL-0004 | effort-allocation | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6, STRUCTURAL_ONLY:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0166 | 4.61 |
| 5 | ATL-MDL-0005 | local-ai-manager | MOCK_ONLY | 20 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0167 | 5.0 |
| 6 | ATL-MDL-0006 | model-evidence | PARTIAL | 12 | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:6) \| tervezett bővítések/kapcsolatok… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0168 | 4.61 |
| 7 | ATL-MDL-0007 | model-evolution | PARTIAL | 5 | 3 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0169 | 3.69 |
| 8 | ATL-MDL-0008 | model-gateway | MOCK_ONLY | 17 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0170 | 5.0 |
| 9 | ATL-MDL-0009 | model-registry | PARTIAL | 77 | 54 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:19, PARTIAL:33, STRUCTURAL_ONLY:2) \| tervezett… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0171 | 15.42 |
| 10 | ATL-MDL-0010 | model-routing-bridge | PARTIAL | 40 | 25 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:6, PARTIAL:18) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0172 | 8.75 |
| 11 | ATL-MDL-0011 | multi-model-brain | MOCK_ONLY | 1 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0173 | 5.0 |
| 12 | ATL-MDL-0012 | provider-adapters | MOCK_ONLY | 38 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0174 | 5.0 |
| 13 | ATL-MDL-0013 | provider-egress | MOCK_ONLY | 8 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0175 | 5.0 |
| 14 | ATL-MDL-0014 | provider-resilience | MOCK_ONLY | 36 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0176 | 5.0 |
| 15 | ATL-MDL-0015 | AI-szolgáltató: openai (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0177 | 7.0 |
| 16 | ATL-MDL-0016 | AI-szolgáltató: anthropic (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0178 | 7.0 |
| 17 | ATL-MDL-0017 | AI-szolgáltató: google (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0179 | 7.0 |
| 18 | ATL-MDL-0018 | AI-szolgáltató: xai (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0180 | 7.0 |
| 19 | ATL-MDL-0019 | AI-szolgáltató: merlin (CLOUD) | MISSING | 0 | adapter hiányzik (a tulajdonos adja a valódi API-hostot/specifikációt) | tulajdonosi döntés a megvalósításról | ATL-WRK-0468 | 9.0 |
| 20 | ATL-MDL-0020 | AI-szolgáltató: deepseek (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0181 | 7.0 |
| 21 | ATL-MDL-0021 | AI-szolgáltató: mistral (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0182 | 7.0 |
| 22 | ATL-MDL-0022 | AI-szolgáltató: openrouter (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0183 | 7.0 |
| 23 | ATL-MDL-0023 | AI-szolgáltató: minimax (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0184 | 7.0 |
| 24 | ATL-MDL-0024 | AI-szolgáltató: glm (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0185 | 7.0 |
| 25 | ATL-MDL-0025 | AI-szolgáltató: perplexity (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0186 | 7.0 |
| 26 | ATL-MDL-0026 | AI-szolgáltató: huggingface (CLOUD) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0187 | 7.0 |
| 27 | ATL-MDL-0027 | AI-szolgáltató: ollama-local (LOCAL) | EXTERNAL_BLOCKER | 0 | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0188 | 7.0 |
| 28 | ATL-MDL-0028 | AI-szolgáltató: vercel-ai-gateway (CLOUD, modell-router) | EXTERNAL_BLOCKER | 0 |  |  | ATL-WRK-0494 | 7.0 |

## API-k (123)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 29 | ATL-API-0001 | atlasz-control-center/core.mjs | PARTIAL | 267 | 182 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, CONNECTED_UNTESTED:32, EXTERNAL_BLOCKER:25, MISSING:… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0027 | 24.0 |
| 30 | ATL-API-0002 | atlasz-control-center/server.mjs | PARTIAL | 95 | 56 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:26, PARTIAL:30) \| tervezett bővítések/kapcso… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0028 | 15.88 |
| 31 | ATL-API-0003 | GET /api/aurora/briefing | VERIFIED_WORKING | 4 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 32 | ATL-API-0004 | GET /api/aurora/voice | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 33 | ATL-API-0005 | GET /api/opportunity-pipeline | VERIFIED_WORKING | 11 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 34 | ATL-API-0006 | GET /api/security/network | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 35 | ATL-API-0007 | GET /api/status | VERIFIED_WORKING | 5 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 36 | ATL-API-0008 | GET /api/opportunities | VERIFIED_WORKING | 8 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 37 | ATL-API-0009 | GET /api/approvals | VERIFIED_WORKING | 10 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 38 | ATL-API-0010 | GET /api/backups | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 39 | ATL-API-0011 | GET /api/profit/daily | VERIFIED_WORKING | 24 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 40 | ATL-API-0012 | GET /api/finance/reconciliation | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 41 | ATL-API-0013 | GET /api/repos | VERIFIED_WORKING | 8 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 42 | ATL-API-0014 | GET /api/prototypes | VERIFIED_WORKING | 8 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 43 | ATL-API-0015 | GET /api/finance | VERIFIED_WORKING | 19 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 44 | ATL-API-0016 | GET /api/documents | VERIFIED_WORKING | 39 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 45 | ATL-API-0017 | GET /api/knowledge | VERIFIED_WORKING | 9 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 46 | ATL-API-0018 | GET /api/memory | VERIFIED_WORKING | 31 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 47 | ATL-API-0019 | GET /api/model-registry | VERIFIED_WORKING | 77 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 48 | ATL-API-0020 | GET /api/security | VERIFIED_WORKING | 6 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 49 | ATL-API-0021 | GET /api/agents30 | VERIFIED_WORKING | 40 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 50 | ATL-API-0022 | GET /api/vault | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 51 | ATL-API-0023 | GET /api/chat-providers | VERIFIED_WORKING | 34 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 52 | ATL-API-0024 | GET /api/trading | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 53 | ATL-API-0025 | GET /api/operations | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 54 | ATL-API-0026 | GET /api/agents/activity | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 55 | ATL-API-0027 | GET /api/revenue-dashboard | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 56 | ATL-API-0028 | GET /api/revenue-ops | VERIFIED_WORKING | 13 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 57 | ATL-API-0029 | GET /api/intake/status | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 58 | ATL-API-0030 | GET /api/agents/supervision | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 59 | ATL-API-0031 | GET /api/security/incidents | VERIFIED_WORKING | 4 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 60 | ATL-API-0032 | GET /api/trading/candles | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0371 | 3.0 |
| 61 | ATL-API-0033 | GET /api/research | VERIFIED_WORKING | 11 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 62 | ATL-API-0034 | GET /api/sandbox | VERIFIED_WORKING | 10 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 63 | ATL-API-0035 | GET /api/workbench | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 64 | ATL-API-0036 | GET /api/media | VERIFIED_WORKING | 6 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 65 | ATL-API-0037 | GET /api/observations | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 66 | ATL-API-0038 | GET /api/brain | VERIFIED_WORKING | 33 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 67 | ATL-API-0039 | GET /api/money-engine | VERIFIED_WORKING | 16 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 68 | ATL-API-0040 | GET /api/money-jobs | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 69 | ATL-API-0041 | GET /api/money-agents | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 70 | ATL-API-0042 | GET /api/money-recurring | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 71 | ATL-API-0043 | GET /api/crm-inbox | VERIFIED_WORKING | 6 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 72 | ATL-API-0044 | GET /api/owner-safety | VERIFIED_WORKING | 5 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 73 | ATL-API-0045 | GET /api/inbox | VERIFIED_WORKING | 10 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 74 | ATL-API-0046 | GET /api/voice | VERIFIED_WORKING | 8 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 75 | ATL-API-0047 | GET /api/connectors | VERIFIED_WORKING | 30 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 76 | ATL-API-0048 | GET /api/techwatch | VERIFIED_WORKING | 4 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 77 | ATL-API-0049 | GET /api/evidence | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 78 | ATL-API-0050 | GET /api/brief | VERIFIED_WORKING | 7 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 79 | ATL-API-0051 | GET /api/pcc | VERIFIED_WORKING | 9 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 80 | ATL-API-0052 | GET /api/prefs | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 81 | ATL-API-0053 | GET /api/plugins | VERIFIED_WORKING | 22 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 82 | ATL-API-0054 | GET /api/mcp | VERIFIED_WORKING | 5 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 83 | ATL-API-0055 | GET /api/theme | VERIFIED_WORKING | 13 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 84 | ATL-API-0056 | GET /api/doctor | VERIFIED_WORKING | 11 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 85 | ATL-API-0057 | GET /api/updates | VERIFIED_WORKING | 5 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 86 | ATL-API-0058 | POST /api/aurora/utterance | CONNECTED_UNTESTED | 9 | nincs ismert | tesztek írása | ATL-WRK-0372 | 3.0 |
| 87 | ATL-API-0059 | POST /api/aurora/voice/settings | CONNECTED_UNTESTED | 3 | nincs ismert | tesztek írása | ATL-WRK-0373 | 3.0 |
| 88 | ATL-API-0060 | POST /api/aurora/voice/evidence | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0374 | 3.0 |
| 89 | ATL-API-0061 | POST /api/owner-key | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 90 | ATL-API-0062 | POST /api/approvals/decide | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 91 | ATL-API-0063 | POST /api/emergency | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 92 | ATL-API-0064 | POST /api/safe-mode/exit | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 93 | ATL-API-0065 | POST /api/brain/command | VERIFIED_WORKING | 4 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 94 | ATL-API-0066 | POST /api/intake/file | CONNECTED_UNTESTED | 8 | nincs ismert | tesztek írása | ATL-WRK-0375 | 3.0 |
| 95 | ATL-API-0067 | POST /api/owner-safety/action | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 96 | ATL-API-0068 | POST /api/runtime/start | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 97 | ATL-API-0069 | POST /api/runtime/stop | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 98 | ATL-API-0070 | POST /api/proposal/draft | CONNECTED_UNTESTED | 5 | nincs ismert | tesztek írása | ATL-WRK-0376 | 3.0 |
| 99 | ATL-API-0071 | POST /api/profit/close-day | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0377 | 3.0 |
| 100 | ATL-API-0072 | POST /api/finance/webhook-receiver/start | CONNECTED_UNTESTED | 11 | nincs ismert | tesztek írása | ATL-WRK-0378 | 3.0 |
| 101 | ATL-API-0073 | POST /api/finance/webhook-receiver/stop | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0379 | 3.0 |
| 102 | ATL-API-0074 | POST /api/finance/attest-costs | CONNECTED_UNTESTED | 4 | nincs ismert | tesztek írása | ATL-WRK-0380 | 3.0 |
| 103 | ATL-API-0075 | POST /api/finance/revoke-attestation | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0381 | 3.0 |
| 104 | ATL-API-0076 | POST /api/finance/fx-rate | CONNECTED_UNTESTED | 2 | nincs ismert | tesztek írása | ATL-WRK-0382 | 3.0 |
| 105 | ATL-API-0077 | POST /api/finance/attach-fee | CONNECTED_UNTESTED | 1 | nincs ismert | tesztek írása | ATL-WRK-0383 | 3.0 |
| 106 | ATL-API-0078 | POST /api/finance/assess | CONNECTED_UNTESTED | 1 | nincs ismert | tesztek írása | ATL-WRK-0384 | 3.0 |
| 107 | ATL-API-0079 | POST /api/contract/review | CONNECTED_UNTESTED | 3 | nincs ismert | tesztek írása | ATL-WRK-0385 | 3.0 |
| 108 | ATL-API-0080 | POST /api/invoice/prepare | CONNECTED_UNTESTED | 5 | nincs ismert | tesztek írása | ATL-WRK-0386 | 3.0 |
| 109 | ATL-API-0081 | POST /api/backup | CONNECTED_UNTESTED | 6 | nincs ismert | tesztek írása | ATL-WRK-0387 | 3.0 |
| 110 | ATL-API-0082 | POST /api/backup/drill | VERIFIED_WORKING | 4 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 111 | ATL-API-0083 | POST /api/backup/mark-lkg | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 112 | ATL-API-0084 | POST /api/restore/lkg | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 113 | ATL-API-0085 | POST /api/restore/backup | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 114 | ATL-API-0086 | POST /api/updates/check | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 115 | ATL-API-0087 | POST /api/updates/test | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 116 | ATL-API-0088 | POST /api/updates/install | PARTIAL | 0 | D-02 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0002 | 1.67 |
| 117 | ATL-API-0089 | POST /api/chat | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 118 | ATL-API-0090 | POST /api/pcc/action | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 119 | ATL-API-0091 | POST /api/knowledge/action | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 120 | ATL-API-0092 | POST /api/memory/action | CONNECTED_UNTESTED | 27 | nincs ismert | tesztek írása | ATL-WRK-0388 | 3.0 |
| 121 | ATL-API-0093 | POST /api/model-registry/action | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0389 | 3.0 |
| 122 | ATL-API-0094 | POST /api/security/action | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0390 | 3.0 |
| 123 | ATL-API-0095 | POST /api/agents30/action | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0391 | 3.0 |
| 124 | ATL-API-0096 | POST /api/vault/action | CONNECTED_UNTESTED | 2 | nincs ismert | tesztek írása | ATL-WRK-0392 | 3.0 |
| 125 | ATL-API-0097 | POST /api/chat-providers/action | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0393 | 3.0 |
| 126 | ATL-API-0098 | POST /api/trading/action | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0394 | 3.0 |
| 127 | ATL-API-0099 | POST /api/research/action | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 128 | ATL-API-0100 | POST /api/sandbox/run | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 129 | ATL-API-0101 | POST /api/workbench/action | CONNECTED_UNTESTED | 10 | nincs ismert | tesztek írása | ATL-WRK-0395 | 3.0 |
| 130 | ATL-API-0102 | POST /api/a11y/audit | CONNECTED_UNTESTED | 4 | nincs ismert | tesztek írása | ATL-WRK-0396 | 3.0 |
| 131 | ATL-API-0103 | POST /api/voice/action | VERIFIED_WORKING | 4 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 132 | ATL-API-0104 | POST /api/observations/action | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 133 | ATL-API-0105 | POST /api/prefs | VERIFIED_WORKING | 3 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 134 | ATL-API-0106 | POST /api/plugins/enable | PARTIAL | 1 | D-02 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0002 | 1.67 |
| 135 | ATL-API-0107 | POST /api/repos/analyze | CONNECTED_UNTESTED | 2 | nincs ismert | tesztek írása | ATL-WRK-0397 | 3.0 |
| 136 | ATL-API-0108 | POST /api/repos/test | CONNECTED_UNTESTED | 2 | nincs ismert | tesztek írása | ATL-WRK-0398 | 3.0 |
| 137 | ATL-API-0109 | POST /api/prototypes/action | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0399 | 3.0 |
| 138 | ATL-API-0110 | POST /api/mcp/start | CONNECTED_UNTESTED | 2 | nincs ismert | tesztek írása | ATL-WRK-0400 | 3.0 |
| 139 | ATL-API-0111 | POST /api/mcp/call | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0401 | 3.0 |
| 140 | ATL-API-0112 | POST /api/mcp/stop | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0402 | 3.0 |
| 141 | ATL-API-0113 | POST /api/plugins/invoke | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0403 | 3.0 |
| 142 | ATL-API-0114 | POST /api/plugins/install | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0404 | 3.0 |
| 143 | ATL-API-0115 | POST /api/plugins/rollback | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0405 | 3.0 |
| 144 | ATL-API-0116 | POST /api/plugins/uninstall | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0406 | 3.0 |
| 145 | ATL-API-0117 | POST /api/plugins/disable | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 146 | ATL-API-0118 | POST /api/plugins/theme | VERIFIED_WORKING | 11 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 147 | ATL-API-0119 | POST /api/plugins/reset | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 148 | ATL-API-0120 | POST /api/updates/rollback | VERIFIED_WORKING | 1 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 149 | ATL-API-0121 | POST /api/updates/auto | CONNECTED_UNTESTED | 0 | nincs ismert | tesztek írása | ATL-WRK-0407 | 3.0 |
| 150 | ATL-API-0122 | POST /api/updates/unfreeze | VERIFIED_WORKING | 0 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 151 | ATL-API-0123 | GET /api/live | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |

## AURÓRA (5)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 152 | ATL-AUR-0001 | assistant-profiles | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-0002 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0029 | 3.23 |
| 153 | ATL-AUR-0002 | aurora | PARTIAL | 112 | 68 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:9, PARTIAL:59) \| tervezett bővítések/kapcsol… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0030 | 18.64 |
| 154 | ATL-AUR-0003 | human-core | PARTIAL | 77 | 57 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MISSING:3, PARTIAL:53) \| tervezett bővítése… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0031 | 16.11 |
| 155 | ATL-AUR-0004 | personal-command-center | PARTIAL | 10 | 4 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:3) \| tervezett bővítések/kapcsolatok: ATL-PLN-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0005; ATL-WRK-0032 | 9.92 |
| 156 | ATL-AUR-0005 | preferences | PARTIAL | 12 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) \| tervezett bővítések/kapcsolatok: ATL-PLN-0002; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0033 | 5.53 |

## Beszéd és hang (3)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 157 | ATL-VOI-0001 | voice-conversation | MOCK_ONLY | 27 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0007; ATL-WRK-0311 | 7.0 |
| 158 | ATL-VOI-0002 | voice-interface | MOCK_ONLY | 4 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0312 | 5.0 |
| 159 | ATL-VOI-0003 | voice-session | MOCK_ONLY | 41 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0313 | 5.0 |

## Biztonsági rendszerek (51)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 160 | ATL-SEC-0001 | agent-tool-policy-ext | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 161 | ATL-SEC-0002 | agent-tool-policy | PARTIAL | 12 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0265 | 3.92 |
| 162 | ATL-SEC-0003 | anti-collusion-guard | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0266 | 4.15 |
| 163 | ATL-SEC-0004 | approval-command-gateway | PARTIAL | 6 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-0065; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0267 | 3.23 |
| 164 | ATL-SEC-0005 | approval-requests | PARTIAL | 9 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-PLN-0071 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0268 | 3.92 |
| 165 | ATL-SEC-0006 | audit-chain | PARTIAL | 28 | 11 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:10) \| tervezett bővítések/kapcsolatok: ATL-PL… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0269 | 5.53 |
| 166 | ATL-SEC-0007 | brain/behavior-monitor | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0270 | 3.92 |
| 167 | ATL-SEC-0008 | brain/security-brain | PARTIAL | 18 | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) \| tervezett bővítések/kapcsolatok: ATL-PLN-0074 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0271 | 5.07 |
| 168 | ATL-SEC-0009 | code-sandbox | PARTIAL | 23 | 22 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:22) \| tervezett bővítések/kapcsolatok: ATL-PLN-0041; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0272 | 8.06 |
| 169 | ATL-SEC-0010 | credential-broker | PARTIAL | 18 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) \| tervezett bővítések/kapcsolatok: ATL-PLN-0022; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0273 | 5.3 |
| 170 | ATL-SEC-0011 | egress-policy | PARTIAL | 13 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) \| tervezett bővítések/kapcsolatok: ATL-PLN-0014; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0274 | 5.53 |
| 171 | ATL-SEC-0012 | emergency-stop | PARTIAL | 14 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0275 | 3.69 |
| 172 | ATL-SEC-0013 | enterprise-control-plane | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 173 | ATL-SEC-0014 | evidence-record | PARTIAL | 7 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0276 | 3.92 |
| 174 | ATL-SEC-0015 | execution-boundary | PARTIAL | 8 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0277 | 3.92 |
| 175 | ATL-SEC-0016 | file-intake | PARTIAL | 16 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) \| tervezett bővítések/kapcsolatok: ATL-PLN-0050; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0009; ATL-WRK-0278 | 9.8 |
| 176 | ATL-SEC-0017 | guardrail-engine | PARTIAL | 2 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0279 | 3.23 |
| 177 | ATL-SEC-0018 | history-scan-patterns | STRUCTURAL_ONLY | 0 | nincs teszt-hivatkozás és nincs bekötés \| tervezett bővítések/kapcsolatok: ATL-PLN-0050 | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0280 | 5.0 |
| 178 | ATL-SEC-0019 | incident-response | PARTIAL | 14 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) \| tervezett bővítések/kapcsolatok: ATL-PLN-0011 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0281 | 5.53 |
| 179 | ATL-SEC-0020 | malware-scanner | MOCK_ONLY | 7 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0282 | 5.0 |
| 180 | ATL-SEC-0021 | network-supervisor | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0048 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0283 | 4.61 |
| 181 | ATL-SEC-0022 | owner-auth | PARTIAL | 17 | 8 kapcsolt követelmény nem VERIFIED_WORKING (OWNER_APPROVAL_REQUIRED:1, PARTIAL:7) \| tervezett bővítések/kapc… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0284 | 4.84 |
| 182 | ATL-SEC-0023 | owner-control/agent-governor | PARTIAL | 10 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0285 | 3.92 |
| 183 | ATL-SEC-0024 | owner-control/approval-gateway | VERIFIED_WORKING | 1 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 184 | ATL-SEC-0025 | owner-control/claim-distinctions | PARTIAL | 2 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0286 | 3.23 |
| 185 | ATL-SEC-0026 | owner-control/control-chain | PARTIAL | 11 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0287 | 3.69 |
| 186 | ATL-SEC-0027 | owner-control/owner-authority | PARTIAL | 14 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0288 | 3.92 |
| 187 | ATL-SEC-0028 | owner-control/owner-control-system | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 188 | ATL-SEC-0029 | owner-keystore | PARTIAL | 7 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) \| tervezett bővítések/kapcsolatok: ATL-PLN-0093 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0289 | 4.38 |
| 189 | ATL-SEC-0030 | probe-evidence | PARTIAL | 10 | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) \| tervezett bővítések/kapcsolatok: ATL-PLN-0091 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0290 | 5.07 |
| 190 | ATL-SEC-0031 | process-gate | PARTIAL | 10 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0291 | 4.84 |
| 191 | ATL-SEC-0032 | quarantine | PARTIAL | 24 | 18 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:18) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0009; ATL-WRK-0292 | 11.64 |
| 192 | ATL-SEC-0033 | release-signing | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0045; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0293 | 4.61 |
| 193 | ATL-SEC-0034 | restricted-node | PARTIAL | 23 | 15 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:15) \| tervezett bővítések/kapcsolatok: ATL-PLN-0019; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0294 | 6.45 |
| 194 | ATL-SEC-0035 | safe-keys | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 195 | ATL-SEC-0036 | secret-patterns | PARTIAL | 7 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0050 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0295 | 3.46 |
| 196 | ATL-SEC-0037 | secret-vault | PARTIAL | 26 | 13 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, PARTIAL:12) \| tervezett bővítések/kapcsol… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0012; ATL-WRK-0296 | 11.66 |
| 197 | ATL-SEC-0038 | security-gates | PARTIAL | 9 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0297 | 3.92 |
| 198 | ATL-SEC-0039 | tenant-isolation | PARTIAL | 35 | 25 kapcsolt követelmény nem VERIFIED_WORKING (OWNER_APPROVAL_REQUIRED:1, PARTIAL:22, STRUCTURAL_ONLY:2) \| ter… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0298 | 8.75 |
| 199 | ATL-SEC-0040 | Biztonsági kapu G01: secrets never reach agents | PARTIAL | 0 |  |  |  | 0.0 |
| 200 | ATL-SEC-0041 | Biztonsági kapu G02: deny-by-default tool policy | PARTIAL | 0 |  |  |  | 0.0 |
| 201 | ATL-SEC-0042 | Biztonsági kapu G03: kill switch blocks everything | PARTIAL | 0 |  |  |  | 0.0 |
| 202 | ATL-SEC-0043 | Biztonsági kapu G04: approvals single-use | PARTIAL | 0 |  |  |  | 0.0 |
| 203 | ATL-SEC-0044 | Biztonsági kapu G05: audit chain tamper detected | PARTIAL | 0 |  |  |  | 0.0 |
| 204 | ATL-SEC-0045 | Biztonsági kapu G06: egress deny-by-default | PARTIAL | 0 |  |  |  | 0.0 |
| 205 | ATL-SEC-0046 | Biztonsági kapu G07: quarantine never executes | PARTIAL | 0 |  |  |  | 0.0 |
| 206 | ATL-SEC-0047 | Biztonsági kapu G08: memory classification isolation | PARTIAL | 0 |  |  |  | 0.0 |
| 207 | ATL-SEC-0048 | Biztonsági kapu G09: unsigned update refused | PARTIAL | 0 |  |  |  | 0.0 |
| 208 | ATL-SEC-0049 | Biztonsági kapu G10: simulated money never revenue | PARTIAL | 0 |  |  |  | 0.0 |
| 209 | ATL-SEC-0050 | Biztonsági kapu G11: exactly 30 agents | PARTIAL | 0 |  |  |  | 0.0 |
| 210 | ATL-SEC-0051 | Biztonsági kapu G12: bind address stays loopback | PARTIAL | 0 |  |  |  | 0.0 |

## Connectorok / integrációk (44)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 211 | ATL-INT-0001 | browser-extension-guard | MOCK_ONLY | 7 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0116 | 5.0 |
| 212 | ATL-INT-0002 | chat-providers | MOCK_ONLY | 41 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0117 | 5.0 |
| 213 | ATL-INT-0003 | computer-use-fabric | MOCK_ONLY | 31 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0118 | 5.0 |
| 214 | ATL-INT-0004 | connector-catalog | MOCK_ONLY | 47 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0119 | 5.0 |
| 215 | ATL-INT-0005 | mcp-client | MOCK_ONLY | 8 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0120 | 5.0 |
| 216 | ATL-INT-0006 | page-ingest | MOCK_ONLY | 14 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0121 | 5.0 |
| 217 | ATL-INT-0007 | payment-package-intake | MOCK_ONLY | 17 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0122 | 5.0 |
| 218 | ATL-INT-0008 | source-adapters | MOCK_ONLY | 7 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0123 | 5.0 |
| 219 | ATL-INT-0009 | tool-bridge | MOCK_ONLY | 6 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0124 | 5.0 |
| 220 | ATL-INT-0010 | universal-connector-layer | MOCK_ONLY | 3 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0125 | 5.0 |
| 221 | ATL-INT-0011 | browser-extension/background.js | STRUCTURAL_ONLY | 3 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0126 | 5.0 |
| 222 | ATL-INT-0012 | browser-extension/content-script.js | STRUCTURAL_ONLY | 0 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0127 | 5.0 |
| 223 | ATL-INT-0013 | browser-extension/lib/request.js | PARTIAL | 0 | tesztelt, de a futó rendszerből nem érhető el | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0128 | 3.0 |
| 224 | ATL-INT-0014 | browser-extension/sidepanel.css | STRUCTURAL_ONLY | 0 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0129 | 5.0 |
| 225 | ATL-INT-0015 | browser-extension/sidepanel.html | STRUCTURAL_ONLY | 0 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0130 | 5.0 |
| 226 | ATL-INT-0016 | browser-extension/sidepanel.js | STRUCTURAL_ONLY | 0 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0131 | 5.0 |
| 227 | ATL-INT-0017 | Connector: Airtable | EXTERNAL_BLOCKER | 2 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0132 | 7.0 |
| 228 | ATL-INT-0018 | Connector: Google Calendar | EXTERNAL_BLOCKER | 2 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0133 | 7.0 |
| 229 | ATL-INT-0019 | Connector: Google Drive | EXTERNAL_BLOCKER | 2 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0134 | 7.0 |
| 230 | ATL-INT-0020 | Stripe (fizetési processzor, receive-only webhook) | EXTERNAL_BLOCKER | 46 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0135 | 7.0 |
| 231 | ATL-INT-0021 | KOHO (banki egyeztetés, csak kézi/csomag-átvétel) | EXTERNAL_BLOCKER | 15 | nincs KOHO-integráció (csak kézi csomag-átvétel); bank-adat a tulajdonostól | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0136 | 7.0 |
| 232 | ATL-INT-0022 | SEARCH forrás: hn.algolia.com (runtime kérés) | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0011; ATL-WRK-0137 | 10.0 |
| 233 | ATL-INT-0023 | MCP stdio szerverek (külső folyamat) | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0138 | 7.0 |
| 234 | ATL-INT-0024 | Chat platform: WhatsApp Business | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0139 | 7.0 |
| 235 | ATL-INT-0025 | Chat platform: Telegram | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0140 | 7.0 |
| 236 | ATL-INT-0026 | Chat platform: Slack | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0141 | 7.0 |
| 237 | ATL-INT-0027 | Chat platform: Discord | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0142 | 7.0 |
| 238 | ATL-INT-0028 | Chat platform: Microsoft Teams | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0143 | 7.0 |
| 239 | ATL-INT-0029 | Chat platform: Google Chat | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0144 | 7.0 |
| 240 | ATL-INT-0030 | Chat platform: Signal | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0145 | 7.0 |
| 241 | ATL-INT-0031 | Chat platform: Facebook Messenger | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0146 | 7.0 |
| 242 | ATL-INT-0032 | Chat platform: Instagram DMs | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0147 | 7.0 |
| 243 | ATL-INT-0033 | Chat platform: LINE | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0148 | 7.0 |
| 244 | ATL-INT-0034 | Chat platform: Viber | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0149 | 7.0 |
| 245 | ATL-INT-0035 | Chat platform: WeChat | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0150 | 7.0 |
| 246 | ATL-INT-0036 | Chat platform: SMS via a gateway | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0151 | 7.0 |
| 247 | ATL-INT-0037 | Chat platform: Email | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0152 | 7.0 |
| 248 | ATL-INT-0038 | Chat platform: Matrix | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0153 | 7.0 |
| 249 | ATL-INT-0039 | Chat platform: Apple Messages / iMessage | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0154 | 7.0 |
| 250 | ATL-INT-0040 | Chat platform: Nextcloud Talk | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0155 | 7.0 |
| 251 | ATL-INT-0041 | Chat platform: Nostr | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0156 | 7.0 |
| 252 | ATL-INT-0042 | Chat platform: Tor Messenger | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0157 | 7.0 |
| 253 | ATL-INT-0043 | Chat platform: Zalo (Official Account) | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0158 | 7.0 |
| 254 | ATL-INT-0044 | Chat platform: Zalo Personal | EXTERNAL_BLOCKER | 0 | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0159 | 7.0 |

## Dokumentum és kommunikáció (8)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 255 | ATL-DOC-0001 | doc-extractors | PARTIAL | 45 | 40 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:38, STRUCTURAL_ONLY:1) \| tervezett … | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0083 | 12.2 |
| 256 | ATL-DOC-0002 | doc-sync | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0084 | 3.69 |
| 257 | ATL-DOC-0003 | document-center | PARTIAL | 61 | 51 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:51) \| tervezett bővítések/kapcsolatok: ATL-PLN-0017; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0085 | 14.73 |
| 258 | ATL-DOC-0004 | form-assistant | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0086 | 3.92 |
| 259 | ATL-DOC-0005 | social-drafts | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0087 | 3.69 |
| 260 | ATL-DOC-0006 | transcript-actions | PARTIAL | 6 | 6 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0088 | 4.38 |
| 261 | ATL-DOC-0007 | translation-feedback | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MOCK_ONLY:1, PARTIAL:3, STRUCTURAL_ONLY:1) \|… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0089 | 4.61 |
| 262 | ATL-DOC-0008 | universal-inbox | PARTIAL | 22 | 18 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:3, PARTIAL:15) \| tervezett bővítések/kapcsolat… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0090 | 7.14 |

## Fejlesztő-asszisztens (8)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 263 | ATL-DEV-0001 | alt-solution-harness | PARTIAL | 2 | tesztelt, de a futó rendszerből nem érhető el; 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| terv… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0076 | 3.46 |
| 264 | ATL-DEV-0002 | architecture-assessor | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0077 | 3.69 |
| 265 | ATL-DEV-0003 | code-edit-workflow | PARTIAL | 9 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) \| tervezett bővítések/kapcsolatok: ATL-PLN-0067; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0078 | 4.38 |
| 266 | ATL-DEV-0004 | code-review | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0095 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0079 | 4.61 |
| 267 | ATL-DEV-0005 | dev-assist-common | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 268 | ATL-DEV-0006 | prototype-builder | PARTIAL | 8 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0067 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0080 | 4.61 |
| 269 | ATL-DEV-0007 | repo-analyzer | PARTIAL | 13 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) \| tervezett bővítések/kapcsolatok: ATL-PLN-0095 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0081 | 5.53 |
| 270 | ATL-DEV-0008 | test-intelligence | PARTIAL | 9 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) \| tervezett bővítések/kapcsolatok: ATL-PLN-0095; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0082 | 4.84 |

## Felület (75)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 271 | ATL-UIX-0001 | atlasz-control-center/agents-panel.mjs | PARTIAL | 14 | 9 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:4, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0299 | 5.07 |
| 272 | ATL-UIX-0002 | atlasz-control-center/brain-views.mjs | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0300 | 3.23 |
| 273 | ATL-UIX-0003 | atlasz-control-center/chat-providers-panel.mjs | PARTIAL | 35 | 34 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:34) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0301 | 10.82 |
| 274 | ATL-UIX-0004 | atlasz-control-center/memory-panel.mjs | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:2, PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0302 | 3.92 |
| 275 | ATL-UIX-0005 | atlasz-control-center/model-registry-panel.mjs | PARTIAL | 52 | 39 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, EXTERNAL_BLOCKER:17, MOCK_ONLY:2, PARTIAL… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0303 | 11.97 |
| 276 | ATL-UIX-0006 | atlasz-control-center/money-views.mjs | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0304 | 3.46 |
| 277 | ATL-UIX-0007 | atlasz-control-center/ops-views.mjs | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:3, PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0305 | 4.15 |
| 278 | ATL-UIX-0008 | atlasz-control-center/public/app.js | PARTIAL | 237 | tesztelt, de a futó rendszerből nem érhető el; 160 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:2, CONNE… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0001; ATL-WRK-0002; ATL-WRK-000… | 30.17 |
| 279 | ATL-UIX-0009 | atlasz-control-center/public/index.html | STRUCTURAL_ONLY | 2 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0307 | 5.0 |
| 280 | ATL-UIX-0010 | atlasz-control-center/public/style.css | STRUCTURAL_ONLY | 18 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0308 | 5.0 |
| 281 | ATL-UIX-0011 | atlasz-control-center/revenue-ops.mjs | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 282 | ATL-UIX-0012 | atlasz-control-center/security-center-panel.mjs | PARTIAL | 7 | 5 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:2, PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0309 | 4.15 |
| 283 | ATL-UIX-0013 | atlasz-control-center/trading-panel.mjs | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 284 | ATL-UIX-0014 | atlasz-control-center/vault-panel.mjs | PARTIAL | 7 | 5 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0310 | 4.15 |
| 285 | ATL-UIX-0015 | Nézet: Daily Profit Target (profit) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 286 | ATL-UIX-0016 | Nézet: Opportunity Pipeline (pipeline) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 287 | ATL-UIX-0017 | Nézet: Operations Dashboard (ops) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 288 | ATL-UIX-0018 | Nézet: Live Agent Activity (activity) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 289 | ATL-UIX-0019 | Nézet: Trading & Crypto (simulated) (trading) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 290 | ATL-UIX-0020 | Nézet: Revenue & Business (business) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 291 | ATL-UIX-0021 | Nézet: Revenue Operations (revenueops) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 292 | ATL-UIX-0022 | Nézet: AURÓRA (aurora) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 293 | ATL-UIX-0023 | Nézet: Security & Supervision (supervision) | BROKEN | 0 | a nézet összeomlik | hibajavítás (tulajdonosi döntés után) | ATL-WRK-0001 | 2.5 |
| 294 | ATL-UIX-0024 | Nézet: Home (home) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 295 | ATL-UIX-0025 | Nézet: Accessibility audit (a11y) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 296 | ATL-UIX-0026 | Nézet: Tasks / Reminders (pcc) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 297 | ATL-UIX-0027 | Nézet: Observation Memory (observations) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 298 | ATL-UIX-0028 | Nézet: Multimodal (media) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 299 | ATL-UIX-0029 | Nézet: Code Sandbox (sandbox) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 300 | ATL-UIX-0030 | Nézet: Workbench (workbench) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 301 | ATL-UIX-0031 | Nézet: Projects & Workflows (projects) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 302 | ATL-UIX-0032 | Nézet: Research Ledger (research) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 303 | ATL-UIX-0033 | Nézet: Knowledge Projects (knowledge) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 304 | ATL-UIX-0034 | Nézet: Memory (memory) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 305 | ATL-UIX-0035 | Nézet: Models & Providers (modelreg) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 306 | ATL-UIX-0036 | Nézet: Security Center (security) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 307 | ATL-UIX-0037 | Nézet: 30 Agents (workforce) (agents30) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 308 | ATL-UIX-0038 | Nézet: API Key Vault (vault) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 309 | ATL-UIX-0039 | Nézet: Chat Providers (chatproviders) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 310 | ATL-UIX-0040 | Nézet: OWNER SAFETY / CONTROL (owner_safety) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 311 | ATL-UIX-0041 | Nézet: Overview (overview) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 312 | ATL-UIX-0042 | Nézet: Plugins / Themes (plugins) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 313 | ATL-UIX-0043 | Nézet: Revenue / Costs / Profit (finance) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 314 | ATL-UIX-0044 | Nézet: Evidence / Audit (evidence) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 315 | ATL-UIX-0045 | Nézet: Agents (5+25) (agents) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 316 | ATL-UIX-0046 | Nézet: Jobs / Opportunities (jobs) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 317 | ATL-UIX-0047 | Nézet: Money Engine (money) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 318 | ATL-UIX-0048 | Nézet: CRM / Graph / Inbox (crm_inbox) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 319 | ATL-UIX-0049 | Nézet: Approvals (approvals) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 320 | ATL-UIX-0050 | Nézet: Model / Tool health (providers) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 321 | ATL-UIX-0051 | Nézet: Errors & Blockers (errors) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 322 | ATL-UIX-0052 | Nézet: Owner Controls (owner) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 323 | ATL-UIX-0053 | Nézet: Backup / Restore / LKG (backup) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 324 | ATL-UIX-0054 | Nézet: System Doctor (doctor) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 325 | ATL-UIX-0055 | Nézet: Update Center (updates) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 326 | ATL-UIX-0056 | Nézet: Voice (voice) | PARTIAL | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0007 | 2.0 |
| 327 | ATL-UIX-0057 | Nézet: Documents (documents) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 328 | ATL-UIX-0058 | Nézet: Inbox (inbox) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 329 | ATL-UIX-0059 | Nézet: Connectors (connectors) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 330 | ATL-UIX-0060 | Nézet: Tech Watch (techwatch) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 331 | ATL-UIX-0061 | Nézet: Brain · Status (brain_status) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 332 | ATL-UIX-0062 | Nézet: Brain · Orchestrator (brain_orchestrator) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 333 | ATL-UIX-0063 | Nézet: Brain · Planning (brain_planning) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 334 | ATL-UIX-0064 | Nézet: Brain · Capability Graph (brain_capabilities) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 335 | ATL-UIX-0065 | Nézet: Brain · Knowledge (brain_knowledge) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 336 | ATL-UIX-0066 | Nézet: Brain · Simulation (brain_simulation) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 337 | ATL-UIX-0067 | Nézet: Brain · Verification (brain_verification) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 338 | ATL-UIX-0068 | Nézet: Brain · Security (brain_security) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 339 | ATL-UIX-0069 | Nézet: Brain · Opportunities (brain_opportunities) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 340 | ATL-UIX-0070 | Nézet: Brain · Business Factory (brain_factory) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 341 | ATL-UIX-0071 | Nézet: Brain · Black Box (brain_blackbox) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 342 | ATL-UIX-0072 | Nézet: Brain · Recovery (brain_recovery) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 343 | ATL-UIX-0073 | Nézet: Brain · Behavior Anomalies (brain_behavior) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 344 | ATL-UIX-0074 | Nézet: Brain · Health (brain_health) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 345 | ATL-UIX-0075 | Nézet: Owner Command (brain_command) | VERIFIED_WORKING | 0 | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban | nincs (megtartani, regressziós gate-ben) |  | 0.0 |

## Felület / avatár / multimodális (5)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 346 | ATL-AVA-0001 | a11y-audit | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-PLN-0066 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0034 | 4.15 |
| 347 | ATL-AVA-0002 | a11y-worker | STRUCTURAL_ONLY | 0 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0035 | 5.0 |
| 348 | ATL-AVA-0003 | detail-level | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0003 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0036 | 3.46 |
| 349 | ATL-AVA-0004 | modality-fabric | PARTIAL | 42 | 30 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:9, MISSING:3, PARTIAL:12, STRUCTURAL_ONLY:6) \|… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0037 | 9.9 |
| 350 | ATL-AVA-0005 | render | PARTIAL | 10 | 10 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:9) \| tervezett bővítések/kapcsolato… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0038 | 5.3 |

## Háttérfolyamatok és automatizálások (16)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 351 | ATL-SCH-0001 | health-monitor | PARTIAL | 18 | 13 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:12) \| tervezett bővítések/kapcsolatok: ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0261 | 5.99 |
| 352 | ATL-SCH-0002 | scheduler | PARTIAL | 24 | 16 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:2, CONNECTED_UNTESTED:1, PARTIAL:13) \| tervezett bővítés… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0262 | 6.68 |
| 353 | ATL-SCH-0003 | tick-loop | PARTIAL | 10 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0263 | 4.38 |
| 354 | ATL-SCH-0004 | watchdog | PARTIAL | 8 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) \| tervezett bővítések/kapcsolatok: ATL-PLN-0052 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0264 | 4.38 |
| 355 | ATL-SCH-0005 | Master felügyeleti tick (tick-loop + watchdog) | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0470 | 4.5 |
| 356 | ATL-SCH-0006 | Tartós ütemező (C12) | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0471 | 4.5 |
| 357 | ATL-SCH-0007 | Napi felderítési ütemező (discoveryScheduler) | BROKEN | 0 | D-08: a tick() hívója nincs a futó rendszerben, nem fut magától | hibajavítás (tulajdonosi döntés után) | ATL-WRK-0008 | 2.0 |
| 358 | ATL-SCH-0008 | Egészség-monitor, kör-megszakítók | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0472 | 4.5 |
| 359 | ATL-SCH-0009 | Watchdog (szívverés / lefagyás-észlelés) | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0473 | 4.5 |
| 360 | ATL-SCH-0010 | Runtime supervisor (OS-folyamatok, SEARCH worker-ek) | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0474 | 4.5 |
| 361 | ATL-SCH-0011 | Fizetési webhook vevő (nem auto-indul) | PARTIAL | 0 | szándékosan nem auto-indul; élő Stripe nincs | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0475 | 4.5 |
| 362 | ATL-SCH-0012 | Safe Mode + crash-loop védelem | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0476 | 4.5 |
| 363 | ATL-SCH-0013 | Indítási önellenőrzés | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0477 | 4.5 |
| 364 | ATL-SCH-0014 | Korlátos önjavító hurok | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0478 | 4.5 |
| 365 | ATL-SCH-0015 | Mentés / visszaállítási próba | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0479 | 4.5 |
| 366 | ATL-SCH-0016 | Ransomware kanári-monitor | PARTIAL | 0 | folyamat-szintű hosszú távú futás nem bizonyított | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0480 | 4.5 |

## MASTER BRAIN (45)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 367 | ATL-BRN-0001 | brain-master-bridge | PARTIAL | 3 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0039 | 3.46 |
| 368 | ATL-BRN-0002 | brain/brain-system | VERIFIED_WORKING | 13 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 369 | ATL-BRN-0003 | brain/business-factory | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0013 | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 370 | ATL-BRN-0004 | brain/capability-graph | PARTIAL | 20 | 15 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:15) \| tervezett bővítések/kapcsolatok: ATL-PLN-0075 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0040 | 6.45 |
| 371 | ATL-BRN-0005 | brain/central-brain | PARTIAL | 11 | 5 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0012; ATL-WRK-0041 | 9.82 |
| 372 | ATL-BRN-0006 | brain/evidence-sources | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0042 | 3.23 |
| 373 | ATL-BRN-0007 | brain/governance | PARTIAL | 4 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0043 | 3.46 |
| 374 | ATL-BRN-0008 | brain/governed-dispatch | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0044 | 4.61 |
| 375 | ATL-BRN-0009 | brain/model-intelligence | PARTIAL | 20 | 19 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:1, PARTIAL:17) \| tervezett bővíté… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0045 | 7.37 |
| 376 | ATL-BRN-0010 | brain/opportunity-intelligence | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0012 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0046 | 3.46 |
| 377 | ATL-BRN-0011 | brain/orchestrator | PARTIAL | 20 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0047 | 5.3 |
| 378 | ATL-BRN-0012 | brain/owner-command | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3, STRUCTURAL_ONLY:1) \| tervezett bővítések/kapcsolatok:… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0048 | 3.92 |
| 379 | ATL-BRN-0013 | brain/planning-brain | PARTIAL | 24 | 17 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:17) \| tervezett bővítések/kapcsolatok: ATL-PLN-0011 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0049 | 6.91 |
| 380 | ATL-BRN-0014 | brain/search-pipeline | PARTIAL | 7 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0050 | 4.38 |
| 381 | ATL-BRN-0015 | brain/simulation-lab | PARTIAL | 11 | 7 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:6) \| tervezett bővítések/kapcsolatok: ATL-PLN… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0051 | 4.61 |
| 382 | ATL-BRN-0016 | brain/verifier | PARTIAL | 18 | 13 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:12) \| tervezett bővítések/kapcsolatok: ATL… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0052 | 5.99 |
| 383 | ATL-BRN-0017 | campaign-manager | PARTIAL | 8 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6, STRUCTURAL_ONLY:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0053 | 4.84 |
| 384 | ATL-BRN-0018 | debate-protocol | PARTIAL | 6 | 6 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0054 | 4.38 |
| 385 | ATL-BRN-0019 | decision-analysis | PARTIAL | 6 | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0055 | 4.15 |
| 386 | ATL-BRN-0020 | digital-twin | PARTIAL | 14 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0056 | 4.84 |
| 387 | ATL-BRN-0021 | general-intelligence-extensions | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0057 | 3.46 |
| 388 | ATL-BRN-0022 | goal-planner | PARTIAL | 14 | 14 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:13) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0058 | 6.22 |
| 389 | ATL-BRN-0023 | internal-integration-hub | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-0094 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0059 | 3.23 |
| 390 | ATL-BRN-0024 | master-brief | PARTIAL | 18 | 12 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:12) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0060 | 5.76 |
| 391 | ATL-BRN-0025 | master-coordinator | PARTIAL | 23 | 13 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:12) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0004; ATL-WRK-0061 | 11.99 |
| 392 | ATL-BRN-0026 | master-planner-orchestrator | PARTIAL | 14 | 13 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:13) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0062 | 5.99 |
| 393 | ATL-BRN-0027 | module-broker | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0063 | 3.92 |
| 394 | ATL-BRN-0028 | multi-solution | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0064 | 3.92 |
| 395 | ATL-BRN-0029 | outcome-compiler | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0065 | 3.23 |
| 396 | ATL-BRN-0030 | progress-ledger | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0066 | 3.92 |
| 397 | ATL-BRN-0031 | reasoning-common | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0067 | 3.23 |
| 398 | ATL-BRN-0032 | registrations/_util | CONNECTED_UNTESTED | 0 | be van kötve, de nincs közvetlen teszt | tesztek írása | ATL-WRK-0068 | 4.5 |
| 399 | ATL-BRN-0033 | registrations/agents | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 400 | ATL-BRN-0034 | registrations/brain | PARTIAL | 11 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0069 | 3.23 |
| 401 | ATL-BRN-0035 | registrations/business | PARTIAL | 14 | 11 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MOCK_ONLY:2, PARTIAL:6, STRUCTURAL_ONLY:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0070 | 5.53 |
| 402 | ATL-BRN-0036 | registrations/discovery | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 403 | ATL-BRN-0037 | registrations/models | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 404 | ATL-BRN-0038 | registrations/runtime | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0071 | 3.46 |
| 405 | ATL-BRN-0039 | registrations/safety | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (STRUCTURAL_ONLY:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0072 | 3.23 |
| 406 | ATL-BRN-0040 | registrations/security | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 407 | ATL-BRN-0041 | registrations/tools | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 408 | ATL-BRN-0042 | registrations/workflow | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 409 | ATL-BRN-0043 | shared-project-registry | PARTIAL | 6 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0073 | 4.38 |
| 410 | ATL-BRN-0044 | stall-replanner | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0074 | 4.15 |
| 411 | ATL-BRN-0045 | task-ledger | PARTIAL | 6 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-PLN-0001 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0075 | 3.92 |

## Memória és tudás (15)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 412 | ATL-MEM-0001 | brain/knowledge-brain | PARTIAL | 17 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) \| tervezett bővítések/kapcsolatok: ATL-PLN-0010; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0189 | 4.84 |
| 413 | ATL-MEM-0002 | brain/memory-fabric | PARTIAL | 14 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0190 | 5.53 |
| 414 | ATL-MEM-0003 | business-memory | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0191 | 3.46 |
| 415 | ATL-MEM-0004 | chunker | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0192 | 4.61 |
| 416 | ATL-MEM-0005 | embedding-provider | MOCK_ONLY | 13 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0193 | 5.0 |
| 417 | ATL-MEM-0006 | enterprise-knowledge-agentic-rag | PARTIAL | 7 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0194 | 4.15 |
| 418 | ATL-MEM-0007 | experience-learning-engine | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-0010; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0195 | 3.23 |
| 419 | ATL-MEM-0008 | knowledge-projects | PARTIAL | 34 | 25 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:23, STRUCTURAL_ONLY:1) \| tervezett bővítések/… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0005; ATL-WRK-0196 | 14.75 |
| 420 | ATL-MEM-0009 | memory-store | PARTIAL | 36 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) \| tervezett bővítések/kapcsolatok: ATL-PLN-0009 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0197 | 5.53 |
| 421 | ATL-MEM-0010 | notes-organizer | PARTIAL | 2 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0198 | 3.23 |
| 422 | ATL-MEM-0011 | observation-memory | PARTIAL | 13 | 9 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, EXTERNAL_BLOCKER:2, MOCK_ONLY:1, PARTIAL:5) \| tervezet… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0005; ATL-WRK-0199 | 11.07 |
| 423 | ATL-MEM-0012 | project-memory | PARTIAL | 23 | 17 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:17) \| tervezett bővítések/kapcsolatok: ATL-PLN-0021 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0200 | 6.91 |
| 424 | ATL-MEM-0013 | retrieval-eval | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0201 | 3.23 |
| 425 | ATL-MEM-0014 | semantic-index | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MISSING:1, PARTIAL:4) \| tervezett bővítések/… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0202 | 4.61 |
| 426 | ATL-MEM-0015 | unified-entity-graph | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0203 | 3.23 |

## Működtetés / helyreállítás / háttér (36)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 427 | ATL-OPS-0001 | backup-recovery | PARTIAL | 31 | 17 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:17) \| tervezett bővítések/kapcsolatok: ATL-PLN-0054; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0012; ATL-WRK-0205 | 12.58 |
| 428 | ATL-OPS-0002 | brain/black-box | PARTIAL | 18 | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) \| tervezett bővítések/kapcsolatok: ATL-PLN-0008; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0206 | 5.07 |
| 429 | ATL-OPS-0003 | brain/brain-health | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) \| tervezett bővítések/kapcsolatok: ATL-PLN-0006; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0207 | 3.69 |
| 430 | ATL-OPS-0004 | brain/disaster-recovery | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-PLN-0072 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0208 | 3.92 |
| 431 | ATL-OPS-0005 | checkpoint-engine | PARTIAL | 7 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0209 | 3.69 |
| 432 | ATL-OPS-0006 | completion-registry | PARTIAL | 13 | 10 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:6, PARTIAL:3, STRUCTURAL_ONLY:1) \| tervezett bővítések/… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0210 | 5.3 |
| 433 | ATL-OPS-0007 | data-quality | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0211 | 4.61 |
| 434 | ATL-OPS-0008 | dead-letter-queue | PARTIAL | 5 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0006 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0212 | 3.46 |
| 435 | ATL-OPS-0009 | durable-dead-letters | PARTIAL | 12 | 8 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0213 | 4.84 |
| 436 | ATL-OPS-0010 | durable-queue | PARTIAL | 27 | 16 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, MISSING:2, PARTIAL:13) \| tervezett bővítések/kapcsola… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0003; ATL-WRK-0004; ATL-WRK-0214 | 16.68 |
| 437 | ATL-OPS-0011 | event-bus | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0071 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0215 | 3.46 |
| 438 | ATL-OPS-0012 | event-stream | PARTIAL | 4 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0216 | 3.46 |
| 439 | ATL-OPS-0013 | file-lock | PARTIAL | 6 | 2 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, MISSING:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0005; ATL-WRK-0217 | 9.46 |
| 440 | ATL-OPS-0014 | local-update-adapters | PARTIAL | 8 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0078 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0218 | 4.61 |
| 441 | ATL-OPS-0015 | migration-planner | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0219 | 4.61 |
| 442 | ATL-OPS-0016 | observability-black-box | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3, STRUCTURAL_ONLY:1) \| tervezett bővítések/kapcsolatok:… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0220 | 3.92 |
| 443 | ATL-OPS-0017 | owner-control/recovery-points | PARTIAL | 2 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0221 | 3.23 |
| 444 | ATL-OPS-0018 | owner-control/recovery-source-map | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0072 | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 445 | ATL-OPS-0019 | owner-control/safe-mode-scope | VERIFIED_WORKING | 2 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 446 | ATL-OPS-0020 | owner-control/system-doctor | PARTIAL | 6 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-PLN-0006; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0222 | 4.15 |
| 447 | ATL-OPS-0021 | portable-backup | PARTIAL | 15 | 11 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:10) \| tervezett bővítések/kapcsolat… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0223 | 5.53 |
| 448 | ATL-OPS-0022 | priority-queue-rate-limit-governor | PARTIAL | 3 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0006 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0224 | 3.46 |
| 449 | ATL-OPS-0023 | recovery | PARTIAL | 7 | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0225 | 4.38 |
| 450 | ATL-OPS-0024 | regression-eval-suite | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-PLN-0008; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0226 | 4.15 |
| 451 | ATL-OPS-0025 | safe-mode | PARTIAL | 14 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0227 | 3.92 |
| 452 | ATL-OPS-0026 | self-healing-loop | PARTIAL | 13 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) \| tervezett bővítések/kapcsolatok: ATL-PLN-0052 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0228 | 5.3 |
| 453 | ATL-OPS-0027 | startup-self-check | PARTIAL | 13 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0073 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0229 | 4.61 |
| 454 | ATL-OPS-0028 | tracing-evals | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0230 | 3.46 |
| 455 | ATL-OPS-0029 | update-center | PARTIAL | 27 | 21 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:21) \| tervezett bővítések/kapcsolatok: ATL-PLN-0078 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0231 | 7.83 |
| 456 | ATL-OPS-0030 | atlasz-runtime/Dockerfile.worker | STRUCTURAL_ONLY | 1 | nincs teszt-hivatkozás és nincs bekötés \| tervezett bővítések/kapcsolatok: ATL-PLN-0049 | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0232 | 5.0 |
| 457 | ATL-OPS-0031 | atlasz-runtime/agent-child.js | LEGACY_QUARANTINED | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-guards teszt őrzi | ATL-WRK-0469 | 1.5 |
| 458 | ATL-OPS-0032 | atlasz-runtime/owner-cli.mjs | PARTIAL | 4 | tesztelt, de a futó rendszerből nem érhető el; 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0233 | 3.23 |
| 459 | ATL-OPS-0033 | atlasz-runtime/runtime-http.mjs | PARTIAL | 4 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0234 | 3.69 |
| 460 | ATL-OPS-0034 | atlasz-runtime/supervisor-safe.mjs | PARTIAL | 28 | 18 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:2, PARTIAL:16) \| tervezett bővítések/kapcsolatok: ATL-PL… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0004; ATL-WRK-0006; ATL-WRK-001… | 21.14 |
| 461 | ATL-OPS-0035 | atlasz-runtime/supervisor.js | LEGACY_QUARANTINED | 0 | tesztelt, de a futó rendszerből nem érhető el | Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-guards teszt őrzi | ATL-WRK-0236 | 1.5 |
| 462 | ATL-OPS-0036 | atlasz-runtime/worker.js | LEGACY_QUARANTINED | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) | Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-guards teszt őrzi | ATL-WRK-0237 | 1.5 |

## Nem ATLASZ sablon (1)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 463 | ATL-TPL-0001 | Astro/Netlify starter sablon (nem ATLASZ) | NOT_YET_VERIFIED | 0 | nem ATLASZ-követelmény; a tulajdonos döntse el, kell-e | tulajdonosi döntés | ATL-WRK-0481 | 1.5 |

## Piackutatás / felderítés (38)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 464 | ATL-RES-0001 | analyst | PARTIAL | 11 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0246 | 5.53 |
| 465 | ATL-RES-0002 | backtest | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0081 | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 466 | ATL-RES-0003 | buyer-decision-maker-finder | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0247 | 3.92 |
| 467 | ATL-RES-0004 | eligibility-model | PARTIAL | 8 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-PLN-0080 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0248 | 4.15 |
| 468 | ATL-RES-0005 | global-business-intelligence | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-PLN-0046 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0249 | 4.15 |
| 469 | ATL-RES-0006 | global-discovery | PARTIAL | 72 | 44 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:11, MISSING:5, MOCK_ONLY:2, PARTIAL:25, STRUCT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0008; ATL-WRK-0250 | 15.12 |
| 470 | ATL-RES-0007 | lead-qualifier | PARTIAL | 7 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0251 | 3.46 |
| 471 | ATL-RES-0008 | live-discovery-runner | MOCK_ONLY | 44 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0252 | 5.0 |
| 472 | ATL-RES-0009 | market-data | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0081 | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 473 | ATL-RES-0010 | market-intelligence-engine | PARTIAL | 11 | 10 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, PARTIAL:6, STRUCTURAL_ONLY:2) \| tervezett b… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0253 | 5.3 |
| 474 | ATL-RES-0011 | opportunity-intake | PARTIAL | 55 | 31 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, EXTERNAL_BLOCKER:11, PARTIAL:19) \| tervezett bővítése… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0254 | 10.13 |
| 475 | ATL-RES-0012 | opportunity-qualification-engine | PARTIAL | 10 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0255 | 3.92 |
| 476 | ATL-RES-0013 | orb-strategy | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0081 | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 477 | ATL-RES-0014 | org-intelligence | PARTIAL | 9 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7, STRUCTURAL_ONLY:1) \| tervezett bővítések/kapcsolatok:… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0256 | 4.84 |
| 478 | ATL-RES-0015 | paper-trader | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0081; ATL… | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 479 | ATL-RES-0016 | research-ledger | PARTIAL | 23 | 19 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:19) \| tervezett bővítések/kapcsolatok: ATL-PLN-0012 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0257 | 7.37 |
| 480 | ATL-RES-0017 | source-allowlist | PARTIAL | 11 | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:2, PARTIAL:2) \| tervezett bővítése… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0258 | 4.15 |
| 481 | ATL-RES-0018 | tech-watch | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, PARTIAL:3) \| tervezett bővítések/kapcsolatok… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0259 | 4.15 |
| 482 | ATL-RES-0019 | text-compare | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0060 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0260 | 4.61 |
| 483 | ATL-RES-0020 | Felderítési forrás-leíró: Find a Tender (UK) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 484 | ATL-RES-0021 | Felderítési forrás-leíró: Contracts Finder (UK) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 485 | ATL-RES-0022 | Felderítési forrás-leíró: TED - Tenders Electronic Daily (EU) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 486 | ATL-RES-0023 | Felderítési forrás-leíró: CanadaBuys (Canada) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 487 | ATL-RES-0024 | Felderítési forrás-leíró: SAM.gov (United States federal) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 488 | ATL-RES-0025 | Felderítési forrás-leíró: AusTender (Australia) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 489 | ATL-RES-0026 | Felderítési forrás-leíró: GETS (New Zealand) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 490 | ATL-RES-0027 | Felderítési forrás-leíró: World Bank procurement notices (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 491 | ATL-RES-0028 | Felderítési forrás-leíró: UN Global Marketplace (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 492 | ATL-RES-0029 | Felderítési forrás-leíró: eTenders (South Africa) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 493 | ATL-RES-0030 | Felderítési forrás-leíró: Etimad (Saudi Arabia) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 494 | ATL-RES-0031 | Felderítési forrás-leíró: GeM (India) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 495 | ATL-RES-0032 | Felderítési forrás-leíró: Mercado Publico (Chile) (TENDER) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 496 | ATL-RES-0033 | Felderítési forrás-leíró: Remote OK (JOB_BOARD) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 497 | ATL-RES-0034 | Felderítési forrás-leíró: We Work Remotely (JOB_BOARD) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 498 | ATL-RES-0035 | Felderítési forrás-leíró: Hacker News (Algolia search API) (COMMUNITY_BOARD) | EXTERNAL_BLOCKER | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 499 | ATL-RES-0036 | Felderítési forrás-leíró: Upwork (FREELANCE_MARKETPLACE) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 500 | ATL-RES-0037 | Felderítési forrás-leíró: Freelancer.com (FREELANCE_MARKETPLACE) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |
| 501 | ATL-RES-0038 | Felderítési forrás-leíró: LinkedIn (PROFESSIONAL_NETWORK) | NOT_YET_VERIFIED | 0 |  |  | ATL-WRK-0495 | 0.4 |

## Pluginok / skillek / eszközök (8)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 502 | ATL-PLG-0001 | executor-toolbox-registry | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0238 | 3.46 |
| 503 | ATL-PLG-0002 | plugin-installer | PARTIAL | 24 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-PLN-0090 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0239 | 4.15 |
| 504 | ATL-PLG-0003 | plugin-manager | PARTIAL | 46 | 14 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:13) \| tervezett bővítések/kapcsolatok: ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0240 | 6.22 |
| 505 | ATL-PLG-0004 | skill-factory | PARTIAL | 4 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0241 | 3.69 |
| 506 | ATL-PLG-0005 | skill-registry | PARTIAL | 4 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) \| tervezett bővítések/kapcsolatok: ATL-PLN-0041; ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0242 | 3.69 |
| 507 | ATL-PLG-0006 | tool-fabric | PARTIAL | 15 | 15 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:3, PARTIAL:4, STRUCTURAL_ONLY:8) \| tervezett b… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0243 | 6.45 |
| 508 | ATL-PLG-0007 | typed-tools | PARTIAL | 15 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0244 | 5.3 |
| 509 | ATL-PLG-0008 | workbench | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5, STRUCTURAL_ONLY:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0245 | 4.61 |

## Pénzügyi és üzleti modulok (62)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 510 | ATL-FIN-0001 | budget-consumption-governor | PARTIAL | 21 | 14 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:14) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0091 | 6.22 |
| 511 | ATL-FIN-0002 | business/finance-intelligence | PARTIAL | 11 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0092 | 3.46 |
| 512 | ATL-FIN-0003 | business/invoice-preparation | PARTIAL | 10 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0093 | 4.15 |
| 513 | ATL-FIN-0004 | business/invoice-service | PARTIAL | 18 | 12 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10, STRUCTURAL_ONLY:2) \| tervezett bővítések/kapcsolato… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0094 | 5.76 |
| 514 | ATL-FIN-0005 | business/money-engine | PARTIAL | 13 | 8 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:3, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0095 | 4.84 |
| 515 | ATL-FIN-0006 | business/payment-events | PARTIAL | 34 | 25 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:7, MOCK_ONLY:11, PARTIAL:7) \| tervezett bővíté… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0096 | 8.75 |
| 516 | ATL-FIN-0007 | business/payment-verification | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MOCK_ONLY:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0097 | 3.92 |
| 517 | ATL-FIN-0008 | business/recurring-billing | PARTIAL | 11 | 10 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, OWNER_APPROVAL_REQUIRED:4, PARTIAL:5) \| tervezett bő… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0098 | 5.3 |
| 518 | ATL-FIN-0009 | cost-completeness | PARTIAL | 13 | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8, STRUCTURAL_ONLY:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0099 | 5.07 |
| 519 | ATL-FIN-0010 | daily-profit-objective | PARTIAL | 71 | 27 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:6, PARTIAL:19, STRUCTURAL_ONLY:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0100 | 9.21 |
| 520 | ATL-FIN-0011 | financial-guard | PARTIAL | 24 | 12 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:5, PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PL… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0101 | 5.76 |
| 521 | ATL-FIN-0012 | financial-ledger | PARTIAL | 60 | 22 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:19, STRUCTURAL_ONLY:3) \| tervezett bővítések/kapcsolato… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0102 | 8.06 |
| 522 | ATL-FIN-0013 | fx-rates | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0103 | 3.46 |
| 523 | ATL-FIN-0014 | invoice-engine | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0104 | 3.92 |
| 524 | ATL-FIN-0015 | money-pipeline-controller | PARTIAL | 10 | 7 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:2, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0105 | 4.61 |
| 525 | ATL-FIN-0016 | money-supervisor | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0106 | 3.46 |
| 526 | ATL-FIN-0017 | owner-control/financial-firewall | PARTIAL | 27 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0107 | 4.84 |
| 527 | ATL-FIN-0018 | owner-control/money-state-guard | PARTIAL | 14 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0108 | 3.23 |
| 528 | ATL-FIN-0019 | payment-confirmation-adapter | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0109 | 3.46 |
| 529 | ATL-FIN-0020 | payment-webhook-receiver | MOCK_ONLY | 18 | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs \| tervezett bővítések/kapcsolatok: ATL-P… | valódi környezeti próba tulajdonosi engedéllyel | ATL-WRK-0110 | 5.0 |
| 530 | ATL-FIN-0021 | profit-accounting-engine | PARTIAL | 12 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0111 | 3.69 |
| 531 | ATL-FIN-0022 | profit-ledger | PARTIAL | 20 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0112 | 3.46 |
| 532 | ATL-FIN-0023 | revenue-analytics | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0113 | 3.46 |
| 533 | ATL-FIN-0024 | revenue-persistence | PARTIAL | 18 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0114 | 4.61 |
| 534 | ATL-FIN-0025 | tax-accounting-engine | PARTIAL | 24 | 14 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:1, STRUCTURAL_ONLY:12) \| tervezett … | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0115 | 6.22 |
| 535 | ATL-WFL-0001 | business/artifact-registry | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0314 | 3.92 |
| 536 | ATL-WFL-0002 | business/communication-center | PARTIAL | 12 | 11 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:4, MOCK_ONLY:1, PARTIAL:6) \| tervezett bővítés… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0315 | 5.53 |
| 537 | ATL-WFL-0003 | business/contract-review | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-PLN-0083 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0316 | 3.92 |
| 538 | ATL-WFL-0004 | business/crm | PARTIAL | 9 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) \| tervezett bővítések/kapcsolatok: ATL-PLN-0016 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0317 | 4.61 |
| 539 | ATL-WFL-0005 | business/deal-pipeline | PARTIAL | 13 | 7 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:2, PARTIAL:5) \| tervezett bővítések/kapcsolatok: ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0318 | 4.61 |
| 540 | ATL-WFL-0006 | business/delivery-service | PARTIAL | 6 | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:4) \| tervezett bővítések/kapcsolatok… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0319 | 4.15 |
| 541 | ATL-WFL-0007 | business/entity-graph | PARTIAL | 6 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0320 | 3.92 |
| 542 | ATL-WFL-0008 | business/inbox-pipeline | PARTIAL | 12 | 9 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:1, PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0321 | 5.07 |
| 543 | ATL-WFL-0009 | business/job-system | PARTIAL | 13 | 10 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:2, PARTIAL:8) \| tervezett bővítések/kapcsolatok: ATL-… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0322 | 5.3 |
| 544 | ATL-WFL-0010 | business/judge | PARTIAL | 10 | 10 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:9) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0323 | 5.3 |
| 545 | ATL-WFL-0011 | business/package-delivery-adapter | PARTIAL | 4 | 3 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0324 | 3.69 |
| 546 | ATL-WFL-0012 | business/qa-factory | PARTIAL | 5 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) \| tervezett bővítések/kapcsolatok: ATL-PLN-0042 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0325 | 3.69 |
| 547 | ATL-WFL-0013 | business/store | PARTIAL | 3 | 1 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-0012; ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0005; ATL-WRK-0326 | 9.23 |
| 548 | ATL-WFL-0014 | client-dna-engine | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) \| tervezett bővítések/kapcsolatok: ATL-PLN-0043 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0327 | 3.69 |
| 549 | ATL-WFL-0015 | contract-analysis | PARTIAL | 10 | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) \| tervezett bővítések/kapcsolatok: ATL-PLN-0083 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0328 | 5.07 |
| 550 | ATL-WFL-0016 | deal-state | VERIFIED_WORKING | 3 | nincs ismert (részletek: a kapcsolt követelmények sorai) | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 551 | ATL-WFL-0017 | delivery-engine | PARTIAL | 7 | 6 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0329 | 4.38 |
| 552 | ATL-WFL-0018 | follow-up-engine | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:2) \| tervezett bővítések/kapcsolatok… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0330 | 3.69 |
| 553 | ATL-WFL-0019 | negotiation-engine | PARTIAL | 1 | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) \| tervezett bővítések/kapcsolatok: ATL-PLN-0043 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0331 | 3.23 |
| 554 | ATL-WFL-0020 | proposal-quote-engine | PARTIAL | 9 | 9 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, OWNER_APPROVAL_REQUIRED:1, PARTIAL:7) \| tervezett bőv… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0332 | 5.07 |
| 555 | ATL-WFL-0021 | proposal-stage | PARTIAL | 7 | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0333 | 4.61 |
| 556 | ATL-WFL-0022 | workflow-engine | PARTIAL | 14 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) \| tervezett bővítések/kapcsolatok: ATL-PLN-0055 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0334 | 4.84 |
| 557 | ATL-WFL-0023 | workflow-stages | PARTIAL | 6 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0335 | 3.46 |
| 558 | ATL-WFL-0024 | Üzleti szakasz 1: DISCOVER | OWNER_APPROVAL_REQUIRED | 0 | élő felderítés soha nem futott; aláírt forrás-host és hálózati jóváhagyás kell | tulajdonosi jóváhagyás | ATL-WRK-0482 | 1.0 |
| 559 | ATL-WFL-0025 | Üzleti szakasz 2: VERIFY | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0483 | 4.5 |
| 560 | ATL-WFL-0026 | Üzleti szakasz 3: QUALIFY | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0484 | 4.5 |
| 561 | ATL-WFL-0027 | Üzleti szakasz 4: ESTIMATE | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0485 | 4.5 |
| 562 | ATL-WFL-0028 | Üzleti szakasz 5: PLAN | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0486 | 4.5 |
| 563 | ATL-WFL-0029 | Üzleti szakasz 6: OWNER_APPROVAL | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0487 | 4.5 |
| 564 | ATL-WFL-0030 | Üzleti szakasz 7: EXECUTE | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0488 | 4.5 |
| 565 | ATL-WFL-0031 | Üzleti szakasz 8: QUALITY_ASSURANCE | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0489 | 4.5 |
| 566 | ATL-WFL-0032 | Üzleti szakasz 9: DELIVERY_APPROVAL | PARTIAL | 1 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0490 | 4.5 |
| 567 | ATL-WFL-0033 | Üzleti szakasz 10: DELIVER | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0491 | 4.5 |
| 568 | ATL-WFL-0034 | Üzleti szakasz 11: INVOICE | PARTIAL | 0 | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0492 | 4.5 |
| 569 | ATL-WFL-0035 | Üzleti szakasz 12: PAYMENT_VERIFICATION | EXTERNAL_BLOCKER | 0 | élő Stripe-kapcsolat/aláírt webhook nincs | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0336 | 7.0 |
| 570 | ATL-WFL-0036 | Üzleti szakasz 13: RECONCILIATION | EXTERNAL_BLOCKER | 0 | valós processzor/bank adat nincs | tulajdonosi hitelesítő adat / engedély / külső hozzáférés | ATL-WRK-0337 | 7.0 |
| 571 | ATL-WFL-0037 | Üzleti szakasz 14: NET_PROFIT | PARTIAL | 2 | a hatóság-logika tesztelt; valós, ellenőrzött bevétel nincs | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0493 | 4.5 |

## Tanulás és produktivitás (3)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 572 | ATL-LRN-0001 | spaced-repetition | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0160 | 3.46 |
| 573 | ATL-LRN-0002 | suggestions | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0161 | 3.69 |
| 574 | ATL-LRN-0003 | tutor | PARTIAL | 3 | 3 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0162 | 3.69 |

## Tesztek és ellenőrző eszközök (307)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 575 | ATL-CHK-0001 | atlasz-tests/helpers.mjs | STRUCTURAL_ONLY | 0 | nincs ismert | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0408 | 5.0 |
| 576 | ATL-CHK-0002 | atlasz-tests/media-fixtures.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0409 | 1.5 |
| 577 | ATL-CHK-0003 | atlasz-tests/owner-control-rig.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0410 | 1.5 |
| 578 | ATL-CHK-0004 | docs/audit/dynamic_probe.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0411 | 1.5 |
| 579 | ATL-CHK-0005 | docs/audit/independent_probes.mjs | NOT_YET_VERIFIED | 3 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0412 | 1.5 |
| 580 | ATL-CHK-0006 | docs/audit/provider_matrix.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0413 | 1.5 |
| 581 | ATL-CHK-0007 | docs/audit/retrieval_benchmark.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0414 | 1.5 |
| 582 | ATL-CHK-0008 | docs/demo/m6_demo.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0415 | 1.5 |
| 583 | ATL-CHK-0009 | scripts/agent-evidence.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0416 | 1.5 |
| 584 | ATL-CHK-0010 | scripts/d12-report.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0417 | 1.5 |
| 585 | ATL-CHK-0011 | scripts/demonstrations.mjs | NOT_YET_VERIFIED | 1 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0418 | 1.5 |
| 586 | ATL-CHK-0012 | scripts/gh-annotate-test-failures.mjs | STRUCTURAL_ONLY | 0 | nincs ismert | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0419 | 5.0 |
| 587 | ATL-CHK-0013 | scripts/integration-matrix.mjs | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 588 | ATL-CHK-0014 | scripts/make-evidence.mjs | NOT_YET_VERIFIED | 2 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0420 | 1.5 |
| 589 | ATL-CHK-0015 | scripts/make-sanitized-dist.mjs | NOT_YET_VERIFIED | 11 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0421 | 1.5 |
| 590 | ATL-CHK-0016 | scripts/master-tracker.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0422 | 1.5 |
| 591 | ATL-CHK-0017 | scripts/module-evidence.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0423 | 1.5 |
| 592 | ATL-CHK-0018 | scripts/prepare-live-source-request.mjs | NOT_YET_VERIFIED | 1 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0424 | 1.5 |
| 593 | ATL-CHK-0019 | scripts/repair-register.mjs | NOT_YET_VERIFIED | 0 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0425 | 1.5 |
| 594 | ATL-CHK-0020 | scripts/secret-history-scan.mjs | NOT_YET_VERIFIED | 2 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0426 | 1.5 |
| 595 | ATL-CHK-0021 | scripts/system-audit.mjs | VERIFIED_WORKING | 2 | nincs ismert | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 596 | ATL-CHK-0022 | scripts/test-impacted.mjs | NOT_YET_VERIFIED | 1 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0427 | 1.5 |
| 597 | ATL-CHK-0023 | scripts/validate-malware-scanner.mjs | NOT_YET_VERIFIED | 2 | nem vizsgált funkcionálisan (generátor/segéd) | ellenőrzés | ATL-WRK-0428 | 1.5 |
| 598 | ATL-CHK-0024 | atlasz-control-center/package.json | NOT_YET_VERIFIED | 4 | n/a | szükség szerinti frissítés | ATL-WRK-0429 | 1.5 |
| 599 | ATL-CHK-0025 | atlasz-runtime/package.json | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0430 | 1.5 |
| 600 | ATL-CHK-0026 | docs/ATLASZ_V73_UNIFIED_AUDIT.md | NOT_YET_VERIFIED | 5 | n/a | szükség szerinti frissítés | ATL-WRK-0431 | 1.5 |
| 601 | ATL-CHK-0027 | docs/DAILY_PROFIT_OBJECTIVE.md | NOT_YET_VERIFIED | 2 | n/a | szükség szerinti frissítés | ATL-WRK-0432 | 1.5 |
| 602 | ATL-CHK-0028 | docs/MALWARE_SCANNER_VALIDATION.md | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0433 | 1.5 |
| 603 | ATL-CHK-0029 | docs/OWNER_KEY_SETUP.md | NOT_YET_VERIFIED | 2 | n/a | szükség szerinti frissítés | ATL-WRK-0434 | 1.5 |
| 604 | ATL-CHK-0030 | docs/SANDBOX_LIMITS_WINDOWS_ELECTRON.md | NOT_YET_VERIFIED | 3 | n/a | szükség szerinti frissítés | ATL-WRK-0435 | 1.5 |
| 605 | ATL-CHK-0031 | docs/STRIPE_HANDOFF.md | NOT_YET_VERIFIED | 15 | n/a | szükség szerinti frissítés | ATL-WRK-0436 | 1.5 |
| 606 | ATL-CHK-0032 | docs/WORKFLOW_STAGE_MAPPING.md | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0437 | 1.5 |
| 607 | ATL-CHK-0033 | docs/atlasz_capability_audit_85.json | NOT_YET_VERIFIED | 9 | n/a | szükség szerinti frissítés | ATL-WRK-0438 | 1.5 |
| 608 | ATL-CHK-0034 | docs/atlasz_master_gap_register.csv | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0439 | 1.5 |
| 609 | ATL-CHK-0035 | docs/atlasz_master_gap_register.json | NOT_YET_VERIFIED | 12 | n/a | szükség szerinti frissítés | ATL-WRK-0440 | 1.5 |
| 610 | ATL-CHK-0036 | docs/atlasz_v73_requirement_registry.csv | NOT_YET_VERIFIED | 10 | n/a | szükség szerinti frissítés | ATL-WRK-0441 | 1.5 |
| 611 | ATL-CHK-0037 | docs/atlasz_v73_requirement_registry.json | NOT_YET_VERIFIED | 34 | n/a | szükség szerinti frissítés | ATL-WRK-0442 | 1.5 |
| 612 | ATL-CHK-0038 | docs/audit/ATLASZ_TELJES_AUDIT_JELENTES_2026-10-11.md | NOT_YET_VERIFIED | 3 | n/a | szükség szerinti frissítés | ATL-WRK-0443 | 1.5 |
| 613 | ATL-CHK-0039 | docs/audit/ATLASZ_V73_DEFECT_REGISTER.csv | NOT_YET_VERIFIED | 4 | n/a | szükség szerinti frissítés | ATL-WRK-0444 | 1.5 |
| 614 | ATL-CHK-0040 | docs/audit/ATLASZ_V73_RESUME_CHECKPOINT.md | NOT_YET_VERIFIED | 4 | n/a | szükség szerinti frissítés | ATL-WRK-0445 | 1.5 |
| 615 | ATL-CHK-0041 | docs/audit/LEGACY_QUARANTINE.md | NOT_YET_VERIFIED | 7 | n/a | szükség szerinti frissítés | ATL-WRK-0446 | 1.5 |
| 616 | ATL-CHK-0042 | docs/audit/SECURITY_PROTECTION_MATRIX.md | NOT_YET_VERIFIED | 8 | n/a | szükség szerinti frissítés | ATL-WRK-0447 | 1.5 |
| 617 | ATL-CHK-0043 | docs/audit/connection_status.md | NOT_YET_VERIFIED | 19 | n/a | szükség szerinti frissítés | ATL-WRK-0448 | 1.5 |
| 618 | ATL-CHK-0044 | docs/audit/demonstrations_evidence.json | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0449 | 1.5 |
| 619 | ATL-CHK-0045 | docs/audit/e2e_evidence.json | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0450 | 1.5 |
| 620 | ATL-CHK-0046 | docs/audit/enforcement_coverage.json | NOT_YET_VERIFIED | 2 | n/a | szükség szerinti frissítés | ATL-WRK-0451 | 1.5 |
| 621 | ATL-CHK-0047 | docs/audit/integration_matrix_2026-10-11.json | NOT_YET_VERIFIED | 5 | n/a | szükség szerinti frissítés | ATL-WRK-0452 | 1.5 |
| 622 | ATL-CHK-0048 | docs/audit/item_audit.csv | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0453 | 1.5 |
| 623 | ATL-CHK-0049 | docs/audit/item_audit.py | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0454 | 1.5 |
| 624 | ATL-CHK-0050 | docs/audit/module_dispositions.json | NOT_YET_VERIFIED | 10 | n/a | szükség szerinti frissítés | ATL-WRK-0455 | 1.5 |
| 625 | ATL-CHK-0051 | docs/audit/pkg150_map.txt | NOT_YET_VERIFIED | 3 | n/a | szükség szerinti frissítés | ATL-WRK-0456 | 1.5 |
| 626 | ATL-CHK-0052 | docs/audit/pkg150_source_ids.json | NOT_YET_VERIFIED | 3 | n/a | szükség szerinti frissítés | ATL-WRK-0457 | 1.5 |
| 627 | ATL-CHK-0053 | docs/audit/pkg150_status.csv | NOT_YET_VERIFIED | 9 | n/a | szükség szerinti frissítés | ATL-WRK-0458 | 1.5 |
| 628 | ATL-CHK-0054 | docs/audit/pkg150_traceability.csv | NOT_YET_VERIFIED | 2 | n/a | szükség szerinti frissítés | ATL-WRK-0459 | 1.5 |
| 629 | ATL-CHK-0055 | docs/audit/repair_overrides.json | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0460 | 1.5 |
| 630 | ATL-CHK-0056 | docs/audit/system_audit_2026-10-11.json | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0461 | 1.5 |
| 631 | ATL-CHK-0057 | docs/build_registry.py | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0462 | 1.5 |
| 632 | ATL-CHK-0058 | docs/capabilities/reconciliation_85.json | NOT_YET_VERIFIED | 7 | n/a | szükség szerinti frissítés | ATL-WRK-0463 | 1.5 |
| 633 | ATL-CHK-0059 | docs/owner/FIRST_LIVE_SOURCE_APPROVAL_REQUEST.json | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0464 | 1.5 |
| 634 | ATL-CHK-0060 | docs/owner/FIRST_LIVE_SOURCE_APPROVAL_REQUEST.md | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0465 | 1.5 |
| 635 | ATL-CHK-0061 | docs/owner/FIRST_MODEL_CONNECTION_RUNBOOK.md | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0466 | 1.5 |
| 636 | ATL-CHK-0062 | docs/owner/STRIPE_ACTIVATION_OWNER_STEPS.md | NOT_YET_VERIFIED | 1 | n/a | szükség szerinti frissítés | ATL-WRK-0467 | 1.5 |
| 637 | ATL-TST-0001 | a08-sources.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 638 | ATL-TST-0002 | a11y-audit.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 639 | ATL-TST-0003 | a11y-control-center.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 640 | ATL-TST-0004 | agent-factory-governor.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 641 | ATL-TST-0005 | agent-registry.test | VERIFIED_WORKING | 20 | nincs ismert | nincs |  | 0.0 |
| 642 | ATL-TST-0006 | agent-tool-broker.test | VERIFIED_WORKING | 16 | nincs ismert | nincs |  | 0.0 |
| 643 | ATL-TST-0007 | agent-tool-policy-vs-proposal.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 644 | ATL-TST-0008 | agent-tools-hosted.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 645 | ATL-TST-0009 | agent-workforce.test | VERIFIED_WORKING | 37 | nincs ismert | nincs |  | 0.0 |
| 646 | ATL-TST-0010 | alt-solution-harness.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 647 | ATL-TST-0011 | analyst-mutation.test | VERIFIED_WORKING | 11 | nincs ismert | nincs |  | 0.0 |
| 648 | ATL-TST-0012 | approval-requests.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 649 | ATL-TST-0013 | assistant-profiles.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 650 | ATL-TST-0014 | audit-chain-headpin.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 651 | ATL-TST-0015 | aurora.test | VERIFIED_WORKING | 77 | nincs ismert | nincs |  | 0.0 |
| 652 | ATL-TST-0016 | backup-recovery.test | VERIFIED_WORKING | 27 | nincs ismert | nincs |  | 0.0 |
| 653 | ATL-TST-0017 | behavior-monitor.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 654 | ATL-TST-0018 | brain-core.test | VERIFIED_WORKING | 20 | nincs ismert | nincs |  | 0.0 |
| 655 | ATL-TST-0019 | brain-failure-modes.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 656 | ATL-TST-0020 | brain-intelligence.test | VERIFIED_WORKING | 31 | nincs ismert | nincs |  | 0.0 |
| 657 | ATL-TST-0021 | brain-master-workflow.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 658 | ATL-TST-0022 | brain-orchestration.test | VERIFIED_WORKING | 29 | nincs ismert | nincs |  | 0.0 |
| 659 | ATL-TST-0023 | brain-runtime-wiring.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 660 | ATL-TST-0024 | brain-systems.test | VERIFIED_WORKING | 16 | nincs ismert | nincs |  | 0.0 |
| 661 | ATL-TST-0025 | browser-extension-guard.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 662 | ATL-TST-0026 | business-engines.test | VERIFIED_WORKING | 61 | nincs ismert | nincs |  | 0.0 |
| 663 | ATL-TST-0027 | canonical-queue-safety.test | VERIFIED_WORKING | 19 | nincs ismert | nincs |  | 0.0 |
| 664 | ATL-TST-0028 | canonical-runtime.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 665 | ATL-TST-0029 | chat-providers.test | VERIFIED_WORKING | 42 | nincs ismert | nincs |  | 0.0 |
| 666 | ATL-TST-0030 | chunker-analyst.test | VERIFIED_WORKING | 15 | nincs ismert | nincs |  | 0.0 |
| 667 | ATL-TST-0031 | chunker-mutation.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 668 | ATL-TST-0032 | code-review.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 669 | ATL-TST-0033 | code-sandbox-hosted.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 670 | ATL-TST-0034 | code-sandbox.test | VERIFIED_WORKING | 14 | nincs ismert | nincs |  | 0.0 |
| 671 | ATL-TST-0035 | compare-transcript-mutation.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 672 | ATL-TST-0036 | compare-transcript.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 673 | ATL-TST-0037 | connector-catalog.test | VERIFIED_WORKING | 44 | nincs ismert | nincs |  | 0.0 |
| 674 | ATL-TST-0038 | context-conversation.test | VERIFIED_WORKING | 15 | nincs ismert | nincs |  | 0.0 |
| 675 | ATL-TST-0039 | contract-analysis.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 676 | ATL-TST-0040 | contract-core-engine.test | VERIFIED_WORKING | 44 | nincs ismert | nincs |  | 0.0 |
| 677 | ATL-TST-0041 | contract-existing-modules.test | VERIFIED_WORKING | 56 | nincs ismert | nincs |  | 0.0 |
| 678 | ATL-TST-0042 | contract-factories.test | VERIFIED_WORKING | 19 | nincs ismert | nincs |  | 0.0 |
| 679 | ATL-TST-0043 | contract-invoice-delivery.test | VERIFIED_WORKING | 22 | nincs ismert | nincs |  | 0.0 |
| 680 | ATL-TST-0044 | contract-memory-control.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 681 | ATL-TST-0045 | contract-money-tax.test | VERIFIED_WORKING | 43 | nincs ismert | nincs |  | 0.0 |
| 682 | ATL-TST-0046 | control-center-agents30.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 683 | ATL-TST-0047 | control-center-brain.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 684 | ATL-TST-0048 | control-center-discovery.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 685 | ATL-TST-0049 | control-center-finance.test | VERIFIED_WORKING | 15 | nincs ismert | nincs |  | 0.0 |
| 686 | ATL-TST-0050 | control-center-home.test | VERIFIED_WORKING | 14 | nincs ismert | nincs |  | 0.0 |
| 687 | ATL-TST-0051 | control-center-installer.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 688 | ATL-TST-0052 | control-center-master.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 689 | ATL-TST-0053 | control-center-memory.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 690 | ATL-TST-0054 | control-center-model-registry.test | VERIFIED_WORKING | 65 | nincs ismert | nincs |  | 0.0 |
| 691 | ATL-TST-0055 | control-center-money-views.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 692 | ATL-TST-0056 | control-center-ownersafety.test | VERIFIED_WORKING | 34 | nincs ismert | nincs |  | 0.0 |
| 693 | ATL-TST-0057 | control-center-plugins.test | VERIFIED_WORKING | 16 | nincs ismert | nincs |  | 0.0 |
| 694 | ATL-TST-0058 | control-center-routes-m1.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 695 | ATL-TST-0059 | control-center-security.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 696 | ATL-TST-0060 | control-center-systems.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 697 | ATL-TST-0061 | control-center-vault-chat.test | VERIFIED_WORKING | 32 | nincs ismert | nincs |  | 0.0 |
| 698 | ATL-TST-0062 | control-center.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 699 | ATL-TST-0063 | crm.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 700 | ATL-TST-0064 | daily-profit-objective.test | VERIFIED_WORKING | 46 | nincs ismert | nincs |  | 0.0 |
| 701 | ATL-TST-0065 | demonstrations.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 702 | ATL-TST-0066 | detail-level-mutation.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 703 | ATL-TST-0067 | digital-twin.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 704 | ATL-TST-0068 | doc-extractors.test | VERIFIED_WORKING | 37 | nincs ismert | nincs |  | 0.0 |
| 705 | ATL-TST-0069 | document-center-quarantine.test | VERIFIED_WORKING | 11 | nincs ismert | nincs |  | 0.0 |
| 706 | ATL-TST-0070 | document-center.test | VERIFIED_WORKING | 45 | nincs ismert | nincs |  | 0.0 |
| 707 | ATL-TST-0071 | document-intelligence.test | VERIFIED_WORKING | 38 | nincs ismert | nincs |  | 0.0 |
| 708 | ATL-TST-0072 | durable-dead-letters.test | VERIFIED_WORKING | 11 | nincs ismert | nincs |  | 0.0 |
| 709 | ATL-TST-0073 | durable-queue.test | VERIFIED_WORKING | 21 | nincs ismert | nincs |  | 0.0 |
| 710 | ATL-TST-0074 | egress-policy.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 711 | ATL-TST-0075 | eligibility-model.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 712 | ATL-TST-0076 | emergency-stop.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 713 | ATL-TST-0077 | enforcement-coverage.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 714 | ATL-TST-0078 | entity-graph.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 715 | ATL-TST-0079 | event-stream.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 716 | ATL-TST-0080 | evidence-record.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 717 | ATL-TST-0081 | evidence-sources.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 718 | ATL-TST-0082 | execution-boundary.test | VERIFIED_WORKING | 19 | nincs ismert | nincs |  | 0.0 |
| 719 | ATL-TST-0083 | file-intake.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 720 | ATL-TST-0084 | financial-engine-core.test | VERIFIED_WORKING | 22 | nincs ismert | nincs |  | 0.0 |
| 721 | ATL-TST-0085 | financial-engine.test | VERIFIED_WORKING | 59 | nincs ismert | nincs |  | 0.0 |
| 722 | ATL-TST-0086 | financial-ledger.test | VERIFIED_WORKING | 44 | nincs ismert | nincs |  | 0.0 |
| 723 | ATL-TST-0087 | form-assistant.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 724 | ATL-TST-0088 | gap-register-modules.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 725 | ATL-TST-0089 | gated-modules.test | VERIFIED_WORKING | 28 | nincs ismert | nincs |  | 0.0 |
| 726 | ATL-TST-0090 | global-discovery-workforce.test | VERIFIED_WORKING | 29 | nincs ismert | nincs |  | 0.0 |
| 727 | ATL-TST-0091 | global-discovery.test | VERIFIED_WORKING | 42 | nincs ismert | nincs |  | 0.0 |
| 728 | ATL-TST-0092 | governed-dispatch.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 729 | ATL-TST-0093 | handoff-concurrency.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 730 | ATL-TST-0094 | handoff-ledger.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 731 | ATL-TST-0095 | human-core.test | VERIFIED_WORKING | 56 | nincs ismert | nincs |  | 0.0 |
| 732 | ATL-TST-0096 | inbox-pipeline.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 733 | ATL-TST-0097 | incident-response.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 734 | ATL-TST-0098 | injection-filter.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 735 | ATL-TST-0099 | knowledge-projects-hosted.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 736 | ATL-TST-0100 | knowledge-projects.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 737 | ATL-TST-0101 | live-discovery-runner.test | VERIFIED_WORKING | 38 | nincs ismert | nincs |  | 0.0 |
| 738 | ATL-TST-0102 | local-ai-manager.test | VERIFIED_WORKING | 19 | nincs ismert | nincs |  | 0.0 |
| 739 | ATL-TST-0103 | local-update-adapters.test | VERIFIED_WORKING | 12 | nincs ismert | nincs |  | 0.0 |
| 740 | ATL-TST-0104 | local-update-signing.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 741 | ATL-TST-0105 | m1-round2.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 742 | ATL-TST-0106 | m1-vault-broker.test | VERIFIED_WORKING | 28 | nincs ismert | nincs |  | 0.0 |
| 743 | ATL-TST-0107 | m12-profile-integration.test | VERIFIED_WORKING | 14 | nincs ismert | nincs |  | 0.0 |
| 744 | ATL-TST-0108 | m2-code-edit-workflow.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 745 | ATL-TST-0109 | m2-proposal-consistency.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 746 | ATL-TST-0110 | m3-memory-store.test | VERIFIED_WORKING | 33 | nincs ismert | nincs |  | 0.0 |
| 747 | ATL-TST-0111 | m4-agent-coordination.test | VERIFIED_WORKING | 28 | nincs ismert | nincs |  | 0.0 |
| 748 | ATL-TST-0112 | m5-memory-integration.test | VERIFIED_WORKING | 37 | nincs ismert | nincs |  | 0.0 |
| 749 | ATL-TST-0113 | m5-runtime-memory.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 750 | ATL-TST-0114 | m5-verification-round1.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 751 | ATL-TST-0115 | m5-verification-round2.test | VERIFIED_WORKING | 4 | nincs ismert | nincs | ATL-WRK-0010 | 4.0 |
| 752 | ATL-TST-0116 | m5-verification-round3.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 753 | ATL-TST-0117 | m5-verification-round4.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 754 | ATL-TST-0118 | m5-verification-round5.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 755 | ATL-TST-0119 | m5-verification-round6.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 756 | ATL-TST-0120 | m6-agent-activity.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 757 | ATL-TST-0121 | m6-control-center.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 758 | ATL-TST-0122 | m6-market-orb.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 759 | ATL-TST-0123 | m6-paper-trader.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 760 | ATL-TST-0124 | master-coordinator.test | VERIFIED_WORKING | 21 | nincs ismert | nincs |  | 0.0 |
| 761 | ATL-TST-0125 | master-security-probe.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 762 | ATL-TST-0126 | mcp-client.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 763 | ATL-TST-0127 | mcp-hosted.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 764 | ATL-TST-0128 | memory-fabric.test | VERIFIED_WORKING | 15 | nincs ismert | nincs |  | 0.0 |
| 765 | ATL-TST-0129 | mobile-api.test | VERIFIED_WORKING | 36 | nincs ismert | nincs |  | 0.0 |
| 766 | ATL-TST-0130 | modality-fabric-hosted.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 767 | ATL-TST-0131 | modality-fabric.test | VERIFIED_WORKING | 26 | nincs ismert | nincs |  | 0.0 |
| 768 | ATL-TST-0132 | model-evidence.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 769 | ATL-TST-0133 | model-evolution.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 770 | ATL-TST-0134 | model-gateway.test | VERIFIED_WORKING | 26 | nincs ismert | nincs |  | 0.0 |
| 771 | ATL-TST-0135 | model-registry.test | VERIFIED_WORKING | 31 | nincs ismert | nincs |  | 0.0 |
| 772 | ATL-TST-0136 | model-routing-bridge-regress.test | VERIFIED_WORKING | 20 | nincs ismert | nincs |  | 0.0 |
| 773 | ATL-TST-0137 | model-routing-bridge.test | VERIFIED_WORKING | 38 | nincs ismert | nincs |  | 0.0 |
| 774 | ATL-TST-0138 | module-broker.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 775 | ATL-TST-0139 | module-business.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 776 | ATL-TST-0140 | module-registrations.test | VERIFIED_WORKING | 15 | nincs ismert | nincs |  | 0.0 |
| 777 | ATL-TST-0141 | money-engine-hosted.test | VERIFIED_WORKING | 14 | nincs ismert | nincs |  | 0.0 |
| 778 | ATL-TST-0142 | money-engine-sandbox.test | VERIFIED_WORKING | 28 | nincs ismert | nincs |  | 0.0 |
| 779 | ATL-TST-0143 | no-weak-random.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 780 | ATL-TST-0144 | notes-organizer.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 781 | ATL-TST-0145 | observation-memory-hosted.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 782 | ATL-TST-0146 | observation-memory.test | VERIFIED_WORKING | 14 | nincs ismert | nincs |  | 0.0 |
| 783 | ATL-TST-0147 | opportunity-intake.test | VERIFIED_WORKING | 45 | nincs ismert | nincs |  | 0.0 |
| 784 | ATL-TST-0148 | org-intelligence.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 785 | ATL-TST-0149 | owner-auth.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 786 | ATL-TST-0150 | owner-control-bypass.test | VERIFIED_WORKING | 72 | nincs ismert | nincs |  | 0.0 |
| 787 | ATL-TST-0151 | owner-control-core.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 788 | ATL-TST-0152 | owner-control-extra.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 789 | ATL-TST-0153 | page-ingest-hosted.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 790 | ATL-TST-0154 | page-ingest.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 791 | ATL-TST-0155 | payment-events.test | VERIFIED_WORKING | 35 | nincs ismert | nincs |  | 0.0 |
| 792 | ATL-TST-0156 | payment-package-intake.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 793 | ATL-TST-0157 | payment-webhook-receiver.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 794 | ATL-TST-0158 | personal-command-center.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 795 | ATL-TST-0159 | plugin-hooks-integration.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 796 | ATL-TST-0160 | plugin-installer.test | VERIFIED_WORKING | 12 | nincs ismert | nincs |  | 0.0 |
| 797 | ATL-TST-0161 | plugin-manager.test | VERIFIED_WORKING | 39 | nincs ismert | nincs |  | 0.0 |
| 798 | ATL-TST-0162 | policy-guards.test | VERIFIED_WORKING | 21 | nincs ismert | nincs |  | 0.0 |
| 799 | ATL-TST-0163 | portable-backup.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 800 | ATL-TST-0164 | preferences.test | VERIFIED_WORKING | 11 | nincs ismert | nincs |  | 0.0 |
| 801 | ATL-TST-0165 | priority-explained.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 802 | ATL-TST-0166 | probe-evidence.test | VERIFIED_WORKING | 23 | nincs ismert | nincs |  | 0.0 |
| 803 | ATL-TST-0167 | process-gate.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 804 | ATL-TST-0168 | profiles-hosted.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 805 | ATL-TST-0169 | project-memory.test | VERIFIED_WORKING | 19 | nincs ismert | nincs |  | 0.0 |
| 806 | ATL-TST-0170 | proposal-stage.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 807 | ATL-TST-0171 | prototype-builder.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 808 | ATL-TST-0172 | prototypes-hosted.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 809 | ATL-TST-0173 | provider-adapters.test | VERIFIED_WORKING | 30 | nincs ismert | nincs |  | 0.0 |
| 810 | ATL-TST-0174 | provider-egress.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 811 | ATL-TST-0175 | provider-resilience.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 812 | ATL-TST-0176 | quarantine.test | VERIFIED_WORKING | 20 | nincs ismert | nincs |  | 0.0 |
| 813 | ATL-TST-0177 | r6-plugin-containment.test | VERIFIED_WORKING | 17 | nincs ismert | nincs |  | 0.0 |
| 814 | ATL-TST-0178 | r6-round10.test | VERIFIED_WORKING | 38 | nincs ismert | nincs |  | 0.0 |
| 815 | ATL-TST-0179 | r6-round11.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 816 | ATL-TST-0180 | r6-round12.test | VERIFIED_WORKING | 20 | nincs ismert | nincs |  | 0.0 |
| 817 | ATL-TST-0181 | r6-round13.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 818 | ATL-TST-0182 | r6-round14.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 819 | ATL-TST-0183 | r6-round2.test | VERIFIED_WORKING | 19 | nincs ismert | nincs |  | 0.0 |
| 820 | ATL-TST-0184 | r6-round8.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 821 | ATL-TST-0185 | r6-round9.test | VERIFIED_WORKING | 33 | nincs ismert | nincs |  | 0.0 |
| 822 | ATL-TST-0186 | rag-durable.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 823 | ATL-TST-0187 | recurring-billing.test | VERIFIED_WORKING | 12 | nincs ismert | nincs |  | 0.0 |
| 824 | ATL-TST-0188 | registry-integrity.test | VERIFIED_WORKING | 50 | nincs ismert \| tervezett bővítések/kapcsolatok: ATL-PLN-0089 | nincs |  | 0.0 |
| 825 | ATL-TST-0189 | regression-repairs.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 826 | ATL-TST-0190 | release-signing.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 827 | ATL-TST-0191 | render-detail.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 828 | ATL-TST-0192 | render-mutation.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 829 | ATL-TST-0193 | repo-analyzer.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 830 | ATL-TST-0194 | repo-secret-scan.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 831 | ATL-TST-0195 | repos-hosted.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 832 | ATL-TST-0196 | research-ledger-hosted.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 833 | ATL-TST-0197 | research-ledger.test | VERIFIED_WORKING | 34 | nincs ismert | nincs |  | 0.0 |
| 834 | ATL-TST-0198 | reserved-keys.test | VERIFIED_WORKING | 23 | nincs ismert | nincs |  | 0.0 |
| 835 | ATL-TST-0199 | restricted-node.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 836 | ATL-TST-0200 | revenue-persistence.test | VERIFIED_WORKING | 13 | nincs ismert | nincs |  | 0.0 |
| 837 | ATL-TST-0201 | runtime-http.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 838 | ATL-TST-0202 | runtime-restart-recovery.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 839 | ATL-TST-0203 | safety-modules.test | VERIFIED_WORKING | 27 | nincs ismert | nincs |  | 0.0 |
| 840 | ATL-TST-0204 | scheduler.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 841 | ATL-TST-0205 | secret-patterns.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 842 | ATL-TST-0206 | security-adversarial.test | VERIFIED_WORKING | 32 | nincs ismert | nincs |  | 0.0 |
| 843 | ATL-TST-0207 | security-gates.test | VERIFIED_WORKING | 18 | nincs ismert | nincs |  | 0.0 |
| 844 | ATL-TST-0208 | skill-registry.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 845 | ATL-TST-0209 | skills-hosted.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 846 | ATL-TST-0210 | social-drafts.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 847 | ATL-TST-0211 | source-adapters.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 848 | ATL-TST-0212 | source-allowlist.test | VERIFIED_WORKING | 7 | nincs ismert | nincs |  | 0.0 |
| 849 | ATL-TST-0213 | spaced-repetition.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 850 | ATL-TST-0214 | stage-r5-fixes.test | VERIFIED_WORKING | 33 | nincs ismert | nincs |  | 0.0 |
| 851 | ATL-TST-0215 | stop-enforcement.test | VERIFIED_WORKING | 28 | nincs ismert | nincs |  | 0.0 |
| 852 | ATL-TST-0216 | stream-hosted.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 853 | ATL-TST-0217 | study-suggest-hosted.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 854 | ATL-TST-0218 | suggestions.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 855 | ATL-TST-0219 | tech-watch.test | VERIFIED_WORKING | 5 | nincs ismert | nincs |  | 0.0 |
| 856 | ATL-TST-0220 | tenant-isolation.test | VERIFIED_WORKING | 38 | nincs ismert | nincs |  | 0.0 |
| 857 | ATL-TST-0221 | tick-loop.test | VERIFIED_WORKING | 16 | nincs ismert | nincs |  | 0.0 |
| 858 | ATL-TST-0222 | translation-feedback.test | VERIFIED_WORKING | 8 | nincs ismert | nincs |  | 0.0 |
| 859 | ATL-TST-0223 | tutor.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 860 | ATL-TST-0224 | typed-tools.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 861 | ATL-TST-0225 | universal-inbox.test | VERIFIED_WORKING | 16 | nincs ismert | nincs |  | 0.0 |
| 862 | ATL-TST-0226 | update-center.test | VERIFIED_WORKING | 26 | nincs ismert | nincs |  | 0.0 |
| 863 | ATL-TST-0227 | voice-conversation-hosted.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 864 | ATL-TST-0228 | voice-conversation.test | VERIFIED_WORKING | 12 | nincs ismert | nincs |  | 0.0 |
| 865 | ATL-TST-0229 | voice-session.test | VERIFIED_WORKING | 10 | nincs ismert | nincs |  | 0.0 |
| 866 | ATL-TST-0230 | w2-architecture-assessor.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 867 | ATL-TST-0231 | w2-data-quality.test | VERIFIED_WORKING | 14 | nincs ismert | nincs |  | 0.0 |
| 868 | ATL-TST-0232 | w2-dev-assist-common.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 869 | ATL-TST-0233 | w2-doc-sync.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 870 | ATL-TST-0234 | w2-migration-planner.test | VERIFIED_WORKING | 6 | nincs ismert | nincs |  | 0.0 |
| 871 | ATL-TST-0235 | w2-test-intelligence.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 872 | ATL-TST-0236 | w3-campaign-manager.test | VERIFIED_WORKING | 3 | nincs ismert | nincs |  | 0.0 |
| 873 | ATL-TST-0237 | w3-debate-protocol.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 874 | ATL-TST-0238 | w3-decision-analysis.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 875 | ATL-TST-0239 | w3-goal-planner.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 876 | ATL-TST-0240 | w3-multi-solution.test | VERIFIED_WORKING | 1 | nincs ismert | nincs |  | 0.0 |
| 877 | ATL-TST-0241 | w3-reasoning-common.test | VERIFIED_WORKING | 9 | nincs ismert | nincs |  | 0.0 |
| 878 | ATL-TST-0242 | workbench-b1-hosted.test | VERIFIED_WORKING | 0 | nincs ismert | nincs |  | 0.0 |
| 879 | ATL-TST-0243 | workbench-hosted.test | VERIFIED_WORKING | 4 | nincs ismert | nincs |  | 0.0 |
| 880 | ATL-TST-0244 | worker-startup.test | VERIFIED_WORKING | 2 | nincs ismert | nincs |  | 0.0 |
| 881 | ATL-TST-0245 | workflow-engine.test | VERIFIED_WORKING | 11 | nincs ismert | nincs |  | 0.0 |

## Windows és mobil (4)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 882 | ATL-MOB-0001 | mobile-api | PARTIAL | 36 | 29 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:2, PARTIAL:27) \| tervezett bővítések/kapcsolatok: ATL-P… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0204 | 9.67 |
| 883 | ATL-WIN-0001 | atlasz-control-center/electron/main.mjs | CONNECTED_UNTESTED | 10 | be van kötve, de nincs közvetlen teszt \| tervezett bővítések/kapcsolatok: ATL-PLN-0078; ATL-PLN-0093 | tesztek írása | ATL-WRK-0338 | 4.5 |
| 884 | ATL-WIN-0002 | atlasz-control-center/scripts/stage-win.mjs | STRUCTURAL_ONLY | 4 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0339 | 5.0 |
| 885 | ATL-WIN-0003 | launcher/ATLASZ-Control-Center.cmd | STRUCTURAL_ONLY | 5 | nincs teszt-hivatkozás és nincs bekötés | teszt + bekötés, vagy tulajdonosi döntés a megtartásról | ATL-WRK-0340 | 5.0 |

## Ügynökök (65)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 886 | ATL-AGT-0001 | SEARCH-1 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0341 | 1.17 |
| 887 | ATL-AGT-0002 | SEARCH-2 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0342 | 4.5 |
| 888 | ATL-AGT-0003 | SEARCH-3 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0343 | 4.5 |
| 889 | ATL-AGT-0004 | SEARCH-4 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0344 | 4.5 |
| 890 | ATL-AGT-0005 | SEARCH-5 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0345 | 4.5 |
| 891 | ATL-AGT-0006 | EXECUTION-1 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0346 | 4.5 |
| 892 | ATL-AGT-0007 | EXECUTION-2 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0347 | 4.5 |
| 893 | ATL-AGT-0008 | EXECUTION-3 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0348 | 4.5 |
| 894 | ATL-AGT-0009 | EXECUTION-4 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0349 | 4.5 |
| 895 | ATL-AGT-0010 | EXECUTION-5 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0350 | 4.5 |
| 896 | ATL-AGT-0011 | EXECUTION-6 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0351 | 4.5 |
| 897 | ATL-AGT-0012 | EXECUTION-7 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0352 | 4.5 |
| 898 | ATL-AGT-0013 | EXECUTION-8 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0353 | 4.5 |
| 899 | ATL-AGT-0014 | EXECUTION-9 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0354 | 4.5 |
| 900 | ATL-AGT-0015 | EXECUTION-10 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0355 | 4.5 |
| 901 | ATL-AGT-0016 | EXECUTION-11 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0356 | 4.5 |
| 902 | ATL-AGT-0017 | EXECUTION-12 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0357 | 4.5 |
| 903 | ATL-AGT-0018 | EXECUTION-13 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0358 | 4.5 |
| 904 | ATL-AGT-0019 | EXECUTION-14 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0359 | 4.5 |
| 905 | ATL-AGT-0020 | EXECUTION-15 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0360 | 4.5 |
| 906 | ATL-AGT-0021 | EXECUTION-16 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0361 | 4.5 |
| 907 | ATL-AGT-0022 | EXECUTION-17 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0362 | 4.5 |
| 908 | ATL-AGT-0023 | EXECUTION-18 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0363 | 4.5 |
| 909 | ATL-AGT-0024 | EXECUTION-19 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0364 | 4.5 |
| 910 | ATL-AGT-0025 | EXECUTION-20 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0365 | 4.5 |
| 911 | ATL-AGT-0026 | EXECUTION-21 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0366 | 4.5 |
| 912 | ATL-AGT-0027 | EXECUTION-22 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0367 | 4.5 |
| 913 | ATL-AGT-0028 | EXECUTION-23 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0368 | 4.5 |
| 914 | ATL-AGT-0029 | EXECUTION-24 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0369 | 4.5 |
| 915 | ATL-AGT-0030 | EXECUTION-25 | PARTIAL | 36 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem f… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0370 | 4.5 |
| 916 | ATL-AGT-0031 | agent-activity | VERIFIED_WORKING | 0 | nincs ismert (részletek: a kapcsolt követelmények sorai) \| tervezett bővítések/kapcsolatok: ATL-PLN-0085 | nincs (megtartani, regressziós gate-ben) |  | 0.0 |
| 917 | ATL-AGT-0032 | agent-coordination | PARTIAL | 32 | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0013 | 5.07 |
| 918 | ATL-AGT-0033 | agent-executors | PARTIAL | 17 | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) \| tervezett bővítések/kapcsolatok: ATL-PLN-0014; AT… | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0014 | 5.53 |
| 919 | ATL-AGT-0034 | agent-factory | PARTIAL | 5 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0015 | 3.92 |
| 920 | ATL-AGT-0035 | agent-memory | PARTIAL | 28 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0016 | 4.15 |
| 921 | ATL-AGT-0036 | agent-portfolio-manager | PARTIAL | 5 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0017 | 4.15 |
| 922 | ATL-AGT-0037 | agent-registry | PARTIAL | 36 | 13 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:13) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0018 | 5.99 |
| 923 | ATL-AGT-0038 | agent-status | PARTIAL | 2 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) \| tervezett bővítések/kapcsolatok: ATL-PLN-0085 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0019 | 3.46 |
| 924 | ATL-AGT-0039 | agent-tool-broker | PARTIAL | 26 | 19 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:19) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0020 | 7.37 |
| 925 | ATL-AGT-0040 | agent-workforce | PARTIAL | 33 | 16 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:16) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0021 | 6.68 |
| 926 | ATL-AGT-0041 | capability-registry | PARTIAL | 4 | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) \| tervezett bővítések/kapcsolatok: ATL-PLN-0075 | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0022 | 3.92 |
| 927 | ATL-AGT-0042 | execution-factory | PARTIAL | 8 | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5, STRUCTURAL_ONLY:3) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0023 | 4.84 |
| 928 | ATL-AGT-0043 | handoff-ledger | PARTIAL | 17 | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0024 | 4.15 |
| 929 | ATL-AGT-0044 | qa-reviewer | PARTIAL | 12 | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0025 | 5.3 |
| 930 | ATL-AGT-0045 | team-lead-workflows | PARTIAL | 3 | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) | hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions) | ATL-WRK-0026 | 3.46 |
| 931 | ATL-AGT-0046 | Menedzser: MASTER_COORDINATOR | PARTIAL | 0 |  |  |  | 0.0 |
| 932 | ATL-AGT-0047 | Menedzser: WORKFORCE_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 933 | ATL-AGT-0048 | Menedzser: SEARCH_AGENT_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 934 | ATL-AGT-0049 | Menedzser: EXECUTION_AGENT_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 935 | ATL-AGT-0050 | Menedzser: CAMPAIGN_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 936 | ATL-AGT-0051 | Menedzser: GLOBAL_BUSINESS_INTELLIGENCE | PARTIAL | 0 |  |  |  | 0.0 |
| 937 | ATL-AGT-0052 | Menedzser: AI_MODEL_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 938 | ATL-AGT-0053 | Menedzser: SECURITY_APPROVAL_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 939 | ATL-AGT-0054 | Menedzser: MEMORY_KNOWLEDGE_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 940 | ATL-AGT-0055 | Menedzser: FINANCIAL_REVENUE_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 941 | ATL-AGT-0056 | Menedzser: RUNTIME_SUPERVISOR | PARTIAL | 0 |  |  |  | 0.0 |
| 942 | ATL-AGT-0057 | Menedzser: TASK_SCHEDULER | PARTIAL | 0 |  |  |  | 0.0 |
| 943 | ATL-AGT-0058 | Menedzser: QUALITY_ASSURANCE | PARTIAL | 0 |  |  |  | 0.0 |
| 944 | ATL-AGT-0059 | Menedzser: RECOVERY_MAINTENANCE | PARTIAL | 0 |  |  |  | 0.0 |
| 945 | ATL-AGT-0060 | Menedzser: BRAIN_MANAGER | PARTIAL | 0 |  |  |  | 0.0 |
| 946 | ATL-AGT-0061 | Beépített executor: csv_to_json | PARTIAL | 0 |  |  | ATL-WRK-0341 | 1.17 |
| 947 | ATL-AGT-0062 | Beépített executor: extract_summary | PARTIAL | 0 |  |  | ATL-WRK-0341 | 1.17 |
| 948 | ATL-AGT-0063 | Beépített executor: module_with_tests | PARTIAL | 0 |  |  | ATL-WRK-0341 | 1.17 |
| 949 | ATL-AGT-0064 | Beépített executor: implementation_plan | PARTIAL | 0 |  |  | ATL-WRK-0341 | 1.17 |
| 950 | ATL-AGT-0065 | Beépített executor: proposal_draft | PARTIAL | 0 |  |  | ATL-WRK-0341 | 1.17 |

## TERVEZETT (új/bővítendő) modul (97)

| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |
|---:|---|---|---|---:|---|---|---|---:|
| 951 | ATL-PLN-0001 | Beszélgetés-előzmény ablak és munkamenet-állapot (ismétlés/felesleges kérdés cs… | PLANNED_EXTEND | 6 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (human-core <-> conversation <-> task-ledger: előzmény-ab… | ATL-WRK-0496 | 18 |
| 952 | ATL-PLN-0002 | Hangnem- és kommunikációs mód-osztályozó (humor/komoly, barátságos/üzleti, műsz… | PLANNED_EXTEND | 6 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (human-core cue-osztályozó + assistant-profiles módok + s… | ATL-WRK-0497 | 24 |
| 953 | ATL-PLN-0003 | AURÓRA digitális avatár (2D/SVG/canvas): arc, szájmozgás, arckifejezés, fejmozg… | PLANNED | 15 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (aurora nézet + voice-session események (viseme/boundary,… | ATL-WRK-0498 | 66 |
| 954 | ATL-PLN-0004 | AURÓRA téma/skin réteg: háttérképek (hash-elt lokális asset), ikonkészlet, anim… | PLANNED | 5 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (preferences -> skin-paraméterek (--font-size, ikonkészle… | ATL-WRK-0499 | 22 |
| 955 | ATL-PLN-0005 | Fizikai robot / humanoid interfész (külön, későbbi projekt) | PLANNED_DEFERRED | 7 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (NEM aktív. Csak a tulajdonos külön döntése után: külön e… | ATL-WRK-0500 | 0 |
| 956 | ATL-PLN-0006 | Teljesítmény- és erőforrás-metrikák (CPU/RAM/GPU/VRAM/tárhely, throughput, átfu… | PLANNED | 7 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (os/process mintavétel -> health-monitor/brain-health -> … | ATL-WRK-0501 | 34 |
| 957 | ATL-PLN-0007 | Okos gyorsítótár (invalidálással) és lazy loading | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (model-gateway/search-pipeline eredmény-cache; Control Ce… | ATL-WRK-0502 | 20 |
| 958 | ATL-PLN-0008 | Sandbox teljesítmény/skála tesztcsomag és kapacitás-/terhelés-szimuláció (30 üg… | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (atlasz-tests/perf + brain/simulation-lab kapacitás-forga… | ATL-WRK-0503 | 28 |
| 959 | ATL-PLN-0009 | Generált MEMORY.md index és napi memórianaplók (memory/YYYY-MM-DD.md) | PLANNED | 4 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (memory-store + audit -> generátor -> owner-olvasható fáj… | ATL-WRK-0504 | 17 |
| 960 | ATL-PLN-0010 | Success Pattern Library (verified HISTORICAL_RESULT alapú sikermintázat-tár) | PLANNED_EXTEND | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (knowledge-brain <- verified outcome-ok) -> teszt -> hiba… | ATL-WRK-0505 | 14 |
| 961 | ATL-PLN-0011 | Tanulság-hurok: eredmény-elemzés -> lecke -> jövőbeli tervezés -> lecke-hatás n… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (verifier/hiba -> lecke-jelölt -> planner.createPlan előt… | ATL-WRK-0506 | 31 |
| 962 | ATL-PLN-0012 | Lehetőség-kimenet visszacsatolás (rejection/response/win/delivery/profit/loss/f… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (Opportunity Intelligence score <- csak ellenőrzött kimen… | ATL-WRK-0507 | 31 |
| 963 | ATL-PLN-0013 | Business Factory job-minta bányászat (ismétlődő munka, workflow, képesség-kombi… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (job-store -> minta-bányász -> sablon-javaslat (jóváhagyá… | ATL-WRK-0508 | 33 |
| 964 | ATL-PLN-0014 | Web-munka és API-munka executor (engedélyezett egress + adapter) | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (agent-executors BUILTIN_EXECUTORS + egress-policy + tool… | ATL-WRK-0509 | 26 |
| 965 | ATL-PLN-0015 | Fordító executor | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (agent-executors + modell-hozzáférés) -> teszt -> hibajav… | ATL-WRK-0510 | 15 |
| 966 | ATL-PLN-0016 | Ügyfélszolgálat / támogatási jegy és SLA modul + support executor | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (Communication Center fölé support workflow; jegy-állapot… | ATL-WRK-0511 | 39 |
| 967 | ATL-PLN-0017 | Prezentáció-generátor (PPTX) és AI-fejlesztési executor | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (executor + PPTX író + modell) -> teszt -> hibajavítás ->… | ATL-WRK-0512 | 33 |
| 968 | ATL-PLN-0018 | Táblázat-generálás (XLSX/CSV) | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (executor + XLSX/CSV író) -> teszt -> hibajavítás -> igaz… | ATL-WRK-0513 | 17 |
| 969 | ATL-PLN-0019 | Média-eszközök: videó-, hang-/zene-, 3D-munkafolyamatok, médiakonverzió és szer… | PLANNED | 9 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (tool-fabric adapter-szerződés + sandboxolt konverter (re… | ATL-WRK-0514 | 56 |
| 970 | ATL-PLN-0020 | Kreatív-elemző képesség a Brain-ben (hangulat, téma, műfaj, vizuális stílus, te… | PLANNED | 11 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (Brain elemző lépés (szerkezetes kimenet) -> stílusjavasl… | ATL-WRK-0515 | 36 |
| 971 | ATL-PLN-0021 | Kreatív projektek nyilvántartása (zene, film, történet, storyboard) és AURÓRA m… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (creative-projects registry + AURÓRA renderer + modell) -… | ATL-WRK-0516 | 36 |
| 972 | ATL-PLN-0022 | Connector-adapter: Google Contacts (descriptor + adapter + vault-kulcs + teszt … | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0517 | 12 |
| 973 | ATL-PLN-0023 | Connector-adapter: Clearbit (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0518 | 12 |
| 974 | ATL-PLN-0024 | Connector-adapter: Apollo (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0519 | 12 |
| 975 | ATL-PLN-0025 | Connector-adapter: Lusha (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0520 | 12 |
| 976 | ATL-PLN-0026 | Connector-adapter: Resend (e-mail küldő) (descriptor + adapter + vault-kulcs + … | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0521 | 12 |
| 977 | ATL-PLN-0027 | Connector-adapter: Close CRM (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0522 | 12 |
| 978 | ATL-PLN-0028 | Connector-adapter: BuildingConnected (descriptor + adapter + vault-kulcs + tesz… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0523 | 12 |
| 979 | ATL-PLN-0029 | Connector-adapter: Metricool (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0524 | 12 |
| 980 | ATL-PLN-0030 | Connector-adapter: Socialmonials (descriptor + adapter + vault-kulcs + teszt + … | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0525 | 12 |
| 981 | ATL-PLN-0031 | Connector-adapter: WordPress / CMS (descriptor + adapter + vault-kulcs + teszt … | PLANNED | 3 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0526 | 12 |
| 982 | ATL-PLN-0032 | Connector-adapter: Nano Banana (kép) (descriptor + adapter + vault-kulcs + tesz… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0527 | 12 |
| 983 | ATL-PLN-0033 | Connector-adapter: HeyGen (videó) (descriptor + adapter + vault-kulcs + teszt +… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0528 | 12 |
| 984 | ATL-PLN-0034 | Connector-adapter: Runway (videó) (descriptor + adapter + vault-kulcs + teszt +… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0529 | 12 |
| 985 | ATL-PLN-0035 | Connector-adapter: LTX Studio (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0530 | 12 |
| 986 | ATL-PLN-0036 | Connector-adapter: Veo (videó) (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0531 | 12 |
| 987 | ATL-PLN-0037 | Connector-adapter: Suno (zene) (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0532 | 12 |
| 988 | ATL-PLN-0038 | Connector-adapter: CapCut (descriptor + adapter + vault-kulcs + teszt + UI) | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0533 | 12 |
| 989 | ATL-PLN-0039 | Connector-adapter: DaVinci Resolve (descriptor + adapter + vault-kulcs + teszt … | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0534 | 12 |
| 990 | ATL-PLN-0040 | Connector-adapter: Shutter Encoder (descriptor + adapter + vault-kulcs + teszt … | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (connector-catalog descriptor -> universal-connector-laye… | ATL-WRK-0535 | 12 |
| 991 | ATL-PLN-0041 | Blockchain / Web3 / okosszerződés / tokenizáció / NFT fejlesztői szolgáltatás (… | PLANNED | 5 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (executor + sandbox + audit-szabályok; felderítés mint sk… | ATL-WRK-0536 | 46 |
| 992 | ATL-PLN-0042 | Ismétlődő szolgáltatás életciklus: előfizetéses lehetőségek, megújítás-követés,… | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (recurring-billing <-> delivery-service <-> qa-factory + … | ATL-WRK-0537 | 31 |
| 993 | ATL-PLN-0043 | Adaptive Sales (igaz, nem manipulatív bizonyíték-alapú értékesítési adaptáció) | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (client-dna-engine -> negotiation/follow-up; manipulatív … | ATL-WRK-0538 | 28 |
| 994 | ATL-PLN-0044 | Business Proof Package generátor (outreach > won > delivery > QA > bevétel > pr… | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (ledger/trace -> hash-manifesztes export) -> teszt -> hib… | ATL-WRK-0539 | 25 |
| 995 | ATL-PLN-0045 | KÜLÖN kereskedelmi licenc-rendszer (nem a tulajdonos belső ATLASZ-példánya): li… | PLANNED_DEFERRED | 5 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (NEM aktív. A direktíva szerint külön tulajdonosi jóváhag… | ATL-WRK-0540 | 84 |
| 996 | ATL-PLN-0046 | Piactípus mező és lefedettségi riport (B2B, B2C, B2G, B2B2C, D2C, C2B) | PLANNED_EXTEND | 3 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (opportunity modell piactípus mező + riport) -> teszt -> … | ATL-WRK-0541 | 12 |
| 997 | ATL-PLN-0047 | Versenytárs-gyűjtő, ár-benchmark és árazási ajánlás, versenyfeltételek | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (market-intelligence -> proposal-quote; hivatkozott forrá… | ATL-WRK-0542 | 33 |
| 998 | ATL-PLN-0048 | Biztonságos távoli kapcsolat (TLS / VPN) a mobil/távoli vezérléshez | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (mobile-api <- TLS terminálás/VPN; owner-auth) -> teszt -… | ATL-WRK-0543 | 30 |
| 999 | ATL-PLN-0049 | Függőség- és konténer-vizsgálat: npm audit/OSV, SBOM, trivy/grype a Dockerfile.… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (CI workflow lépés + scripts/ ellenőrző) -> teszt -> hiba… | ATL-WRK-0544 | 20 |
| 1000 | ATL-PLN-0050 | Képernyőkép titok-ellenőrző (OCR előszűrő / kézi checklist) | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (file-intake -> OCR/ellenőrzőlista -> secret-patterns) ->… | ATL-WRK-0545 | 20 |
| 1001 | ATL-PLN-0051 | main ág védelme (GitHub branch protection + pre-push hook) | DECISION_PENDING | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (tulajdonos oldali GitHub beállítás + helyi pre-push hook… | ATL-WRK-0546 | 3 |
| 1002 | ATL-PLN-0052 | Futásidejű önjavítás: hibás folyamat újraindítása (restartComponent), deadlock-… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (supervisor-safe restartComponent (budget, owner riasztás… | ATL-WRK-0547 | 38 |
| 1003 | ATL-PLN-0053 | Több gép / több példány közötti adatzár: döntés (egypéldányos telepítés + példá… | DECISION_PENDING | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (D-04/D-05 javításával együtt) -> teszt -> hibajavítás ->… | ATL-WRK-0548 | 15 |
| 1004 | ATL-PLN-0054 | Pont-időponti visszaállítás (naplóalapú visszajátszás) és adatbázis-mentés / tá… | DECISION_PENDING | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (audit-lánc visszajátszás + tár-döntés) -> teszt -> hibaj… | ATL-WRK-0549 | 26 |
| 1005 | ATL-PLN-0055 | Konfiguráció-, ügynök/workflow- és connector-konfiguráció verziózás | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (verzió/hash mező + változás-napló) -> teszt -> hibajavít… | ATL-WRK-0550 | 14 |
| 1006 | ATL-PLN-0056 | Adatvédelmi megfelelés: export/törlés kérelem kezelő, adatvédelmi beállítások | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (export/törlés workflow + settings nézet) -> teszt -> hib… | ATL-WRK-0551 | 34 |
| 1007 | ATL-PLN-0057 | PDF-eszköztár: készítés, szerkesztés (eredeti megőrzésével), egyesítés/felosztá… | PLANNED | 3 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (tool-fabric adapter vagy beépített író; owner jóváhagyás… | ATL-WRK-0552 | 44 |
| 1008 | ATL-PLN-0058 | Biztonságos fájlkonvertáló (sandboxolt) és konverzió-validáció | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (restricted-node konverter + validáció) -> teszt -> hibaj… | ATL-WRK-0553 | 23 |
| 1009 | ATL-PLN-0059 | Szemantikus dokumentumkeresés (Doc Center -> semantic-index + helyi embedding) | PLANNED_EXTEND | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (Doc Center indexelés -> semantic-index) -> teszt -> hiba… | ATL-WRK-0554 | 17 |
| 1010 | ATL-PLN-0060 | Dokumentum-munkafolyamat kiegészítők: verzió-összehasonlítás, csatolmány-lánc (… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (inbox -> file-intake -> document-center; text-compare; g… | ATL-WRK-0555 | 39 |
| 1011 | ATL-PLN-0061 | GST/PST szabálybázis, ITC előkészítés, időszakos összesítés, PST-köteles tranza… | PLANNED | 4 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (tax-accounting-engine + dokumentált (forrásolt) adószabá… | ATL-WRK-0556 | 48 |
| 1012 | ATL-PLN-0062 | Adó-rekordok entitás/tenant mező és szűrés | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (kötelező entity/tenant mező) -> teszt -> hibajavítás -> … | ATL-WRK-0557 | 9 |
| 1013 | ATL-PLN-0063 | Könyvelőnek átadható dokumentumcsomag (főkönyv + dokumentumok + hash-manifeszt,… | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (governed export) -> teszt -> hibajavítás -> igazolt lezá… | ATL-WRK-0558 | 25 |
| 1014 | ATL-PLN-0064 | Tranzakció-kategorizáló (szabály alapú, owner review-val) | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (szabály -> javasolt kategória -> owner review) -> teszt … | ATL-WRK-0559 | 20 |
| 1015 | ATL-PLN-0065 | Website Manager: domain/DNS/SSL munkafolyamatok (jóváhagyással), weboldal-művel… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (fázisgép + owner jóváhagyás + connectorok) -> teszt -> h… | ATL-WRK-0560 | 62 |
| 1016 | ATL-PLN-0066 | SEO audit, web analitika (valós szolgáltatói adat), web QA (a11y-audit újrahasz… | PLANNED | 3 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (executor + a11y-audit + analitika-connector) -> teszt ->… | ATL-WRK-0561 | 42 |
| 1017 | ATL-PLN-0067 | Web/app fejlesztési munkafolyamat (sablon + build + teszt + csomag) és website/… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (dev-assist + executor + jóváhagyási kapu) -> teszt -> hi… | ATL-WRK-0562 | 48 |
| 1018 | ATL-PLN-0068 | Térkép / helymeghatározás modul szolgáltató-adapterekkel: geocoding, címkeresés… | PLANNED | 12 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (absztrakció + szolgáltató-adapter (OSM/Google) + UI térk… | ATL-WRK-0563 | 56 |
| 1019 | ATL-PLN-0069 | Lehetőség -> döntés -> munka -> eredmény -> pénz nyomkövető nézet (egy felületr… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (korreláció-alapú trace API + Control Center nézet) -> te… | ATL-WRK-0564 | 31 |
| 1020 | ATL-PLN-0070 | Executive Owner Dashboard (egyoldalas tulajdonosi összkép) és why/next-tasks né… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (/api/status,/api/finance,... összefoglaló nézet; brain-v… | ATL-WRK-0565 | 28 |
| 1021 | ATL-PLN-0071 | Notification Center (prioritás: ACTION_REQUIRED, csoportosítás kulcs+ablak alap… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (event-bus -> notification center -> UI) -> teszt -> hiba… | ATL-WRK-0566 | 23 |
| 1022 | ATL-PLN-0072 | Üzletmenet-folytonossági terv: kritikus komponensek, függőségi modell, SPOF-ele… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (capability-graph függőségek + recovery-source-map -> rip… | ATL-WRK-0567 | 30 |
| 1023 | ATL-PLN-0073 | System Doctor és startup-self-check kiegészítés: memory, knowledge, money engin… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (doctorV2 probe-ok + runStartupSelfCheck) -> teszt -> hib… | ATL-WRK-0568 | 21 |
| 1024 | ATL-PLN-0074 | Owner parancs: 'Show security warnings' (SHOW_SECURITY_WARNINGS intent) és Secu… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (owner-command intent -> security-brain; authorize/execut… | ATL-WRK-0569 | 15 |
| 1025 | ATL-PLN-0075 | Nyilvántartási séma-bővítések: capabilities/dependencies/configuration/permissi… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (leíró-sémák kiegészítése + betöltési ellenőrzés + teszt)… | ATL-WRK-0570 | 26 |
| 1026 | ATL-PLN-0076 | Modell-nyilvántartás metaadatok: rate-limit, régió, szolgáltatói megkötések/ÁSZ… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (model-registry + model-evolution + policy érvényesítés) … | ATL-WRK-0571 | 29 |
| 1027 | ATL-PLN-0077 | Modell-benchmark készlet (reasoning, coding, research, task completion, tool-ca… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (benchPrompts bővítés + pontozás) -> teszt -> hibajavítás… | ATL-WRK-0572 | 21 |
| 1028 | ATL-PLN-0078 | Frissítési csővezeték kiegészítés: biztonságos letöltő (allowlist+hash/aláírás)… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (update-center + egress-policy + electron relaunch + supe… | ATL-WRK-0573 | 52 |
| 1029 | ATL-PLN-0079 | Felderítési webhook / eseményfeed vevő (aláírt, allowlistelt, receive-only), fe… | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (payment-webhook-receiver mintájú receive-only vevő + dis… | ATL-WRK-0574 | 34 |
| 1030 | ATL-PLN-0080 | Beszerzési forrás-adapterek: magán RFP/RFQ/alvállalkozói, beszállítói regisztrá… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (global-discovery SOURCE_CATALOGUE + adapter + policy (TE… | ATL-WRK-0575 | 56 |
| 1031 | ATL-PLN-0081 | Piaci adat-adapter (inaktív, jóváhagyásig), részvényindex-forrás és autonóm str… | PLANNED | 0 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (inaktív adapter-keret + kutatási munkafolyamat; valódi k… | ATL-WRK-0576 | 48 |
| 1032 | ATL-PLN-0082 | Egyéb jóváhagyott kártevő-motor adapter (csak tulajdonosi igényre) | PLANNED_DEFERRED | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (Nem aktív) -> teszt -> hibajavítás -> igazolt lezárás | ATL-WRK-0577 | 0 |
| 1033 | ATL-PLN-0083 | Szerződés-ellenőrzés kategóriák (visszatérítési feltételek, szükséges hitelesít… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (szabály-kategóriák) -> teszt -> hibajavítás -> igazolt l… | ATL-WRK-0578 | 12 |
| 1034 | ATL-PLN-0084 | Stripe balance állapot a payment-events-ben és a 'discovery' műveleti kisbővíté… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (balance eseménytípus) -> teszt -> hibajavítás -> igazolt… | ATL-WRK-0579 | 9 |
| 1035 | ATL-PLN-0085 | Ügynökök állapota: AGENTS olvasó végpont (agentsActivity) és nézet-bekötés | PLANNED_EXTEND | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (agentsActivity -> /api route -> Control Center nézet) ->… | ATL-WRK-0580 | 9 |
| 1036 | ATL-PLN-0086 | Technológia költség-ellenőrzés a tech-watch folyamatban (COST CHECK lépés) | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (tech-watch -> költségbecslés (UNKNOWN alapérték)) -> tes… | ATL-WRK-0581 | 9 |
| 1037 | ATL-PLN-0087 | Felderítési kategória-bővítés: AI-rendszerek és automatizálási technológiák | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (kategória + forrás bővítés) -> teszt -> hibajavítás -> i… | ATL-WRK-0582 | 12 |
| 1038 | ATL-PLN-0088 | Jövőbeli, külön engedélyezett élő kereskedési teljesítmény-nézet | PLANNED_DEFERRED | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (Nem aktív; requestLiveTrading elutasít) -> teszt -> hiba… | ATL-WRK-0583 | 0 |
| 1039 | ATL-PLN-0089 | Gépi rendszerleltár 12 mezős tételsorokkal: sebezhetőség-scan (static_scan.json… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (a v2 leltár-generátor (docs/system_inventory) kiegészíté… | ATL-WRK-0584 | 14 |
| 1040 | ATL-PLN-0090 | Plugin-típusok: connector, média, dokumentum plugin manifest-séma | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (manifest típus + betöltés + teszt) -> teszt -> hibajavít… | ATL-WRK-0585 | 15 |
| 1041 | ATL-PLN-0091 | Engedélyezett valódi connector-teszt és futási bizonyíték-gyűjtés | DECISION_PENDING | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (owner által engedélyezett fiókok) -> teszt -> hibajavítá… | ATL-WRK-0586 | 20 |
| 1042 | ATL-PLN-0092 | Teszt-kategóriák és mutációs tesztelés (unit/contract/integration/E2E/negative/… | PLANNED | 1 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (atlasz-tests + mutációs harness kritikus modulokra) -> t… | ATL-WRK-0587 | 42 |
| 1043 | ATL-PLN-0093 | Valódi STAGING környezet, Windows CI + test hardening (LF, junction symlink, rm… | DECISION_PENDING | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (Windows gép / staging host + Joci kulcsa) -> teszt -> hi… | ATL-WRK-0588 | 50 |
| 1044 | ATL-PLN-0094 | T3 hardening: duplikált/hub-bag implementációk konszolidációja (32 modul), Math… | PLANNED_EXTEND | 0 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (modulonkénti döntés + csere + route) -> teszt -> hibajav… | ATL-WRK-0589 | 34 |
| 1045 | ATL-PLN-0095 | Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-… | PLANNED_DEFERRED | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (NEM aktív. Csak tulajdonosi döntés után: issue-bevitel +… | ATL-WRK-0782 | 34 |
| 1046 | ATL-PLN-0096 | Hiányzó Control Center képernyők: Deliveries (szállítások), külön DEALS képerny… | PLANNED_EXTEND | 1 | a teljes bővítés | terv/szerződés -> megépítés vagy bővítés -> bekötés (meglévő /api route-ok -> új nézetek az app.js navigációb… | ATL-WRK-0783 | 23 |
| 1047 | ATL-PLN-0097 | Látás- és környezet-érzékelés: tárgy- és eszközfelismerés (Object and Equipment… | PLANNED | 2 | a teljes modul | terv/szerződés -> megépítés vagy bővítés -> bekötés (modality-fabric képbemenet -> vision szolgáltató-adapter… | ATL-WRK-0784 | 50 |

