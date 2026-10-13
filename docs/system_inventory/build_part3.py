# -*- coding: utf-8 -*-
# Part 3: aggregation, requirement matrix, unified inventory, validation, outputs (executed in the same namespace). RECORDS ONLY.

PRI_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3, "P4": 4, "P5": 5}
STATUS_HU = {
 "VERIFIED_WORKING": "helyi/fixture szinten igazoltan működik (NEM élő bizonyíték)", "PARTIAL": "részben működik", "STRUCTURAL_ONLY": "csak váz: nincs bekötve vagy tesztelve",
 "CONNECTED_UNTESTED": "bekötve, de közvetlen teszt nincs", "MOCK_ONLY": "csak fixture/mock teszt, valódi rendszeren nem próbált", "MISSING": "nincs megvalósítva",
 "BROKEN": "hibás", "EXTERNAL_BLOCKER": "külső függőség/engedély miatt nem ellenőrizhető", "OWNER_APPROVAL_REQUIRED": "tulajdonosi jóváhagyás szükséges",
 "NOT_YET_VERIFIED": "nincs ellenőrizve", "LEGACY_QUARANTINED": "karanténban lévő régi fájl, nem működő rendszerelem", "N/A": "nem értékelendő (cím/folyamat/leírás)",
 "PLANNED": "TERVEZETT új modul, még NEM létezik", "PLANNED_EXTEND": "TERVEZETT bővítés meglévő komponensen (a bővítés még NEM létezik)",
 "PLANNED_DEFERRED": "HALASZTOTT jövőbeli projekt, nem aktivált", "DECISION_PENDING": "tulajdonosi döntésre vár, munka nem ütemezhető"}
GROUPS = {"AGT": "Ügynökök", "BRN": "MASTER BRAIN", "AUR": "AURÓRA", "MDL": "AI-modellek és adapterek", "PLG": "Pluginok / skillek / eszközök", "INT": "Connectorok / integrációk",
          "API": "API-k", "FIN": "Pénzügyi és üzleti modulok", "WFL": "Pénzügyi és üzleti modulok", "RES": "Piackutatás / felderítés", "SEC": "Biztonsági rendszerek",
          "WIN": "Windows és mobil", "MOB": "Windows és mobil", "SCH": "Háttérfolyamatok és automatizálások", "OPS": "Működtetés / helyreállítás / háttér", "TST": "Tesztek és ellenőrző eszközök",
          "CHK": "Tesztek és ellenőrző eszközök", "UIX": "Felület", "AVA": "Felület / avatár / multimodális", "VOI": "Beszéd és hang", "DOC": "Dokumentum és kommunikáció", "MEM": "Memória és tudás",
          "LRN": "Tanulás és produktivitás", "DEV": "Fejlesztő-asszisztens", "TPL": "Nem ATLASZ sablon", "PLN": "TERVEZETT (új/bővítendő) modul"}
CATS_ALL = {}
CATS_ALL.update({k: v for k, v in (json.load(open(os.path.join(V1, "atlasz_id_registry.json"), encoding="utf-8"))["categories"]).items()})
CATS_ALL.update(CATS_V2)

# component -> requirement map (inverse links) and source-set components
COMP_REQS = collections.defaultdict(set)
for rid, lst in REQ_LINKS.items():
    for c, rel in lst:
        COMP_REQS[c].add(rid)
for a, r in SRCSET.items():
    for c in ids_in(r["component_ids"]):
        COMP_REQS[c].add(a)
ALL_REQ_ROWS = {**REQ, **SRCSET}

def needs_work(a):
    r = ALL_REQ_ROWS[a]
    kind = r.get("kind", "REQUIREMENT")
    return r["status"] in NONVER and kind not in ("HEADING", "CONTEXT")

# task -> requirement set (hours apportioning)
def task_reqs(w):
    if w["origin"] in ("V1_WORKLIST", "V2_COMPONENT"):
        s = set()
        for c in w["component_ids"]:
            for a in COMP_REQS.get(c, ()):
                if a in ALL_REQ_ROWS and needs_work(a) and not ALL_REQ_ROWS[a].get("pln") and not a.startswith("ATL-FUT"):
                    s.add(a)
        return sorted(s)
    return [a for a in w["requirement_ids"] if a in ALL_REQ_ROWS]
for w in WORK:
    w["req_set"] = task_reqs(w)
REQ_HOURS = collections.defaultdict(lambda: [0.0, 0.0])
REQ_WORK = collections.defaultdict(list)
for w in WORK:
    if not w["req_set"]:
        continue
    n = len(w["req_set"])
    for a in w["req_set"]:
        if not w["deferred"] or a.startswith("ATL-FUT"):
            REQ_HOURS[a][0] += w["impl_h"] / n
            REQ_HOURS[a][1] += w["ver_h"] / n
        REQ_WORK[a].append(w["id"])
# component hours / work ids
COMP_HOURS = collections.defaultdict(lambda: [0.0, 0.0])
COMP_WORK = collections.defaultdict(list)
for w in WORK:
    if w["origin"] in ("V1_WORKLIST", "V2_COMPONENT", "V2_CORRECTION") and w["component_ids"]:
        n = len(w["component_ids"])
        for c in w["component_ids"]:
            COMP_HOURS[c][0] += w["impl_h"] / n
            COMP_HOURS[c][1] += w["ver_h"] / n
            COMP_WORK[c].append(w["id"])
    elif w["origin"] == "V2_PLANNED_MODULE":
        for c in w["component_ids"]:
            COMP_WORK[c].append(w["id"])           # related only (hours stay with the planned module)
# pln refs per component
COMP_PLN = collections.defaultdict(list)
for m in PLN.values():
    for c in m["rel_ids"]:
        COMP_PLN[c].append(m["id"])

# directive item work assignment
REQ_BY_ID = ALL_REQ_ROWS
for d in DIRS:
    wk = []
    if d["pln_id"]:
        wk.append(PLN_TASK[d["pln"]]["id"])
    if d["status"] in NONVER or d["status"] == "LEGACY_QUARANTINED":
        for c in d["components"]:
            wk += [x for x in COMP_WORK.get(c, []) if WORK_BY_ID[x]["origin"] != "V2_PLANNED_MODULE"]
        if d["same_as"] in REQ_BY_ID:
            wk += REQ_WORK.get(d["same_as"], [])
    d["wrk_ids"] = list(dict.fromkeys(wk))[:12]
# fallback tasks for directive rows that need work but have none
def dir_needs_work(d):
    return d["kind"] in ("REQUIREMENT", "RULE", "DEFERRED_IDEA") and d["status"] in NONVER and not d["deferred"]
orphan_dirs = [d for d in DIRS if dir_needs_work(d) and not d["wrk_ids"] and d["mode"] != "DUPLICATE_OF"]
by_src = collections.defaultdict(list)
for d in orphan_dirs:
    by_src[(d["source_code"], d["status"])].append(d)
for (src, st), lst in sorted(by_src.items()):
    ih, vh = HOURS_STATUS.get(st, (1.0, 0.5))
    ih = min(ih * 0.5 * len(lst), 40); vh = min(vh * 0.5 * len(lst), 20)
    w = new_work("V2_DIRECTIVE_GAP", "wrk:v2:dirgap:%s:%s" % (src, st), "P4" if st in ("EXTERNAL_BLOCKER", "MOCK_ONLY", "OWNER_APPROVAL_REQUIRED") else "P3",
                 "Direktíva-sorok lezárása (%s, %s, %d sor)" % (src, st, len(lst)), "Komponens- vagy követelmény-hozzárendelés nélküli direktíva-sorok egyenkénti feloldása: " + "; ".join(short(x["text"], 60) for x in lst[:4]) + (" …" if len(lst) > 4 else ""),
                 [], dirs_=[x["id"] for x in lst], impl=ih, ver=vh, verify=DEFAULT_VERIFY, accept="Minden sor vagy követelményhez/komponenshez rendelve, vagy dokumentáltan nem-követelmény.")
    for x in lst:
        x["wrk_ids"] = [w["id"]]
        w["req_set"] = []
# register PLN/WRK back-links on decisions/findings already done; finalize ids lists
for w in WORK:
    w.setdefault("req_set", [])

# ------------------------------------------------------------------------------------------------ requirement matrix
def wire_of(cids):
    prim = [c for c in cids if comps.get(c) and comps[c]["category"] not in ("TST", "CHK")]
    if not prim:
        return "—"
    flags = []
    for c in prim:
        s = (comps[c].get("integration_status") or "").lower()
        if "karantén" in s or "nem része" in s or "önálló segéd" in s:
            flags.append(0)
        elif s.startswith("master:nem; ügynökök:nem; controlcenter:nem") or "nincs bekötve" in s:
            flags.append(0)
        elif s:
            flags.append(1)
        else:
            flags.append(None)
    known = [f for f in flags if f is not None]
    if not known:
        return "ISMERETLEN"
    if all(known):
        return "BEKÖTVE"
    if not any(known):
        return "NINCS BEKÖTVE"
    return "RÉSZBEN BEKÖTVE"
def rel_rows(a):
    r = REQ_BY_ID[a]
    if a in REQ_LINKS:
        lst = REQ_LINKS[a]
        impl_c = [c for c, rel in lst if rel != "VERIFIED_BY_TEST" and comps.get(c, {}).get("category") != "TST"]
        test_c = [c for c, rel in lst if rel == "VERIFIED_BY_TEST" or comps.get(c, {}).get("category") == "TST"]
        return list(dict.fromkeys(impl_c)), list(dict.fromkeys(test_c))
    cs = ids_in(r.get("component_ids", ""))
    return [c for c in cs if comps[c]["category"] != "TST"], [c for c in cs if comps[c]["category"] == "TST"]
REQ_MATRIX = []
for a in list(REQ) + list(SRCSET):
    r = REQ_BY_ID[a]
    isreq = a in REQ
    st = r["status"]
    impl_c, test_c = rel_rows(a)
    plnrec = PLN[r["pln"]] if r.get("pln") else None
    found = "N/A" if st == "N/A" or r.get("kind") in ("HEADING", "CONTEXT") else ("IGEN" if st == "VERIFIED_WORKING" else ("NEM" if st == "MISSING" else "RÉSZBEN"))
    if a.startswith("ATL-FUT"):
        deferred = "IGEN (150 jövőbeli ötlet – nem aktivált)"
    elif r.get("deferred") in (True, "True"):
        deferred = "IGEN"
    else:
        deferred = ""
    h = REQ_HOURS.get(a, [0.0, 0.0])
    wk = list(dict.fromkeys(REQ_WORK.get(a, []) + ([PLN_TASK[r["pln"]]["id"]] if plnrec else [])))
    row = dict(atl_id=a, legacy_id=r.get("legacy_id") or r.get("legacy_requirement_id", ""), set=("REQ" if isreq else a[4:7]), chapter=r.get("chapter", ""), part=r.get("part", ""),
               source_line=r.get("source_line", ""), kind=r.get("kind", "SOURCE_SET_ITEM"), text=r.get("source_text") if isreq else r.get("name", ""), status=st, status_hu=STATUS_HU.get(st, st),
               found_in_atlasz=found, atl_components=semi(impl_c), test_components=semi(test_c), wired=wire_of(impl_c), evidence=r.get("evidence", ""), missing_functions=r.get("missing", ""),
               fix_needed=r.get("fix", "") if isreq else r.get("missing", ""), planned_module_id=plnrec["id"] if plnrec else "", planned_module_name=plnrec["name"] if plnrec else "",
               planned_module_status=plnrec["status"] if plnrec else "", related_existing_modules=semi(plnrec["rel_ids"]) if plnrec else semi(impl_c), needed_wiring=plnrec["wiring"] if plnrec else "",
               work_ids=semi(wk), est_impl_h=round(h[0], 2), est_verify_h=round(h[1], 2), est_total_h=round(h[0] + h[1], 2), external=r.get("external", ""), owner_decision=r.get("owner_decision") or r.get("ownerDecision", ""),
               deferred=deferred)
    REQ_MATRIX.append(row)

# ------------------------------------------------------------------------------------------------ unified inventory
def best_prio(ws):
    ps = [WORK_BY_ID[x]["priority"] for x in ws if x in WORK_BY_ID]
    return min(ps, key=lambda p: PRI_ORDER[p]) if ps else ""
INV = []
dir_by_comp = collections.Counter()
for d in DIRS:
    for c in d["components"]:
        dir_by_comp[c] += 1
for cid, r in comps.items():
    ws = list(dict.fromkeys(COMP_WORK.get(cid, [])))
    own_ws = [x for x in ws if WORK_BY_ID[x]["origin"] != "V2_PLANNED_MODULE"]
    h = COMP_HOURS.get(cid, [0.0, 0.0])
    st = r["status"]
    existence = "MEGLÉVŐ – karanténban" if st == "LEGACY_QUARANTINED" else "MEGLÉVŐ"
    missing = r.get("missing_functions", "")
    if COMP_PLN.get(cid):
        missing = (missing + " | " if missing and missing != "-" else "") + "tervezett bővítések/kapcsolatok: " + semi(COMP_PLN[cid])
    reqs_of = sorted(a for a in COMP_REQS.get(cid, ()) if a in ALL_REQ_ROWS)
    fix = r.get("next_action", "")
    INV.append(dict(id=cid, group=GROUPS.get(r["category"], r["category"]), category=r["category"], category_name=CATS_ALL.get(r["category"], ""), name=r["name"], record_type="MEGLÉVŐ rendszerelem", kind=r["kind"],
                    existence=existence, status=st, status_hu=STATUS_HU.get(st, st), status_basis=r.get("status_basis", ""), function=r["function"], code_files=r["code_files"], integration_status=r.get("integration_status", ""),
                    wired_to=r.get("related_component_ids", ""), requirement_ids=semi(reqs_of), requirement_count=len(reqs_of), directive_item_count=dir_by_comp.get(cid, 0),
                    tests=r.get("test_ids", ""), test_results=r.get("test_results", ""), tested_function=r.get("tested_function", ""), live_evidence=r.get("live_evidence", ""), known_defects=r.get("known_defects", ""),
                    missing=missing, fix_plan=fix, planned_module_refs=semi(COMP_PLN.get(cid, [])), work_ids=semi(own_ws), est_impl_h=round(h[0], 2), est_verify_h=round(h[1], 2),
                    est_total_h=round(h[0] + h[1], 2), priority=best_prio(own_ws), external=r.get("external_dependencies", ""), owner_decision=("igen: " + r["owner_approval_needed"]) if r.get("owner_approval_needed") else "",
                    origin=r.get("origin", "V1"), legacy_ids=r.get("legacy", ""), last_checked=r.get("last_checked", TODAY)))
for slug, m in PLN.items():
    w = PLN_TASK[slug]
    st = m["status"]
    INV.append(dict(id=m["id"], group=GROUPS["PLN"], category="PLN", category_name=CATS_ALL["PLN"], name=m["name"], record_type="TERVEZETT modul (NEM létezik)", kind=m["kind"],
                    existence="NINCS – tervezett" if m["kind"] != "EXTEND" else "BŐVÍTÉS tervezett (a bővítés még nincs)", status=st, status_hu=STATUS_HU[st], status_basis="Tervezett elem: nincs kód, nincs teszt, nincs bizonyíték",
                    function="(tervezett) " + m["name"], code_files="", integration_status="NINCS (tervezett bekötés: %s)" % m["wiring"], wired_to=semi(m["rel_ids"]), requirement_ids=semi(m["matched_req"]), requirement_count=len(m["matched_req"]),
                    directive_item_count=len(m["matched_dir"]), tests="", test_results="", tested_function="", live_evidence="", known_defects="", missing="a teljes %s" % ("modul" if m["kind"] == "NEW" else "bővítés"),
                    fix_plan=w["work"], planned_module_refs="", work_ids=w["id"], est_impl_h=m["impl"], est_verify_h=m["ver"], est_total_h=m["impl"] + m["ver"], priority=w["priority"], external=m["ext"], owner_decision=m["owner"],
                    origin="V2_PLANNED", legacy_ids="", last_checked=TODAY))
INV_BY_ID = {x["id"]: x for x in INV}

exec(open(os.path.join(OUT, "build_part4.py"), encoding="utf-8").read())
