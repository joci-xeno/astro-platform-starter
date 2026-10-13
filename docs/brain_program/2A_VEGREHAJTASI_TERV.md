# BRAIN 2A – függőség-tisztázás és végrehajtási terv (KÓDFEJLESZTÉS NEM INDULT)

**Állapot:** előkészítés, csak dokumentáció és nyilvántartás. Nem módosult futó fájl, nincs élő modell, külső szolgáltatás vagy költség, nem keletkezett új ATL-azonosító. A 2A kódfejlesztés **csak a 8. pontban kért külön jóváhagyás után** indul.
**Tulajdonosi feltétel rögzítve:** a BRAIN_SPEC.md fejlesztési alap, *de* a dokumentált biztonsági hiányosságok nyitva maradnak, és az elfogadás **nem** jelent teljes Brain biztonsági jóváhagyást. Ezt a 2A bármely jelentésében ki kell mondani.

## 1. A 0789 → 0786 függőség tisztázása
**Tervi állapot:** ATL-WRK-0789 függ: ATL-WRK-0785, **ATL-WRK-0786**. A 0786 (egyetlen megosztott Brain-példány) nincs engedélyezve, és maga függ a 0003/0004/0005 futó-kód hibajavításoktól.

**Kódból igazolt tények:**
* A Brain-rendszer **gyárfüggvényből** jön létre: `createBrainSystem({dir, ownerAuth, roster, …})`. Ma két helyen példányosítják, külön könyvtárral: `atlasz-control-center/core.mjs:945` és `atlasz-runtime/supervisor-safe.mjs:127`. A 0786 azt dönti el, *melyik példányhoz kötődik* a közös fogyasztó – nem azt, hogyan épül a Gateway.
* A `createModuleBroker({tools, managers, audit, …})` szintén tiszta gyárfüggvény; a futó rendszerhez csak a `registrations/*.mjs` fájlok kötik, **explicit importtal** (nincs automatikus felfedezés, nincs dinamikus import).
* A Gatewaynek tehát a Brain-rendszert **befecskendezve** kell kapnia; a példány azonosságát a Gateway nem ismerheti.

**Megállapítás:** a 0789 → 0786 függőség **kötési-idejű (bind-time)**, nem **építési-idejű (build-time)**. A 0786 nélkül a Gateway megépíthető és tesztelhető, de **nem köthető** a ténylegesen futó példányhoz.

**Javasolt, ATL-kiosztás nélküli pontosítás (kizárólag a 2A-ra, a megőrzött tervi sor érintetlen):**
* **0789/A** (2A): a szerződés teljes megvalósítása befecskendezett Brain-rendszerrel (tesztben tmp-könyvtáras `createBrainSystem` vagy fake), tesztlokális broker-példánnyal. Építési függősége: csak ATL-WRK-0785 (kész).
* **0789/B** (kötés, a 0786 és külön jóváhagyás után): a Gateway ráültetése a ténylegesen futó, megosztott példányra.
* A 0789 elfogadási kritériuma („Minden fogyasztó egy API-n át kérhet Brain-szolgáltatást”) **a 2A után nem teljesül teljesen** – csak az A-szakasz. Ezt a 2A jelentésnek ki kell mondania; a tervi sor státuszát nem szabad „kész”-re írni a B-szakasz előtt.
* A 0789-et követő tételek (0790–0793) építési függősége a 0789/A; a kötési részük a B-szakaszra marad. A többi, 0789-re hivatkozó tétel (pl. 0796, 0803) függését a saját indításukkor külön kell értékelni.
* A hatás gépileg ellenőrzött: a 2A hatékony függőségi gráfja körmentes, zárt (csak 0785 + 2A-tételek), és **nem tartalmaz** 0786/0003/0004/0005-öt (`make_2a_records.py` futtatva; kimenet: sorrend 0789 → 0792 → 0791 → 0790 → 0793, 133 óra). Részletek: `brain_2a_dependency_clarification.csv` (tételenként: mi szállítható a 2A-ban, mi marad a kötési szakaszra, a 2A utáni elfogadás mértéke).

## 2. Bizonyíték arra, hogy a 2A kizárólag elkülönített, offline fejlesztés
A bizonyítás két szinten történik: **(a) most igazolt tények** a jelenlegi kódról, **(b) kötelező, automatikus teljesítés-ellenőrzés**, amelyet a 2A **0. lépése** épít meg *az első kódsor előtt*, és amely a 2A végéig minden commitnál futnia kell.

| # | Követelmény | Mi igazolja most | Automatikus ellenőrzés (0. lépés) |
|---|---|---|---|
| E1 | Az új kód **nem a futó rendszer könyvtáraiban** él | `atlasz-runtime/Dockerfile.worker` az `atlasz-addons` könyvtárat egészében másolja a képbe → oda tett új fájl a következő buildben kiszállna. Ezért az új modulok külön, új felső szintű könyvtárba kerülnek: **`atlasz-brain-lab/`** (nem másolja Dockerfile, nincs a `registrations/` alatt) | teszt: a 2A új fájljai mind `atlasz-brain-lab/`, `atlasz-tests/` vagy `docs/` alatt vannak |
| E2 | **Meglévő fájl nem módosul** | a 2A nem igényel módosítást: a meglévő modulok csak olvasott függőségek | `git diff --name-status` ellenőrzés: csak `A` (új) bejegyzés engedett; `M`/`D`/`R` bármelyik nyomkövetett fájlon = hiba |
| E3 | **Senki nem importálja** az új kódot | a futó rendszerhez kötés explicit importtal történik (`core.mjs`, `supervisor-safe.mjs`, `registrations/*`); dinamikus import nincs | teszt: egyetlen meglévő `.mjs` sem hivatkozik `atlasz-brain-lab/`-ra (fordított import-keresés) |
| E4 | Az új kód **nem importál tiltott modult** | – | teszt: tiltott: `core.mjs`, `supervisor-safe.mjs`, `atlasz-runtime/*`, `atlasz-control-center/*`, `registrations/*`, `node:http/https/net/dns/tls/child_process/worker_threads`; engedett: tiszta gyárfüggvények és konstansok (lista rögzítve) |
| E5 | **Nincs hálózat** | – | a 0787-ben épített `installNetworkGuard` minden 2A tesztben aktív; találatszám = 0 kötelező |
| E6 | **Nincs költség, nincs élő modell** | a 0787 fake adapterei; alapért. `maxCostUsd = 0` | teszt: minden modell-eredmény FIXTURE-jelölt; `acceptAsLiveEvidence` mindig elutasít; nem-nulla költség → `BUDGET_EXCEEDED`; büdzsé nem állítható be a lab-kódból |
| E7 | **Nincs titok, nincs környezeti változó** | – | forrás-átvizsgálás: `process.env`, kulcs-minta, `Date.now`/`Math.random` (az órát/azonosítót befecskendezni kell) |
| E8 | **Állapot csak tmp-ben** | – | tesztek előtte/utána `git status --porcelain` összevetés: a tmp-n kívül semmi nem íródik; `data/` hash-azonos |
| E9 | **A futó brókerbe nincs regisztráció** | a regisztráció a `registrations/*.mjs`-ben van | a Gateway csak *leírót* ad (`describeForBroker()`), a regisztrációt kizárólag tesztlokális `createModuleBroker`-ben végzi; E3 ezt is lefedi |
| E10 | **Nem kerül be a Brain-példányok közti állapotmegosztás** | a 0786 tárgya | a 2A kód nem nyit közös állapotmappát; csak tmp |
A kész állapotról a 2A-jelentés ezekből futtatott eredményt (nem állítást) ad. Ha bármelyik ellenőrzés elbukik: **megállok és jelentek**, nem javítom meg a futó rendszert.

**Őszinte korlát:** ez a bizonyíték a jelenlegi kód statikus vizsgálatán és a jövőbeli automatikus ellenőrzéseken áll; a végső bizonyíték a 2A végén futtatott E1–E10. Ha a lab-kód később az `atlasz-addons/` alá költözik, az már a 0789/B + 0786 jóváhagyásával, külön lépés.

## 3. Végrehajtási terv
**Sorrend (a függőségi gráf szerint):** 0. lépés → 0789/A → 0792 → 0791 → 0790 → 0793. Minden tétel külön commit, saját tesztekkel, a mérföldkő után **rövid bizonyíték-jelentés**.

**0. lépés – őrzők és láthatóság (≈10 óra, a 133-on felül; becslés ±40%).** (i) `brain-2a-isolation.test` (E1–E8, E10). (ii) `brain-gap-register.test`: a gap-nyilvántartás ↔ `threat_catalog.json` szinkron, minden hézaghoz létező cél-teszt és javítási tétel. (iii) **Cél-állapotú negatív tesztek `todo` jelöléssel** mind a 25 hézagra (a védett kimenetet várják, a valós komponens ellen): ezek *minden futásban TODO-ként látszanak*, nem zöldként – így a hibás védelem nem tűnhet megfelelőnek. A meglévő rögzítő tesztek változatlanok.

**1. ATL-WRK-0789/A – Brain Gateway (28+12 óra).** Új: `atlasz-brain-lab/brain-gateway/`. `createBrainGateway({ brain, model, memory?, proposalSink, audit, approvalVerifier, clock, ids, limits })` – minden függőség befecskendezett. Műveletek a BRAIN_SPEC szerint: consult / understand / plan / act; burkolat, 26 hibakód, jogosultsági mátrix, `EXTERNAL_CONTENT = DENY`, soha-nem-adható jogosultságok. `act` **soha nem hajt végre**: `ActionProposal` megy a befecskendezett `proposalSink`-be (tesztben fake); `executed` mindig `false`. Modell nélkül degradált mód (a 0792 részletezi). Auditálás hash-láncban tmp-fájlba; audit nélkül mutáló művelet nem fut. Teszt: `brain-gateway.test` (szerződés-konformancia a `brain_api_schema.json` ellen, jogosultsági mátrix minden cellája, hibakódok, audit, fake adapteres modell-út FIXTURE-jelöléssel, a 0788 támadások **a Gateway-rétegen** külön „gateway-layer” teszttel). *Amit nem tesz:* nem köt a futó példányra; a hézagok komponens-szintű javítását nem végzi.

**2. ATL-WRK-0792 – Degradált mód (10+5 óra).** Állapot-objektum és szabályalapú válasz, kimondott „MODELL NINCS BEKÖTVE”; degradált/fixture válasz sosem `FULL`/`LIVE`. Teszt: `degraded-mode.test` (minden kiváltó hibakód, jelölés a válaszban, hamis `LIVE` megkísérlése elutasítva). *Részleges:* a „minden felületen” a kötési szakaszra marad.

**3. ATL-WRK-0791 – Prompt-könyvtár (14+6 óra).** Szerepek, séma-kötött kimenet, injekció-védelem, magyar alapért., hash-elt és verziózott promptok, változtatás csak aláírt tulajdonosi jóváhagyással (tesztkulcs, offline `generateOwnerKeyPair`), változásnapló. Teszt: `prompt-library.test` (hamis/lejárt/más tárgyú jóváhagyás elutasítva, hash-eltérés észlelése, a prompt-szöveg adat marad).

**4. ATL-WRK-0790 – Kontextus-építő (24+10 óra).** Befecskendezett források (memória, állapot, preferencia, persona, jogosultság) → reprodukálható, auditált csomag: adatminimalizálás, titokszűrés, forrásjelölés, token-keret, megbízhatatlan-adat kerítés. Teszt: `context-builder.test` (azonos bemenet → azonos hash; kimenő csomag titokmentes; a LEK-009 *Gateway-útvonalra* vonatkozó kitakarás külön „gateway-layer” teszttel – nem zárja a komponens-hibát). *Részleges:* valódi memória/állapot-források a kötési szakaszban.

**5. ATL-WRK-0793 – Busz-előfizetők (16+8 óra).** Tesztlokális `createBrainBus` + tmp `createBrainSystem`; hurokvédelem, ACL, előfizetők. Teszt: `brain-bus-subscribers.test` (tényleges koordináció, hurok megszakítva, jogosulatlan előfizető elutasítva). *Részleges:* a futó busz nem kerül érintésre.

**Összesen:** 133 óra + ≈10 óra (0. lépés), ±40%. **Leállási feltételek:** E1–E10 bármelyike elbukik; meglévő fájl módosítása válna szükségessé; élő modell, hálózat vagy költség szükségesnek tűnik; a függőség-tisztázás tévesnek bizonyul → megállok, jelentek, jóváhagyást kérek.

## 4. A 25 hézag nyilvántartása (nem záródnak a 2A-ban)
Fájlok: `brain_security_gap_register.csv` (25 hézag + 2 „CONTAINED”), `brain_gap_fix_proposals.csv`, `docs/brain_spec/threat_catalog.json`.

**Minősítési szabály (kötelező, a tulajdonosi utasítás szerint):** egy hézag **sosem** minősül megfelelőnek azért, mert a teszt kimutatta. A mai teszt a hibás viselkedést *rögzíti*; a hézag csak akkor zárt, ha (1) a komponens-javítás saját jóváhagyással megtörtént, (2) a **cél-negatív teszt** a valós komponens ellen a védett kimenetet várja és megfelel, (3) az ártatlan kontrollok zöldek, (4) a rögzítő teszt átfordítva és a katalógus frissítve, (5) a tulajdonos megerősítette. A 2A **nem** zárhat hézagot; a Gateway-rétegű védelmek külön, „gateway-layer” névvel, *kompenzáló kontrollként* szerepelnek, és a komponens-hiba nyitott marad.

**Saját korrekcióm (fontos):** a 0788-ban megadott javítási hozzárendelések felülvizsgálata szerint **13 hozzárendelés téves (WRONG_TASK), 11 részleges (PARTIAL), 1 megfelelő (ADEQUATE)**; 2 elem tulajdonosi döntésre vár.
* A hamis-érzés és ékezetmentes érzelem-hézagokat (10 db) a 0829-hez rendeltem, amely **értékelő/teszt tétel, nem javítás**; a tényleges javítás a 0803 (magyar+angol, parafrázis-álló kimenet-védelem), ékezetmentes jelzéshez 0794-normalizáló + komponens-integráció (GAPFIX-5), irónia/bizonytalanság: 0824.
* A guardrail tiltólista (PRV-009/010) hibáját a 0789 (új Gateway) **nem javítja** – ez GAPFIX-1.
* A kimenő prompt titokmentesítését (LEK-009) a 0790 csak a Gateway hívóira oldja meg; a `callModel` közvetlen hívói maradnak → GAPFIX-2.
* A magyar memória-utasítás (MEM-002) nem „modell-kimenet védelem” → GAPFIX-3. A költség első minta (CST-007) a security-brainben van → GAPFIX-4.
* **16 hézag a 0803-ra tornyosul** (hatáskör-bővítés kell: bemeneti injekció-osztályozás is; újrabecslés szükséges), és a 0803 függ a 0789-től – a javítás a 2A *után* indítható, külön jóváhagyással, futó komponens módosításával (javasolt kapuk: ATL-DEC-0058 + ATL-DEC-0068).
* Öt javasolt új javítási tétel (**GAPFIX-1…5, ATL-azonosító nincs kiosztva**); a főkönyvi kiosztáshoz külön jóváhagyás kell.
* **MEM-008 / MEM-009 (CONTAINED):** a megbízhatatlan-adatként címkézett tárolás nem blokkolás. Tulajdonosi döntés kell: elegendő-e, vagy blokkolás szükséges. Addig nem „megfelelő”.

## 5. Mi változik és mi nem
Új fájlok (a jóváhagyás után): `atlasz-brain-lab/**`, új tesztek `atlasz-tests/`-ban, rekordok `docs/brain_program/` alatt. **Nem változik:** egyetlen meglévő futó modul, a főkönyv, a leltár (1 047 / 784 / 2 117 / 97), `registrations/*`, `core.mjs`, `supervisor-safe.mjs`, `Dockerfile.worker`, `data/`.

## 6. Kockázatok
* A lab-kód utólagos áthelyezése `atlasz-addons/`-ba importútvonal-cserét igényel (mechanikus, a 0789/B része).
* A Gateway-védelmek illúziót kelthetnek („védett”); ellenszer: kötelező „gateway-layer” elnevezés és a nyilvántartás szabálya.
* A modell-út csak fake adapterrel igazolható; **semmilyen valódi nyelvi minőségi állítás nem tehető** a 2A után (a magyar korpusz is csak váz).
* A 0803 túlterheltsége késleltetheti a hézagok lezárását.

## 7. Amit a 2A után sem lehet állítani
Hogy a Brain „éles”, „modellt használ”, „biztonsági jóváhagyást kapott”, vagy hogy „minden fogyasztó egy API-n át éri el”. A 25 hézag nyitott marad.

## 8. Kért döntések és jóváhagyás
1. **A 2A kódfejlesztés indítása** az öt tételre (ATL-WRK-0789/A, 0792, 0791, 0790, 0793), a fenti sorrendben, **`atlasz-brain-lab/`** helyszínnel, a 0. lépés őrzőivel, E1–E10 kötelezően, a leállási feltételekkel. A 0789-et **A-szakaszként** kezelve (a 0786 nélkül nem „kész”). IGEN / NEM / módosítás.
2. A függőség-pontosítás (0789/A – 0789/B) **elfogadása** ATL-kiosztás nélkül.
3. A hézag-nyilvántartás korrekciójának **tudomásulvétele**; a GAPFIX-1…5 tételek főkönyvi kiosztása **külön, később** dönthető (a 2A-t nem blokkolja).
4. **MEM-008 / MEM-009:** elegendő-e a címkézéses elkülönítés, vagy blokkolás kell.
Jóváhagyásig nem írok kódot.
