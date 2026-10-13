#!/usr/bin/env python3
"""ATLASZ AURÓRA V7.3 - consolidated system inventory v2 builder (RECORDS ONLY - never touches running-system code).

Inputs : docs/identity_registry (v1: 898 components, 1859 requirement rows, 258 source-set rows, ledger, history, 340-row work list),
         the per-item assessment of 12 476 owner-directive / V7.3 specification lines (docs/system_inventory/data/directive_assessment.json.gz).
Outputs: docs/system_inventory/*  (CSV, JSON, SQLite, Hungarian report, numbered work plan, validation report).
Rules  : v1 identifiers are NEVER renumbered; new identifiers come from the shared permanent ledger (docs/identity_registry/id_ledger.json);
         PLANNED modules are never presented as existing; hours are ESTIMATES; unknown stays UNKNOWN.
Run from the repository root:  python3 docs/system_inventory/build_system_inventory.py
"""
import csv, json, os, re, sys, gzip, hashlib, sqlite3, collections, subprocess, datetime, importlib.util

ROOT = os.getcwd()
V1 = os.path.join(ROOT, "docs/identity_registry")
OUT = os.path.join(ROOT, "docs/system_inventory")
DATA = os.path.join(OUT, "data")
TODAY = "2026-10-12"
UNK = "UNKNOWN"

def sh(*a):
    return subprocess.run(a, cwd=ROOT, capture_output=True, text=True).stdout
HEAD = sh("git", "rev-parse", "--short", "HEAD").strip()
def rcsv(p):
    with open(p, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))
def rd(p):
    try:
        with open(os.path.join(ROOT, p), encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""
def ids_in(s):
    return re.findall(r"ATL-[A-Z]+-\d{4}", s or "")
def semi(lst):
    return "; ".join(lst)

spec = importlib.util.spec_from_file_location("pln_catalog", os.path.join(OUT, "pln_catalog.py"))
CAT = importlib.util.module_from_spec(spec); spec.loader.exec_module(CAT)

# ------------------------------------------------------------------------------------------------ v1 load
comps = {r["id"]: r for r in rcsv(os.path.join(V1, "components.csv"))}
V1_IDS = set(comps)
reqs = rcsv(os.path.join(V1, "requirements.csv"))
srcsets = rcsv(os.path.join(V1, "source_sets_85_23_150.csv"))
links = rcsv(os.path.join(V1, "requirement_component_links.csv"))
v1_work = rcsv(os.path.join(V1, "work_list.csv"))
LEDGER = json.load(open(os.path.join(V1, "id_ledger.json"), encoding="utf-8"))
V1_LEDGER_KEYS = set(LEDGER["entries"])
V1_LEDGER_COUNT = len(LEDGER["entries"])
HISTORY_NEW = []
CATS_V2 = {"DIR": "Tulajdonosi direktíva-sor (korábbi direktívák)", "SPC": "V7.3 mester-regiszter sor", "PLN": "TERVEZETT modul / bővítés (még NEM létező)",
           "WRK": "Munkaterv-feladat", "FND": "Megállapítás (ellentmondás / nem nyilvántartott elem)", "DEC": "Tulajdonosi döntés / jóváhagyás",
           "SRC": "Forrásdokumentum (direktíva / repó-dokumentum)", "CFG": "Konfiguráció / állapotfájl / CI / bizonyíték-adat"}

def alloc(cat, key, name):
    e = LEDGER["entries"].get(key)
    if e:
        if e.get("name") != name:
            HISTORY_NEW.append({"at": TODAY, "commit": HEAD, "id": e["id"], "event": "NAME_CHANGED", "key": key, "from": e.get("name"), "to": name})
            e["name"] = name
        if e["status"] == "RETIRED":
            e["status"] = "ACTIVE"; e.pop("retired_at", None)
            HISTORY_NEW.append({"at": TODAY, "commit": HEAD, "id": e["id"], "event": "REACTIVATED", "key": key})
        return e["id"]
    n = LEDGER["next"].get(cat, 1)
    i = "ATL-%s-%04d" % (cat, n)
    LEDGER["next"][cat] = n + 1
    LEDGER["entries"][key] = {"id": i, "category": cat, "name": name, "first_seen": TODAY, "first_seen_commit": HEAD, "status": "ACTIVE"}
    HISTORY_NEW.append({"at": TODAY, "commit": HEAD, "id": i, "event": "ALLOCATED", "key": key, "name": name})
    return i

# name resolution for catalogue `rel`
NAME2ID = collections.defaultdict(list)
for cid, r in comps.items():
    NAME2ID[r["name"]].append(cid)
UNRESOLVED_REL = set()
def resolve(name):
    if name in NAME2ID and len(NAME2ID[name]) == 1:
        return NAME2ID[name][0]
    cands = [c for n, v in NAME2ID.items() if n.endswith("/" + name) for c in v]
    if len(cands) == 1:
        return cands[0]
    cands = [c for n, v in NAME2ID.items() if n.startswith(name) for c in v]
    if len(cands) == 1:
        return cands[0]
    if name in NAME2ID:
        return NAME2ID[name][0]
    UNRESOLVED_REL.add(name)
    return None

# ------------------------------------------------------------------------------------------------ corrections to v1 (documented, history logged)
CORRECTIONS = []
HIST_SEEN = set()
for _l in open(os.path.join(V1, "history.jsonl"), encoding="utf-8"):
    try:
        _j = json.loads(_l); HIST_SEEN.add((_j.get("id"), _j.get("event"), _j.get("field"), _j.get("to")))
    except Exception:
        pass
def correct(cid, field, new, why):
    old = comps[cid].get(field, "")
    if old == new:
        return
    comps[cid][field] = new
    CORRECTIONS.append({"id": cid, "name": comps[cid]["name"], "field": field, "old": old, "new": new, "reason": why})
    if (cid, "CORRECTED", field, new) not in HIST_SEEN:
        HISTORY_NEW.append({"at": TODAY, "commit": HEAD, "id": cid, "event": "CORRECTED", "field": field, "from": old, "to": new, "reason": why})

LEGACY_NOTE = ("A régi competition-v1 futtatókörnyezet; tulajdonosi döntéssel KARANTÉNBA téve (atlasz-runtime/LEGACY_EXCLUDED.md, LEGACY_QUARANTINE.md; policy-guards teszt őrzi). "
               "Nem a kanonikus futtatókörnyezet (supervisor-safe.mjs); nem számít működő rendszerelemnek.")
for cid in ("ATL-OPS-0031", "ATL-OPS-0035", "ATL-OPS-0036"):
    correct(cid, "status", "LEGACY_QUARANTINED", "v1 hiba: a karanténba tett régi futtatókörnyezeti fájl rendes elemként volt besorolva")
    correct(cid, "integration_status", "KARANTÉN: nincs bekötve a kanonikus futtatókörnyezetbe (tulajdonosi döntés)", "legacy quarantine")
    correct(cid, "next_action", "Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén; a policy-guards teszt őrzi", "legacy quarantine")
D11_TXT = "D-11: SEARCH hn.algolia kérés nem az aláírt egress-policy-n megy"
if "D-11" in comps["ATL-OPS-0036"]["known_defects"]:
    correct("ATL-OPS-0036", "known_defects", "nincs ismert (karanténban lévő legacy fájl; a D-11 a kanonikus supervisor-safe.mjs-t érinti)", "D-11 téves fájl-hozzárendelés")
    for tgt in ("ATL-OPS-0034",):
        kd = comps[tgt]["known_defects"]
        if "D-11" not in kd:
            correct(tgt, "known_defects", (kd + "; " if kd and not kd.startswith("nincs") else "") + D11_TXT, "D-11 helyes fájl-hozzárendelés (kanonikus runtime)")
if comps["ATL-OPS-0034"]["status"] == "VERIFIED_WORKING":
    correct("ATL-OPS-0034", "status", "PARTIAL", "ismert hiba D-11")
LEGACY_COMPS = {"ATL-OPS-0031", "ATL-OPS-0035", "ATL-OPS-0036"}

# ------------------------------------------------------------------------------------------------ extra real components (not in v1)
for r in comps.values():
    r.setdefault("origin", "V1")
def addc(cat, key, name, kind, function, parent=None, files="", status=None, basis="", ext="", tests="", missing="", nextact="", requirement_ids=""):
    cid = alloc(cat, key, name)
    p = comps.get(parent) if parent else None
    r = {k: "" for k in next(iter(comps.values()))}
    r.update(id=cid, name=name, category=cat, kind=kind, function=function, code_files=files or (p["code_files"] if p else ""), related_component_ids=parent or "",
           status=status or (p["status"] if p else "NOT_YET_VERIFIED"), natural_key=key, origin="V2_REGISTERED", external_dependencies=ext, test_ids=tests or (p["test_ids"] if p else ""),
           integration_status=(p["integration_status"] if p else ""), last_checked=TODAY, missing_functions=missing, next_action=nextact, requirement_ids=requirement_ids,
           known_defects="nincs ismert (ebben az ellenőrzésben)", live_evidence="", version=HEAD)
    r["status_basis"] = basis or ("ÖRÖKÖLT a szülő-komponens státuszából (" + parent + ")" if parent else "NINCS KÜLÖN BIZONYÍTÉK: nyilvántartásba vétel")
    comps[cid] = r
    return cid

def find(path):
    for c, r in comps.items():
        if path in (r["code_files"] or "").split("; "):
            return c
for r in comps.values():
    r.setdefault("status_basis", "v1 ellenőrzés (kód + teszt + bekötés)")

# 15 managers
mc = rd("atlasz-addons/master-coordinator.mjs")
MANAGERS = re.search(r"MANAGER_IDS\s*=\s*Object\.freeze\(\[(.*?)\]\)", mc, re.S).group(1)
MANAGERS = re.findall(r'"([A-Z_]+)"', MANAGERS)
p_mc = find("atlasz-addons/master-coordinator.mjs")
for m in MANAGERS:
    addc("AGT", "mgr:" + m, "Menedzser: " + m, "MANAGER_ROLE", "Master Coordinator által kezelt menedzseri szerepkör (nem állandó ügynök; a 30 ügynök nem része)", parent=p_mc,
         files="atlasz-addons/master-coordinator.mjs")
# 12 security gates
sg = rd("atlasz-addons/security-gates.mjs")
GATES = re.findall(r'^//\s+(G\d\d)\s+(.+?)\s{2,}', sg, re.M)
p_sg = find("atlasz-addons/security-gates.mjs")
for gid, gname in GATES:
    addc("SEC", "gate:" + gid, "Biztonsági kapu %s: %s" % (gid, gname.strip()), "SECURITY_GATE", "Önálló biztonsági kapu-teszt a security-gates.mjs-ben (fixture szint, nem élő bizonyíték)", parent=p_sg, files="atlasz-addons/security-gates.mjs")
# executors
ae = rd("atlasz-addons/agent-executors.mjs")
EXE = re.search(r"BUILTIN_EXECUTORS\s*=\s*Object\.freeze\(\{(.*?)\}\)", ae, re.S).group(1)
EXE = [x.strip() for x in re.split(r",", EXE) if x.strip()]
p_ae = find("atlasz-addons/agent-executors.mjs")
for e in EXE:
    nm = e.split(":")[0].strip()
    addc("AGT", "exe:" + nm, "Beépített executor: " + nm, "AGENT_EXECUTOR", "Beépített, helyben futó (fixture/sablon) ügynök-executor", parent=p_ae, files="atlasz-addons/agent-executors.mjs")
# discovery sources
gd = rd("atlasz-addons/global-discovery.mjs")
p_gd = find("atlasz-addons/global-discovery.mjs")
for sid, nm, typ in re.findall(r'^\s+S\("([a-z0-9-]+)",\s*"([^"]+)",\s*"([A-Z_]+)"', gd, re.M):
    addc("RES", "disc:" + sid, "Felderítési forrás-leíró: %s (%s)" % (nm, typ), "DISCOVERY_SOURCE", "global-discovery SOURCE_CATALOGUE bejegyzés (leíró; élő olvasás nincs engedélyezve)", parent=p_gd,
         files="atlasz-addons/global-discovery.mjs", status="NOT_YET_VERIFIED" if sid != "hn-algolia" else "EXTERNAL_BLOCKER", ext="külső hálózat / forrás-engedély",
         basis="Leíró létezik; élő olvasás nem történt (nincs külső hálózat). Státusz NEM öröklött: a leíró szintű teszt a global-discovery tesztjeiben van.")
# vercel provider
mr = rd("atlasz-addons/model-registry.mjs")
if "vercel-ai-gateway" in mr:
    addc("MDL", "prov:vercel-ai-gateway", "AI-szolgáltató: vercel-ai-gateway (CLOUD, modell-router)", "MODEL_PROVIDER", "Vercel AI Gateway szolgáltató-leíró a model-registry-ben (nincs hitelesítő adat, nincs élő hívás)",
         parent=find("atlasz-addons/model-registry.mjs"), files="atlasz-addons/model-registry.mjs", status="EXTERNAL_BLOCKER", ext="API-kulcs, egress-policy, MODEL_ENABLE jóváhagyás",
         basis="A v1 13 szolgáltatót vett fel; a 14. (vercel-ai-gateway) kimaradt. Leíró megvan, élő bizonyíték nincs.")

# ------------------------------------------------------------------------------------------------ repository files not yet registered (docs -> SRC, rest -> CFG)
covered = set()
for r in comps.values():
    for f in re.split(r";\s*", r["code_files"] or ""):
        if f.strip():
            covered.add(f.strip())
tracked = [f for f in sh("git", "ls-files").split("\n") if f]
SRC_FILES = {}   # path -> id
CFG_FILES = {}
def classify_file(p):
    if p.startswith(("docs/", "atlasz-astra/")) or p in ("README.md", "AGENTS.md", "atlasz-addons/README.md", "atlasz-runtime/LEGACY_EXCLUDED.md"):
        return "SRC"
    return "CFG"
for p in tracked:
    if p in covered or p.startswith(("src/", "public/", "netlify/")):
        continue
    cat = classify_file(p)
    cid = alloc(cat, ("repo:" + p), p)
    (SRC_FILES if cat == "SRC" else CFG_FILES)[p] = cid

# ------------------------------------------------------------------------------------------------ directive assessment
with gzip.open(os.path.join(DATA, "directive_assessment.json.gz"), "rt", encoding="utf-8") as f:
    DA = json.load(f)
ITEMS = DA["items"]          # all_items rows (12 476)
ASSESS = {a["id"]: a for a in DA["assessments"]}  # 10 295
UP = DA["uploads"]           # code -> {file, md5, dups}

# SRC ids for uploads
UPLOAD_SRC = {}
for code, u in UP.items():
    UPLOAD_SRC[code] = alloc("SRC", "upload:" + code, "Tulajdonosi direktíva: " + u["file"])
V73_SRC = alloc("SRC", "registry:V73", "V7.3 mester-követelmény regiszter (docs/atlasz_v73_requirement_registry.csv)")

# ------------------------------------------------------------------------------------------------ PLN modules
PLN = {}      # slug -> record
KEYMAP = {}   # exact key -> slug
RX = []
def expand(k):
    m = re.match(r"^(.*-L)(\d+)\.\.(\d+)$", k)
    if m:
        return [m.group(1) + str(i) for i in range(int(m.group(2)), int(m.group(3)) + 1)]
    return [k]
for m in CAT.MODULES:
    pid = alloc("PLN", "pln:" + m["slug"], m["name"])
    rel = [x for x in (resolve(n) for n in m["rel"]) if x]
    rec = dict(m, id=pid, rel_ids=rel, matched_req=[], matched_dir=[], extends_status=[])
    PLN[m["slug"]] = rec
    for k in m["ids"]:
        for kk in expand(k):
            KEYMAP.setdefault(kk, m["slug"])
    if m["rx"]:
        RX.append((re.compile(m["rx"], re.I), m["slug"]))

# ------------------------------------------------------------------------------------------------ directive items -> records
def dkey(i):
    return i[4:] if i[:4] in ("DIR-", "SPC-") else i
DIRS = []
DIR_BY_LEG = {}
for it in sorted(ITEMS, key=lambda x: (x["set"], x["src"], x["line"], x["id"])):
    cat = "SPC" if it["set"] == "V73" else "DIR"
    leg = it["id"]
    did = alloc(cat, "dir:" + leg, leg)
    a = ASSESS.get(leg)
    mode = "ASSESSED"
    if not a:
        if it["assess"] == "DUP":
            a = ASSESS.get(it.get("dup_of"))
            mode = "DUPLICATE_OF"
        if not a:
            mode = "AUTO_" + ("HEADING" if it["assess"] == "AUTO_HEADING" else "SHORT")
            a = {"kind": "CONTEXT", "same_as": None, "same_conf": "", "components": [], "status": "N/A", "deferred": False, "needs_new_module": False, "planned_module_hint": "",
                 "evidence": "Cím/rövid sor, önálló követelmény-tartalom nélkül.", "missing": "", "fix": "", "external": "", "owner_decision": "", "notes": ""}
    code = it["src"]
    rec = dict(id=did, legacy_id=leg, set=it["set"], source_code=code, source_id=UPLOAD_SRC.get(code, V73_SRC), line=it["line"], section=it.get("section", ""), text=it["text"],
               kind=a["kind"], same_as=a.get("same_as") or "", components=[c for c in a.get("components", []) if c in comps], status=a["status"], deferred=bool(a.get("deferred")),
               needs_new_module=bool(a.get("needs_new_module")), hint=a.get("planned_module_hint", ""), evidence=a.get("evidence", ""), missing=a.get("missing", ""), fix=a.get("fix", ""),
               external=a.get("external", ""), owner_decision=a.get("owner_decision", ""), notes=a.get("notes", ""), mode=mode, dup_of=(DIR_BY_LEG.get(it.get("dup_of")) or {}).get("id", "") if mode == "DUPLICATE_OF" else "",
               pln_ids=[], wrk_ids=[], key=dkey(leg))
    if mode == "DUPLICATE_OF":
        rec["dup_of"] = it.get("dup_of")
    DIRS.append(rec)
    DIR_BY_LEG[leg] = rec
for r in DIRS:
    if r["mode"] == "DUPLICATE_OF" and r["dup_of"] in DIR_BY_LEG:
        r["dup_of"] = DIR_BY_LEG[r["dup_of"]]["id"]
# legacy quarantine fix in item components
for r in DIRS:
    if any(c in LEGACY_COMPS for c in r["components"]):
        r["notes"] = (r["notes"] + "; " if r["notes"] else "") + "LEGACY_QUARANTINED komponensre hivatkozik (v1 hiba javítva)"

# ------------------------------------------------------------------------------------------------ requirement rows
REQ = {r["atl_id"]: r for r in reqs}
SRCSET = {r["atl_id"]: r for r in srcsets}
REQ_LINKS = collections.defaultdict(list)
for l in links:
    REQ_LINKS[l["requirement_id"]].append((l["component_id"], l["relation"]))

NONVER = {"PARTIAL", "MISSING", "STRUCTURAL_ONLY", "MOCK_ONLY", "CONNECTED_UNTESTED", "BROKEN", "EXTERNAL_BLOCKER", "OWNER_APPROVAL_REQUIRED", "NOT_YET_VERIFIED"}

# assign PLN to requirement rows / directive items
UNMATCHED = []
def item_pool(status, kind, needs):
    return kind in ("REQUIREMENT", "RULE", "DEFERRED_IDEA") and (status == "MISSING" or needs)
for atl, r in REQ.items():
    r["pln"] = None
    if atl in KEYMAP:
        r["pln"] = KEYMAP[atl]
for d in DIRS:
    d["pln"] = None
    if d["mode"] == "AUTO_HEADING" or d["mode"] == "AUTO_SHORT":
        continue
    if d["key"] in KEYMAP and d["kind"] in ("REQUIREMENT", "RULE", "DEFERRED_IDEA"):
        if d["status"] != "VERIFIED_WORKING":
            d["pln"] = KEYMAP[d["key"]]
    if not d["pln"] and item_pool(d["status"], d["kind"], d["needs_new_module"]) and not d["same_as"]:
        t = d["text"] + " " + d["hint"]
        for rx, slug in RX:
            if rx.search(t):
                d["pln"] = slug
                break
    if d["deferred"] and not d["pln"]:
        t = d["text"] + " " + d["hint"] + " " + d["section"]
        for rx, slug in RX:
            if PLN[slug]["kind"] == "DEFERRED" and rx.search(t):
                d["pln"] = slug
                break
    # directive items that duplicate an ATL-REQ inherit its PLN
    if not d["pln"] and d["same_as"] in REQ and REQ[d["same_as"]].get("pln"):
        d["pln"] = REQ[d["same_as"]]["pln"]

# regex fallback for requirement rows that are MISSING
for atl, r in REQ.items():
    if not r["pln"] and r["status"] == "MISSING" and r["kind"] == "REQUIREMENT":
        t = r["source_text"] + " " + r["fix"]
        for rx, slug in RX:
            if rx.search(t):
                r["pln"] = slug
                break
# unmatched pool
for atl, r in REQ.items():
    if not r["pln"] and r["status"] == "MISSING" and r["kind"] == "REQUIREMENT":
        UNMATCHED.append(("REQ", atl, r["source_text"][:90], r["fix"][:60]))
for d in DIRS:
    if not d["pln"] and item_pool(d["status"], d["kind"], d["needs_new_module"]) and not d["same_as"] and d["mode"] == "ASSESSED":
        UNMATCHED.append(("DIR", d["legacy_id"], d["text"][:90], d["hint"][:50] or d["fix"][:50]))

_dkeys = {d["key"] for d in DIRS}
EXPLICIT_UNUSED = [kk for m in CAT.MODULES for k in m["ids"] for kk in expand(k) if kk not in REQ and kk not in _dkeys]

if "--show-unmatched" in sys.argv:
    for u in UNMATCHED:
        print(u)
    print("unmatched", len(UNMATCHED), "unresolved_rel", sorted(UNRESOLVED_REL), "explicit_unused", EXPLICIT_UNUSED[:50], len(EXPLICIT_UNUSED))
    sys.exit(0)

exec(open(os.path.join(OUT, "build_part2.py"), encoding="utf-8").read())
