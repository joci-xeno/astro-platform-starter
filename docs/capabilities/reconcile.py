#!/usr/bin/env python3
"""Reconcile the 85-capability classification against the CURRENT code, tests and runtime reach (Task 4 / capability programme).
Mechanical facts only (never raises a status): for every capability id, list the module files named in its row, whether they exist, which test files import them and whether those
test files pass (docs/audit/test_results.json), and whether the module is invoked by a runtime / Control Center workflow (docs/audit/static_scan.json).
Output: docs/capabilities/reconciliation_85.json + a summary. Run after docs/audit/static_scan.py and docs/audit/run_tests_per_file.py."""
import json, os, re, sys, collections
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(root, "docs"))
from capability_audit_data import ROWS
S = json.load(open(os.path.join(root, "docs/audit/static_scan.json")))
T = json.load(open(os.path.join(root, "docs/audit/test_results.json")))
MOD = {m["file"]: m for m in S["modules"]}
BYBASE = collections.defaultdict(list)
for f in MOD: BYBASE[os.path.basename(f)].append(f)
for f in S["graph"]:
    if f not in MOD: BYBASE[os.path.basename(f)].append(f)
PAT = re.compile(r"([A-Za-z0-9_./-]+\.m?js)")
out = []
for r in ROWS:
    cid, name, kws, mods, status = r[0], r[1], r[2], r[3], r[4]
    named = []
    for tok in PAT.findall(mods.replace(";", " ").replace(",", " ")):
        base = os.path.basename(tok)
        c = [f for f in BYBASE.get(base, []) if f.endswith(tok) or tok.endswith(os.path.basename(f))] or BYBASE.get(base, [])
        named.append(dict(token=tok, files=c[:2]))
    files = sorted({f for n in named for f in n["files"]})
    missing_tokens = sorted({n["token"] for n in named if not n["files"]})
    tests = sorted({t for f in files for t in MOD.get(f, {}).get("tests", [])})
    tr = {t: T.get(t) for t in tests}
    failing = sorted(t for t, v in tr.items() if v and v["fail"])
    notrun = sorted(t for t, v in tr.items() if v is None)
    reach = {f: (MOD[f]["reach"], MOD[f]["invocation"]) for f in files if f in MOD}
    invoked = sorted(f for f, (re_, inv) in reach.items() if inv and inv not in ("HUB_ADAPTER_BAG_ONLY", "NONE", "NOT_INVOKED"))
    out.append(dict(id=cid, name=name, status=status, module_files=files, tokens_without_file=missing_tokens, tests=tests, tests_passing=sum(1 for v in tr.values() if v and not v["fail"] and v["pass_"]),
                    tests_failing=failing, tests_not_run=notrun, invoked_by_workflow=invoked, hub_bag_only=sorted(f for f, (a, b) in reach.items() if b == "HUB_ADAPTER_BAG_ONLY")))
json.dump(out, open(os.path.join(root, "docs/capabilities/reconciliation_85.json"), "w"), indent=1)
c = collections.Counter(r["status"] for r in out)
print("capabilities", len(out), dict(c))
print("with a named module file missing:", [r["id"] for r in out if r["tokens_without_file"]])
print("with failing tests:", [r["id"] for r in out if r["tests_failing"]])
print("VERIFIED rows - invoked:", {r["id"]: (len(r["invoked_by_workflow"]), r["tests_passing"], r["tests_failing"]) for r in out if r["status"] == "VERIFIED_WORKING"})
print("PARTIAL rows with zero invoked modules:", [r["id"] for r in out if r["status"] == "PARTIAL" and not r["invoked_by_workflow"]])
