# -*- coding: utf-8 -*-
# executed inside build_brain_program.py namespace. Renders the Hungarian owner report. RECORDS ONLY.
from collections import Counter, defaultdict
def fh(x): return ("%.0f" % x).replace(".", ",")
tot = sum(t["total"] for t in TASK.values()); act = tot
ph_rows = []
for ph in D.PHASES:
    ts = [t for t in ORDER if t["phase"] == ph]
    ph_rows.append((ph, D.PHASES[ph], len(ts), sum(t["total"] for t in ts), ts[0]["id"] + " … " + ts[-1]["id"] if ts else "", sorted({g for t in ts for g in t["gates"] if g != "impl-per-atl"})))
rs = Counter(a["real_state"] for a in ASSESS if a["category"] in ("BRN", "AUR", "MDL", "MEM", "VOI", "AGT"))
core = [a for a in ASSESS if a["category"] in ("BRN", "AUR", "MDL", "MEM", "VOI", "AGT")]
pl_ids = sorted(PLN[p]["id"] for p in PLN); wk_ids = sorted(t["id"] for t in TASK.values()); dc_ids = sorted(d["id"] for d in DEC.values() if not d.get("existing"))
def rng(l): return "%s … %s (%d db)" % (l[0], l[-1], len(l))
M = []
A = M.append
A("# ATLASZ AURÓRA V7.3 – BRAIN-PROGRAM: vizsgálat, számozott munkaterv, bekötési sorrend\n")
A("*Dátum: %s · Alap: commit `%s` · Csak nyilvántartás és tervezés: a működő rendszer kódja nem módosult, modell nincs bekötve, külső szolgáltatás nincs aktiválva, költség nem keletkezett.*\n" % (TODAY, HEAD))
A("## 1. Röviden\n")
A("- **Az agy váza és a védelmi réteg nagyrészt megvan, az agy maga még nem működik.** A 45 BRAIN-modul, a modul-gerinc (module-broker), a modell-nyilvántartás, az aláírt jóváhagyások, a költségplafon és a kill-switch valós, helyben tesztelt kód. **De egyetlen élő modellhívás sem történt**, és a Brain magja (brain/*) egyetlen modellt sem hív: a döntések sablonok (csak három következtető motor – decision-analysis, debate-protocol, multi-solution – tud injektált adapteren át modellt hívni, adapter nélkül leáll), a szövegértés kulcsszavas (regex), a főoldali chat is csak négy kulcsszót ismer.")
A("- **A Brain ma nem közös intelligencia-réteg.** Infrastruktúraként (biztonság, napló, feladatsor) sok modul használja, de az AURÓRA, a chat, az ügynökök, a munkafolyamatok nem kérdezik meg. Ráadásul **két külön Brain-példány** fut (Control Center és runtime), közös állapot nélkül.")
A("- **A hang** böngészőben (Web Speech) valóban kész kód, de a tulajdonos még nem igazolta, a nyelvváltó hibás (D-07), és megkerüli a szerver-oldali hozzájárulási szabályokat. **A memória** nagyrészt tartós és részben jól szabályozható, de három tár újraindításkor elvész, és nincs egységes ki/be, export, felejtés.")
A("- **Az önálló feladatvégzés** felügyeleti oldala (kill-switch, független ellenőr, jóváhagyás, visszagörgetés) valós; a zárt hurok (cél → terv → végrehajtás → önellenőrzés → javítás) **nincs összekötve**, a replanner csak jelzőt ad.")
A("- **Terv:** %d új, számozott munkafeladat, %d új tervezett modul, %d új tulajdonosi jóváhagyási kapu, összesen **%d új ATL-azonosító** – a meglévők átszámozása és törlés nélkül. Becsült összmunka ≈ **%s óra** (±40%%, becslés), a leghosszabb függőségi lánc ≈ **%s óra** a meglévő előfeltételekkel együtt.\n" % (len(TASK), len(PLN), sum(1 for d in DEC.values() if not d.get('existing')), len(newids), fh(tot), fh(crit['cp_h'])))
A("## 2. A 10 kötelező képesség: tényleges állapot\n")
A("| # | Képesség | Mai állapot | Új munka (db / óra) |\n|---|---|---|---|")
for r in CAPROWS:
    A("| %d | %s | **%s** | %d / %s |" % (r["capability_no"], r["capability"], r["state_now"], r["new_work_count"], fh(sum(t["total"] for t in ORDER if r["capability_no"] in t["caps"]))))
A("\nRészletek képességenként (mi működik, mi szimulált, mi hiányzik): `brain_capabilities.csv`.\n")
for r in CAPROWS:
    A("**#%d – %s**  \n*Működik:* %s  \n*Szimulált / nem igazolt:* %s  \n*Hiányzik:* %s\n" % (r["capability_no"], r["capability"], r["what_works"], r["simulated_or_unproven"], r["missing"]))
A("## 3. A meglévő BRAIN / AURÓRA / MODEL / MEMORY / VOICE / AGENT modulok\n")
A("Vizsgált meglévő rendszerelem: **%d** (45 BRN, 5 AUR, 28 MDL, 15 MEM, 3 VOI, 65 AGT + a tervhez hivatkozott további komponensek). Besorolás a tényleges kód alapján (nem a leltári státusz átvétele):\n" % len(ASSESS))
A("| Valós állapot | db (BRN/AUR/MDL/MEM/VOI/AGT) |\n|---|---|")
for k, v in rs.most_common(): A("| %s | %d |" % (k, v))
A("\nElemenkénti lista ATL-azonosítóval, bekötéssel és megállapítással: `brain_modules_assessment.csv`. A leltár `VERIFIED_WORKING` státusza itt is csak **fixture-szintű** igazolást jelent, élő bizonyítékot nem.\n")
A("## 4. Mit kell bekötni (a vizsgálat lényege)\n")
for x in ["**Modell-út:** a Control Center és a runtime gateway-ei ma szolgáltató nélkül működnek (mindig NO_ELIGIBLE_PROVIDER); a kész adapter-kód (felhő + Ollama) soha nem futott élőben, és nem tud streaminget, tool-callinget, strukturált kimenetet, retry-t.",
          "**Brain Gateway:** egyetlen, típusos belépési pont (`consult/understand/plan/act`) a meglévő module-broker fölött; egyetlen megosztott Brain-példány.",
          "**Szövegértés + magyar nyelv:** modellalapú, séma-kötött szándékfelismerés szabályos visszaesés mellett; magyar ragozás-, ékezet-, nyelvfelismerés; magyar arany-korpusz a mérésre.",
          "**Beszélgetés:** a `conversation` tároló és a `context-manager` tényleges használata, előzmény-összegzés, az AURÓRA és a chat egy úttá egyesítése.",
          "**Terv-lánc:** goal-planner → planning-brain → orchestrator → verifier összekötése (ma nem fogyasztja senki a goal-planner kimenetét).",
          "**Memória:** egységes ki/be, export, felejtés; a 3 nem tartós tár tartóssá tétele; embedding aktiválása (jóváhagyással); beszélgetés-rögzítés hozzájárulással; olvasás a kontextusba.",
          "**Hang:** D-07 javítása, a böngészős hang a szerver-oldali szabályokon át, tulajdonosi hangteszt, szolgáltató-adapterek, adatvédelmi tájékoztató.",
          "**Érzelem:** modellalapú felismerés, kifejezési szabályzat, a hamis érzelem-állítás elleni védelem a **modell-kimenetre** is (ma csak sablonokra), magyar minták.",
          "**Önálló munka:** futásonkénti keret, tool-use ciklus, sandbox, valódi újratervezés, bizonyíték-alapú verifier, javítási kör (automatikus alkalmazás tilos), a 30 ügynök hostolása a runtime-ban."]:
    A("- " + x)
A("\n## 5. Fázisok és ütemezés (függőségekkel)\n")
A("| Fázis | Tartalom | Feladat | Becsült óra | Tulajdonosi kapuk (a fejlesztés-indításon túl) |\n|---|---|---|---|---|")
for ph, nm, n, h, rg, gs in ph_rows:
    A("| %s | %s | %d | %s | %s |" % (ph, nm, n, fh(h), ", ".join("%s (%s)" % (g, DEC[g]["id"]) for g in gs) if gs else "—"))
A("\nA részletes, számozott lista függőségekkel: `brain_work_plan.csv` (és `brain_program.sqlite`). Minden feladat tartalmaz: ATL-komponens-hivatkozásokat, tervezett modult, függőségeket (új és meglévő ATL-WRK), óra-becslést, elfogadási kritériumot, tesztet, kaput.\n")
A("### Javasolt sorrend a Brain működésbe hozására\n")
steps = [
 ("1", "Előfeltételek (meglévő hibajegyek): D-03/D-04/D-05 (zárak), D-08, D-07", "ATL-WRK-0003, 0004, 0005, 0008, 0007", "nincs külső szolgáltatás"),
 ("2", "Specifikáció, fake-adapterek, fenyegetésmodell", "b00, b02, b03", "nincs külső szolgáltatás"),
 ("3", "Egy megosztott Brain + Brain Gateway + Context Builder + degradált mód", "b01, b10–b14", "futó rendszer módosítása csak külön kapuval"),
 ("4", "Magyar nyelvi csomag, arany-korpusz, szövegértés, beszélgetés-vezérlő (fake modellel)", "b20–b25", "—"),
 ("5", "Modell-réteg előkészítés: gateway-bekötés, adapter-képességek, költségszámlálás, kimeneti védelem, terv-híd (fake transporttal)", "b30–b37", "—"),
 ("6", "ELSŐ ÉLŐ MODELL: jóváhagyási csomag → aláírások → probe → kis költségű próba → magyar füstteszt", "b40–b42", "kulcs, egress, MODEL_ENABLE, költségplafon, szolgáltató-választás"),
 ("7", "Élő megértés, élő magyar beszélgetés, következtetés-motorok", "b50–b54", "élő értékelés költségkerete"),
 ("8", "Memória: egységes vezérlés, tartósság, rögzítés, embedding, kontextus", "b60–b65", "memória-policy, embedding-aktiválás"),
 ("9", "Hang (a böngészős kör párhuzamosan indítható a 4. lépés után): híd, tulajdonosi hangteszt, szolgáltatók", "b71–b74", "hangteszt (ATL-DEC-0006), adatvédelem"),
 ("10", "Érzelem, stílus, kreatív szándék, kifejezési szabályzat", "b80–b85", "szabályzat jóváhagyása"),
 ("11", "Önálló munka: keret, tool-use, sandbox, újratervezés, verifier, javítási kör, runtime-hostolás, első felügyelt futás", "b90–b98", "autonómia-szint, kiadás"),
 ("12", "Minden modul rákötése, UI, telemetria, végponti teszt, kiadási kapu, záró elfogadás", "b100–b107", "futó rendszer módosítása"),
]
A("| Lépés | Tartalom | Feladatok | Külső / jóváhagyás |\n|---|---|---|---|")
for s_ in steps: A("| %s | %s | %s | %s |" % s_)
A("\nAz 1–5. lépés **teljesen offline**: nincs költség, nincs külső szolgáltatás; csak a fejlesztés-indítás ATL-számonkénti jóváhagyása kell. Az első külső lépés a 6.\n")
A("## 6. Egységes intelligencia-réteg: hogyan lesz a Brain az egész ATLASZ közös agya\n")
A("A cél nem egy új, különálló chatbot: a **Brain Gateway** (egy API, egy megosztott állapot) a meglévő module-brokerre épül, így minden fogyasztó ugyanazokat a jogosultsági, audit- és kill-switch-szabályokat kapja. A modell kimenete **soha nem ad jogosultságot**: a végrehajtás kapuja mindig a meglévő whitelist / governance / aláírt jóváhagyás. Fogyasztói térkép (`brain_integration_map.csv`):\n")
A("| Fogyasztó | Mai kapcsolat a Brainhez | Cél | Munka |\n|---|---|---|---|")
for r in INTEG: A("| %s (%s) | %s | %s | %s |" % (r["consumer"], r["consumer_id"], r["current_relation_to_brain"], r["target_relation"], r["work_ids"]))
A("\n## 7. Tulajdonosi jóváhagyási kapuk (semmi nem indul el nélkülük)\n")
A("| Azonosító | Kapu | Eredet |\n|---|---|---|")
for d in DEC.values(): A("| %s | %s | %s |" % (d["id"], d["name"], "meglévő" if d.get("existing") else "új"))
A("\nMinden feladat első kapuja a **fejlesztés-indítás ATL-számonként** (%s): ennek a tervnek az elfogadása **nem** engedélyez kódmódosítást. Éles modellbekötés, fizetős API, külső szolgáltatás, kiadás vagy a működő rendszer módosítása előtt a fenti kapuk külön aláírása szükséges.\n" % DEC["impl-per-atl"]["id"])
A("## 8. Kockázatok és nyitott kérdések\n")
for x in ["**Első modell:** helyi (Ollama: nincs API-költség, de telepítés + hardver kell, a magyar minőség **nincs mérve**) vagy felhős (költség, kulcs, adatvédelem). A döntés a tiéd; javaslat: előbb az offline fázisok és a magyar benchmark (b35), az élő költségplafon induljon a legkisebb értéken. A tényleges költség **ISMERETLEN** – nem nulla.",
          "**Magyar minőség** modellenként nincs bizonyítva; a b21/b35/b42 mérés dönti el, melyik modell használható.",
          "**Böngészős beszédfelismerés** (Chrome/Edge) a hangot felhőbe küldheti – adatvédelmi tájékoztató és döntés kell (b74).",
          "**Érzelem:** a rendszer természetesen kifejezhet hangulatot, de emberi érzelem birtoklását nem állíthatja; a védelem ma csak a sablonokat fedi, a modell-kimenetre és a magyar parafrázisokra ki kell terjeszteni (b33, b82).",
          "**Autonómia:** alapérték A0 (csak javasol); szintet csak te emelhetsz; a javítási kör automatikus alkalmazása tilos.",
          "**Futó rendszer:** a Brain beültetése a működő rendszerbe fokozatos (shadow → advisory → active), visszaállítási tervvel (b106).",
          "**Becslések:** az órák tervezési becslések (±40%), nem mért értékek; a vizsgálat öt független, csak olvasó elemzésre épül, a kulcsállítások kódból újraellenőrizve; ahol nem vizsgáltam, ISMERETLEN-nek jelöltem."]:
    A("- " + x)
A("\n## 9. Új ATL-azonosítók (a meglévőket nem számoztam át, duplikátum nincs)\n")
A("| Kategória | Tartomány | Megjegyzés |\n|---|---|---|")
A("| ATL-PLN (tervezett modul) | %s | tervezett – még NEM létezik |" % rng(pl_ids))
A("| ATL-WRK (munkafeladat) | %s | a fenti munkaterv |" % rng(wk_ids))
A("| ATL-DEC (jóváhagyási kapu) | %s | + a meglévő ATL-DEC-0001/0002/0003/0006 felhasználva |" % rng(dc_ids))
A("\nA 21 új tervezett modul közül több a meglévő tervezett modulokat **magába foglalja/bővíti** (ATL-PLN-0001, 0002, 0009, 0020, 0076, 0077), ezeket nem duplikáltam; a feladatoknál `also_planned_module_ids` jelöli. Az 1 047 elemes rendszerleltár (SQLite/JSON) **változatlan**; a Brain-program saját táblákban van (`brain_program.sqlite`), a következő leltár-frissítéskor olvasható be.\n")
A("| Modul | Azonosító | Fajta | Feladatok |\n|---|---|---|---|")
for p in PLN.values(): A("| %s | %s | %s | %s |" % (p["name"][:95], p["id"], p["kind"], ", ".join(x[-4:] for x in p["tasks"])))
A("\n## 10. Érvényesítés\n")
okc = sum(1 for c in V["checks"] if c["ok"])
A("%d ellenőrzés, sikeres: %d, hiba: %d.\n" % (len(V["checks"]), okc, V["errors"]))
for c in V["checks"]: A("- %s %s" % ("✔" if c["ok"] else "✖", c["check"]))
A("\n## 11. Fájlok (`docs/brain_program/`)\n")
for f_, d_ in [("BRAIN_PROGRAM_JELENTES.md", "ez a jelentés"), ("brain_work_plan.csv", "számozott munkaterv (62 feladat, függőségek, kapuk, tesztek)"), ("brain_capabilities.csv", "10 képesség állapota"),
               ("brain_modules_assessment.csv", "meglévő modulok valós állapota"), ("brain_new_modules.csv", "21 új tervezett modul"), ("brain_approval_gates.csv", "jóváhagyási kapuk"),
               ("brain_test_plan.csv", "teszt-terv"), ("brain_integration_map.csv", "fogyasztói térkép"), ("brain_program.sqlite", "minden tábla + kapcsolatok"), ("validation_report.json", "érvényesítés")]:
    A("- `%s` – %s" % (f_, d_))
import re as _re
_code = {t["slug"].split("-")[0]: t["id"] for t in TASK.values()}
_txt = "\n".join(M) + "\n"
_txt = _re.sub(r"(?<![\w-])b(\d{2,3})(?![\w-])", lambda m: _code.get("b" + m.group(1), m.group(0)), _txt)
open(os.path.join(OUT, "BRAIN_PROGRAM_JELENTES.md"), "w", encoding="utf-8").write(_txt)
