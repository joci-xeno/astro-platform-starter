#!/usr/bin/env python3
"""Merge item-level audit data into the registry (docs/atlasz_v73_requirement_registry.json) and regenerate the CSV.
Usage: python3 docs/build_registry.py   (run from the repo root). Idempotent."""
import json, csv, importlib.util, os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
reg_path = os.path.join(root, "docs", "atlasz_v73_requirement_registry.json")
d = json.load(open(reg_path, encoding="utf-8"))
byid = {x["id"]: x for x in d["requirements"]}
n_item = 0
for fn in sorted(f for f in os.listdir(os.path.join(root, "docs")) if f.startswith("registry_item_audit_") and f.endswith(".py")):
    spec = importlib.util.spec_from_file_location(fn[:-3], os.path.join(root, "docs", fn)); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for rid, v in m.I.items():
        if rid not in byid: sys.exit("UNKNOWN ID in " + fn + ": " + rid)
        x = byid[rid]; x.update(v); x["status_basis"] = "ITEM_VERIFIED"; n_item += 1
for fn in sorted(f for f in os.listdir(os.path.join(root, "docs")) if f.startswith("registry_new_") and f.endswith(".py")):
    spec = importlib.util.spec_from_file_location(fn[:-3], os.path.join(root, "docs", fn)); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for x in m.NEW:
        if x["id"] in byid: byid[x["id"]].update(x)
        else: d["requirements"].append(x); byid[x["id"]] = x
# the earlier UC/CR records were created before the GUI existed: refresh the ones that changed
upd = {"ATLASZ-UC-013": ("PARTIAL", "UPDATE CENTER view with all buttons exists in the Control Center UI", "Real local offline adapters exist (hash-verified packages); no remote update feed and no installed-app test"),
       "ATLASZ-CR-005": ("PARTIAL", "Owner Controls, backup/restore, doctor, update, approvals have GUI equivalents (atlasz-control-center)", "Electron shell/installer not built or run on Windows; keygen and sign available in GUI, CLI remains fallback")}
for k, (st, ev, blk) in upd.items():
    if k in byid: byid[k].update(status=st, evidence=[ev], blocker=blk, tests=["atlasz-tests/control-center.test.mjs"])
# section roll-up: a section may never claim more than its own items support (downgrade only)
_rank = {"MISSING": 0, "EXTERNAL_BLOCKER": 0, "BLOCKED_AWAITING_JOCI_APPROVAL": 0, "STRUCTURAL_ONLY": 1, "EXISTS_NEEDS_TEST": 2, "PARTIAL": 3, "EXISTS_AND_WORKING": 4}
for _s in [x for x in d["requirements"] if x["level"] == "section"]:
    _it = [x["status"] for x in d["requirements"] if x["section"] == _s["section"] and x["level"] != "section" and x["id"].startswith("V73-")]
    if not _it: continue
    _st = set(_it)
    _roll = "EXISTS_AND_WORKING" if _st == {"EXISTS_AND_WORKING"} else "PARTIAL" if _st & {"EXISTS_AND_WORKING", "PARTIAL", "EXISTS_NEEDS_TEST"} else "STRUCTURAL_ONLY" if "STRUCTURAL_ONLY" in _st else "MISSING"
    if _rank[_roll] < _rank[_s["status"]]:
        _s["status"] = _roll; _s["blocker"] = ((_s.get("blocker") or "") + " [status rolled up from item-level audit]").strip()
d["meta"]["item_verified_count"] = sum(1 for x in d["requirements"] if x.get("status_basis") == "ITEM_VERIFIED")
d["meta"]["note"] = ("Every record carries status_basis. ITEM_VERIFIED = checked individually against code/tests. SECTION_INHERITED_NOT_ITEM_VERIFIED = status copied from its section; "
                     "NOT verified for that item. New requirement IDs (ATLASZ-*) are item-verified.")
json.dump(d, open(reg_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
cols = ["id", "level", "section", "title", "priority_proposed", "status", "status_basis", "strategy", "implementation_location", "tests", "evidence", "blocker", "source"]
with open(os.path.join(root, "docs", "atlasz_v73_requirement_registry.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f); w.writerow(cols)
    for x in d["requirements"]:
        w.writerow([("; ".join(x[c]) if isinstance(x.get(c), list) else (x.get(c) or "")) for c in cols])
print("item-verified:", d["meta"]["item_verified_count"], "of", len(d["requirements"]))
