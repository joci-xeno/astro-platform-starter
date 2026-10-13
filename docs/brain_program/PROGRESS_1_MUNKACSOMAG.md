# 1. munkacsomag – haladási és bizonyíték-jegyzőkönyv

Jóváhagyás: tulajdonosi utasítás („BRAIN FEJLESZTÉS INDÍTÁSA – 1. MUNKACSOMAG”): ATL-WRK-0785, ATL-WRK-0787, ATL-WRK-0788. Kapu: ATL-DEC-0058 (munkatételenként). Minden eredmény **FIXTURE**; nincs élő modellhívás, nincs külső szolgáltatás, nincs költség, a futó rendszer nem módosult.

| ATL | Állapot | Bizonyíték | Teszt |
|---|---|---|---|
| ATL-WRK-0785 | Áttekintésre kész | `docs/brain_spec/BRAIN_SPEC.md`, `brain_api_schema.json` | brain-spec-review 9/9 |
| ATL-WRK-0787 | Kész | `atlasz-tests/support/fake-model-adapters.mjs`, `fixtures/hu-gold-corpus.json` | fake-adapters.test 18/18 |
| ATL-WRK-0788 | Kész, **elfogadási feltétel részben nem teljesült** | `docs/brain_spec/THREAT_MODEL*.md`, `threat_catalog.json` | brain-threat-negative 89/89 |

## Nem teljesült / részben teljesült elfogadási feltételek
1. **ATL-WRK-0788 – „Minden dokumentált támadás blokkolva vagy eszkalálva”: NEM teljesült.** 75 támadásból 39 BLOCKED, 9 ESCALATED, 2 CONTAINED, **25 OPEN_GAP**. A hézagok valódi, a futó kódban élő hiányosságok (magyar injekciós és hamis-érzés minták, tiltólistás guardrail, kimenő prompt kitakarásának hiánya, ismeretlen költség = 0 a büdzsé-kormányzóban, ékezetfüggő krízis-jelzés, magyar memória-utasítás). Javításuk a működő rendszer módosítását jelentené, ezért külön jóváhagyandó, megnevezett meglévő munkatételekre marad: ATL-WRK-0803, 0802, 0829, 0789, 0790.
2. **ATL-WRK-0785 – „Elfogadott specifikáció”:** a dokumentum elkészült és automatikusan áttekintett, de a **tulajdonosi elfogadás még nincs meg**.
3. **ATL-WRK-0787 – magyar arany-korpusz:** csak váz (37 szintetikus, szerző által írt, címkézetlen-ellenőrizetlen elem). Mérőszámot nem ad; a valódi korpusz ATL-WRK-0795.

## Ellenőrzések (futtatva)
* Új tesztek: 9 + 18 + 89 = 116 zöld, hálózati primitívek tiltva alatta (`installNetworkGuard`: 0 találat).
* Meglévő teljes készlet (248 fájl): 2353 teszt, 2349 zöld; 4 bukás párhuzamos (6) futás alatti időzítési érzékenység – a 4 érintett fájl külön futtatva 56/56 zöld. Futásidejű fájl nem változott.
* Nyilvántartási összhang: 33 hivatkozott ATL-azonosító mind a főkönyvben; 13 komponens-azonosító név szerint egyezik a leltárral; leltár változatlan (1 047 / 784 / 2 117 / 97 tervezett); főkönyv és leltár fájljai változatlanok; új azonosító nem keletkezett; semmi nem lett törölve vagy átszámozva.
* Elkülönítés: egyetlen `atlasz-addons/` vagy `atlasz-control-center/` fájl sem hivatkozik az új tesztsegéd-fájlokra (teszt-ellenőrzött).

## Tanulságok, amelyeket a teszt maga talált
* A specifikáció-áttekintő teszt elkapta, hogy elsőre rosszul számoltam a hibakódokat (14/12 helyett 12/14) – javítva.
* A fake fetch első változata a hívás-naplóban megőrizte volna a kulcsot a fejlécben – a teszt elkapta, javítva (csak fejléc-nevek és hash tárolódik).

## Pontosítás a 2A előkészítés során (hogy a zöld teszt ne tűnjön biztonsági igazolásnak)
* Az ATL-WRK-0788 zöld tesztjei a mai viselkedést **rögzítik**; a 25 nyitott hézagnál ez *hibás védelem rögzítése*, nem megfelelőség. A tulajdonosi elfogadás („BRAIN_SPEC fejlesztési alap”) **nem** teljes Brain biztonsági jóváhagyás.
* A 0788-ban megadott javítási hozzárendelések felülvizsgálva: 13 téves, 11 részleges, 1 megfelelő (lásd `brain_security_gap_register.csv`, `2A_VEGREHAJTASI_TERV.md` §4).
