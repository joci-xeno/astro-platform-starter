# -*- coding: utf-8 -*-
# Part 4: finalize tables, validation, write outputs (CSV / JSON / SQLite / ledger / history). RECORDS ONLY.

# ---- source documents table
SOURCES = []
for code, u in UP.items():
    n = sum(1 for d in DIRS if d["source_code"] == code)
    SOURCES.append(dict(id=UPLOAD_SRC[code], kind="OWNER_DIRECTIVE_UPLOAD", name=u["file"], code=code, md5=u["md5"], duplicate_upload_codes=semi(u["dups"]), line_items=n,
                        note="Tulajdonosi direktíva; sorai ATL-DIR-* azonosítót kaptak"))
SOURCES.append(dict(id=V73_SRC, kind="SPEC_REGISTRY", name="docs/atlasz_v73_requirement_registry.csv (V7.3 mester-követelmény regiszter)", code="V73REG", md5="", duplicate_upload_codes="", line_items=sum(1 for d in DIRS if d["set"] == "V73"),
                    note="Sorai ATL-SPC-* azonosítót kaptak"))
for p, sid in sorted(SRC_FILES.items()):
    SOURCES.append(dict(id=sid, kind="REPO_DOCUMENT", name=p, code="", md5="", duplicate_upload_codes="", line_items="", note="Repó-dokumentum (v1-ben nem szerepelt külön azonosítóval)"))
CONFIGS = [dict(id=cid, kind="CONFIG_OR_DATA_FILE", name=p, note="Konfiguráció / állapotfájl / CI / bizonyíték-adat (v1-ben nem azonosított)") for p, cid in sorted(CFG_FILES.items())]

# ---- planned-module table
PLN_ROWS = []
for slug, m in PLN.items():
    w = PLN_TASK[slug]
    PLN_ROWS.append(dict(id=m["id"], slug=slug, name=m["name"], kind=m["kind"], status=m["status"], status_hu=STATUS_HU[m["status"]], domain=m["domain"],
                         requirement_ids=semi(m["matched_req"]), requirement_count=len(m["matched_req"]), directive_item_ids_count=len(m["matched_dir"]), related_existing_modules=semi(m["rel_ids"]),
                         related_existing_names=semi(comps[c]["name"] for c in m["rel_ids"]), needed_wiring=m["wiring"], est_impl_h=m["impl"], est_verify_h=m["ver"], est_total_h=m["impl"] + m["ver"], priority=w["priority"],
                         work_id=w["id"], depends_on=semi(w["depends_on"]), external=m["ext"], owner_decision=m["owner"], decision_id=m.get("dec_id", ""), acceptance=m["accept"], note=m["note"],
                         counted_in_active_plan="NEM (halasztott)" if m["kind"] == "DEFERRED" else "IGEN"))

# ---- directive item table
DIR_ROWS = []
for d in DIRS:
    DIR_ROWS.append(dict(id=d["id"], legacy_id=d["legacy_id"], set=d["set"], source_id=d["source_id"], source_code=d["source_code"], line=d["line"], section=d["section"], text=d["text"], kind=d["kind"],
                         assessment_mode=d["mode"], duplicate_of=d["dup_of"], same_as_req=d["same_as"], status=d["status"], deferred="IGEN" if d["deferred"] else "", component_ids=semi(d["components"]),
                         planned_module_id=d["pln_id"], work_ids=semi(d["wrk_ids"]), evidence=d["evidence"], missing=d["missing"], fix=d["fix"], external=d["external"], owner_decision=d["owner_decision"], notes=d["notes"]))

# ---- work plan rows (numbered, sorted by priority then id)
WORK_SORTED = sorted(WORK, key=lambda w: (PRI_ORDER[w["priority"]], w["id"]))
for i, w in enumerate(WORK_SORTED, 1):
    w["no"] = i
WORK_ROWS = []
for w in WORK_SORTED:
    WORK_ROWS.append(dict(no=w["no"], id=w["id"], origin=w["origin"], priority=w["priority"], title=w["title"], exact_work=w["work"], atl_component_ids=semi(w["component_ids"]), planned_module_id=semi(([w["pln_id"]] if w["pln_id"] else []) + [x for x in w["related_pln_ids"] if x != w["pln_id"]]),
                          document_ids=semi(w["document_ids"]), no_module_reason=w["no_module_reason"],
                          requirement_ids=semi(w["requirement_ids"] if w["origin"] not in ("V1_WORKLIST", "V2_COMPONENT") else w["req_set"]), requirement_count=len(w["requirement_ids"] if w["origin"] not in ("V1_WORKLIST", "V2_COMPONENT") else w["req_set"]),
                          directive_item_count=w["directive_count"], depends_on=semi(w["depends_on"]), est_impl_h=w["impl_h"], est_verify_h=w["ver_h"], est_total_h=w["total_h"], verification_method=w["verify_method"],
                          acceptance_criteria=w["acceptance"], external=w["external"], owner_decision=w["owner_decision"], decision_ids=semi(w["decision_ids"]), finding_ids=semi(w["finding_ids"]),
                          deferred="IGEN" if w["deferred"] else "", counted_in_active_plan="NEM" if w["deferred"] else "IGEN", v1_row=w.get("v1_row", ""), status=w["status"]))

# ---- decisions / findings tables
DEC_ROWS = [dict(id=d["id"], name=d["name"], origin=d["origin"], detail=d["detail"], directive_item_count=len(d["dir_ids"]), planned_module_ids=semi(d["pln_ids"]), work_ids=semi(d["wrk_ids"]), status=d["status"]) for d in DECISIONS]
FND_ROWS = [dict(id=f["id"], kind=f["kind"], subtype=f["subtype"], text=f["text"], status=f["status"], resolved_by=f["resolved_by"], directive_item_count=len(f["dir_ids"]), directive_item_ids=semi(f["dir_ids"][:20]),
                 component_ids=semi(f["component_ids"][:20]), work_ids=semi(f["wrk_ids"])) for f in FINDINGS]

# ------------------------------------------------------------------------------------------------ validation
V = {"generated_at": TODAY, "git_head": HEAD, "checks": [], "errors": 0, "warnings": 0}
def chk(name, ok, detail="", level="ERROR"):
    V["checks"].append({"check": name, "ok": bool(ok), "level": level if not ok else "OK", "detail": detail})
    if not ok:
        V["errors" if level == "ERROR" else "warnings"] += 1

# 1 v1 identifiers preserved
v1_ledger = json.loads(sh("git", "show", "HEAD:docs/identity_registry/id_ledger.json"))
lost = [k for k, e in v1_ledger["entries"].items() if k not in LEDGER["entries"] or LEDGER["entries"][k]["id"] != e["id"]]
chk("A v1 ledger minden bejegyzése és azonosítója változatlanul megmaradt", not lost, "elveszett/megváltozott: %d" % len(lost))
v1_names = {r["id"]: r["name"] for r in rcsv(os.path.join(V1, "components.csv"))}
renamed = [i for i, n in v1_names.items() if comps[i]["name"] != n]
chk("A 898 v1 rendszerelem azonosítója és neve változatlan", len(v1_names) == 898 and not renamed and set(v1_names) <= set(comps), "átnevezett: %d" % len(renamed))
# 2 duplicated ids
all_ids = [x["id"] for x in INV] + [d["id"] for d in DIR_ROWS] + [r["atl_id"] for r in REQ_MATRIX] + [s["id"] for s in SOURCES] + [c["id"] for c in CONFIGS] + [w["id"] for w in WORK_ROWS] + [d["id"] for d in DEC_ROWS] + [f["id"] for f in FND_ROWS]
dup = [i for i, n in collections.Counter(all_ids).items() if n > 1]
chk("Nincs ismétlődő azonosító a táblák között", not dup, "ismétlődő: %s" % dup[:10])
led_ids = [e["id"] for e in LEDGER["entries"].values()]
chk("A ledgerben minden azonosító egyedi (nincs újrafelhasználás)", len(led_ids) == len(set(led_ids)), "")
missing_in_ledger = [i for i in all_ids if i not in set(led_ids)]
req_ids_v1 = {r["atl_id"] for r in reqs} | {r["atl_id"] for r in srcsets}
chk("Minden azonosító ledger-bejegyzéshez köthető (a v1 követelmény/CAP/SIR/FUT azonosítók a v1 ledgerben vannak)", not [i for i in missing_in_ledger if i not in req_ids_v1], "hiányzó: %s" % [i for i in missing_in_ledger if i not in req_ids_v1][:10])
# 3 originals present
chk("Mind az 1859 követelmény-sor + 258 (85/23/150) tétel szerepel a mátrixban", len(REQ_MATRIX) == 1859 + 258 and {r["atl_id"] for r in REQ_MATRIX} == req_ids_v1, "%d sor" % len(REQ_MATRIX))
chk("Mind a 12 476 direktíva-/specifikáció-sor azonosítót kapott", len(DIR_ROWS) == 12476 and len({d["id"] for d in DIR_ROWS}) == 12476, "%d" % len(DIR_ROWS))
chk("Mind a 42 feltöltött direktíva forrásként azonosítva", len([s for s in SOURCES if s["kind"] == "OWNER_DIRECTIVE_UPLOAD"]) == 42, "")
chk("Pontosan 30 állandó ügynök (5 SEARCH + 25 EXECUTION), a Master/AURÓRA nem ügynök", sum(1 for c in comps.values() if c["kind"] == "PERMANENT_AGENT") == 30
    and sum(1 for c in comps.values() if c["kind"] == "PERMANENT_AGENT" and c["name"].startswith("SEARCH")) == 5, "")
# 4 missing -> PLN + work
miss_req = [r for r in REQ_MATRIX if r["set"] == "REQ" and r["status"] == "MISSING"]
no_pln = [r["atl_id"] for r in miss_req if not r["planned_module_id"]]
chk("Minden MISSING követelményhez tartozik tervezett modul/bővítés azonosító", not no_pln, "hiányzik: %s" % no_pln[:10])
no_work = [r["atl_id"] for r in miss_req if not r["work_ids"]]
chk("Minden MISSING követelményhez tartozik megvalósítási munkaterv-feladat", not no_work, "hiányzik: %s" % no_work[:10])
nv_nowork = [r["atl_id"] for r in REQ_MATRIX if r["set"] in ("REQ", "CAP", "SIR") and r["status"] in NONVER and r["kind"] not in ("HEADING", "CONTEXT") and not r["work_ids"]]
chk("Minden nem-VERIFIED követelményhez (REQ/CAP/SIR) tartozik munkaterv-feladat", not nv_nowork, "feladat nélkül: %d %s" % (len(nv_nowork), nv_nowork[:10]))
fut_nowork = [r["atl_id"] for r in REQ_MATRIX if r["set"] == "FUT" and r["status"] in NONVER and not r["work_ids"]]
chk("A 150 jövőbeli ötlet nem-VERIFIED tételei halasztott feladatként szerepelnek", not fut_nowork, "hiányzik: %s" % fut_nowork[:10])
dir_nowork = [d["id"] for d in DIRS if dir_needs_work(d) and not d["wrk_ids"] and d["mode"] != "DUPLICATE_OF"]
chk("Minden munkát igénylő direktíva-sorhoz tartozik feladat", not dir_nowork, "feladat nélkül: %d" % len(dir_nowork))
dir_dup_nowork = [d["id"] for d in DIRS if d["mode"] == "DUPLICATE_OF" and not d["dup_of"]]
chk("Minden duplikált direktíva-sor az eredetire hivatkozik", not dir_dup_nowork, "")
# deferred/planned separation
chk("Tervezett (PLN) azonosító nincs a meglévő rendszerelemek között", not [c for c in comps if c.startswith("ATL-PLN-")], "")
chk("Tervezett elem státusza soha nem működő státusz", all(m["status"].startswith(("PLANNED", "DECISION")) for m in PLN.values()), "")
chk("A tervezett modulok mind kaptak legalább egy követelményt/direktíva-sort (nincs üres modul)", not empty_pln, "üres: %s" % empty_pln, level="WARN")
chk("Halasztott tételek külön jelöltek és nem számítanak az aktív órákba", all(w["priority"] == "P5" for w in WORK if w["deferred"]), "")
# references
ids_all = set(all_ids) | set(comps) | {m["id"] for m in PLN.values()}
bad_ref = []
for w in WORK:
    for c in w["component_ids"]:
        if c not in comps:
            bad_ref.append((w["id"], c))
    for dd in w["depends_on"]:
        if dd != "ALL_ACTIVE_TASKS" and dd not in ids_all:
            bad_ref.append((w["id"], dd))
for m in PLN.values():
    for c in m["rel_ids"]:
        if c not in comps:
            bad_ref.append((m["id"], c))
for d in DIRS:
    for c in d["components"]:
        if c not in comps:
            bad_ref.append((d["id"], c))
    if d["same_as"] and d["same_as"] not in REQ:
        bad_ref.append((d["id"], d["same_as"]))
for r in REQ_MATRIX:
    for c in ids_in(r["atl_components"] + ";" + r["test_components"]):
        if c not in comps:
            bad_ref.append((r["atl_id"], c))
chk("Minden hivatkozás létező azonosítóra mutat", not bad_ref, "hibás: %s" % bad_ref[:10])
# acyclic dependencies
graph = {w["id"]: [x for x in w["depends_on"] if x in WORK_BY_ID] for w in WORK}
state = {}
cyc = []
def visit(n, path):
    state[n] = 1
    for m_ in graph.get(n, []):
        if state.get(m_) == 1:
            cyc.append(path + [n, m_])
        elif m_ not in state:
            visit(m_, path + [n])
    state[n] = 2
sys.setrecursionlimit(10000)
for n in graph:
    if n not in state:
        visit(n, [])
chk("A munkaterv függőségei körmentesek", not cyc, "ciklus: %s" % cyc[:2])
# hours consistency
tot_task = sum(w["total_h"] for w in WORK if not w["deferred"])
tot_req = sum(sum(v) for a, v in REQ_HOURS.items() if not a.startswith("ATL-FUT"))
tasks_without_req = sum(w["total_h"] for w in WORK if not w["deferred"] and not w.get("hours_reqs"))
V["hours"] = {"active_task_total_h": round(tot_task, 1), "requirement_allocated_h": round(tot_req, 1), "task_h_without_requirement_link": round(tasks_without_req, 1)}
chk("Az aktív feladat-órák és a követelményekre szétosztott órák egyeznek (a követelmény nélküli feladatokon kívül)", abs((tot_task - tasks_without_req) - tot_req) < 1.0, str(V["hours"]))
# v2 correction round: link completeness
unlinked = [w["id"] for w in WORK if not (w["component_ids"] or w["pln_id"] or w["related_pln_ids"] or w["no_module_reason"])]
chk("Minden munkaterv-sor kapcsolódik ATL-komponenshez vagy tervezett modulhoz, vagy dokumentált indoklása van", not unlinked, "kapcsolat/indoklás nélkül: %s" % unlinked[:10])
bad_doc = [(w["id"], x) for w in WORK for x in w["document_ids"] + w["related_pln_ids"] if x not in ids_all and x not in {s_["id"] for s_ in SOURCES} and x not in {c_["id"] for c_ in CONFIGS}]
chk("A munkaterv dokumentum-/modul-hivatkozásai létező azonosítók", not bad_doc, str(bad_doc[:10]))
fut_nopln = [r["atl_id"] for r in REQ_MATRIX if r["set"] in ("FUT", "CAP") and r["status"] == "MISSING" and not r["planned_module_id"]]
chk("Minden MISSING CAP/FUT tételhez tartozik tervezett modul azonosító", not fut_nopln, "hiányzik: %s" % fut_nopln[:10])
nonmod_empty = [r["atl_id"] for r in REQ_MATRIX if r["status"] in NONVER and r["kind"] not in ("HEADING", "CONTEXT") and not (r["atl_components"] or r["planned_module_id"])]
chk("Minden nem-VERIFIED követelmény-sor kapcsolódik ATL-komponenshez vagy tervezett modulhoz", not nonmod_empty, "kapcsolat nélkül: %d %s" % (len(nonmod_empty), nonmod_empty[:10]), level="WARN")
fut_wp = [r["atl_id"] for r in REQ_MATRIX if r["set"] == "FUT" and r["status"] in NONVER and (not r["work_ids"])]
chk("A halasztott ötlet-tételek munkaterv-sora nem aktív (P5, deferred)", all(w["deferred"] for w in WORK if w["origin"] == "V2_DEFERRED_IDEA") and not fut_wp, "")
chk("A tervezett modul-tétel (PLN) mindig tartalmaz requirement-hivatkozást vagy direktívát", not empty_pln, str(empty_pln), level="WARN")
r0141 = [r for r in REQ_MATRIX if r["atl_id"] == "ATL-FUT-0141"][0]
chk("ATL-FUT-0141: tervezett modul, név, kapcsolódó meglévő modulok, munka-összekötés kitöltve; halasztott", all([r0141["planned_module_id"], r0141["planned_module_name"], r0141["related_existing_modules"], r0141["work_ids"], r0141["atl_components"]]) and r0141["deferred"].startswith("IGEN")
    and PLN_ROWS and [p_ for p_ in PLN_ROWS if p_["id"] == r0141["planned_module_id"]][0]["kind"] == "DEFERRED", r0141["planned_module_id"] + " " + r0141["work_ids"])
# no code changed
changed = [l[3:] for l in sh("git", "status", "--porcelain").split("\n") if l.strip()]
bad_changed = [p for p in changed if not p.startswith("docs/")]
chk("Csak docs/ alatti fájl változott (futó rendszer kódja nem módosult)", not bad_changed, "docs/-on kívül: %s" % bad_changed[:10])
chk("Fel nem oldott catalog-hivatkozás (rel) nincs", not UNRESOLVED_REL, str(sorted(UNRESOLVED_REL)))
chk("A katalógus explicit kulcsai mind léteznek", not [k for k in EXPLICIT_UNUSED], str(EXPLICIT_UNUSED[:10]), level="WARN")
V["unmatched_after_assign"] = len(UNMATCHED)

# ------------------------------------------------------------------------------------------------ write ledger / history
LEDGER["version"] = max(LEDGER.get("version", 1), 2)
LEDGER["updated"] = TODAY
os.makedirs(OUT, exist_ok=True)
json.dump(LEDGER, open(os.path.join(V1, "id_ledger.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=False)
with open(os.path.join(V1, "id_ledger.csv"), "w", encoding="utf-8-sig", newline="") as f:
    cw = csv.writer(f); cw.writerow(["id", "category", "natural_key", "name", "status", "first_seen", "first_seen_commit"])
    for k, e in LEDGER["entries"].items():
        cw.writerow([e["id"], e["category"], k, e["name"], e["status"], e["first_seen"], e["first_seen_commit"]])
hist_p = os.path.join(V1, "history.jsonl")
old_hist = open(hist_p, encoding="utf-8").read().splitlines()
seen = set(old_hist)
with open(hist_p, "a", encoding="utf-8") as f:
    for h in HISTORY_NEW:
        line = json.dumps(h, ensure_ascii=False)
        if line not in seen:
            f.write(line + "\n")
V["history"] = {"previous_lines": len(old_hist), "appended": len(HISTORY_NEW)}

# ------------------------------------------------------------------------------------------------ CSV / JSON
def wcsv(name, rows, cols=None):
    cols = cols or list(rows[0].keys())
    with open(os.path.join(OUT, name), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
wcsv("inventory_items.csv", INV)
wcsv("requirements_matrix.csv", REQ_MATRIX)
wcsv("planned_modules.csv", PLN_ROWS)
wcsv("work_plan.csv", WORK_ROWS)
wcsv("directive_items.csv", DIR_ROWS)
wcsv("sources.csv", SOURCES)
wcsv("config_files.csv", CONFIGS)
wcsv("findings.csv", FND_ROWS)
wcsv("owner_decisions.csv", DEC_ROWS)
wcsv("corrections_to_v1.csv", CORRECTIONS)
# extended (340 + new) work list in the v1 column order
wcsv("work_list_extended.csv", [dict(priority=r["priority"], component_ids=r["atl_component_ids"], title=r["title"], required_action=r["exact_work"], requirement_ids=r["requirement_ids"], external_dependency=r["external"], work_id=r["id"],
                                     origin=r["origin"], est_total_h=r["est_total_h"]) for r in WORK_ROWS])

REG = {"generated_at": TODAY, "git_head": HEAD, "note": "Nyilvántartás – a futó rendszer kódját nem módosítja. A becsült órák tervezési becslések.",
       "counts": {"inventory_items": len(INV), "existing_components": len(comps), "planned_modules": len(PLN), "requirement_rows": len(REQ_MATRIX), "directive_items": len(DIR_ROWS),
                  "sources": len(SOURCES), "config_files": len(CONFIGS), "work_items": len(WORK_ROWS), "findings": len(FND_ROWS), "decisions": len(DEC_ROWS)},
       "inventory_items": INV, "planned_modules": PLN_ROWS, "requirements_matrix": REQ_MATRIX, "work_plan": WORK_ROWS, "directive_items": DIR_ROWS, "sources": SOURCES, "config_files": CONFIGS,
       "findings": FND_ROWS, "owner_decisions": DEC_ROWS, "corrections_to_v1": CORRECTIONS, "validation": V}
json.dump(REG, open(os.path.join(OUT, "atlasz_system_inventory.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
json.dump(V, open(os.path.join(OUT, "validation_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ------------------------------------------------------------------------------------------------ SQLite
dbp = os.path.join(OUT, "atlasz_system_inventory.sqlite")
if os.path.exists(dbp):
    os.remove(dbp)
con = sqlite3.connect(dbp)
def table(name, rows, pk=None):
    cols = list(rows[0].keys())
    con.execute("CREATE TABLE %s (%s)" % (name, ", ".join('"%s" TEXT' % c for c in cols)))
    con.executemany("INSERT INTO %s VALUES (%s)" % (name, ",".join("?" * len(cols))), [[("" if r.get(c) is None else str(r.get(c))) for c in cols] for r in rows])
    if pk:
        con.execute('CREATE INDEX idx_%s_%s ON %s("%s")' % (name, pk, name, pk))
table("inventory_items", INV, "id"); table("requirements_matrix", REQ_MATRIX, "atl_id"); table("planned_modules", PLN_ROWS, "id"); table("work_plan", WORK_ROWS, "id")
table("directive_items", DIR_ROWS, "id"); table("sources", SOURCES, "id"); table("config_files", CONFIGS, "id"); table("findings", FND_ROWS, "id"); table("owner_decisions", DEC_ROWS, "id")
table("corrections_to_v1", CORRECTIONS or [dict(id="", name="", field="", old="", new="", reason="")])
LINKS = []
def L(a, b, rel):
    if a and b:
        LINKS.append((a, b, rel))
for a, lst in REQ_LINKS.items():
    for c, rel in lst:
        L(a, c, rel)
for a, r in SRCSET.items():
    for c in ids_in(r["component_ids"]):
        L(a, c, "SOURCE_SET_COMPONENT")
for r in REQ_MATRIX:
    L(r["atl_id"], r["planned_module_id"], "PLANNED_MODULE")
    for x in r["work_ids"].split("; "):
        L(r["atl_id"], x, "WORK")
for d in DIRS:
    for c in d["components"]:
        L(d["id"], c, "COMPONENT")
    L(d["id"], d["same_as"], "SAME_AS_REQ"); L(d["id"], d["pln_id"], "PLANNED_MODULE"); L(d["id"], d["source_id"], "SOURCE"); L(d["id"], d["dup_of"], "DUPLICATE_OF")
    for x in d["wrk_ids"]:
        L(d["id"], x, "WORK")
for cid, r in comps.items():
    for x in ids_in(r.get("related_component_ids", "")):
        L(cid, x, "RELATED")
for m in PLN.values():
    for c in m["rel_ids"]:
        L(m["id"], c, "WIRE_TO_EXISTING")
for w in WORK:
    for c in w["component_ids"]:
        L(w["id"], c, "WORK_ON")
    L(w["id"], w["pln_id"], "WORK_FOR_PLANNED")
    for x in w["depends_on"]:
        L(w["id"], x, "DEPENDS_ON")
    for x in w["decision_ids"]:
        L(w["id"], x, "NEEDS_DECISION")
for f in FINDINGS:
    for x in f["dir_ids"][:50]:
        L(f["id"], x, "FOUND_IN")
    for c in f["component_ids"]:
        L(f["id"], c, "ABOUT")
    L(f["id"], f["resolved_by"], "RESOLVED_BY")
for dd in DECISIONS:
    for x in dd["dir_ids"][:50]:
        L(dd["id"], x, "DECIDES")
    for x in dd["pln_ids"]:
        L(dd["id"], x, "DECIDES")
con.execute("CREATE TABLE links (from_id TEXT, to_id TEXT, relation TEXT)")
con.executemany("INSERT INTO links VALUES (?,?,?)", LINKS)
con.execute("CREATE INDEX idx_links_from ON links(from_id)"); con.execute("CREATE INDEX idx_links_to ON links(to_id)")
con.execute("CREATE TABLE id_ledger (id TEXT, category TEXT, natural_key TEXT, name TEXT, status TEXT, first_seen TEXT, first_seen_commit TEXT)")
con.executemany("INSERT INTO id_ledger VALUES (?,?,?,?,?,?,?)", [(e["id"], e["category"], k, e["name"], e["status"], e["first_seen"], e["first_seen_commit"]) for k, e in LEDGER["entries"].items()])
con.execute("CREATE INDEX idx_ledger_id ON id_ledger(id)")
con.execute("CREATE TABLE history (line TEXT)")
con.executemany("INSERT INTO history VALUES (?)", [(l,) for l in open(hist_p, encoding="utf-8").read().splitlines()])
con.execute("""CREATE VIEW all_ids AS
 SELECT id, 'inventory_items' AS tbl, name, status FROM inventory_items UNION ALL SELECT atl_id, 'requirements_matrix', substr(text,1,120), status FROM requirements_matrix
 UNION ALL SELECT id, 'directive_items', substr(text,1,120), status FROM directive_items UNION ALL SELECT id, 'sources', name, kind FROM sources
 UNION ALL SELECT id, 'config_files', name, kind FROM config_files UNION ALL SELECT id, 'work_plan', title, priority FROM work_plan
 UNION ALL SELECT id, 'findings', substr(text,1,120), status FROM findings UNION ALL SELECT id, 'owner_decisions', name, status FROM owner_decisions""")
con.commit(); con.close()

exec(open(os.path.join(OUT, "build_part5.py"), encoding="utf-8").read())
