#!/usr/bin/env python3
"""ATLASZ BRAIN program: assessment + numbered work plan (RECORDS ONLY - never touches running-system code).
Run from repo root: python3 docs/brain_program/build_brain_program.py
Inputs : docs/system_inventory/atlasz_system_inventory.sqlite (1 047 items), docs/identity_registry ledger.
Outputs: docs/brain_program/*  + appended ledger/history entries (new ATL-PLN / ATL-WRK / ATL-DEC only)."""
import csv, json, os, re, sys, sqlite3, collections, subprocess, importlib.util
ROOT = os.getcwd(); OUT = os.path.join(ROOT, "docs/brain_program"); INV = os.path.join(ROOT, "docs/system_inventory"); V1 = os.path.join(ROOT, "docs/identity_registry")
TODAY = "2026-10-12"
def sh(*a): return subprocess.run(a, cwd=ROOT, capture_output=True, text=True).stdout
HEAD = sh("git", "rev-parse", "--short", "HEAD").strip()
def load(n):
    sp = importlib.util.spec_from_file_location(n, os.path.join(OUT, n + ".py")); m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m
D = load("brain_data"); C = load("brain_content")
db = sqlite3.connect("file:%s?mode=ro" % os.path.join(INV, "atlasz_system_inventory.sqlite"), uri=True); db.row_factory = sqlite3.Row
inv = {r["id"]: dict(r) for r in db.execute("select * from inventory_items")}
by_name = collections.defaultdict(list)
for i, r in inv.items():
    if r["record_type"].startswith("MEGL"): by_name[r["name"]].append(i)
wp = {r["id"]: dict(r) for r in db.execute("select * from work_plan")}
pln_old = {r["id"]: dict(r) for r in db.execute("select * from planned_modules")}
dec_old = {r["id"]: dict(r) for r in db.execute("select * from owner_decisions")}
N_INV, N_WRK, N_PLN = len(inv), len(wp), len(pln_old)
def resolve(x):
    if re.fullmatch(r"ATL-[A-Z]+-\d{4}", x):
        if x not in inv: raise SystemExit("UNKNOWN ATL id " + x)
        return x
    c = by_name.get(x, [])
    if len(c) != 1: raise SystemExit("AMBIGUOUS/UNKNOWN component name %r -> %s" % (x, c))
    return c[0]

# ---------------------------------------------------------------- ledger (shared permanent ID ledger; append-only history)
LED = json.load(open(os.path.join(V1, "id_ledger.json"), encoding="utf-8"))
LED_BEFORE = json.loads(json.dumps(LED["entries"]))
HIST = []
def alloc(cat, key, name):
    e = LED["entries"].get(key)
    if e:
        if e.get("name") != name:
            HIST.append({"at": TODAY, "commit": HEAD, "id": e["id"], "event": "NAME_CHANGED", "key": key, "from": e.get("name"), "to": name}); e["name"] = name
        return e["id"]
    n = LED["next"].get(cat, 1); i = "ATL-%s-%04d" % (cat, n); LED["next"][cat] = n + 1
    LED["entries"][key] = {"id": i, "category": cat, "name": name, "first_seen": TODAY, "first_seen_commit": HEAD, "status": "ACTIVE"}
    HIST.append({"at": TODAY, "commit": HEAD, "id": i, "event": "ALLOCATED", "key": key, "name": name}); return i

# ---------------------------------------------------------------- allocate
PLN = {}
for slug, kind, name, adopts in D.PLNS:
    if any(re.sub(r"\W+", "", name.lower()) == re.sub(r"\W+", "", p["name"].lower()) for p in pln_old.values()): raise SystemExit("DUPLICATE PLN name " + slug)
    for a in adopts:
        if a not in pln_old: raise SystemExit("adopted PLN missing " + a)
    PLN[slug] = dict(id=alloc("PLN", "pln:brain:" + slug, name), slug=slug, kind=kind, name=name, adopts=adopts, tasks=[], status={"NEW": "PLANNED", "EXTEND": "PLANNED_EXTEND"}[kind])
DEC = {}
for slug, name in D.DECS: DEC[slug] = dict(id=alloc("DEC", "dec:brain:" + slug, name), slug=slug, name=name)
for k, v in D.EXIST_DEC.items():
    if v not in dec_old: raise SystemExit("existing DEC missing " + v)
    DEC[k] = dict(id=v, slug=k, name=dec_old[v]["name"], existing=True)
TASK = {}
for t in D.T:
    if t["slug"] in TASK: raise SystemExit("dup task slug " + t["slug"])
    w = dict(t); w["id"] = alloc("WRK", "wrk:brain:" + t["slug"], t["title"]); TASK[t["slug"]] = w
for t in TASK.values():
    t["gates"] = list(dict.fromkeys(["impl-per-atl"] + t["gates"]))
    t["comp_ids"] = list(dict.fromkeys(resolve(c) for c in t["comps"]))
    t["dep_ids"] = []
    for d in t["deps"]:
        if d in TASK: t["dep_ids"].append(TASK[d]["id"])
        elif d in wp: t["dep_ids"].append(d)
        else: raise SystemExit("unknown dep %s in %s" % (d, t["slug"]))
    t["pln_id"] = PLN[t["pln"]]["id"]; PLN[t["pln"]]["tasks"].append(t["id"])
    t["gate_ids"] = [DEC[g]["id"] for g in t["gates"]]
    t["total"] = t["impl"] + t["ver"]
    t["existing_wrk"] = []
    for c in t["comp_ids"]:
        for w_ in (inv[c].get("work_ids") or "").split("; "):
            if w_ and w_ in wp and w_ not in t["existing_wrk"]: t["existing_wrk"].append(w_)
    t["existing_wrk"] = t["existing_wrk"][:10]

# critical path (hours) over the program + existing prerequisite WRK
memo = {}
def cp(i):
    if i in memo: return memo[i]
    if i in wp: memo[i] = (float(wp[i]["est_total_h"]), [i]); return memo[i]
    t = next(x for x in TASK.values() if x["id"] == i)
    best = (0, [])
    for d in t["dep_ids"]:
        r = cp(d)
        if r[0] > best[0]: best = r
    memo[i] = (best[0] + t["total"], best[1] + [i]); return memo[i]
for t in TASK.values(): t["cp_h"], t["cp_path"] = cp(t["id"])
crit = max(TASK.values(), key=lambda x: x["cp_h"])

# ---------------------------------------------------------------- tables
def semi(x): return "; ".join(x)
PH_ORDER = list(D.PHASES)
ORDER = sorted(TASK.values(), key=lambda t: (PH_ORDER.index(t["phase"]), t["id"]))
for n, t in enumerate(ORDER, 1): t["no"] = n
WORK_ROWS = [dict(no=t["no"], id=t["id"], ref_code=t["slug"].split("-")[0], phase=t["phase"], phase_name=D.PHASES[t["phase"]], priority=t["prio"], capabilities=semi("#%d" % c for c in t["caps"]), title=t["title"], exact_work=t["work"],
                  atl_component_ids=semi(t["comp_ids"]), atl_component_names=semi(inv[c]["name"] for c in t["comp_ids"]), planned_module_id=t["pln_id"], also_planned_module_ids=semi(t["also_pln"]),
                  depends_on=semi(t["dep_ids"]), related_existing_work=semi(t["existing_wrk"]), est_impl_h=t["impl"], est_verify_h=t["ver"], est_total_h=t["total"], approval_gates=semi(t["gate_ids"]),
                  acceptance=t["accept"], tests=semi(x[0] for x in t["tests"]), external=t["ext"], live_or_fixture=("ÉLŐ szint is" if any("ÉLŐ" in x[2] for x in t["tests"]) else "fixture"), status="TERVEZETT (nincs jóváhagyva, nincs megkezdve)") for t in ORDER]
PLN_ROWS = [dict(id=p["id"], slug=p["slug"], name=p["name"], kind=p["kind"], status=p["status"], adopts_existing_planned_modules=semi(p["adopts"]), work_ids=semi(p["tasks"]),
                 phases=semi(sorted({TASK_ID[0] for TASK_ID in [(t["phase"],) for t in TASK.values() if t["pln"] == p["slug"]]})), est_total_h=sum(t["total"] for t in TASK.values() if t["pln"] == p["slug"]),
                 note="TERVEZETT modul – még NEM létezik; a bővítés/új modul csak jóváhagyás után épül") for p in PLN.values()]
DEC_ROWS = [dict(id=d["id"], slug=d["slug"], name=d["name"], origin="MEGLÉVŐ döntés (ATL-DEC)" if d.get("existing") else "ÚJ (Brain-program)", needed_by=semi(t["id"] for t in ORDER if d["id"] in t["gate_ids"]), status="NYITOTT – tulajdonosi aláírásra vár") for d in DEC.values()]
TEST_ROWS = []
for t in ORDER:
    for (name, level, kind, crit_) in t["tests"]:
        TEST_ROWS.append(dict(work_id=t["id"], planned_test=name, level=level, evidence_kind=kind, pass_criterion=crit_, note="Az ATL-TST azonosító a teszt megírásakor kerül kiosztásra; fixture-eredmény sosem minősül ÉLŐ bizonyítéknak"))

# module assessment: all existing BRN, AUR, MDL, MEM, VOI, AGT + every component referenced by the plan
cats = ("BRN", "AUR", "MDL", "MEM", "VOI", "AGT")
refd = {c for t in TASK.values() for c in t["comp_ids"]}
sel = [i for i, r in inv.items() if r["record_type"].startswith("MEGL") and (r["category"] in cats or i in refd or r["name"] == "modality-fabric")]
tasks_of = collections.defaultdict(list)
for t in ORDER:
    for c in t["comp_ids"]: tasks_of[c].append(t["id"])
ASSESS = []
for i in sorted(sel):
    r = inv[i]; key = r["name"]; dk = "%s:%s" % (r["category"], r["kind"])
    o = C.OV.get(key) or C.DEFAULT_BY_CAT.get(dk) or (C.DEFAULT_BY_CAT.get(r["category"] + ":SOURCE_FILE") if r["category"] == "BRN" else None)
    if not o: o = ("TÁMOGATÓ KOMPONENS (a tervben hivatkozott, nem Brain-modul)", "nem", "–", (r.get("function") or "")[:120], [])
    ASSESS.append(dict(atl_id=i, name=r["name"], category=r["category"], kind=r["kind"], inventory_status=r["status"], real_state=o[0], model_dependent=o[1], wired_to=o[2], finding=o[3],
                       capabilities=semi("#%d" % c for c in o[4]), linked_new_work=semi(tasks_of.get(i, [])), existing_work=r.get("work_ids", ""), existing_planned=r.get("planned_module_refs", "")))
CAPROWS = []
for n, name in D.CAPS.items():
    s = C.CAP_STATUS[n]; ts = [t for t in ORDER if n in t["caps"]]
    CAPROWS.append(dict(capability_no=n, capability=name, state_now=s["now"], what_works=s["works"], simulated_or_unproven=s["simulated"], missing=s["missing"],
                        key_existing_components=semi(sorted({c for a in ASSESS if "#%d" % n in a["capabilities"].split("; ") for c in [a["atl_id"]]})[:14]), new_work_count=len(ts),
                        new_work_ids=semi(t["id"] for t in ts), est_total_h=sum(t["total"] for t in ts if t["pln"] and True)))
CONSUMERS = [  # consumer name, current relation to Brain, target, work slugs
 ("aurora", "NINCS: aurora.respond a Brain-t nem hívja (csak human-core)", "Brain Gateway konzultáció + közös beszélgetési út", ["b24-chat-aurora-unify", "b23-conversation-orchestrator"]),
 ("POST /api/chat", "NINCS: core.chat → master-brief.answerQuery (4 regex)", "Brain Gateway (understand/consult)", ["b24-chat-aurora-unify"]),
 ("POST /api/aurora/utterance", "NINCS: közvetlen auroraRespond", "Brain Gateway", ["b24-chat-aurora-unify", "b71-voice-brain-bridge"]),
 ("POST /api/brain/command", "REGEX whitelist (owner-command)", "Szándékfelismerő motor + whitelist végrehajtási kapu", ["b22-understanding-engine"]),
 ("brain-master-bridge", "API-only (agents30/action), UI nincs, kész planId kell", "Szöveg → terv → futás a Gatewayen és UI-n", ["b37-plan-schema-bridge", "b103-brain-ui"]),
 ("agent-workforce", "NINCS: csak CC-ben hostolt, Brain-t nem kérdezi", "Gateway-konzultáció, runtime-hostolás", ["b96-workforce-in-runtime", "b100-wire-agents"]),
 ("master-coordinator", "Felügyeleti tick; Brain csak infrastruktúra", "Gateway-n át terv/tanács", ["b100-wire-agents"]),
 ("atlasz-runtime/supervisor-safe.mjs", "INFRASTRUKTÚRA: security/blackBox/dispatch, külön Brain-példány", "Egyetlen megosztott Brain", ["b01-single-brain", "b96-workforce-in-runtime"]),
 ("business/money-engine", "INFRASTRUKTÚRA: dispatch + memory.recordOutcome", "Brain-javaslat (pénzügyi jogosultság változatlan)", ["b101-wire-business"]),
 ("global-discovery", "NINCS Brain-konzultáció (opportunity-intelligence csak szűr)", "Brain-javaslat felderítéshez (élő forrás tiltva)", ["b101-wire-business"]),
 ("campaign-manager", "NINCS", "Brain-javaslat", ["b101-wire-business"]),
 ("workbench", "conversation.complete → NO_ELIGIBLE_PROVIDER", "Gateway", ["b102-wire-workflows"]),
 ("translation-feedback", "MODEL_NOT_CONFIGURED adapter nélkül", "Gateway modell-út", ["b102-wire-workflows"]),
 ("code-edit-workflow", "Önálló; modell nem ír szerkesztést", "Brain-javaslat → átnézés → jóváhagyás", ["b95-fix-loop", "b102-wire-workflows"]),
 ("voice-conversation", "Mock szolgáltatók; böngészős hang megkerüli", "Hang → Gateway", ["b71-voice-brain-bridge"]),
 ("brain/memory-fabric", "write-mostly", "Olvasás a Context Builderbe", ["b65-memory-in-context", "b11-context-builder"]),
 ("atlasz-control-center/memory-panel.mjs", "tár-szintű vezérlők", "Egységes memória-vezérlés", ["b60-unified-memory-controls"]),
 ("atlasz-control-center/public/app.js", "Aurora/chat/hang szabályos út", "Egységes Brain UI", ["b103-brain-ui", "b24-chat-aurora-unify"]),
]
INTEG = [dict(consumer_id=resolve(n), consumer=n, current_relation_to_brain=cur, target_relation=tgt, work_ids=semi(TASK[s]["id"] for s in ws)) for n, cur, tgt, ws in CONSUMERS]

# ---------------------------------------------------------------- validation
V = {"generated_at": TODAY, "git_head": HEAD, "checks": [], "errors": 0}
def chk(n, ok, d=""):
    V["checks"].append({"check": n, "ok": bool(ok), "detail": d})
    if not ok: V["errors"] += 1
newkeys = [k for k in LED["entries"] if k.startswith(("pln:brain:", "wrk:brain:", "dec:brain:"))]   # all Brain-program ids (idempotent across re-runs)
_prev = json.loads(sh("git", "show", "HEAD:docs/identity_registry/id_ledger.json"))["entries"]
chk("A korábbi (git HEAD) ledger minden bejegyzésének azonosítója és kulcsa változatlan", all(k in LED["entries"] and LED["entries"][k]["id"] == e["id"] for k, e in _prev.items()), "%d meglévő bejegyzés" % len(_prev))
newids = [LED["entries"][k]["id"] for k in newkeys]
chk("Az új azonosítók egyediek és nem ütköznek a leltárral/ledgerrel", len(newids) == len(set(newids)) and not set(newids) & (set(inv) | set(wp) | set(pln_old) | set(dec_old)) and len({e["id"] for e in LED["entries"].values()}) == len(LED["entries"]), "%d új azonosító" % len(newids))
chk("A leltár 1 047 elemes és érintetlen (950 meglévő + 97 tervezett)", N_INV == 1047 and N_PLN == 97 and N_WRK == 784, "inv=%d pln=%d wrk=%d" % (N_INV, N_PLN, N_WRK))
chk("Minden munkafeladatnak van meglévő ATL-komponens-kapcsolata és tervezett modulja", all(t["comp_ids"] and t["pln_id"] for t in TASK.values()), "")
g = {t["id"]: [d for d in t["dep_ids"] if d in {x["id"] for x in TASK.values()}] for t in TASK.values()}
st = {}; cyc = []
def vis(n, p):
    st[n] = 1
    for m in g.get(n, []):
        if st.get(m) == 1: cyc.append(p + [n, m])
        elif m not in st: vis(m, p + [n])
    st[n] = 2
for n in g:
    if n not in st: vis(n, [])
chk("A függőségek körmentesek és létező azonosítókra mutatnak", not cyc, str(cyc[:2]))
chk("Mind a 10 képességhez tartozik munkafeladat", all(any(n in t["caps"] for t in TASK.values()) for n in D.CAPS), "")
chk("Minden munkafeladatnak van elfogadási kritériuma és legalább egy tesztje", all(t["accept"] and t["tests"] for t in TASK.values()), "")
chk("Minden feladat a 'fejlesztés-indítás ATL-számonként' jóváhagyás mögött áll", all(DEC["impl-per-atl"]["id"] in t["gate_ids"] for t in TASK.values()), "")
chk("Minden ÉLŐ szintű teszt mögött a megfelelő tulajdonosi kapu áll (modell/költség/hang/autonómia/kiadás)", all(len(t["gates"]) > 1 for t in TASK.values() if any("ÉLŐ" in x[2] for x in t["tests"])), "")
liveish = [t["slug"] for t in TASK.values() if re.search(r"élő|ELSŐ élő", t["title"], re.I) and len(t["gates"]) < 3]
chk("Az élő modell-bekötés feladatai legalább 3 kaput igényelnek (kulcs, egress, költség/engedély)", not [t for t in TASK.values() if t["slug"] in ("b41-first-live-connection",) and len(t["gates"]) < 5], "")
chk("Nincs fizetős/élő/külső művelet kapu nélkül (ext kitöltött → van nem-impl kapu)", all(len(t["gates"]) > 1 for t in TASK.values() if t["ext"]), "")
chk("Minden tervezett modul ('PLANNED*') nem létezőként van jelölve, és van legalább egy feladata", all(p["tasks"] and p["status"].startswith("PLANNED") for p in PLN.values()), "")
chk("Minden integrációs fogyasztónak van munkafeladata", all(r["work_ids"] for r in INTEG), "")
chk("A hivatkozott meglévő tervezett modulok léteznek (adopts/also_pln)", all(a in pln_old for t in TASK.values() for a in t["also_pln"]) , "")
changed = [l[3:] for l in sh("git", "status", "--porcelain").split("\n") if l.strip()]
chk("Csak docs/ alatti fájl változott (futó kód nem módosult)", all(p.startswith("docs/") for p in changed), str([p for p in changed if not p.startswith("docs/")][:5]))

# ---------------------------------------------------------------- write ledger / history
LED["updated"] = TODAY
json.dump(LED, open(os.path.join(V1, "id_ledger.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(os.path.join(V1, "id_ledger.csv"), "w", encoding="utf-8-sig", newline="") as f:
    cw = csv.writer(f); cw.writerow(["id", "category", "natural_key", "name", "status", "first_seen", "first_seen_commit"])
    for k, e in LED["entries"].items(): cw.writerow([e["id"], e["category"], k, e["name"], e["status"], e["first_seen"], e["first_seen_commit"]])
hp = os.path.join(V1, "history.jsonl"); seen = set(open(hp, encoding="utf-8").read().splitlines())
with open(hp, "a", encoding="utf-8") as f:
    for h in HIST:
        line = json.dumps(h, ensure_ascii=False)
        if line not in seen: f.write(line + "\n")
def wcsv(name, rows):
    with open(os.path.join(OUT, name), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
wcsv("brain_capabilities.csv", CAPROWS); wcsv("brain_modules_assessment.csv", ASSESS); wcsv("brain_new_modules.csv", PLN_ROWS); wcsv("brain_work_plan.csv", WORK_ROWS)
wcsv("brain_approval_gates.csv", DEC_ROWS); wcsv("brain_test_plan.csv", TEST_ROWS); wcsv("brain_integration_map.csv", INTEG)
json.dump(V, open(os.path.join(OUT, "validation_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# sqlite
dbp = os.path.join(OUT, "brain_program.sqlite")
if os.path.exists(dbp): os.remove(dbp)
con = sqlite3.connect(dbp)
for name, rows in (("capabilities", CAPROWS), ("modules_assessment", ASSESS), ("new_modules", PLN_ROWS), ("work_plan", WORK_ROWS), ("approval_gates", DEC_ROWS), ("test_plan", TEST_ROWS), ("integration_map", INTEG)):
    cols = list(rows[0].keys()); con.execute("CREATE TABLE %s (%s)" % (name, ",".join('"%s" TEXT' % c for c in cols)))
    con.executemany("INSERT INTO %s VALUES (%s)" % (name, ",".join("?" * len(cols))), [[str(r[c]) for c in cols] for r in rows])
con.execute("CREATE TABLE links (from_id TEXT, to_id TEXT, relation TEXT)")
L = []
for t in ORDER:
    for c in t["comp_ids"]: L.append((t["id"], c, "WORK_ON_EXISTING"))
    L.append((t["id"], t["pln_id"], "BUILDS_PLANNED"))
    for a in t["also_pln"]: L.append((t["id"], a, "ALSO_PLANNED"))
    for d in t["dep_ids"]: L.append((t["id"], d, "DEPENDS_ON"))
    for d in t["gate_ids"]: L.append((t["id"], d, "NEEDS_APPROVAL"))
    for e in t["existing_wrk"]: L.append((t["id"], e, "RELATED_EXISTING_WORK"))
con.executemany("INSERT INTO links VALUES (?,?,?)", L); con.commit(); con.close()
REP = dict(PLN=PLN, DEC=DEC, TASK=TASK, ORDER=ORDER, CAPROWS=CAPROWS, ASSESS=ASSESS, INTEG=INTEG, V=V, crit=crit, newids=newids, newkeys=newkeys, inv=inv, wp=wp, HEAD=HEAD, TODAY=TODAY, D=D, C=C, TEST_ROWS=TEST_ROWS)
exec(open(os.path.join(OUT, "render_brain_report.py"), encoding="utf-8").read())
print("tasks", len(TASK), "PLN", len(PLN), "DEC new", sum(1 for d in DEC.values() if not d.get("existing")), "new ids", len(newids), "errors", V["errors"], "critical path h", round(crit["cp_h"], 1))
for c in V["checks"]:
    if not c["ok"]: print("FAIL", c["check"], c["detail"])
