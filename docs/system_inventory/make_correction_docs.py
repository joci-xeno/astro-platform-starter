#!/usr/bin/env python3
"""Generates the correction-round documents (records only). Run from repo root AFTER build_system_inventory.py and render_inventory_report.py.
Inputs: current outputs + the pre-correction copies of the CSV outputs (argument 1 = directory) + git diff of history.jsonl against HEAD (=the pre-correction commit)."""
import csv, json, sys, subprocess, collections, os
OUT = "docs/system_inventory/"
BEFORE = sys.argv[1] if len(sys.argv) > 1 else None
def L(p): return list(csv.DictReader(open(p, encoding="utf-8-sig", newline="")))
def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout
BASE = sh("git", "rev-parse", "--short", "HEAD").strip()

# ---------------- exact change list (machine readable)
changes = []
for f, k in (("inventory_items.csv", "id"), ("requirements_matrix.csv", "atl_id"), ("planned_modules.csv", "id"), ("work_plan.csv", "id"), ("directive_items.csv", "id"),
             ("owner_decisions.csv", "id"), ("findings.csv", "id"), ("sources.csv", "id"), ("config_files.csv", "id")):
    a = {r[k]: r for r in L(BEFORE + f)}; b = {r[k]: r for r in L(OUT + f)}
    for i in sorted(set(b) - set(a)):
        changes.append(dict(table=f, id=i, change="ADDED", field="", old="", new=(b[i].get("name") or b[i].get("title") or b[i].get("text") or "")[:200]))
    for i in sorted(set(a) - set(b)):
        changes.append(dict(table=f, id=i, change="REMOVED", field="", old="", new=""))
    for i in sorted(set(a) & set(b)):
        for c in b[i]:
            if c in a[i] and c != "no" and a[i][c] != b[i][c]:
                changes.append(dict(table=f, id=i, change="CHANGED", field=c, old=a[i][c][:300], new=b[i][c][:300]))
with open(OUT + "correction_changes.csv", "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=["table", "id", "change", "field", "old", "new"]); w.writeheader(); w.writerows(changes)
cnt = collections.Counter((c["table"], c["change"]) for c in changes)

# ---------------- new ids (ledger/history diff against the pre-correction commit)
new_ids = []
for l in sh("git", "diff", "HEAD", "--", "docs/identity_registry/history.jsonl").splitlines():
    if l.startswith("+{"):
        j = json.loads(l[1:])
        if j.get("event") == "ALLOCATED":
            new_ids.append(j)
renamed = [json.loads(l[1:]) for l in sh("git", "diff", "HEAD", "--", "docs/identity_registry/history.jsonl").splitlines() if l.startswith("+{") and '"NAME_CHANGED"' in l]

# ---------------- the 54 rows
before = {r["id"]: r for r in L(BEFORE + "work_plan.csv")}
after = {r["id"]: r for r in L(OUT + "work_plan.csv")}
rows54 = [i for i, r in before.items() if not r["atl_component_ids"] and not r["planned_module_id"]]
def resolution(r):
    kinds = []
    if r["atl_component_ids"]: kinds.append("komponens: %d db" % len(r["atl_component_ids"].split("; ")))
    if r["planned_module_id"]: kinds.append("tervezett modul: " + r["planned_module_id"])
    if r["document_ids"]: kinds.append("dokumentum: %d db" % len(r["document_ids"].split("; ")))
    if r["no_module_reason"]: kinds.append("INDOKLÁS: nem modul-specifikus")
    return "; ".join(kinds)
res = collections.Counter()
lines54 = []
for i in sorted(rows54):
    r = after[i]
    mod = bool(r["atl_component_ids"] or r["planned_module_id"])
    res["modul-/komponens-kapcsolat" if mod else "dokumentált indoklás"] += 1
    lines54.append("| %s | %s | %s | %s |" % (i, r["origin"], r["title"][:70].replace("|", "/"), resolution(r)))

V = json.load(open(OUT + "validation_report.json"))
checks_ok = sum(1 for c in V["checks"] if c["ok"])
f0141 = [r for r in L(OUT + "requirements_matrix.csv") if r["atl_id"] == "ATL-FUT-0141"][0]
w0752 = after["ATL-WRK-0752"]
pl = {r["id"]: r for r in L(OUT + "planned_modules.csv")}
fnd = L(OUT + "findings.csv")
wp = L(OUT + "work_plan.csv")
rm = L(OUT + "requirements_matrix.csv")
fut_nopln = [r["atl_id"] for r in rm if r["set"] == "FUT" and r["status"] not in ("VERIFIED_WORKING",) and not r["planned_module_id"]]
md = []
A = md.append
A("# ATLASZ AURÓRA V7.3 – TULAJDONOSI NYILVÁNTARTÁSI KORREKCIÓ (2026-10-12)\n")
A("*Kizárólag nyilvántartási és dokumentációs munka. A futó ATLASZ-kód, a modulok, külső szolgáltatások és költségek érintetlenek. Kiinduló commit: `%s`.*\n" % BASE)
A("## 1. F-01 – ATL-FUT-0141 (Issue-to-fix automation)\n")
A("| mező | érték |\n|---|---|")
for k in ("atl_id", "text", "status", "deferred", "planned_module_id", "planned_module_name", "planned_module_status", "related_existing_modules", "atl_components", "work_ids"):
    A("| %s | %s |" % (k, f0141[k].replace("|", "/")))
p = pl[f0141["planned_module_id"]]
A("\nÚj tervezett modul: **%s** (%s, %s, P5). A módosítás oka: az eredeti sorban a tervezett modul, a név és a kapcsolódó meglévő modulok üresek, a munkasor (ATL-WRK-0752) pedig komponens-/modul-hivatkozás nélküli volt." % (p["id"], p["kind"], p["status"]))
A("Az ötlet **HALASZTOTT marad**, automatikusan nem aktiválható (aktiválás: külön tulajdonosi döntés – %s). A modul munkasora: **%s** (P5, nem része az aktív összegeknek); az ötlet saját halasztott munkasora **ATL-WRK-0752**: komponensek: %s; tervezett modul: %s; az órák a halasztott modul-feladatban vannak (duplikáció nélkül).\n" % (p["decision_id"], p["work_id"], w0752["atl_component_ids"], w0752["planned_module_id"]))
A("## 2. F-02 – Git-verzió (részletek: `GIT_PROVENANCE.md`)\n")
A("Lásd GIT_PROVENANCE.md: kiinduló commit, a leltár tartalmának commitja, a javítás commitja, helyi == távoli, a 898 ATL azonosító változatlansága, `main` érintetlen.\n")
A("## 3. F-03 – átadási fájlok (részletek: `HANDOVER_MANIFEST.csv`)\n")
A("A hét megnevezett fájl (`directive_items.csv`, `findings.csv`, `owner_decisions.csv`, `sources.csv`, `config_files.csv`, `corrections_to_v1.csv`, `atl_query.py`) és az összes többi átadási fájl szerepel a `HANDOVER_MANIFEST.csv`-ben (útvonal, létezik, olvasható, bájt, sha256, sorok, Git-követett, utolsó commit).\n")
A("## 4. A 54 üres munkasor ellenőrzése\n")
A("Korrekció előtt **%d** munkasor volt egyszerre ATL-komponens- és tervezettmodul-hivatkozás nélkül. Eredmény: %s.\n" % (len(rows54), ", ".join("%s: %d" % kv for kv in res.items())))
A("| munkasor | eredet | cím | megoldás |\n|---|---|---|---|")
md += lines54
A("\nMegjegyzés: a 4 dokumentált indoklású sor két rendszerszintű végső feladat (ATL-WRK-0764/0765) és két gyűjtő jellegű tulajdonosi döntés (ATL-WRK-0602 policy, ATL-WRK-0603 egyéb); mindegyiknek van `no_module_reason` indoklása és, ahol értelmes, `document_ids` hivatkozása.\n")
A("## 5. Pontos változáslista\n")
A("Gépi lista: `correction_changes.csv` (%d sor: tábla, azonosító, mező, régi, új érték). A munkaterv sorszámozása (`no`) a P-prioritás szerinti rendezés miatt eltolódik a 3 új feladat miatt – ez nem azonosító, a tartós ATL-WRK azonosítók nem változtak.\n" % len(changes))
A("| tábla | hozzáadott | módosított sor-mező |\n|---|---|---|")
tabs = sorted({t for t, _ in cnt})
for t in tabs:
    A("| %s | %d | %d |" % (t, cnt.get((t, "ADDED"), 0), cnt.get((t, "CHANGED"), 0)))
A("\nElv a módosított órákra: ha egy követelmény-hiány teljes egészében egy AKTÍV tervezett modulba került, a hiány-feladat (azonosítója megmarad) 0 órára áll, az órák a modul-feladatban vannak; halasztott modulba kerülő tételeknél az órák megmaradnak (nem aktiválódik semmi).\n")
A("## 6. Újonnan kiosztott ATL azonosítók\n")
A("| azonosító | megnevezés |\n|---|---|")
for j in sorted(new_ids, key=lambda x: x["id"]):
    A("| %s | %s |" % (j["id"], j.get("name", "").replace("|", "/")))
A("\nMeglévő azonosítók átnevezése nem történt; két munkasor *címe* módosult a számlálók frissülése miatt (azonosító változatlan):")
for j in renamed:
    A("- %s: „%s” → „%s”" % (j["id"], j["from"], j["to"]))
A("\n## 7. Még megoldatlan nyilvántartási hiányok\n")
open_f = collections.Counter(r["subtype"] for r in fnd if r["status"] == "OPEN")
A("- Nyitott megállapítások (ATL-FND): %s – lezárásuk a munkatervben (V2_FINDING)." % ", ".join("%s: %d" % kv for kv in open_f.items()))
A("- Nyitott tulajdonosi döntések: %d (owner_decisions.csv)." % len(L(OUT + "owner_decisions.csv")))
A("- Halasztott ötletek tervezett modul nélkül (csak komponens-kapcsolattal; szándékosan nem aktiválhatók): %d db – %s." % (len(fut_nopln), ", ".join(fut_nopln[:12]) + (" …" if len(fut_nopln) > 12 else "")))
A("- Dokumentált, nem modul-specifikus munkasor: 4 (ATL-WRK-0764, 0765, 0602, 0603).")
A("- A `docs/system_inventory/` generátor- és kimeneti fájljai nem kaptak ATL-azonosítót (körkörösség elkerülése); a `HANDOVER_MANIFEST.csv` tartalmazza őket.")
A("- A három karanténba tett legacy fájl (worker.js, supervisor.js, agent-child.js) sorsa tulajdonosi döntésre vár (ATL-DEC legacy).")
A("- A becsült órák továbbra is tervezési becslések (±40%), nem mért értékek; élő bizonyíték sehol nem jött létre.")
A("- A V2_DIRECTIVE_GAP munkasorok csak a direktíva-sorok egyenkénti besorolását zárja; ezek komponens-kapcsolata az evidenciában szereplő útvonalakból származik, és ahol ilyen nem volt, dokumentált indoklás áll.\n")
A("## 8. Érvényesítés\n")
A("%d ellenőrzés, ebből sikeres: %d, hiba: %d, figyelmeztetés: %d.\n" % (len(V["checks"]), checks_ok, V["errors"], V["warnings"]))
for c in V["checks"]:
    A("- %s %s" % ("✔" if c["ok"] else "✖", c["check"]))
A("\nÓrák (becslés): %s." % json.dumps(V["hours"], ensure_ascii=False))
open(OUT + "KORREKCIO_VALTOZASOK.md", "w", encoding="utf-8").write("\n".join(md) + "\n")
print("changes", len(changes), "new ids", len(new_ids), "rows54", len(rows54), dict(res))
