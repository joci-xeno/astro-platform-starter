# ROUND 2 UPDATE (supersedes round-1 statuses where they differ)

Branch `atlasz-v73-integration` (bundle `atlasz-v73-integration.bundle`). Production `start` and Railway untouched.

**DONE + TESTED (87/87 `node --test`, mutation-checked):** owner auth (Ed25519), JOCI-only kill switch (+CLI alternate path), hash-chained audit, durable queue, backup/restore/LKG/recovery drill, 14 modules without bare-boolean approvals, Update Center / Safe Update System (17 tests), `start:canonical` (5+25) with real-process test, `test` script, Owner CLI (keygen/sign/emergency), probe-evidence rule for LIVE flags, contract tests for 11 pre-existing modules.

**Registry:** 837 records = 815 original + 22 new (ATLASZ-UC-*, ATLASZ-CR-*). All 53 sections have a status. Items inherit section status (`status_basis`) until individually verified, so item-level counts are NOT item-verified, except the 22 new IDs.

**BLOCKED / EXTERNAL:** Joci's real owner public key (owner auth cannot be LIVE), model/voice/computer-use providers, payment evidence source, tax rules, Railway state (UNKNOWN), network in sandbox.
**JOCI APPROVAL NEEDED:** live Railway switch to `start:canonical`; any spending; production owner key provisioning.
**NOT BUILT (BUILD):** Windows Control Center GUI (incl. UPDATE CENTER view and GUI owner functions), Secret Vault, Human Core, document/inbox/media/website/map/performance/mobile centers, watchdog/system doctor/safe mode, durable storage for most addon modules, real update adapters.
**STILL TO REPAIR:** caller-set status in universal-connector-layer and executor-toolbox-registry.

---

# ATLASZ V7.3 — Audit report (1. kör)

Alap: `atlasz-all.bundle` (git fsck OK, 7 branch). Elsődleges vizsgált csúcs: `atlasz-money-pilot` @ `ad6c483`.
**Módszer:** statikus olvasás + `node --check` (63 fájl) + az 59 addon-modul dinamikus importja + secret-minta keresés az összes ág teljes történetében (értékek nem kerültek kiírásra).
**Amit NEM végeztem el:** futtatás / E2E (nincs tesztkészlet), Railway állapot (**UNKNOWN**), a szakasz alatti követelmények kód szintű összevetése.

## 1. Branch-térkép

| Branch | Head | Szerep (kód alapján) | Viszony |
|---|---|---|---|
| `atlasz-money-pilot` | ad6c483 (10-05) | Lánc csúcsa: money pipeline controller + integration hub bekötés | runtime ⊂ builder ⊂ money-pilot |
| `atlasz-codex-builder` | fbed4e4 (10-04) | + approval command gateway, final követelmény-tracking | |
| `atlasz-30-runtime` | 1b9b91e (10-04) | Alap runtime + addons | **azonos headű** az `atlasz-codex-auditor`-ral |
| `atlasz-codex-auditor` | 1b9b91e (10-04) | = `atlasz-30-runtime` | |
| `codex/atlasz-worker-build-repair` | 7c0d924 (10-01) | 3 commit: Gemini-javítás, spending-guard, Dockerfile.worker | **nincs benne a láncban** |
| `atlasz-additive-modules` | 1d3d1a5 (10-01) | 7 kis modul (deal-state, profit-ledger…) | a láncban ezek már nagyobbak/jelen vannak |
| `main` | b506c42 (09-30) | Régebbi, **eltérő** runtime (opportunity queue, A/B/C rang) | **8 commit nincs a láncban** |

Egyik ág sem "automatikusan a legjobb": a lánc csúcsa a legteljesebb addon-készlet, de a javítások és a `main` munkája külön ágon vannak.

## 2. Találatok

| # | Találat | Súly | Státusz |
|---|---|---|---|
| F1 | `atlasz-runtime/agent-child.js` **szintaxishibás** (102. sor) az `atlasz-30-runtime`, `additive-modules`, `builder`, `money-pilot` ágon → a worker nem indul. A javítás csak a `worker-build-repair` ágon van | BROKEN | **Javítva helyi ágon** (patch), `node --check` OK; futtatni nem tudtam |
| F2 | A spending-guard (`ATLASZ_LEGACY_AI_APPROVED`) szintén csak a javító ágon van. **Viselkedésváltozás:** a legacy AI-ciklus BLOCKED, amíg a változó nincs `true`-ra állítva | Financial Firewall | a patch tartalmazza; Joci döntse el |
| F3 | Két runtime él egymás mellett. `supervisor.js` = 30 egyforma, modellhívó worker (**ezt indítja az `npm start` és a `Dockerfile.worker`**). `supervisor-safe.mjs` = 5 SEARCH + 25 EXECUTION, fizetős AI nélkül. A V7.3 csak az utóbbit támasztja alá | PARTIAL | **JOCI DÖNTÉS** |
| F4 | `emergency-stop.mjs`: az owner-hitelesítés egy hívó által megadott boolean, miközben a saját approval gateway szerint boolean nem fogadható el erős hitelesítésként; in-memory, nincs GUI | STRUCTURAL_ONLY | építendő |
| F5 | **Nincs** Windows desktop kód, nincs tesztkészlet, nincs backup/restore (grep-szint), nincs durable tároló. A gyökér Astro-oldal a változatlan Netlify starter sablon | MISSING | építendő |
| F6 | `main` `worker.js`: `atlasz-competition-v1` policy (30 agent, 6×5 csapat), MAX_OPPS 1000, több opportunity-logika. Lehet, hogy a **kizárt 300-agent/verseny projekt** nyoma | ? | **JOCI DÖNTÉS** — nem olvasztom be vakon |
| F7 | Secretek csak env-ből jönnek; 0 találat 7 mintára az összes ág történetében, nincs `.env` fájl commitolva | rendben | EXISTS_NEEDS_TEST |

A kód jellemzően őszinte: a modulok nem jelölnek LIVE-nak semmit bizonyíték nélkül (`PLACEHOLDER_UNCONNECTED` → `CONNECTED_UNTESTED` → `LIVE`).

## 3. Gap map (szakasz szint; a 43 többi szakasz még AUDIT_PENDING)

| V7.3 | Státusz | Döntés |
|---|---|---|
| S05 Voice | STRUCTURAL_ONLY | COMPLETE (provider + teszt kell) |
| S09 30 agent | PARTIAL | COMPLETE — F3 döntés után |
| S10 Queue/durable | STRUCTURAL_ONLY | COMPLETE (perzisztencia) |
| S12 Never fake status | EXISTS_NEEDS_TEST | TEST → REUSE |
| S13 Financial Firewall | STRUCTURAL_ONLY | COMPLETE + REPAIR (F2) |
| S14 Kill switch | STRUCTURAL_ONLY | REPAIR (F4) + E2E teszt |
| S21 Desktop/Mission Control | MISSING | BUILD |
| S35 Evidence/tesztek | MISSING | BUILD |
| S36 Security/owner auth | STRUCTURAL_ONLY | COMPLETE (verifier, vault) |
| S37 Backup/restore | MISSING | BUILD |

A teljes, géppel követhető állapot: `atlasz_v73_requirement_registry.json/.csv`.

## 4. Javasolt következő lépések
1. Joci dönt F2, F3, F6 kérdésben.
2. Patch alkalmazása (`git am atlasz-repair-agent-child.patch` a `money-pilot` csúcsán), majd egy valódi `node --test` smoke-készlet az addonokra (jelenleg 0 teszt).
3. P0 sorrend: kill switch erős auth → owner auth verifier → durable queue/checkpoint → backup/restore.
4. Desktop (S21) csak a P0 stabilizálása után.

## 5. Round 5 (continuation authorization) — what changed
Registry (853 records): EXISTS_AND_WORKING 167 → 185, PARTIAL 330 → 382, MISSING 264 → 195 (item-level, evidence in `docs/registry_item_audit_p5.py`). Nothing is LIVE against a real provider.

New modules (all with meaningful positive and negative tests): financial ledger; local offline Update Center adapters; plugin/theme manager; Human Core and daily brief; Document Center; Universal Inbox; Voice session state machine; owner-authenticated mobile API (replay-safe); Digital Twin; tenant isolation + signed entitlements + sanitized distribution builder; provider resilience (circuit breakers, no-spend routing); connector catalog (12 connectors, vault credentials, read-only probes); Tech Watch.

Control Center panels added: Home, Finance (revenue/costs/profit), Evidence, Plugins/Themes, Documents, Inbox, Voice (real status), Connectors, Tech Watch.

Honest limits: no provider/connector credentials exist, so every connector is BLOCKED_NO_CREDENTIALS or NO_SAFE_PROBE; voice is BLOCKED_NO_PROVIDER; the mobile API is not exposed on any port; Electron/Windows installer is blocked (registry 403); GitHub push is blocked (repo not authorized for this session); Railway status UNKNOWN. New modules are not yet the dispatch path of the 30-agent runtime.
