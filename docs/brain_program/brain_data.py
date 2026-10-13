# -*- coding: utf-8 -*-
"""BRAIN program: declarative data (RECORDS ONLY - no running code is touched). Components are referenced by inventory name or ATL id."""

PHASES = {
 "F0": "Alapozás, specifikáció, tesztinfrastruktúra (nincs külső szolgáltatás)",
 "F1": "Brain Gateway és megosztott kontextus (offline, fake modell-adapterrel)",
 "F2": "Magyar nyelv, szövegértés, többfordulós beszélgetés (offline)",
 "F3": "Modell-réteg és terv-híd előkészítése (fake transport, nincs költség)",
 "F4": "ELSŐ ÉLŐ MODELL-BEKÖTÉS (tulajdonosi kapuk)",
 "F5": "Élő megértés, következtetés, beszélgetés + értékelés",
 "F6": "Tartós, szabályozható memória",
 "F7": "Hallás és beszéd (magyar)",
 "F8": "Érzelem, stílus, kreatív szándék; érzelemkifejezés állítás nélkül",
 "F9": "Önálló feladatvégzés tulajdonosi felügyelettel",
 "F10": "Egységes intelligenciaréteg: minden modul rákötése, UI, telemetria, kiadás, végső elfogadás",
}

CAPS = {
 1: "Központi AI-agy, működő AI-modellkapcsolatokkal",
 2: "Valódi szövegértés, szándékfelismerés és kontextuskezelés",
 3: "Következtetés, tervezés és összetett problémamegoldás",
 4: "Természetes, többfordulós magyar nyelvű beszélgetés",
 5: "Mikrofonos beszédfelismerés és hallás",
 6: "Természetes magyar nyelvű hangos válasz",
 7: "Érzelmi hangulat, beszédstílus és kreatív szándék felismerése",
 8: "Érzelmek természetes kifejezése beszédben és kreatív munkában, emberi érzelem birtoklásának állítása nélkül",
 9: "Tartós, szabályozható memória és beszélgetési kontextus",
 10: "Önálló feladattervezés, végrehajtás, önellenőrzés és hibajavítás, tulajdonosi felügyelettel",
}

# ---- planned modules (NEW ATL-PLN). adopts = existing ATL-PLN that this module includes/extends (no duplication of those)
PLNS = [
 ("brain-gateway-service", "NEW", "Brain Gateway szolgáltatás: egyetlen megosztott Brain-példány és közös belépési pont (consult/understand/plan/act) a Control Center, a runtime, az AURÓRA, az ügynökök és a munkafolyamatok számára", []),
 ("brain-context-builder", "NEW", "Brain Context Builder és prompt-könyvtár: memória + élő rendszerállapot + preferenciák + persona kérésenkénti összeállítása, verziózott rendszerpromptok", []),
 ("model-gateway-wiring", "EXTEND", "Modell-gateway egységes bekötése: a Control Center / runtime / ügynök gateway-ek a registry-lánchoz (jelenleg szolgáltató nélkül működnek)", []),
 ("model-live-adapter-layer", "EXTEND", "Szolgáltató-adapter bővítés: system prompt + előzmény, streaming, tool-calling, strukturált kimenet, retry/backoff, bemenet/kimenet szerinti árazás és token-számlálás", ["ATL-PLN-0076"]),
 ("understanding-engine", "NEW", "Szövegértés / szándékfelismerő motor: séma-kötött szándék + entitás + bizonytalanság; modellalapú útvonal szabályos visszaesés mellett; a modell sosem ad jogosultságot", []),
 ("hungarian-language-pack", "NEW", "Magyar nyelvi csomag: nyelvfelismerés, ékezet-normalizálás, stopszavak, szuffixum-/tőillesztés az intent- és memória-rétegben", []),
 ("conversation-orchestrator", "NEW", "Többfordulós beszélgetés-vezérlő: előzmény, összegzés, utalás-feloldás, tisztázó kérdések; Aurora és chat egyesítése", ["ATL-PLN-0001"]),
 ("reasoning-plan-bridge", "NEW", "Következtetés- és terv-híd: goal-planner / decision-analysis / debate / multi-solution a Brain Gateway-en; közös terv-séma goal-planner → planning-brain → orchestrator → verifier", []),
 ("agent-execution-loop", "NEW", "Ügynök-végrehajtási ciklus: modellvezérelt tool-use (megfigyel-gondol-cselekszik-ellenőriz), sandbox munkaterület, a 30 ügynök hostolása a runtime-ban", []),
 ("self-check-repair-loop", "NEW", "Önellenőrzés és javítás: bizonyíték-alapú verifier, valódi újratervezés, hiba → ok → javítási javaslat → jóváhagyás → teszt → visszagörgetés", []),
 ("run-budget-governor", "NEW", "Futásonkénti keretező: lépés, idő, token, költség; autonómia-szintek (A0/A1/A2); leállás és jelentés túllépéskor", []),
 ("voice-brain-bridge", "NEW", "Hang-Brain híd: az AURÓRA böngészős hangja a szerver-oldali beszélgetés-stacken és a Brain Gateway-en át; push-to-talk; nyelvváltás STT/TTS-re", []),
 ("voice-provider-adapters", "NEW", "STT/TTS szolgáltató-adapterek (böngésző-natív, helyi offline, felhő) probe-bizonyítékkal, magyar hang-választással, VAD-del", []),
 ("speech-style-emotion-engine", "NEW", "Érzelem-, hangulat- és beszédstílus-felismerő motor (szöveg + opcionális prozódia), több fordulós hangulat-követés", ["ATL-PLN-0002", "ATL-PLN-0020"]),
 ("emotion-expression-guard", "NEW", "Érzelemkifejezés-szabályzat és kimeneti védelem: természetes kifejezés, emberi érzelem birtoklásának állítása nélkül (HU+EN minta-katalógus, modell-kimenetre is)", []),
 ("unified-memory-controls", "NEW", "Egységes memória-vezérlés: globális be/ki, scope, megőrzés, export, felejtés, 'emlékezz erre' minden tárra", ["ATL-PLN-0009"]),
 ("conversation-memory-capture", "NEW", "Beszélgetés → memória rögzítés tulajdonosi hozzájárulással, összegzéssel, titok-szűréssel, visszahívással a kontextusba", []),
 ("memory-durability-embeddings", "EXTEND", "Memória-tartósság és többnyelvű embedding: a nem tartós tárak tartóssá tétele; embedding-aktiválás; magyar retrieval-eval", []),
 ("brain-evaluation-harness", "NEW", "Brain értékelő keret: magyar arany-korpusz, fake és élő üzemmód, küszöbök, fixture ≠ élő jelölés", ["ATL-PLN-0077"]),
 ("brain-ui-surface", "EXTEND", "Brain / AURÓRA egységes felület: beszélgetés, brainWorkflow indítás (ma nincs UI), terv- és bizonyíték-nézet, jóváhagyás-kérések, állapotjelző", []),
 ("brain-telemetry", "NEW", "Brain telemetria: késleltetés, token, költség, hibaarány, visszaesés-arány, minőségi mutatók", []),
]

# ---- owner approval gates (NEW ATL-DEC). existing: ATL-DEC-0001 owner-key, 0002 egress, 0003 model-enable/budget, 0006 voice test
DECS = [
 ("impl-per-atl", "Fejlesztés-indítás ATL-számonként: minden WRK végrehajtása előtt külön tulajdonosi jóváhagyás (a terv elfogadása nem engedélyez kódmódosítást)"),
 ("live-provider-choice", "Első élő modell-szolgáltató kiválasztása (helyi Ollama vs. felhő), fiók létrehozása és API-kulcs megadása a vaultba"),
 ("spend-cap-amount", "Modell-költségplafon összege (havi és kérésenkénti) - aláírt MODEL_SPEND_CAP_SET; fizetős API-használat engedélye"),
 ("local-model-install", "Helyi (offline) modell telepítése/letöltése (Ollama, modellfájlok, erőforrás-használat)"),
 ("live-eval-budget", "Élő értékelő/benchmark futtatás költségkerete és engedélye"),
 ("memory-capture-policy", "Beszélgetés-memória rögzítési és megőrzési policy: mit szabad rögzíteni, meddig, milyen hozzájárulással"),
 ("embedding-activation", "Többnyelvű embedding-modell aktiválása / letöltése (helyi, loopback)"),
 ("voice-provider-privacy", "Hang-szolgáltató és adatvédelem: felhős STT/TTS hangot küld külső félnek; böngésző-natív STT adatkezelése"),
 ("emotion-policy-signoff", "Érzelemkifejezési szabályzat jóváhagyása (megengedett/tiltott kifejezések HU+EN)"),
 ("autonomy-level", "Autonómia-szint (A0/A1/A2) jóváhagyása és az első felügyelt önálló futás engedélye"),
 ("runtime-release", "A működő rendszer módosítása: a Brain beültetése (shadow → advisory → active), visszaállítási terv"),
]
EXIST_DEC = {"owner-key": "ATL-DEC-0001", "egress": "ATL-DEC-0002", "model-enable": "ATL-DEC-0003", "voice-test": "ATL-DEC-0006"}

# ---- tasks. fields: slug, phase, caps, title, work, comps, pln (new slug), also_pln (existing PLN ids), deps (task slugs or existing ATL-WRK ids), impl, ver, prio, gates (new dec slugs or existing keys), tests[(name,level,kind,criterion)], accept, ext
T = []
def t(slug, phase, caps, title, work, comps, pln, deps, impl, ver, prio, gates, tests, accept, ext="", also_pln=()):
    T.append(dict(slug=slug, phase=phase, caps=caps, title=title, work=work, comps=comps, pln=pln, also_pln=list(also_pln), deps=deps, impl=impl, ver=ver, prio=prio, gates=gates, tests=tests, accept=accept, ext=ext))

# ================= F0
t("b00-arch-spec", "F0", [1,2,3,10], "Brain architektúra-specifikáció és szerződések",
  "API-séma (consult/understand/plan/act), hibakódok, jogosultsági modell, 'modell nem hatóság' elv (a modell kimenete sosem ad jogosultságot/jóváhagyást), degradált mód, auditálhatóság; docs-only terv.",
  ["brain/central-brain", "module-broker", "brain/governance", "brain/brain-system", "brain-master-bridge"], "brain-gateway-service", [], 12, 4, "P1", [],
  [("brain-spec-review", "review", "dokumentum", "Tulajdonosi átnézés; minden szerződés-példa sémával validálva")], "Elfogadott specifikáció; minden későbbi WRK ehhez igazodik.")
t("b01-single-brain", "F0", [1,10], "Egyetlen megosztott Brain-példány (Control Center + runtime)",
  "A két különálló Brain-példány (core.mjs:945 és supervisor-safe.mjs:127, külön könyvtárak) egyesítése közös állapotmappán/zárral és loopback API-val, hogy a Control Center lássa a runtime feladatait.",
  ["brain/brain-system", "atlasz-control-center/core.mjs", "atlasz-runtime/supervisor-safe.mjs", "durable-queue", "file-lock"], "brain-gateway-service", ["b00-arch-spec", "ATL-WRK-0003", "ATL-WRK-0004", "ATL-WRK-0005"], 20, 10, "P1", ["impl-per-atl", "runtime-release"],
  [("brain-single-instance.test", "integration", "fixture (2 folyamat)", "Két folyamat ugyanazt az állapotot látja; zár nélküli írás nincs; kétpéldányos teszt zöld")], "Egy Brain-állapot, bizonyítottan konzisztens két folyamat között.")
t("b02-fake-adapters-fixtures", "F0", [1,2,4], "Tesztinfrastruktúra: determinisztikus fake modell-adapter család és fixture-jelölés",
  "Szkriptelt, tükör, hibainjektáló és lassú fake adapterek; kötelező 'FIXTURE' jelölés minden eredményen (fixture ≠ élő); magyar arany-korpusz váz.",
  ["model-gateway", "provider-adapters", "regression-eval-suite", "reasoning-common"], "brain-evaluation-harness", [], 14, 6, "P1", [],
  [("fake-adapters.test", "unit", "fixture", "Minden fake adapter jelölt; élőként soha nem jelenik meg")], "Újrahasznosítható fake adapterek, amelyek nem keverhetők élő bizonyítékkal.")
t("b03-threat-model", "F0", [1,2,8,10], "Brain fenyegetésmodell és negatív teszt-készlet",
  "Prompt-injekció (adat ≠ utasítás), jogosultság-emelés modell-kimeneten át, adatszivárgás, költség-kimerítés, hamis érzelem-állítás, memória-mérgezés; támadás-mintatár és elvárt védelem.",
  ["brain/security-brain", "guardrail-engine", "agent-tool-policy", "secret-patterns", "egress-policy"], "brain-evaluation-harness", ["b00-arch-spec"], 14, 12, "P1", [],
  [("brain-threat-negative.test", "negative", "fixture", "Minden dokumentált támadás blokkolva vagy eszkalálva")], "Tételes fenyegetés-lista és hozzá tartozó negatív tesztek.")

# ================= F1
t("b10-gateway-api", "F1", [1,2,3,10], "Brain Gateway API (consult/understand/plan/act) a module-brokeren át",
  "Egyetlen típusos, auditált, jogosultság-ellenőrzött belépési pont; a meglévő module-broker tool-regisztrációra épül; fake adapterrel teljesen tesztelhető.",
  ["module-broker", "brain/central-brain", "registrations/brain", "brain/governance", "brain/brain-system"], "brain-gateway-service", ["b00-arch-spec", "b01-single-brain"], 28, 12, "P1", ["impl-per-atl"],
  [("brain-gateway.test", "integration", "fixture", "consult/plan/act sémahelyes; jogosultság nélküli hívás elutasítva; minden hívás audit-láncban")], "Minden fogyasztó egy API-n át kérhet Brain-szolgáltatást.")
t("b11-context-builder", "F1", [2,4,9], "Brain Context Builder",
  "Kérésenként: releváns memória + élő rendszerállapot + preferenciák + persona + jogosultsági kontextus; adatminimalizálás, titokszűrés, forrásjelölés, token-keret.",
  ["context-manager", "brain/memory-fabric", "preferences", "assistant-profiles", "master-brief", "brain/knowledge-brain"], "brain-context-builder", ["b10-gateway-api"], 24, 10, "P1", ["impl-per-atl"],
  [("context-builder.test", "unit+integration", "fixture", "Titok sosem kerül a kontextusba; keret betartva; minden elemnek forrása van")], "Reprodukálható, auditált kontextus-csomag minden Brain-híváshoz.")
t("b12-prompt-library", "F1", [1,2,4], "Prompt-könyvtár és rendszerprompt-verziózás",
  "Szerepek, séma-kötött kimenet, injekció-védelem, magyar alapértelmezés; hash-elt, verziózott, auditált promptok; változtatás csak jóváhagyással.",
  ["conversation", "reasoning-common", "secret-patterns", "brain/central-brain"], "brain-context-builder", ["b10-gateway-api"], 14, 6, "P2", ["impl-per-atl"],
  [("prompt-library.test", "unit", "fixture", "Verzió/hash változás naplózott; jóváhagyatlan prompt nem tölthető be")], "Verziózott prompt-készlet változásnaplóval.")
t("b13-degraded-mode", "F1", [1,2], "Degradált (modell nélküli) üzemmód egyértelmű jelzéssel",
  "Ha nincs LIVE modell, a Brain szabályalapú válasszal él és kiírja: 'MODELL NINCS BEKÖTVE'; soha nem állít élő intelligenciát.",
  ["master-brief", "brain/owner-command", "brain/central-brain", "model-gateway"], "brain-gateway-service", ["b10-gateway-api"], 10, 5, "P2", [],
  [("degraded-mode.test", "integration", "fixture", "Modell nélkül mindig jelzett; hamis 'élő' állapot lehetetlen")], "Őszinte állapotjelzés minden felületen.")
t("b14-bus-subscribers", "F1", [3,10], "Brain-busz előfizetők bekötése",
  "A 11 al-agy közti eseményvezérelt koordináció (ma nincs előfizető) hurokvédelemmel és ACL-lel.",
  ["brain/central-brain", "brain/capability-graph", "brain/orchestrator", "brain/planning-brain", "brain/verifier", "brain/knowledge-brain"], "brain-gateway-service", ["b10-gateway-api"], 16, 8, "P3", ["impl-per-atl"],
  [("brain-bus-subscribers.test", "integration", "fixture", "Esemény-lánc lefut; hurok és tiltott téma blokkolva")], "A busz tényleges koordinációt végez, nem csak definíció.")

# ================= F2
t("b20-hu-language-pack", "F2", [2,4,9], "Magyar nyelvi csomag",
  "Nyelvfelismerés, ékezet-normalizálás (az Aurora és a memória keresése most nem hajtja végre), magyar stopszavak, szuffixum-/tőillesztés ('lehetőségeket' ↔ 'lehetőség'), egységes terms().",
  ["memory-store", "observation-memory", "knowledge-projects", "chunker", "aurora", "brain/owner-command"], "hungarian-language-pack", [], 22, 10, "P1", ["impl-per-atl"],
  [("hu-language-pack.test", "unit", "fixture (magyar korpusz)", "Ragozott/ékezetlen alakok találnak; hamis találat-arány a küszöb alatt")], "Magyar szövegre mérhetően jobb intent- és memória-találat.")
t("b21-hu-gold-corpus", "F2", [2,4,7,9], "Magyar arany-korpusz és mérőszámok",
  "≥300 eset: szándék, érzelem, memória-visszakeresés, többfordulós párbeszéd, tiltott állítások; elfogadási küszöbök; fixture és élő üzemmód külön.",
  ["retrieval-eval", "human-core", "aurora"], "brain-evaluation-harness", ["b02-fake-adapters-fixtures"], 18, 8, "P1", [],
  [("hu-corpus-integrity.test", "unit", "fixture", "Minden eset címkézett; nincs duplikált; küszöbök dokumentáltak")], "Mérhető magyar minőségi alap.")
t("b22-understanding-engine", "F2", [2,3], "Szövegértés / szándékfelismerő motor",
  "Séma-kötött JSON szándék + entitás + bizonytalanság; modellalapú útvonal (fake adapterrel tesztelhető) és szabályos visszaesés; az owner-command whitelist a végrehajtás kapuja marad (a modell nem ad jogosultságot).",
  ["brain/owner-command", "aurora", "master-brief", "human-core", "brain/central-brain"], "understanding-engine", ["b10-gateway-api", "b12-prompt-library", "b20-hu-language-pack"], 30, 14, "P1", ["impl-per-atl"],
  [("understanding-engine.test", "unit+negative", "fixture", "Séma-hibás/idegen kimenet elutasítva; parafrázis és ékezet nélküli szöveg helyesen osztályozva; jogosultság-kérés sosem teljesül")], "Szabadszöveg → ellenőrzött szándék-struktúra.")
t("b23-conversation-orchestrator", "F2", [2,4,9], "Többfordulós beszélgetés-vezérlő",
  "Előzmény-kezelés, régi fordulók összegzése (ma csak eldobás), utalás-/követő-kérdés feloldás, tisztázó kérdés-politika; a conversation.mjs tároló tényleges használata.",
  ["conversation", "context-manager", "aurora", "atlasz-control-center/core.mjs"], "conversation-orchestrator", ["b11-context-builder", "b22-understanding-engine"], 32, 14, "P1", ["impl-per-atl"],
  [("conversation-orchestrator.test", "integration", "fixture", "3+ fordulós párbeszéd: utalás feloldva, összegzés megőrzi a lényeget, titok nem kerül elő")], "Valódi többfordulós állapot, nem független utterance-ek.", also_pln=["ATL-PLN-0001"])
t("b24-chat-aurora-unify", "F2", [2,4], "AURÓRA és főoldali chat egyesítése egy beszélgetési úttá",
  "Ma két külön szabályos út van (aurora.respond és master-brief.answerQuery); egyesítés a Gatewayre, régi viselkedés regressziómentes megőrzésével.",
  ["aurora", "master-brief", "atlasz-control-center/core.mjs", "atlasz-control-center/public/app.js", "POST /api/chat", "POST /api/aurora/utterance"], "conversation-orchestrator", ["b23-conversation-orchestrator"], 18, 8, "P1", ["impl-per-atl", "runtime-release"],
  [("chat-aurora-unified.test", "integration", "fixture", "Mindkét UI-út ugyanazt a Brain-utat használja; a meglévő aurora/chat tesztek zöldek")], "Egy beszélgetési út, nincs két szabály-rendszer.")
t("b25-hu-persona", "F2", [4,7,8], "AURÓRA magyar persona és beszédstílus-beállítások",
  "Tegezés/magázás, tömörség, hangnem, tulajdonos-szerkeszthető profilok; a persona nem állíthat emberi érzést (lásd b33/b82).",
  ["assistant-profiles", "preferences", "aurora"], "speech-style-emotion-engine", ["b22-understanding-engine"], 10, 4, "P2", ["impl-per-atl"],
  [("hu-persona.test", "unit", "fixture", "Beállítások érvényesülnek; tiltott állítás nem generálható")], "Szerkeszthető magyar persona.", also_pln=["ATL-PLN-0002"])

# ================= F3
t("b30-gateway-wiring", "F3", [1], "Modell-gateway egységes bekötése",
  "A Control Center és a runtime gateway ma szolgáltató nélkül működik (NO_ELIGIBLE_PROVIDER); a registry-lánc (registry → egress → resilience → adapter) egységes használata; agent-tool-policy 'model.complete' engedélyezési útvonal (alapból tiltva).",
  ["model-gateway", "model-registry", "provider-resilience", "provider-egress", "agent-tool-policy", "atlasz-control-center/core.mjs", "atlasz-runtime/supervisor-safe.mjs"], "model-gateway-wiring", ["b10-gateway-api"], 22, 10, "P1", ["impl-per-atl", "runtime-release"],
  [("gateway-wiring.test", "integration", "fixture (fake transport)", "Regisztrált fake szolgáltatón át megy a hívás; nem-LIVE szolgáltató soha nem kap forgalmat")], "Egy modell-út minden fogyasztónak, továbbra is alapból tiltott/költségmentes.")
t("b31-adapter-capabilities", "F3", [1,3], "Szolgáltató-adapterek bővítése",
  "System prompt + előzmény, streaming (SSE), tool-calling, strukturált (JSON-séma) kimenet, retry/backoff+jitter; csak fake transporttal tesztelve.",
  ["provider-adapters", "model-routing-bridge", "provider-resilience"], "model-live-adapter-layer", ["b30-gateway-wiring"], 40, 18, "P1", ["impl-per-atl"],
  [("adapter-capabilities.test", "unit+contract", "fixture (fake transport)", "Szolgáltatónként hullámforma-szerződés; streaming megszakítható; retry nem duplikál költséget")], "Éles bekötésre kész, de még nem élő adapter-réteg.")
t("b32-token-cost", "F3", [1,10], "Token- és költségszámlálás",
  "Bemenet/kimenet szerinti árazás (ma egyetlen ár/1k), futásonkénti és havi összesítés, 'ismeretlen költség sosem nulla', cache-ár opció.",
  ["model-registry", "cost-model-router", "effort-allocation"], "model-live-adapter-layer", ["b31-adapter-capabilities"], 16, 8, "P1", ["impl-per-atl"],
  [("token-cost.test", "unit", "fixture", "Összegek egyeznek a számlálóval; ismeretlen ár blokkol")], "Pontos, auditált költségszámlálás.", also_pln=["ATL-PLN-0076"])
t("b33-output-guard", "F3", [1,2,8], "Modell-kimenet védelem (injekció, titok, hamis érzelem-állítás)",
  "A modell kimenete is átmegy a szűrőn: injekció/titok, jogosultság-állítások eldobása, emberi érzelem birtoklásának állítása (HU+EN, parafrázis-álló) tiltva; karantén.",
  ["human-core", "guardrail-engine", "secret-patterns", "quarantine", "brain/security-brain"], "emotion-expression-guard", ["b03-threat-model", "b10-gateway-api"], 20, 10, "P1", ["impl-per-atl"],
  [("output-guard.test", "negative", "fixture", "Hamis-érzelem és injekciós minták (magyarul is, parafrázissal) blokkolva; engedélyezett kifejezés átmegy")], "Minden modell-kimenet védelmen át jut a felhasználóig.")
t("b34-model-routing-hu", "F3", [1,4], "Nyelv- és feladat-alapú modell-útválasztás",
  "Magyar minőségi küszöb, költségkeret, helyi vs. felhő, modell-profil metaadatok (rate-limit, régió, ÁSZF); csak mért bizonyíték alapján választ.",
  ["brain/model-intelligence", "cost-model-router", "model-registry", "model-evidence"], "model-live-adapter-layer", ["b31-adapter-capabilities", "b21-hu-gold-corpus"], 18, 8, "P2", ["impl-per-atl"],
  [("model-routing-hu.test", "unit", "fixture", "Mért adat nélkül nem választ; költségkeret betartva")], "Bizonyíték-alapú útválasztás.", also_pln=["ATL-PLN-0076", "ATL-PLN-0077"])
t("b35-model-benchmark-hu", "F3", [1,2,3,4], "Modell-értékelő készlet magyar feladatokkal",
  "Megértés, összefoglalás, tool-calling, biztonság, hallucináció, injekció-ellenállás; fake és élő üzemmód; élő futás csak külön jóváhagyással.",
  ["model-evolution", "model-evidence", "retrieval-eval"], "brain-evaluation-harness", ["b21-hu-gold-corpus", "b31-adapter-capabilities"], 24, 10, "P2", ["impl-per-atl"],
  [("model-benchmark-hu.test", "unit", "fixture", "Fake adapterrel determinisztikus pontszám; élő mód jóváhagyás nélkül nem indul")], "Újrafuttatható modell-összehasonlítás.", also_pln=["ATL-PLN-0077"])
t("b36-local-model-prep", "F3", [1], "Helyi (offline) modell-opció előkészítése",
  "Ollama-telepítési terv, modell-jelöltek magyar minőség szerint, erőforrás-igény, bizonyíték-folyamat; telepítés NEM történik jóváhagyás nélkül.",
  ["local-ai-manager", "model-routing-bridge"], "model-live-adapter-layer", [], 8, 4, "P2", ["local-model-install"],
  [("local-model-plan-review", "review", "dokumentum", "Tulajdonosi átnézés")], "Döntésre kész helyi-modell terv.")
t("b37-plan-schema-bridge", "F3", [3,10], "Közös terv-séma és híd (szöveg → cél → terv → feladat → ügynök)",
  "goal-planner kimenet → planning-brain → orchestrator.runPlan → verifier; ma nincs ilyen lánc, a goal-planner kimenetét senki nem fogyasztja; fake modellel tesztelhető.",
  ["goal-planner", "brain/planning-brain", "brain/orchestrator", "master-planner-orchestrator", "brain/governed-dispatch", "brain/verifier"], "reasoning-plan-bridge", ["b10-gateway-api", "b02-fake-adapters-fixtures"], 28, 12, "P1", ["impl-per-atl"],
  [("plan-schema-bridge.test", "integration", "fixture", "Szöveg-cél végig fut a lánc minden lépésén; hibás terv megáll és jelent")], "Folyamatos, auditált terv-lánc.")

# ================= F4 (live model gates)
t("b40-first-model-package", "F4", [1], "Első élő modell-bekötés jóváhagyási csomag",
  "Szolgáltató-választás indoklással (helyi vs. felhő), kockázat, költségplafon-javaslat, a runbook lépései (ATLASZ_VAULT_KEY, VAULT_SET, SPEND_CAP, MODEL_ENABLE, EGRESS_POLICY_SET) tulajdonosi aláírásra előkészítve.",
  ["owner-keystore", "secret-vault", "egress-policy", "model-registry", "provider-egress"], "model-gateway-wiring", ["b30-gateway-wiring", "b32-token-cost", "ATL-WRK-0590", "ATL-WRK-0591", "ATL-WRK-0592"], 6, 2, "P1", ["live-provider-choice", "spend-cap-amount", "owner-key", "egress", "model-enable"],
  [("first-model-package-review", "review", "dokumentum", "Tulajdonosi aláírás-lista teljes, költség-plafon megadva")], "Aláírásra kész csomag; semmi nem aktiválódik.", ext="szolgáltatói fiók, API-kulcs (tulajdonos)")
t("b41-first-live-connection", "F4", [1,2,3,4], "ELSŐ élő modellbekötés végrehajtása (csak jóváhagyás után)",
  "probe → kis költségű ask → bizonyíték-rögzítés; LIVE csak saját sikeres probe alapján; azonnali kill-switch próba; fixture ≠ élő jelölés.",
  ["atlasz-control-center/model-registry-panel.mjs", "model-gateway", "model-evidence", "model-registry", "provider-egress"], "model-gateway-wiring", ["b40-first-model-package", "b31-adapter-capabilities", "b33-output-guard"], 8, 10, "P1", ["live-provider-choice", "spend-cap-amount", "owner-key", "egress", "model-enable"],
  [("first-live-probe-evidence", "live-owner", "ÉLŐ (tulajdonos jóváhagyásával)", "Sikeres probe + 1 kis ask; költség ≤ plafon; kill-switch leállít")], "Legalább egy modell bizonyítottan LIVE a saját probe alapján.", ext="külső modell-szolgáltató (fizetős API vagy helyi Ollama)")
t("b42-live-hu-smoke", "F4", [1,2,3,4], "Élő modell magyar füstteszt és benchmark",
  "Költségkorlát alatt: megértés, tool-calling, strukturált kimenet, injekció-ellenállás; eredmény bizonyíték, nem feltevés.",
  ["model-evolution", "model-evidence"], "brain-evaluation-harness", ["b41-first-live-connection", "b35-model-benchmark-hu"], 8, 10, "P1", ["live-eval-budget"],
  [("live-hu-smoke-evidence", "live-owner", "ÉLŐ (tulajdonos jóváhagyásával)", "Küszöbök teljesülnek vagy a modell elutasítva/cserélve")], "Mért magyar minőség a kiválasztott modellről.")

# ================= F5
t("b50-live-understanding", "F5", [2], "Élő szándékfelismerés bekötése és mérése",
  "A b22 modellalapú útvonal élesítése; pontosság a magyar arany-korpuszon; küszöb alatt szabályos visszaesés.",
  ["brain/owner-command", "aurora", "master-brief"], "understanding-engine", ["b41-first-live-connection", "b22-understanding-engine", "b21-hu-gold-corpus"], 12, 12, "P1", ["impl-per-atl", "runtime-release"],
  [("live-understanding-eval", "eval", "ÉLŐ", "Pontosság ≥ elfogadott küszöb; jogosultság-kérés sosem teljesül")], "Mért, élő szövegértés.")
t("b51-live-conversation", "F5", [2,4], "Élő többfordulós magyar beszélgetés (AURÓRA + chat)",
  "Modellalapú összegzés és válasz; forrásjelölés; kimeneti védelem; tulajdonosi felülvizsgálat.",
  ["aurora", "conversation", "context-manager", "atlasz-control-center/public/app.js"], "conversation-orchestrator", ["b41-first-live-connection", "b24-chat-aurora-unify", "b33-output-guard"], 14, 14, "P1", ["impl-per-atl", "runtime-release"],
  [("live-conversation-eval", "eval+owner", "ÉLŐ", "Tulajdonos által értékelt magyar párbeszéd-forgatókönyvek; nincs jogosultság-szivárgás")], "Természetes magyar beszélgetés mért minőséggel.")
t("b52-reasoning-engines", "F5", [3], "Következtetés-motorok élesítése a Brain Gateway-en",
  "goal-planner, decision-analysis, debate-protocol, multi-solution modellel (ma MODEL_NOT_CONFIGURED); függetlenségi szabály (különböző modell-család); költségkeret.",
  ["goal-planner", "decision-analysis", "debate-protocol", "multi-solution", "reasoning-common"], "reasoning-plan-bridge", ["b41-first-live-connection", "b37-plan-schema-bridge"], 22, 12, "P1", ["impl-per-atl", "live-eval-budget", "spend-cap-amount"],
  [("reasoning-engines-live.test", "integration+eval", "ÉLŐ", "Különböző családok; költségkeret betartva; kimenet sémahelyes")], "Működő összetett problémamegoldás.")
t("b54-complex-eval", "F5", [3,10], "Összetett probléma-megoldás értékelése",
  "Többlépéses tervezés, ellentmondás-kezelés, 'nem tudom' kezelés, hallucináció-arány.",
  ["brain/verifier", "goal-planner", "decision-analysis"], "brain-evaluation-harness", ["b52-reasoning-engines", "b42-live-hu-smoke"], 10, 12, "P2", ["live-eval-budget"],
  [("complex-problem-eval", "eval", "ÉLŐ", "Küszöbök teljesülnek")], "Mért tervezési/megoldási minőség.")

# ================= F6
t("b60-unified-memory-controls", "F6", [9], "Egységes memória-vezérlés",
  "Globális be/ki, scope, megőrzés, export, felejtés, 'emlékezz erre / felejtsd el' parancs minden tárra; a memory-store export hiánya pótlása; audit.",
  ["memory-store", "observation-memory", "preferences", "project-memory", "agent-memory", "atlasz-control-center/memory-panel.mjs", "brain/memory-fabric"], "unified-memory-controls", ["b10-gateway-api"], 30, 14, "P1", ["impl-per-atl"],
  [("unified-memory-controls.test", "integration", "fixture", "Felejtés minden tárból eltávolít; export teljes; kikapcsolt memória nem rögzít")], "A tulajdonos mindent lát, exportál, töröl és ki/be kapcsol.", also_pln=["ATL-PLN-0009"])
t("b61-memory-durability", "F6", [9], "Nem tartós tárak tartóssá tétele",
  "business-memory, unified-entity-graph, experience-learning-engine: perzisztencia zárolt írással (D-05) és integritás-ellenőrzéssel.",
  ["business-memory", "unified-entity-graph", "experience-learning-engine", "brain/memory-fabric", "file-lock"], "memory-durability-embeddings", ["ATL-WRK-0005"], 16, 8, "P2", ["impl-per-atl"],
  [("memory-durability.test", "integration", "fixture", "Újraindítás után az adat megvan; sérült fájl észlelve")], "Újraindítást túlélő memória-rétegek.")
t("b62-memory-capture", "F6", [4,9], "Beszélgetés → memória rögzítés hozzájárulással",
  "Összegzett rögzítés tulajdonosi hozzájárulással, titok-szűréssel; visszahívás a Context Builderbe; tulajdonosi policy szerinti megőrzés.",
  ["observation-memory", "conversation", "brain/memory-fabric"], "conversation-memory-capture", ["b60-unified-memory-controls", "b11-context-builder", "b23-conversation-orchestrator"], 22, 10, "P2", ["memory-capture-policy", "impl-per-atl"],
  [("memory-capture.test", "integration", "fixture", "Hozzájárulás nélkül nincs rögzítés; felejtés minden másolatot töröl")], "Szabályozott beszélgetés-memória.")
t("b63-embedding-activation", "F6", [9], "Többnyelvű embedding aktiválása és magyar retrieval-eval",
  "Jelöltek (bge-m3, multilingual-e5) értékelése magyar korpuszon; aktiválás csak jóváhagyással; hash-vektor visszaesés marad.",
  ["embedding-provider", "semantic-index", "retrieval-eval", "chunker"], "memory-durability-embeddings", ["b21-hu-gold-corpus", "b60-unified-memory-controls"], 14, 12, "P2", ["embedding-activation", "local-model-install"],
  [("hu-retrieval-eval", "eval", "ÉLŐ helyi modellel", "Visszahívás ≥ küszöb a magyar korpuszon")], "Mért magyar szemantikus visszakeresés.", ext="helyi embedding-modell")
t("b65-memory-in-context", "F6", [2,4,9], "Memória-visszakeresés bekötése a Brain kontextusba",
  "A knowledge/memory ma főleg csak ír; relevancia, frissesség, forrás szerinti olvasás a kontextusba.",
  ["brain/memory-fabric", "brain/knowledge-brain", "memory-store", "semantic-index"], "brain-context-builder", ["b11-context-builder", "b20-hu-language-pack", "b60-unified-memory-controls"], 14, 8, "P2", ["impl-per-atl"],
  [("memory-in-context.test", "integration", "fixture", "Releváns emlék bekerül, elavult/törölt nem")], "A Brain ténylegesen használja az emlékeket.")

# ================= F7 (voice)
t("b71-voice-brain-bridge", "F7", [5,6], "Hang → Brain híd",
  "Az AURÓRA böngészős hangja a szerver-oldali beszélgetés-stacken (consent, megőrzés, kivonatolás) és a Gatewayen át; explicit push-to-talk mód; a hang sosem jóváhagyás/fizetés.",
  ["voice-conversation", "voice-session", "voice-interface", "aurora", "atlasz-control-center/public/app.js", "POST /api/aurora/utterance", "POST /api/voice/action"], "voice-brain-bridge", ["ATL-WRK-0007", "b24-chat-aurora-unify"], 26, 12, "P1", ["impl-per-atl", "runtime-release"],
  [("voice-brain-bridge.test", "integration", "fixture", "Hang-átirat a Gatewayen át megy; consent nélkül blokkolt; hang nem hagy jóvá")], "Egy hang-út, egységes szabályokkal.")
t("b72-voice-providers", "F7", [5,6], "STT/TTS szolgáltató-adapterek",
  "Böngésző-natív, helyi offline (pl. whisper.cpp / Piper), felhő; probe-bizonyíték; magyar hang-választás; VAD; streaming; felhős opció csak adatvédelmi döntéssel.",
  ["voice-interface", "modality-fabric", "voice-session"], "voice-provider-adapters", ["b71-voice-brain-bridge"], 36, 16, "P2", ["voice-provider-privacy", "local-model-install"],
  [("voice-provider-adapters.test", "unit+contract", "fixture", "Szerződés-teszt szolgáltatónként; LIVE csak saját probe alapján")], "Választható, bizonyított hang-szolgáltatók.", ext="STT/TTS szolgáltató vagy helyi motor")
t("b73-owner-voice-test", "F7", [5,6], "Tulajdonosi hangteszt (magyar hallás + beszéd)",
  "Az ATL-WRK-0595 / ATL-DEC-0006 szerinti teszt: 'működik' státusz kizárólag a tulajdonos megerősítéséből; bizonyíték rögzítve.",
  ["voice-conversation", "aurora", "POST /api/aurora/voice/evidence"], "voice-brain-bridge", ["b71-voice-brain-bridge", "ATL-WRK-0595"], 2, 4, "P1", ["voice-test"],
  [("owner-voice-evidence", "live-owner", "ÉLŐ (tulajdonos)", "Mindkét irány megerősítve a UI-n")], "Bizonyított magyar hang-kör.")
t("b74-voice-privacy-notice", "F7", [5], "Böngésző-STT adatvédelmi tájékoztató",
  "A UI jelezze, hogy a böngésző beszédfelismerése (Chrome/Edge) a hangot felhőbe küldheti; tulajdonosi beállítás.",
  ["atlasz-control-center/public/app.js", "aurora", "voice-conversation"], "voice-brain-bridge", ["b71-voice-brain-bridge"], 4, 2, "P2", ["voice-provider-privacy"],
  [("voice-privacy-notice.test", "ui", "fixture", "Tájékoztató látszik; beállítás tiltja a böngésző-STT-t")], "Tájékoztatott hozzájárulás a hangnál.")

# ================= F8
t("b80-emotion-style-engine", "F8", [7], "Érzelem-, hangulat- és beszédstílus-felismerő motor",
  "Szöveg + opcionális prozódia-jellemzők, bizonytalansági érték; modellalapú + lexikális visszaesés; több fordulós hangulat-követés (ma kulcsszavas, memória nélküli).",
  ["human-core", "aurora", "assistant-profiles"], "speech-style-emotion-engine", ["b20-hu-language-pack", "b22-understanding-engine", "b21-hu-gold-corpus"], 28, 14, "P2", ["impl-per-atl"],
  [("emotion-style-engine.test", "unit+eval", "fixture", "Magyar érzelem-korpuszon küszöb felett; bizonytalan esetben nem állít")], "Mért érzelem/stílus-felismerés.", also_pln=["ATL-PLN-0002"])
t("b81-creative-intent", "F8", [7,8], "Kreatív szándék és alkotói mód felismerése",
  "Történet, dalszöveg, forgatókönyv, vizuális terv szándék; kreatív elemzés (hangulat, téma, műfaj, tempó) a Brainben.",
  ["human-core", "aurora", "modality-fabric"], "speech-style-emotion-engine", ["b80-emotion-style-engine", "b52-reasoning-engines"], 20, 10, "P3", ["impl-per-atl"],
  [("creative-intent.test", "unit+eval", "fixture/élő", "Kreatív kérés felismerve, nem keveredik parancs-szándékkal")], "Kreatív mód felismerése.", also_pln=["ATL-PLN-0020"])
t("b82-emotion-expression-policy", "F8", [8], "Érzelemkifejezési szabályzat",
  "Megengedett (természetes kifejezés) és tiltott (emberi érzés birtoklásának állítása) minta-katalógus HU+EN; példák hangra és kreatív munkára; tulajdonosi jóváhagyás.",
  ["human-core", "aurora"], "emotion-expression-guard", ["b33-output-guard"], 8, 4, "P1", ["emotion-policy-signoff"],
  [("emotion-policy-review", "review", "dokumentum", "Tulajdonosi aláírás")], "Jóváhagyott kifejezési szabályzat.")
t("b83-expressive-speech", "F8", [6,8], "Kifejező beszéd: érzelem → prozódia/SSML/tempó",
  "Az érzelem-állapot leképezése a szolgáltató képességei szerinti prozódiára; hallgatói teszt a tulajdonossal.",
  ["voice-interface", "voice-session", "aurora"], "voice-provider-adapters", ["b72-voice-providers", "b80-emotion-style-engine", "b82-emotion-expression-policy"], 18, 10, "P3", ["voice-test"],
  [("expressive-speech-owner-test", "live-owner", "ÉLŐ (tulajdonos)", "Tulajdonos szerint természetes, nem hamis")], "Természetesen kifejező magyar beszéd.")
t("b84-creative-expression", "F8", [8], "Érzelemkifejezés kreatív munkában állítás-védelemmel",
  "Szöveg/forgatókönyv/zene-leírás érzelmi kifejezése; 'így fejezném ki' vs 'ezt érzem' különbség kikényszerítve.",
  ["human-core", "aurora"], "emotion-expression-guard", ["b81-creative-intent", "b82-emotion-expression-policy"], 12, 8, "P3", ["impl-per-atl"],
  [("creative-expression.test", "negative+eval", "fixture/élő", "Hamis érzés-állítás egyetlen mintán sem")], "Kreatív kifejezés hamis állítás nélkül.")
t("b85-emotion-eval-hu", "F8", [7,8], "Érzelem/stílus értékelés és negatív teszt",
  "Magyar arany-készlet + tiltott állítások parafrázis-álló negatív tesztje.",
  ["human-core", "retrieval-eval"], "brain-evaluation-harness", ["b80-emotion-style-engine", "b82-emotion-expression-policy", "b21-hu-gold-corpus"], 8, 10, "P2", [],
  [("emotion-eval-hu", "eval+negative", "fixture/élő", "Küszöbök teljesülnek; tiltott állítás 0")], "Mért érzelem-minőség és biztonság.")

# ================= F9
t("b90-run-budget", "F9", [10], "Futásonkénti keretező és leállító",
  "Lépés-, idő-, token- és költségkeret futásonként (ma csak feladatonkénti becslés); túllépéskor leállás+jelentés; kill-switch és safe-mode integráció.",
  ["brain/governance", "brain/orchestrator", "agent-workforce", "emergency-stop", "safe-mode", "model-registry"], "run-budget-governor", ["b32-token-cost", "b10-gateway-api"], 22, 12, "P1", ["impl-per-atl"],
  [("run-budget.test", "integration+negative", "fixture", "Túllépés leállít; kill-switch azonnal hat; költség sosem lépi át a plafont")], "Korlátos autonómia.")
t("b91-tool-use-loop", "F9", [3,10], "Modellvezérelt tool-use ciklus",
  "Megfigyel–gondol–cselekszik–ellenőriz a module-brokeren át, lépéskerettel; minden hívás auditált és jogosultság-ellenőrzött; modell nem hívhat tiltott eszközt.",
  ["agent-tool-broker", "module-broker", "agent-executors", "agent-workforce", "agent-tool-policy"], "agent-execution-loop", ["b90-run-budget", "b31-adapter-capabilities", "b41-first-live-connection"], 40, 18, "P1", ["impl-per-atl", "live-eval-budget", "autonomy-level"],
  [("tool-use-loop.test", "integration+negative", "fixture, majd ÉLŐ", "Tiltott eszköz elutasítva; lépéskeret betartva; teljes audit")], "Működő, korlátos tool-use ciklus.")
t("b92-sandbox-workspace", "F9", [10], "Ügynök-munkaterület pillanatképpel és visszaállítással",
  "Fájl-olvasás/módosítás csak engedélyezett útvonalon, pillanatkép + visszaállítás (code-edit-workflow kiterjesztése).",
  ["code-edit-workflow", "alt-solution-harness", "file-lock"], "agent-execution-loop", ["b91-tool-use-loop"], 20, 10, "P1", ["impl-per-atl"],
  [("sandbox-workspace.test", "integration+negative", "fixture", "Útvonal-szökés blokkolva; visszaállítás pontos")], "Biztonságos munkaterület.")
t("b93-real-replanner", "F9", [3,10], "Valódi újratervezés",
  "A stall-replanner ma csak jelzőt ad; alternatív terv generálása modellel, korlátos újratervezéssel.",
  ["stall-replanner", "brain/planning-brain", "brain/governed-dispatch", "goal-planner"], "self-check-repair-loop", ["b37-plan-schema-bridge", "b52-reasoning-engines"], 16, 8, "P2", ["impl-per-atl", "live-eval-budget"],
  [("real-replanner.test", "integration", "fixture/ÉLŐ", "Elakadás után új, érvényes terv; újratervezési limit betartva")], "A rendszer elakadás után tényleges alternatívát tervez.")
t("b94-verifier-evidence", "F9", [10], "Verifier bekötése bizonyíték-lekérdezőkkel",
  "AGENT_CLAIM/MODEL_CLAIM ma mindig REJECT, hiányzó lookup → ESCALATE; teszt-futtatás, hash, egészség, forrás-ellenőrzés lookupok.",
  ["brain/verifier", "brain/evidence-sources", "qa-reviewer", "regression-eval-suite"], "self-check-repair-loop", ["b37-plan-schema-bridge"], 22, 10, "P1", ["impl-per-atl"],
  [("verifier-evidence.test", "integration+negative", "fixture", "Hamis állítás elutasítva; önellenőrzés tiltva marad")], "Független, bizonyíték-alapú önellenőrzés.")
t("b95-fix-loop", "F9", [10], "Hiba → ok → javítás → jóváhagyás → teszt → visszagörgetés",
  "rootCause → javítási javaslat → code-edit-workflow (független átnézés, tulajdonosi jóváhagyás) → teszt → rollback; automatikus alkalmazás TILOS.",
  ["goal-planner", "code-edit-workflow", "regression-eval-suite", "test-intelligence"], "self-check-repair-loop", ["b92-sandbox-workspace", "b94-verifier-evidence", "b93-real-replanner"], 30, 14, "P1", ["impl-per-atl"],
  [("fix-loop.test", "integration+negative", "fixture", "Jóváhagyás nélkül nincs alkalmazás; sikertelen teszt visszagörget")], "Felügyelt javítási kör.")
t("b96-workforce-in-runtime", "F9", [10], "A 30 ügynök hostolása a runtime-ban az egységes Brain alatt",
  "Ma csak a Control Centerben fut; a runtime tick hívja a discoveryScheduler-t (D-08); egy példány, zárolt tárak.",
  ["agent-workforce", "atlasz-runtime/supervisor-safe.mjs", "atlasz-control-center/agents-panel.mjs", "scheduler", "durable-queue"], "agent-execution-loop", ["ATL-WRK-0004", "ATL-WRK-0005", "ATL-WRK-0008", "b01-single-brain"], 28, 14, "P1", ["impl-per-atl", "runtime-release"],
  [("workforce-in-runtime.test", "integration", "fixture", "Egy példány; két runtime ugyanazt a feladatot nem bérelheti")], "Egységes ügynök-futtatás.")
t("b98-autonomy-levels", "F9", [10], "Autonómia-szintek (A0 javasol, A1 jóváhagyással végrehajt, A2 kis kockázatnál önálló + utólagos jelentés)",
  "Alapérték A0; szintváltás csak tulajdonosi aláírással; minden szintnek költség/lépés/eszköz-határa.",
  ["brain/governance", "approval-command-gateway", "owner-keystore"], "run-budget-governor", ["b90-run-budget"], 10, 6, "P1", ["autonomy-level"],
  [("autonomy-levels.test", "negative", "fixture", "Szint önkényesen nem emelhető; A0-n semmi nem hajtódik végre")], "Tulajdonos által kezelt autonómia-szintek.")
t("b97-supervised-trial", "F9", [10], "Első felügyelt önálló futás",
  "Kicsi, visszagörgethető, költségkorlátos cél → terv → végrehajtás → önellenőrzés → javítás → jelentés; a tulajdonos jóváhagyja a szintet és figyeli.",
  ["agent-workforce", "brain/orchestrator", "brain/verifier"], "agent-execution-loop", ["b90-run-budget", "b91-tool-use-loop", "b94-verifier-evidence", "b95-fix-loop", "b98-autonomy-levels", "b51-live-conversation"], 8, 16, "P1", ["autonomy-level", "live-eval-budget"],
  [("supervised-autonomy-trial", "live-owner", "ÉLŐ (tulajdonos)", "Teljes kör bizonyíték-lánccal; tulajdonos elfogadja")], "Bizonyított, felügyelt önálló feladatvégzés.")

# ================= F10
t("b100-wire-agents", "F10", [1,10], "Az ügynökök (30) és menedzserek (15) rákötése a Brain Gatewayre",
  "Konzultáció/terv a Gatewayen át; nem izolált működés.",
  ["agent-workforce", "master-coordinator", "agent-coordination", "agent-registry"], "brain-gateway-service", ["b10-gateway-api", "b37-plan-schema-bridge", "b96-workforce-in-runtime"], 18, 8, "P2", ["impl-per-atl", "runtime-release"],
  [("agents-brain-wiring.test", "integration", "fixture", "Minden ügynök-típus a Gatewayen át kér; jogosultság változatlan")], "Az ügynökök közös intelligencia-réteget használnak.")
t("b101-wire-business", "F10", [1], "Üzleti/pénzügyi/felderítő modulok Brain-konzultációja (csak javaslat)",
  "money-engine, discovery, campaign, business-factory, opportunity: Brain-javaslat; pénzügyi jogosultság és jóváhagyás változatlan.",
  ["business/money-engine", "brain/business-factory", "brain/opportunity-intelligence", "brain/search-pipeline", "campaign-manager"], "brain-gateway-service", ["b10-gateway-api"], 18, 8, "P3", ["impl-per-atl", "runtime-release"],
  [("business-brain-wiring.test", "integration+negative", "fixture", "Javaslat nem hajt végre pénzügyi műveletet")], "Üzleti modulok a közös agyat használják.")
t("b102-wire-workflows", "F10", [1,3], "Munkafolyamatok, workbench, fejlesztő-asszisztens, fordítás Brain-konzultációja",
  "workbench, translation-feedback, code-edit, dokumentum-központ a Gatewayen át.",
  ["workbench", "translation-feedback", "code-edit-workflow", "universal-inbox"], "brain-gateway-service", ["b10-gateway-api", "b52-reasoning-engines"], 14, 6, "P3", ["impl-per-atl"],
  [("workflows-brain-wiring.test", "integration", "fixture", "Workbench/fordítás a Gatewayen át működik")], "Egységes intelligencia-réteg a munkafolyamatokban.")
t("b103-brain-ui", "F10", [1,3,4], "Brain / AURÓRA egységes UI",
  "Beszélgetés, brainWorkflow indítás (ma nincs UI), terv- és bizonyíték-nézet, jóváhagyás-kérések, 'modell nincs bekötve' jelző; fixture ≠ élő jelölés a UI-n.",
  ["atlasz-control-center/public/app.js", "atlasz-control-center/brain-views.mjs", "atlasz-control-center/agents-panel.mjs", "ATL-UIX-0061", "ATL-UIX-0075"], "brain-ui-surface", ["b24-chat-aurora-unify", "b37-plan-schema-bridge"], 30, 14, "P2", ["impl-per-atl", "runtime-release"],
  [("brain-ui-smoke.test", "ui", "fixture", "Minden Brain-nézet UI-smoke zöld; állapotjelző őszinte")], "Átlátható Brain-felület.")
t("b104-telemetry", "F10", [1,10], "Brain telemetria",
  "Késleltetés, token, költség, hibaarány, visszaesés-arány, minőségi mutatók; audit-nézet.",
  ["brain/brain-health", "brain/black-box", "audit-chain"], "brain-telemetry", ["b32-token-cost", "b10-gateway-api"], 14, 6, "P3", ["impl-per-atl"],
  [("brain-telemetry.test", "unit", "fixture", "Mutatók pontosak; titok nem kerül a naplóba")], "Mérhető Brain-működés.")
t("b105-e2e", "F10", [1,2,3,4,5,6,9,10], "Végponti integrációs teszt-csomag",
  "Szöveg/hang → Brain → terv → ügynök → verifier → jelentés; fixture és élő szint külön jelölve.",
  ["brain/orchestrator", "brain/verifier", "regression-eval-suite", "test-intelligence"], "brain-evaluation-harness", ["b37-plan-schema-bridge", "b71-voice-brain-bridge", "b51-live-conversation", "b96-workforce-in-runtime", "b100-wire-agents", "b103-brain-ui", "b62-memory-capture"], 20, 16, "P1", ["live-eval-budget"],
  [("brain-e2e.test", "e2e", "fixture + ÉLŐ külön", "Teljes lánc zöld; élő rész csak jóváhagyással")], "Teljes lánc bizonyítva.")
t("b106-release-gate", "F10", [1,10], "Kiadási kapu: a Brain beültetése a működő rendszerbe",
  "Shadow → advisory → active fokozatos bekapcsolás, visszaállítási terv, külön tulajdonosi jóváhagyás minden fokozatra.",
  ["atlasz-runtime/supervisor-safe.mjs", "atlasz-control-center/core.mjs", "safe-mode", "emergency-stop"], "brain-gateway-service", ["b105-e2e"], 8, 8, "P1", ["runtime-release"],
  [("release-rollback-drill", "live-owner", "ÉLŐ (tulajdonos)", "Visszaállítás bizonyítottan működik")], "Kontrollált, visszagörgethető bevezetés.")
t("b107-final-acceptance", "F10", [1,2,3,4,5,6,7,8,9,10], "ZERO TOLERANCE záró elfogadás a Brain-programra",
  "Mind a 10 képesség elfogadási kritériuma, negatív biztonsági tesztek, leltár-státuszok frissítése a bizonyítékok szerint (fixture ≠ élő).",
  ["brain/verifier", "regression-eval-suite"], "brain-evaluation-harness", ["b106-release-gate", "b97-supervised-trial", "b73-owner-voice-test", "b85-emotion-eval-hu", "b54-complex-eval", "b62-memory-capture", "b63-embedding-activation", "ATL-WRK-0764"], 0, 24, "P1", ["live-eval-budget", "runtime-release"],
  [("brain-final-acceptance", "acceptance", "ÉLŐ + fixture külön", "Nincs ismert működési/biztonsági hiba; státuszok bizonyíték-alapúak")], "Lezárt, bizonyított Brain-program.")
