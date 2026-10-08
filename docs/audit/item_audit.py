#!/usr/bin/env python3
"""Task 3 item-level audit (reproducible). Inputs: registry JSON, static_scan.json, test_results.json. Outputs: docs/audit/item_audit.json / .csv.
For EVERY registry row it computes mechanical verification facts (files exist? tests exist and pass? tests reference the module? module reachable from runtime/Control Center/CLI?)
and, for rows that are not IMPLEMENTED, the categories of work still required, derived from the row's own blocker/evidence text and the facts above.
It never upgrades a status. Downgrades are applied only by docs/audit/reclassify.py from rules listed in the report."""
import os, re, json, csv
from collections import Counter
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
J = lambda p: json.load(open(os.path.join(root, p), encoding="utf-8"))
reg = J("docs/atlasz_v73_requirement_registry.json")["requirements"]; ss = J("docs/audit/static_scan.json"); tr = J("docs/audit/test_results.json")
mods = {m["file"]: m for m in ss["modules"]}; G = ss["graph"]; TG = ss["tgraph"]; by_base = {}
for f in mods: by_base.setdefault(os.path.basename(f), []).append(f)
tests_dir = os.path.join(root, "atlasz-tests"); test_text = {t: open(os.path.join(tests_dir, t), encoding="utf-8", errors="replace").read() for t in os.listdir(tests_dir) if t.endswith(".test.mjs")}
HOSTED = {t for t, s in test_text.items() if "supervisor-safe" in s or "createControlCenterServer" in s or "createControlCenterCore" in s}
def resolve_locs(loc):
    files, missing = [], []
    for tok in re.split(r"[;,]", loc or ""):
        t = tok.strip().split(" ")[0].strip("()")
        if not t or not re.search(r"\.(m?js|cjs|py|json|md)$|/$", t): continue
        if os.path.exists(os.path.join(root, t)) and t.endswith("/"): continue
        if os.path.isfile(os.path.join(root, t)): files.append(t)
        elif t in by_base and len(by_base[t]) == 1: files.append(by_base[t][0])
        elif os.path.basename(t) in by_base and len(by_base[os.path.basename(t)]) == 1 and "/" not in t: files.append(by_base[os.path.basename(t)][0])
        elif t.startswith("atlasz-tests/") or t.startswith("docs/") or t.startswith("scripts/"): (files if os.path.isfile(os.path.join(root, t)) else missing).append(t)
        else: missing.append(t)
    return sorted(set(files)), missing
KW = dict(
 EXTERNAL=r"provider|credential|\bAPI\b|Railway|Windows|installer|Electron|network|STT|TTS|OCR|vision|embedding|Stripe|bank|PayPal|email provider|SMS|SMTP|IMAP|domain|DNS|hosting|certificate|code.?sign|HSM|OAuth|webhook|cloud|GPU|hardware|camera|microphone|speaker|mobile app|iOS|Android|push notification|live feed|EXTERNAL",
 OWNER=r"JOCI|owner (decision|approval|key)|approval|authoriz|spend|budget|contract|deploy|production|legal|tax rules|accountant|real key|public key|sign",
 SECURITY=r"secret|vault|permission|tenant|isolation|privacy|encrypt|auth|audit|kill ?switch|firewall|injection|sandbox|consent|redact|RBAC|role",
 UI=r"Control Center|panel|view|GUI|dashboard|desktop|screen|button|tab\b|widget|UX|\bUI\b|mission control|skin|theme",
 RUNTIME=r"runtime|30.?agent|agent[s ]|scheduler|queue|supervisor|watchdog|wired|not wired|standalone|not driving|not connected|integrat",
)
def cats(x, facts):
    t = " ".join([x["title"], x.get("description") or "", x.get("blocker") or "", " ".join(x.get("evidence") or [])])
    c = []
    if x["status"] in ("MISSING",) or not facts["loc_files"]: c.append("CODE")
    elif x["status"] in ("PARTIAL", "STRUCTURAL_ONLY"): c.append("CODE_COMPLETION")
    if facts["loc_files"] and facts["reach"] not in ("RUNTIME", "CONTROL_CENTER", "CLI"): c.append("INTEGRATION")
    elif re.search(r"not wired|standalone|not driving|not connected|no runtime|not integrated|MODULE_NOT_CONNECTED", t, re.I): c.append("INTEGRATION")
    if x["status"] == "EXISTS_NEEDS_TEST" or not facts["tests_passing"]: c.append("TESTS")
    if re.search(KW["SECURITY"], x["title"] + " " + (x.get("description") or ""), re.I): c.append("SECURITY_REVIEW")
    if re.search(KW["UI"], x["title"] + " " + (x.get("blocker") or ""), re.I): c.append("UI")
    if x["status"] == "EXTERNAL_BLOCKER" or re.search(KW["EXTERNAL"], x.get("blocker") or "", re.I): c.append("EXTERNAL_DEPENDENCY")
    if x["status"] == "BLOCKED_AWAITING_JOCI_APPROVAL" or x.get("owner_decision") or re.search(r"JOCI|owner decision|owner approval|spend|production|Railway|real key|legal|accountant", x.get("blocker") or "", re.I): c.append("OWNER_APPROVAL")
    return sorted(set(c))
out = []
for x in reg:
    files, missing = resolve_locs(x.get("implementation_location"))
    tfiles = [t.split("/")[-1] for t in (x.get("tests") or []) if t.endswith(".test.mjs")]
    t_exist = [t for t in tfiles if t in test_text]; t_missing = [t for t in tfiles if t not in test_text]
    t_pass = [t for t in t_exist if tr.get(t, {}).get("fail", 1) == 0 and tr.get(t, {}).get("exit", 1) == 0 and tr.get(t, {}).get("pass_", 0) > 0]
    t_fail = [t for t in t_exist if t not in t_pass]
    bases = {os.path.basename(f) for f in files}
    idents = set()
    for f in files:
        try: idents |= set(re.findall(r"export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]{5,})", open(os.path.join(root, f), encoding="utf-8", errors="replace").read()))
        except OSError: pass
    idents -= {"LIMITS", "VERSION", "KINDS", "STATUSES", "CLASSES", "SCOPES"}                      # generic names appear in many unrelated tests
    named = lambda t: any(b in test_text[t] for b in bases) or any(re.search(r"\b" + re.escape(i) + r"\b", test_text[t]) for i in idents)
    direct = [t for t in t_pass if named(t)] if bases else []
    reach = "NONE"
    if files:
        order = ["RUNTIME", "CONTROL_CENTER", "CLI", "LEGACY_ONLY", "TEST_ONLY", "ORPHAN"]; rs = [mods[f]["reach"] for f in files if f in mods]
        reach = min(rs, key=order.index) if rs else "NON_CODE"
    invs = [mods[f].get("invocation") for f in files if f in mods]
    invocation = "NONE" if not invs else ("INVOKED_BY_PRODUCTION_CODE" if "INVOKED_BY_PRODUCTION_CODE" in invs else "INVOKED_VIA_HUB_HOOKS" if "INVOKED_VIA_HUB_HOOKS" in invs else invs[0])
    def closure(t):                                                   # modules a test pulls in, NOT counting the two big hosts (every module is behind them)
        seen, st = set(), [x for x in TG.get(t, []) if not x.endswith(("supervisor-safe.mjs", "control-center/server.mjs", "control-center/core.mjs"))]
        while st:
            x = st.pop()
            if x in seen: continue
            seen.add(x); st += [y for y in G.get(x, []) if not y.endswith(("supervisor-safe.mjs", "control-center/server.mjs", "control-center/core.mjs"))]
        return seen
    facade = [t for t in t_pass if t not in direct and any(f in closure(t) for f in files)]
    hosted = [t for t in direct if t in HOSTED] if reach in ("RUNTIME", "CONTROL_CENTER") else []
    lvl = "L0_NONE"
    if files: lvl = "L1_CODE_EXISTS"
    if files and t_pass: lvl = "L2_UNIT_TESTED" if (direct or facade) else "L1_CODE_EXISTS_TESTS_DO_NOT_EXERCISE_MODULE"
    if files and (direct or facade) and reach in ("RUNTIME", "CONTROL_CENTER", "CLI"): lvl = "L3_CONNECTED_AND_TESTED" if (hosted or reach != "TEST_ONLY") else lvl
    facts = dict(loc_files=files, loc_missing=missing, tests_listed=tfiles, tests_missing=t_missing, tests_failing=t_fail, tests_passing=t_pass, tests_naming_module=direct, tests_via_facade=facade, reach=reach, invocation=invocation, verification_level=lvl)
    rec = dict(id=x["id"], level=x["level"], section=x["section"], title=x["title"], priority=x.get("priority_proposed"), registry_status=x["status"], strategy=x.get("strategy"), blocker=x.get("blocker"),
               evidence=(x.get("evidence") or [""])[0][:300], implementation_location=x.get("implementation_location"), **facts)
    rec["flags"] = ([] if x["status"] != "EXISTS_AND_WORKING" else [f for f, cond in [("NO_MODULE_FILE", not files), ("LOCATION_FILE_NOT_FOUND", bool(missing) and not files), ("NO_TEST_LISTED", not tfiles), ("LISTED_TEST_MISSING", bool(t_missing)), ("LISTED_TEST_FAILS", bool(t_fail) and not t_pass),
                    ("TESTS_DO_NOT_EXERCISE_MODULE", bool(files) and bool(t_pass) and not direct and not facade), ("MODULE_NOT_REACHABLE_FROM_RUNTIME_CC_CLI", bool(files) and reach not in ("RUNTIME", "CONTROL_CENTER", "CLI", "NON_CODE")), ("MODULE_TESTED_BUT_NEVER_INVOKED_BY_A_RUNTIME_WORKFLOW", bool(files) and invocation in ("HUB_ADAPTER_BAG_ONLY",) )] if cond])
    if x["status"] != "EXISTS_AND_WORKING": rec["work_categories"] = cats(x, facts)
    out.append(rec)
json.dump(out, open(os.path.join(root, "docs/audit/item_audit.json"), "w"), indent=1, ensure_ascii=False)
with open(os.path.join(root, "docs/audit/item_audit.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["id", "level", "section", "title", "priority", "registry_status", "verification_level", "reach", "invocation", "flags", "work_categories", "strategy", "blocker", "implementation_location", "tests_passing", "tests_missing", "tests_failing"])
    for r in out: w.writerow([r["id"], r["level"], r["section"], r["title"], r["priority"], r["registry_status"], r["verification_level"], r["reach"], r["invocation"], "|".join(r["flags"]), "|".join(r.get("work_categories", [])), r["strategy"], r["blocker"], r["implementation_location"], "|".join(r["tests_passing"]), "|".join(r["tests_missing"]), "|".join(r["tests_failing"])])
W = [r for r in out if r["registry_status"] == "EXISTS_AND_WORKING"]
print("working", len(W), "flagged", sum(1 for r in W if r["flags"]), Counter(f for r in W for f in r["flags"]), Counter(r["verification_level"] for r in W))
print("non-working categories", Counter(c for r in out if r["registry_status"] != "EXISTS_AND_WORKING" and r["level"] == "item" for c in r["work_categories"]))
