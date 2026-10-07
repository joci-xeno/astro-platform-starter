#!/usr/bin/env python3
"""ATLASZ V7.3 — 85-capability audit (Joci 85-capability directive, Part 7).
Builds docs/atlasz_capability_audit_85.{json,csv,md}. Statuses change only with evidence; the registry is NOT inflated:
each capability links to EXISTING registry ids (keyword-matched candidates, reviewed) instead of adding duplicate requirements.
Run: python3 docs/capability_audit_85.py
"""
import json, csv, re, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from capability_audit_data import ROWS, SHARED  # noqa: E402

reg = json.load(open(os.path.join(HERE, "atlasz_v73_requirement_registry.json")))["requirements"]
STATUSES = ["VERIFIED_WORKING", "PARTIAL", "MISSING", "DISCONNECTED", "EXTERNAL_BLOCKER", "NOT_APPLICABLE_WITH_REASON"]

def links(kws):
    """Existing registry ids whose title/description/location mentions the keywords (item-level preferred). Candidates, not a coverage claim."""
    out = []
    for it in reg:
        blob = (it["title"] + " " + it.get("description", "") + " " + str(it.get("implementation_location", ""))).lower()
        if any(re.search(k, blob) for k in kws):
            out.append(it["id"])
    items = [i for i in out if re.match(r".*-\d{3}$", i)]
    return (items or out)[:6]

rows = []
for r in ROWS:
    cid, name, kws, mods, status, ev, missing, gaps, sec, plan, tests = r
    assert status in STATUSES, (cid, status)
    rows.append(dict(id=cid, description=name, registry_links=links(kws), modules=mods, status=status, evidence=ev, missing=missing,
                     integration_gaps=gaps, security=sec, plan=plan, tests_required=tests, final_status=status, shared_infrastructure=[s for s, ids in SHARED.items() if cid in ids]))
assert len(rows) == 85 and len({r["id"] for r in rows}) == 85, len(rows)
from collections import Counter
summary = dict(Counter(r["status"] for r in rows)); summary["total"] = len(rows)
json.dump(dict(meta=dict(generated="from capability_audit_data.py", rule="VERIFIED_WORKING needs reproducible evidence; structure/placeholders are PARTIAL or MISSING", shared=SHARED), summary=summary, capabilities=rows),
          open(os.path.join(HERE, "atlasz_capability_audit_85.json"), "w"), indent=1)
with open(os.path.join(HERE, "atlasz_capability_audit_85.csv"), "w", newline="") as f:
    w = csv.writer(f); keys = ["id", "description", "status", "registry_links", "modules", "evidence", "missing", "integration_gaps", "security", "plan", "tests_required", "final_status"]
    w.writerow(keys)
    for r in rows: w.writerow([";".join(r[k]) if isinstance(r[k], list) else r[k] for k in keys])
md = ["# ATLASZ V7.3 — 85-capability audit", "", "Statuses: " + ", ".join(f"{k} {v}" for k, v in summary.items()), ""]
for r in rows:
    md += [f"## {r['id']} — {r['description']} — **{r['status']}**", f"- Registry links (candidates): {', '.join(r['registry_links']) or 'none'}", f"- Modules: {r['modules']}", f"- Evidence: {r['evidence']}",
           f"- Missing: {r['missing']}", f"- Integration gaps / blockers: {r['integration_gaps']}", f"- Security: {r['security']}", f"- Plan: {r['plan']}", f"- Tests required: {r['tests_required']}", ""]
open(os.path.join(HERE, "atlasz_capability_audit_85.md"), "w").write("\n".join(md))
print("capabilities:", len(rows), summary)
