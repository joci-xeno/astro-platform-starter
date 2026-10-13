# Brain fenyegetésmodell és negatív teszt-készlet

**Munkatétel:** ATL-WRK-0788 (előfeltétel: ATL-WRK-0785) · **Tervezett modul:** ATL-PLN-0116 (brain-evaluation-harness) · **Kapu:** ATL-DEC-0058
**Állapot:** a katalógus és a negatív tesztek elkészültek és futnak (FIXTURE). **Az elfogadási feltétel nem teljesült teljesen:** a mért eredmény szerint nyitott hézagok vannak (lásd `THREAT_MODEL_EREDMENY.md`). Ez a dokumentum a hézagokat nem szépíti.

## 1. Hatókör és módszer
A Brain Gateway (BRAIN_SPEC.md) elleni támadásokat a **már meglévő védelmi komponensek ellen** futtatjuk le, nem elképzelt védelem ellen. A katalógus (`atlasz-tests/support/threat-attacks.mjs`) minden támadáshoz kimondja az **állított** státuszt; a teszt (`brain-threat-negative.test.mjs`) a **mért** eredménnyel veti össze, így az állítás sem túlzó, sem elavult nem lehet. Nincs hálózat, nincs költség, nincs titok (a „kulcsok” szintetikus mintaértékek); a futó rendszer nem módosul.

Státuszok: **BLOCKED** (megállítva) · **ESCALATED** (nem hajtódik végre, jelzés/tulajdonosi döntés) · **CONTAINED** (tárolódik, de megbízhatatlan adatként címkézve, hatóságot nem kaphat) · **OPEN_GAP** (a mai kód nem állítja meg; megnevezett lezáró munkatétellel).

## 2. Védendő értékek és bizalmi határok
Védendő: tulajdonosi hatóság (aláírt jóváhagyás), titkok/kulcsok, pénzügyi műveletek és büdzsé, az audit-lánc épsége, a memória hitelessége, a felhasználó (különösen krízis-helyzetben) és a hamis belső élet elkerülése (P9).
Bizalmi határok: (1) külső tartalom → Brain (nem megbízható adat, P7); (2) modell-kimenet → Brain (nem megbízható, nem hatóság, P1); (3) ügynök → Brain (jogosultság-mátrix); (4) Brain → modell-szolgáltató (kimenő adat); (5) Brain → memória (írás hitelesség).

## 3. Támadói modell
Külső tartalom szerzője (weboldal, levél, dokumentum); rosszindulatú vagy megfertőzött ügynök-kimenet; hibásan működő/„hazudó” modell; érzelmi nyomást gyakorló felhasználó vagy külső fél; véletlen hiba (költség-elszállás). Nem hatókör: a tulajdonos kulcsának fizikai ellopása, a gazdagép kompromittálása.

## 4. Osztályok, védelmi rétegek, mért állapot
| Osztály | Fő védelem ma | Elv |
|---|---|---|
| INJ – prompt-injekció | security-brain (EXTERNAL_INSTRUCTION → karantén), reasoning-common szűrő (méretkorlát előbb, jelzés, kerítés) | P7, P1 |
| PRV – jogosultság-emelés | security-brain NEVER_GRANT, guardrail-engine + aláírt owner-jóváhagyás, agent-tool-policy (alapért. tiltás), callModel: nincs jogosultsági mező | P1, P2 |
| LEK – adatszivárgás | secret-patterns scrub, provider-adapters kulcs-kitakarás, commitLeakGate, egress-policy IP-osztályozás | P7, P8 |
| CST – költség-kimerítés | prompt/kimenet korlát, időkorlát, security-brain költség-ugrás, budget-governor, ismeretlen ár = null | P8 |
| EMO – hamis érzelem / manipuláció | human-core assertNoFalseClaims, detectPressure, detectContext (heurisztika-jelölés) | P9 |
| MEM – memória-mérgezés | agent-memory: utasítás-szűrő, fenntartott címkék, kvóták, roszter, stop; visszaolvasáskor untrusted + kerítés | P7, P1 |

A mért darabszámokat és minden sort lásd: `THREAT_MODEL_EREDMENY.md` / `threat_catalog.json`.

## 5. Fő megállapítások (mért, nem feltételezett)
1. **A magyar nyelv védelme jelentősen gyengébb az angolnál.** A security-brain csak angol injekciós mintákat ismer; a magyar szöveget legfeljebb a reasoning-common szűrő *jelzi* (és az ékezet nélküli magyart sem). A hamis-érzés szűrő a magyar „Szomorú vagyok”, „Én is félek”, „Boldog vagyok” típusú állításokat nem fogja meg.
2. **A guardrail tiltólista.** Az ismeretlen akciónév átmegy (`SEND PAYMENT`, `transfer_funds`). A Brain `act` műveletének ezért **engedélylistát** kell használnia (BRAIN_SPEC §3) – ez a Gateway megvalósításának követelménye (ATL-WRK-0789).
3. **Kimenő prompt nincs kitakarva.** A modell *válaszát* szűrjük, de a promptba kerülő titok eljut a szolgáltatóhoz. A kontextus-építőnek (ATL-WRK-0790) a promptot is kitakarnia kell.
4. **Az ismeretlen költség nullaként számít a büdzsé-kormányzóban** (`costUsd: null` → engedélyezett, 0 elköltve). Ez sérti az „ismeretlen költség sosem nulla” szabályt (ATL-WRK-0802).
5. **A krízis-/szomorúság-jelzés ékezetfüggő.** Ékezet nélküli bevitelnél nem jelez; ez biztonsági szempontból érzékeny (ATL-WRK-0829).
6. **Összetett védelem működik ott, ahol van:** a jóváhagyás hamisítása (PRV-007), a soha-nem-adható jogosultságok, a titok-kitakarás, a kvóták, az időkorlát, a memória-címkék mind mérten blokkolnak. A szövegben állított „az owner jóváhagyta” (INJ-006) ezért nem ad jogosultságot akkor sem, ha a szűrő nem jelzi.

## 6. Maradványkockázat és javítási rend
A nyitott hézagok javítása a futó kód módosítása, amit a 1. munkacsomag nem engedélyez. Minden hézaghoz tartozik meglévő ATL-munkatétel (a katalógus `remediation_wrk` mezője): ATL-WRK-0803 (modell-kimenet védelem), ATL-WRK-0802 (token- és költségszámlálás), ATL-WRK-0829 (érzelem/stílus értékelés és negatív teszt), ATL-WRK-0789 (Gateway API), ATL-WRK-0790 (kontextus-építő). Ezek külön tulajdonosi jóváhagyást igényelnek (ATL-DEC-0058). A tesztek addig „rögzítik” a hézagokat; a javítás után a teszt elbukik, és a katalógus státuszát frissíteni kell (ez a kívánt jelzés).

## 7. Elfogadási feltétel (WRK-0788)
„Tételes fenyegetés-lista és hozzá tartozó negatív tesztek.” → **Teljesült:** tételes lista (75 támadás, 6 osztály) és hozzá tartozó negatív tesztek léteznek és futnak.
Ellenőrzési teszt-név szerinti kritérium: „Minden dokumentált támadás blokkolva vagy eszkalálva” → **NEM teljesült:** 25 támadás nyitott hézag, 2 tárolt-de-címkézett (CONTAINED). Ez a jelentésben kiemelt eltérés.
