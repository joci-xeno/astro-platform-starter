# ATLASZ AURÓRA V7.3 — KIBŐVÍTETT TELJES RENDSZERLELTÁR (2. kiadás)

Dátum: 2026-10-12 · repó-állapot (HEAD a generáláskor): `b5870e8` · ág: `atlasz-v73-integration`

> **Csak felmérés, azonosítás és dokumentálás.** A futó rendszer kódja nem változott; hiányzó modul nem épült meg; külső szolgáltatás nem lett aktiválva; költség nem keletkezett. A tervezett (PLANNED) elemek **nem léteznek**, sehol sem szerepelnek működőként. A munkaórák **tervezési becslések**, nem mérések. Fixture/helyi teszt-bizonyíték **nem** élő bizonyíték (valós külső rendszerrel igazolt elem: 0).

## 1. Összefoglaló — három külön számsor

A kérésed szerint az eredeti követelmények, a létező rendszerelemek és a tervezett modulok számát **külön** vezetem; ezek nem összeadhatók.

| Számsor | Darab | Mi ez |
|---|---:|---|
| **Eredeti követelmény-tétel** (23 fejezet sorai, 85 képesség, 23 biztonsági/infra, 150 ötlet) | 2117 | `requirements_matrix.csv` (ebből 1859 a 23 fejezet sora: 1564 követelmény + 166 cím + 129 leíró sor; 258 a 85/23/150) |
| **Tulajdonosi direktíva- és specifikáció-sor** (42 feltöltött direktíva + V7.3 mester-regiszter) | 12476 | `directive_items.csv` — mindegyik sor azonosítót (ATL-DIR / ATL-SPC) kapott, besorolva |
| **Létező rendszerelem** (megőrzött v1: 898 + ebben a körben új, valós nyilvántartásba vett: 52) | 950 | `inventory_items.csv` (meglévő sorok) |
| **Tervezett modul / bővítés / döntés / halasztott projekt** (még NEM létezik) | 97 | `planned_modules.csv` — új modul: 67, meglévő bővítése: 20, tulajdonosi döntést igénylő: 5, halasztott: 5 |
| Forrásdokumentum (ATL-SRC) / konfig-állapotfájl (ATL-CFG) | 159 / 41 | `sources.csv`, `config_files.csv` |
| Munkaterv-feladat (ATL-WRK) | 784 | ebből a korábbi 340 sor változatlanul benne, +444 új; aktív terv: 632 feladat, halasztott: 152 |
| Megállapítás (ATL-FND) / tulajdonosi döntés (ATL-DEC) | 302 / 57 | `findings.csv`, `owner_decisions.csv` |

**Becsült munka:** aktív terv **5150 óra** (megvalósítás 3249 + ellenőrzés 1902). Halasztott/jövőbeli tételek tájékoztató becslése külön: 1049 óra (nem része az aktív tervnek, nem aktivált). A becslés módszere: állapot-alapú óranorma komponensenként/modulonként (lásd 12. pont); ±40% bizonytalansággal olvasandó.

## 2. Mi változott az 1. kiadáshoz képest (megőrzés + korrekciók)

* A 898 v1 azonosító és név **változatlan**; a v1 ledger és a változásnapló csak bővült (nincs törlés, nincs újraszámozás).
* **Új, valós elemek** nyilvántartásba véve (a v1 kihagyta): 15 menedzseri szerepkör, 12 biztonsági kapu (G01–G12), 5 beépített executor, 19 felderítési forrás-leíró, a 14. AI-szolgáltató (vercel-ai-gateway) — összesen 52 meglévő elem; továbbá 116 repó-dokumentum (ATL-SRC) és 41 konfigurációs/állapot/CI/bizonyíték fájl (ATL-CFG).
* **Saját v1-hibáim javítása** (`corrections_to_v1.csv`, a változásnaplóban CORRECTED eseményként):
  * `ATL-OPS-0031` atlasz-runtime/agent-child.js — status: `VERIFIED_WORKING` → `LEGACY_QUARANTINED` (v1 hiba: a karanténba tett régi futtatókörnyezeti fájl rendes elemként volt besorolva)
  * `ATL-OPS-0031` atlasz-runtime/agent-child.js — integration_status: `Master:nem; Ügynökök:nem; ControlCenter:nem; CC-induláskor …` → `KARANTÉN: nincs bekötve a kanonikus futtatókörnyezetbe (tulajdonosi döntés)` (legacy quarantine)
  * `ATL-OPS-0031` atlasz-runtime/agent-child.js — next_action: `nincs (megtartani, regressziós gate-ben)` → `Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-gua…` (legacy quarantine)
  * `ATL-OPS-0035` atlasz-runtime/supervisor.js — status: `PARTIAL` → `LEGACY_QUARANTINED` (v1 hiba: a karanténba tett régi futtatókörnyezeti fájl rendes elemként volt besorolva)
  * `ATL-OPS-0035` atlasz-runtime/supervisor.js — integration_status: `Master:nem; Ügynökök:nem; ControlCenter:nem; CC-induláskor …` → `KARANTÉN: nincs bekötve a kanonikus futtatókörnyezetbe (tulajdonosi döntés)` (legacy quarantine)
  * `ATL-OPS-0035` atlasz-runtime/supervisor.js — next_action: `hiányzó rész kiegészítése / bekötése a prioritásos munkalis…` → `Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-gua…` (legacy quarantine)
  * `ATL-OPS-0036` atlasz-runtime/worker.js — status: `PARTIAL` → `LEGACY_QUARANTINED` (v1 hiba: a karanténba tett régi futtatókörnyezeti fájl rendes elemként volt besorolva)
  * `ATL-OPS-0036` atlasz-runtime/worker.js — integration_status: `Master:nem; Ügynökök:nem; ControlCenter:nem; CC-induláskor …` → `KARANTÉN: nincs bekötve a kanonikus futtatókörnyezetbe (tulajdonosi döntés)` (legacy quarantine)
  * `ATL-OPS-0036` atlasz-runtime/worker.js — next_action: `hiányzó rész kiegészítése / bekötése a prioritásos munkalis…` → `Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-gua…` (legacy quarantine)
  * `ATL-OPS-0036` atlasz-runtime/worker.js — known_defects: `D-11: SEARCH hn.algolia kérés nem az aláírt egress-policy-n…` → `nincs ismert (karanténban lévő legacy fájl; a D-11 a kanonikus supervisor-safe.…` (D-11 téves fájl-hozzárendelés)
  * `ATL-OPS-0034` atlasz-runtime/supervisor-safe.mjs — known_defects: `D-04: nincs állapotmappa-zár; két runtime ugyanazt a felada…` → `D-04: nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti; D-06:…` (D-11 helyes fájl-hozzárendelés (kanonikus runtime))
* A régi (competition-v1) futtatókörnyezet három fájlja a **tulajdonosi karantén-döntés** szerint `LEGACY_QUARANTINED` — nem számít működő elemnek. A v1 korábban VERIFIED_WORKING-nak/PARTIAL-nak vette őket; ez téves volt.
* A v1 CSV/JSON fájlok **történeti pillanatképként** érintetlenek maradtak; az érvényes állapot a `docs/system_inventory/` kimenetekben van.

## 3. Meglévő rendszerelemek — állapot (bizonyíték-alapú, fixture/helyi szint)

Összes meglévő elem: **950** — VERIFIED_WORKING: 412, PARTIAL: 334, CONNECTED_UNTESTED: 39, STRUCTURAL_ONLY: 14, MOCK_ONLY: 23, EXTERNAL_BLOCKER: 44, OWNER_APPROVAL_REQUIRED: 1, NOT_YET_VERIFIED: 77, BROKEN: 2, MISSING: 1, LEGACY_QUARANTINED: 3

> A `VERIFIED_WORKING` itt azt jelenti: a kód valódi, bekötött, a célzott teszt lefut és zöld, **helyi/fixture szinten**. Élő külső bizonyíték nincs (élő modell, Stripe, KOHO, e-mail, hang, Windows: 0).

### Csoportok szerint (a kért 13 szakasz)

| Csoport | Elem | Állapot-eloszlás |
|---|---:|---|
| AI-modellek és adapterek | 28 | PARTIAL: 8, MOCK_ONLY: 6, EXTERNAL_BLOCKER: 13, MISSING: 1 |
| API-k | 123 | VERIFIED_WORKING: 82, PARTIAL: 4, CONNECTED_UNTESTED: 37 |
| AURÓRA | 5 | PARTIAL: 5 |
| Beszéd és hang | 3 | MOCK_ONLY: 3 |
| Biztonsági rendszerek | 51 | VERIFIED_WORKING: 5, PARTIAL: 44, STRUCTURAL_ONLY: 1, MOCK_ONLY: 1 |
| Connectorok / integrációk | 44 | PARTIAL: 1, STRUCTURAL_ONLY: 5, MOCK_ONLY: 10, EXTERNAL_BLOCKER: 28 |
| Dokumentum és kommunikáció | 8 | PARTIAL: 8 |
| Fejlesztő-asszisztens | 8 | VERIFIED_WORKING: 1, PARTIAL: 7 |
| Felület | 75 | VERIFIED_WORKING: 61, PARTIAL: 11, STRUCTURAL_ONLY: 2, BROKEN: 1 |
| Felület / avatár / multimodális | 5 | PARTIAL: 4, STRUCTURAL_ONLY: 1 |
| Háttérfolyamatok és automatizálások | 16 | PARTIAL: 15, BROKEN: 1 |
| MASTER BRAIN | 45 | VERIFIED_WORKING: 8, PARTIAL: 36, CONNECTED_UNTESTED: 1 |
| Memória és tudás | 15 | PARTIAL: 14, MOCK_ONLY: 1 |
| Működtetés / helyreállítás / háttér | 36 | VERIFIED_WORKING: 2, PARTIAL: 30, STRUCTURAL_ONLY: 1, LEGACY_QUARANTINED: 3 |
| Nem ATLASZ sablon | 1 | NOT_YET_VERIFIED: 1 |
| Piackutatás / felderítés | 38 | VERIFIED_WORKING: 4, PARTIAL: 14, MOCK_ONLY: 1, EXTERNAL_BLOCKER: 1, NOT_YET_VERIFIED: 18 |
| Pluginok / skillek / eszközök | 8 | PARTIAL: 8 |
| Pénzügyi és üzleti modulok | 62 | VERIFIED_WORKING: 1, PARTIAL: 57, MOCK_ONLY: 1, EXTERNAL_BLOCKER: 2, OWNER_APPROVAL_REQUIRED: 1 |
| Tanulás és produktivitás | 3 | PARTIAL: 3 |
| Tesztek és ellenőrző eszközök | 307 | VERIFIED_WORKING: 247, STRUCTURAL_ONLY: 2, NOT_YET_VERIFIED: 58 |
| Windows és mobil | 4 | PARTIAL: 1, CONNECTED_UNTESTED: 1, STRUCTURAL_ONLY: 2 |
| Ügynökök | 65 | VERIFIED_WORKING: 1, PARTIAL: 64 |
| TERVEZETT (új/bővítendő) modul | 97 | PLANNED: 67, PLANNED_EXTEND: 20, PLANNED_DEFERRED: 5, DECISION_PENDING: 5 |

A teljes számozott lista: **`LELTAR_TELJES_LISTA.md`** (és `inventory_items.csv`). Minden sorban: azonosító, megnevezés, állapot, kapcsolódó követelmény, hiányosság, javítási terv, becsült idő.

### Hibás vagy hiányos meglévő elemek (nem VERIFIED_WORKING)

Összesen **538** meglévő elem nem teljesen igazolt: PARTIAL: 334, CONNECTED_UNTESTED: 39, STRUCTURAL_ONLY: 14, MOCK_ONLY: 23, EXTERNAL_BLOCKER: 44, OWNER_APPROVAL_REQUIRED: 1, NOT_YET_VERIFIED: 77, BROKEN: 2, MISSING: 1, LEGACY_QUARANTINED: 3. A legsúlyosabbak (BROKEN / ismert hibával / P0–P1):

| ATL | Elem | Állapot | Ismert hiba / hiány | Munka |
|---|---|---|---|---|
| ATL-API-0088 | POST /api/updates/install | PARTIAL | D-02: /api/updates/install és /api/plugins/enable hibánál HTTP 200 ok:true; a UI 'done'-t mutat | ATL-WRK-0002 |
| ATL-API-0106 | POST /api/plugins/enable | PARTIAL | D-02: /api/updates/install és /api/plugins/enable hibánál HTTP 200 ok:true; a UI 'done'-t mutat | ATL-WRK-0002 |
| ATL-AUR-0004 | personal-command-center | PARTIAL | D-05: ~25 zár nélküli közös tár (utolsó író nyer) | ATL-WRK-0005, ATL-WRK-0032 |
| ATL-BRN-0025 | master-coordinator | PARTIAL | D-04: nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti | ATL-WRK-0004, ATL-WRK-0061 |
| ATL-INT-0022 | SEARCH forrás: hn.algolia.com (runtime kérés) | EXTERNAL_BLOCKER | D-11: SEARCH hn.algolia kérés nem az aláírt egress-policy-n megy | ATL-WRK-0011, ATL-WRK-0137 |
| ATL-MEM-0008 | knowledge-projects | PARTIAL | D-05: ~25 zár nélküli közös tár (utolsó író nyer) | ATL-WRK-0005, ATL-WRK-0196 |
| ATL-MEM-0011 | observation-memory | PARTIAL | D-05: ~25 zár nélküli közös tár (utolsó író nyer) | ATL-WRK-0005, ATL-WRK-0199 |
| ATL-OPS-0010 | durable-queue | PARTIAL | D-03: durable-queue.ack nem ellenőrzi a bérlőt; D-04: nincs állapotmappa-zár; két runtime ugyanazt a feladato… | ATL-WRK-0003, ATL-WRK-0004, ATL-WRK-0214 |
| ATL-OPS-0013 | file-lock | PARTIAL | D-05: ~25 zár nélküli közös tár (utolsó író nyer) | ATL-WRK-0005, ATL-WRK-0217 |
| ATL-OPS-0034 | atlasz-runtime/supervisor-safe.mjs | PARTIAL | D-04: nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti; D-06: supervisor-safe.mjs fixen 0.0… | ATL-WRK-0004, ATL-WRK-0006, ATL-WRK-0011, ATL-WRK-0235 |
| ATL-RES-0006 | global-discovery | PARTIAL | D-08: discoveryScheduler().tick() hívója nincs | ATL-WRK-0008, ATL-WRK-0250 |
| ATL-SCH-0007 | Napi felderítési ütemező (discoveryScheduler) | BROKEN | D-08: discoveryScheduler().tick() hívója nincs | ATL-WRK-0008 |
| ATL-UIX-0008 | atlasz-control-center/public/app.js | PARTIAL | D-01: Security & Supervision nézet összeomlik (sv.notes objektum, .map hiba); D-02: /api/updates/install és /… | ATL-WRK-0001, ATL-WRK-0002, ATL-WRK-0007, ATL-WRK-0306 |
| ATL-UIX-0023 | Nézet: Security & Supervision (supervision) | BROKEN | D-01: Security & Supervision nézet összeomlik (sv.notes objektum, .map hiba) | ATL-WRK-0001 |
| ATL-WFL-0013 | business/store | PARTIAL | D-05: ~25 zár nélküli közös tár (utolsó író nyer) | ATL-WRK-0005, ATL-WRK-0326 |
| ATL-BRN-0005 | brain/central-brain | PARTIAL | D-12: central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkos… | ATL-WRK-0012, ATL-WRK-0041 |
| ATL-OPS-0001 | backup-recovery | PARTIAL | D-12: central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkos… | ATL-WRK-0012, ATL-WRK-0205 |
| ATL-SEC-0016 | file-intake | PARTIAL | D-09: két karantén-tár, release/delete route nélkül | ATL-WRK-0009, ATL-WRK-0278 |
| ATL-SEC-0032 | quarantine | PARTIAL | D-09: két karantén-tár, release/delete route nélkül | ATL-WRK-0009, ATL-WRK-0292 |
| ATL-SEC-0037 | secret-vault | PARTIAL | D-12: central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkos… | ATL-WRK-0012, ATL-WRK-0296 |
| ATL-UIX-0056 | Nézet: Voice (voice) | PARTIAL | D-07: Hang UI nyelvváltó csak a válasz nyelvét váltja; 'Jó reggelt' gomb néma | ATL-WRK-0007 |
| ATL-VOI-0001 | voice-conversation | MOCK_ONLY | D-07: Hang UI nyelvváltó csak a válasz nyelvét váltja; 'Jó reggelt' gomb néma | ATL-WRK-0007, ATL-WRK-0311 |
| ATL-OPS-0031 | atlasz-runtime/agent-child.js | LEGACY_QUARANTINED | nincs ismert (részletek: a kapcsolt követelmények sorai) | ATL-WRK-0469 |
| ATL-OPS-0035 | atlasz-runtime/supervisor.js | LEGACY_QUARANTINED | tesztelt, de a futó rendszerből nem érhető el | ATL-WRK-0236 |
| ATL-OPS-0036 | atlasz-runtime/worker.js | LEGACY_QUARANTINED | nincs ismert (részletek: a kapcsolt követelmények sorai) | ATL-WRK-0237 |

## 4. Eredeti követelménylista összevetése a rendszerrel

Minden követelmény-sorhoz (`requirements_matrix.csv`) megvan: megtalálható-e (IGEN / RÉSZBEN / NEM), melyik ATL-komponens, működési szint, bekötöttség, hiányzó funkció, szükséges fejlesztés, tervezett modul-azonosító, munka-azonosító és becsült óra (megvalósítás + ellenőrzés).

**A 23 fejezet sorai (1859 sor)**: VERIFIED_WORKING: 408, PARTIAL: 990, CONNECTED_UNTESTED: 58, STRUCTURAL_ONLY: 55, MOCK_ONLY: 36, EXTERNAL_BLOCKER: 124, OWNER_APPROVAL_REQUIRED: 20, BROKEN: 4, MISSING: 164

| Fejezet | Sor | VERIFIED | PARTIAL | CONN.UNT. | STRUCT. | MOCK | EXT.BLOCK. | OWNER | BROKEN | **MISSING** | cím/leíró (N/A) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 60 | 18 | 39 | 0 | 0 | 0 | 2 | 1 | 0 | **0** | 0 |
| 2 | 110 | 17 | 81 | 0 | 0 | 0 | 0 | 0 | 0 | **12** | 0 |
| 3 | 79 | 23 | 53 | 0 | 0 | 1 | 1 | 0 | 0 | **1** | 0 |
| 4 | 58 | 2 | 32 | 13 | 1 | 6 | 4 | 0 | 0 | **0** | 0 |
| 5 | 51 | 7 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | **26** | 0 |
| 6 | 102 | 24 | 50 | 0 | 2 | 7 | 17 | 0 | 0 | **2** | 0 |
| 7 | 72 | 29 | 35 | 0 | 0 | 0 | 3 | 0 | 0 | **5** | 0 |
| 8 | 139 | 49 | 59 | 0 | 2 | 0 | 17 | 0 | 0 | **12** | 0 |
| 9 | 111 | 52 | 47 | 0 | 0 | 2 | 3 | 0 | 0 | **7** | 0 |
| 10 | 59 | 19 | 17 | 0 | 0 | 13 | 10 | 0 | 0 | **0** | 0 |
| 11 | 101 | 6 | 45 | 45 | 2 | 0 | 0 | 0 | 2 | **1** | 0 |
| 12 | 138 | 16 | 56 | 0 | 2 | 0 | 26 | 0 | 0 | **38** | 0 |
| 13 | 127 | 43 | 80 | 0 | 1 | 0 | 1 | 0 | 0 | **2** | 0 |
| 14 | 72 | 15 | 51 | 0 | 0 | 1 | 0 | 0 | 2 | **3** | 0 |
| 15 | 68 | 4 | 52 | 0 | 1 | 0 | 6 | 0 | 0 | **5** | 0 |
| 16 | 53 | 6 | 24 | 0 | 5 | 2 | 16 | 0 | 0 | **0** | 0 |
| 17 | 50 | 2 | 19 | 0 | 22 | 0 | 2 | 0 | 0 | **5** | 0 |
| 18 | 79 | 3 | 26 | 0 | 12 | 3 | 2 | 0 | 0 | **33** | 0 |
| 19 | 71 | 21 | 43 | 0 | 0 | 1 | 0 | 0 | 0 | **6** | 0 |
| 20 | 34 | 2 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | **2** | 0 |
| 21 | 50 | 0 | 31 | 0 | 5 | 0 | 0 | 12 | 0 | **2** | 0 |
| 22 | 35 | 18 | 12 | 0 | 0 | 0 | 0 | 3 | 0 | **2** | 0 |
| 23 | 140 | 32 | 90 | 0 | 0 | 0 | 14 | 4 | 0 | **0** | 0 |

* **Eredeti 85 képesség** (85 tétel): VERIFIED_WORKING: 9, PARTIAL: 52, STRUCTURAL_ONLY: 2, EXTERNAL_BLOCKER: 22
* **23 biztonsági és infrastruktúra-követelmény** (23 tétel): VERIFIED_WORKING: 2, PARTIAL: 21
* **150 jövőbeli fejlesztési ötlet — HALASZTOTT, NEM aktivált** (150 tétel): VERIFIED_WORKING: 3, PARTIAL: 123, STRUCTURAL_ONLY: 8, EXTERNAL_BLOCKER: 15, MISSING: 1

A 150 ötletből a nem teljesen igazolt tételek külön, `P5 / HALASZTOTT` munkaként szerepelnek (`V2_DEFERRED_IDEA`); **egyiket sem indítom el** a döntésedig.

## 5. Hiányzó (MISSING) követelmények → tervezett modulok

A 23 fejezetben **164** sor MISSING (ebből 155 valódi követelmény, a többi cím/bevezető sor) (+ 261 további direktíva-sor, amelyhez nincs kód). Mindegyik kapott saját állandó követelmény-azonosítót (ATL-REQ-…), tervezett modul/bővítés azonosítót (ATL-PLN-…), kapcsolódó meglévő modulokat, szükséges bekötést, munka-azonosítót és becsült órát. **A tervezett modulok PLANNED állapotúak: még nem léteznek.**

| ATL-PLN | Tervezett elem | Fajta | Állapot | Követelmény (db) | Direktíva-sor (db) | Meglévő modulokhoz kötés | Óra (impl+ell) | Prior. | Munka |
|---|---|---|---|---:|---:|---|---:|---|---|
| ATL-PLN-0001 | Beszélgetés-előzmény ablak és munkamenet-állapot (ismétlés/felesleges kérdés csökkentése) | EXTEND | PLANNED_EXTEND | 6 | 0 | human-core; conversation; task-ledger; context-manager; aurora | 12+6 | P3 | ATL-WRK-0496 |
| ATL-PLN-0002 | Hangnem- és kommunikációs mód-osztályozó (humor/komoly, barátságos/üzleti, műszaki, oktató, kreatív, nor… | EXTEND | PLANNED_EXTEND | 6 | 7 | human-core; assistant-profiles; aurora; preferences | 16+8 | P3 | ATL-WRK-0497 |
| ATL-PLN-0003 | AURÓRA digitális avatár (2D/SVG/canvas): arc, szájmozgás, arckifejezés, fejmozgás, gesztusok, figyelmes … | NEW | PLANNED | 15 | 0 | aurora; voice-interface; voice-session; render; modality-fabric; detail-level | 48+18 | P3 | ATL-WRK-0498 |
| ATL-PLN-0004 | AURÓRA téma/skin réteg: háttérképek (hash-elt lokális asset), ikonkészlet, animációk, betűméret | NEW | PLANNED | 5 | 0 | aurora; preferences; render | 16+6 | P4 | ATL-WRK-0499 |
| ATL-PLN-0005 | Fizikai robot / humanoid interfész (külön, későbbi projekt) | DEFERRED | PLANNED_DEFERRED | 7 | 0 | aurora | 0+0 | P5 | ATL-WRK-0500 |
| ATL-PLN-0006 | Teljesítmény- és erőforrás-metrikák (CPU/RAM/GPU/VRAM/tárhely, throughput, átfutási idő, ügynök-stat: kö… | NEW | PLANNED | 7 | 11 | health-monitor; observability-black-box; brain/brain-health; priority-queue-rate-limit-go… | 24+10 | P3 | ATL-WRK-0501 |
| ATL-PLN-0007 | Okos gyorsítótár (invalidálással) és lazy loading | NEW | PLANNED | 1 | 1 | context-manager; model-gateway | 14+6 | P4 | ATL-WRK-0502 |
| ATL-PLN-0008 | Sandbox teljesítmény/skála tesztcsomag és kapacitás-/terhelés-szimuláció (30 ügynök, queue-terhelés, sok… | NEW | PLANNED | 1 | 11 | brain/simulation-lab; durable-queue; brain/black-box; regression-eval-suite | 20+8 | P3 | ATL-WRK-0503 |
| ATL-PLN-0009 | Generált MEMORY.md index és napi memórianaplók (memory/YYYY-MM-DD.md) | NEW | PLANNED | 4 | 3 | memory-store; audit-chain; observation-memory | 12+5 | P3 | ATL-WRK-0504 |
| ATL-PLN-0010 | Success Pattern Library (verified HISTORICAL_RESULT alapú sikermintázat-tár) | EXTEND | PLANNED_EXTEND | 1 | 2 | brain/knowledge-brain; experience-learning-engine | 10+4 | P3 | ATL-WRK-0505 |
| ATL-PLN-0011 | Tanulság-hurok: eredmény-elemzés -> lecke -> jövőbeli tervezés -> lecke-hatás nyomkövetés; incidens-tanu… | NEW | PLANNED | 0 | 5 | brain/planning-brain; brain/verifier; experience-learning-engine; incident-response; brai… | 22+9 | P3 | ATL-WRK-0506 |
| ATL-PLN-0012 | Lehetőség-kimenet visszacsatolás (rejection/response/win/delivery/profit/loss/failure) és megbízható for… | NEW | PLANNED | 0 | 7 | brain/opportunity-intelligence; research-ledger; experience-learning-engine; business/sto… | 22+9 | P3 | ATL-WRK-0507 |
| ATL-PLN-0013 | Business Factory job-minta bányászat (ismétlődő munka, workflow, képesség-kombináció, QA, szállítandó, k… | NEW | PLANNED | 0 | 9 | brain/business-factory; business/job-system; business/store | 24+9 | P4 | ATL-WRK-0508 |
| ATL-PLN-0014 | Web-munka és API-munka executor (engedélyezett egress + adapter) | NEW | PLANNED | 0 | 2 | agent-executors; egress-policy; tool-fabric | 18+8 | P3 | ATL-WRK-0509 |
| ATL-PLN-0015 | Fordító executor | NEW | PLANNED | 0 | 1 | agent-executors; translation-feedback; model-gateway | 10+5 | P3 | ATL-WRK-0510 |
| ATL-PLN-0016 | Ügyfélszolgálat / támogatási jegy és SLA modul + support executor | NEW | PLANNED | 1 | 2 | business/communication-center; business/crm; agent-executors | 28+11 | P4 | ATL-WRK-0511 |
| ATL-PLN-0017 | Prezentáció-generátor (PPTX) és AI-fejlesztési executor | NEW | PLANNED | 2 | 1 | agent-executors; document-center | 24+9 | P4 | ATL-WRK-0512 |
| ATL-PLN-0018 | Táblázat-generálás (XLSX/CSV) | NEW | PLANNED | 0 | 1 | document-center; doc-extractors | 12+5 | P4 | ATL-WRK-0513 |
| ATL-PLN-0019 | Média-eszközök: videó-, hang-/zene-, 3D-munkafolyamatok, médiakonverzió és szerkesztési adapter szerződés | NEW | PLANNED | 9 | 8 | tool-fabric; plugin-manager; restricted-node; modality-fabric | 40+16 | P4 | ATL-WRK-0514 |
| ATL-PLN-0020 | Kreatív-elemző képesség a Brain-ben (hangulat, téma, műfaj, vizuális stílus, tempó, szereplők, jelenet-s… | NEW | PLANNED | 11 | 5 | brain/central-brain; model-gateway; modality-fabric | 26+10 | P4 | ATL-WRK-0515 |
| ATL-PLN-0021 | Kreatív projektek nyilvántartása (zene, film, történet, storyboard) és AURÓRA megjelenítés + asszisztens… | NEW | PLANNED | 2 | 3 | knowledge-projects; aurora; project-memory | 26+10 | P4 | ATL-WRK-0516 |
| ATL-PLN-0022 | Connector-adapter: Google Contacts (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0517 |
| ATL-PLN-0023 | Connector-adapter: Clearbit (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0518 |
| ATL-PLN-0024 | Connector-adapter: Apollo (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0519 |
| ATL-PLN-0025 | Connector-adapter: Lusha (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0520 |
| ATL-PLN-0026 | Connector-adapter: Resend (e-mail küldő) (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0521 |
| ATL-PLN-0027 | Connector-adapter: Close CRM (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0522 |
| ATL-PLN-0028 | Connector-adapter: BuildingConnected (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0523 |
| ATL-PLN-0029 | Connector-adapter: Metricool (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0524 |
| ATL-PLN-0030 | Connector-adapter: Socialmonials (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0525 |
| ATL-PLN-0031 | Connector-adapter: WordPress / CMS (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 3 | 1 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0526 |
| ATL-PLN-0032 | Connector-adapter: Nano Banana (kép) (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0527 |
| ATL-PLN-0033 | Connector-adapter: HeyGen (videó) (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0528 |
| ATL-PLN-0034 | Connector-adapter: Runway (videó) (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0529 |
| ATL-PLN-0035 | Connector-adapter: LTX Studio (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0530 |
| ATL-PLN-0036 | Connector-adapter: Veo (videó) (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0531 |
| ATL-PLN-0037 | Connector-adapter: Suno (zene) (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0532 |
| ATL-PLN-0038 | Connector-adapter: CapCut (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0533 |
| ATL-PLN-0039 | Connector-adapter: DaVinci Resolve (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0534 |
| ATL-PLN-0040 | Connector-adapter: Shutter Encoder (descriptor + adapter + vault-kulcs + teszt + UI) | NEW | PLANNED | 2 | 0 | connector-catalog; universal-connector-layer; secret-vault; credential-broker; egress-pol… | 8+4 | P4 | ATL-WRK-0535 |
| ATL-PLN-0041 | Blockchain / Web3 / okosszerződés / tokenizáció / NFT fejlesztői szolgáltatás (sandboxolt executor + aud… | NEW | PLANNED | 5 | 10 | financial-guard; restricted-node; code-sandbox; global-discovery; skill-registry | 32+14 | P4 | ATL-WRK-0536 |
| ATL-PLN-0042 | Ismétlődő szolgáltatás életciklus: előfizetéses lehetőségek, megújítás-követés, ütemezett szállítás, ism… | NEW | PLANNED | 1 | 5 | business/recurring-billing; business/delivery-service; business/qa-factory; global-discov… | 22+9 | P3 | ATL-WRK-0537 |
| ATL-PLN-0043 | Adaptive Sales (igaz, nem manipulatív bizonyíték-alapú értékesítési adaptáció) | NEW | PLANNED | 1 | 1 | negotiation-engine; client-dna-engine; follow-up-engine | 20+8 | P4 | ATL-WRK-0538 |
| ATL-PLN-0044 | Business Proof Package generátor (outreach > won > delivery > QA > bevétel > profit bizonyíték-csomag, e… | NEW | PLANNED | 1 | 2 | business/store; financial-ledger; observability-black-box; audit-chain | 18+7 | P3 | ATL-WRK-0539 |
| ATL-PLN-0045 | KÜLÖN kereskedelmi licenc-rendszer (nem a tulajdonos belső ATLASZ-példánya): licenc- és jutalékos modell… | DEFERRED | PLANNED_DEFERRED | 5 | 10 | business/recurring-billing; business/invoice-service; financial-ledger; tax-accounting-en… | 60+24 | P5 | ATL-WRK-0540 |
| ATL-PLN-0046 | Piactípus mező és lefedettségi riport (B2B, B2C, B2G, B2B2C, D2C, C2B) | EXTEND | PLANNED_EXTEND | 3 | 0 | opportunity-intake; global-business-intelligence; market-intelligence-engine | 8+4 | P3 | ATL-WRK-0541 |
| ATL-PLN-0047 | Versenytárs-gyűjtő, ár-benchmark és árazási ajánlás, versenyfeltételek | NEW | PLANNED | 2 | 2 | market-intelligence-engine; proposal-quote-engine; org-intelligence | 24+9 | P4 | ATL-WRK-0542 |
| ATL-PLN-0048 | Biztonságos távoli kapcsolat (TLS / VPN) a mobil/távoli vezérléshez | NEW | PLANNED | 2 | 0 | mobile-api; owner-auth; network-supervisor | 20+10 | P2 | ATL-WRK-0543 |
| ATL-PLN-0049 | Függőség- és konténer-vizsgálat: npm audit/OSV, SBOM, trivy/grype a Dockerfile.worker image-re, lockfile… | NEW | PLANNED | 2 | 2 | atlasz-runtime/Dockerfile.worker; release-signing; malware-scanner | 14+6 | P2 | ATL-WRK-0544 |
| ATL-PLN-0050 | Képernyőkép titok-ellenőrző (OCR előszűrő / kézi checklist) | NEW | PLANNED | 0 | 1 | secret-patterns; history-scan-patterns; file-intake | 14+6 | P3 | ATL-WRK-0545 |
| ATL-PLN-0051 | main ág védelme (GitHub branch protection + pre-push hook) | DECISION | DECISION_PENDING | 1 | 16 | release-signing | 2+1 | P2 | ATL-WRK-0546 |
| ATL-PLN-0052 | Futásidejű önjavítás: hibás folyamat újraindítása (restartComponent), deadlock-észlelés, átmeneti állapo… | NEW | PLANNED | 2 | 4 | atlasz-runtime/supervisor-safe.mjs; watchdog; self-healing-loop; business/job-system; dur… | 26+12 | P2 | ATL-WRK-0547 |
| ATL-PLN-0053 | Több gép / több példány közötti adatzár: döntés (egypéldányos telepítés + példányzár VAGY külső koordiná… | DECISION | DECISION_PENDING | 1 | 0 | file-lock; atlasz-runtime/supervisor-safe.mjs; durable-queue | 10+5 | P2 | ATL-WRK-0548 |
| ATL-PLN-0054 | Pont-időponti visszaállítás (naplóalapú visszajátszás) és adatbázis-mentés / tárolási döntés (fájl-alapú… | DECISION | DECISION_PENDING | 0 | 3 | backup-recovery; portable-backup; audit-chain; business/store | 18+8 | P3 | ATL-WRK-0549 |
| ATL-PLN-0055 | Konfiguráció-, ügynök/workflow- és connector-konfiguráció verziózás | NEW | PLANNED | 0 | 3 | preferences; workflow-engine; connector-catalog; completion-registry | 10+4 | P3 | ATL-WRK-0550 |
| ATL-PLN-0056 | Adatvédelmi megfelelés: export/törlés kérelem kezelő, adatvédelmi beállítások | NEW | PLANNED | 1 | 0 | tenant-isolation; secret-vault; business/store | 24+10 | P3 | ATL-WRK-0551 |
| ATL-PLN-0057 | PDF-eszköztár: készítés, szerkesztés (eredeti megőrzésével), egyesítés/felosztás, oldalműveletek | NEW | PLANNED | 3 | 4 | document-center; tool-fabric; restricted-node | 32+12 | P3 | ATL-WRK-0552 |
| ATL-PLN-0058 | Biztonságos fájlkonvertáló (sandboxolt) és konverzió-validáció | NEW | PLANNED | 1 | 0 | restricted-node; code-sandbox; file-intake | 16+7 | P3 | ATL-WRK-0553 |
| ATL-PLN-0059 | Szemantikus dokumentumkeresés (Doc Center -> semantic-index + helyi embedding) | EXTEND | PLANNED_EXTEND | 1 | 0 | document-center; semantic-index; embedding-provider | 12+5 | P3 | ATL-WRK-0554 |
| ATL-PLN-0060 | Dokumentum-munkafolyamat kiegészítők: verzió-összehasonlítás, csatolmány-lánc (Inbox -> file-intake -> D… | NEW | PLANNED | 0 | 5 | document-center; universal-inbox; file-intake; text-compare; personal-command-center | 28+11 | P4 | ATL-WRK-0555 |
| ATL-PLN-0061 | GST/PST szabálybázis, ITC előkészítés, időszakos összesítés, PST-köteles tranzakciók vizsgálata, adókate… | NEW | PLANNED | 4 | 2 | tax-accounting-engine; financial-ledger; business/invoice-service | 34+14 | P2 | ATL-WRK-0556 |
| ATL-PLN-0062 | Adó-rekordok entitás/tenant mező és szűrés | EXTEND | PLANNED_EXTEND | 0 | 1 | tax-accounting-engine; tenant-isolation | 6+3 | P3 | ATL-WRK-0557 |
| ATL-PLN-0063 | Könyvelőnek átadható dokumentumcsomag (főkönyv + dokumentumok + hash-manifeszt, owner jóváhagyással) | NEW | PLANNED | 1 | 1 | financial-ledger; document-center; audit-chain | 18+7 | P3 | ATL-WRK-0558 |
| ATL-PLN-0064 | Tranzakció-kategorizáló (szabály alapú, owner review-val) | NEW | PLANNED | 0 | 1 | financial-ledger; business/payment-events | 14+6 | P3 | ATL-WRK-0559 |
| ATL-PLN-0065 | Website Manager: domain/DNS/SSL munkafolyamatok (jóváhagyással), weboldal-műveleti fázisgép (READ/PREPAR… | NEW | PLANNED | 2 | 5 | tool-fabric; approval-command-gateway; egress-policy; connector-catalog | 44+18 | P4 | ATL-WRK-0560 |
| ATL-PLN-0066 | SEO audit, web analitika (valós szolgáltatói adat), web QA (a11y-audit újrahasználata) | NEW | PLANNED | 3 | 3 | a11y-audit; tool-fabric | 30+12 | P4 | ATL-WRK-0561 |
| ATL-PLN-0067 | Web/app fejlesztési munkafolyamat (sablon + build + teszt + csomag) és website/szoftverfejlesztő eszköz … | NEW | PLANNED | 0 | 6 | code-edit-workflow; prototype-builder; agent-executors; release-signing | 34+14 | P4 | ATL-WRK-0562 |
| ATL-PLN-0068 | Térkép / helymeghatározás modul szolgáltató-adapterekkel: geocoding, címkeresés, helyszínek, útvonal, te… | NEW | PLANNED | 12 | 8 | global-discovery; market-intelligence-engine; connector-catalog | 40+16 | P4 | ATL-WRK-0563 |
| ATL-PLN-0069 | Lehetőség -> döntés -> munka -> eredmény -> pénz nyomkövető nézet (egy felületről) + paymentId korreláció | NEW | PLANNED | 0 | 6 | business/store; business/payment-events; brain/black-box; financial-ledger | 22+9 | P3 | ATL-WRK-0564 |
| ATL-PLN-0070 | Executive Owner Dashboard (egyoldalas tulajdonosi összkép) és why/next-tasks nézetek | NEW | PLANNED | 0 | 3 | brain/brain-health; financial-ledger; personal-command-center | 20+8 | P3 | ATL-WRK-0565 |
| ATL-PLN-0071 | Notification Center (prioritás: ACTION_REQUIRED, csoportosítás kulcs+ablak alapján) | NEW | PLANNED | 0 | 2 | event-bus; universal-inbox; approval-requests | 16+7 | P3 | ATL-WRK-0566 |
| ATL-PLN-0072 | Üzletmenet-folytonossági terv: kritikus komponensek, függőségi modell, SPOF-elemzés, helyreállítási sorr… | NEW | PLANNED | 0 | 7 | brain/disaster-recovery; owner-control/recovery-source-map; backup-recovery | 22+8 | P3 | ATL-WRK-0567 |
| ATL-PLN-0073 | System Doctor és startup-self-check kiegészítés: memory, knowledge, money engine, computer-use probe; Br… | EXTEND | PLANNED_EXTEND | 0 | 11 | owner-control/system-doctor; startup-self-check; brain/brain-health | 14+7 | P2 | ATL-WRK-0568 |
| ATL-PLN-0074 | Owner parancs: 'Show security warnings' (SHOW_SECURITY_WARNINGS intent) és Security Brain bekötések a Co… | EXTEND | PLANNED_EXTEND | 0 | 7 | brain/owner-command; brain/security-brain; brain/black-box; brain/verifier | 10+5 | P2 | ATL-WRK-0569 |
| ATL-PLN-0075 | Nyilvántartási séma-bővítések: capabilities/dependencies/configuration/permissions/cost/rate-limits/requ… | EXTEND | PLANNED_EXTEND | 0 | 16 | brain/capability-graph; capability-registry; connector-catalog; skill-registry; model-reg… | 18+8 | P3 | ATL-WRK-0570 |
| ATL-PLN-0076 | Modell-nyilvántartás metaadatok: rate-limit, régió, szolgáltatói megkötések/ÁSZF, policy-mezők (engedély… | EXTEND | PLANNED_EXTEND | 0 | 17 | model-registry; model-evolution; model-evidence; provider-resilience; brain/model-intelli… | 20+9 | P3 | ATL-WRK-0571 |
| ATL-PLN-0077 | Modell-benchmark készlet (reasoning, coding, research, task completion, tool-calling, security behavior,… | EXTEND | PLANNED_EXTEND | 0 | 7 | model-evolution; model-evidence; regression-eval-suite | 14+7 | P4 | ATL-WRK-0572 |
| ATL-PLN-0078 | Frissítési csővezeték kiegészítés: biztonságos letöltő (allowlist+hash/aláírás), megszakadt letöltés kez… | NEW | PLANNED | 0 | 10 | update-center; local-update-adapters; release-signing; atlasz-control-center/electron/mai… | 36+16 | P3 | ATL-WRK-0573 |
| ATL-PLN-0079 | Felderítési webhook / eseményfeed vevő (aláírt, allowlistelt, receive-only), felderítési riasztások és v… | NEW | PLANNED | 1 | 4 | global-discovery; source-allowlist; payment-webhook-receiver; universal-inbox | 24+10 | P3 | ATL-WRK-0574 |
| ATL-PLN-0080 | Beszerzési forrás-adapterek: magán RFP/RFQ/alvállalkozói, beszállítói regisztráció és portálok, közbesze… | NEW | PLANNED | 0 | 9 | global-discovery; source-allowlist; source-adapters; eligibility-model | 40+16 | P3 | ATL-WRK-0575 |
| ATL-PLN-0081 | Piaci adat-adapter (inaktív, jóváhagyásig), részvényindex-forrás és autonóm stratégiakutatás ügynök-munk… | NEW | PLANNED | 0 | 6 | market-data; backtest; paper-trader; orb-strategy; financial-guard | 34+14 | P4 | ATL-WRK-0576 |
| ATL-PLN-0082 | Egyéb jóváhagyott kártevő-motor adapter (csak tulajdonosi igényre) | DEFERRED | PLANNED_DEFERRED | 0 | 1 | malware-scanner | 0+0 | P5 | ATL-WRK-0577 |
| ATL-PLN-0083 | Szerződés-ellenőrzés kategóriák (visszatérítési feltételek, szükséges hitelesítő adatok) és hiteles szám… | EXTEND | PLANNED_EXTEND | 0 | 3 | business/contract-review; contract-analysis; business/invoice-service | 8+4 | P3 | ATL-WRK-0578 |
| ATL-PLN-0084 | Stripe balance állapot a payment-events-ben és a 'discovery' műveleti kisbővítések | EXTEND | PLANNED_EXTEND | 0 | 1 | business/payment-events; payment-webhook-receiver | 6+3 | P3 | ATL-WRK-0579 |
| ATL-PLN-0085 | Ügynökök állapota: AGENTS olvasó végpont (agentsActivity) és nézet-bekötés | EXTEND | PLANNED_EXTEND | 1 | 0 | agent-activity; agent-status; atlasz-control-center/server.mjs | 6+3 | P3 | ATL-WRK-0580 |
| ATL-PLN-0086 | Technológia költség-ellenőrzés a tech-watch folyamatban (COST CHECK lépés) | EXTEND | PLANNED_EXTEND | 0 | 1 | tech-watch | 6+3 | P4 | ATL-WRK-0581 |
| ATL-PLN-0087 | Felderítési kategória-bővítés: AI-rendszerek és automatizálási technológiák | EXTEND | PLANNED_EXTEND | 0 | 2 | global-discovery; source-allowlist | 8+4 | P4 | ATL-WRK-0582 |
| ATL-PLN-0088 | Jövőbeli, külön engedélyezett élő kereskedési teljesítmény-nézet | DEFERRED | PLANNED_DEFERRED | 0 | 1 | paper-trader; financial-guard | 0+0 | P5 | ATL-WRK-0583 |
| ATL-PLN-0095 | Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-edit-workflow change-set … | DEFERRED | PLANNED_DEFERRED | 1 | 0 | code-edit-workflow; repo-analyzer; test-intelligence; agent-executors; brain/verifier; al… | 24+10 | P5 | ATL-WRK-0782 |
| ATL-PLN-0096 | Hiányzó Control Center képernyők: Deliveries (szállítások), külön DEALS képernyő, Computer Use panel, Ta… | EXTEND | PLANNED_EXTEND | 1 | 1 | business/delivery-service; business/deal-pipeline; computer-use-fabric; tax-accounting-en… | 16+7 | P3 | ATL-WRK-0783 |
| ATL-PLN-0097 | Látás- és környezet-érzékelés: tárgy- és eszközfelismerés (Object and Equipment Recognition), környezeti… | NEW | PLANNED | 2 | 0 | modality-fabric; computer-use-fabric; page-ingest | 36+14 | P4 | ATL-WRK-0784 |
| ATL-PLN-0089 | Gépi rendszerleltár 12 mezős tételsorokkal: sebezhetőség-scan (static_scan.json) tételenként | EXTEND | PLANNED_EXTEND | 0 | 12 | registry-integrity.test | 10+4 | P4 | ATL-WRK-0584 |
| ATL-PLN-0090 | Plugin-típusok: connector, média, dokumentum plugin manifest-séma | EXTEND | PLANNED_EXTEND | 0 | 2 | plugin-manager; plugin-installer; skill-registry | 10+5 | P3 | ATL-WRK-0585 |
| ATL-PLN-0091 | Engedélyezett valódi connector-teszt és futási bizonyíték-gyűjtés | DECISION | DECISION_PENDING | 0 | 2 | universal-connector-layer; connector-catalog; probe-evidence | 12+8 | P4 | ATL-WRK-0586 |
| ATL-PLN-0092 | Teszt-kategóriák és mutációs tesztelés (unit/contract/integration/E2E/negative/mutation/security/recover… | NEW | PLANNED | 1 | 10 | regression-eval-suite; test-intelligence | 30+12 | P3 | ATL-WRK-0587 |
| ATL-PLN-0093 | Valódi STAGING környezet, Windows CI + test hardening (LF, junction symlink, rm retry, POSIX szignálok),… | DECISION | DECISION_PENDING | 1 | 10 | owner-keystore; approval-command-gateway; atlasz-control-center/electron/main.mjs | 30+20 | P2 | ATL-WRK-0588 |
| ATL-PLN-0094 | T3 hardening: duplikált/hub-bag implementációk konszolidációja (32 modul), Math.random() ID fallback cse… | EXTEND | PLANNED_EXTEND | 0 | 2 | internal-integration-hub; scheduler; approval-command-gateway | 24+10 | P3 | ATL-WRK-0589 |

Részletek (kapcsolatok, bekötés, elfogadási feltétel): `planned_modules.csv`; melyik követelmény melyik tervezett modulhoz tartozik: `requirements_matrix.csv` (`planned_module_id`).

## 6. Munkaterv

A korábbi 340 soros munkalista **teljesen megmaradt** (ATL-WRK-0001…), és kibővült. Összesen **784** feladat; számozott, függőségekkel, becsült idővel, ellenőrzési módszerrel és elfogadási feltétellel: **`MUNKATERV.md`** / `work_plan.csv`.

| Eredet | Feladat | Aktív óra |
|---|---:|---:|
| Korábbi 340 soros lista (megőrizve) | 340 | 1876 |
| Új: további meglévő komponensek hiányai | 154 | 471 |
| Halasztott ötletek (150-es lista) — nem aktív | 147 | — (tájékoztató: 931) |
| Új: tervezett modulok/bővítések megvalósítása+ellenőrzése | 97 | 2345 |
| Új: direktíva-sorok lezárása | 16 | 170 |
| Új: tulajdonosi döntések előkészítése | 15 | 8 |
| Új: követelmény-hiányok lezárása (komponens nélkül) | 10 | 10 |
| Új: ellentmondások/megállapítások lezárása | 2 | 138 |
| Végső teljes vizsgálat + leltár-karbantartás | 2 | 132 |
| Új: korrekciók | 1 | 2 |

Prioritás-eloszlás: P0: 7, P1: 4, P2: 64, P3: 429, P4: 128, P5: 152. (P0 adatvesztést/hamis biztonságot okozó hiba · P1 ismert hiba · P2 bekötés/teszt/biztonság/alapfunkció · P3 részleges modul/bővítés · P4 külső hozzáférés/tulajdonosi döntés függő · P5 halasztott, nem aktivált.)

### P0–P2 feladatok (a legsürgősebbek, javaslatként)

| Sorszám | ATL-WRK | Prior. | Feladat | Óra | Függ |
|---:|---|---|---|---:|---|
| 1 | ATL-WRK-0001 | P0 | D-01: Security & Supervision nézet összeomlik (sv.notes objektum, .map hiba) | 5.0 |  |
| 2 | ATL-WRK-0002 | P0 | D-02: /api/updates/install és /api/plugins/enable hibánál HTTP 200 ok:true; a UI 'done'-t mutat | 5.0 |  |
| 3 | ATL-WRK-0003 | P0 | D-03: durable-queue.ack nem ellenőrzi a bérlőt | 4.0 |  |
| 4 | ATL-WRK-0004 | P0 | D-04: nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti | 18.0 | ATL-WRK-0003 |
| 5 | ATL-WRK-0005 | P0 | D-05: ~25 zár nélküli közös tár (utolsó író nyer) | 30.0 | ATL-WRK-0004 |
| 6 | ATL-WRK-0008 | P0 | D-08: discoveryScheduler().tick() hívója nincs | 4.0 |  |
| 7 | ATL-WRK-0011 | P0 | D-11: SEARCH hn.algolia kérés nem az aláírt egress-policy-n megy | 6.0 |  |
| 8 | ATL-WRK-0006 | P1 | D-06: supervisor-safe.mjs fixen 0.0.0.0-n hallgat | 5.0 |  |
| 9 | ATL-WRK-0007 | P1 | D-07: Hang UI nyelvváltó csak a válasz nyelvét váltja; 'Jó reggelt' gomb néma | 6.0 |  |
| 10 | ATL-WRK-0009 | P1 | D-09: két karantén-tár, release/delete route nélkül | 9.0 |  |
| 11 | ATL-WRK-0012 | P1 | D-12: central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkos… | 17.0 |  |
| 12 | ATL-WRK-0035 | P2 | Csak váz / nincs bekötés vagy teszt: a11y-worker | 5.0 |  |
| 13 | ATL-WRK-0068 | P2 | Be van kötve, de nincs közvetlen tesztje: registrations/_util | 4.5 |  |
| 14 | ATL-WRK-0126 | P2 | Csak váz / nincs bekötés vagy teszt: browser-extension/background.js | 5.0 |  |
| 15 | ATL-WRK-0127 | P2 | Csak váz / nincs bekötés vagy teszt: browser-extension/content-script.js | 5.0 |  |
| 16 | ATL-WRK-0129 | P2 | Csak váz / nincs bekötés vagy teszt: browser-extension/sidepanel.css | 5.0 |  |
| 17 | ATL-WRK-0130 | P2 | Csak váz / nincs bekötés vagy teszt: browser-extension/sidepanel.html | 5.0 |  |
| 18 | ATL-WRK-0131 | P2 | Csak váz / nincs bekötés vagy teszt: browser-extension/sidepanel.js | 5.0 |  |
| 19 | ATL-WRK-0232 | P2 | Csak váz / nincs bekötés vagy teszt: atlasz-runtime/Dockerfile.worker | 5.0 |  |
| 20 | ATL-WRK-0280 | P2 | Csak váz / nincs bekötés vagy teszt: history-scan-patterns | 5.0 |  |
| 21 | ATL-WRK-0307 | P2 | Csak váz / nincs bekötés vagy teszt: atlasz-control-center/public/index.html | 5.0 |  |
| 22 | ATL-WRK-0308 | P2 | Csak váz / nincs bekötés vagy teszt: atlasz-control-center/public/style.css | 5.0 |  |
| 23 | ATL-WRK-0338 | P2 | Be van kötve, de nincs közvetlen tesztje: atlasz-control-center/electron/main.mjs | 4.5 |  |
| 24 | ATL-WRK-0339 | P2 | Csak váz / nincs bekötés vagy teszt: atlasz-control-center/scripts/stage-win.mjs | 5.0 |  |
| 25 | ATL-WRK-0340 | P2 | Csak váz / nincs bekötés vagy teszt: launcher/ATLASZ-Control-Center.cmd | 5.0 |  |
| 26 | ATL-WRK-0371 | P2 | Bekötve, teszt hiányzik: GET /api/trading/candles | 3.0 |  |
| 27 | ATL-WRK-0372 | P2 | Bekötve, teszt hiányzik: POST /api/aurora/utterance | 3.0 |  |
| 28 | ATL-WRK-0373 | P2 | Bekötve, teszt hiányzik: POST /api/aurora/voice/settings | 3.0 |  |
| 29 | ATL-WRK-0374 | P2 | Bekötve, teszt hiányzik: POST /api/aurora/voice/evidence | 3.0 |  |
| 30 | ATL-WRK-0375 | P2 | Bekötve, teszt hiányzik: POST /api/intake/file | 3.0 |  |
| 31 | ATL-WRK-0376 | P2 | Bekötve, teszt hiányzik: POST /api/proposal/draft | 3.0 |  |
| 32 | ATL-WRK-0377 | P2 | Bekötve, teszt hiányzik: POST /api/profit/close-day | 3.0 |  |
| 33 | ATL-WRK-0378 | P2 | Bekötve, teszt hiányzik: POST /api/finance/webhook-receiver/start | 3.0 |  |
| 34 | ATL-WRK-0379 | P2 | Bekötve, teszt hiányzik: POST /api/finance/webhook-receiver/stop | 3.0 |  |
| 35 | ATL-WRK-0380 | P2 | Bekötve, teszt hiányzik: POST /api/finance/attest-costs | 3.0 |  |
| 36 | ATL-WRK-0381 | P2 | Bekötve, teszt hiányzik: POST /api/finance/revoke-attestation | 3.0 |  |
| 37 | ATL-WRK-0382 | P2 | Bekötve, teszt hiányzik: POST /api/finance/fx-rate | 3.0 |  |
| 38 | ATL-WRK-0383 | P2 | Bekötve, teszt hiányzik: POST /api/finance/attach-fee | 3.0 |  |
| 39 | ATL-WRK-0384 | P2 | Bekötve, teszt hiányzik: POST /api/finance/assess | 3.0 |  |
| 40 | ATL-WRK-0385 | P2 | Bekötve, teszt hiányzik: POST /api/contract/review | 3.0 |  |
| 41 | ATL-WRK-0386 | P2 | Bekötve, teszt hiányzik: POST /api/invoice/prepare | 3.0 |  |
| 42 | ATL-WRK-0387 | P2 | Bekötve, teszt hiányzik: POST /api/backup | 3.0 |  |
| 43 | ATL-WRK-0388 | P2 | Bekötve, teszt hiányzik: POST /api/memory/action | 3.0 |  |
| 44 | ATL-WRK-0389 | P2 | Bekötve, teszt hiányzik: POST /api/model-registry/action | 3.0 |  |
| 45 | ATL-WRK-0390 | P2 | Bekötve, teszt hiányzik: POST /api/security/action | 3.0 |  |
| 46 | ATL-WRK-0391 | P2 | Bekötve, teszt hiányzik: POST /api/agents30/action | 3.0 |  |
| 47 | ATL-WRK-0392 | P2 | Bekötve, teszt hiányzik: POST /api/vault/action | 3.0 |  |
| 48 | ATL-WRK-0393 | P2 | Bekötve, teszt hiányzik: POST /api/chat-providers/action | 3.0 |  |
| 49 | ATL-WRK-0394 | P2 | Bekötve, teszt hiányzik: POST /api/trading/action | 3.0 |  |
| 50 | ATL-WRK-0395 | P2 | Bekötve, teszt hiányzik: POST /api/workbench/action | 3.0 |  |
| 51 | ATL-WRK-0396 | P2 | Bekötve, teszt hiányzik: POST /api/a11y/audit | 3.0 |  |
| 52 | ATL-WRK-0397 | P2 | Bekötve, teszt hiányzik: POST /api/repos/analyze | 3.0 |  |
| 53 | ATL-WRK-0398 | P2 | Bekötve, teszt hiányzik: POST /api/repos/test | 3.0 |  |
| 54 | ATL-WRK-0399 | P2 | Bekötve, teszt hiányzik: POST /api/prototypes/action | 3.0 |  |
| 55 | ATL-WRK-0400 | P2 | Bekötve, teszt hiányzik: POST /api/mcp/start | 3.0 |  |
| 56 | ATL-WRK-0401 | P2 | Bekötve, teszt hiányzik: POST /api/mcp/call | 3.0 |  |
| 57 | ATL-WRK-0402 | P2 | Bekötve, teszt hiányzik: POST /api/mcp/stop | 3.0 |  |
| 58 | ATL-WRK-0403 | P2 | Bekötve, teszt hiányzik: POST /api/plugins/invoke | 3.0 |  |
| 59 | ATL-WRK-0404 | P2 | Bekötve, teszt hiányzik: POST /api/plugins/install | 3.0 |  |
| 60 | ATL-WRK-0405 | P2 | Bekötve, teszt hiányzik: POST /api/plugins/rollback | 3.0 |  |
| 61 | ATL-WRK-0406 | P2 | Bekötve, teszt hiányzik: POST /api/plugins/uninstall | 3.0 |  |
| 62 | ATL-WRK-0407 | P2 | Bekötve, teszt hiányzik: POST /api/updates/auto | 3.0 |  |
| 63 | ATL-WRK-0408 | P2 | Csak váz: atlasz-tests/helpers.mjs | 5.0 |  |
| 64 | ATL-WRK-0419 | P2 | Csak váz: scripts/gh-annotate-test-failures.mjs | 5.0 |  |
| 65 | ATL-WRK-0468 | P2 | Hiányzó komponens: AI-szolgáltató: merlin (CLOUD) | 9.0 |  |
| 66 | ATL-WRK-0543 | P2 | ÚJ MODUL: Biztonságos távoli kapcsolat (TLS / VPN) a mobil/távoli vezérléshez | 30.0 | ATL-DEC-0039 |
| 67 | ATL-WRK-0544 | P2 | ÚJ MODUL: Függőség- és konténer-vizsgálat: npm audit/OSV, SBOM, trivy/grype a Dockerfile.worker image-re, loc… | 20.0 |  |
| 68 | ATL-WRK-0546 | P2 | DÖNTÉS+ELŐKÉSZÍTÉS: main ág védelme (GitHub branch protection + pre-push hook) | 3.0 | ATL-DEC-0040 |
| 69 | ATL-WRK-0547 | P2 | ÚJ MODUL: Futásidejű önjavítás: hibás folyamat újraindítása (restartComponent), deadlock-észlelés, átmeneti á… | 38.0 | ATL-WRK-0004; ATL-WRK-0006; ATL-WRK-0011; ATL-WRK… |
| 70 | ATL-WRK-0548 | P2 | DÖNTÉS+ELŐKÉSZÍTÉS: Több gép / több példány közötti adatzár: döntés (egypéldányos telepítés + példányzár VAGY… | 15.0 | ATL-WRK-0005; ATL-WRK-0004; ATL-WRK-0006; ATL-WRK… |
| 71 | ATL-WRK-0556 | P2 | ÚJ MODUL: GST/PST szabálybázis, ITC előkészítés, időszakos összesítés, PST-köteles tranzakciók vizsgálata, ad… | 48.0 | ATL-DEC-0044 |
| 72 | ATL-WRK-0568 | P2 | BŐVÍTÉS: System Doctor és startup-self-check kiegészítés: memory, knowledge, money engine, computer-use probe… | 21.0 |  |
| 73 | ATL-WRK-0569 | P2 | BŐVÍTÉS: Owner parancs: 'Show security warnings' (SHOW_SECURITY_WARNINGS intent) és Security Brain bekötések … | 15.0 |  |
| 74 | ATL-WRK-0588 | P2 | DÖNTÉS+ELŐKÉSZÍTÉS: Valódi STAGING környezet, Windows CI + test hardening (LF, junction symlink, rm retry, PO… | 50.0 | ATL-DEC-0054 |
| 75 | ATL-WRK-0590 | P2 | Tulajdonosi döntés előkészítése: Tulajdonosi kulcs (owner-key) kiadása / provisionálása és aláírt jóváhagyások | 0.5 |  |

## 7. Halasztott tételek (külön jelölve, NEM aktiválva)

* **ATL-PLN-0005** — Fizikai robot / humanoid interfész (külön, későbbi projekt) (PLANNED_DEFERRED). Tulajdonosi feltétel: Halasztott; a tulajdonos külön projektként indíthatja
* **ATL-PLN-0045** — KÜLÖN kereskedelmi licenc-rendszer (nem a tulajdonos belső ATLASZ-példánya): licenc- és jutalékos modellek, 20% tulajdonosi bevétel-részesedés, ügyfélpéldányonkénti licenc/számvitel, igazolt jogosula… (PLANNED_DEFERRED). Tulajdonosi feltétel: Külön tulajdonosi jóváhagyás + üzleti/jogi feltételek
* **ATL-PLN-0082** — Egyéb jóváhagyott kártevő-motor adapter (csak tulajdonosi igényre) (PLANNED_DEFERRED). Tulajdonosi feltétel: Csak tulajdonosi igény esetén
* **ATL-PLN-0088** — Jövőbeli, külön engedélyezett élő kereskedési teljesítmény-nézet (PLANNED_DEFERRED). Tulajdonosi feltétel: Külön engedély; jelenleg NOT_AUTHORIZED
* **ATL-PLN-0095** — Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-edit-workflow change-set -> teszt -> független átnézés; automatikusan nem aktiválható (PLANNED_DEFERRED). Tulajdonosi feltétel: Külön tulajdonosi döntés az aktiváláshoz
* **150 jövőbeli ötlet:** 147 nem teljesen igazolt tétel P5 feladatként nyilvántartva, aktiválás nélkül.
* A direktívákban halasztottként jelölt sorok: 23 (robot, 300 ügynök, VIRENA stb. — `directive_items.csv`, `deferred` oszlop).

## 8. Tulajdonosi döntések, amelyek az ütemezéshez kellenek (57)

* **ATL-DEC-0001** — Tulajdonosi kulcs (owner-key) kiadása / provisionálása és aláírt jóváhagyások · részlet: Kulcs + egress-jóváhagyás (13); Owner-kulcs provisionálása a tényleges jóváhagyáshoz. (12); kulcs, egress- és enable-aláírás (11); Owner-kulcs. (9); …
* **ATL-DEC-0002** — Egress-policy és host/hoszt jóváhagyás aláírása · részlet: host-jóváhagyás (14); Egress jóváhagyás (11); Hoszt-jóváhagyás (10); EGRESS_POLICY_SET aláírása (5); Host-jóváhagyás aláírása (4); EGRESS_POLICY_SET …
* **ATL-DEC-0003** — Modell-engedélyezés (MODEL_ENABLE) és költségkeret / költés jóváhagyása · részlet: Költés jóváhagyás (16); MODEL_ENABLE jóváhagyás (12); Engedélyezés (MODEL_ENABLE) + költségkeret (6); MODEL_ENABLE (3); hitelesítők, MODEL_ENABLE, kö…
* **ATL-DEC-0004** — Stripe / KOHO aktiválás engedélye · részlet: Stripe aktiválás (8); Stripe/KOHO engedélyezése (5); Tulajdonos: Stripe-aktiválás (5); Stripe-aktiválás. (4); Stripe-aktiválás (STRIPE_ACTIVATION_OWN…
* **ATL-DEC-0005** — Windows-teszt / kézi Windows futtatás jóváhagyása · részlet: Kézi Windows futtatás (16); Windows-teszt jóváhagyása (15); Windows build jóváhagyása (2); Windows build/teszt jóváhagyása (2); Windows-izoláció (1);…
* **ATL-DEC-0006** — Hangteszt (TTS/STT) jóváhagyása · részlet: hangteszt (8); Hangszolgáltató kiválasztása/költség (1); hangteszt megerősítése (1); Hangpróba igazolása (1); Hang jóváhagyása (1); Hangteszt igazolá…
* **ATL-DEC-0007** — Computer Use engedélyezése (minden következményes lépés) · részlet: Computer Use engedélyezése (minden következményes lépés) (8); Computer Use/böngésző engedélyezése (1)
* **ATL-DEC-0008** — Távoli elérés engedélyezése · részlet: Távoli elérés engedélyezése (9); távoli hozzáférés jóváhagyása (1)
* **ATL-DEC-0009** — Adószabályok / adószabály-forrás jóváhagyása · részlet: Adószabályok jóváhagyása (4); adószabály-forrás jóváhagyása (2); Adószabály-forrás és hatókör jóváhagyása (1); Kereskedelmi viszonteladói kiadás elin…
* **ATL-DEC-0010** — Kereskedelmi (licenc) modell döntése · részlet: kereskedelmi modell (6); Kereskedelmi kampány hatóköre (1); kereskedelmi kiadás jóváhagyása (1); a kereskedelmi kiadás funkciókészlete (1); kereskede…
* **ATL-DEC-0011** — Legacy fájlok sorsa · részlet: legacy fájlok sorsa (4); Legacy-döntés (3); 3 legacy modul sorsa (B6-005) (1); Legacy runtime sorsa (B6-005) (1); Legacy runtime sorsa (1); legacy fá…
* **ATL-DEC-0012** — Élő források / adatszolgáltató és licenc jóváhagyása · részlet: adatszolgáltató és licenc jóváhagyása (4); Első élő forrás jóváhagyása. (4); Első élő forrás jóváhagyása (ATL-REQ-1799) (3); Első élő forrás jóváhagy…
* **ATL-DEC-0013** — Tulajdonosi policy-döntések · részlet: tulajdonosi policy-döntés (7); policy-döntés (3); POST-policy jóváhagyása (1); auto-update policy (1); felsorolt policy elemek jóváhagyása (1); D12 e…
* **ATL-DEC-0014** — Egyéb tulajdonosi döntések (tételes lista a részletekben) · részlet: Fázis jóváhagyása (4); scanner jóváhagyás (3); Scanner kiválasztása (3); Aláírás (3); Ütemezett felderítés engedélyezése (3); Transport külön tulajdo…
* **ATL-DEC-0015** — Döntés / jóváhagyás: Fizikai robot / humanoid interfész (külön, későbbi projekt)
* **ATL-DEC-0016** — Döntés / jóváhagyás: Ügyfélszolgálat / támogatási jegy és SLA modul + support executor
* **ATL-DEC-0017** — Döntés / jóváhagyás: Média-eszközök: videó-, hang-/zene-, 3D-munkafolyamatok, médiakonverzió és szerkesztési adapter sze…
* **ATL-DEC-0018** — Döntés / jóváhagyás: Connector-adapter: Google Contacts (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0019** — Döntés / jóváhagyás: Connector-adapter: Clearbit (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0020** — Döntés / jóváhagyás: Connector-adapter: Apollo (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0021** — Döntés / jóváhagyás: Connector-adapter: Lusha (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0022** — Döntés / jóváhagyás: Connector-adapter: Resend (e-mail küldő) (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0023** — Döntés / jóváhagyás: Connector-adapter: Close CRM (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0024** — Döntés / jóváhagyás: Connector-adapter: BuildingConnected (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0025** — Döntés / jóváhagyás: Connector-adapter: Metricool (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0026** — Döntés / jóváhagyás: Connector-adapter: Socialmonials (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0027** — Döntés / jóváhagyás: Connector-adapter: WordPress / CMS (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0028** — Döntés / jóváhagyás: Connector-adapter: Nano Banana (kép) (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0029** — Döntés / jóváhagyás: Connector-adapter: HeyGen (videó) (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0030** — Döntés / jóváhagyás: Connector-adapter: Runway (videó) (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0031** — Döntés / jóváhagyás: Connector-adapter: LTX Studio (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0032** — Döntés / jóváhagyás: Connector-adapter: Veo (videó) (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0033** — Döntés / jóváhagyás: Connector-adapter: Suno (zene) (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0034** — Döntés / jóváhagyás: Connector-adapter: CapCut (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0035** — Döntés / jóváhagyás: Connector-adapter: DaVinci Resolve (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0036** — Döntés / jóváhagyás: Connector-adapter: Shutter Encoder (descriptor + adapter + vault-kulcs + teszt + UI)
* **ATL-DEC-0037** — Döntés / jóváhagyás: Blockchain / Web3 / okosszerződés / tokenizáció / NFT fejlesztői szolgáltatás (sandboxolt executor …
* **ATL-DEC-0038** — Döntés / jóváhagyás: KÜLÖN kereskedelmi licenc-rendszer (nem a tulajdonos belső ATLASZ-példánya): licenc- és jutalékos m…
* **ATL-DEC-0039** — Döntés / jóváhagyás: Biztonságos távoli kapcsolat (TLS / VPN) a mobil/távoli vezérléshez
* **ATL-DEC-0040** — Döntés / jóváhagyás: main ág védelme (GitHub branch protection + pre-push hook)
* **ATL-DEC-0041** — Döntés / jóváhagyás: Több gép / több példány közötti adatzár: döntés (egypéldányos telepítés + példányzár VAGY külső koo…
* **ATL-DEC-0042** — Döntés / jóváhagyás: Pont-időponti visszaállítás (naplóalapú visszajátszás) és adatbázis-mentés / tárolási döntés (fájl-…
* **ATL-DEC-0043** — Döntés / jóváhagyás: Adatvédelmi megfelelés: export/törlés kérelem kezelő, adatvédelmi beállítások
* **ATL-DEC-0044** — Döntés / jóváhagyás: GST/PST szabálybázis, ITC előkészítés, időszakos összesítés, PST-köteles tranzakciók vizsgálata, ad…
* **ATL-DEC-0045** — Döntés / jóváhagyás: Website Manager: domain/DNS/SSL munkafolyamatok (jóváhagyással), weboldal-műveleti fázisgép (READ/P…
* **ATL-DEC-0046** — Döntés / jóváhagyás: Web/app fejlesztési munkafolyamat (sablon + build + teszt + csomag) és website/szoftverfejlesztő es…
* **ATL-DEC-0047** — Döntés / jóváhagyás: Térkép / helymeghatározás modul szolgáltató-adapterekkel: geocoding, címkeresés, helyszínek, útvona…
* **ATL-DEC-0048** — Döntés / jóváhagyás: Frissítési csővezeték kiegészítés: biztonságos letöltő (allowlist+hash/aláírás), megszakadt letölté…
* **ATL-DEC-0049** — Döntés / jóváhagyás: Beszerzési forrás-adapterek: magán RFP/RFQ/alvállalkozói, beszállítói regisztráció és portálok, köz…
* **ATL-DEC-0050** — Döntés / jóváhagyás: Piaci adat-adapter (inaktív, jóváhagyásig), részvényindex-forrás és autonóm stratégiakutatás ügynök…
* **ATL-DEC-0051** — Döntés / jóváhagyás: Egyéb jóváhagyott kártevő-motor adapter (csak tulajdonosi igényre)
* **ATL-DEC-0052** — Döntés / jóváhagyás: Jövőbeli, külön engedélyezett élő kereskedési teljesítmény-nézet
* **ATL-DEC-0056** — Döntés / jóváhagyás: Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-edit-workflow change…
* **ATL-DEC-0057** — Döntés / jóváhagyás: Látás- és környezet-érzékelés: tárgy- és eszközfelismerés (Object and Equipment Recognition), körny…
* **ATL-DEC-0053** — Döntés / jóváhagyás: Engedélyezett valódi connector-teszt és futási bizonyíték-gyűjtés
* **ATL-DEC-0054** — Döntés / jóváhagyás: Valódi STAGING környezet, Windows CI + test hardening (LF, junction symlink, rm retry, POSIX szigná…
* **ATL-DEC-0055** — A karanténba tett régi futtatókörnyezet (worker.js, supervisor.js, agent-child.js) sorsa · részlet: A v1 leltár ezeket rendes elemnek vette; v2-ben LEGACY_QUARANTINED. Törlés/archiválás csak tulajdonosi döntéssel.

## 9. Megállapítások a direktíva-sorok átvizsgálásából (302)

* CONFLICT / CODE_VS_DOC / OPEN: 150
* CONFLICT / REGISTER_STALE / OPEN: 104
* ELTÉRÉS / STATUS_DIFF / RECORDED: 9
* UNREGISTERED / UNREGISTERED_PATH / RESOLVED_BY_V2_REGISTRATION: 39

Ezek jellemzően dokumentáció↔kód eltérések (pl. egy régi regiszter `MISSING`, de a kód létezik; vagy ellenkezőleg) és olyan útvonalak, amelyeket az átvizsgáló nem talált a leltárban. A nyilvántartott útvonalak automatikusan feloldódtak (`RESOLVED_BY_V2_REGISTRATION`).

## 10. Kötelező ellenőrzések (a jelentés előtt)

| Ellenőrzés | Eredmény | Részlet |
|---|---|---|
| A v1 ledger minden bejegyzése és azonosítója változatlanul megmaradt | ✔ | elveszett/megváltozott: 0 |
| A 898 v1 rendszerelem azonosítója és neve változatlan | ✔ | átnevezett: 0 |
| Nincs ismétlődő azonosító a táblák között | ✔ | ismétlődő: [] |
| A ledgerben minden azonosító egyedi (nincs újrafelhasználás) | ✔ |  |
| Minden azonosító ledger-bejegyzéshez köthető (a v1 követelmény/CAP/SIR/FUT azonosítók a v1 ledgerben vannak) | ✔ | hiányzó: [] |
| Mind az 1859 követelmény-sor + 258 (85/23/150) tétel szerepel a mátrixban | ✔ | 2117 sor |
| Mind a 12 476 direktíva-/specifikáció-sor azonosítót kapott | ✔ | 12476 |
| Mind a 42 feltöltött direktíva forrásként azonosítva | ✔ |  |
| Pontosan 30 állandó ügynök (5 SEARCH + 25 EXECUTION), a Master/AURÓRA nem ügynök | ✔ |  |
| Minden MISSING követelményhez tartozik tervezett modul/bővítés azonosító | ✔ | hiányzik: [] |
| Minden MISSING követelményhez tartozik megvalósítási munkaterv-feladat | ✔ | hiányzik: [] |
| Minden nem-VERIFIED követelményhez (REQ/CAP/SIR) tartozik munkaterv-feladat | ✔ | feladat nélkül: 0 [] |
| A 150 jövőbeli ötlet nem-VERIFIED tételei halasztott feladatként szerepelnek | ✔ | hiányzik: [] |
| Minden munkát igénylő direktíva-sorhoz tartozik feladat | ✔ | feladat nélkül: 0 |
| Minden duplikált direktíva-sor az eredetire hivatkozik | ✔ |  |
| Tervezett (PLN) azonosító nincs a meglévő rendszerelemek között | ✔ |  |
| Tervezett elem státusza soha nem működő státusz | ✔ |  |
| A tervezett modulok mind kaptak legalább egy követelményt/direktíva-sort (nincs üres modul) | ✔ | üres: [] |
| Halasztott tételek külön jelöltek és nem számítanak az aktív órákba | ✔ |  |
| Minden hivatkozás létező azonosítóra mutat | ✔ | hibás: [] |
| A munkaterv függőségei körmentesek | ✔ | ciklus: [] |
| Az aktív feladat-órák és a követelményekre szétosztott órák egyeznek (a követelmény nélküli feladatokon kívül) | ✔ | {'active_task_total_h': 5150.4, 'requirement_allocated_h': 3305.0, 'task_h_without_requirement_link… |
| Minden munkaterv-sor kapcsolódik ATL-komponenshez vagy tervezett modulhoz, vagy dokumentált indoklása van | ✔ | kapcsolat/indoklás nélkül: [] |
| A munkaterv dokumentum-/modul-hivatkozásai létező azonosítók | ✔ | [] |
| Minden MISSING CAP/FUT tételhez tartozik tervezett modul azonosító | ✔ | hiányzik: [] |
| Minden nem-VERIFIED követelmény-sor kapcsolódik ATL-komponenshez vagy tervezett modulhoz | ✔ | kapcsolat nélkül: 0 [] |
| A halasztott ötlet-tételek munkaterv-sora nem aktív (P5, deferred) | ✔ |  |
| A tervezett modul-tétel (PLN) mindig tartalmaz requirement-hivatkozást vagy direktívát | ✔ | [] |
| ATL-FUT-0141: tervezett modul, név, kapcsolódó meglévő modulok, munka-összekötés kitöltve; halasztott | ✔ | ATL-PLN-0095 ATL-WRK-0782; ATL-WRK-0752 |
| Csak docs/ alatti fájl változott (futó rendszer kódja nem módosult) | ✔ | docs/-on kívül: [] |
| Fel nem oldott catalog-hivatkozás (rel) nincs | ✔ | [] |
| A katalógus explicit kulcsai mind léteznek | ✔ | [] |

Hibák: **0**, figyelmeztetések: **0**.

## 11. Lekérdezés bármely ATL-azonosítóra

```
python3 docs/system_inventory/atl_query.py ATL-UIX-0023        # rendszerelem
python3 docs/system_inventory/atl_query.py ATL-REQ-0314        # követelmény
python3 docs/system_inventory/atl_query.py ATL-PLN-0003        # tervezett modul
python3 docs/system_inventory/atl_query.py ATL-WRK-0011 --links # munkaterv-feladat + kapcsolatok
```
Válasz: mi ez · létezik-e · működik-e és milyen bizonyítási szinten · mi hiányzik · mihez kell kötni · pontosan milyen munka kell (óra, ellenőrzés, elfogadás) · mely követelmény igényli. Ugyanez SQL-ben: `atlasz_system_inventory.sqlite` (`all_ids` nézet, `links` tábla).

## 12. Módszer és őszinte korlátok

* **Állapotok.** Az 1. kiadás állapotszabálya változatlan (kód + bekötés + teszt + ismert hiba + kapcsolt követelmények). A tervezett elemek állapota mindig PLANNED/PLANNED_EXTEND/PLANNED_DEFERRED/DECISION_PENDING — soha nem működő státusz.
* **Direktíva-sorok besorolása.** A 12 476 sort 20 csak-olvasás átvizsgálási menet sorolta be (követelmény / szabály / folyamat / leírás / halasztott), a rendszerelemekhez gépi (tf-idf) tippekkel és kézi/szabályalapú ellenőrzéssel rendelve. Ez **nem** minden sor kézi, emberi jóváhagyása: a pontosság mintavétellel ellenőrizhető (`directive_items.csv`: `evidence`, `notes`). A duplikált sorok (135) az eredeti sorra hivatkoznak; a rövid/cím sorok (2046) önálló követelmény nélküliek.
* **Órabecslés.** Állapot-alapú normák: PARTIAL 3+1,5 ó, CONNECTED_UNTESTED 1+2, STRUCTURAL_ONLY 3+2, MOCK_ONLY 2+3, EXTERNAL_BLOCKER 3+4, BROKEN 4+2, NOT_YET_VERIFIED 0+1,5; a v1 'részleges' sorok a kapcsolt hiányzó követelmények számával skálázva (cap 16+8); a P0/P1 hibák egyenként becsültek; új modulok a katalógusban modulonként becsültek (`pln_catalog.py`). A követelményenkénti óra a feladat óráinak arányos szétosztása, ezért az összeg egyezik a feladat-összeggel (a követelmény nélküli feladatokat leszámítva) — **nem additív a komponens-szintű nézettel**.
* **Nincs élő bizonyíték.** Egyetlen külső rendszer sem lett kipróbálva (élő modell, Stripe, KOHO, e-mail, hang, Windows). A számlázott ≠ fizetett, a piszkozat ≠ elküldött, ismeretlen bevétel/költség sosem nulla elvek változatlanok.
* **Mit nem csináltam.** Nem módosítottam futó kódot, nem építettem meg tervezett modult, nem aktiváltam külső szolgáltatást, nem vállaltam költséget; a `main` ágat nem érintettem.

## 13. Megállok — a döntés a tiéd

A fejlesztés sorrendjét te határozod meg. A munkamódszer, amikor jóváhagyod: **EGY MODUL → teljes megépítés/javítás → bekötés → tesztelés → hibajavítás → igazolt lezárás → KÖVETKEZŐ MODUL**, a végén ZERO TOLERANCE teljes vizsgálat (`ATL-WRK` végső feladat). A döntésekhez a P0–P2 lista (6. pont) és a tulajdonosi döntések (8. pont) adnak alapot; a korábban jelzett első jelölt: **ATL-UIX-0023** (D-01 nézet-összeomlás, ~5 óra).
