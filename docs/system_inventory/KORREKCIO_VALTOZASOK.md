# ATLASZ AURÓRA V7.3 – TULAJDONOSI NYILVÁNTARTÁSI KORREKCIÓ (2026-10-12)

*Kizárólag nyilvántartási és dokumentációs munka. A futó ATLASZ-kód, a modulok, külső szolgáltatások és költségek érintetlenek. Kiinduló commit: `b5870e8`.*

## 1. F-01 – ATL-FUT-0141 (Issue-to-fix automation)

| mező | érték |
|---|---|
| atl_id | ATL-FUT-0141 |
| text | Issue-to-fix automation |
| status | MISSING |
| deferred | IGEN (150 jövőbeli ötlet – nem aktivált) |
| planned_module_id | ATL-PLN-0095 |
| planned_module_name | Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-edit-workflow change-set -> teszt -> független átnézés; automatikusan nem aktiválható |
| planned_module_status | PLANNED_DEFERRED |
| related_existing_modules | ATL-DEV-0003; ATL-DEV-0007; ATL-DEV-0008; ATL-AGT-0033; ATL-BRN-0016; ATL-DEV-0001; ATL-DEV-0004 |
| atl_components | ATL-DEV-0003; ATL-DEV-0007; ATL-DEV-0008; ATL-AGT-0033 |
| work_ids | ATL-WRK-0782; ATL-WRK-0752 |

Új tervezett modul: **ATL-PLN-0095** (DEFERRED, PLANNED_DEFERRED, P5). A módosítás oka: az eredeti sorban a tervezett modul, a név és a kapcsolódó meglévő modulok üresek, a munkasor (ATL-WRK-0752) pedig komponens-/modul-hivatkozás nélküli volt.
Az ötlet **HALASZTOTT marad**, automatikusan nem aktiválható (aktiválás: külön tulajdonosi döntés – ATL-DEC-0056). A modul munkasora: **ATL-WRK-0782** (P5, nem része az aktív összegeknek); az ötlet saját halasztott munkasora **ATL-WRK-0752**: komponensek: ATL-DEV-0003; ATL-DEV-0007; ATL-DEV-0008; ATL-AGT-0033; tervezett modul: ATL-PLN-0095; az órák a halasztott modul-feladatban vannak (duplikáció nélkül).

## 2. F-02 – Git-verzió (részletek: `GIT_PROVENANCE.md`)

Lásd GIT_PROVENANCE.md: kiinduló commit, a leltár tartalmának commitja, a javítás commitja, helyi == távoli, a 898 ATL azonosító változatlansága, `main` érintetlen.

## 3. F-03 – átadási fájlok (részletek: `HANDOVER_MANIFEST.csv`)

A hét megnevezett fájl (`directive_items.csv`, `findings.csv`, `owner_decisions.csv`, `sources.csv`, `config_files.csv`, `corrections_to_v1.csv`, `atl_query.py`) és az összes többi átadási fájl szerepel a `HANDOVER_MANIFEST.csv`-ben (útvonal, létezik, olvasható, bájt, sha256, sorok, Git-követett, utolsó commit).

## 4. A 54 üres munkasor ellenőrzése

Korrekció előtt **54** munkasor volt egyszerre ATL-komponens- és tervezettmodul-hivatkozás nélkül. Eredmény: modul-/komponens-kapcsolat: 50, dokumentált indoklás: 4.

| munkasor | eredet | cím | megoldás |
|---|---|---|---|
| ATL-WRK-0590 | V2_DECISION | Tulajdonosi döntés előkészítése: Tulajdonosi kulcs (owner-key) kiadása | komponens: 2 db; dokumentum: 24 db |
| ATL-WRK-0591 | V2_DECISION | Tulajdonosi döntés előkészítése: Egress-policy és host/hoszt jóváhagyá | komponens: 1 db; dokumentum: 22 db |
| ATL-WRK-0592 | V2_DECISION | Tulajdonosi döntés előkészítése: Modell-engedélyezés (MODEL_ENABLE) és | komponens: 1 db; dokumentum: 8 db |
| ATL-WRK-0593 | V2_DECISION | Tulajdonosi döntés előkészítése: Stripe / KOHO aktiválás engedélye | komponens: 2 db; dokumentum: 16 db |
| ATL-WRK-0594 | V2_DECISION | Tulajdonosi döntés előkészítése: Windows-teszt / kézi Windows futtatás | komponens: 1 db; dokumentum: 6 db |
| ATL-WRK-0595 | V2_DECISION | Tulajdonosi döntés előkészítése: Hangteszt (TTS/STT) jóváhagyása | komponens: 1 db; dokumentum: 3 db |
| ATL-WRK-0596 | V2_DECISION | Tulajdonosi döntés előkészítése: Computer Use engedélyezése (minden kö | komponens: 1 db; dokumentum: 1 db |
| ATL-WRK-0597 | V2_DECISION | Tulajdonosi döntés előkészítése: Távoli elérés engedélyezése | komponens: 1 db; dokumentum: 2 db |
| ATL-WRK-0598 | V2_DECISION | Tulajdonosi döntés előkészítése: Adószabályok / adószabály-forrás jóvá | komponens: 1 db; dokumentum: 6 db |
| ATL-WRK-0599 | V2_DECISION | Tulajdonosi döntés előkészítése: Kereskedelmi (licenc) modell döntése | tervezett modul: ATL-PLN-0045; dokumentum: 5 db |
| ATL-WRK-0600 | V2_DECISION | Tulajdonosi döntés előkészítése: Legacy fájlok sorsa | komponens: 3 db; dokumentum: 6 db |
| ATL-WRK-0601 | V2_DECISION | Tulajdonosi döntés előkészítése: Élő források / adatszolgáltató és lic | komponens: 1 db; dokumentum: 13 db |
| ATL-WRK-0602 | V2_DECISION | Tulajdonosi döntés előkészítése: Tulajdonosi policy-döntések | dokumentum: 9 db; INDOKLÁS: nem modul-specifikus |
| ATL-WRK-0603 | V2_DECISION | Tulajdonosi döntés előkészítése: Egyéb tulajdonosi döntések (tételes l | dokumentum: 32 db; INDOKLÁS: nem modul-specifikus |
| ATL-WRK-0604 | V2_DECISION | Tulajdonosi döntés előkészítése: A karanténba tett régi futtatókörnyez | komponens: 3 db |
| ATL-WRK-0605 | V2_REQ_GAP | Követelmény-hiányok lezárása: 1. fejezet, OWNER_APPROVAL_REQUIRED (1 d | tervezett modul: ATL-PLN-0045 |
| ATL-WRK-0606 | V2_REQ_GAP | Követelmény-hiányok lezárása: 11. fejezet, PARTIAL (1 db) | tervezett modul: ATL-PLN-0096 |
| ATL-WRK-0607 | V2_REQ_GAP | Követelmény-hiányok lezárása: 13. fejezet, PARTIAL (1 db) | komponens: 2 db |
| ATL-WRK-0608 | V2_REQ_GAP | Követelmény-hiányok lezárása: 14. fejezet, PARTIAL (1 db) | tervezett modul: ATL-PLN-0092 |
| ATL-WRK-0609 | V2_REQ_GAP | Követelmény-hiányok lezárása: 16. fejezet, EXTERNAL_BLOCKER (2 db) | komponens: 1 db |
| ATL-WRK-0610 | V2_REQ_GAP | Követelmény-hiányok lezárása: 18. fejezet, STRUCTURAL_ONLY (1 db) | tervezett modul: ATL-PLN-0019 |
| ATL-WRK-0611 | V2_REQ_GAP | Követelmény-hiányok lezárása: 19. fejezet, PARTIAL (1 db) | tervezett modul: ATL-PLN-0093 |
| ATL-WRK-0612 | V2_REQ_GAP | Követelmény-hiányok lezárása: 21. fejezet, OWNER_APPROVAL_REQUIRED (2  | tervezett modul: ATL-PLN-0045 |
| ATL-WRK-0613 | V2_REQ_GAP | Követelmény-hiányok lezárása: 23. fejezet, PARTIAL (1 db) | komponens: 2 db |
| ATL-WRK-0614 | V2_REQ_GAP | Eredeti 85 képesség tételek lezárása (EXTERNAL_BLOCKER, 3 db) | komponens: 2 db; tervezett modul: ATL-PLN-0068; ATL-PLN-0097 |
| ATL-WRK-0644 | V2_DEFERRED_IDEA | Halasztott ötlet: Multi-file code transformation (PARTIAL) | komponens: 1 db |
| ATL-WRK-0703 | V2_DEFERRED_IDEA | Halasztott ötlet: Real-time internet research (EXTERNAL_BLOCKER) | komponens: 2 db |
| ATL-WRK-0704 | V2_DEFERRED_IDEA | Halasztott ötlet: Public X/social media monitoring (EXTERNAL_BLOCKER) | komponens: 2 db |
| ATL-WRK-0708 | V2_DEFERRED_IDEA | Halasztott ötlet: Image-based web research (EXTERNAL_BLOCKER) | komponens: 2 db |
| ATL-WRK-0709 | V2_DEFERRED_IDEA | Halasztott ötlet: Social media video analysis (EXTERNAL_BLOCKER) | komponens: 1 db; tervezett modul: ATL-PLN-0019 |
| ATL-WRK-0711 | V2_DEFERRED_IDEA | Halasztott ötlet: Current-events monitoring (EXTERNAL_BLOCKER) | komponens: 1 db; tervezett modul: ATL-PLN-0079 |
| ATL-WRK-0714 | V2_DEFERRED_IDEA | Halasztott ötlet: Public community feedback analysis (EXTERNAL_BLOCKER | komponens: 2 db |
| ATL-WRK-0715 | V2_DEFERRED_IDEA | Halasztott ötlet: Approved AI image generation workflows (EXTERNAL_BLO | komponens: 1 db; tervezett modul: ATL-PLN-0019 |
| ATL-WRK-0723 | V2_DEFERRED_IDEA | Halasztott ötlet: Geographic and map-assisted research (EXTERNAL_BLOCK | komponens: 1 db; tervezett modul: ATL-PLN-0068 |
| ATL-WRK-0725 | V2_DEFERRED_IDEA | Halasztott ötlet: Isolated image computation (EXTERNAL_BLOCKER) | komponens: 2 db |
| ATL-WRK-0752 | V2_DEFERRED_IDEA | Halasztott ötlet: Issue-to-fix automation (MISSING) | komponens: 4 db; tervezett modul: ATL-PLN-0095 |
| ATL-WRK-0764 | V2_FINAL | VÉGSŐ teljes rendszervizsgálat (ZERO TOLERANCE elfogadás) | dokumentum: 2 db; INDOKLÁS: nem modul-specifikus |
| ATL-WRK-0765 | V2_FINAL | Leltár-karbantartás minden lezárt modul után (history.jsonl, státusz,  | dokumentum: 2 db; INDOKLÁS: nem modul-specifikus |
| ATL-WRK-0766 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (0122013f, PARTIAL, 1 sor) | komponens: 2 db; dokumentum: 1 db |
| ATL-WRK-0767 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (01a0d7b8, PARTIAL, 4 sor) | komponens: 9 db; dokumentum: 1 db |
| ATL-WRK-0768 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (22d91bb0, PARTIAL, 2 sor) | komponens: 4 db; dokumentum: 1 db |
| ATL-WRK-0769 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (29dded94, PARTIAL, 4 sor) | komponens: 15 db; dokumentum: 1 db |
| ATL-WRK-0770 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (3c13c27e, PARTIAL, 1 sor) | komponens: 1 db; dokumentum: 1 db |
| ATL-WRK-0771 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (3ee4d259, PARTIAL, 2 sor) | komponens: 6 db; dokumentum: 1 db |
| ATL-WRK-0772 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (697cfe68, PARTIAL, 10 sor) | komponens: 17 db; dokumentum: 1 db |
| ATL-WRK-0773 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (7946c15c, PARTIAL, 1 sor) | komponens: 3 db; dokumentum: 1 db |
| ATL-WRK-0774 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (8b4aa20e, PARTIAL, 3 sor) | komponens: 4 db; dokumentum: 1 db |
| ATL-WRK-0775 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (V73REG, PARTIAL, 14 sor) | komponens: 13 db; dokumentum: 1 db |
| ATL-WRK-0776 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (a9d885b0, PARTIAL, 1 sor) | komponens: 2 db; dokumentum: 1 db |
| ATL-WRK-0777 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (aa4f678c, PARTIAL, 1 sor) | komponens: 4 db; dokumentum: 1 db |
| ATL-WRK-0778 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (cbd533cd, PARTIAL, 5 sor) | komponens: 6 db; dokumentum: 1 db |
| ATL-WRK-0779 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (d09bcb09, PARTIAL, 1 sor) | komponens: 1 db; dokumentum: 1 db |
| ATL-WRK-0780 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (ef67a595, PARTIAL, 22 sor) | komponens: 7 db; dokumentum: 2 db |
| ATL-WRK-0781 | V2_DIRECTIVE_GAP | Direktíva-sorok lezárása (ef67a595, STRUCTURAL_ONLY, 3 sor) | komponens: 1 db; dokumentum: 1 db |

Megjegyzés: a 4 dokumentált indoklású sor két rendszerszintű végső feladat (ATL-WRK-0764/0765) és két gyűjtő jellegű tulajdonosi döntés (ATL-WRK-0602 policy, ATL-WRK-0603 egyéb); mindegyiknek van `no_module_reason` indoklása és, ahol értelmes, `document_ids` hivatkozása.

## 5. Pontos változáslista

Gépi lista: `correction_changes.csv` (448 sor: tábla, azonosító, mező, régi, új érték). A munkaterv sorszámozása (`no`) a P-prioritás szerinti rendezés miatt eltolódik a 3 új feladat miatt – ez nem azonosító, a tartós ATL-WRK azonosítók nem változtak.

| tábla | hozzáadott | módosított sor-mező |
|---|---|---|
| directive_items.csv | 0 | 35 |
| findings.csv | 0 | 4 |
| inventory_items.csv | 3 | 74 |
| owner_decisions.csv | 2 | 0 |
| planned_modules.csv | 3 | 16 |
| requirements_matrix.csv | 0 | 205 |
| work_plan.csv | 3 | 103 |

Elv a módosított órákra: ha egy követelmény-hiány teljes egészében egy AKTÍV tervezett modulba került, a hiány-feladat (azonosítója megmarad) 0 órára áll, az órák a modul-feladatban vannak; halasztott modulba kerülő tételeknél az órák megmaradnak (nem aktiválódik semmi).

## 6. Újonnan kiosztott ATL azonosítók

| azonosító | megnevezés |
|---|---|
| ATL-DEC-0056 | Döntés: Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-… |
| ATL-DEC-0057 | Döntés: Látás- és környezet-érzékelés: tárgy- és eszközfelismerés (Object and Equipment… |
| ATL-PLN-0095 | Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-edit-workflow change-set -> teszt -> független átnézés; automatikusan nem aktiválható |
| ATL-PLN-0096 | Hiányzó Control Center képernyők: Deliveries (szállítások), külön DEALS képernyő, Computer Use panel, Tax/Accounting panel |
| ATL-PLN-0097 | Látás- és környezet-érzékelés: tárgy- és eszközfelismerés (Object and Equipment Recognition), környezeti kontextus (Environmental Context Awareness) |
| ATL-WRK-0782 | HALASZTOTT: Issue-to-fix automatizálás (HALASZTOTT ötlet): issue-bevitel -> modell -> code-edit-workflow change-set -> teszt -> független átnézés; automatikusan … |
| ATL-WRK-0783 | BŐVÍTÉS: Hiányzó Control Center képernyők: Deliveries (szállítások), külön DEALS képernyő, Computer Use panel, Tax/Accounting panel |
| ATL-WRK-0784 | ÚJ MODUL: Látás- és környezet-érzékelés: tárgy- és eszközfelismerés (Object and Equipment Recognition), környezeti kontextus (Environmental Context Awareness) |

Meglévő azonosítók átnevezése nem történt; két munkasor *címe* módosult a számlálók frissülése miatt (azonosító változatlan):
- ATL-WRK-0774: „Direktíva-sorok lezárása (8b4aa20e, PARTIAL, 4 sor)” → „Direktíva-sorok lezárása (8b4aa20e, PARTIAL, 3 sor)”
- ATL-WRK-0780: „Direktíva-sorok lezárása (ef67a595, PARTIAL, 23 sor)” → „Direktíva-sorok lezárása (ef67a595, PARTIAL, 22 sor)”

## 7. Még megoldatlan nyilvántartási hiányok

- Nyitott megállapítások (ATL-FND): CODE_VS_DOC: 150, REGISTER_STALE: 104 – lezárásuk a munkatervben (V2_FINDING).
- Nyitott tulajdonosi döntések: 57 (owner_decisions.csv).
- Halasztott ötletek tervezett modul nélkül (csak komponens-kapcsolattal; szándékosan nem aktiválhatók): 142 db – ATL-FUT-0001, ATL-FUT-0002, ATL-FUT-0003, ATL-FUT-0004, ATL-FUT-0005, ATL-FUT-0006, ATL-FUT-0007, ATL-FUT-0009, ATL-FUT-0010, ATL-FUT-0011, ATL-FUT-0012, ATL-FUT-0013 ….
- Dokumentált, nem modul-specifikus munkasor: 4 (ATL-WRK-0764, 0765, 0602, 0603).
- A `docs/system_inventory/` generátor- és kimeneti fájljai nem kaptak ATL-azonosítót (körkörösség elkerülése); a `HANDOVER_MANIFEST.csv` tartalmazza őket.
- A három karanténba tett legacy fájl (worker.js, supervisor.js, agent-child.js) sorsa tulajdonosi döntésre vár (ATL-DEC legacy).
- A becsült órák továbbra is tervezési becslések (±40%), nem mért értékek; élő bizonyíték sehol nem jött létre.
- A V2_DIRECTIVE_GAP munkasorok csak a direktíva-sorok egyenkénti besorolását zárja; ezek komponens-kapcsolata az evidenciában szereplő útvonalakból származik, és ahol ilyen nem volt, dokumentált indoklás áll.

## 8. Érvényesítés

32 ellenőrzés, ebből sikeres: 32, hiba: 0, figyelmeztetés: 0.

- ✔ A v1 ledger minden bejegyzése és azonosítója változatlanul megmaradt
- ✔ A 898 v1 rendszerelem azonosítója és neve változatlan
- ✔ Nincs ismétlődő azonosító a táblák között
- ✔ A ledgerben minden azonosító egyedi (nincs újrafelhasználás)
- ✔ Minden azonosító ledger-bejegyzéshez köthető (a v1 követelmény/CAP/SIR/FUT azonosítók a v1 ledgerben vannak)
- ✔ Mind az 1859 követelmény-sor + 258 (85/23/150) tétel szerepel a mátrixban
- ✔ Mind a 12 476 direktíva-/specifikáció-sor azonosítót kapott
- ✔ Mind a 42 feltöltött direktíva forrásként azonosítva
- ✔ Pontosan 30 állandó ügynök (5 SEARCH + 25 EXECUTION), a Master/AURÓRA nem ügynök
- ✔ Minden MISSING követelményhez tartozik tervezett modul/bővítés azonosító
- ✔ Minden MISSING követelményhez tartozik megvalósítási munkaterv-feladat
- ✔ Minden nem-VERIFIED követelményhez (REQ/CAP/SIR) tartozik munkaterv-feladat
- ✔ A 150 jövőbeli ötlet nem-VERIFIED tételei halasztott feladatként szerepelnek
- ✔ Minden munkát igénylő direktíva-sorhoz tartozik feladat
- ✔ Minden duplikált direktíva-sor az eredetire hivatkozik
- ✔ Tervezett (PLN) azonosító nincs a meglévő rendszerelemek között
- ✔ Tervezett elem státusza soha nem működő státusz
- ✔ A tervezett modulok mind kaptak legalább egy követelményt/direktíva-sort (nincs üres modul)
- ✔ Halasztott tételek külön jelöltek és nem számítanak az aktív órákba
- ✔ Minden hivatkozás létező azonosítóra mutat
- ✔ A munkaterv függőségei körmentesek
- ✔ Az aktív feladat-órák és a követelményekre szétosztott órák egyeznek (a követelmény nélküli feladatokon kívül)
- ✔ Minden munkaterv-sor kapcsolódik ATL-komponenshez vagy tervezett modulhoz, vagy dokumentált indoklása van
- ✔ A munkaterv dokumentum-/modul-hivatkozásai létező azonosítók
- ✔ Minden MISSING CAP/FUT tételhez tartozik tervezett modul azonosító
- ✔ Minden nem-VERIFIED követelmény-sor kapcsolódik ATL-komponenshez vagy tervezett modulhoz
- ✔ A halasztott ötlet-tételek munkaterv-sora nem aktív (P5, deferred)
- ✔ A tervezett modul-tétel (PLN) mindig tartalmaz requirement-hivatkozást vagy direktívát
- ✔ ATL-FUT-0141: tervezett modul, név, kapcsolódó meglévő modulok, munka-összekötés kitöltve; halasztott
- ✔ Csak docs/ alatti fájl változott (futó rendszer kódja nem módosult)
- ✔ Fel nem oldott catalog-hivatkozás (rel) nincs
- ✔ A katalógus explicit kulcsai mind léteznek

Órák (becslés): {"active_task_total_h": 5150.4, "requirement_allocated_h": 3305.0, "task_h_without_requirement_link": 1845.4}.
