#!/usr/bin/env python3
"""ATLASZ V7.3 — Unified Master Gap Register.
Generated (never hand-edited) from: the V7.3 requirement registry, the 85-capability audit, the source tree (import reachability, test references,
TODO markers, unconnected provider slots) and the Control Center (panels vs data routes). Each gap links to its ORIGINAL requirement / capability id;
nothing is duplicated into the registry. Run: python3 docs/master_gap_register.py  ->  docs/atlasz_master_gap_register.{json,csv,md}
Reality classes keep implemented, sandbox-only, unconnected and live apart:
  LIVE_VERIFIED            (never assigned here: no live provider evidence exists in this workspace)
  SANDBOX_TESTED_PARTIAL   code + tests, sandbox only, incomplete
  MODULE_NOT_CONNECTED     module exists, not reachable from the runtime / Control Center
  STRUCTURE_ONLY           interface / catalogue / placeholder
  UNTESTED                 exists, no test
  NOT_BUILT                missing
  EXTERNAL                 needs a credential / provider / Windows evidence
  OWNER_DECISION           needs Joci approval
"""
import json, csv, os, re, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
reg = json.load(open(os.path.join(HERE, "atlasz_v73_requirement_registry.json")))["requirements"]
cap = json.load(open(os.path.join(HERE, "atlasz_capability_audit_85.json")))

def read(p):
    try: return open(os.path.join(ROOT, p), encoding="utf8", errors="ignore").read()
    except Exception: return ""
def walk(d, exts=(".mjs", ".js")):
    out = []
    for base, dirs, files in os.walk(os.path.join(ROOT, d)):
        dirs[:] = [x for x in dirs if x not in ("node_modules", "public", "build", "data", "fixtures")]
        for f in files:
            if f.endswith(exts): out.append(os.path.relpath(os.path.join(base, f), ROOT))
    return sorted(out)

SRC_DIRS = ["atlasz-addons", "atlasz-runtime", "atlasz-control-center"]
src = [f for d in SRC_DIRS for f in walk(d) if "/electron/" not in f and "/scripts/" not in f]
tests = walk("atlasz-tests")
test_blob = "\n".join(read(t) for t in tests)

# ---- import graph: what is reachable from the two entry points (runtime supervisor, Control Center core/server)
imp_re = re.compile(r'(?:from\s+|import\s*\(\s*|import\s+)["\'](\.[^"\']+)["\']')
def imports(f):
    base = os.path.dirname(f); res = []
    for m in imp_re.finditer(read(f)):
        p = os.path.normpath(os.path.join(base, m.group(1)))
        if os.path.isfile(os.path.join(ROOT, p)): res.append(p)
    return res
ENTRY = ["atlasz-runtime/supervisor-safe.mjs", "atlasz-control-center/core.mjs", "atlasz-control-center/server.mjs", "atlasz-runtime/owner-cli.mjs"]
seen, stack = set(), [e for e in ENTRY if os.path.isfile(os.path.join(ROOT, e))]
while stack:
    f = stack.pop()
    if f in seen: continue
    seen.add(f); stack += imports(f)
modules = [f for f in src if f.startswith("atlasz-addons/")]
orphans = [m for m in modules if m not in seen]
untested = [m for m in modules if os.path.splitext(os.path.basename(m))[0] not in test_blob]

# ---- TODO markers and unconnected provider slots (declared, honest placeholders)
todo_re = re.compile(r"\b(TODO|FIXME|HACK)\b|not implemented|NOT_IMPLEMENTED", re.I)
todos = []
for f in src:
    for n, line in enumerate(read(f).split("\n"), 1):
        if todo_re.search(line): todos.append(dict(file=f, line=n, text=line.strip()[:140]))
slots = sorted({f for f in src if "PLACEHOLDER_UNCONNECTED" in read(f)})

# ---- Control Center panels vs data routes
app = read("atlasz-control-center/public/app.js"); server = read("atlasz-control-center/server.mjs")
routes = set(re.findall(r'"(/api/[a-z0-9/_-]+)"', server))
names = re.search(r"const NAMES = \{(.*?)\};", app, re.S)
panel_keys = re.findall(r"(\w+):\s*\"", names.group(1)) if names else []
panels = []
def panel_body(k):
    m = re.search(r"\nviews\.%s\s*=\s*async" % k, app) or re.search(r"\n\s+async %s\(\)" % k, app)
    if not m: return None
    rest = app[m.end():]; e = re.search(r"\n  async [a-z_]+\(\)|\nviews\.|\nconst NAMES", rest)
    return rest[: e.start()] if e else rest
for k in panel_keys:
    body = panel_body(k)
    apis = sorted(set(re.findall(r'"(/api/[a-z0-9/_-]+)"', body or "")))
    if k.startswith("brain_") and not apis: apis = ["/api/brain"]
    if body is None and not k.startswith("brain_"): status = "NO_VIEW_FOUND"
    else: status = "BROKEN_ROUTE" if any(a not in routes for a in apis) else ("NO_DATA_SOURCE" if not apis else "CONNECTED")
    panels.append(dict(panel=k, apis=apis, status=status))

# ---- workstreams (shared infrastructure) by keyword; first match wins
WS = [("PERSONAL_HUMAN_CORE", r"human core|emotion|compassion|character|help mode|human impact|tone|personal|preferenc|routine|private memory|döntés|kár|biztons|joci|rutin|projekt"),
      ("SCHEDULER_PCC", r"schedul|recurring task|reminder|deadline|personal command|task list"),
      ("TYPED_TOOLS_MODEL_ROUTER", r"function call|typed tool|model rout|multi-model|provider health|fallback|tool bridge|connector|mcp|llm|model"),
      ("KNOWLEDGE_RESEARCH", r"knowledge|research|citation|document|rag|retriev|memory|evidence|source"),
      ("CODE_SANDBOX_ENGINEERING", r"sandbox|code exec|software dev|code review|refactor|repository|prototype"),
      ("MULTIMODAL_VOICE", r"voice|stt|tts|speech|image|video|vision|camera|screen|audio|multimodal|media|ocr"),
      ("COMPUTER_USE", r"computer use|browser|desktop automation"),
      ("RECOVERY_BACKUP", r"backup|restore|recovery|rollback|last known good|lkg|disaster|checkpoint|update center"),
      ("SECURITY_OWNER", r"owner|approval|secret|vault|security|kill switch|safe mode|authentic|permission|audit"),
      ("MONEY_BUSINESS", r"money|revenue|invoice|payment|deal|crm|inbox|customer|profit|billing|quote|sales|outreach|tax|gst"),
      ("WINDOWS_CONTROL_CENTER", r"windows|installer|desktop|control center|electron|mobile|panel|ui\b"),
      ("AGENT_ORCHESTRATION", r"agent|orchestr|handoff|queue|planner|dispatch|30"),
      ("OBSERVABILITY_DOCTOR", r"observab|black box|doctor|watchdog|health|monitor|anomal|log")]
def ws_of(*texts):
    t = " ".join(str(x) for x in texts).lower()
    for name, rx in WS:
        if re.search(rx, t): return name
    return "UNASSIGNED"
NORM = {"TYPED_TOOLS_AND_SCHEMAS": "TYPED_TOOLS_MODEL_ROUTER", "DURABLE_SCHEDULER": "SCHEDULER_PCC", "MODALITY_FABRIC_AND_OBSERVATION_MEMORY": "MULTIMODAL_VOICE", "CODE_SANDBOX": "CODE_SANDBOX_ENGINEERING",
        "ENGINEERING_TOOLS": "CODE_SANDBOX_ENGINEERING", "KNOWLEDGE_PROJECTS": "KNOWLEDGE_RESEARCH", "RESEARCH_LEDGER": "KNOWLEDGE_RESEARCH"}
def section_of(rid):
    m = re.match(r"V73-S(\d+)", rid or ""); return "SECTION_S" + m.group(1) if m else "UNASSIGNED"

def reality(i):
    s = i["status"]; integ = str(i.get("integration_status") or "")
    if s == "BLOCKED_AWAITING_JOCI_APPROVAL": return "OWNER_DECISION"
    if s == "EXTERNAL_BLOCKER": return "EXTERNAL"
    if s == "MISSING": return "NOT_BUILT"
    if s == "STRUCTURAL_ONLY": return "STRUCTURE_ONLY"
    if s == "EXISTS_NEEDS_TEST": return "UNTESTED"
    if "Module only" in integ: return "MODULE_NOT_CONNECTED"
    return "SANDBOX_TESTED_PARTIAL" if (i.get("tests") and i["tests"] != "[]") else "STRUCTURE_ONLY"

gaps = []
for i in reg:
    if i.get("level") != "item" or i["status"] == "EXISTS_AND_WORKING": continue
    loc = str(i.get("implementation_location") or "")
    gaps.append(dict(gap_id="GAP-" + i["id"], source="REGISTRY", requirement_id=i["id"], title=i["title"][:180], status=i["status"], reality=reality(i), priority=i.get("priority_proposed"),
                     modules=loc[:200], tests=str(i.get("tests") or "")[:160], blocker=str(i.get("blocker") or "")[:200], workstream=(lambda w: section_of(i["id"]) if w == "UNASSIGNED" else w)(ws_of(i["title"], i.get("description"), loc)), depends_on=str(i.get("dependencies") or "")))
for c in cap["capabilities"]:
    if c["status"] == "VERIFIED_WORKING": continue
    ws = NORM.get((c.get("shared_infrastructure") or [None])[0], (c.get("shared_infrastructure") or [None])[0]) or ws_of(c["description"], c["modules"])
    gaps.append(dict(gap_id="GAP-CAP-" + c["id"], source="CAPABILITY_85", requirement_id=c["id"], title=c["description"], status=c["status"], reality={"EXTERNAL_BLOCKER": "EXTERNAL", "MISSING": "NOT_BUILT", "PARTIAL": "SANDBOX_TESTED_PARTIAL", "DISCONNECTED": "MODULE_NOT_CONNECTED"}.get(c["status"], "STRUCTURE_ONLY"),
                     priority="85-CAP", modules=c["modules"][:200], tests=c["evidence"][:160], blocker=c["integration_gaps"][:200], workstream=ws, depends_on=";".join(c["registry_links"])))
BY_DESIGN = {"atlasz-addons/tenant-isolation.mjs": "Commercial/licensing foundation (V7.3 §47). Intentionally NOT wired into JOCI's own runtime: commercialization needs Joci's separate authorization."}
for m in orphans:
    if m in BY_DESIGN:
        gaps.append(dict(gap_id="GAP-ORPHAN-" + os.path.basename(m), source="IMPORT_SCAN", requirement_id="V73-S47", title=BY_DESIGN[m], status="DISCONNECTED_BY_DESIGN", reality="OWNER_DECISION", priority="CHECK", modules=m, tests="tenant-isolation.test.mjs", blocker="Owner authorization for commercialization", workstream="SECURITY_OWNER", depends_on=""))
        continue
    gaps.append(dict(gap_id="GAP-ORPHAN-" + os.path.basename(m), source="IMPORT_SCAN", requirement_id="", title=f"{m} is not reachable from the runtime supervisor, Control Center or owner CLI", status="DISCONNECTED", reality="MODULE_NOT_CONNECTED", priority="CHECK", modules=m,
                     tests="referenced by a test" if os.path.splitext(os.path.basename(m))[0] in test_blob else "NO TEST REFERENCE", blocker="", workstream=ws_of(m), depends_on=""))
for m in untested:
    if m in orphans: continue
    gaps.append(dict(gap_id="GAP-NOTEST-" + os.path.basename(m), source="TEST_SCAN", requirement_id="", title=f"{m} has no test that references it by name", status="UNTESTED", reality="UNTESTED", priority="CHECK", modules=m, tests="", blocker="", workstream=ws_of(m), depends_on=""))
for p in panels:
    if p["status"] != "CONNECTED": gaps.append(dict(gap_id="GAP-PANEL-" + p["panel"], source="PANEL_SCAN", requirement_id="", title=f"Control Center panel '{p['panel']}': {p['status']}", status=p["status"], reality="STRUCTURE_ONLY", priority="CHECK", modules="atlasz-control-center/public/app.js", tests="", blocker=",".join(p["apis"]), workstream="WINDOWS_CONTROL_CENTER", depends_on=""))
for t in todos:
    gaps.append(dict(gap_id=f"GAP-TODO-{t['file'].split('/')[-1]}:{t['line']}", source="TODO_SCAN", requirement_id="", title=t["text"], status="UNFINISHED_MARKER", reality="NOT_BUILT", priority="CHECK", modules=t["file"], tests="", blocker="", workstream=ws_of(t["file"], t["text"]), depends_on=""))

by = lambda key: dict(collections.Counter(g[key] for g in gaps).most_common())
summary = dict(total_gaps=len(gaps), by_source=by("source"), by_reality=by("reality"), by_workstream=by("workstream"), by_status=by("status"),
               registry_items=sum(1 for i in reg if i.get("level") == "item"), registry_gaps=sum(1 for g in gaps if g["source"] == "REGISTRY"), capabilities_with_gaps=sum(1 for g in gaps if g["source"] == "CAPABILITY_85"),
               modules_total=len(modules), modules_reachable_from_entrypoints=len(modules) - len(orphans), orphan_modules=orphans, modules_without_test_reference=untested,
               unconnected_provider_slots=slots, todo_markers=len(todos), panels=dict(collections.Counter(p["status"] for p in panels)), live_verified_items=0,
               note="LIVE_VERIFIED is intentionally zero: no live provider, payment, delivery or Windows-run evidence exists in this workspace.")
out = dict(meta=dict(generated_from=["atlasz_v73_requirement_registry.json", "atlasz_capability_audit_85.json", "source tree scan"], reality_classes=sorted({g["reality"] for g in gaps})), summary=summary, panels=panels, gaps=gaps)
json.dump(out, open(os.path.join(HERE, "atlasz_master_gap_register.json"), "w"), indent=1)
keys = ["gap_id", "source", "requirement_id", "title", "status", "reality", "priority", "workstream", "modules", "tests", "blocker", "depends_on"]
with open(os.path.join(HERE, "atlasz_master_gap_register.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(keys); [w.writerow([g[k] for k in keys]) for g in gaps]
md = ["# ATLASZ V7.3 — Unified Master Gap Register", "", f"Total gaps: **{len(gaps)}** (registry {summary['registry_gaps']}, 85-capability {summary['capabilities_with_gaps']}, scans {len(gaps) - summary['registry_gaps'] - summary['capabilities_with_gaps']}).", "",
      "LIVE_VERIFIED: **0** — no live provider/payment/delivery/Windows-run evidence exists in this workspace.", "", "## By reality", *[f"- {k}: {v}" for k, v in summary["by_reality"].items()], "", "## By workstream", *[f"- {k}: {v}" for k, v in summary["by_workstream"].items()], "",
      f"## Reachability\n- Modules in atlasz-addons: {summary['modules_total']}; reachable from entry points: {summary['modules_reachable_from_entrypoints']}", *[f"- ORPHAN: {m}" for m in orphans], "", "## Modules without a test reference", *[f"- {m}" for m in untested], "",
      "## Unconnected provider slots (declared PLACEHOLDER_UNCONNECTED)", *[f"- {m}" for m in slots], "", "## Control Center panels", *[f"- {p['panel']}: {p['status']} {p['apis']}" for p in panels if p["status"] != "CONNECTED"], f"- connected: {sum(1 for p in panels if p['status'] == 'CONNECTED')} of {len(panels)}", "",
      "## Highest-priority open gaps (P0, not external/owner)", *[f"- {g['gap_id']} [{g['reality']}] {g['title'][:110]}" for g in gaps if g['priority'] == 'P0' and g['reality'] not in ('EXTERNAL', 'OWNER_DECISION')][:60], ""]
open(os.path.join(HERE, "atlasz_master_gap_register.md"), "w").write("\n".join(md))
print(json.dumps({k: summary[k] for k in ["total_gaps", "by_source", "by_reality", "by_workstream", "panels", "todo_markers"]}, indent=1)); print("orphans:", orphans); print("untested:", untested)
