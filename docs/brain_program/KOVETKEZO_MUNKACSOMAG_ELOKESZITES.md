# 2. munkacsomag előkészítése – közös Brain Gateway és megosztott intelligencia-réteg

**ÁLLAPOT: ELŐKÉSZÍTVE, NEM INDÍTOTT.** Ez dokumentum; semmi nem készült el belőle. Indításhoz **külön tulajdonosi jóváhagyás** kell (ATL-DEC-0058 munkatételenként; ATL-WRK-0786-hoz emellett ATL-DEC-0068 runtime-release, mert a futó rendszert érinti). Alapja: a kész BRAIN_SPEC.md (ATL-WRK-0785), a fake adapterek (ATL-WRK-0787) és a fenyegetésmodell (ATL-WRK-0788).

## 1. Cél
Egyetlen megosztott Brain-példány és egyetlen típusos, auditált belépési pont (consult / understand / plan / act), amelyen át a Control Center, az AURÓRA és a runtime ugyanazt az intelligenciát éri el – modell nélkül is őszintén, „MODELL NINCS BEKÖTVE” jelzéssel (degradált mód). Élő modell **nem** része ennek a csomagnak.

## 2. Javasolt tételek és sorrend
| Sorrend | ATL | Cím | Függ | Becslés (óra, ±40%) | Teszt | Kapu | Futó rendszert érint? |
|---|---|---|---|---|---|---|---|
| 0 | ATL-WRK-0003 / 0004 / 0005 | Előfeltétel-hibák D-03 (durable-queue ack bérlő), D-04 (állapotmappa-zár), D-05 (~25 zár nélküli tár) | – | külön becslés a leltárban | saját negatív tesztek | külön jóváhagyás | **IGEN** (futó kód) |
| 1 | ATL-WRK-0789 | Brain Gateway API (consult/understand/plan/act) a module-brokeren át | 0785, 0786 | 28 + 12 | brain-gateway.test | ATL-DEC-0058 | új modul, fake adapterrel teljesen tesztelhető |
| 2 | ATL-WRK-0792 | Degradált (modell nélküli) üzemmód kimondott jelzéssel | 0789 | 10 + 5 | degraded-mode.test | ATL-DEC-0058 | új modul |
| 3 | ATL-WRK-0791 | Prompt-könyvtár és verziózás | 0789 | 14 + 6 | prompt-library.test | ATL-DEC-0058 | új modul |
| 4 | ATL-WRK-0790 | Brain Context Builder | 0789 | 24 + 10 | context-builder.test | ATL-DEC-0058 | új modul (kitakarás kötelező, lásd §3) |
| 5 | ATL-WRK-0793 | Brain-busz előfizetők | 0789 | 16 + 8 | brain-bus-subscribers.test | ATL-DEC-0058 | részben (bekötés) |
| 6 | ATL-WRK-0786 | Egyetlen megosztott Brain-példány (Control Center + runtime) | 0785, 0003, 0004, 0005 | 20 + 10 | brain-single-instance.test | ATL-DEC-0058 + ATL-DEC-0068 | **IGEN** (futó rendszer; csak jóváhagyással) |

Javasolt bontás két külön jóváhagyásra: **2A (offline, additív, kockázatmentes):** 0789, 0792, 0791, 0790, 0793 – új modulok, fake adapterrel, nem kötve a futó rendszerhez. **2B (futó rendszert érint):** 0003/0004/0005, majd 0786 – külön döntés, mert ugyanazt a runtime-ot módosítja.
Összes (2A, becsült): 28+12 + 10+5 + 14+6 + 24+10 + 16+8 = 133 óra; 2B: 0786 30 óra + a három előfeltétel-hiba külön becslése. Becslések ±40%.

## 3. A fenyegetésmodellből átvett kötelező követelmények (nem opcionális)
| Követelmény | Forrás hézag | Melyik tétel teljesíti |
|---|---|---|
| `act` **engedélylistát** használ, nem tiltólistát; ismeretlen akció = megtagadás | PRV-009, PRV-010 | ATL-WRK-0789 |
| A kimenő prompt titokmentesítése a modellhívás előtt | LEK-009 | ATL-WRK-0790 |
| Magyar (ékezetes és ékezet nélküli) injekciós minták a Gateway bemeneti szűrésében | INJ-007…014 | ATL-WRK-0789 + a lezáró ATL-WRK-0803 |
| Ismeretlen költség sosem nulla a költségszámlálásban | CST-010, CST-007 | ATL-WRK-0802 (külön tétel; a Gateway `maxCostUsd` alapért. 0) |
| Degradált/fixture válasz sosem FULL/LIVE | spec §5, fake-adapters.test | ATL-WRK-0792 |
| Hamis érzés-állítás magyar szűrése a kimeneten | EMO-005…011 | ATL-WRK-0803 / 0829 |
A 2A tételek **nem** javíthatnak a meglévő védelmi modulokon; a Gateway az új réteg, a hézagok lezárása (0803, 0802, 0829) külön tétel és külön jóváhagyás.

## 4. Készenléti ellenőrzőlista (indítás előtt)
* [x] Specifikáció kész (BRAIN_SPEC.md), automatikusan áttekintve – tulajdonosi elfogadás **kell**.
* [x] Fake adapterek és FIXTURE-jelölés kész; élő bizonyítékként elutasítva.
* [x] Fenyegetésmodell és negatív tesztek kész; 25 hézag megnevezve.
* [ ] Tulajdonosi elfogadás a specifikációról.
* [ ] Tulajdonosi döntés: 2A indítható-e külön; 2B (futó rendszer) külön engedély.
* [ ] Döntés a hívásonkénti és napi hívási korlátokról (ATL-DEC-0003 környezete) – alapértelmezett `maxCostUsd = 0`.
* [ ] Nyitott kérdés: a Gateway az `act`-nál melyik meglévő végrehajtó útvonalra adja a javaslatot (governed-dispatch) – a 0789 első lépése a pontos illesztés felmérése, kód nélkül.

## 5. Elfogadási kritériumok (a Brain-programból)
* ATL-WRK-0789: „Minden fogyasztó egy API-n át kérhet Brain-szolgáltatást.”
* ATL-WRK-0792: „Őszinte állapotjelzés minden felületen.”
* ATL-WRK-0791: „Verziózott prompt-készlet változásnaplóval.”
* ATL-WRK-0790: „Reprodukálható, auditált kontextus-csomag minden Brain-híváshoz.”
* ATL-WRK-0793: „A busz tényleges koordinációt végez, nem csak definíció.”
* ATL-WRK-0786: „Egy Brain-állapot, bizonyítottan konzisztens két folyamat között.”

## 6. Amit ez a csomag SEM tesz
Nem köt be élő modellt, nem aktivál külső szolgáltatást vagy fizetős API-t, nem telepít éles környezetbe, nem költ. Élő modellbekötés a 4. fázis (ATL-WRK-0808/0809), külön döntésekkel (ATL-DEC-0059/0060).
