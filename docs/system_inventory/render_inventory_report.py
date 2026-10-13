#!/usr/bin/env python3
"""Renders the Hungarian report, the full numbered inventory and the numbered work plan from atlasz_system_inventory.json (RECORDS ONLY)."""
import json, os, collections, csv

OUT = os.path.join(os.getcwd(), "docs/system_inventory")
R = json.load(open(os.path.join(OUT, "atlasz_system_inventory.json"), encoding="utf-8"))
INV, PLN, REQ, WORK, DIR, SRC, CFG, FND, DEC, COR, V = (R[k] for k in ("inventory_items", "planned_modules", "requirements_matrix", "work_plan", "directive_items", "sources", "config_files", "findings", "owner_decisions", "corrections_to_v1", "validation"))
HEAD = R["git_head"]
ORDER = ["VERIFIED_WORKING", "PARTIAL", "CONNECTED_UNTESTED", "STRUCTURAL_ONLY", "MOCK_ONLY", "EXTERNAL_BLOCKER", "OWNER_APPROVAL_REQUIRED", "NOT_YET_VERIFIED", "BROKEN", "MISSING",
         "LEGACY_QUARANTINED", "PLANNED", "PLANNED_EXTEND", "PLANNED_DEFERRED", "DECISION_PENDING", "N/A"]
def dist(rows, key="status"):
    c = collections.Counter(r[key] for r in rows)
    return [(k, c[k]) for k in ORDER if c.get(k)] + [(k, v) for k, v in c.items() if k not in ORDER]
def fmt(d):
    return ", ".join("%s: %d" % kv for kv in d)
def f1(x):
    return "%.0f" % float(x)
def esc(s):
    return str(s).replace("|", "\\|").replace("\n", " ")
def short(s, n=140):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[:n - 1] + "…"

exist = [r for r in INV if r["category"] != "PLN"]
v1c = [r for r in exist if r["origin"] == "V1"]
v2c = [r for r in exist if r["origin"] != "V1"]
actW = [w for w in WORK if w["counted_in_active_plan"] == "IGEN"]
defW = [w for w in WORK if w["counted_in_active_plan"] != "IGEN"]
hA = sum(float(w["est_total_h"]) for w in actW); hD = sum(float(w["est_total_h"]) for w in defW)
hI = sum(float(w["est_impl_h"]) for w in actW); hV = sum(float(w["est_verify_h"]) for w in actW)
reqs23 = [r for r in REQ if r["set"] == "REQ"]
bykind = collections.Counter(p["kind"] for p in PLN)
L = []
P = L.append

P("# ATLASZ AURÓRA V7.3 — KIBŐVÍTETT TELJES RENDSZERLELTÁR (2. kiadás)")
P("")
P("Dátum: 2026-10-12 · repó-állapot (HEAD a generáláskor): `%s` · ág: `atlasz-v73-integration`" % HEAD)
P("")
P("> **Csak felmérés, azonosítás és dokumentálás.** A futó rendszer kódja nem változott; hiányzó modul nem épült meg; külső szolgáltatás nem lett aktiválva; költség nem keletkezett. A tervezett (PLANNED) elemek **nem léteznek**, sehol sem szerepelnek működőként. A munkaórák **tervezési becslések**, nem mérések. Fixture/helyi teszt-bizonyíték **nem** élő bizonyíték (valós külső rendszerrel igazolt elem: 0).")
P("")
P("## 1. Összefoglaló — három külön számsor")
P("")
P("A kérésed szerint az eredeti követelmények, a létező rendszerelemek és a tervezett modulok számát **külön** vezetem; ezek nem összeadhatók.")
P("")
P("| Számsor | Darab | Mi ez |")
P("|---|---:|---|")
P("| **Eredeti követelmény-tétel** (23 fejezet sorai, 85 képesség, 23 biztonsági/infra, 150 ötlet) | %d | `requirements_matrix.csv` (ebből %d a 23 fejezet sora: 1564 követelmény + 166 cím + 129 leíró sor; 258 a 85/23/150) |" % (len(REQ), len(reqs23)))
P("| **Tulajdonosi direktíva- és specifikáció-sor** (42 feltöltött direktíva + V7.3 mester-regiszter) | %d | `directive_items.csv` — mindegyik sor azonosítót (ATL-DIR / ATL-SPC) kapott, besorolva |" % len(DIR))
P("| **Létező rendszerelem** (megőrzött v1: 898 + ebben a körben új, valós nyilvántartásba vett: %d) | %d | `inventory_items.csv` (meglévő sorok) |" % (len(v2c), len(exist)))
P("| **Tervezett modul / bővítés / döntés / halasztott projekt** (még NEM létezik) | %d | `planned_modules.csv` — új modul: %d, meglévő bővítése: %d, tulajdonosi döntést igénylő: %d, halasztott: %d |" % (len(PLN), bykind["NEW"], bykind["EXTEND"], bykind["DECISION"], bykind["DEFERRED"]))
P("| Forrásdokumentum (ATL-SRC) / konfig-állapotfájl (ATL-CFG) | %d / %d | `sources.csv`, `config_files.csv` |" % (len(SRC), len(CFG)))
P("| Munkaterv-feladat (ATL-WRK) | %d | ebből a korábbi 340 sor változatlanul benne, +%d új; aktív terv: %d feladat, halasztott: %d |" % (len(WORK), len(WORK) - 340, len(actW), len(defW)))
P("| Megállapítás (ATL-FND) / tulajdonosi döntés (ATL-DEC) | %d / %d | `findings.csv`, `owner_decisions.csv` |" % (len(FND), len(DEC)))
P("")
P("**Becsült munka:** aktív terv **%s óra** (megvalósítás %s + ellenőrzés %s). Halasztott/jövőbeli tételek tájékoztató becslése külön: %s óra (nem része az aktív tervnek, nem aktivált). A becslés módszere: állapot-alapú óranorma komponensenként/modulonként (lásd 12. pont); ±40%% bizonytalansággal olvasandó." % (f1(hA), f1(hI), f1(hV), f1(hD)))
P("")
P("## 2. Mi változott az 1. kiadáshoz képest (megőrzés + korrekciók)")
P("")
P("* A 898 v1 azonosító és név **változatlan**; a v1 ledger és a változásnapló csak bővült (nincs törlés, nincs újraszámozás).")
P("* **Új, valós elemek** nyilvántartásba véve (a v1 kihagyta): 15 menedzseri szerepkör, 12 biztonsági kapu (G01–G12), %d beépített executor, 19 felderítési forrás-leíró, a 14. AI-szolgáltató (vercel-ai-gateway) — összesen %d meglévő elem; továbbá %d repó-dokumentum (ATL-SRC) és %d konfigurációs/állapot/CI/bizonyíték fájl (ATL-CFG)." % (sum(1 for r in v2c if r["kind"] == "AGENT_EXECUTOR"), len(v2c), sum(1 for s in SRC if s["kind"] == "REPO_DOCUMENT"), len(CFG)))
P("* **Saját v1-hibáim javítása** (`corrections_to_v1.csv`, a változásnaplóban CORRECTED eseményként):")
for c in COR:
    P("  * `%s` %s — %s: `%s` → `%s` (%s)" % (c["id"], c["name"], c["field"], short(c["old"], 60), short(c["new"], 80), c["reason"]))
P("* A régi (competition-v1) futtatókörnyezet három fájlja a **tulajdonosi karantén-döntés** szerint `LEGACY_QUARANTINED` — nem számít működő elemnek. A v1 korábban VERIFIED_WORKING-nak/PARTIAL-nak vette őket; ez téves volt.")
P("* A v1 CSV/JSON fájlok **történeti pillanatképként** érintetlenek maradtak; az érvényes állapot a `docs/system_inventory/` kimenetekben van.")
P("")
P("## 3. Meglévő rendszerelemek — állapot (bizonyíték-alapú, fixture/helyi szint)")
P("")
P("Összes meglévő elem: **%d** — %s" % (len(exist), fmt(dist(exist))))
P("")
P("> A `VERIFIED_WORKING` itt azt jelenti: a kód valódi, bekötött, a célzott teszt lefut és zöld, **helyi/fixture szinten**. Élő külső bizonyíték nincs (élő modell, Stripe, KOHO, e-mail, hang, Windows: 0).")
P("")
P("### Csoportok szerint (a kért 13 szakasz)")
P("")
gs = collections.defaultdict(list)
for r in INV:
    gs[r["group"]].append(r)
P("| Csoport | Elem | Állapot-eloszlás |")
P("|---|---:|---|")
for g in sorted(gs, key=lambda x: (x.startswith("TERVEZETT"), x)):
    P("| %s | %d | %s |" % (g, len(gs[g]), fmt(dist(gs[g]))))
P("")
P("A teljes számozott lista: **`LELTAR_TELJES_LISTA.md`** (és `inventory_items.csv`). Minden sorban: azonosító, megnevezés, állapot, kapcsolódó követelmény, hiányosság, javítási terv, becsült idő.")
P("")
P("### Hibás vagy hiányos meglévő elemek (nem VERIFIED_WORKING)")
P("")
bad = [r for r in exist if r["status"] not in ("VERIFIED_WORKING", "N/A")]
P("Összesen **%d** meglévő elem nem teljesen igazolt: %s. A legsúlyosabbak (BROKEN / ismert hibával / P0–P1):" % (len(bad), fmt(dist(bad))))
P("")
P("| ATL | Elem | Állapot | Ismert hiba / hiány | Munka |")
P("|---|---|---|---|---|")
for r in sorted(bad, key=lambda r: (r["priority"] or "P9", r["id"])):
    if r["priority"] in ("P0", "P1") or r["status"] == "BROKEN" or r["status"] == "LEGACY_QUARANTINED":
        P("| %s | %s | %s | %s | %s |" % (r["id"], esc(short(r["name"], 60)), r["status"], esc(short(r["known_defects"] if r["known_defects"] and not r["known_defects"].startswith("nincs") else r["missing"], 110)), r["work_ids"].replace("; ", ", ")))
P("")
P("## 4. Eredeti követelménylista összevetése a rendszerrel")
P("")
P("Minden követelmény-sorhoz (`requirements_matrix.csv`) megvan: megtalálható-e (IGEN / RÉSZBEN / NEM), melyik ATL-komponens, működési szint, bekötöttség, hiányzó funkció, szükséges fejlesztés, tervezett modul-azonosító, munka-azonosító és becsült óra (megvalósítás + ellenőrzés).")
P("")
P("**A 23 fejezet sorai (%d sor)**: %s" % (len(reqs23), fmt(dist(reqs23))))
P("")
chap = collections.defaultdict(list)
for r in reqs23:
    chap[int(r["chapter"])].append(r)
P("| Fejezet | Sor | VERIFIED | PARTIAL | CONN.UNT. | STRUCT. | MOCK | EXT.BLOCK. | OWNER | BROKEN | **MISSING** | cím/leíró (N/A) |")
P("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for ch in sorted(chap):
    c = collections.Counter(r["status"] for r in chap[ch])
    P("| %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | **%d** | %d |" % (ch, len(chap[ch]), c["VERIFIED_WORKING"], c["PARTIAL"], c["CONNECTED_UNTESTED"], c["STRUCTURAL_ONLY"], c["MOCK_ONLY"], c["EXTERNAL_BLOCKER"], c["OWNER_APPROVAL_REQUIRED"], c["BROKEN"], c["MISSING"], c["N/A"]))
P("")
for st, label in (("CAP", "Eredeti 85 képesség"), ("SIR", "23 biztonsági és infrastruktúra-követelmény"), ("FUT", "150 jövőbeli fejlesztési ötlet — HALASZTOTT, NEM aktivált")):
    rows = [r for r in REQ if r["set"] == st]
    P("* **%s** (%d tétel): %s" % (label, len(rows), fmt(dist(rows))))
P("")
P("A 150 ötletből a nem teljesen igazolt tételek külön, `P5 / HALASZTOTT` munkaként szerepelnek (`V2_DEFERRED_IDEA`); **egyiket sem indítom el** a döntésedig.")
P("")
P("## 5. Hiányzó (MISSING) követelmények → tervezett modulok")
P("")
miss = [r for r in reqs23 if r["status"] == "MISSING"]
P("A 23 fejezetben **%d** sor MISSING (ebből %d valódi követelmény, a többi cím/bevezető sor) (+ %d további direktíva-sor, amelyhez nincs kód). Mindegyik kapott saját állandó követelmény-azonosítót (ATL-REQ-…), tervezett modul/bővítés azonosítót (ATL-PLN-…), kapcsolódó meglévő modulokat, szükséges bekötést, munka-azonosítót és becsült órát. **A tervezett modulok PLANNED állapotúak: még nem léteznek.**" % (len(miss), sum(1 for r in miss if r["kind"] == "REQUIREMENT"), sum(1 for d in DIR if d["planned_module_id"] and d["status"] == "MISSING")))
P("")
P("| ATL-PLN | Tervezett elem | Fajta | Állapot | Követelmény (db) | Direktíva-sor (db) | Meglévő modulokhoz kötés | Óra (impl+ell) | Prior. | Munka |")
P("|---|---|---|---|---:|---:|---|---:|---|---|")
for p in PLN:
    P("| %s | %s | %s | %s | %s | %s | %s | %s+%s | %s | %s |" % (p["id"], esc(short(p["name"], 105)), p["kind"], p["status"], p["requirement_count"], p["directive_item_ids_count"], esc(short(p["related_existing_names"], 90)),
                                                    p["est_impl_h"], p["est_verify_h"], p["priority"], p["work_id"]))
P("")
P("Részletek (kapcsolatok, bekötés, elfogadási feltétel): `planned_modules.csv`; melyik követelmény melyik tervezett modulhoz tartozik: `requirements_matrix.csv` (`planned_module_id`).")
P("")
P("## 6. Munkaterv")
P("")
P("A korábbi 340 soros munkalista **teljesen megmaradt** (ATL-WRK-0001…), és kibővült. Összesen **%d** feladat; számozott, függőségekkel, becsült idővel, ellenőrzési módszerrel és elfogadási feltétellel: **`MUNKATERV.md`** / `work_plan.csv`." % len(WORK))
P("")
P("| Eredet | Feladat | Aktív óra |")
P("|---|---:|---:|")
orig = collections.defaultdict(lambda: [0, 0.0])
for w in WORK:
    orig[w["origin"]][0] += 1
    if w["counted_in_active_plan"] == "IGEN":
        orig[w["origin"]][1] += float(w["est_total_h"])
NAMES = {"V1_WORKLIST": "Korábbi 340 soros lista (megőrizve)", "V2_COMPONENT": "Új: további meglévő komponensek hiányai", "V2_PLANNED_MODULE": "Új: tervezett modulok/bővítések megvalósítása+ellenőrzése",
         "V2_REQ_GAP": "Új: követelmény-hiányok lezárása (komponens nélkül)", "V2_DIRECTIVE_GAP": "Új: direktíva-sorok lezárása", "V2_DECISION": "Új: tulajdonosi döntések előkészítése",
         "V2_FINDING": "Új: ellentmondások/megállapítások lezárása", "V2_DEFERRED_IDEA": "Halasztott ötletek (150-es lista) — nem aktív", "V2_FINAL": "Végső teljes vizsgálat + leltár-karbantartás", "V2_CORRECTION": "Új: korrekciók"}
for k, v in sorted(orig.items(), key=lambda kv: -kv[1][0]):
    P("| %s | %d | %s |" % (NAMES.get(k, k), v[0], f1(v[1]) if k != "V2_DEFERRED_IDEA" else "— (tájékoztató: %s)" % f1(sum(float(w["est_total_h"]) for w in WORK if w["origin"] == k))))
P("")
pr = collections.Counter(w["priority"] for w in WORK)
P("Prioritás-eloszlás: " + ", ".join("%s: %d" % (k, pr[k]) for k in sorted(pr)) + ". (P0 adatvesztést/hamis biztonságot okozó hiba · P1 ismert hiba · P2 bekötés/teszt/biztonság/alapfunkció · P3 részleges modul/bővítés · P4 külső hozzáférés/tulajdonosi döntés függő · P5 halasztott, nem aktivált.)")
P("")
P("### P0–P2 feladatok (a legsürgősebbek, javaslatként)")
P("")
P("| Sorszám | ATL-WRK | Prior. | Feladat | Óra | Függ |")
P("|---:|---|---|---|---:|---|")
for w in WORK:
    if w["priority"] in ("P0", "P1", "P2"):
        P("| %s | %s | %s | %s | %s | %s |" % (w["no"], w["id"], w["priority"], esc(short(w["title"], 110)), w["est_total_h"], esc(short(w["depends_on"], 50))))
P("")
P("## 7. Halasztott tételek (külön jelölve, NEM aktiválva)")
P("")
for p in PLN:
    if p["kind"] == "DEFERRED":
        P("* **%s** — %s (%s). Tulajdonosi feltétel: %s" % (p["id"], short(p["name"], 200), p["status"], p["owner_decision"]))
P("* **150 jövőbeli ötlet:** %d nem teljesen igazolt tétel P5 feladatként nyilvántartva, aktiválás nélkül." % sum(1 for w in WORK if w["origin"] == "V2_DEFERRED_IDEA"))
P("* A direktívákban halasztottként jelölt sorok: %d (robot, 300 ügynök, VIRENA stb. — `directive_items.csv`, `deferred` oszlop)." % sum(1 for d in DIR if d["deferred"]))
P("")
P("## 8. Tulajdonosi döntések, amelyek az ütemezéshez kellenek (%d)" % len(DEC))
P("")
for d in DEC[:60]:
    P("* **%s** — %s%s" % (d["id"], short(d["name"], 130), (" · részlet: " + short(d["detail"], 150)) if d["origin"] != "PLANNED_MODULE" else ""))
P("")
P("## 9. Megállapítások a direktíva-sorok átvizsgálásából (%d)" % len(FND))
P("")
fc = collections.Counter((f["kind"], f["subtype"], f["status"]) for f in FND)
for k, v in sorted(fc.items()):
    P("* %s / %s / %s: %d" % (k[0], k[1], k[2], v))
P("")
P("Ezek jellemzően dokumentáció↔kód eltérések (pl. egy régi regiszter `MISSING`, de a kód létezik; vagy ellenkezőleg) és olyan útvonalak, amelyeket az átvizsgáló nem talált a leltárban. A nyilvántartott útvonalak automatikusan feloldódtak (`RESOLVED_BY_V2_REGISTRATION`).")
P("")
P("## 10. Kötelező ellenőrzések (a jelentés előtt)")
P("")
P("| Ellenőrzés | Eredmény | Részlet |")
P("|---|---|---|")
for c in V["checks"]:
    P("| %s | %s | %s |" % (esc(c["check"]), "✔" if c["ok"] else ("✘ " + c["level"]), esc(short(c["detail"], 100))))
P("")
P("Hibák: **%d**, figyelmeztetések: **%d**." % (V["errors"], V["warnings"]))
P("")
P("## 11. Lekérdezés bármely ATL-azonosítóra")
P("")
P("```")
P("python3 docs/system_inventory/atl_query.py ATL-UIX-0023        # rendszerelem")
P("python3 docs/system_inventory/atl_query.py ATL-REQ-0314        # követelmény")
P("python3 docs/system_inventory/atl_query.py ATL-PLN-0003        # tervezett modul")
P("python3 docs/system_inventory/atl_query.py ATL-WRK-0011 --links # munkaterv-feladat + kapcsolatok")
P("```")
P("Válasz: mi ez · létezik-e · működik-e és milyen bizonyítási szinten · mi hiányzik · mihez kell kötni · pontosan milyen munka kell (óra, ellenőrzés, elfogadás) · mely követelmény igényli. Ugyanez SQL-ben: `atlasz_system_inventory.sqlite` (`all_ids` nézet, `links` tábla).")
P("")
P("## 12. Módszer és őszinte korlátok")
P("")
P("* **Állapotok.** Az 1. kiadás állapotszabálya változatlan (kód + bekötés + teszt + ismert hiba + kapcsolt követelmények). A tervezett elemek állapota mindig PLANNED/PLANNED_EXTEND/PLANNED_DEFERRED/DECISION_PENDING — soha nem működő státusz.")
P("* **Direktíva-sorok besorolása.** A 12 476 sort 20 csak-olvasás átvizsgálási menet sorolta be (követelmény / szabály / folyamat / leírás / halasztott), a rendszerelemekhez gépi (tf-idf) tippekkel és kézi/szabályalapú ellenőrzéssel rendelve. Ez **nem** minden sor kézi, emberi jóváhagyása: a pontosság mintavétellel ellenőrizhető (`directive_items.csv`: `evidence`, `notes`). A duplikált sorok (%d) az eredeti sorra hivatkoznak; a rövid/cím sorok (%d) önálló követelmény nélküliek." % (sum(1 for d in DIR if d["assessment_mode"] == "DUPLICATE_OF"), sum(1 for d in DIR if d["assessment_mode"].startswith("AUTO_"))))
P("* **Órabecslés.** Állapot-alapú normák: PARTIAL 3+1,5 ó, CONNECTED_UNTESTED 1+2, STRUCTURAL_ONLY 3+2, MOCK_ONLY 2+3, EXTERNAL_BLOCKER 3+4, BROKEN 4+2, NOT_YET_VERIFIED 0+1,5; a v1 'részleges' sorok a kapcsolt hiányzó követelmények számával skálázva (cap 16+8); a P0/P1 hibák egyenként becsültek; új modulok a katalógusban modulonként becsültek (`pln_catalog.py`). A követelményenkénti óra a feladat óráinak arányos szétosztása, ezért az összeg egyezik a feladat-összeggel (a követelmény nélküli feladatokat leszámítva) — **nem additív a komponens-szintű nézettel**.")
P("* **Nincs élő bizonyíték.** Egyetlen külső rendszer sem lett kipróbálva (élő modell, Stripe, KOHO, e-mail, hang, Windows). A számlázott ≠ fizetett, a piszkozat ≠ elküldött, ismeretlen bevétel/költség sosem nulla elvek változatlanok.")
P("* **Mit nem csináltam.** Nem módosítottam futó kódot, nem építettem meg tervezett modult, nem aktiváltam külső szolgáltatást, nem vállaltam költséget; a `main` ágat nem érintettem.")
P("")
P("## 13. Megállok — a döntés a tiéd")
P("")
P("A fejlesztés sorrendjét te határozod meg. A munkamódszer, amikor jóváhagyod: **EGY MODUL → teljes megépítés/javítás → bekötés → tesztelés → hibajavítás → igazolt lezárás → KÖVETKEZŐ MODUL**, a végén ZERO TOLERANCE teljes vizsgálat (`ATL-WRK` végső feladat). A döntésekhez a P0–P2 lista (6. pont) és a tulajdonosi döntések (8. pont) adnak alapot; a korábban jelzett első jelölt: **ATL-UIX-0023** (D-01 nézet-összeomlás, ~5 óra).")
open(os.path.join(OUT, "RENDSZERLELTAR_V2_JELENTES.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

# ------------------------------------------------------------------ full numbered inventory
M = ["# ATLASZ AURÓRA V7.3 — TELJES SZÁMOZOTT RENDSZERLELTÁR (meglévő + tervezett)", "",
     "Generálva: 2026-10-12 · `%s` · sorok: %d. **A TERVEZETT sorok nem léteznek.** A teljes adat: `inventory_items.csv`. Lekérdezés: `atl_query.py <ATL-id>`." % (HEAD, len(INV)), ""]
by_group = collections.defaultdict(list)
for r in INV:
    by_group[r["group"]].append(r)
n = 0
for g in sorted(by_group, key=lambda x: (x.startswith("TERVEZETT"), x)):
    M.append("## %s (%d)" % (g, len(by_group[g])))
    M.append("")
    M.append("| # | ATL | Megnevezés | Állapot | Követelm. (db) | Hiányosság | Javítási/fejlesztési terv | Munka | Becsült óra |")
    M.append("|---:|---|---|---|---:|---|---|---|---:|")
    for r in sorted(by_group[g], key=lambda r: r["id"]):
        n += 1
        M.append("| %d | %s | %s | %s | %s | %s | %s | %s | %s |" % (n, r["id"], esc(short(r["name"], 80)), r["status"], r["requirement_count"], esc(short(r["missing"] if r["missing"] and r["missing"] != "-" else "", 110)),
                                                           esc(short(r["fix_plan"], 110)), esc(short(r["work_ids"], 40)), r["est_total_h"]))
    M.append("")
open(os.path.join(OUT, "LELTAR_TELJES_LISTA.md"), "w", encoding="utf-8").write("\n".join(M) + "\n")

# ------------------------------------------------------------------ numbered work plan
W = ["# ATLASZ AURÓRA V7.3 — SZÁMOZOTT MUNKATERV (kibővített, %d feladat)" % len(WORK), "",
     "Generálva: 2026-10-12 · `%s`. **Csak terv — a fejlesztés nincs engedélyezve.** Sorrend: prioritás, azon belül azonosító. Az órák becslések. A P5 sorok halasztottak, nem aktív terv." % HEAD, "",
     "Aktív terv: %d feladat, %s óra · halasztott: %d feladat, %s óra (tájékoztató)." % (len(actW), f1(hA), len(defW), f1(hD)), "",
     "A feladat-sorokban a „függ” oszlop azt jelenti: előbb ezeknek kell lezárulniuk (ATL-WRK vagy ATL-DEC). A „ALL_ACTIVE_TASKS” a végső vizsgálat.", ""]
cur = None
for w in WORK:
    if w["priority"] != cur:
        cur = w["priority"]
        W.append("## %s" % {"P0": "P0 — adatvesztést/hamis biztonságot okozó hibák", "P1": "P1 — ismert hibák", "P2": "P2 — bekötés, teszt, biztonság, alapfunkció", "P3": "P3 — részleges modulok, bővítések, új modulok",
                            "P4": "P4 — külső hozzáférés / tulajdonosi döntés függő", "P5": "P5 — HALASZTOTT (nem aktivált)"}[cur])
        W.append("")
        W.append("| # | ATL-WRK | Eredet | Feladat | ATL-elemek | Pontos munka | Függ | Óra (impl+ell) | Ellenőrzés | Elfogadási feltétel |")
        W.append("|---:|---|---|---|---|---|---|---:|---|---|")
    comps_ = w["atl_component_ids"].replace("; ", ", ")
    if w["planned_module_id"]:
        comps_ = (w["planned_module_id"] + " | " + comps_).strip(" |")
    W.append("| %s | %s | %s | %s | %s | %s | %s | %s+%s | %s | %s |" % (w["no"], w["id"], w["origin"].replace("V2_", "").replace("V1_", ""), esc(short(w["title"], 120)), esc(short(comps_, 120)), esc(short(w["exact_work"], 260)),
                                                                  esc(short(w["depends_on"], 70)), w["est_impl_h"], w["est_verify_h"], esc(short(w["verification_method"], 70)), esc(short(w["acceptance_criteria"], 200))))
open(os.path.join(OUT, "MUNKATERV.md"), "w", encoding="utf-8").write("\n".join(W) + "\n")
print("report lines", len(L), "inventory md rows", n, "work", len(WORK), "active h", f1(hA), "deferred h", f1(hD))
