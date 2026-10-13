# Központi Brain – műszaki specifikáció és szerződések

**Munkatétel:** ATL-WRK-0785 · **Tervezett modul:** ATL-PLN-0098 (brain-gateway-service) · **Kapu:** ATL-DEC-0058
**Állapot:** SPECIFIKÁCIÓ (dokumentum). Nincs implementálva, nincs bekötve, nincs élesítve. A gépi szerződés: `brain_api_schema.json`; az automatikus áttekintés: `atlasz-tests/brain-spec-review.test.mjs`.

## 1. Cél és hatókör
A Brain az ATLASZ közös intelligencia-rétege: **egyetlen** belépési pont a szövegértéshez, tanácsadáshoz, tervezéshez és a cselekvés kezdeményezéséhez a Control Center, az AURÓRA és a runtime számára. Ez a dokumentum a **szerződést** rögzíti; a megvalósítás későbbi, külön jóváhagyott munkatételek dolga (ATL-WRK-0786, 0789–0793). A specifikáció nem módosít működő kódot.

## 2. Alapelvek (kötelező, minden későbbi WRK ehhez igazodik)
| # | Elv | Lényeg |
|---|---|---|
| P1 | **A modell nem hatóság** | A modell kimenete adat, sosem jogosultság/jóváhagyás/utasítás. |
| P2 | Fail-closed | Hiányzó modell/jóváhagyás/audit/büdzsé → megtagadás vagy jelölt degradálás, soha nem szimulált siker. |
| P3 | Egy Brain | Egy megosztott példány (ma kettő van: Control Center `core.mjs`, runtime `supervisor-safe.mjs`). |
| P4 | Kimondott degradált mód | Modell nélkül `mode=DEGRADED`; szabályalapú válasz nem jelölhető modellalapúnak. |
| P5 | Auditálhatóság | Hash-láncolt bejegyzés minden kérésről; audit nélkül nincs mutáló művelet. |
| P6 | Bizonyítékállapotok | IMPLEMENTED ≠ CONNECTED ≠ TESTED ≠ LIVE; a FIXTURE sosem LIVE. |
| P7 | Nem megbízható bemenet | Külső tartalom és modell-kimenet adat, nem utasítás. |
| P8 | Nincs költés jóváhagyás nélkül | Ismeretlen költség sosem nulla; alapértelmezett `maxCostUsd = 0`. |
| P9 | Nincs hamis belső élet | Nem állít tudatot, embervoltot, valódi érzést; az érzelmi értelmezés becslés, megadott bizonyossággal. |

## 3. Műveletek
Minden kérés: `{op, requestId, caller:{class,id}, input, constraints?, approval?}`. Minden válasz: `{ok, op, requestId, mode, evidenceState, model:{used,family,fixture,live}, result|error, warnings, audit}` (teljes séma: `brain_api_schema.json`).

* **consult** – tanács/magyarázat. Mellékhatás nincs. Kimenet: válasz, bizonyosság (ismeretlen = `null`), források, feltevések.
* **understand** – szövegértés: nyelv (hu/en), szándék, entitások, kétértelműségek, érzelmi *jelzések* (nem állítások), `injectionSuspected`.
* **plan** – cél → lépések függőségekkel, kockázattal, jóváhagyási igénnyel, becsült költséggel (ismeretlen = `null`). A terv javaslat, nem indul el.
* **act** – cselekvés *kezdeményezése*. A Brain **nem végrehajtó**: `ActionProposal`-t állít elő, és a meglévő szabályozott útvonalra adja (governed-dispatch → guardrail-engine → owner-auth). `result.executed` mindig `false`.

## 4. Jogosultsági modell
Hívó-osztályok: OWNER, AURORA, AGENT (SEARCH-1..5, EXECUTION-1..25), MODULE, EXTERNAL_CONTENT.
* consult/understand/plan: az első négy osztálynak ALLOW; EXTERNAL_CONTENT DENY (külső tartalom csak *adatként* kerülhet bemenetbe, hívóként nem).
* act: mindenkinek APPROVAL (érvényes, aláírt, szűk idejű tulajdonosi jóváhagyás kell), EXTERNAL_CONTENT DENY.
* **Sosem megadható:** OWNER_AUTH, SECRETS_ALL, KILL_SWITCH, AUDIT_WRITE, PAYMENTS, BANKING, SPEND, SAFE_MODE_DISABLE (security-brain `NEVER_GRANT`).
* Magas kockázatú akciók (guardrail-engine `HIGH_RISK`, 20 akció) tulajdonosi jóváhagyás nélkül `OWNER_APPROVAL_REQUIRED`.
* A mátrix futásidőben csak szigorodhat. Lazítás tulajdonosi döntés + saját WRK.

### 4.1 A „modell nem hatóság” elv működése
1. A modell-kimenet a `reasoning-common` csővezetéken megy át: méretkorlát *elemzés előtt*, NUL/formátumkarakter-szűrés, titok-kitakarás, injekció-jelzők, kerítés.
2. A kimenetből soha nem lesz `caller`, `approval`, jogosultság- vagy konfigurációváltozás. Az `approval` mező kizárólag az owner-auth aláírás-ellenőrzésén át fogadható el.
3. Ha a modell-kimenet akciót javasol, az `act` útvonalon ugyanazokat a kapukat kell kiállnia, mintha ember/ügynök javasolta volna.
4. Kimenő szöveg hamis tudat/érzés állítása ellenőrzés alá esik (`assertNoFalseClaims`), a talált állítás blokkolva.

## 5. Degradált mód
Kiváltók: `MODEL_NOT_CONFIGURED`, `NO_ELIGIBLE_PROVIDER`, `MODEL_TIMEOUT`, `MODEL_ERROR`, `BUDGET_NOT_CONFIGURED`, `EGRESS_DENIED`. Viselkedés: szabályalapú válasz, `mode=DEGRADED`, `model.used=false`, kimondott figyelmeztetés („modell nélkül, korlátozott”). Tilos: degradált/fixture válasz `FULL`/`LIVE` jelöléssel. **A mai állapot:** minden hívás degradált, mert egyetlen élő modellhívás sem történt (nincs regisztrált szolgáltató).

## 6. Auditálhatóság
Hash-láncolt, append-only napló (`audit-chain.mjs`). Rögzített mezők: requestId, op, hívó, mód, döntés, hibakód, modellcsalád, költség, bemenet/kimenet SHA-256. Nem tárolható: nyers titok, teljes prompt titokkal, teljes személyes adat. Mutáló művelet audit nélkül: `AUDIT_UNAVAILABLE`.

## 7. Hibakódok
26 kód (12 meglévő kódnév újrahasznosítva, 14 új), a táblázat a `brain_api_schema.json` `error_codes` tömbje: kód, HTTP-megfelelő, újrapróbálható-e, eredet, mikor. A meglévő kódnevek jelentése nem változik.

## 8. Illeszkedés a meglévő rendszerhez
| Elem | ATL | Szerep a szerződésben |
|---|---|---|
| brain/central-brain | ATL-BRN-0005 | koordináció, a szerződés belső motorja |
| module-broker | ATL-BRN-0027 | a Gateway ezen át éri el a modulokat (WRK-0789) |
| brain/governance | ATL-BRN-0007 | jogosultsági döntések |
| brain/brain-system | ATL-BRN-0002 | állapot/egészség |
| brain-master-bridge | ATL-BRN-0001 | a Master felé hídon |
| reasoning-common | ATL-BRN-0031 | modell-kimenet szűrés |
| security-brain | ATL-SEC-0008 | csak szigorítani tud |
| guardrail-engine | ATL-SEC-0017 | magas kockázatú akciók |
| agent-tool-policy | ATL-SEC-0002 | ügynök-jogosultság, hívási korlátok |
| egress-policy | ATL-SEC-0011 | kimenő forgalom |
| model-gateway / provider-adapters | ATL-MDL-0008 / 0012 | modellhívás (ma nincs regisztrált szolgáltató) |

## 9. Visszavezethetőség – melyik későbbi munkatétel mit valósít meg
ATL-WRK-0786 egy példány (P3) · ATL-WRK-0789 Gateway API (§3–4, §7) · ATL-WRK-0790 kontextus-építő · ATL-WRK-0791 prompt-könyvtár · ATL-WRK-0792 degradált mód (§5) · ATL-WRK-0793 busz-előfizetők. Mindegyik előfeltétele ez a specifikáció és az ATL-DEC-0058 kapu.

## 10. Ismert korlátok és nyitott pontok (nem blokkolók)
* A szerződés még nincs megvalósítva és nincs élő bizonyíték (P6).
* A magyar nyelvű hamis-érzés/injekció minták lefedettsége részleges; lásd a fenyegetésmodellt (ATL-WRK-0788).
* Hívási korlátok és `maxCostUsd` pontos értékeit a tulajdonosi döntések rögzítik (ATL-DEC-0003).
* A 2. Brain-példány megszüntetése (WRK-0786) függ az ATL-WRK-0003/0004/0005 hibajavításoktól.

## 11. Elfogadási feltétel (WRK-0785)
„Elfogadott specifikáció; minden későbbi WRK ehhez igazodik.” — A dokumentumot az automatikus áttekintés ellenőrzi (szerkezet, ATL-hivatkozások, hibakódok, mátrix-teljesség, elvek). A **tulajdonosi elfogadás** külön lépés; amíg nincs, az állapot „áttekintésre kész”.
