# ATLASZ AURÓRA V7.3 — kibővített teljes rendszerleltár (2. kiadás, 2026-10-12)

**Csak nyilvántartás.** A futó rendszer kódját nem módosítja, hiányzó modult nem épít, külső szolgáltatást nem aktivál. A TERVEZETT (`ATL-PLN-*`) elemek **nem léteznek**. A munkaórák becslések.

Olvasási sorrend: `RENDSZERLELTAR_V2_JELENTES.md` (magyar jelentés) → `MUNKATERV.md` (számozott munkaterv) → `LELTAR_TELJES_LISTA.md` (számozott leltár).

| Fájl | Tartalom |
|---|---|
| `RENDSZERLELTAR_V2_JELENTES.md` | magyar jelentés (számok, korrekciók, összevetés, hiányzó követelmények → tervezett modulok, ellenőrzések, korlátok) |
| `MUNKATERV.md`, `work_plan.csv`, `work_list_extended.csv` | az eredeti 340 soros munkalista (megőrizve) + az új feladatok; ATL-WRK azonosító, függőség, óra, ellenőrzés, elfogadás, prioritás |
| `LELTAR_TELJES_LISTA.md`, `inventory_items.csv` | egységes számozott leltár: meglévő elemek (950) + tervezett modulok (94) |
| `requirements_matrix.csv` | minden eredeti követelmény-sor (1859) + 85 képesség + 23 biztonsági/infra + 150 ötlet: megvan-e, mely ATL-elem, működési szint, bekötés, hiány, javítás, tervezett modul, munka, óra |
| `planned_modules.csv` | tervezett új modulok / bővítések / döntések / halasztott projektek (ATL-PLN) |
| `directive_items.csv` | 12 476 tulajdonosi direktíva- és V7.3 specifikáció-sor (ATL-DIR / ATL-SPC) tételes besorolása |
| `sources.csv`, `config_files.csv` | forrásdokumentumok (ATL-SRC), konfig/állapot/CI/bizonyíték fájlok (ATL-CFG) |
| `findings.csv`, `owner_decisions.csv`, `corrections_to_v1.csv` | megállapítások (ATL-FND), tulajdonosi döntések (ATL-DEC), a v1 leltár javításai |
| `atlasz_system_inventory.json`, `atlasz_system_inventory.sqlite` | mindez géppel feldolgozhatóan; a SQLite-ban `all_ids` nézet és `links` tábla |
| `validation_report.json` | a kötelező ellenőrzések eredménye |
| `atl_query.py` | lekérdező: `python3 docs/system_inventory/atl_query.py ATL-XXX-0000 [--json] [--links]` |
| `pln_catalog.py` | a tervezett modulok katalógusa (hozzárendelési szabályokkal, becsült órákkal) |
| `build_system_inventory.py` (+ `build_part2..5.py`), `render_inventory_report.py` | újraépítés a repó gyökeréből: `python3 docs/system_inventory/build_system_inventory.py && python3 docs/system_inventory/render_inventory_report.py` |
| `data/directive_assessment.json.gz` | a direktíva-sorok besorolásának nyers eredménye |

Azonosítók: a tartós főkönyv a `docs/identity_registry/id_ledger.json` (természetes kulcs → ATL-azonosító; soha nem osztható ki újra). A v1 (898 elem) azonosítói és nevei változatlanok; a v1 CSV/JSON fájlok történeti pillanatképek, az érvényes állapot itt van. Változásnapló: `docs/identity_registry/history.jsonl` (csak hozzáfűzés).

Új azonosító-kategóriák: `DIR` direktíva-sor · `SPC` V7.3 specifikáció-sor · `PLN` tervezett modul · `WRK` munkaterv-feladat · `FND` megállapítás · `DEC` tulajdonosi döntés · `SRC` forrásdokumentum · `CFG` konfig/állapotfájl.

Állapotok: a v1 készlet (VERIFIED_WORKING, PARTIAL, STRUCTURAL_ONLY, CONNECTED_UNTESTED, MOCK_ONLY, MISSING, BROKEN, EXTERNAL_BLOCKER, OWNER_APPROVAL_REQUIRED, NOT_YET_VERIFIED) + `LEGACY_QUARANTINED` (karanténba tett régi futtatókörnyezet) + tervezetteknél `PLANNED`, `PLANNED_EXTEND`, `PLANNED_DEFERRED`, `DECISION_PENDING`. A `VERIFIED_WORKING` helyi/fixture szintet jelent, élő bizonyíték nélkül.
