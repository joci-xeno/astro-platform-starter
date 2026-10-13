# ATLASZ AURÓRA V7.3 – Központi azonosítórendszer és teljes rendszerleltár

Dátum: 2026-10-12 · Git: `2e3e9e2` · Állapot: **csak ellenőrzés és nyilvántartás – a működő rendszer kódja nem változott, hiányzó funkciót nem építettem, új szolgáltatást nem aktiváltam.**

Az azonosító **nem** jelent kész állapotot. A státusz a bizonyítékból jön: a kód léte, a bekötés, a tesztek és az éles működés **külön mező**. Egyetlen külső rendszeren (Stripe, KOHO, AI-modell, e-mail, hang, Windows) sincs valódi/éles bizonyíték.

## 1. Fő számok

| Tétel | Darab |
|---|---|
| Azonosított rendszerelem (ATL-…) összesen | **898** |
| – ebből futó rendszerelem (kód, végpont, nézet, ügynök, integráció, szolgáltató, folyamat) | 590 |
| – ebből teszt (ATL-TST) | 245 |
| – ebből ellenőrző eszköz / nyilvántartási dokumentum (ATL-CHK) | 62 |
| Feldolgozott követelmény-sor (23 fejezet, A+B; ATL-REQ) | **1859** (ebből 1564 tényleges követelmény, 166 címsor, 129 kontextus) |
| Eredeti 85 képesség (ATL-CAP) / 23 biztonsági-infrastruktúra (ATL-SIR) / 150 jövőbeli tétel (ATL-FUT) | 85 / 23 / 150 |
| Követelmény↔rendszerelem kapcsolat | 10043 |
| Megőrzött régi azonosító (megfeleltetési tábla) | 5133 |

### Rendszerelemek állapota (az összes ATL-azonosított elem)

| Állapot | Összes | Futó rendszerelem (teszt/ellenőrző eszköz nélkül) |
|---|---|---|
| VERIFIED_WORKING | 413 | 166 |
| PARTIAL | 304 | 304 |
| STRUCTURAL_ONLY | 14 | 12 |
| CONNECTED_UNTESTED | 39 | 39 |
| MOCK_ONLY | 23 | 23 |
| MISSING | 1 | 1 |
| BROKEN | 2 | 2 |
| EXTERNAL_BLOCKER | 42 | 42 |
| OWNER_APPROVAL_REQUIRED | 1 | 1 |
| NOT_YET_VERIFIED | 59 | 0 |

### Követelmények állapota (a 1564 tényleges követelmény, az ellenőrzési nyilvántartás szerint)

| Állapot | Darab |
|---|---|
| VERIFIED_WORKING | 381 |
| PARTIAL | 764 |
| STRUCTURAL_ONLY | 44 |
| CONNECTED_UNTESTED | 52 |
| MOCK_ONLY | 35 |
| MISSING | 155 |
| BROKEN | 4 |
| EXTERNAL_BLOCKER | 114 |
| OWNER_APPROVAL_REQUIRED | 15 |
| NOT_YET_VERIFIED | 0 |

## 2. Az azonosítórendszer szabályai

* Formátum: `ATL-<KATEGÓRIA>-<NNNN>`; kategóriák: `BRN` MASTER BRAIN / tervezés / koordináció; `AUR` AURÓRA / személyiség / Human Core; `AGT` Ügynökök (30 állandó + ügynök-réteg); `MDL` AI-modellek, adapterek, modellválasztás; `MEM` Memória, tanulás, RAG, visszakeresés; `VOI` Beszéd és hang; `AVA` Avatár, vizuális és multimodális; `INT` Külső integráció / connector / bővítmény-kapcsolat; `API` API-végpont és szerver; `SEC` Biztonság, tulajdonosi vezérlés, vault; `FIN` Pénzügy, főkönyv, adó, számlázás; `WFL` Üzleti munkafolyamat, kapuk, szakaszok; `RES` Piackutatás, felderítés, elemzés; `DOC` Dokumentum, fájl, kommunikáció; `OPS` Működtetés, helyreállítás, megfigyelés, frissítés; `SCH` Ütemező, háttérfolyamat, watchdog; `PLG` Plugin, skill, eszköznyilvántartás; `DEV` Fejlesztő-asszisztens; `LRN` Személyes tanulás és produktivitás; `MOB` Mobil és távoli vezérlés; `WIN` Windows desktop / telepítő; `UIX` Felület (panel, nézet); `TST` Teszt; `CHK` Ellenőrző eszköz / generátor / segédszkript; `TPL` Nem ATLASZ sablon (Astro/Netlify starter); `REQ` Követelmény (23 fejezet A/B sor); `CAP` Eredeti 85 képesség; `SIR` 23 biztonsági és infrastruktúra-követelmény; `FUT` 150 jövőbeli fejlesztési tétel.
* Az azonosítót a **valós kódleltár** alapján osztottam ki (git által követett forrásfájlok, a Control Center végpont-térképe, az UI-nézetek, a 14 szakasz, a 30 ügynök, a szolgáltatói/connector-leírók, az ütemezők). Kategóriánként növekvő sorszám, a természetes kulcs (fájlútvonal / ügynök-név / végpont / nézet / szakasz-név) szerint.
* **Állandóság:** a `id_ledger.json` rögzíti: természetes kulcs → azonosító. Újrafuttatáskor a kiosztott azonosító nem változik; egy eltűnt kulcs `RETIRED` lesz, **az azonosítója soha nem osztható ki újra**; verzióváltáskor/javításkor az azonosító marad. A `history.jsonl` csak bővül (kiosztás, visszavonás, névváltozás, újraaktiválás).
* **Meglévő azonosítók megőrizve** (nem lettek átírva, a futó rendszer által használt azonosítók érintetlenek): V7.3 mester-regiszter `V73-…` (983), Master Execution Tracker feladat-azonosítók, `GAP-…`, `CAP85/M##`, `PKG150-…`, hibaregiszter `DEF-…`, a mostani ellenőrzés `D-01…D-12` és sor-azonosítói (`C01A-L45` …), modul-azonosítók (`module_dispositions`), ügynök-nevek (`SEARCH-1…EXECUTION-25`), connector-/szolgáltató-azonosítók, milestone-hivatkozások. Mindegyik a `legacy_id_map.csv`-ben (5133 sor) az ATL-azonosítóhoz vagy a kapcsolódó komponensekhez van kötve.
* Nem létező azonosító-rendszerek: tesztnek korábban **nem volt** külön azonosítója (a fájlnév volt az – megfeleltetve ATL-TST-hez); futásidejű projekt-azonosító nincs a statikus forrásban (a `shared-project-registry` futás közben állít elő ilyet) – ezeket nem találtam ki.
* A 3. pont **20 adatlap-mezője** minden rendszerelemnél szerepel (`components.csv` / JSON). Ismeretlen adat `UNKNOWN`, nem találtam ki: verzió 880 elemnél (nincs deklarált verzió), feladat-leírás 115 elemnél (nincs fejléc-megjegyzés és export). Ahol nincs fejléc, de van export, a leírás a forrás export-neveiből származik, és így van jelölve.
* Géppel feldolgozható formák: `atlasz_id_registry.json`, `atlasz_id_registry.sqlite` (táblák: components, requirements, source_sets, req_component_links, component_relations, component_tests, legacy_ids, id_ledger, history), CSV-k. Újraépítés: `python3 docs/identity_registry/build_identity_registry.py` majd `render_identity_report.py` (csak olvas, a futó rendszer kódját nem érinti).

## 3. Rendszerelemek kategóriánként és állapotonként

| Kategória | Összes | VERIFIED WORKING | PARTIAL | STRUCTURAL ONLY | CONNECTED UNTESTED | MOCK ONLY | MISSING | BROKEN | EXTERNAL BLOCKER | OWNER APPROVAL REQUIRED | NOT YET VERIFIED |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `BRN` MASTER BRAIN / tervezés / koordináció | 45 | 8 | 36 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `AUR` AURÓRA / személyiség / Human Core | 5 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `AGT` Ügynökök (30 állandó + ügynök-réteg) | 45 | 1 | 44 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `MDL` AI-modellek, adapterek, modellválasztás | 27 | 0 | 8 | 0 | 0 | 6 | 1 | 0 | 12 | 0 | 0 |
| `MEM` Memória, tanulás, RAG, visszakeresés | 15 | 0 | 14 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| `VOI` Beszéd és hang | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |
| `AVA` Avatár, vizuális és multimodális | 5 | 0 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `INT` Külső integráció / connector / bővítmény-kapcsolat | 44 | 0 | 1 | 5 | 0 | 10 | 0 | 0 | 28 | 0 | 0 |
| `API` API-végpont és szerver | 123 | 82 | 4 | 0 | 37 | 0 | 0 | 0 | 0 | 0 | 0 |
| `SEC` Biztonság, tulajdonosi vezérlés, vault | 39 | 5 | 32 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| `FIN` Pénzügy, főkönyv, adó, számlázás | 25 | 0 | 24 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| `WFL` Üzleti munkafolyamat, kapuk, szakaszok | 37 | 1 | 33 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 |
| `RES` Piackutatás, felderítés, elemzés | 19 | 4 | 14 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| `DOC` Dokumentum, fájl, kommunikáció | 8 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `OPS` Működtetés, helyreállítás, megfigyelés, frissítés | 36 | 3 | 32 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `SCH` Ütemező, háttérfolyamat, watchdog | 16 | 0 | 15 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| `PLG` Plugin, skill, eszköznyilvántartás | 8 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `DEV` Fejlesztő-asszisztens | 8 | 1 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `LRN` Személyes tanulás és produktivitás | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `MOB` Mobil és távoli vezérlés | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `WIN` Windows desktop / telepítő | 3 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `UIX` Felület (panel, nézet) | 75 | 61 | 11 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| `TST` Teszt | 245 | 245 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `CHK` Ellenőrző eszköz / generátor / segédszkript | 62 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 58 |
| `TPL` Nem ATLASZ sablon (Astro/Netlify starter) | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

**Állapot-szabály (levezetve, nem szubjektív):** egy forrásfájl-komponens VERIFIED_WORKING, ha van (közvetlen) tesztje 0 bukással, be van kötve a futó rendszerbe (integration_matrix vagy statikus import-lánc), nem külső-érintkező modul, nincs ismert hibája, és **egyetlen kapcsolt követelménye sem gyengébb** VERIFIED_WORKING-nál. Ha tesztelt, de kapcsolt követelményei részlegesek/hiányzóak → PARTIAL. Külső-érintkező modul (adapter/connector/hang/webhook) fake/fixture teszttel → MOCK_ONLY. Teszt nélkül bekötve → CONNECTED_UNTESTED; teszt és bekötés nélkül → STRUCTURAL_ONLY. Külső szolgáltatás (Stripe, KOHO, AI-szolgáltató, connector, chat-platform) → EXTERNAL_BLOCKER, mert nincs hitelesítő adat és kapcsolati bizonyíték. VERIFIED_WORKING = fixture/helyi szinten igazolt, **nem** éles.

## 4. Követelmény-nyilvántartás és a teljes megfeleltetés

* Minden követelmény-sor kapott `ATL-REQ-NNNN` azonosítót (+ megmaradt az eredeti `C##A/B-L###` sorazonosító). A hiányzó követelmények is megmaradtak.
* Kapcsolt (van legalább egy rendszerelem): **1437** a 1564 tényleges követelményből; 1 követelményhez több rendszerelem, 1 elemhez több követelmény tartozhat (`requirement_component_links.csv`, 10043 kapcsolat; reláció-típus: IMPLEMENTED_BY_FILE, EXPOSED_BY_ENDPOINT, VERIFIED_BY_TEST, RECORDED_IN_DOCUMENT, MENTIONS_*, ROSTER_MEMBER_VIA_REGISTRY).
* Rendszerelem nélküli követelmény: **127** (`requirements_without_component.csv`): ebből **115 MISSING** (nincs megvalósított modul – szándékosan megőrizve), 12 nem MISSING, de nincs azonosítható kódfájl (dokumentum-/folyamat-jellegű vagy könyvtár-hivatkozás: pl. „atlasz-tests/”, adatbázis-ág, commit-azonosító sor).
* Követelmény nélküli futó rendszerelem: **186** (`components_without_requirement.csv`): UI_VIEW 61, HTTP_ENDPOINT 34, SOURCE_FILE 31, EXTERNAL_SERVICE 23, MODEL_PROVIDER 13, BACKGROUND_PROCESS 12, WORKFLOW_STAGE 12. A forrásdokumentum sorai ezeket nem nevesítették fájl/végpont szinten (a nézeteket és végpontokat a követelmény-sorok csak részben hivatkozzák), vagy a komponens kutatási/kiegészítő jellegű (pl. kereskedelmi-kutatási modulok, `registrations/*`, a böngészőbővítmény fájljai). Ez **nem** jelenti, hogy felesleges vagy kész: tulajdonosi besorolás kell, hogy tartozzon-e hozzá külön követelmény.
* A 85 / 23 / 150 külön forrásdokumentum-tételei: 
  * 85 képesség: 85 tétel – PARTIAL 52, EXTERNAL_BLOCKER 22, VERIFIED_WORKING 9, STRUCTURAL_ONLY 2.
  * 23 biztonsági és infrastruktúra: 23 tétel – PARTIAL 21, VERIFIED_WORKING 2.
  * 150 jövőbeli tétel: 150 tétel – PARTIAL 123, EXTERNAL_BLOCKER 15, STRUCTURAL_ONLY 8, VERIFIED_WORKING 3, MISSING 1.
  * A **halasztott** (deferred) tételeket nem minősítettem automatikusan megvalósítandónak: a `deferred` mező megmaradt, a státusz az aktuális kódot írja le.

## 5. Kész és igazolt (VERIFIED_WORKING) rendszerelemek – fixture/helyi szinten, NEM éles

Forrásfájl-modulok (25):

| ID | Név | Teszt (gate 2026-10-12) |
|---|---|---|
| ATL-AGT-0031 | agent-activity | 76 pass / 0 fail, 6 tesztfájl |
| ATL-BRN-0002 | brain/brain-system | 61 pass / 0 fail, 7 tesztfájl |
| ATL-BRN-0003 | brain/business-factory | 13 pass / 0 fail, 1 tesztfájl |
| ATL-BRN-0033 | registrations/agents | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-BRN-0036 | registrations/discovery | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-BRN-0037 | registrations/models | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-BRN-0040 | registrations/security | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-BRN-0041 | registrations/tools | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-BRN-0042 | registrations/workflow | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-DEV-0005 | dev-assist-common | 31 pass / 0 fail, 3 tesztfájl |
| ATL-OPS-0018 | owner-control/recovery-source-map | 7 pass / 0 fail, 1 tesztfájl |
| ATL-OPS-0019 | owner-control/safe-mode-scope | 6 pass / 0 fail, 1 tesztfájl |
| ATL-OPS-0031 | atlasz-runtime/agent-child.js | 13 pass / 0 fail, 1 tesztfájl |
| ATL-RES-0002 | backtest | 54 pass / 0 fail, 3 tesztfájl |
| ATL-RES-0009 | market-data | 23 pass / 0 fail, 1 tesztfájl |
| ATL-RES-0013 | orb-strategy | 23 pass / 0 fail, 1 tesztfájl |
| ATL-RES-0015 | paper-trader | 21 pass / 0 fail, 1 tesztfájl |
| ATL-SEC-0001 | agent-tool-policy-ext | 29 pass / 0 fail, 2 tesztfájl |
| ATL-SEC-0013 | enterprise-control-plane | 18 pass / 0 fail, 3 tesztfájl |
| ATL-SEC-0024 | owner-control/approval-gateway | 14 pass / 0 fail, 2 tesztfájl |
| ATL-SEC-0028 | owner-control/owner-control-system | 7 pass / 0 fail, 2 tesztfájl |
| ATL-SEC-0035 | safe-keys | 6 pass / 0 fail, 1 tesztfájl |
| ATL-UIX-0011 | atlasz-control-center/revenue-ops.mjs | 11 pass / 0 fail, 1 tesztfájl |
| ATL-UIX-0013 | atlasz-control-center/trading-panel.mjs | 168 pass / 0 fail, 25 tesztfájl; KÖZVETETT: csak a modult importáló komponensek tesztjei |
| ATL-WFL-0016 | deal-state | 18 pass / 0 fail, 2 tesztfájl |

Végpontok: 82 GET/POST végpont VERIFIED_WORKING (helyi smoke 200 vagy route-teszt) – lista: `components.csv` (kategória `API`). UI-nézetek: 59 / 61 nézet hibátlanul betölt – **csak megjelenítés**, a mögöttes funkció a saját komponensének státuszát követi.

## 6. Részleges (PARTIAL) rendszerelemek

304 elem (ebből 249 forrásfájl). Az okot a `missing_functions` mező adja (pl. kapcsolt követelmény részleges/hiányzó, vagy a futó rendszerből nem elérhető).

| ID | Név | Mi hiányzik / miért részleges |
|---|---|---|
| ATL-AGT-0001 | SEARCH-1 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0002 | SEARCH-2 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0003 | SEARCH-3 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0004 | SEARCH-4 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0005 | SEARCH-5 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0006 | EXECUTION-1 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0007 | EXECUTION-2 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0008 | EXECUTION-3 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0009 | EXECUTION-4 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0010 | EXECUTION-5 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0011 | EXECUTION-6 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0012 | EXECUTION-7 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0013 | EXECUTION-8 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0014 | EXECUTION-9 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0015 | EXECUTION-10 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0016 | EXECUTION-11 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0017 | EXECUTION-12 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0018 | EXECUTION-13 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0019 | EXECUTION-14 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0020 | EXECUTION-15 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0021 | EXECUTION-16 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0022 | EXECUTION-17 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0023 | EXECUTION-18 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0024 | EXECUTION-19 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0025 | EXECUTION-20 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0026 | EXECUTION-21 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0027 | EXECUTION-22 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0028 | EXECUTION-23 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0029 | EXECUTION-24 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0030 | EXECUTION-25 | EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott |
| ATL-AGT-0032 | agent-coordination | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) |
| ATL-AGT-0033 | agent-executors | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-AGT-0034 | agent-factory | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-AGT-0035 | agent-memory | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-AGT-0036 | agent-portfolio-manager | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-AGT-0037 | agent-registry | 13 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:13) |
| ATL-AGT-0038 | agent-status | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-AGT-0039 | agent-tool-broker | 19 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:19) |
| ATL-AGT-0040 | agent-workforce | 16 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:16) |
| ATL-AGT-0041 | capability-registry | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-AGT-0042 | execution-factory | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5, STRUCTURAL_ONLY:3) |
| ATL-AGT-0043 | handoff-ledger | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-AGT-0044 | qa-reviewer | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-AGT-0045 | team-lead-workflows | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-API-0001 | atlasz-control-center/core.mjs | 182 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, CONNECTED_UNTESTED:32, EXTERNAL_BLOCKER:25, MISSING:4, MOCK_ONLY:1, PARTIAL:119) |
| ATL-API-0002 | atlasz-control-center/server.mjs | 56 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:26, PARTIAL:30) |
| ATL-API-0088 | POST /api/updates/install | D-02 |
| ATL-API-0106 | POST /api/plugins/enable | D-02 |
| ATL-AUR-0001 | assistant-profiles | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-AUR-0002 | aurora | 68 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:9, PARTIAL:59) |
| ATL-AUR-0003 | human-core | 57 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MISSING:3, PARTIAL:53) |
| ATL-AUR-0004 | personal-command-center | 4 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:3) |
| ATL-AUR-0005 | preferences | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-AVA-0001 | a11y-audit | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-AVA-0003 | detail-level | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-AVA-0004 | modality-fabric | 30 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:9, MISSING:3, PARTIAL:12, STRUCTURAL_ONLY:6) |
| ATL-AVA-0005 | render | 10 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:9) |
| ATL-BRN-0001 | brain-master-bridge | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-BRN-0004 | brain/capability-graph | 15 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:15) |
| ATL-BRN-0005 | brain/central-brain | 5 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:4) |
| ATL-BRN-0006 | brain/evidence-sources | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-BRN-0007 | brain/governance | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-BRN-0008 | brain/governed-dispatch | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-BRN-0009 | brain/model-intelligence | 19 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:1, PARTIAL:17) |
| ATL-BRN-0010 | brain/opportunity-intelligence | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-BRN-0011 | brain/orchestrator | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-BRN-0012 | brain/owner-command | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3, STRUCTURAL_ONLY:1) |
| ATL-BRN-0013 | brain/planning-brain | 17 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:17) |
| ATL-BRN-0014 | brain/search-pipeline | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-BRN-0015 | brain/simulation-lab | 7 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:6) |
| ATL-BRN-0016 | brain/verifier | 13 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:12) |
| ATL-BRN-0017 | campaign-manager | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6, STRUCTURAL_ONLY:2) |
| ATL-BRN-0018 | debate-protocol | 6 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5) |
| ATL-BRN-0019 | decision-analysis | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:4) |
| ATL-BRN-0020 | digital-twin | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-BRN-0021 | general-intelligence-extensions | 2 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:1) |
| ATL-BRN-0022 | goal-planner | 14 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:13) |
| ATL-BRN-0023 | internal-integration-hub | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-BRN-0024 | master-brief | 12 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:12) |
| ATL-BRN-0025 | master-coordinator | 13 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:12) |
| ATL-BRN-0026 | master-planner-orchestrator | 13 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:13) |
| ATL-BRN-0027 | module-broker | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-BRN-0028 | multi-solution | 4 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:3) |
| ATL-BRN-0029 | outcome-compiler | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-BRN-0030 | progress-ledger | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-BRN-0031 | reasoning-common | 1 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1) |
| ATL-BRN-0034 | registrations/brain | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-BRN-0035 | registrations/business | 11 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MOCK_ONLY:2, PARTIAL:6, STRUCTURAL_ONLY:1) |
| ATL-BRN-0038 | registrations/runtime | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-BRN-0039 | registrations/safety | 1 kapcsolt követelmény nem VERIFIED_WORKING (STRUCTURAL_ONLY:1) |
| ATL-BRN-0043 | shared-project-registry | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-BRN-0044 | stall-replanner | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-BRN-0045 | task-ledger | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-DEV-0001 | alt-solution-harness | tesztelt, de a futó rendszerből nem érhető el; 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-DEV-0002 | architecture-assessor | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-DEV-0003 | code-edit-workflow | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-DEV-0004 | code-review | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-DEV-0006 | prototype-builder | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-DEV-0007 | repo-analyzer | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-DEV-0008 | test-intelligence | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-DOC-0001 | doc-extractors | 40 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:38, STRUCTURAL_ONLY:1) |
| ATL-DOC-0002 | doc-sync | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-DOC-0003 | document-center | 51 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:51) |
| ATL-DOC-0004 | form-assistant | 4 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:3) |
| ATL-DOC-0005 | social-drafts | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-DOC-0006 | transcript-actions | 6 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5) |
| ATL-DOC-0007 | translation-feedback | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MOCK_ONLY:1, PARTIAL:3, STRUCTURAL_ONLY:1) |
| ATL-DOC-0008 | universal-inbox | 18 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:3, PARTIAL:15) |
| ATL-FIN-0001 | budget-consumption-governor | 14 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:14) |
| ATL-FIN-0002 | business/finance-intelligence | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-FIN-0003 | business/invoice-preparation | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-FIN-0004 | business/invoice-service | 12 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10, STRUCTURAL_ONLY:2) |
| ATL-FIN-0005 | business/money-engine | 8 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:3, PARTIAL:5) |
| ATL-FIN-0006 | business/payment-events | 25 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:7, MOCK_ONLY:11, PARTIAL:7) |
| ATL-FIN-0007 | business/payment-verification | 4 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MOCK_ONLY:2) |
| ATL-FIN-0008 | business/recurring-billing | 10 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, OWNER_APPROVAL_REQUIRED:4, PARTIAL:5) |
| ATL-FIN-0009 | cost-completeness | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8, STRUCTURAL_ONLY:1) |
| ATL-FIN-0010 | daily-profit-objective | 27 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:6, PARTIAL:19, STRUCTURAL_ONLY:1) |
| ATL-FIN-0011 | financial-guard | 12 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:5, PARTIAL:7) |
| ATL-FIN-0012 | financial-ledger | 22 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:19, STRUCTURAL_ONLY:3) |
| ATL-FIN-0013 | fx-rates | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-FIN-0014 | invoice-engine | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-FIN-0015 | money-pipeline-controller | 7 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:2, PARTIAL:5) |
| ATL-FIN-0016 | money-supervisor | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-FIN-0017 | owner-control/financial-firewall | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-FIN-0018 | owner-control/money-state-guard | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-FIN-0019 | payment-confirmation-adapter | 2 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2) |
| ATL-FIN-0021 | profit-accounting-engine | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-FIN-0022 | profit-ledger | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-FIN-0023 | revenue-analytics | 2 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:1) |
| ATL-FIN-0024 | revenue-persistence | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-FIN-0025 | tax-accounting-engine | 14 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:1, STRUCTURAL_ONLY:12) |
| ATL-INT-0013 | browser-extension/lib/request.js | tesztelt, de a futó rendszerből nem érhető el |
| ATL-LRN-0001 | spaced-repetition | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-LRN-0002 | suggestions | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-LRN-0003 | tutor | 3 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:2) |
| ATL-MDL-0001 | context-manager | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-MDL-0002 | conversation | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-MDL-0003 | cost-model-router | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-MDL-0004 | effort-allocation | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6, STRUCTURAL_ONLY:1) |
| ATL-MDL-0006 | model-evidence | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:6) |
| ATL-MDL-0007 | model-evolution | 3 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:1, PARTIAL:2) |
| ATL-MDL-0009 | model-registry | 54 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:19, PARTIAL:33, STRUCTURAL_ONLY:2) |
| ATL-MDL-0010 | model-routing-bridge | 25 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:6, PARTIAL:18) |
| ATL-MEM-0001 | brain/knowledge-brain | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-MEM-0002 | brain/memory-fabric | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-MEM-0003 | business-memory | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-MEM-0004 | chunker | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, PARTIAL:5) |
| ATL-MEM-0006 | enterprise-knowledge-agentic-rag | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-MEM-0007 | experience-learning-engine | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-MEM-0008 | knowledge-projects | 25 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:23, STRUCTURAL_ONLY:1) |
| ATL-MEM-0009 | memory-store | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-MEM-0010 | notes-organizer | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-MEM-0011 | observation-memory | 9 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, EXTERNAL_BLOCKER:2, MOCK_ONLY:1, PARTIAL:5) |
| ATL-MEM-0012 | project-memory | 17 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:17) |
| ATL-MEM-0013 | retrieval-eval | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-MEM-0014 | semantic-index | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, MISSING:1, PARTIAL:4) |
| ATL-MEM-0015 | unified-entity-graph | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-MOB-0001 | mobile-api | 29 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:2, PARTIAL:27) |
| ATL-OPS-0001 | backup-recovery | 17 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:17) |
| ATL-OPS-0002 | brain/black-box | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) |
| ATL-OPS-0003 | brain/brain-health | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-OPS-0004 | brain/disaster-recovery | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-OPS-0005 | checkpoint-engine | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-OPS-0006 | completion-registry | 10 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:6, PARTIAL:3, STRUCTURAL_ONLY:1) |
| ATL-OPS-0007 | data-quality | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-OPS-0008 | dead-letter-queue | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-OPS-0009 | durable-dead-letters | 8 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:7) |
| ATL-OPS-0010 | durable-queue | 16 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, MISSING:2, PARTIAL:13) |
| ATL-OPS-0011 | event-bus | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-OPS-0012 | event-stream | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-OPS-0013 | file-lock | 2 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, MISSING:1) |
| ATL-OPS-0014 | local-update-adapters | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-OPS-0015 | migration-planner | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-OPS-0016 | observability-black-box | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3, STRUCTURAL_ONLY:1) |
| ATL-OPS-0017 | owner-control/recovery-points | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-OPS-0020 | owner-control/system-doctor | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-OPS-0021 | portable-backup | 11 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:10) |
| ATL-OPS-0022 | priority-queue-rate-limit-governor | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-OPS-0023 | recovery | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-OPS-0024 | regression-eval-suite | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-OPS-0025 | safe-mode | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-OPS-0026 | self-healing-loop | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-OPS-0027 | startup-self-check | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-OPS-0028 | tracing-evals | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-OPS-0029 | update-center | 21 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:21) |
| ATL-OPS-0032 | atlasz-runtime/owner-cli.mjs | tesztelt, de a futó rendszerből nem érhető el; 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-OPS-0033 | atlasz-runtime/runtime-http.mjs | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-OPS-0034 | atlasz-runtime/supervisor-safe.mjs | 18 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:2, PARTIAL:16) |
| ATL-OPS-0035 | atlasz-runtime/supervisor.js | tesztelt, de a futó rendszerből nem érhető el |
| ATL-OPS-0036 | atlasz-runtime/worker.js | nincs ismert (részletek: a kapcsolt követelmények sorai) |
| ATL-PLG-0001 | executor-toolbox-registry | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-PLG-0002 | plugin-installer | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-PLG-0003 | plugin-manager | 14 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:13) |
| ATL-PLG-0004 | skill-factory | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-PLG-0005 | skill-registry | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-PLG-0006 | tool-fabric | 15 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:3, PARTIAL:4, STRUCTURAL_ONLY:8) |
| ATL-PLG-0007 | typed-tools | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-PLG-0008 | workbench | 7 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5, STRUCTURAL_ONLY:1) |
| ATL-RES-0001 | analyst | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-RES-0003 | buyer-decision-maker-finder | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-RES-0004 | eligibility-model | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-RES-0005 | global-business-intelligence | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-RES-0006 | global-discovery | 44 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:11, MISSING:5, MOCK_ONLY:2, PARTIAL:25, STRUCTURAL_ONLY:1) |
| ATL-RES-0007 | lead-qualifier | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-RES-0010 | market-intelligence-engine | 10 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, PARTIAL:6, STRUCTURAL_ONLY:2) |
| ATL-RES-0011 | opportunity-intake | 31 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, EXTERNAL_BLOCKER:11, PARTIAL:19) |
| ATL-RES-0012 | opportunity-qualification-engine | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-RES-0014 | org-intelligence | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7, STRUCTURAL_ONLY:1) |
| ATL-RES-0016 | research-ledger | 19 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:19) |
| ATL-RES-0017 | source-allowlist | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:2, PARTIAL:2) |
| ATL-RES-0018 | tech-watch | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:2, PARTIAL:3) |
| ATL-RES-0019 | text-compare | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-SCH-0001 | health-monitor | 13 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, PARTIAL:12) |
| ATL-SCH-0002 | scheduler | 16 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:2, CONNECTED_UNTESTED:1, PARTIAL:13) |
| ATL-SCH-0003 | tick-loop | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-SCH-0004 | watchdog | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-SCH-0005 | Master felügyeleti tick (tick-loop + watchdog) | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0006 | Tartós ütemező (C12) | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0008 | Egészség-monitor, kör-megszakítók | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0009 | Watchdog (szívverés / lefagyás-észlelés) | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0010 | Runtime supervisor (OS-folyamatok, SEARCH worker-ek) | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0011 | Fizetési webhook vevő (nem auto-indul) | szándékosan nem auto-indul; élő Stripe nincs |
| ATL-SCH-0012 | Safe Mode + crash-loop védelem | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0013 | Indítási önellenőrzés | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0014 | Korlátos önjavító hurok | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0015 | Mentés / visszaállítási próba | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SCH-0016 | Ransomware kanári-monitor | folyamat-szintű hosszú távú futás nem bizonyított |
| ATL-SEC-0002 | agent-tool-policy | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0003 | anti-collusion-guard | 5 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:5) |
| ATL-SEC-0004 | approval-command-gateway | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-SEC-0005 | approval-requests | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0006 | audit-chain | 11 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1, PARTIAL:10) |
| ATL-SEC-0007 | brain/behavior-monitor | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0008 | brain/security-brain | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) |
| ATL-SEC-0009 | code-sandbox | 22 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:22) |
| ATL-SEC-0010 | credential-broker | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-SEC-0011 | egress-policy | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-SEC-0012 | emergency-stop | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-SEC-0014 | evidence-record | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0015 | execution-boundary | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0016 | file-intake | 10 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:10) |
| ATL-SEC-0017 | guardrail-engine | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-SEC-0019 | incident-response | 11 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:11) |
| ATL-SEC-0021 | network-supervisor | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-SEC-0022 | owner-auth | 8 kapcsolt követelmény nem VERIFIED_WORKING (OWNER_APPROVAL_REQUIRED:1, PARTIAL:7) |
| ATL-SEC-0023 | owner-control/agent-governor | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0025 | owner-control/claim-distinctions | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-SEC-0026 | owner-control/control-chain | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-SEC-0027 | owner-control/owner-authority | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0029 | owner-keystore | 6 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:6) |
| ATL-SEC-0030 | probe-evidence | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) |
| ATL-SEC-0031 | process-gate | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-SEC-0032 | quarantine | 18 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:18) |
| ATL-SEC-0033 | release-signing | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-SEC-0034 | restricted-node | 15 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:15) |
| ATL-SEC-0036 | secret-patterns | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-SEC-0037 | secret-vault | 13 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, PARTIAL:12) |
| ATL-SEC-0038 | security-gates | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-SEC-0039 | tenant-isolation | 25 kapcsolt követelmény nem VERIFIED_WORKING (OWNER_APPROVAL_REQUIRED:1, PARTIAL:22, STRUCTURAL_ONLY:2) |
| ATL-UIX-0001 | atlasz-control-center/agents-panel.mjs | 9 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:4, PARTIAL:5) |
| ATL-UIX-0002 | atlasz-control-center/brain-views.mjs | 1 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1) |
| ATL-UIX-0003 | atlasz-control-center/chat-providers-panel.mjs | 34 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:34) |
| ATL-UIX-0004 | atlasz-control-center/memory-panel.mjs | 4 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:2, PARTIAL:2) |
| ATL-UIX-0005 | atlasz-control-center/model-registry-panel.mjs | 39 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, EXTERNAL_BLOCKER:17, MOCK_ONLY:2, PARTIAL:19) |
| ATL-UIX-0006 | atlasz-control-center/money-views.mjs | 2 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, PARTIAL:1) |
| ATL-UIX-0007 | atlasz-control-center/ops-views.mjs | 5 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:3, PARTIAL:2) |
| ATL-UIX-0008 | atlasz-control-center/public/app.js | tesztelt, de a futó rendszerből nem érhető el; 160 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:2, CONNECTED_UNTESTED:41, EXTERNAL_BLOCKER:27, MISSING:2, PARTIAL:88) |
| ATL-UIX-0012 | atlasz-control-center/security-center-panel.mjs | 5 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:2, PARTIAL:3) |
| ATL-UIX-0014 | atlasz-control-center/vault-panel.mjs | 5 kapcsolt követelmény nem VERIFIED_WORKING (CONNECTED_UNTESTED:1, PARTIAL:4) |
| ATL-UIX-0056 | Nézet: Voice (voice) | a nézet mögötti funkció állapota a kapcsolt API/modul sorokban |
| ATL-WFL-0001 | business/artifact-registry | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-WFL-0002 | business/communication-center | 11 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:4, MOCK_ONLY:1, PARTIAL:6) |
| ATL-WFL-0003 | business/contract-review | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-WFL-0004 | business/crm | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-WFL-0005 | business/deal-pipeline | 7 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:2, PARTIAL:5) |
| ATL-WFL-0006 | business/delivery-service | 5 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:4) |
| ATL-WFL-0007 | business/entity-graph | 4 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:4) |
| ATL-WFL-0008 | business/inbox-pipeline | 9 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, MOCK_ONLY:1, PARTIAL:7) |
| ATL-WFL-0009 | business/job-system | 10 kapcsolt követelmény nem VERIFIED_WORKING (MOCK_ONLY:2, PARTIAL:8) |
| ATL-WFL-0010 | business/judge | 10 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:9) |
| ATL-WFL-0011 | business/package-delivery-adapter | 3 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:2) |
| ATL-WFL-0012 | business/qa-factory | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-WFL-0013 | business/store | 1 kapcsolt követelmény nem VERIFIED_WORKING (BROKEN:1) |
| ATL-WFL-0014 | client-dna-engine | 3 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:3) |
| ATL-WFL-0015 | contract-analysis | 9 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:9) |
| ATL-WFL-0017 | delivery-engine | 6 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:5) |
| ATL-WFL-0018 | follow-up-engine | 3 kapcsolt követelmény nem VERIFIED_WORKING (EXTERNAL_BLOCKER:1, PARTIAL:2) |
| ATL-WFL-0019 | negotiation-engine | 1 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:1) |
| ATL-WFL-0020 | proposal-quote-engine | 9 kapcsolt követelmény nem VERIFIED_WORKING (MISSING:1, OWNER_APPROVAL_REQUIRED:1, PARTIAL:7) |
| ATL-WFL-0021 | proposal-stage | 7 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:7) |
| ATL-WFL-0022 | workflow-engine | 8 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:8) |
| ATL-WFL-0023 | workflow-stages | 2 kapcsolt követelmény nem VERIFIED_WORKING (PARTIAL:2) |
| ATL-WFL-0025 | Üzleti szakasz 2: VERIFY | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0026 | Üzleti szakasz 3: QUALIFY | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0027 | Üzleti szakasz 4: ESTIMATE | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0028 | Üzleti szakasz 5: PLAN | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0029 | Üzleti szakasz 6: OWNER_APPROVAL | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0030 | Üzleti szakasz 7: EXECUTE | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0031 | Üzleti szakasz 8: QUALITY_ASSURANCE | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0032 | Üzleti szakasz 9: DELIVERY_APPROVAL | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0033 | Üzleti szakasz 10: DELIVER | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0034 | Üzleti szakasz 11: INVOICE | a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1) |
| ATL-WFL-0037 | Üzleti szakasz 14: NET_PROFIT | a hatóság-logika tesztelt; valós, ellenőrzött bevétel nincs |

## 7. Hiányzó modulok és követelmények

Hiányzó rendszerelem (az azonosítóval rendelkezők közül): ATL-MDL-0019 AI-szolgáltató: merlin (CLOUD) (adapter hiányzik (a tulajdonos adja a valódi API-hostot/specifikációt)).

**Hiányzó követelmények (155, mindegyik megőrizve, még nincs hozzájuk modul)** fejezetenként:

| Fejezet | MISSING követelmény |
|---|---|
| 2 | 11 |
| 3 | 1 |
| 5 | 23 |
| 6 | 2 |
| 7 | 5 |
| 8 | 12 |
| 9 | 7 |
| 11 | 1 |
| 12 | 38 |
| 13 | 2 |
| 14 | 3 |
| 15 | 5 |
| 17 | 5 |
| 18 | 28 |
| 19 | 6 |
| 20 | 2 |
| 21 | 2 |
| 22 | 2 |

A tételes lista (ATL-REQ azonosítóval, forrásszöveggel, javasolt javítással és külső függőséggel): `requirements_without_component.csv` (a MISSING sorok) és `requirements.csv`. Az AVA kategóriában (avatár, vizuális) 5 elem van, mind láthatósági/multimodális segédmodul; külön avatár-megjelenítő komponenst nem találtam a forráskódban.

## 8. Hibás integrációk és ismert hibák

| Hibaazonosító | Leírás | Érintett ATL-elemek |
|---|---|---|
| D-01 | Security & Supervision nézet összeomlik (sv.notes objektum, .map hiba) | ATL-UIX-0023, ATL-UIX-0008 |
| D-02 | /api/updates/install és /api/plugins/enable hibánál HTTP 200 ok:true; a UI 'done'-t mutat | ATL-API-0088, ATL-API-0106, ATL-UIX-0008 |
| D-03 | durable-queue.ack nem ellenőrzi a bérlőt | ATL-OPS-0010 |
| D-04 | nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti | ATL-BRN-0025, ATL-OPS-0010, ATL-OPS-0034 |
| D-05 | ~25 zár nélküli közös tár (utolsó író nyer) | ATL-WFL-0013, ATL-OPS-0013, ATL-MEM-0008, ATL-AUR-0004, ATL-MEM-0011 |
| D-06 | supervisor-safe.mjs fixen 0.0.0.0-n hallgat | ATL-OPS-0034 |
| D-07 | Hang UI nyelvváltó csak a válasz nyelvét váltja; 'Jó reggelt' gomb néma | ATL-UIX-0008, ATL-VOI-0001, ATL-UIX-0056 |
| D-08 | discoveryScheduler().tick() hívója nincs | ATL-SCH-0007, ATL-RES-0006 |
| D-09 | két karantén-tár, release/delete route nélkül | ATL-SEC-0032, ATL-SEC-0016 |
| D-10 | m5-verification-round2 időzítésérzékeny (flaky) teszt | ATL-TST-0115 |
| D-11 | SEARCH hn.algolia kérés nem az aláírt egress-policy-n megy | ATL-INT-0022, ATL-OPS-0036 |
| D-12 | central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkosítatlan | ATL-BRN-0005, ATL-SEC-0037, ATL-OPS-0001 |

BROKEN státuszú elem: ATL-SCH-0007 Napi felderítési ütemező (discoveryScheduler); ATL-UIX-0023 Nézet: Security & Supervision (supervision).

## 9. Tesztekkel nem igazolt funkciók

14 forrásfájl-elem: bekötve de tesztelés nélkül (CONNECTED_UNTESTED) vagy csak váz (STRUCTURAL_ONLY). A STRUCTURAL_ONLY elemeknél a statikus elemzés nem látja a dinamikus import/Worker/child_process betöltést – kézi megerősítés kell.

| ID | Név | Állapot |
|---|---|---|
| ATL-AVA-0002 | a11y-worker | STRUCTURAL_ONLY |
| ATL-BRN-0032 | registrations/_util | CONNECTED_UNTESTED |
| ATL-INT-0011 | browser-extension/background.js | STRUCTURAL_ONLY |
| ATL-INT-0012 | browser-extension/content-script.js | STRUCTURAL_ONLY |
| ATL-INT-0014 | browser-extension/sidepanel.css | STRUCTURAL_ONLY |
| ATL-INT-0015 | browser-extension/sidepanel.html | STRUCTURAL_ONLY |
| ATL-INT-0016 | browser-extension/sidepanel.js | STRUCTURAL_ONLY |
| ATL-OPS-0030 | atlasz-runtime/Dockerfile.worker | STRUCTURAL_ONLY |
| ATL-SEC-0018 | history-scan-patterns | STRUCTURAL_ONLY |
| ATL-UIX-0009 | atlasz-control-center/public/index.html | STRUCTURAL_ONLY |
| ATL-UIX-0010 | atlasz-control-center/public/style.css | STRUCTURAL_ONLY |
| ATL-WIN-0001 | atlasz-control-center/electron/main.mjs | CONNECTED_UNTESTED |
| ATL-WIN-0002 | atlasz-control-center/scripts/stage-win.mjs | STRUCTURAL_ONLY |
| ATL-WIN-0003 | launcher/ATLASZ-Control-Center.cmd | STRUCTURAL_ONLY |

Végpontok teszt nélkül: ATL-API-0032, ATL-API-0058, ATL-API-0059, ATL-API-0060, ATL-API-0066, ATL-API-0070, ATL-API-0071, ATL-API-0072, ATL-API-0073, ATL-API-0074, ATL-API-0075, ATL-API-0076, ATL-API-0077, ATL-API-0078, ATL-API-0079, ATL-API-0080, ATL-API-0081, ATL-API-0092, ATL-API-0093, ATL-API-0094, ATL-API-0095, ATL-API-0096, ATL-API-0097, ATL-API-0098, ATL-API-0101, ATL-API-0102, ATL-API-0107, ATL-API-0108, ATL-API-0109, ATL-API-0110, ATL-API-0111, ATL-API-0112, ATL-API-0113, ATL-API-0114, ATL-API-0115, ATL-API-0116, ATL-API-0121 (kizárólag állapotváltoztató POST-ok, amelyeket a smoke szándékosan nem hívott, és nincs route-tesztjük).

## 10. Külső hozzáférés miatt blokkolt vagy csak mock szinten tesztelt

| ID | Név | Állapot | Mi kell |
|---|---|---|---|
| ATL-FIN-0020 | payment-webhook-receiver | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0001 | browser-extension-guard | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0002 | chat-providers | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0003 | computer-use-fabric | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0004 | connector-catalog | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0005 | mcp-client | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0006 | page-ingest | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0007 | payment-package-intake | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0008 | source-adapters | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0009 | tool-bridge | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0010 | universal-connector-layer | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-INT-0017 | Connector: Airtable | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0018 | Connector: Google Calendar | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0019 | Connector: Google Drive | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0020 | Stripe (fizetési processzor, receive-only webhook) | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0021 | KOHO (banki egyeztetés, csak kézi/csomag-átvétel) | EXTERNAL_BLOCKER | nincs KOHO-integráció (csak kézi csomag-átvétel); bank-adat a tulajdonostól |
| ATL-INT-0022 | SEARCH forrás: hn.algolia.com (runtime kérés) | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0023 | MCP stdio szerverek (külső folyamat) | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0024 | Chat platform: WhatsApp Business | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0025 | Chat platform: Telegram | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0026 | Chat platform: Slack | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0027 | Chat platform: Discord | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0028 | Chat platform: Microsoft Teams | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0029 | Chat platform: Google Chat | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0030 | Chat platform: Signal | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0031 | Chat platform: Facebook Messenger | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0032 | Chat platform: Instagram DMs | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0033 | Chat platform: LINE | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0034 | Chat platform: Viber | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0035 | Chat platform: WeChat | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0036 | Chat platform: SMS via a gateway | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0037 | Chat platform: Email | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0038 | Chat platform: Matrix | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0039 | Chat platform: Apple Messages / iMessage | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0040 | Chat platform: Nextcloud Talk | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0041 | Chat platform: Nostr | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0042 | Chat platform: Tor Messenger | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0043 | Chat platform: Zalo (Official Account) | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-INT-0044 | Chat platform: Zalo Personal | EXTERNAL_BLOCKER | hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba |
| ATL-MDL-0005 | local-ai-manager | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-MDL-0008 | model-gateway | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-MDL-0011 | multi-model-brain | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-MDL-0012 | provider-adapters | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-MDL-0013 | provider-egress | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-MDL-0014 | provider-resilience | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-MDL-0015 | AI-szolgáltató: openai (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0016 | AI-szolgáltató: anthropic (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0017 | AI-szolgáltató: google (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0018 | AI-szolgáltató: xai (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0020 | AI-szolgáltató: deepseek (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0021 | AI-szolgáltató: mistral (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0022 | AI-szolgáltató: openrouter (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0023 | AI-szolgáltató: minimax (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0024 | AI-szolgáltató: glm (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0025 | AI-szolgáltató: perplexity (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0026 | AI-szolgáltató: huggingface (CLOUD) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MDL-0027 | AI-szolgáltató: ollama-local (LOCAL) | EXTERNAL_BLOCKER | API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba |
| ATL-MEM-0005 | embedding-provider | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-RES-0008 | live-discovery-runner | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-SEC-0020 | malware-scanner | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-VOI-0001 | voice-conversation | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-VOI-0002 | voice-interface | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-VOI-0003 | voice-session | MOCK_ONLY | külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs |
| ATL-WFL-0024 | Üzleti szakasz 1: DISCOVER | OWNER_APPROVAL_REQUIRED | élő felderítés soha nem futott; aláírt forrás-host és hálózati jóváhagyás kell |
| ATL-WFL-0035 | Üzleti szakasz 12: PAYMENT_VERIFICATION | EXTERNAL_BLOCKER | élő Stripe-kapcsolat/aláírt webhook nincs |
| ATL-WFL-0036 | Üzleti szakasz 13: RECONCILIATION | EXTERNAL_BLOCKER | valós processzor/bank adat nincs |

## 11. Azonosítókra épülő javítási munkalista (NEM kezdtem el)

`work_list.csv` – 340 sor: P0: 7, P1: 4, P2: 14, P3: 250, P4: 65. P0 = adatvesztést/hamis biztonságot okozó hiba; P1 = ismert hiba; P2 = teszt/bekötés hiányzik; P3 = részleges modul kiegészítése; P4 = külső hozzáférés / tulajdonosi döntés.

| Prioritás | Azonosítók | Feladat |
|---|---|---|
| P0 | ATL-UIX-0023, ATL-UIX-0008 | D-01: Security & Supervision nézet összeomlik (sv.notes objektum, .map hiba) |
| P0 | ATL-API-0088, ATL-API-0106, ATL-UIX-0008 | D-02: /api/updates/install és /api/plugins/enable hibánál HTTP 200 ok:true; a UI 'done'-t mutat |
| P0 | ATL-OPS-0010 | D-03: durable-queue.ack nem ellenőrzi a bérlőt |
| P0 | ATL-BRN-0025, ATL-OPS-0010, ATL-OPS-0034 | D-04: nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti |
| P0 | ATL-WFL-0013, ATL-OPS-0013, ATL-MEM-0008, ATL-AUR-0004, ATL-MEM-0011 | D-05: ~25 zár nélküli közös tár (utolsó író nyer) |
| P1 | ATL-OPS-0034 | D-06: supervisor-safe.mjs fixen 0.0.0.0-n hallgat |
| P1 | ATL-UIX-0008, ATL-VOI-0001, ATL-UIX-0056 | D-07: Hang UI nyelvváltó csak a válasz nyelvét váltja; 'Jó reggelt' gomb néma |
| P0 | ATL-SCH-0007, ATL-RES-0006 | D-08: discoveryScheduler().tick() hívója nincs |
| P1 | ATL-SEC-0032, ATL-SEC-0016 | D-09: két karantén-tár, release/delete route nélkül |
| P3 | ATL-TST-0115 | D-10: m5-verification-round2 időzítésérzékeny (flaky) teszt |
| P0 | ATL-INT-0022, ATL-OPS-0036 | D-11: SEARCH hn.algolia kérés nem az aláírt egress-policy-n megy |
| P1 | ATL-BRN-0005, ATL-SEC-0037, ATL-OPS-0001 | D-12: central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkosítatlan |

## 12. Korlátok és őszinte megjegyzések

* A rendszerelem-státusz **levezetett** (lásd a 3. fejezet szabályát) az integration_matrix (2026-10-11), a gate-eredmények (2026-10-12, 245 tesztfájl), a statikus import-lánc és az ellenőrzési követelmény-státuszok alapján. A teszt→modul kapcsolat közvetlen import/útvonal-hivatkozás (és közvetett: a modult importáló komponens tesztje); dinamikus betöltést nem lát.
* A 'bekötve' = statikus import-lánc a Control Center, runtime vagy Electron belépési pontjából vagy az integration_matrix futási-betöltés jelzése. Ez nem bizonyítja, hogy minden funkciót valaki meg is hív.
* **Nincs valós/éles bizonyíték**: modell, Stripe, KOHO, e-mail, hang, Windows (avatárhoz pedig nincs megjelenítő komponens). Ezek EXTERNAL_BLOCKER, MOCK_ONLY vagy hiányzó besorolásúak; nincs Windows-teszt, ezért Windows-állítás nem szerepel.
* A verzió-mező ismeretlen, ahol a forrás nem deklarál verziót (`UNKNOWN`). A git-commit mezők az utolsó, a fájlt érintő commitot adják.
* A V7.3 mester-regiszter (983 sor) és a régi hiány-/tracker-azonosítók **nem lettek automatikusan** ATL-REQ-hez kötve (más forrásdokumentum); csak a komponens-útvonalak szerinti kapcsolat van meg a `legacy_id_map.csv`-ben.
* A kategóriaszabály (melyik fájl melyik területhez tartozik) fájlnév-alapú kézi besorolás; vitás esetben a tulajdonos átsorolhat – az azonosító ilyenkor sem változik (a kategória csak címke a nyilvántartásban).

## 13. Következő lépés

Megállok. A javítási munkalistáról, a külső hozzáférésekről és a halasztott tételek besorolásáról kizárólag a tulajdonos dönt. Fejlesztést, javítást nem kezdek.
