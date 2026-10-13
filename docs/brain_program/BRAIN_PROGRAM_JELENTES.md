# ATLASZ AURÓRA V7.3 – BRAIN-PROGRAM: vizsgálat, számozott munkaterv, bekötési sorrend

*Dátum: 2026-10-12 · Alap: commit `0df77d0` · Csak nyilvántartás és tervezés: a működő rendszer kódja nem módosult, modell nincs bekötve, külső szolgáltatás nincs aktiválva, költség nem keletkezett.*

## 1. Röviden

- **Az agy váza és a védelmi réteg nagyrészt megvan, az agy maga még nem működik.** A 45 BRAIN-modul, a modul-gerinc (module-broker), a modell-nyilvántartás, az aláírt jóváhagyások, a költségplafon és a kill-switch valós, helyben tesztelt kód. **De egyetlen élő modellhívás sem történt**, és a Brain magja (brain/*) egyetlen modellt sem hív: a döntések sablonok (csak három következtető motor – decision-analysis, debate-protocol, multi-solution – tud injektált adapteren át modellt hívni, adapter nélkül leáll), a szövegértés kulcsszavas (regex), a főoldali chat is csak négy kulcsszót ismer.
- **A Brain ma nem közös intelligencia-réteg.** Infrastruktúraként (biztonság, napló, feladatsor) sok modul használja, de az AURÓRA, a chat, az ügynökök, a munkafolyamatok nem kérdezik meg. Ráadásul **két külön Brain-példány** fut (Control Center és runtime), közös állapot nélkül.
- **A hang** böngészőben (Web Speech) valóban kész kód, de a tulajdonos még nem igazolta, a nyelvváltó hibás (D-07), és megkerüli a szerver-oldali hozzájárulási szabályokat. **A memória** nagyrészt tartós és részben jól szabályozható, de három tár újraindításkor elvész, és nincs egységes ki/be, export, felejtés.
- **Az önálló feladatvégzés** felügyeleti oldala (kill-switch, független ellenőr, jóváhagyás, visszagörgetés) valós; a zárt hurok (cél → terv → végrehajtás → önellenőrzés → javítás) **nincs összekötve**, a replanner csak jelzőt ad.
- **Terv:** 62 új, számozott munkafeladat, 21 új tervezett modul, 11 új tulajdonosi jóváhagyási kapu, összesen **94 új ATL-azonosító** – a meglévők átszámozása és törlés nélkül. Becsült összmunka ≈ **1737 óra** (±40%, becslés), a leghosszabb függőségi lánc ≈ **428 óra** a meglévő előfeltételekkel együtt.

## 2. A 10 kötelező képesség: tényleges állapot

| # | Képesség | Mai állapot | Új munka (db / óra) |
|---|---|---|---|
| 1 | Központi AI-agy, működő AI-modellkapcsolatokkal | **RÉSZBEN – szerkezet kész, ÉLŐ modell nincs** | 25 / 639 |
| 2 | Valódi szövegértés, szándékfelismerés és kontextuskezelés | **SZIMULÁLT/szabályos – szó szerinti szövegértés nincs** | 21 / 579 |
| 3 | Következtetés, tervezés és összetett problémamegoldás | **RÉSZBEN – a motorok megvannak, modell nélkül fail-closed** | 17 / 554 |
| 4 | Természetes, többfordulós magyar nyelvű beszélgetés | **HIÁNYZIK – nincs természetes magyar többfordulós beszélgetés** | 18 / 500 |
| 5 | Mikrofonos beszédfelismerés és hallás | **RÉSZBEN – böngészős kód megvan, tulajdonos által NEM igazolt** | 6 / 162 |
| 6 | Természetes magyar nyelvű hangos válasz | **RÉSZBEN – böngésző TTS megvan, minőség és magyar hang nem igazolt** | 6 / 184 |
| 7 | Érzelmi hangulat, beszédstílus és kreatív szándék felismerése | **RÉSZBEN – lexikális, kulcsszavas** | 6 / 154 |
| 8 | Érzelmek természetes kifejezése beszédben és kreatív munkában, emberi érzelem birtoklásának állítása nélkül | **RÉSZBEN – védőkorlát van, kifejezés alig** | 9 / 202 |
| 9 | Tartós, szabályozható memória és beszélgetési kontextus | **RÉSZBEN – tartós tárak vannak, szabályozás hiányos** | 11 / 346 |
| 10 | Önálló feladattervezés, végrehajtás, önellenőrzés és hibajavítás, tulajdonosi felügyelettel | **RÉSZBEN – felügyeleti réteg valós, zárt hurok nincs** | 22 / 648 |

Részletek képességenként (mi működik, mi szimulált, mi hiányzik): `brain_capabilities.csv`.

**#1 – Központi AI-agy, működő AI-modellkapcsolatokkal**  
*Működik:* Szabályalapú Brain-váz (45 BRN modul), module-broker tool-gerinc, modell-nyilvántartás, aláírt MODEL_ENABLE/költségplafon/egress-védelem, kill-switch; felhős (openai-compat, anthropic, google) és helyi Ollama adapter KÓD.  
*Szimulált / nem igazolt:* Minden modellhívás-teszt fake transporttal fut; a verifikációs jelentés szerint valódi szolgáltatói hívás soha nem történt. 0 LIVE modell.  
*Hiányzik:* A Control Center és a runtime gateway-eknek nincs regisztrált szolgáltatója (NO_ELIGIBLE_PROVIDER); nincs streaming, tool-calling, strukturált kimenet, retry/backoff; két külön Brain-példány (nincs megosztott szolgáltatás).

**#2 – Valódi szövegértés, szándékfelismerés és kontextuskezelés**  
*Működik:* Regex-alapú szándék-osztályozás: aurora.respond (EN/HU), owner-command (12-13 whitelist), master-brief.answerQuery (4 regex); conversation.mjs tároló és context-manager csomagolás.  
*Szimulált / nem igazolt:* A szándékfelismerés kulcsszavas; a '/api/chat' is: 'No language model is connected'.  
*Hiányzik:* Modellalapú megértés, entitás-kinyerés, bizonytalanság-kezelés; a conversation tároló nincs bekötve az Aurorába/chatbe; nincs előzmény az Aurora/chat útvonalon.

**#3 – Következtetés, tervezés és összetett problémamegoldás**  
*Működik:* goal-planner (modell-adapterrel), decision-analysis, debate-protocol, multi-solution (MODEL_NOT_CONFIGURED nélkül adapter), planning-brain gráf, orchestrator pipeline, verifier.  
*Szimulált / nem igazolt:* Tesztek fake modell-adapterrel; a goal-planner kimenetét senki nem fogyasztja.  
*Hiányzik:* Terv-séma híd (goal-planner → planning-brain → orchestrator), élő modell, a stall-replanner csak jelző (6 sor), nincs szöveg → cél → terv → ügynök lánc.

**#4 – Természetes, többfordulós magyar nyelvű beszélgetés**  
*Működik:* Magyar sablonok és cue-szavak (aurora/human-core), hu alapértelmezés, conversation tároló.  
*Szimulált / nem igazolt:* Rögzített sablonválaszok; minden utterance független.  
*Hiányzik:* Modellalapú magyar válasz, előzmény-összegzés, utalás-feloldás, magyar morfológia (szuffixum), ékezet-normalizálás az intent/memória rétegben, nyelvfelismerés.

**#5 – Mikrofonos beszédfelismerés és hallás**  
*Működik:* Web Speech API (SpeechRecognition) az AURÓRA nézetben, hu-HU alapértelmezés; szerver-oldali hang-állapotgép szabályokkal (consent, megőrzés, barge-in).  
*Szimulált / nem igazolt:* A szerver-oldali hang-stack csak mock szolgáltatókkal tesztelt; VOICE_BLOCKED_NO_PROVIDER.  
*Hiányzik:* D-07 hiba (nyelvváltó nem hat az STT-re, 'Jó reggelt' néma); a böngésző útvonal megkerüli a szerver-oldali consent/retention szabályokat; nincs tulajdonosi hangteszt; helyi/felhős STT adapter nincs; böngésző-STT adatvédelmi tájékoztató nincs.

**#6 – Természetes magyar nyelvű hangos válasz**  
*Működik:* speechSynthesis hu/en hangválasztás, sebesség/hangmagasság a warmth/expressiveness szerint.  
*Szimulált / nem igazolt:* –  
*Hiányzik:* Magyar hang megléte az OS/böngészőn múlik; nincs neurális/helyi TTS; nincs SSML/prozódia; nincs tulajdonosi igazolás.

**#7 – Érzelmi hangulat, beszédstílus és kreatív szándék felismerése**  
*Működik:* human-core: 13 érzelem-jel + nyomás-észlelés (EN/HU), 'LEXICAL_HEURISTIC' megjelöléssel.  
*Szimulált / nem igazolt:* –  
*Hiányzik:* Modellalapú hangulat/stílus, beszéd-prozódia elemzés, több fordulós hangulat-követés, kreatív szándék (ATL-PLN-0002, ATL-PLN-0020 tervezett).

**#8 – Érzelmek természetes kifejezése beszédben és kreatív munkában, emberi érzelem birtoklásának állítása nélkül**  
*Működik:* assertNoFalseClaims (hamis érzelem-állítás tiltása) a sablonválaszokon; AURORA.selfDescription: mesterséges intelligencia, nincs érzése.  
*Szimulált / nem igazolt:* –  
*Hiányzik:* A védelem csak sablonokra fut, modell-kimenetre nem; angol minták, magyar lefedettség bizonytalan; parafrázissal megkerülhető; nincs SSML/prozódia-leképezés; nincs kreatív kifejezési irányelv.

**#9 – Tartós, szabályozható memória és beszélgetési kontextus**  
*Működik:* memory-store (md+SQLite FTS5, hash-lánc, jóváhagyott felejtés), observation-memory (nézet/javítás/felejtés/export/megőrzés/scope/consent), preferences (export/forgetAll), conversation (500 forduló).  
*Szimulált / nem igazolt:* Az embedding hash-alapú (nem neurális); embedding-provider alapból mock.  
*Hiányzik:* 3 nem tartós tár (business-memory, entity-graph, experience); nincs egységes ki/be, export és felejtés; memory-store-nak nincs export; beszélgetés → memória rögzítés nincs; a knowledge/memory főleg csak ír, olvasás a kontextusba nincs.

**#10 – Önálló feladattervezés, végrehajtás, önellenőrzés és hibajavítás, tulajdonosi felügyelettel**  
*Működik:* governance (kill-switch, safe mode, aláírt jóváhagyás, audit-lánc), független verifier, korlátos újrapróbálás/eszkaláció, code-edit-workflow (javaslat→átnézés→jóváhagyás→pillanatkép→visszaállítás), 5 lokális executor.  
*Szimulált / nem igazolt:* A runtime tick szabályalapú szűrést futtat, nem általános feladatvégzést; a SEARCH ügynök hn.algolia keresése az egress-policy-t megkerüli (D-11).  
*Hiányzik:* Modellvezérelt tool-use ciklus, futásonkénti keret, valódi újratervezés, hiba→javítás automatikus javaslat-lánc, 30 ügynök a runtime-ban (ma csak a CC-ben), D-04/D-05/D-08 előfeltételek.

## 3. A meglévő BRAIN / AURÓRA / MODEL / MEMORY / VOICE / AGENT modulok

Vizsgált meglévő rendszerelem: **200** (45 BRN, 5 AUR, 28 MDL, 15 MEM, 3 VOI, 65 AGT + a tervhez hivatkozott további komponensek). Besorolás a tényleges kód alapján (nem a leltári státusz átvétele):

| Valós állapot | db (BRN/AUR/MDL/MEM/VOI/AGT) |
|---|---|
| MŰKÖDIK HELYBEN (fixture-igazolt) | 59 |
| SZABÁLYALAPÚ (működik, nem 'intelligens') | 51 |
| LEÍRÓ (soha nem hívott) | 14 |
| SZIMULÁLT / csak mock | 11 |
| VÁZ (stub) | 10 |
| TÁMOGATÓ KOMPONENS (a tervben hivatkozott, nem Brain-modul) | 8 |
| KÓD KÉSZ, MODELL NÉLKÜL FAIL-CLOSED | 5 |
| LÉTEZIK, DE NINCS BEKÖTVE | 3 |

Elemenkénti lista ATL-azonosítóval, bekötéssel és megállapítással: `brain_modules_assessment.csv`. A leltár `VERIFIED_WORKING` státusza itt is csak **fixture-szintű** igazolást jelent, élő bizonyítékot nem.

## 4. Mit kell bekötni (a vizsgálat lényege)

- **Modell-út:** a Control Center és a runtime gateway-ei ma szolgáltató nélkül működnek (mindig NO_ELIGIBLE_PROVIDER); a kész adapter-kód (felhő + Ollama) soha nem futott élőben, és nem tud streaminget, tool-callinget, strukturált kimenetet, retry-t.
- **Brain Gateway:** egyetlen, típusos belépési pont (`consult/understand/plan/act`) a meglévő module-broker fölött; egyetlen megosztott Brain-példány.
- **Szövegértés + magyar nyelv:** modellalapú, séma-kötött szándékfelismerés szabályos visszaesés mellett; magyar ragozás-, ékezet-, nyelvfelismerés; magyar arany-korpusz a mérésre.
- **Beszélgetés:** a `conversation` tároló és a `context-manager` tényleges használata, előzmény-összegzés, az AURÓRA és a chat egy úttá egyesítése.
- **Terv-lánc:** goal-planner → planning-brain → orchestrator → verifier összekötése (ma nem fogyasztja senki a goal-planner kimenetét).
- **Memória:** egységes ki/be, export, felejtés; a 3 nem tartós tár tartóssá tétele; embedding aktiválása (jóváhagyással); beszélgetés-rögzítés hozzájárulással; olvasás a kontextusba.
- **Hang:** D-07 javítása, a böngészős hang a szerver-oldali szabályokon át, tulajdonosi hangteszt, szolgáltató-adapterek, adatvédelmi tájékoztató.
- **Érzelem:** modellalapú felismerés, kifejezési szabályzat, a hamis érzelem-állítás elleni védelem a **modell-kimenetre** is (ma csak sablonokra), magyar minták.
- **Önálló munka:** futásonkénti keret, tool-use ciklus, sandbox, valódi újratervezés, bizonyíték-alapú verifier, javítási kör (automatikus alkalmazás tilos), a 30 ügynök hostolása a runtime-ban.

## 5. Fázisok és ütemezés (függőségekkel)

| Fázis | Tartalom | Feladat | Becsült óra | Tulajdonosi kapuk (a fejlesztés-indításon túl) |
|---|---|---|---|---|
| F0 | Alapozás, specifikáció, tesztinfrastruktúra (nincs külső szolgáltatás) | 4 | 92 | runtime-release (ATL-DEC-0068) |
| F1 | Brain Gateway és megosztott kontextus (offline, fake modell-adapterrel) | 5 | 133 | — |
| F2 | Magyar nyelv, szövegértés, többfordulós beszélgetés (offline) | 6 | 188 | runtime-release (ATL-DEC-0068) |
| F3 | Modell-réteg és terv-híd előkészítése (fake transport, nincs költség) | 8 | 256 | local-model-install (ATL-DEC-0061), runtime-release (ATL-DEC-0068) |
| F4 | ELSŐ ÉLŐ MODELL-BEKÖTÉS (tulajdonosi kapuk) | 3 | 44 | egress (ATL-DEC-0002), live-eval-budget (ATL-DEC-0062), live-provider-choice (ATL-DEC-0059), model-enable (ATL-DEC-0003), owner-key (ATL-DEC-0001), spend-cap-amount (ATL-DEC-0060) |
| F5 | Élő megértés, következtetés, beszélgetés + értékelés | 4 | 108 | live-eval-budget (ATL-DEC-0062), runtime-release (ATL-DEC-0068), spend-cap-amount (ATL-DEC-0060) |
| F6 | Tartós, szabályozható memória | 5 | 148 | embedding-activation (ATL-DEC-0064), local-model-install (ATL-DEC-0061), memory-capture-policy (ATL-DEC-0063) |
| F7 | Hallás és beszéd (magyar) | 4 | 102 | local-model-install (ATL-DEC-0061), runtime-release (ATL-DEC-0068), voice-provider-privacy (ATL-DEC-0065), voice-test (ATL-DEC-0006) |
| F8 | Érzelem, stílus, kreatív szándék; érzelemkifejezés állítás nélkül | 6 | 150 | emotion-policy-signoff (ATL-DEC-0066), voice-test (ATL-DEC-0006) |
| F9 | Önálló feladatvégzés tulajdonosi felügyelettel | 9 | 304 | autonomy-level (ATL-DEC-0067), live-eval-budget (ATL-DEC-0062), runtime-release (ATL-DEC-0068) |
| F10 | Egységes intelligenciaréteg: minden modul rákötése, UI, telemetria, kiadás, végső elfogadás | 8 | 212 | live-eval-budget (ATL-DEC-0062), runtime-release (ATL-DEC-0068) |

A részletes, számozott lista függőségekkel: `brain_work_plan.csv` (és `brain_program.sqlite`). Minden feladat tartalmaz: ATL-komponens-hivatkozásokat, tervezett modult, függőségeket (új és meglévő ATL-WRK), óra-becslést, elfogadási kritériumot, tesztet, kaput.

### Javasolt sorrend a Brain működésbe hozására

| Lépés | Tartalom | Feladatok | Külső / jóváhagyás |
|---|---|---|---|
| 1 | Előfeltételek (meglévő hibajegyek): D-03/D-04/D-05 (zárak), D-08, D-07 | ATL-WRK-0003, 0004, 0005, 0008, 0007 | nincs külső szolgáltatás |
| 2 | Specifikáció, fake-adapterek, fenyegetésmodell | ATL-WRK-0785, ATL-WRK-0787, ATL-WRK-0788 | nincs külső szolgáltatás |
| 3 | Egy megosztott Brain + Brain Gateway + Context Builder + degradált mód | ATL-WRK-0786, ATL-WRK-0789–ATL-WRK-0793 | futó rendszer módosítása csak külön kapuval |
| 4 | Magyar nyelvi csomag, arany-korpusz, szövegértés, beszélgetés-vezérlő (fake modellel) | ATL-WRK-0794–ATL-WRK-0799 | — |
| 5 | Modell-réteg előkészítés: gateway-bekötés, adapter-képességek, költségszámlálás, kimeneti védelem, terv-híd (fake transporttal) | ATL-WRK-0800–ATL-WRK-0807 | — |
| 6 | ELSŐ ÉLŐ MODELL: jóváhagyási csomag → aláírások → probe → kis költségű próba → magyar füstteszt | ATL-WRK-0808–ATL-WRK-0810 | kulcs, egress, MODEL_ENABLE, költségplafon, szolgáltató-választás |
| 7 | Élő megértés, élő magyar beszélgetés, következtetés-motorok | ATL-WRK-0811–ATL-WRK-0814 | élő értékelés költségkerete |
| 8 | Memória: egységes vezérlés, tartósság, rögzítés, embedding, kontextus | ATL-WRK-0815–ATL-WRK-0819 | memória-policy, embedding-aktiválás |
| 9 | Hang (a böngészős kör párhuzamosan indítható a 4. lépés után): híd, tulajdonosi hangteszt, szolgáltatók | ATL-WRK-0820–ATL-WRK-0823 | hangteszt (ATL-DEC-0006), adatvédelem |
| 10 | Érzelem, stílus, kreatív szándék, kifejezési szabályzat | ATL-WRK-0824–ATL-WRK-0829 | szabályzat jóváhagyása |
| 11 | Önálló munka: keret, tool-use, sandbox, újratervezés, verifier, javítási kör, runtime-hostolás, első felügyelt futás | ATL-WRK-0830–ATL-WRK-0837 | autonómia-szint, kiadás |
| 12 | Minden modul rákötése, UI, telemetria, végponti teszt, kiadási kapu, záró elfogadás | ATL-WRK-0839–ATL-WRK-0846 | futó rendszer módosítása |

Az 1–5. lépés **teljesen offline**: nincs költség, nincs külső szolgáltatás; csak a fejlesztés-indítás ATL-számonkénti jóváhagyása kell. Az első külső lépés a 6.

## 6. Egységes intelligencia-réteg: hogyan lesz a Brain az egész ATLASZ közös agya

A cél nem egy új, különálló chatbot: a **Brain Gateway** (egy API, egy megosztott állapot) a meglévő module-brokerre épül, így minden fogyasztó ugyanazokat a jogosultsági, audit- és kill-switch-szabályokat kapja. A modell kimenete **soha nem ad jogosultságot**: a végrehajtás kapuja mindig a meglévő whitelist / governance / aláírt jóváhagyás. Fogyasztói térkép (`brain_integration_map.csv`):

| Fogyasztó | Mai kapcsolat a Brainhez | Cél | Munka |
|---|---|---|---|
| aurora (ATL-AUR-0002) | NINCS: aurora.respond a Brain-t nem hívja (csak human-core) | Brain Gateway konzultáció + közös beszélgetési út | ATL-WRK-0798; ATL-WRK-0797 |
| POST /api/chat (ATL-API-0089) | NINCS: core.chat → master-brief.answerQuery (4 regex) | Brain Gateway (understand/consult) | ATL-WRK-0798 |
| POST /api/aurora/utterance (ATL-API-0058) | NINCS: közvetlen auroraRespond | Brain Gateway | ATL-WRK-0798; ATL-WRK-0820 |
| POST /api/brain/command (ATL-API-0065) | REGEX whitelist (owner-command) | Szándékfelismerő motor + whitelist végrehajtási kapu | ATL-WRK-0796 |
| brain-master-bridge (ATL-BRN-0001) | API-only (agents30/action), UI nincs, kész planId kell | Szöveg → terv → futás a Gatewayen és UI-n | ATL-WRK-0807; ATL-WRK-0842 |
| agent-workforce (ATL-AGT-0040) | NINCS: csak CC-ben hostolt, Brain-t nem kérdezi | Gateway-konzultáció, runtime-hostolás | ATL-WRK-0836; ATL-WRK-0839 |
| master-coordinator (ATL-BRN-0025) | Felügyeleti tick; Brain csak infrastruktúra | Gateway-n át terv/tanács | ATL-WRK-0839 |
| atlasz-runtime/supervisor-safe.mjs (ATL-OPS-0034) | INFRASTRUKTÚRA: security/blackBox/dispatch, külön Brain-példány | Egyetlen megosztott Brain | ATL-WRK-0786; ATL-WRK-0836 |
| business/money-engine (ATL-FIN-0005) | INFRASTRUKTÚRA: dispatch + memory.recordOutcome | Brain-javaslat (pénzügyi jogosultság változatlan) | ATL-WRK-0840 |
| global-discovery (ATL-RES-0006) | NINCS Brain-konzultáció (opportunity-intelligence csak szűr) | Brain-javaslat felderítéshez (élő forrás tiltva) | ATL-WRK-0840 |
| campaign-manager (ATL-BRN-0017) | NINCS | Brain-javaslat | ATL-WRK-0840 |
| workbench (ATL-PLG-0008) | conversation.complete → NO_ELIGIBLE_PROVIDER | Gateway | ATL-WRK-0841 |
| translation-feedback (ATL-DOC-0007) | MODEL_NOT_CONFIGURED adapter nélkül | Gateway modell-út | ATL-WRK-0841 |
| code-edit-workflow (ATL-DEV-0003) | Önálló; modell nem ír szerkesztést | Brain-javaslat → átnézés → jóváhagyás | ATL-WRK-0835; ATL-WRK-0841 |
| voice-conversation (ATL-VOI-0001) | Mock szolgáltatók; böngészős hang megkerüli | Hang → Gateway | ATL-WRK-0820 |
| brain/memory-fabric (ATL-MEM-0002) | write-mostly | Olvasás a Context Builderbe | ATL-WRK-0819; ATL-WRK-0790 |
| atlasz-control-center/memory-panel.mjs (ATL-UIX-0004) | tár-szintű vezérlők | Egységes memória-vezérlés | ATL-WRK-0815 |
| atlasz-control-center/public/app.js (ATL-UIX-0008) | Aurora/chat/hang szabályos út | Egységes Brain UI | ATL-WRK-0842; ATL-WRK-0798 |

## 7. Tulajdonosi jóváhagyási kapuk (semmi nem indul el nélkülük)

| Azonosító | Kapu | Eredet |
|---|---|---|
| ATL-DEC-0058 | Fejlesztés-indítás ATL-számonként: minden WRK végrehajtása előtt külön tulajdonosi jóváhagyás (a terv elfogadása nem engedélyez kódmódosítást) | új |
| ATL-DEC-0059 | Első élő modell-szolgáltató kiválasztása (helyi Ollama vs. felhő), fiók létrehozása és API-kulcs megadása a vaultba | új |
| ATL-DEC-0060 | Modell-költségplafon összege (havi és kérésenkénti) - aláírt MODEL_SPEND_CAP_SET; fizetős API-használat engedélye | új |
| ATL-DEC-0061 | Helyi (offline) modell telepítése/letöltése (Ollama, modellfájlok, erőforrás-használat) | új |
| ATL-DEC-0062 | Élő értékelő/benchmark futtatás költségkerete és engedélye | új |
| ATL-DEC-0063 | Beszélgetés-memória rögzítési és megőrzési policy: mit szabad rögzíteni, meddig, milyen hozzájárulással | új |
| ATL-DEC-0064 | Többnyelvű embedding-modell aktiválása / letöltése (helyi, loopback) | új |
| ATL-DEC-0065 | Hang-szolgáltató és adatvédelem: felhős STT/TTS hangot küld külső félnek; böngésző-natív STT adatkezelése | új |
| ATL-DEC-0066 | Érzelemkifejezési szabályzat jóváhagyása (megengedett/tiltott kifejezések HU+EN) | új |
| ATL-DEC-0067 | Autonómia-szint (A0/A1/A2) jóváhagyása és az első felügyelt önálló futás engedélye | új |
| ATL-DEC-0068 | A működő rendszer módosítása: a Brain beültetése (shadow → advisory → active), visszaállítási terv | új |
| ATL-DEC-0001 | Tulajdonosi kulcs (owner-key) kiadása / provisionálása és aláírt jóváhagyások | meglévő |
| ATL-DEC-0002 | Egress-policy és host/hoszt jóváhagyás aláírása | meglévő |
| ATL-DEC-0003 | Modell-engedélyezés (MODEL_ENABLE) és költségkeret / költés jóváhagyása | meglévő |
| ATL-DEC-0006 | Hangteszt (TTS/STT) jóváhagyása | meglévő |

Minden feladat első kapuja a **fejlesztés-indítás ATL-számonként** (ATL-DEC-0058): ennek a tervnek az elfogadása **nem** engedélyez kódmódosítást. Éles modellbekötés, fizetős API, külső szolgáltatás, kiadás vagy a működő rendszer módosítása előtt a fenti kapuk külön aláírása szükséges.

## 8. Kockázatok és nyitott kérdések

- **Első modell:** helyi (Ollama: nincs API-költség, de telepítés + hardver kell, a magyar minőség **nincs mérve**) vagy felhős (költség, kulcs, adatvédelem). A döntés a tiéd; javaslat: előbb az offline fázisok és a magyar benchmark (ATL-WRK-0805), az élő költségplafon induljon a legkisebb értéken. A tényleges költség **ISMERETLEN** – nem nulla.
- **Magyar minőség** modellenként nincs bizonyítva; a ATL-WRK-0795/ATL-WRK-0805/ATL-WRK-0810 mérés dönti el, melyik modell használható.
- **Böngészős beszédfelismerés** (Chrome/Edge) a hangot felhőbe küldheti – adatvédelmi tájékoztató és döntés kell (ATL-WRK-0823).
- **Érzelem:** a rendszer természetesen kifejezhet hangulatot, de emberi érzelem birtoklását nem állíthatja; a védelem ma csak a sablonokat fedi, a modell-kimenetre és a magyar parafrázisokra ki kell terjeszteni (ATL-WRK-0803, ATL-WRK-0826).
- **Autonómia:** alapérték A0 (csak javasol); szintet csak te emelhetsz; a javítási kör automatikus alkalmazása tilos.
- **Futó rendszer:** a Brain beültetése a működő rendszerbe fokozatos (shadow → advisory → active), visszaállítási tervvel (ATL-WRK-0845).
- **Becslések:** az órák tervezési becslések (±40%), nem mért értékek; a vizsgálat öt független, csak olvasó elemzésre épül, a kulcsállítások kódból újraellenőrizve; ahol nem vizsgáltam, ISMERETLEN-nek jelöltem.

## 9. Új ATL-azonosítók (a meglévőket nem számoztam át, duplikátum nincs)

| Kategória | Tartomány | Megjegyzés |
|---|---|---|
| ATL-PLN (tervezett modul) | ATL-PLN-0098 … ATL-PLN-0118 (21 db) | tervezett – még NEM létezik |
| ATL-WRK (munkafeladat) | ATL-WRK-0785 … ATL-WRK-0846 (62 db) | a fenti munkaterv |
| ATL-DEC (jóváhagyási kapu) | ATL-DEC-0058 … ATL-DEC-0068 (11 db) | + a meglévő ATL-DEC-0001/0002/0003/0006 felhasználva |

A 21 új tervezett modul közül több a meglévő tervezett modulokat **magába foglalja/bővíti** (ATL-PLN-0001, 0002, 0009, 0020, 0076, 0077), ezeket nem duplikáltam; a feladatoknál `also_planned_module_ids` jelöli. Az 1 047 elemes rendszerleltár (SQLite/JSON) **változatlan**; a Brain-program saját táblákban van (`brain_program.sqlite`), a következő leltár-frissítéskor olvasható be.

| Modul | Azonosító | Fajta | Feladatok |
|---|---|---|---|
| Brain Gateway szolgáltatás: egyetlen megosztott Brain-példány és közös belépési pont (consult/u | ATL-PLN-0098 | NEW | 0785, 0786, 0789, 0792, 0793, 0839, 0840, 0841, 0845 |
| Brain Context Builder és prompt-könyvtár: memória + élő rendszerállapot + preferenciák + person | ATL-PLN-0099 | NEW | 0790, 0791, 0819 |
| Modell-gateway egységes bekötése: a Control Center / runtime / ügynök gateway-ek a registry-lán | ATL-PLN-0100 | EXTEND | 0800, 0808, 0809 |
| Szolgáltató-adapter bővítés: system prompt + előzmény, streaming, tool-calling, strukturált kim | ATL-PLN-0101 | EXTEND | 0801, 0802, 0804, 0806 |
| Szövegértés / szándékfelismerő motor: séma-kötött szándék + entitás + bizonytalanság; modellala | ATL-PLN-0102 | NEW | 0796, 0811 |
| Magyar nyelvi csomag: nyelvfelismerés, ékezet-normalizálás, stopszavak, szuffixum-/tőillesztés  | ATL-PLN-0103 | NEW | 0794 |
| Többfordulós beszélgetés-vezérlő: előzmény, összegzés, utalás-feloldás, tisztázó kérdések; Auro | ATL-PLN-0104 | NEW | 0797, 0798, 0812 |
| Következtetés- és terv-híd: goal-planner / decision-analysis / debate / multi-solution a Brain  | ATL-PLN-0105 | NEW | 0807, 0813 |
| Ügynök-végrehajtási ciklus: modellvezérelt tool-use (megfigyel-gondol-cselekszik-ellenőriz), sa | ATL-PLN-0106 | NEW | 0831, 0832, 0836, 0838 |
| Önellenőrzés és javítás: bizonyíték-alapú verifier, valódi újratervezés, hiba → ok → javítási j | ATL-PLN-0107 | NEW | 0833, 0834, 0835 |
| Futásonkénti keretező: lépés, idő, token, költség; autonómia-szintek (A0/A1/A2); leállás és jel | ATL-PLN-0108 | NEW | 0830, 0837 |
| Hang-Brain híd: az AURÓRA böngészős hangja a szerver-oldali beszélgetés-stacken és a Brain Gate | ATL-PLN-0109 | NEW | 0820, 0822, 0823 |
| STT/TTS szolgáltató-adapterek (böngésző-natív, helyi offline, felhő) probe-bizonyítékkal, magya | ATL-PLN-0110 | NEW | 0821, 0827 |
| Érzelem-, hangulat- és beszédstílus-felismerő motor (szöveg + opcionális prozódia), több fordul | ATL-PLN-0111 | NEW | 0799, 0824, 0825 |
| Érzelemkifejezés-szabályzat és kimeneti védelem: természetes kifejezés, emberi érzelem birtoklá | ATL-PLN-0112 | NEW | 0803, 0826, 0828 |
| Egységes memória-vezérlés: globális be/ki, scope, megőrzés, export, felejtés, 'emlékezz erre' m | ATL-PLN-0113 | NEW | 0815 |
| Beszélgetés → memória rögzítés tulajdonosi hozzájárulással, összegzéssel, titok-szűréssel, viss | ATL-PLN-0114 | NEW | 0817 |
| Memória-tartósság és többnyelvű embedding: a nem tartós tárak tartóssá tétele; embedding-aktivá | ATL-PLN-0115 | EXTEND | 0816, 0818 |
| Brain értékelő keret: magyar arany-korpusz, fake és élő üzemmód, küszöbök, fixture ≠ élő jelölé | ATL-PLN-0116 | NEW | 0787, 0788, 0795, 0805, 0810, 0814, 0829, 0844, 0846 |
| Brain / AURÓRA egységes felület: beszélgetés, brainWorkflow indítás (ma nincs UI), terv- és biz | ATL-PLN-0117 | EXTEND | 0842 |
| Brain telemetria: késleltetés, token, költség, hibaarány, visszaesés-arány, minőségi mutatók | ATL-PLN-0118 | NEW | 0843 |

## 10. Érvényesítés

15 ellenőrzés, sikeres: 15, hiba: 0.

- ✔ A korábbi (git HEAD) ledger minden bejegyzésének azonosítója és kulcsa változatlan
- ✔ Az új azonosítók egyediek és nem ütköznek a leltárral/ledgerrel
- ✔ A leltár 1 047 elemes és érintetlen (950 meglévő + 97 tervezett)
- ✔ Minden munkafeladatnak van meglévő ATL-komponens-kapcsolata és tervezett modulja
- ✔ A függőségek körmentesek és létező azonosítókra mutatnak
- ✔ Mind a 10 képességhez tartozik munkafeladat
- ✔ Minden munkafeladatnak van elfogadási kritériuma és legalább egy tesztje
- ✔ Minden feladat a 'fejlesztés-indítás ATL-számonként' jóváhagyás mögött áll
- ✔ Minden ÉLŐ szintű teszt mögött a megfelelő tulajdonosi kapu áll (modell/költség/hang/autonómia/kiadás)
- ✔ Az élő modell-bekötés feladatai legalább 3 kaput igényelnek (kulcs, egress, költség/engedély)
- ✔ Nincs fizetős/élő/külső művelet kapu nélkül (ext kitöltött → van nem-impl kapu)
- ✔ Minden tervezett modul ('PLANNED*') nem létezőként van jelölve, és van legalább egy feladata
- ✔ Minden integrációs fogyasztónak van munkafeladata
- ✔ A hivatkozott meglévő tervezett modulok léteznek (adopts/also_pln)
- ✔ Csak docs/ alatti fájl változott (futó kód nem módosult)

## 11. Fájlok (`docs/brain_program/`)

- `BRAIN_PROGRAM_JELENTES.md` – ez a jelentés
- `brain_work_plan.csv` – számozott munkaterv (62 feladat, függőségek, kapuk, tesztek)
- `brain_capabilities.csv` – 10 képesség állapota
- `brain_modules_assessment.csv` – meglévő modulok valós állapota
- `brain_new_modules.csv` – 21 új tervezett modul
- `brain_approval_gates.csv` – jóváhagyási kapuk
- `brain_test_plan.csv` – teszt-terv
- `brain_integration_map.csv` – fogyasztói térkép
- `brain_program.sqlite` – minden tábla + kapcsolatok
- `validation_report.json` – érvényesítés
