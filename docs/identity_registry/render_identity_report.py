#!/usr/bin/env python3
"""Renders the human-readable Hungarian report and the work-list CSVs from atlasz_id_registry.json (RECORDS ONLY)."""
import json, csv, os, collections

OUT = "docs/identity_registry"
R = json.load(open(os.path.join(OUT, "atlasz_id_registry.json"), encoding="utf-8"))
C = R["components"]; REQ = R["requirements"]; SRC = R["source_sets"]; LINKS = R["links"]
CATS = R["categories"]
CID = {c["id"]: c for c in C}
ST = ["VERIFIED_WORKING", "PARTIAL", "STRUCTURAL_ONLY", "CONNECTED_UNTESTED", "MOCK_ONLY", "MISSING", "BROKEN", "EXTERNAL_BLOCKER", "OWNER_APPROVAL_REQUIRED", "NOT_YET_VERIFIED"]
IMPL = [c for c in C if c["category"] not in ("TST", "CHK", "TPL")]   # runtime components (code, endpoints, views, agents, integrations ...)
FILEC = [c for c in IMPL if c["kind"] == "SOURCE_FILE"]

def w(rows, name, cols):
    with open(os.path.join(OUT, name), "w", encoding="utf-8-sig", newline="") as f:
        x = csv.writer(f); x.writerow(cols)
        for r in rows:
            x.writerow([("; ".join(map(str, r[c])) if isinstance(r.get(c), list) else r.get(c, "")) for c in cols])

# ---- gap files
nocomp = [r for r in REQ if not r["component_ids"]]
w([dict(atl_id=r["atl_id"], legacy_id=r["legacy_id"], chapter=r["chapter"], part=r["part"], kind=r["kind"], status=r["status"], deferred=r["deferred"], source_text=r["source_text"][:200], missing=r["missing"], fix=r["fix"], external=r["external"], owner_decision=r["owner_decision"]) for r in nocomp],
  "requirements_without_component.csv", ["atl_id", "legacy_id", "chapter", "part", "kind", "status", "deferred", "source_text", "missing", "fix", "external", "owner_decision"])
noreq = [c for c in C if not c["requirement_ids"] and c["category"] not in ("TST", "CHK", "TPL")]
w(noreq, "components_without_requirement.csv", ["id", "name", "category", "status", "function"])

# ---- work list (identifier based)
work = []
def add(pri, ids, title, action, reqs="", dep=""):
    work.append({"priority": pri, "component_ids": ids if isinstance(ids, list) else [ids], "title": title, "required_action": action, "requirement_ids": reqs, "external_dependency": dep})
name2id = {c["natural_key"]: c["id"] for c in C}
for d in R["defects"]:
    ids = [name2id[k] for k in d["component_keys"] if k in name2id]
    pri = "P0" if d["id"] in ("D-01", "D-02", "D-03", "D-04", "D-05", "D-08", "D-11") else ("P1" if d["id"] in ("D-06", "D-07", "D-09", "D-12") else "P3")
    add(pri, ids, "%s: %s" % (d["id"], d["title"]), "hibajavítás tulajdonosi jóváhagyás után (lásd ELLENORZESI_JELENTES.md)")
for c in IMPL:
    if c["kind"] == "SOURCE_FILE" and c["status"] == "CONNECTED_UNTESTED":
        add("P2", c["id"], "Be van kötve, de nincs közvetlen tesztje: " + c["name"], "tesztek írása (egység + integráció)")
    if c["kind"] == "SOURCE_FILE" and c["status"] == "STRUCTURAL_ONLY":
        add("P2", c["id"], "Csak váz / nincs bekötés vagy teszt: " + c["name"], "kézi megerősítés (dinamikus betöltés?), majd bekötés + teszt, vagy tulajdonosi döntés a megtartásról")
    if c["status"] == "MOCK_ONLY":
        add("P4", c["id"], "Csak fake/fixture teszt: " + c["name"], "valódi környezeti próba tulajdonosi engedéllyel", dep="külső szolgáltatás / hitelesítő adat")
    if c["status"] == "EXTERNAL_BLOCKER":
        add("P4", c["id"], "Külső blokkoló: " + c["name"], c["missing_functions"], dep="tulajdonosi hitelesítő adat / engedély / külső hozzáférés")
    if c["kind"] == "SOURCE_FILE" and c["status"] == "PARTIAL":
        add("P3", c["id"], "Részleges: " + c["name"], c["missing_functions"], reqs=";".join(c["requirement_ids"][:12]))
w(work, "work_list.csv", ["priority", "component_ids", "title", "required_action", "requirement_ids", "external_dependency"])

# ---- counts
cat_st = collections.defaultdict(collections.Counter)
for c in C: cat_st[c["category"]][c["status"]] += 1
req_only = [r for r in REQ if r["kind"] == "REQUIREMENT"]
rs = collections.Counter(r["status"] for r in req_only)
linked_req = sum(1 for r in req_only if r["component_ids"])
missing_req = [r for r in req_only if r["status"] == "MISSING"]
unlinked_nonmissing = [r for r in req_only if not r["component_ids"] and r["status"] != "MISSING"]
dist = collections.Counter(c["status"] for c in C)
dist_impl = collections.Counter(c["status"] for c in IMPL)
src_by = collections.defaultdict(collections.Counter)
for r in SRC: src_by[r["legacy_id"].split("-")[0]][r["status"]] += 1

L = []
P = L.append
P("# ATLASZ AURÓRA V7.3 – Központi azonosítórendszer és teljes rendszerleltár")
P("")
P("Dátum: 2026-10-12 · Git: `%s` · Állapot: **csak ellenőrzés és nyilvántartás – a működő rendszer kódja nem változott, hiányzó funkciót nem építettem, új szolgáltatást nem aktiváltam.**" % R["git_head"])
P("")
P("Az azonosító **nem** jelent kész állapotot. A státusz a bizonyítékból jön: a kód léte, a bekötés, a tesztek és az éles működés **külön mező**. Egyetlen külső rendszeren (Stripe, KOHO, AI-modell, e-mail, hang, Windows) sincs valódi/éles bizonyíték.")
P("")
P("## 1. Fő számok")
P("")
P("| Tétel | Darab |")
P("|---|---|")
P("| Azonosított rendszerelem (ATL-…) összesen | **%d** |" % len(C))
P("| – ebből futó rendszerelem (kód, végpont, nézet, ügynök, integráció, szolgáltató, folyamat) | %d |" % len(IMPL))
P("| – ebből teszt (ATL-TST) | %d |" % sum(1 for c in C if c["category"] == "TST"))
P("| – ebből ellenőrző eszköz / nyilvántartási dokumentum (ATL-CHK) | %d |" % sum(1 for c in C if c["category"] == "CHK"))
P("| Feldolgozott követelmény-sor (23 fejezet, A+B; ATL-REQ) | **%d** (ebből %d tényleges követelmény, %d címsor, %d kontextus) |" % (len(REQ), len(req_only), sum(1 for r in REQ if r["kind"] == "HEADING"), sum(1 for r in REQ if r["kind"] == "CONTEXT")))
P("| Eredeti 85 képesség (ATL-CAP) / 23 biztonsági-infrastruktúra (ATL-SIR) / 150 jövőbeli tétel (ATL-FUT) | %d / %d / %d |" % (sum(1 for r in SRC if r["legacy_id"].startswith("CAP85")), sum(1 for r in SRC if r["legacy_id"].startswith("SEC23")), sum(1 for r in SRC if r["legacy_id"].startswith("IDEA150"))))
P("| Követelmény↔rendszerelem kapcsolat | %d |" % len(LINKS))
P("| Megőrzött régi azonosító (megfeleltetési tábla) | %d |" % len(R["legacy_id_map"]) )
P("")
P("### Rendszerelemek állapota (az összes ATL-azonosított elem)")
P("")
P("| Állapot | Összes | Futó rendszerelem (teszt/ellenőrző eszköz nélkül) |")
P("|---|---|---|")
for s in ST: P("| %s | %d | %d |" % (s, dist.get(s, 0), dist_impl.get(s, 0)))
P("")
P("### Követelmények állapota (a %d tényleges követelmény, az ellenőrzési nyilvántartás szerint)" % len(req_only))
P("")
P("| Állapot | Darab |")
P("|---|---|")
for s in ST: P("| %s | %d |" % (s, rs.get(s, 0)))
P("")
P("## 2. Az azonosítórendszer szabályai")
P("")
P("* Formátum: `ATL-<KATEGÓRIA>-<NNNN>`; kategóriák: " + "; ".join("`%s` %s" % (k, v) for k, v in CATS.items()) + ".")
P("* Az azonosítót a **valós kódleltár** alapján osztottam ki (git által követett forrásfájlok, a Control Center végpont-térképe, az UI-nézetek, a 14 szakasz, a 30 ügynök, a szolgáltatói/connector-leírók, az ütemezők). Kategóriánként növekvő sorszám, a természetes kulcs (fájlútvonal / ügynök-név / végpont / nézet / szakasz-név) szerint.")
P("* **Állandóság:** a `id_ledger.json` rögzíti: természetes kulcs → azonosító. Újrafuttatáskor a kiosztott azonosító nem változik; egy eltűnt kulcs `RETIRED` lesz, **az azonosítója soha nem osztható ki újra**; verzióváltáskor/javításkor az azonosító marad. A `history.jsonl` csak bővül (kiosztás, visszavonás, névváltozás, újraaktiválás).")
P("* **Meglévő azonosítók megőrizve** (nem lettek átírva, a futó rendszer által használt azonosítók érintetlenek): V7.3 mester-regiszter `V73-…` (983), Master Execution Tracker feladat-azonosítók, `GAP-…`, `CAP85/M##`, `PKG150-…`, hibaregiszter `DEF-…`, a mostani ellenőrzés `D-01…D-12` és sor-azonosítói (`C01A-L45` …), modul-azonosítók (`module_dispositions`), ügynök-nevek (`SEARCH-1…EXECUTION-25`), connector-/szolgáltató-azonosítók, milestone-hivatkozások. Mindegyik a `legacy_id_map.csv`-ben (%d sor) az ATL-azonosítóhoz vagy a kapcsolódó komponensekhez van kötve." % len(R["legacy_id_map"]))
P("* Nem létező azonosító-rendszerek: tesztnek korábban **nem volt** külön azonosítója (a fájlnév volt az – megfeleltetve ATL-TST-hez); futásidejű projekt-azonosító nincs a statikus forrásban (a `shared-project-registry` futás közben állít elő ilyet) – ezeket nem találtam ki.")
unk_ver = sum(1 for c in C if c["version"] == "UNKNOWN"); unk_fn = sum(1 for c in C if c["function"] == "UNKNOWN")
P("* A 3. pont **20 adatlap-mezője** minden rendszerelemnél szerepel (`components.csv` / JSON). Ismeretlen adat `UNKNOWN`, nem találtam ki: verzió %d elemnél (nincs deklarált verzió), feladat-leírás %d elemnél (nincs fejléc-megjegyzés és export). Ahol nincs fejléc, de van export, a leírás a forrás export-neveiből származik, és így van jelölve." % (unk_ver, unk_fn))
P("* Géppel feldolgozható formák: `atlasz_id_registry.json`, `atlasz_id_registry.sqlite` (táblák: components, requirements, source_sets, req_component_links, component_relations, component_tests, legacy_ids, id_ledger, history), CSV-k. Újraépítés: `python3 docs/identity_registry/build_identity_registry.py` majd `render_identity_report.py` (csak olvas, a futó rendszer kódját nem érinti).")
P("")
P("## 3. Rendszerelemek kategóriánként és állapotonként")
P("")
P("| Kategória | Összes | " + " | ".join(s.replace("_", " ") for s in ST) + " |")
P("|---|---|" + "---|" * len(ST))
for k in CATS:
    if k in ("REQ", "CAP", "SIR", "FUT"): continue
    n = sum(cat_st[k].values())
    if n: P("| `%s` %s | %d | " % (k, CATS[k], n) + " | ".join(str(cat_st[k].get(s, 0)) for s in ST) + " |")
P("")
P("**Állapot-szabály (levezetve, nem szubjektív):** egy forrásfájl-komponens VERIFIED_WORKING, ha van (közvetlen) tesztje 0 bukással, be van kötve a futó rendszerbe (integration_matrix vagy statikus import-lánc), nem külső-érintkező modul, nincs ismert hibája, és **egyetlen kapcsolt követelménye sem gyengébb** VERIFIED_WORKING-nál. Ha tesztelt, de kapcsolt követelményei részlegesek/hiányzóak → PARTIAL. Külső-érintkező modul (adapter/connector/hang/webhook) fake/fixture teszttel → MOCK_ONLY. Teszt nélkül bekötve → CONNECTED_UNTESTED; teszt és bekötés nélkül → STRUCTURAL_ONLY. Külső szolgáltatás (Stripe, KOHO, AI-szolgáltató, connector, chat-platform) → EXTERNAL_BLOCKER, mert nincs hitelesítő adat és kapcsolati bizonyíték. VERIFIED_WORKING = fixture/helyi szinten igazolt, **nem** éles.")
P("")
P("## 4. Követelmény-nyilvántartás és a teljes megfeleltetés")
P("")
P("* Minden követelmény-sor kapott `ATL-REQ-NNNN` azonosítót (+ megmaradt az eredeti `C##A/B-L###` sorazonosító). A hiányzó követelmények is megmaradtak.")
P("* Kapcsolt (van legalább egy rendszerelem): **%d** a %d tényleges követelményből; 1 követelményhez több rendszerelem, 1 elemhez több követelmény tartozhat (`requirement_component_links.csv`, %d kapcsolat; reláció-típus: IMPLEMENTED_BY_FILE, EXPOSED_BY_ENDPOINT, VERIFIED_BY_TEST, RECORDED_IN_DOCUMENT, MENTIONS_*, ROSTER_MEMBER_VIA_REGISTRY)." % (linked_req, len(req_only), len(LINKS)))
P("* Rendszerelem nélküli követelmény: **%d** (`requirements_without_component.csv`): ebből **%d MISSING** (nincs megvalósított modul – szándékosan megőrizve), %d nem MISSING, de nincs azonosítható kódfájl (dokumentum-/folyamat-jellegű vagy könyvtár-hivatkozás: pl. „atlasz-tests/”, adatbázis-ág, commit-azonosító sor)." % (sum(1 for r in req_only if not r["component_ids"]), sum(1 for r in req_only if not r["component_ids"] and r["status"] == "MISSING"), len(unlinked_nonmissing)))
nr_kind = collections.Counter(c["kind"] for c in noreq)
P("* Követelmény nélküli futó rendszerelem: **%d** (`components_without_requirement.csv`): %s. A forrásdokumentum sorai ezeket nem nevesítették fájl/végpont szinten (a nézeteket és végpontokat a követelmény-sorok csak részben hivatkozzák), vagy a komponens kutatási/kiegészítő jellegű (pl. kereskedelmi-kutatási modulok, `registrations/*`, a böngészőbővítmény fájljai). Ez **nem** jelenti, hogy felesleges vagy kész: tulajdonosi besorolás kell, hogy tartozzon-e hozzá külön követelmény." % (len(noreq), ", ".join("%s %d" % (k, v) for k, v in nr_kind.most_common())))
P("* A 85 / 23 / 150 külön forrásdokumentum-tételei: ")
for k, nm in (("CAP85", "85 képesség"), ("SEC23", "23 biztonsági és infrastruktúra"), ("IDEA150", "150 jövőbeli tétel")):
    P("  * %s: %d tétel – %s." % (nm, sum(src_by[k].values()), ", ".join("%s %d" % (s, n) for s, n in src_by[k].most_common())))
P("  * A **halasztott** (deferred) tételeket nem minősítettem automatikusan megvalósítandónak: a `deferred` mező megmaradt, a státusz az aktuális kódot írja le.")
P("")
P("## 5. Kész és igazolt (VERIFIED_WORKING) rendszerelemek – fixture/helyi szinten, NEM éles")
P("")
vw_files = [c for c in FILEC if c["status"] == "VERIFIED_WORKING"]
P("Forrásfájl-modulok (%d):" % len(vw_files))
P("")
P("| ID | Név | Teszt (gate 2026-10-12) |")
P("|---|---|---|")
for c in vw_files: P("| %s | %s | %s |" % (c["id"], c["name"], c["test_results"].replace(" (gate 2026-10-12)", "")))
vw_api = [c for c in IMPL if c["kind"] == "HTTP_ENDPOINT" and c["status"] == "VERIFIED_WORKING"]
vw_ui = [c for c in IMPL if c["kind"] == "UI_VIEW" and c["status"] == "VERIFIED_WORKING"]
P("")
P("Végpontok: %d GET/POST végpont VERIFIED_WORKING (helyi smoke 200 vagy route-teszt) – lista: `components.csv` (kategória `API`). UI-nézetek: %d / %d nézet hibátlanul betölt – **csak megjelenítés**, a mögöttes funkció a saját komponensének státuszát követi." % (len(vw_api), len(vw_ui), sum(1 for c in IMPL if c["kind"] == "UI_VIEW")))
P("")
P("## 6. Részleges (PARTIAL) rendszerelemek")
P("")
pa = [c for c in IMPL if c["status"] == "PARTIAL"]
P("%d elem (ebből %d forrásfájl). Az okot a `missing_functions` mező adja (pl. kapcsolt követelmény részleges/hiányzó, vagy a futó rendszerből nem elérhető)." % (len(pa), sum(1 for c in pa if c["kind"] == "SOURCE_FILE")))
P("")
P("| ID | Név | Mi hiányzik / miért részleges |")
P("|---|---|---|")
for c in pa:
    P("| %s | %s | %s |" % (c["id"], c["name"], c["missing_functions"][:170].replace("|", "/")))
P("")
P("## 7. Hiányzó modulok és követelmények")
P("")
miss_c = [c for c in C if c["status"] == "MISSING"]
P("Hiányzó rendszerelem (az azonosítóval rendelkezők közül): " + ("; ".join("%s %s (%s)" % (c["id"], c["name"], c["missing_functions"]) for c in miss_c) or "nincs") + ".")
P("")
P("**Hiányzó követelmények (%d, mindegyik megőrizve, még nincs hozzájuk modul)** fejezetenként:" % len(missing_req))
P("")
bych = collections.Counter(r["chapter"] for r in missing_req)
P("| Fejezet | MISSING követelmény |")
P("|---|---|")
for ch in sorted(bych): P("| %s | %d |" % (ch, bych[ch]))
P("")
P("A tételes lista (ATL-REQ azonosítóval, forrásszöveggel, javasolt javítással és külső függőséggel): `requirements_without_component.csv` (a MISSING sorok) és `requirements.csv`. Az AVA kategóriában (avatár, vizuális) %d elem van, mind láthatósági/multimodális segédmodul; külön avatár-megjelenítő komponenst nem találtam a forráskódban." % sum(cat_st["AVA"].values()))
P("")
P("## 8. Hibás integrációk és ismert hibák")
P("")
P("| Hibaazonosító | Leírás | Érintett ATL-elemek |")
P("|---|---|---|")
for d in R["defects"]:
    ids = [name2id[k] for k in d["component_keys"] if k in name2id]
    P("| %s | %s | %s |" % (d["id"], d["title"], ", ".join(ids)))
P("")
brk = [c for c in C if c["status"] == "BROKEN"]
P("BROKEN státuszú elem: " + "; ".join("%s %s" % (c["id"], c["name"]) for c in brk) + ".")
P("")
P("## 9. Tesztekkel nem igazolt funkciók")
P("")
unt = [c for c in IMPL if c["kind"] == "SOURCE_FILE" and c["status"] in ("CONNECTED_UNTESTED", "STRUCTURAL_ONLY")]
P("%d forrásfájl-elem: bekötve de tesztelés nélkül (CONNECTED_UNTESTED) vagy csak váz (STRUCTURAL_ONLY). A STRUCTURAL_ONLY elemeknél a statikus elemzés nem látja a dinamikus import/Worker/child_process betöltést – kézi megerősítés kell." % len(unt))
P("")
P("| ID | Név | Állapot |")
P("|---|---|---|")
for c in unt: P("| %s | %s | %s |" % (c["id"], c["name"], c["status"]))
P("")
P("Végpontok teszt nélkül: " + ", ".join("%s" % c["id"] for c in IMPL if c["kind"] == "HTTP_ENDPOINT" and c["status"] == "CONNECTED_UNTESTED") + " (kizárólag állapotváltoztató POST-ok, amelyeket a smoke szándékosan nem hívott, és nincs route-tesztjük).")
P("")
P("## 10. Külső hozzáférés miatt blokkolt vagy csak mock szinten tesztelt")
P("")
ext = [c for c in C if c["status"] in ("EXTERNAL_BLOCKER", "MOCK_ONLY", "OWNER_APPROVAL_REQUIRED")]
P("| ID | Név | Állapot | Mi kell |")
P("|---|---|---|---|")
for c in ext: P("| %s | %s | %s | %s |" % (c["id"], c["name"], c["status"], c["missing_functions"][:140].replace("|", "/")))
P("")
P("## 11. Azonosítókra épülő javítási munkalista (NEM kezdtem el)")
P("")
wl = collections.Counter(x["priority"] for x in work)
P("`work_list.csv` – %d sor: %s. P0 = adatvesztést/hamis biztonságot okozó hiba; P1 = ismert hiba; P2 = teszt/bekötés hiányzik; P3 = részleges modul kiegészítése; P4 = külső hozzáférés / tulajdonosi döntés." % (len(work), ", ".join("%s: %d" % (k, wl[k]) for k in sorted(wl))))
P("")
P("| Prioritás | Azonosítók | Feladat |")
P("|---|---|---|")
for x in work:
    if x["priority"] in ("P0", "P1", "P3") and x["title"].startswith("D-"):
        P("| %s | %s | %s |" % (x["priority"], ", ".join(x["component_ids"]), x["title"]))
P("")
P("## 12. Korlátok és őszinte megjegyzések")
P("")
P("* A rendszerelem-státusz **levezetett** (lásd a 3. fejezet szabályát) az integration_matrix (2026-10-11), a gate-eredmények (2026-10-12, 245 tesztfájl), a statikus import-lánc és az ellenőrzési követelmény-státuszok alapján. A teszt→modul kapcsolat közvetlen import/útvonal-hivatkozás (és közvetett: a modult importáló komponens tesztje); dinamikus betöltést nem lát.")
P("* A 'bekötve' = statikus import-lánc a Control Center, runtime vagy Electron belépési pontjából vagy az integration_matrix futási-betöltés jelzése. Ez nem bizonyítja, hogy minden funkciót valaki meg is hív.")
P("* **Nincs valós/éles bizonyíték**: modell, Stripe, KOHO, e-mail, hang, Windows (avatárhoz pedig nincs megjelenítő komponens). Ezek EXTERNAL_BLOCKER, MOCK_ONLY vagy hiányzó besorolásúak; nincs Windows-teszt, ezért Windows-állítás nem szerepel.")
P("* A verzió-mező ismeretlen, ahol a forrás nem deklarál verziót (`UNKNOWN`). A git-commit mezők az utolsó, a fájlt érintő commitot adják.")
P("* A V7.3 mester-regiszter (983 sor) és a régi hiány-/tracker-azonosítók **nem lettek automatikusan** ATL-REQ-hez kötve (más forrásdokumentum); csak a komponens-útvonalak szerinti kapcsolat van meg a `legacy_id_map.csv`-ben.")
P("* A kategóriaszabály (melyik fájl melyik területhez tartozik) fájlnév-alapú kézi besorolás; vitás esetben a tulajdonos átsorolhat – az azonosító ilyenkor sem változik (a kategória csak címke a nyilvántartásban).")
P("")
P("## 13. Következő lépés")
P("")
P("Megállok. A javítási munkalistáról, a külső hozzáférésekről és a halasztott tételek besorolásáról kizárólag a tulajdonos dönt. Fejlesztést, javítást nem kezdek.")
open(os.path.join(OUT, "RENDSZERLELTAR_JELENTES.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("report lines", len(L), "work", len(work), dict(wl), "nocomp", len(nocomp), "noreq", len(noreq))
