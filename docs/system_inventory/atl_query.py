#!/usr/bin/env python3
"""ATLASZ AURÓRA V7.3 - ATL azonosító lekérdező (CSAK OLVASÁS).

Használat:  python3 docs/system_inventory/atl_query.py ATL-FIN-0011 [--json]
Bármely ATL azonosításra (rendszerelem, tervezett modul, követelmény, direktíva-sor, munkaterv-feladat, forrás, megállapítás, döntés) megmondja:
 1. mi ez          2. létezik-e      3. működik-e és milyen bizonyítási szinten   4. mi hiányzik
 5. mihez kell kötni   6. pontosan milyen munka kell (óra, ellenőrzés, elfogadás)   7. mely követelmény igényli.
"""
import sqlite3, sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "atlasz_system_inventory.sqlite")

def rows(con, sql, args=()):
    cur = con.execute(sql, args)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
def one(con, tbl, key, val):
    r = rows(con, "SELECT * FROM %s WHERE %s=?" % (tbl, key), (val,))
    return r[0] if r else None
def names(con, ids):
    out = []
    for i in [x.strip() for x in (ids or "").split(";") if x.strip()]:
        r = rows(con, "SELECT name FROM all_ids WHERE id=?", (i,))
        out.append("%s (%s)" % (i, (r[0]["name"] if r else "?")[:70]))
    return out
def work_of(con, ids):
    res = []
    for i in [x.strip() for x in (ids or "").split(";") if x.strip()]:
        w = one(con, "work_plan", "id", i)
        if w:
            res.append({"id": i, "prioritás": w["priority"], "cím": w["title"], "pontos munka": w["exact_work"][:400], "becsült óra (impl/ell/össz)": "%s/%s/%s" % (w["est_impl_h"], w["est_verify_h"], w["est_total_h"]),
                        "ellenőrzési módszer": w["verification_method"], "elfogadási feltétel": w["acceptance_criteria"], "függ": w["depends_on"], "aktív tervben": w["counted_in_active_plan"]})
    return res

def answer(con, i):
    if (r := one(con, "inventory_items", "id", i)):
        planned = r["category"] == "PLN"
        reqs = names(con, r["requirement_ids"])
        return {"azonosító": i, "típus": r["record_type"], "1 Mi ez": "%s – %s" % (r["name"], r["function"]), "2 Létezik-e": r["existence"],
                "3 Működik-e / bizonyítási szint": "%s [%s]; alap: %s; tesztek: %s; élő bizonyíték: %s" % (r["status"], r["status_hu"], r["status_basis"], r["tests"] or "nincs", r["live_evidence"] or "nincs"),
                "4 Mi hiányzik": r["missing"] or "—", "ismert hibák": r["known_defects"], "5 Mihez kell kötni": "%s | %s" % (r["integration_status"], "; ".join(names(con, r["wired_to"])) or "—"),
                "tervezett kapcsolódó modulok": names(con, r["planned_module_refs"]), "6 Szükséges munka": work_of(con, r["work_ids"]) or "nincs ütemezett munka (VERIFIED_WORKING vagy nincs teendő)",
                "becsült órák": "%s impl + %s ell = %s" % (r["est_impl_h"], r["est_verify_h"], r["est_total_h"]), "külső függőség": r["external"], "tulajdonosi döntés": r["owner_decision"],
                "7 Mely követelmény igényli": reqs[:60] + (["… összesen %s" % r["requirement_count"]] if int(r["requirement_count"] or 0) > 60 else []), "direktíva-sorok száma": r["directive_item_count"], "kódfájlok": r["code_files"]}
    if (r := one(con, "requirements_matrix", "atl_id", i)):
        return {"azonosító": i, "típus": "követelmény / tétel (%s)" % r["set"], "1 Mi ez": "%s. fejezet %s, sor %s: %s" % (r["chapter"], r["part"], r["source_line"], r["text"]),
                "2 Létezik-e (megtalálható-e)": r["found_in_atlasz"], "3 Működik-e / szint": "%s [%s]; bizonyíték: %s" % (r["status"], r["status_hu"], r["evidence"]), "4 Mi hiányzik": r["missing_functions"] or "—",
                "5 Bekötés": "%s; komponensek: %s; tesztek: %s" % (r["wired"], "; ".join(names(con, r["atl_components"])) or "—", r["test_components"] or "—"),
                "tervezett modul": "%s %s [%s]" % (r["planned_module_id"], r["planned_module_name"], r["planned_module_status"]) if r["planned_module_id"] else "—", "szükséges bekötés": r["needed_wiring"],
                "6 Szükséges javítás/fejlesztés": r["fix_needed"] or "—", "munka": work_of(con, r["work_ids"]), "becsült óra (impl/ell/össz)": "%s/%s/%s" % (r["est_impl_h"], r["est_verify_h"], r["est_total_h"]),
                "külső": r["external"], "tulajdonosi döntés": r["owner_decision"], "halasztott": r["deferred"]}
    if (r := one(con, "directive_items", "id", i)):
        return {"azonosító": i, "típus": "direktíva-/specifikáció-sor", "1 Mi ez": "%s sor %s (%s): %s" % (r["source_code"], r["line"], r["section"], r["text"]), "besorolás": r["kind"], "2/3 állapot": r["status"],
                "azonos követelmény": r["same_as_req"], "érintett komponensek": names(con, r["component_ids"]), "tervezett modul": r["planned_module_id"], "4 Mi hiányzik": r["missing"], "6 Javítás": r["fix"], "munka": work_of(con, r["work_ids"]),
                "bizonyíték": r["evidence"], "forrás": r["source_id"], "megjegyzés": r["notes"], "tulajdonosi döntés": r["owner_decision"], "kérdéses duplikátum": r["duplicate_of"]}
    if (r := one(con, "work_plan", "id", i)):
        return {"azonosító": i, "típus": "munkaterv-feladat", "1 Mi ez": r["title"], "pontos munka": r["exact_work"], "prioritás": r["priority"], "érintett komponensek": names(con, r["atl_component_ids"]),
                "tervezett modul": r["planned_module_id"], "függőségek": r["depends_on"], "órák (impl/ell/össz)": "%s/%s/%s" % (r["est_impl_h"], r["est_verify_h"], r["est_total_h"]), "ellenőrzési módszer": r["verification_method"],
                "elfogadási feltétel": r["acceptance_criteria"], "követelmények száma": r["requirement_count"], "külső": r["external"], "tulajdonosi döntés": r["owner_decision"], "aktív tervben": r["counted_in_active_plan"]}
    for tbl, key in (("sources", "id"), ("config_files", "id"), ("findings", "id"), ("owner_decisions", "id")):
        if (r := one(con, tbl, key, i)):
            return {"azonosító": i, "tábla": tbl, **r}
    return None

def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    if not a:
        print(__doc__); sys.exit(1)
    con = sqlite3.connect(DB)
    res = answer(con, a[0].strip().upper())
    if res is None:
        print("Ismeretlen azonosító: %s" % a[0]); sys.exit(2)
    if "--json" in sys.argv:
        print(json.dumps(res, ensure_ascii=False, indent=1))
    else:
        for k, v in res.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                print("%s:" % k)
                for w in v:
                    for kk, vv in w.items():
                        print("    %s: %s" % (kk, vv))
                    print("    --")
            elif isinstance(v, list):
                print("%s:" % k + ("" if v else " —"))
                for x in v:
                    print("    - %s" % x)
            else:
                print("%s: %s" % (k, v))
    if "--links" in sys.argv:
        for r in rows(con, "SELECT * FROM links WHERE from_id=? OR to_id=?", (a[0], a[0])):
            print("  %s --%s--> %s" % (r["from_id"], r["relation"], r["to_id"]))
main()
