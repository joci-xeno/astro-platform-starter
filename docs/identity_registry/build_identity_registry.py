#!/usr/bin/env python3
"""ATLASZ AURÓRA V7.3 - central permanent identifier registry builder (RECORDS ONLY).

Reads the repository and the 2026-10-12 verification records, allocates permanent ATL-<CAT>-<NNNN> identifiers,
links requirements to components and writes JSON + SQLite + CSV + history. It NEVER modifies running-system code.

Permanence rules (enforced here):
  * An identifier is allocated once per natural key and kept in id_ledger.json. Re-running never changes it.
  * A natural key that disappears is marked RETIRED; its identifier is never given to anything else.
  * history.jsonl is append-only (one record per allocation / retirement / status change).
Unknown data is written as UNKNOWN (ismeretlen) - never invented.
Run from the repository root:  python3 docs/identity_registry/build_identity_registry.py
"""
import csv, json, os, re, sqlite3, subprocess, sys, datetime, collections

ROOT = os.getcwd()
OUT = os.path.join(ROOT, "docs/identity_registry")
VER = os.path.join(ROOT, "docs/audit/full_verification_2026-10-12")
AUD = os.path.join(ROOT, "docs/audit")
TODAY = "2026-10-12"
UNK = "UNKNOWN"

def sh(*a):
    return subprocess.run(a, cwd=ROOT, capture_output=True, text=True).stdout
def jl(p):
    with open(os.path.join(ROOT, p), encoding="utf-8-sig") as f:
        return json.load(f)
def rd(p):
    try:
        with open(os.path.join(ROOT, p), encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""

HEAD = sh("git", "rev-parse", "--short", "HEAD").strip()

CATS = {
 "BRN": "MASTER BRAIN / tervezés / koordináció", "AUR": "AURÓRA / személyiség / Human Core", "AGT": "Ügynökök (30 állandó + ügynök-réteg)",
 "MDL": "AI-modellek, adapterek, modellválasztás", "MEM": "Memória, tanulás, RAG, visszakeresés", "VOI": "Beszéd és hang",
 "AVA": "Avatár, vizuális és multimodális", "INT": "Külső integráció / connector / bővítmény-kapcsolat", "API": "API-végpont és szerver",
 "SEC": "Biztonság, tulajdonosi vezérlés, vault", "FIN": "Pénzügy, főkönyv, adó, számlázás", "WFL": "Üzleti munkafolyamat, kapuk, szakaszok",
 "RES": "Piackutatás, felderítés, elemzés", "DOC": "Dokumentum, fájl, kommunikáció", "OPS": "Működtetés, helyreállítás, megfigyelés, frissítés",
 "SCH": "Ütemező, háttérfolyamat, watchdog", "PLG": "Plugin, skill, eszköznyilvántartás", "DEV": "Fejlesztő-asszisztens",
 "LRN": "Személyes tanulás és produktivitás", "MOB": "Mobil és távoli vezérlés", "WIN": "Windows desktop / telepítő", "UIX": "Felület (panel, nézet)",
 "TST": "Teszt", "CHK": "Ellenőrző eszköz / generátor / segédszkript", "TPL": "Nem ATLASZ sablon (Astro/Netlify starter)",
 "REQ": "Követelmény (23 fejezet A/B sor)", "CAP": "Eredeti 85 képesség", "SIR": "23 biztonsági és infrastruktúra-követelmény", "FUT": "150 jövőbeli fejlesztési tétel",
}

# ---------------------------------------------------------------- category assignment for atlasz-addons files
ADDON_CAT = """
BRN: brain/central-brain brain/orchestrator brain/planning-brain brain/governance brain/governed-dispatch brain/owner-command brain/opportunity-intelligence brain/business-factory brain/brain-system brain/capability-graph brain/model-intelligence brain/simulation-lab brain/verifier brain/search-pipeline brain/evidence-sources brain-master-bridge master-brief master-coordinator master-planner-orchestrator module-broker campaign-manager goal-planner debate-protocol decision-analysis multi-solution reasoning-common stall-replanner task-ledger outcome-compiler progress-ledger general-intelligence-extensions internal-integration-hub shared-project-registry digital-twin
AUR: aurora human-core assistant-profiles preferences personal-command-center
AGT: agent-activity agent-coordination agent-executors agent-factory agent-memory agent-portfolio-manager agent-registry agent-status agent-tool-broker agent-workforce execution-factory handoff-ledger team-lead-workflows capability-registry qa-reviewer
MDL: model-evidence model-evolution model-gateway model-registry model-routing-bridge multi-model-brain provider-adapters provider-egress provider-resilience cost-model-router local-ai-manager effort-allocation context-manager conversation
MEM: memory-store business-memory project-memory observation-memory knowledge-projects enterprise-knowledge-agentic-rag retrieval-eval semantic-index embedding-provider notes-organizer chunker experience-learning-engine brain/memory-fabric brain/knowledge-brain unified-entity-graph
VOI: voice-conversation voice-interface voice-session
AVA: render modality-fabric detail-level a11y-audit a11y-worker
INT: connector-catalog universal-connector-layer tool-bridge mcp-client chat-providers source-adapters browser-extension-guard computer-use-fabric page-ingest payment-package-intake
SEC: enterprise-control-plane owner-auth owner-keystore secret-vault secret-patterns history-scan-patterns safe-keys credential-broker guardrail-engine approval-command-gateway approval-requests audit-chain anti-collusion-guard emergency-stop execution-boundary process-gate restricted-node code-sandbox malware-scanner quarantine file-intake incident-response security-gates network-supervisor egress-policy tenant-isolation release-signing evidence-record probe-evidence agent-tool-policy agent-tool-policy-ext brain/security-brain brain/behavior-monitor owner-control/agent-governor owner-control/approval-gateway owner-control/claim-distinctions owner-control/control-chain owner-control/owner-authority owner-control/owner-control-system
FIN: financial-ledger financial-guard fx-rates cost-completeness daily-profit-objective profit-accounting-engine profit-ledger revenue-analytics revenue-persistence payment-confirmation-adapter payment-webhook-receiver invoice-engine tax-accounting-engine money-pipeline-controller money-supervisor budget-consumption-governor business/finance-intelligence business/invoice-preparation business/invoice-service business/payment-events business/payment-verification business/recurring-billing business/money-engine owner-control/financial-firewall owner-control/money-state-guard
WFL: client-dna-engine workflow-stages workflow-engine deal-state delivery-engine proposal-stage proposal-quote-engine negotiation-engine follow-up-engine contract-analysis business/artifact-registry business/communication-center business/contract-review business/crm business/deal-pipeline business/delivery-service business/entity-graph business/inbox-pipeline business/job-system business/judge business/package-delivery-adapter business/qa-factory business/store
RES: global-discovery global-business-intelligence live-discovery-runner source-allowlist market-data market-intelligence-engine org-intelligence eligibility-model research-ledger text-compare orb-strategy paper-trader backtest analyst tech-watch opportunity-intake opportunity-qualification-engine lead-qualifier buyer-decision-maker-finder
DOC: document-center doc-extractors doc-sync form-assistant social-drafts transcript-actions translation-feedback universal-inbox
OPS: completion-registry backup-recovery portable-backup recovery safe-mode startup-self-check self-healing-loop update-center local-update-adapters durable-queue durable-dead-letters dead-letter-queue file-lock priority-queue-rate-limit-governor checkpoint-engine tracing-evals regression-eval-suite brain/brain-health brain/black-box brain/disaster-recovery observability-black-box event-bus event-stream migration-planner data-quality owner-control/recovery-points owner-control/recovery-source-map owner-control/safe-mode-scope owner-control/system-doctor
SCH: scheduler tick-loop watchdog health-monitor
PLG: plugin-installer plugin-manager skill-factory skill-registry typed-tools tool-fabric executor-toolbox-registry workbench
DEV: code-edit-workflow code-review repo-analyzer prototype-builder test-intelligence architecture-assessor alt-solution-harness dev-assist-common
LRN: tutor spaced-repetition suggestions
MOB: mobile-api
"""
ADDON = {}
for line in ADDON_CAT.strip().splitlines():
    c, names = line.split(":", 1)
    for n in names.split():
        ADDON[n] = c

def category_for(path):
    if path.startswith("atlasz-addons/registrations/"):
        return "BRN"  # module-broker registration wiring
    if path.startswith("atlasz-addons/"):
        key = path[len("atlasz-addons/"):]
        key = key[:-4] if key.endswith(".mjs") else key
        return ADDON.get(key)
    if path.startswith("atlasz-control-center/electron/") or path.endswith("stage-win.mjs") or path.startswith("launcher/"):
        return "WIN"
    if path in ("atlasz-control-center/server.mjs", "atlasz-control-center/core.mjs"):
        return "API"
    if path.startswith("atlasz-control-center/"):
        return "UIX"
    if path.startswith("atlasz-runtime/"):
        return "OPS"
    if path.startswith("browser-extension/"):
        return "INT"
    if path.startswith("atlasz-tests/") and path.endswith(".test.mjs"):
        return "TST"
    if path.startswith(("atlasz-tests/", "scripts/")) or (path.startswith("docs/") and path.endswith((".py", ".mjs"))):
        return "CHK"
    return None

# ---------------------------------------------------------------- source file enumeration
tracked = sh("git", "ls-files").splitlines()
CODE_EXT = (".mjs", ".js", ".html", ".css", ".cmd")
files = []
for p in tracked:
    if p.startswith(("src/", "public/", "netlify/")) or p in ("astro.config.mjs", "tsconfig.json"):
        continue
    if p.startswith("docs/identity_registry/"):
        continue
    if not p.endswith(CODE_EXT) and not p.endswith("Dockerfile.worker"):
        continue
    if "/data/" in p or "/fixtures/" in p or p.startswith("atlasz-runtime/data/"):
        continue
    if p.endswith("package.json") or p.endswith("manifest.json"):
        continue
    if p.startswith("atlasz-tests/") and not p.endswith(".mjs"):
        continue
    files.append(p)
files = sorted(files)
unmapped = [p for p in files if category_for(p) is None]
if unmapped:
    sys.exit("UNMAPPED FILES (add to ADDON_CAT): " + ", ".join(unmapped))
TPL_FILES = sorted(p for p in tracked if p.startswith(("src/", "public/", "netlify/")) or p in ("astro.config.mjs", "tsconfig.json"))

# ---------------------------------------------------------------- facts: lines, last commit, header, version, imports
last_commit = {}
cur = None
for ln in sh("git", "log", "--name-only", "--format=@@%h|%cs").splitlines():
    if ln.startswith("@@"):
        cur = ln[2:]
    elif ln.strip() and ln not in last_commit:
        last_commit[ln] = cur

def header_of(text):
    for ln in text.splitlines()[:6]:
        s = ln.strip()
        if s.startswith("//"):
            return s.lstrip("/ ").strip()[:240]
        if s.startswith("/**") or s.startswith("*"):
            return s.strip("/* ").strip()[:240]
        if s.startswith("<!--"):
            return s.strip("<!- >")[:240]
        if s and not s.startswith(("import", "export", "const", "let", "var", "#", "@", "<", "'use")):
            break
    return UNK

IMPORT_RE = re.compile(r"""(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']""")
def resolve(src, spec):
    if not spec.startswith("."):
        return None
    base = os.path.normpath(os.path.join(os.path.dirname(src), spec))
    for cand in (base, base + ".mjs", base + ".js"):
        if cand in fileset:
            return cand
    return None

fileset = set(files)
FACT = {}
for p in files:
    t = rd(p)
    ver = re.search(r"""export const [A-Z_]*VERSION\s*=\s*["']([^"']+)""", t)
    FACT[p] = {
        "lines": t.count("\n") + (1 if t and not t.endswith("\n") else 0),
        "exports": len(re.findall(r"^export\s", t, re.M)),
        "header": header_of(t),
        "version": ver.group(1) if ver else UNK,
        "imports": sorted({r for r in (resolve(p, s) for s in IMPORT_RE.findall(t)) if r}),
        "hosts": sorted(set(re.findall(r"https?://([a-zA-Z0-9.-]+\.[a-z]{2,})", t)))[:8],
        "commit": last_commit.get(p, UNK),
    }

# static reachability from the running entry points
def reach(entries):
    seen, q = set(), [e for e in entries if e in fileset]
    while q:
        x = q.pop()
        if x in seen:
            continue
        seen.add(x)
        q.extend(i for i in FACT[x]["imports"] if i not in seen)
    return seen
REACH_CC = reach(["atlasz-control-center/server.mjs"])
REACH_RT = reach(["atlasz-runtime/supervisor-safe.mjs", "atlasz-runtime/worker.js", "atlasz-runtime/agent-child.js"])
REACH_WIN = reach(["atlasz-control-center/electron/main.mjs"])

# ---------------------------------------------------------------- evidence inputs
gate = jl("docs/audit/full_verification_2026-10-12/gate_results.json")
matrix = {r["file"]: r for r in jl("docs/audit/integration_matrix_2026-10-11.json")["rows"]}
reqs = jl("docs/audit/full_verification_2026-10-12/requirement_verification_registry.json")
srcs = jl("docs/audit/full_verification_2026-10-12/out_sources_85_23_150.json")
routecov = jl("docs/audit/route_test_coverage.json")
ui = jl("docs/audit/full_verification_2026-10-12/uismoke_report.json")
agentev = jl("docs/audit/agent_evidence_2026-10-11.json")
dispos = {m["source"]: m for m in jl("docs/audit/module_dispositions.json")["modules"]}

# tests -> modules (direct references only)
test_refs = {}
for p in files:
    if category_for(p) != "TST":
        continue
    t = rd(p)
    refs = set()
    for spec in IMPORT_RE.findall(t):
        r = resolve(p, spec)
        if r:
            refs.add(r)
    for m in re.findall(r"""["'`](?:\.\./)*((?:atlasz-addons|atlasz-control-center|atlasz-runtime|browser-extension)/[A-Za-z0-9_./-]+\.(?:mjs|js))""", t):
        if m in fileset:
            refs.add(m)
    test_refs[p] = sorted(r for r in refs if category_for(r) != "TST")
mod_tests = collections.defaultdict(list)
for t, rs in test_refs.items():
    for r in rs:
        mod_tests[r].append(t)

importers = collections.defaultdict(set)
for p_, f_ in FACT.items():
    for i_ in f_["imports"]:
        importers[i_].add(p_)

# ---------------------------------------------------------------- permanent ledger
LEDGER_P = os.path.join(OUT, "id_ledger.json")
if os.path.exists(LEDGER_P):
    LEDGER = json.load(open(LEDGER_P, encoding="utf-8"))
else:
    LEDGER = {"version": 1, "created": TODAY, "rule": "An id is never reassigned or reused; retired keys keep their id.", "next": {}, "entries": {}}
HIST_P = os.path.join(OUT, "history.jsonl")
HISTORY_NEW = []
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

# ---------------------------------------------------------------- components
COMPONENTS = {}   # id -> dict
KEY2ID = {}
FILE2ID = {}
def add(cat, key, name, **kw):
    cid = alloc(cat, key, name)
    c = {"id": cid, "category": cat, "category_name": CATS[cat], "name": name, "natural_key": key}
    c.update(kw)
    COMPONENTS[cid] = c
    KEY2ID[key] = cid
    return cid

# 30 agents first so they get 0001..0030
for i in range(1, 6):
    add("AGT", "agent:SEARCH-%d" % i, "SEARCH-%d" % i, kind="PERMANENT_AGENT", legacy=["SEARCH-%d" % i])
for i in range(1, 26):
    add("AGT", "agent:EXECUTION-%d" % i, "EXECUTION-%d" % i, kind="PERMANENT_AGENT", legacy=["EXECUTION-%d" % i])

for p in files:
    cat = category_for(p)
    if p.startswith("atlasz-addons/"):
        name = p[len("atlasz-addons/"):].rsplit(".", 1)[0]
    elif cat == "TST":
        name = os.path.basename(p)[:-len(".mjs")]
    else:
        name = p
    cid = add(cat, "file:" + p, name, kind="SOURCE_FILE", code_files=[p])
    FILE2ID[p] = cid

add("TPL", "tpl:astro-netlify-starter", "Astro/Netlify starter sablon (nem ATLASZ)", kind="TEMPLATE", code_files=TPL_FILES)

# API endpoints (parse the GET/POST maps of the Control Center server)
srv = rd("atlasz-control-center/server.mjs").splitlines()
sect = None
endpoints = []
for ln in srv:
    if re.match(r"\s*const get = \{", ln): sect = "GET"
    elif re.match(r"\s*const post = \{", ln): sect = "POST"
    elif re.match(r"\s*const live = \{", ln): sect = None
    if sect:
        for m in re.finditer(r"\"(/api/[A-Za-z0-9_/.:-]+)\"\s*:", ln):
            endpoints.append((sect, m.group(1)))
        if ln.strip().endswith("};") and sect and "const" not in ln:
            pass
seen = set(); endpoints = [e for e in endpoints if not (e in seen or seen.add(e))]
add_ep = {}
for meth, path in endpoints:
    add_ep[(meth, path)] = add("API", "api:%s %s" % (meth, path), "%s %s" % (meth, path), kind="HTTP_ENDPOINT",
                               code_files=["atlasz-control-center/server.mjs", "atlasz-control-center/core.mjs"], route=path, method=meth)
for extra in ("/api/live", "/api/health"):
    if extra in "\n".join(srv):
        add("API", "api:GET " + extra, "GET " + extra, kind="HTTP_ENDPOINT", code_files=["atlasz-control-center/server.mjs"], route=extra, method="GET")

# UI views
for v in ui["views"]:
    add("UIX", "view:" + v["view"], "Nézet: %s (%s)" % (v["title"], v["view"]), kind="UI_VIEW", code_files=["atlasz-control-center/public/app.js", "atlasz-control-center/public/index.html"],
        view=v["view"], routes=v["route"], loads=v["loads"], console_errors=v["consoleErrors"][:3], http_errors=v["httpErrors"][:3])

# 14 workflow stages
STAGE_NAMES = re.findall(r"^\s{2}([A-Z_]+):\s*\{", rd("atlasz-addons/workflow-stages.mjs"), re.M)
for i, s in enumerate(STAGE_NAMES, 1):
    add("WFL", "stage:" + s, "Üzleti szakasz %d: %s" % (i, s), kind="WORKFLOW_STAGE", code_files=["atlasz-addons/workflow-stages.mjs"], stage_no=i, stage=s)

# external integrations
CONNECTORS = re.findall(r"^\s{2}([a-z]+):\s*\{ name: \"([^\"]+)\", base: \"([^\"]+)\"", rd("atlasz-addons/connector-catalog.mjs"), re.M)
for cid_, nm, base in CONNECTORS:
    add("INT", "int:connector:" + cid_, "Connector: %s" % nm, kind="EXTERNAL_SERVICE", code_files=["atlasz-addons/connector-catalog.mjs"], legacy=[cid_], host=base)
add("INT", "int:stripe", "Stripe (fizetési processzor, receive-only webhook)", kind="EXTERNAL_SERVICE", code_files=["atlasz-addons/business/payment-events.mjs", "atlasz-addons/payment-webhook-receiver.mjs", "atlasz-addons/payment-package-intake.mjs"], legacy=["stripe"], host="api.stripe.com")
add("INT", "int:koho", "KOHO (banki egyeztetés, csak kézi/csomag-átvétel)", kind="EXTERNAL_SERVICE", code_files=["atlasz-addons/payment-package-intake.mjs"], legacy=["koho"], host=UNK)
add("INT", "int:search-hn-algolia", "SEARCH forrás: hn.algolia.com (runtime kérés)", kind="EXTERNAL_SERVICE", code_files=["atlasz-runtime/worker.js", "atlasz-runtime/agent-child.js", "atlasz-runtime/supervisor-safe.mjs"], legacy=["hn-algolia"], host="hn.algolia.com")
add("INT", "int:mcp-stdio", "MCP stdio szerverek (külső folyamat)", kind="EXTERNAL_SERVICE", code_files=["atlasz-addons/mcp-client.mjs"], legacy=["mcp"], host="stdio")
CHATS = re.findall(r"^\s*P\(\"([a-z0-9-]+)\",\s*\"([^\"]+)\"", rd("atlasz-addons/chat-providers.mjs"), re.M)
for cid_, nm in CHATS:
    add("INT", "int:chat:" + cid_, "Chat platform: %s" % nm, kind="EXTERNAL_SERVICE", code_files=["atlasz-addons/chat-providers.mjs"], legacy=[cid_])

# AI model providers
PM = rd("docs/audit/provider_matrix.md")
for m in re.finditer(r"^\| ([a-z0-9-]+) \| (CLOUD|LOCAL) \| ([^|]+) \| ([^|]+) \|", PM, re.M):
    pid, kind, host, conn = m.group(1), m.group(2), m.group(3).strip(), m.group(4).strip()
    add("MDL", "mdl:provider:" + pid, "AI-szolgáltató: %s (%s)" % (pid, kind), kind="MODEL_PROVIDER", code_files=["atlasz-addons/provider-adapters.mjs", "atlasz-addons/model-registry.mjs", "atlasz-addons/model-gateway.mjs"], legacy=[pid], host=host, connector_status=conn)

# schedulers / background processes (named runtime behaviours)
SCH = [
 ("master-tick", "Master felügyeleti tick (tick-loop + watchdog)", ["atlasz-addons/tick-loop.mjs", "atlasz-addons/master-coordinator.mjs", "atlasz-control-center/core.mjs"]),
 ("durable-scheduler", "Tartós ütemező (C12)", ["atlasz-addons/scheduler.mjs"]),
 ("discovery-scheduler", "Napi felderítési ütemező (discoveryScheduler)", ["atlasz-addons/global-discovery.mjs", "atlasz-addons/live-discovery-runner.mjs"]),
 ("health-monitor", "Egészség-monitor, kör-megszakítók", ["atlasz-addons/health-monitor.mjs"]),
 ("watchdog", "Watchdog (szívverés / lefagyás-észlelés)", ["atlasz-addons/watchdog.mjs"]),
 ("runtime-supervisor", "Runtime supervisor (OS-folyamatok, SEARCH worker-ek)", ["atlasz-runtime/supervisor-safe.mjs", "atlasz-runtime/worker.js", "atlasz-runtime/agent-child.js"]),
 ("webhook-receiver", "Fizetési webhook vevő (nem auto-indul)", ["atlasz-addons/payment-webhook-receiver.mjs"]),
 ("safe-mode-crashloop", "Safe Mode + crash-loop védelem", ["atlasz-addons/safe-mode.mjs"]),
 ("startup-self-check", "Indítási önellenőrzés", ["atlasz-addons/startup-self-check.mjs"]),
 ("self-healing", "Korlátos önjavító hurok", ["atlasz-addons/self-healing-loop.mjs"]),
 ("backup-drill", "Mentés / visszaállítási próba", ["atlasz-addons/backup-recovery.mjs", "atlasz-addons/portable-backup.mjs"]),
 ("ransomware-canary", "Ransomware kanári-monitor", ["atlasz-addons/quarantine.mjs"]),
]
for k, n, cf in SCH:
    add("SCH", "sch:" + k, n, kind="BACKGROUND_PROCESS", code_files=cf)

# tests: already ATL-TST via files
# record documents referenced by requirement rows (registries, audit records) become CHK components
DOC_RE = re.compile(r"(docs/[A-Za-z0-9_./-]+\.(?:md|json|csv|txt|py|mjs)|atlasz-astra/[A-Za-z0-9_./-]+\.md|atlasz-[a-z-]+/package\.json|AGENTS\.md|README\.md)")
tracked_set = set(tracked)
refd = set()
for r in list(reqs) + list(srcs):
    fl = r.get("files") or []
    for x in ([fl] if isinstance(fl, str) else fl):
        for d in DOC_RE.findall(x):
            if d in tracked_set and d not in fileset and not d.startswith("docs/identity_registry/"):
                refd.add(d)
RECORD_DOCS = {}
for d in sorted(refd):
    cid = add("CHK", "doc:" + d, d, kind="RECORD_DOCUMENT", code_files=[d])
    RECORD_DOCS[d] = cid
# ---------------------------------------------------------------- requirement ids
def req_sort(r):
    return (r["chapter"], r["part"], r["source_line"])
REQ_ROWS = sorted(reqs, key=req_sort)
REQ_ID = {}
for r in REQ_ROWS:
    REQ_ID[r["id"]] = alloc("REQ", "req:" + r["id"], r["id"])
SRC_ID = {}
for r in srcs:
    pre = r["id"].split("-")[0]
    cat = {"CAP85": "CAP", "SEC23": "SIR", "IDEA150": "FUT"}[pre]
    SRC_ID[r["id"]] = alloc(cat, "src:" + r["id"], r["id"])

# ---------------------------------------------------------------- retire vanished keys
live_keys = set(KEY2ID) | {"req:" + r["id"] for r in reqs} | {"src:" + r["id"] for r in srcs}
V2_KEY_PREFIXES = ("mgr:", "gate:", "exe:", "disc:", "prov:", "repo:", "registry:", "upload:", "dir:", "pln:", "wrk:", "fnd:", "dec:")   # owned by docs/system_inventory (v2) - never retired here
for k, e in LEDGER["entries"].items():
    if k.startswith(V2_KEY_PREFIXES):
        continue
    if k not in live_keys and e["status"] == "ACTIVE":
        e["status"] = "RETIRED"; e["retired_at"] = TODAY
        HISTORY_NEW.append({"at": TODAY, "commit": HEAD, "id": e["id"], "event": "RETIRED", "key": k})

# ---------------------------------------------------------------- links: requirement <-> component
PATH_RE = re.compile(r"(atlasz-(?:addons|control-center|runtime|tests)/[A-Za-z0-9_./-]+\.(?:mjs|js|html|css)|browser-extension/[A-Za-z0-9_./-]+\.(?:js|html|css)|launcher/[A-Za-z0-9_.-]+|scripts/[A-Za-z0-9_.-]+\.mjs)")
ENDPOINT_RE = re.compile(r"/api/[A-Za-z0-9_/.-]+")
LINKS = []
req_comps = collections.defaultdict(set)
comp_reqs = collections.defaultdict(set)
def link(rid_atl, rid_leg, cid, how):
    if (rid_atl, cid) in LINK_SEEN:
        return
    LINK_SEEN.add((rid_atl, cid))
    LINKS.append({"requirement_id": rid_atl, "legacy_requirement_id": rid_leg, "component_id": cid, "relation": how})
    req_comps[rid_atl].add(cid); comp_reqs[cid].add(rid_atl)
LINK_SEEN = set()
for r in REQ_ROWS + srcs:
    rid_leg = r["id"]
    rid_atl = REQ_ID.get(rid_leg) or SRC_ID.get(rid_leg)
    flist = r.get("files") or []
    if isinstance(flist, str):
        flist = [flist]
    blob = " ".join(flist)
    for p in PATH_RE.findall(blob):
        if p in FILE2ID:
            link(rid_atl, rid_leg, FILE2ID[p], "IMPLEMENTED_BY_FILE")
    for d in DOC_RE.findall(blob):
        if d in RECORD_DOCS:
            link(rid_atl, rid_leg, RECORD_DOCS[d], "RECORDED_IN_DOCUMENT")
    for p in flist:  # short names like "browser-extension-guard", "atlasz-addons/foo" without ext
        q = p.strip().rstrip("/")
        for ext in ("", ".mjs", ".js"):
            if q + ext in FILE2ID:
                link(rid_atl, rid_leg, FILE2ID[q + ext], "IMPLEMENTED_BY_FILE")
        if q.endswith("/"):
            pass
        if q and not q.endswith((".mjs", ".js")) and "/" not in q and ("atlasz-addons/" + q + ".mjs") in FILE2ID:
            link(rid_atl, rid_leg, FILE2ID["atlasz-addons/" + q + ".mjs"], "IMPLEMENTED_BY_FILE")
    for ep in ENDPOINT_RE.findall(" ".join([blob, str(r.get("integration", "")), str(r.get("ui", ""))])):
        for meth in ("GET", "POST"):
            cid = KEY2ID.get("api:%s %s" % (meth, ep.rstrip(".,;)")))
            if cid:
                link(rid_atl, rid_leg, cid, "EXPOSED_BY_ENDPOINT")
    for t in (r.get("tests") or []):
        for p in re.findall(r"atlasz-tests/[A-Za-z0-9_.-]+\.test\.mjs", t):
            if p in FILE2ID:
                link(rid_atl, rid_leg, FILE2ID[p], "VERIFIED_BY_TEST")
        m = re.match(r"([A-Za-z0-9_.-]+\.test\.mjs)", t.strip())
        if m and "atlasz-tests/" + m.group(1) in FILE2ID:
            link(rid_atl, rid_leg, FILE2ID["atlasz-tests/" + m.group(1)], "VERIFIED_BY_TEST")

# every requirement implemented by the agent registry applies to each member of the fixed 30-agent roster
for l in list(LINKS):
    if l["component_id"] == FILE2ID["atlasz-addons/agent-registry.mjs"]:
        for a in range(1, 6):
            link(l["requirement_id"], l["legacy_requirement_id"], KEY2ID["agent:SEARCH-%d" % a], "ROSTER_MEMBER_VIA_REGISTRY")
        for a in range(1, 26):
            link(l["requirement_id"], l["legacy_requirement_id"], KEY2ID["agent:EXECUTION-%d" % a], "ROSTER_MEMBER_VIA_REGISTRY")
# agents / stages / providers / connectors linked via text of the requirement
def text_of(r):
    return " ".join(str(r.get(k, "")) for k in ("source_text", "heading", "evidence", "missing", "integration"))
for r in REQ_ROWS:
    rid_atl = REQ_ID[r["id"]]
    t = text_of(r)
    for i in re.findall(r"\b(SEARCH-[1-5]|EXECUTION-(?:[1-9]|1\d|2[0-5]))\b", t):
        link(rid_atl, r["id"], KEY2ID["agent:" + i], "MENTIONS_AGENT")
    for s in STAGE_NAMES:
        if re.search(r"\b" + s + r"\b", t) and s in ("NET_PROFIT", "PAYMENT_VERIFICATION", "RECONCILIATION", "OWNER_APPROVAL", "DELIVERY_APPROVAL", "QUALITY_ASSURANCE"):
            link(rid_atl, r["id"], KEY2ID["stage:" + s], "MENTIONS_STAGE")
    if re.search(r"\bStripe\b", t):
        link(rid_atl, r["id"], KEY2ID["int:stripe"], "MENTIONS_INTEGRATION")
    if re.search(r"\bKOHO\b", t):
        link(rid_atl, r["id"], KEY2ID["int:koho"], "MENTIONS_INTEGRATION")
    for cid_, nm, base in CONNECTORS:
        if re.search(r"\b" + re.escape(nm) + r"\b", t):
            link(rid_atl, r["id"], KEY2ID["int:connector:" + cid_], "MENTIONS_INTEGRATION")

# ---------------------------------------------------------------- known defects (this audit + register) -> components
DEFECTS = {
 "D-01": ("Security & Supervision nézet összeomlik (sv.notes objektum, .map hiba)", ["view:supervision", "file:atlasz-control-center/public/app.js"]),
 "D-02": ("/api/updates/install és /api/plugins/enable hibánál HTTP 200 ok:true; a UI 'done'-t mutat", ["api:POST /api/updates/install", "api:POST /api/plugins/enable", "file:atlasz-control-center/public/app.js"]),
 "D-03": ("durable-queue.ack nem ellenőrzi a bérlőt", ["file:atlasz-addons/durable-queue.mjs"]),
 "D-04": ("nincs állapotmappa-zár; két runtime ugyanazt a feladatot bérelheti", ["file:atlasz-addons/master-coordinator.mjs", "file:atlasz-addons/durable-queue.mjs", "file:atlasz-runtime/supervisor-safe.mjs"]),
 "D-05": ("~25 zár nélküli közös tár (utolsó író nyer)", ["file:atlasz-addons/business/store.mjs", "file:atlasz-addons/file-lock.mjs", "file:atlasz-addons/knowledge-projects.mjs", "file:atlasz-addons/personal-command-center.mjs", "file:atlasz-addons/observation-memory.mjs"]),
 "D-06": ("supervisor-safe.mjs fixen 0.0.0.0-n hallgat", ["file:atlasz-runtime/supervisor-safe.mjs"]),
 "D-07": ("Hang UI nyelvváltó csak a válasz nyelvét váltja; 'Jó reggelt' gomb néma", ["file:atlasz-control-center/public/app.js", "file:atlasz-addons/voice-conversation.mjs", "view:voice"]),
 "D-08": ("discoveryScheduler().tick() hívója nincs", ["sch:discovery-scheduler", "file:atlasz-addons/global-discovery.mjs"]),
 "D-09": ("két karantén-tár, release/delete route nélkül", ["file:atlasz-addons/quarantine.mjs", "file:atlasz-addons/file-intake.mjs"]),
 "D-10": ("m5-verification-round2 időzítésérzékeny (flaky) teszt", ["file:atlasz-tests/m5-verification-round2.test.mjs"]),
 "D-11": ("SEARCH hn.algolia kérés nem az aláírt egress-policy-n megy", ["int:search-hn-algolia", "file:atlasz-runtime/worker.js"]),
 "D-12": ("central.snapshot források nincsenek bekötve; vault auto-lock soha nincs bekapcsolva; sima mentés titkosítatlan", ["file:atlasz-addons/brain/central-brain.mjs", "file:atlasz-addons/secret-vault.mjs", "file:atlasz-addons/backup-recovery.mjs"]),
}
comp_defects = collections.defaultdict(list)
for d, (txt, keys) in DEFECTS.items():
    for k in keys:
        if k in KEY2ID:
            comp_defects[KEY2ID[k]].append("%s: %s" % (d, txt))
BROKEN_COMPS = {KEY2ID.get("view:supervision")}
# pre-existing defect register ids are kept in the legacy map (DEF-xxx); each is also attached to a component when a source path is named
DEFREG = list(csv.DictReader(open(os.path.join(AUD, "ATLASZ_V73_DEFECT_REGISTER.csv"), encoding="utf-8-sig")))
for d in DEFREG:
    for p in PATH_RE.findall(d.get("reproduction_evidence", "") + " " + d.get("verification_result", "")):
        if p in FILE2ID and d["status"] not in ("TESTED", "CLOSED", "FIXED", "VERIFIED"):
            comp_defects[FILE2ID[p]].append("%s (%s): %s" % (d["defect_id"], d["status"], d["title"][:120]))

# ---------------------------------------------------------------- status derivation
EXTERNAL_FACING = {"provider-adapters", "connector-catalog", "chat-providers", "local-ai-manager", "embedding-provider", "mcp-client", "malware-scanner", "voice-interface",
    "voice-session", "voice-conversation", "payment-webhook-receiver", "payment-package-intake", "source-adapters", "live-discovery-runner", "browser-extension-guard", "computer-use-fabric",
    "model-gateway", "provider-egress", "provider-resilience", "page-ingest", "universal-connector-layer", "tool-bridge", "multi-model-brain"}
WEAK = {"PARTIAL", "MISSING", "STRUCTURAL_ONLY", "MOCK_ONLY", "CONNECTED_UNTESTED", "BROKEN", "EXTERNAL_BLOCKER", "OWNER_APPROVAL_REQUIRED", "NOT_YET_VERIFIED"}
REQ_BY_LEG = {r["id"]: r for r in reqs}
SRC_BY_LEG = {r["id"]: r for r in srcs}
def req_status_dist(cid):
    d = collections.Counter()
    for ra in comp_reqs.get(cid, ()):
        pass
    return d
ATL2LEG = {v: k for k, v in list(REQ_ID.items()) + list(SRC_ID.items())}
def linked_status_counter(cid):
    c = collections.Counter()
    for ra in comp_reqs.get(cid, ()):
        leg = ATL2LEG[ra]
        row = REQ_BY_LEG.get(leg) or SRC_BY_LEG.get(leg)
        if row and (row.get("kind") in ("REQUIREMENT", None)) and not str(row.get("deferred")) == "True":
            c[row["status"]] += 1
    return c

def test_summary(tests):
    p = f = 0; tid = []
    for t in tests:
        g = gate.get(t)
        if g:
            p += g["pass"]; f += g["fail"]
        tid.append(FILE2ID[t])
    return p, f, tid

NOW = TODAY
for p in files:
    cid = FILE2ID[p]; c = COMPONENTS[cid]; fct = FACT[p]
    cat = c["category"]
    base = os.path.splitext(os.path.basename(p))[0]
    mx = matrix.get(p); dp = dispos.get(p)
    c["function"] = fct["header"] if fct["header"] != UNK else UNK
    c["lines"] = fct["lines"]; c["exports"] = fct["exports"]
    c["version"] = fct["version"]; c["last_commit"] = fct["commit"]
    c["external_dependencies"] = fct["hosts"] if fct["hosts"] else ["nincs azonosított külső host a forrásban (statikus keresés)"]
    c["related_component_ids"] = sorted({FILE2ID[i] for i in fct["imports"] if i in FILE2ID})[:60]
    c["last_checked"] = NOW
    c["next_action"] = UNK
    if cat == "TST":
        g = gate.get(p)
        c["test_results"] = ("%d pass / %d fail (gate 2026-10-12)" % (g["pass"], g["fail"])) if g else "nincs gate-eredmény"
        c["tests_modules"] = [FILE2ID[r] for r in test_refs.get(p, [])]
        c["tested_function"] = "teszt maga"
        c["live_evidence"] = "n/a (teszt)"
        c["status"] = "VERIFIED_WORKING" if g and g["fail"] == 0 and g["pass"] > 0 else ("BROKEN" if g and g["fail"] else "NOT_YET_VERIFIED")
        c["integration_status"] = "teszt-gate része" if g else "nincs"
        c["known_defects"] = comp_defects.get(cid, []) or ["nincs ismert"]
        if p.endswith("m5-verification-round2.test.mjs"):
            c["known_defects"] = ["D-10: időzítésérzékeny, terhelés alatt elbukhat; egyedül és soros gate-ben zöld"]
        c["missing_functions"] = "nincs ismert"
        c["next_action"] = "nincs" if c["status"] == "VERIFIED_WORKING" else "vizsgálat szükséges"
        c["owner_approval_needed"] = "nem"
        continue
    if cat in ("CHK",):
        c["test_results"] = "n/a"; c["live_evidence"] = "n/a"; c["status"] = "STRUCTURAL_ONLY" if fct["lines"] < 12 else "VERIFIED_WORKING" if p in ("scripts/system-audit.mjs", "scripts/integration-matrix.mjs") else "NOT_YET_VERIFIED"
        c["integration_status"] = "önálló segédeszköz (nem része a futó rendszernek)"
        c["known_defects"] = comp_defects.get(cid, []) or ["nincs ismert"]
        c["missing_functions"] = "nem vizsgált funkcionálisan (generátor/segéd)" if c["status"] == "NOT_YET_VERIFIED" else "nincs ismert"
        c["owner_approval_needed"] = "nem"; c["tested_function"] = "nincs közvetlen teszt-hivatkozás" if not mod_tests.get(p) else "van"
        if mod_tests.get(p):
            pp, ff, tid = test_summary(mod_tests[p]); c["test_ids"] = tid; c["test_results"] = "%d pass / %d fail" % (pp, ff)
        continue
    # ordinary code component
    tests = sorted(set(mod_tests.get(p, [])) | {("atlasz-tests/" + t) for t in (mx or {}).get("testFiles", []) if ("atlasz-tests/" + t) in FILE2ID})
    indirect = False
    if not tests:
        ind = set()
        for imp in importers.get(p, ()):
            ind |= set(mod_tests.get(imp, []))
        if ind:
            tests = sorted(ind); indirect = True
    pp, ff, tid = test_summary(tests)
    c["test_ids"] = tid
    c["test_results"] = ("%d pass / %d fail, %d tesztfájl (gate 2026-10-12)%s" % (pp, ff, len(tests), "; KÖZVETETT: csak a modult importáló komponensek tesztjei" if indirect else "")) if tests else "nincs közvetlen teszt-hivatkozás"
    reach_cc = p in REACH_CC; reach_rt = p in REACH_RT; reach_win = p in REACH_WIN
    wired = reach_cc or reach_rt or reach_win
    if mx:
        c["integration_status"] = "Master:%s; Ügynökök:%s; ControlCenter:%s; CC-induláskor betöltve:%s (integration_matrix 2026-10-11)" % tuple("igen" if mx[k] else "nem" for k in ("connectedToMaster", "connectedToAgents", "connectedToControlCenter", "loadedWhenControlCenterBoots"))
    else:
        c["integration_status"] = "statikus import-lánc: ControlCenter:%s; runtime:%s (integration_matrix nem tartalmazza)" % ("igen" if reach_cc else "nem", "igen" if reach_rt else "nem")
    if dp:
        c["integration_status"] += "; modul-besorolás: %s/%s" % (dp.get("level"), dp.get("disposition"))
        if dp.get("id"):
            c.setdefault("legacy", []).append("module:" + dp["id"])
    c["wired_to_running_system"] = bool(wired or (mx and (mx["connectedToControlCenter"] or mx["loadedWhenControlCenterBoots"])))
    c["tested_function"] = (("közvetetten: " if indirect else "igen: ") + "%d tesztfájl (%d pass / %d fail)" % (len(tests), pp, ff)) if tests else "nincs"
    wired_f = c["wired_to_running_system"]
    cnt = linked_status_counter(cid)
    c["linked_requirement_status_counts"] = dict(cnt)
    weak = sum(v for k, v in cnt.items() if k in WEAK)
    ext = base in EXTERNAL_FACING
    c["live_evidence"] = "NINCS éles/valódi környezeti bizonyíték" if (ext or cat in ("INT", "MDL", "VOI", "FIN")) else "helyi modul: éles külső környezet nem szükséges; futási bizonyíték = tesztek%s" % ("; a Control Center smoke (2026-10-12) betöltötte" if reach_cc else "")
    known = comp_defects.get(cid, [])
    c["known_defects"] = known or ["nincs ismert (ebben az ellenőrzésben)"]
    # status rule
    if cid in BROKEN_COMPS:
        st = "BROKEN"
    elif not tests and not wired_f:
        st = "STRUCTURAL_ONLY"
    elif not tests and wired_f:
        st = "CONNECTED_UNTESTED"
    elif tests and ff:
        st = "BROKEN"
    elif ext:
        st = "MOCK_ONLY"
    elif not wired_f:
        st = "PARTIAL"
    elif weak > 0 or known:
        st = "PARTIAL"
    else:
        st = "VERIFIED_WORKING"
    c["status"] = st
    if st == "STRUCTURAL_ONLY":
        c["integration_status"] += "; FIGYELEM: a statikus elemzés nem látja a dinamikus import / Worker / child_process betöltést - kézi megerősítés szükséges"
    why = []
    if st == "PARTIAL" and not wired_f: why.append("tesztelt, de a futó rendszerből nem érhető el")
    if st == "PARTIAL" and weak: why.append("%d kapcsolt követelmény nem VERIFIED_WORKING (%s)" % (weak, ", ".join("%s:%d" % (k, v) for k, v in sorted(cnt.items()) if k in WEAK)))
    if st == "MOCK_ONLY": why.append("külső-érintkező modul: csak fake/fixture teszt, éles kapcsolat nincs")
    if st == "STRUCTURAL_ONLY": why.append("nincs teszt-hivatkozás és nincs bekötés")
    if st == "CONNECTED_UNTESTED": why.append("be van kötve, de nincs közvetlen teszt")
    c["missing_functions"] = "; ".join(why) if why else "nincs ismert (részletek: a kapcsolt követelmények sorai)"
    needs = [k for k in ("OWNER_APPROVAL_REQUIRED", "EXTERNAL_BLOCKER") if cnt.get(k)]
    c["owner_approval_needed"] = ("igen: %s" % ", ".join("%s×%d" % (k, cnt[k]) for k in needs)) if needs else "nincs külön azonosítva"

# --- non-file components
for k, cid in KEY2ID.items():
    c = COMPONENTS[cid]
    if c["kind"] == "PERMANENT_AGENT":
        name = c["name"]
        ev = next((r for r in agentev["rows"] if r["agent"] == name), {})
        c.update(function=("SEARCH/SALES felderítő ügynök" if name.startswith("SEARCH") else "EXECUTION végrehajtó ügynök") + " (fix roster: agent-registry.mjs)",
                 code_files=["atlasz-addons/agent-registry.mjs", "atlasz-addons/agent-workforce.mjs", "atlasz-addons/agent-tool-policy.mjs", "atlasz-addons/agent-executors.mjs"],
                 external_dependencies=["modell-szolgáltató (nincs élő kapcsolat)"], version=UNK, last_commit=last_commit.get("atlasz-addons/agent-registry.mjs", UNK), last_checked=NOW,
                 integration_status="Master Coordinator alatt; roster fix; ügynök-bizonyíték: provenance=%s, feladat-fogadás=%s, kimenet=%s, független ellenőrzés=%s(%s), szünet alatt elutasít=%s, szünet után helyreáll=%s" % (ev.get("provenance"), ev.get("receivedTask"), ev.get("producedOutput"), ev.get("independentCheck"), ev.get("checker"), ev.get("refusedWhilePaused"), ev.get("recoveredAfterPause")),
                 test_results="agent_evidence_2026-10-11: 30/30 mechanizmus-bizonyíték (SANDBOX fixture)", tested_function="igen, fixture-szinten (mechanizmus)",
                 live_evidence="NINCS valódi/éles munkabizonyíték (nincs élő modell, nincs kereskedelmi munka)", status="PARTIAL",
                 known_defects=["D-04: két példány dupla végrehajtást okozhat"] ,
                 missing_functions="EXECUTION csak 5 helyi executort ismer; nincs élő modell; nincs valódi ügyfélmunka; élő felderítés soha nem futott",
                 owner_approval_needed="igen: modell-kapcsolat és külső hálózat tulajdonosi jóváhagyás", next_action=UNK)
    elif c["kind"] == "HTTP_ENDPOINT":
        rt = routecov.get(c["route"], {}); nt = rt.get("test_files")
        d = comp_defects.get(cid, [])
        sw = ui.get("apiSweep", {}).get(c["route"]) if c["method"] == "GET" else None
        smoke = bool(sw and sw.get("status") == 200)
        st = "VERIFIED_WORKING" if (smoke or (nt and nt > 0)) else "CONNECTED_UNTESTED"
        if d: st = "PARTIAL"
        c.update(function="Control Center HTTP %s %s → core.%s" % (c["method"], c["route"], rt.get("core", UNK)), version=UNK, last_commit=last_commit.get("atlasz-control-center/server.mjs", UNK), last_checked=NOW,
                 external_dependencies=["nincs (loopback, token + Origin védelem)"], integration_status="bekötve a server.mjs térképébe; core fn: %s" % rt.get("core", UNK),
                 test_results=("%s tesztfájl hivatkozik rá (route_test_coverage)" % nt) if rt else "nincs route_test_coverage adat", tested_function="igen" if nt else "nincs közvetlen route-teszt",
                 live_evidence="Helyi Control Center smoke 2026-10-12: GET 200" if smoke else ("a smoke ezt a route-ot nem hívta (POST-ot szándékosan nem)" if c["method"] == "POST" else "a smoke nem adott 200-at / nem hívta"), status=st,
                 known_defects=d or ["nincs ismert"], missing_functions="; ".join(x.split(":")[0] for x in d) if d else "nincs ismert", owner_approval_needed="nincs külön azonosítva", next_action=UNK)
        c["test_ids"] = []
    elif c["kind"] == "UI_VIEW":
        d = comp_defects.get(cid, [])
        st = "VERIFIED_WORKING" if c["loads"] and not d else ("BROKEN" if not c["loads"] else "PARTIAL")
        c.update(function="Control Center nézet: %s; route-ok: %s" % (c["name"], c["routes"]), version=UNK, last_commit=last_commit.get("atlasz-control-center/public/app.js", UNK), last_checked=NOW,
                 external_dependencies=["nincs"], integration_status="bekötve az app.js navigációba (UI smoke 61 nézet)", test_results="Playwright/Chromium UI smoke 2026-10-12: %s" % ("hibátlanul betöltött" if c["loads"] else "ÖSSZEOMLIK"),
                 tested_function="megjelenítés ellenőrizve (helyi, fixture adatokkal); a mögöttes funkció külön komponens", live_evidence="Valódi Control Center szerver, ideiglenes állapotkönyvtár; éles adat nincs", status=st,
                 known_defects=d or ["nincs ismert"] , missing_functions="a nézet mögötti funkció állapota a kapcsolt API/modul sorokban" if st != "BROKEN" else "a nézet összeomlik",
                 owner_approval_needed="nincs külön azonosítva", next_action=UNK, test_ids=[])
    elif c["kind"] == "WORKFLOW_STAGE":
        s = c["stage"]
        stt = {"DISCOVER": ("OWNER_APPROVAL_REQUIRED", "élő felderítés soha nem futott; aláírt forrás-host és hálózati jóváhagyás kell"),
               "PAYMENT_VERIFICATION": ("EXTERNAL_BLOCKER", "élő Stripe-kapcsolat/aláírt webhook nincs"), "RECONCILIATION": ("EXTERNAL_BLOCKER", "valós processzor/bank adat nincs"),
               "NET_PROFIT": ("PARTIAL", "a hatóság-logika tesztelt; valós, ellenőrzött bevétel nincs")}.get(s, ("PARTIAL", "a szakasz-kapu kódolva és tesztelt, de a 14 szakasz nincs egyetlen állapotgépként a Money Engine-be kötve (P1)"))
        c.update(function="14 szakaszos üzleti folyamat %d. szakasza: %s (belépési bizonyíték-kritériumok)" % (c["stage_no"], s), version=UNK, last_commit=last_commit.get("atlasz-addons/workflow-stages.mjs", UNK), last_checked=NOW,
                 external_dependencies=["Stripe/KOHO/forrás-host (szakasz-függő)"] , integration_status="workflow-stages.mjs + core.verifyStageEvidence; Money Engine külön deal-állapotgépet használ",
                 test_results="workflow-stages / financial-engine tesztek (gate zöld)", tested_function="igen, fixture-szinten", live_evidence="NINCS éles futás", status=stt[0], known_defects=comp_defects.get(cid, []) or ["nincs ismert"],
                 missing_functions=stt[1], owner_approval_needed="igen" if stt[0] in ("OWNER_APPROVAL_REQUIRED", "EXTERNAL_BLOCKER") else "nincs külön azonosítva", next_action=UNK, test_ids=[])
    elif c["kind"] == "EXTERNAL_SERVICE":
        nm = c["name"]
        st = "MISSING" if False else "EXTERNAL_BLOCKER"
        c.update(function="Külső szolgáltatás-kapcsolat: %s (host: %s)" % (nm, c.get("host", UNK)), version=UNK, last_commit=last_commit.get(c["code_files"][0], UNK), last_checked=NOW,
                 external_dependencies=[c.get("host", UNK)], integration_status="adapter/leíró megvan; hitelesítő adat és éles próba NINCS", test_results="csak fake/fixture tesztek", tested_function="fixture", live_evidence="NINCS (nincs hitelesítő adat, nincs kapcsolati bizonyíték)",
                 status=st, known_defects=comp_defects.get(cid, []) or ["nincs ismert"], missing_functions="hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedélyezés, élő próba", owner_approval_needed="igen: hitelesítő adat + egress-policy + engedélyezés", next_action=UNK, test_ids=[])
        if c["natural_key"] == "int:koho":
            c["missing_functions"] = "nincs KOHO-integráció (csak kézi csomag-átvétel); bank-adat a tulajdonostól"
    elif c["kind"] == "MODEL_PROVIDER":
        miss = "NO_ADAPTER" in c.get("connector_status", "")
        c.update(function="AI-szolgáltató adapter-profil: %s; állapot: %s" % (c["name"], c.get("connector_status")), version=UNK, last_commit=last_commit.get("atlasz-addons/provider-adapters.mjs", UNK), last_checked=NOW,
                 external_dependencies=[c.get("host", UNK)], integration_status="model-registry → egress-policy → gateway (fake fetch-csel tesztelt)", test_results="provider-adapters / model-gateway tesztek (fake fetch)", tested_function="fake fetch", live_evidence="NINCS: egyetlen szolgáltató sem volt kontaktálva",
                 status="MISSING" if miss else "EXTERNAL_BLOCKER", known_defects=comp_defects.get(cid, []) or ["nincs ismert"], missing_functions="adapter hiányzik (a tulajdonos adja a valódi API-hostot/specifikációt)" if miss else "API-kulcs a vaultban, aláírt egress-policy, MODEL_ENABLE jóváhagyás, élő próba",
                 owner_approval_needed="igen", next_action=UNK, test_ids=[])
    elif c["kind"] == "BACKGROUND_PROCESS":
        cf = c["code_files"]
        c.update(function=c["name"], version=UNK, last_commit=last_commit.get(cf[0], UNK), last_checked=NOW, external_dependencies=["nincs"], last_check=NOW)
        pr = {"discovery-scheduler": ("BROKEN", "D-08: a tick() hívója nincs a futó rendszerben, nem fut magától"), "webhook-receiver": ("PARTIAL", "szándékosan nem auto-indul; élő Stripe nincs")}.get(k.split(":")[1], None)
        # status from the component files
        fs = [COMPONENTS[FILE2ID[f]]["status"] for f in cf if f in FILE2ID]
        st = pr[0] if pr else ("VERIFIED_WORKING" if fs and all(x == "VERIFIED_WORKING" for x in fs) else "PARTIAL")
        c.update(integration_status="; ".join("%s=%s" % (os.path.basename(f), COMPONENTS[FILE2ID[f]]["status"]) for f in cf if f in FILE2ID), test_results="a kapcsolt fájlok tesztjei (lásd fájl-komponensek)", tested_function="részben/igen (fájl-szinten)",
                 live_evidence="NINCS hosszú távú éles futás-bizonyíték", status=st, known_defects=comp_defects.get(cid, []) or ["nincs ismert"], missing_functions=pr[1] if pr else "folyamat-szintű hosszú távú futás nem bizonyított", owner_approval_needed="nincs külön azonosítva", next_action=UNK, test_ids=[])
    elif c["kind"] == "RECORD_DOCUMENT":
        d = c["code_files"][0]
        c.update(function="Nyilvántartási / audit dokumentum (nem futó kód): " + d, version=UNK, last_commit=last_commit.get(d, UNK), last_checked=NOW, external_dependencies=["nincs"], integration_status="nem része a futó rendszernek",
                 test_results="n/a", tested_function="n/a", live_evidence="n/a", status="NOT_YET_VERIFIED", known_defects=["a dokumentum tartalma elavulhat; lásd az ellenőrzési jelentést"], missing_functions="n/a", owner_approval_needed="nem", next_action="szükség szerinti frissítés", test_ids=[])
    elif c["kind"] == "TEMPLATE":
        c.update(function="Astro/Netlify kezdősablon (src/, public/, netlify/, astro.config.mjs) - nem ATLASZ-funkció", version=UNK, last_commit=UNK, last_checked=NOW, external_dependencies=["Netlify"], integration_status="nem része az ATLASZ futásnak",
                 test_results="n/a", tested_function="n/a", live_evidence="n/a", status="NOT_YET_VERIFIED", known_defects=["nem vizsgált"], missing_functions="nem ATLASZ-követelmény; a tulajdonos döntse el, kell-e", owner_approval_needed="igen: megtartás/eltávolítás", next_action="tulajdonosi döntés", test_ids=[])

# derived descriptive fallbacks (never invented): exports list when a file has no header comment; related components of non-file entries = their code files
for p_ in files:
    c_ = COMPONENTS[FILE2ID[p_]]
    if c_["function"] == UNK:
        ex = re.findall(r"^export\s+(?:async\s+)?(?:function\*?|const|class)\s+([A-Za-z0-9_$]+)", rd(p_), re.M)
        if ex:
            c_["function"] = "(nincs leíró fejléc; a forrás export-jai alapján) " + ", ".join(ex[:8])
for cid_, c_ in COMPONENTS.items():
    if "related_component_ids" not in c_:
        c_["related_component_ids"] = sorted({FILE2ID[f] for f in c_.get("code_files", []) if f in FILE2ID and FILE2ID[f] != cid_})
    c_.setdefault("code_files", [])
# requirement-sourced links to non-file comps do not change the component statuses; test ids on non-file comps stay empty
for cid, c in COMPONENTS.items():
    c["requirement_ids"] = sorted(comp_reqs.get(cid, ()))
    chs = sorted({ATL2LEG[r].split("-")[0] for r in comp_reqs.get(cid, ()) if ATL2LEG[r].startswith("C")})
    c["source_chapters"] = chs
    c.setdefault("legacy", [])
    c.setdefault("test_ids", [])
    for f in ("function", "version", "last_commit", "next_action"):
        c.setdefault(f, UNK)

# ---------------------------------------------------------------- next action text (derived, not invented)
for c in COMPONENTS.values():
    if c["next_action"] != UNK:
        continue
    st = c["status"]
    c["next_action"] = {"VERIFIED_WORKING": "nincs (megtartani, regressziós gate-ben)", "PARTIAL": "hiányzó rész kiegészítése / bekötése a prioritásos munkalista szerint (lásd missing_functions)",
                        "STRUCTURAL_ONLY": "teszt + bekötés, vagy tulajdonosi döntés a megtartásról", "CONNECTED_UNTESTED": "tesztek írása",
                        "MOCK_ONLY": "valódi környezeti próba tulajdonosi engedéllyel", "EXTERNAL_BLOCKER": "tulajdonosi hitelesítő adat / engedély / külső hozzáférés",
                        "BROKEN": "hibajavítás (tulajdonosi döntés után)", "MISSING": "tulajdonosi döntés a megvalósításról", "OWNER_APPROVAL_REQUIRED": "tulajdonosi jóváhagyás",
                        "NOT_YET_VERIFIED": "ellenőrzés"}.get(st, UNK)

# ---------------------------------------------------------------- requirement records
REQ_OUT = []
for r in REQ_ROWS:
    ra = REQ_ID[r["id"]]
    cl = sorted(req_comps.get(ra, ()))
    o = dict(r); o.update(atl_id=ra, legacy_id=r["id"], component_ids=cl, component_count=len(cl),
                          link_state=("LINKED" if cl else ("NO_IMPLEMENTING_COMPONENT" if r["kind"] == "REQUIREMENT" and r["status"] in ("MISSING",) else "NO_COMPONENT_REFERENCE")))
    REQ_OUT.append(o)
SRC_OUT = []
for r in srcs:
    ra = SRC_ID[r["id"]]
    cl = sorted(req_comps.get(ra, ()))
    o = dict(r); o.update(atl_id=ra, legacy_id=r["id"], component_ids=cl, component_count=len(cl))
    SRC_OUT.append(o)

# ---------------------------------------------------------------- legacy identifier map
LEG = []
def leg(scheme, lid, atl=None, src=None, note=None, comps=None):
    LEG.append({"scheme": scheme, "legacy_id": lid, "atl_id": atl or "", "source": src or "", "note": note or "", "component_ids": ";".join(comps or [])})
for r in REQ_ROWS: leg("AUDIT-LINE", r["id"], REQ_ID[r["id"]], "docs/audit/full_verification_2026-10-12/requirement_verification_registry.json", "chapter %s part %s line %s" % (r["chapter"], r["part"], r["source_line"]))
for r in srcs: leg({"CAP85": "CAP85", "SEC23": "SEC23", "IDEA150": "IDEA150"}[r["id"].split("-")[0]], r["id"], SRC_ID[r["id"]], r.get("source", ""), r.get("name", ""))
for k, cid in KEY2ID.items():
    for lg in COMPONENTS[cid].get("legacy", []):
        leg("COMPONENT-NATIVE", lg, cid, "", COMPONENTS[cid]["name"])
for p, dpm in dispos.items():
    if p in FILE2ID and dpm.get("id"):
        leg("MODULE-ID", dpm["id"], FILE2ID[p], "docs/audit/module_dispositions.json", "original133=%s" % dpm.get("original133"))
def paths_to_comps(text):
    return sorted({FILE2ID[p] for p in PATH_RE.findall(text or "") if p in FILE2ID})
V73 = list(csv.DictReader(open(os.path.join(ROOT, "docs/atlasz_v73_requirement_registry.csv"), encoding="utf-8-sig")))
for r in V73: leg("V73-MASTER-REGISTRY", r["id"], "", "docs/atlasz_v73_requirement_registry.csv", "%s | %s" % (r.get("level"), r.get("title", "")[:100]), paths_to_comps(r.get("implementation_location")))
for r in csv.DictReader(open(os.path.join(ROOT, "docs/atlasz_capability_audit_85.csv"), encoding="utf-8-sig")):
    leg("CAP85-LEGACY-M", r["id"], SRC_ID.get("CAP85-" + r["id"], ""), "docs/atlasz_capability_audit_85.csv", r["description"][:100])
for r in csv.DictReader(open(os.path.join(AUD, "pkg150_status.csv"), encoding="utf-8-sig")):
    leg("PKG150", r["namespaced_id"], "", "docs/audit/pkg150_status.csv", r["description"][:100])
for r in csv.DictReader(open(os.path.join(ROOT, "docs/atlasz_master_gap_register.csv"), encoding="utf-8-sig")):
    leg("GAP", r["gap_id"], "", "docs/atlasz_master_gap_register.csv", r["title"][:100], paths_to_comps(r.get("modules")))
for r in csv.DictReader(open(os.path.join(AUD, "ATLASZ_V73_MASTER_EXECUTION_TRACKER.csv"), encoding="utf-8-sig")):
    leg("TRACKER-TASK", r["task_id"], "", "docs/audit/ATLASZ_V73_MASTER_EXECUTION_TRACKER.csv", r["source_requirement"], paths_to_comps(r.get("module")))
for d in DEFREG: leg("DEFECT-REGISTER", d["defect_id"], "", "docs/audit/ATLASZ_V73_DEFECT_REGISTER.csv", d["title"][:100], paths_to_comps(d.get("reproduction_evidence", "")))
for d, (txt, keys) in DEFECTS.items(): leg("DEFECT-AUDIT-2026-10-12", d, "", "docs/audit/full_verification_2026-10-12/ELLENORZESI_JELENTES.md", txt, [KEY2ID[k] for k in keys if k in KEY2ID])
for r in csv.DictReader(open(os.path.join(AUD, "pkg150_traceability.csv"), encoding="utf-8-sig")): pass
for r in csv.DictReader(open(os.path.join(AUD, "milestone_traceability.csv"), encoding="utf-8-sig")): leg("MILESTONE-LINK", "%s:%s" % (r["milestone"], r["requirement_id"]), "", "docs/audit/milestone_traceability.csv", r["relation"])
for t in test_refs: leg("TEST-FILE-NAME", os.path.basename(t), FILE2ID[t], t, "a tesztnek korábban nem volt külön azonosítója; a fájlnév volt az azonosító")

# ---------------------------------------------------------------- stable ordering and write outputs
comp_list = sorted(COMPONENTS.values(), key=lambda c: c["id"])
for c in comp_list:
    c["natural_key_status"] = LEDGER["entries"][c["natural_key"]]["status"]
os.makedirs(OUT, exist_ok=True)
json.dump(LEDGER, open(LEDGER_P, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
if HISTORY_NEW:
    with open(HIST_P, "a", encoding="utf-8") as f:
        for h in HISTORY_NEW:
            f.write(json.dumps(h, ensure_ascii=False) + "\n")

REG = {"generated_at": TODAY, "git_head": HEAD, "categories": CATS, "counts": {"components": len(comp_list), "requirements_audit_rows": len(REQ_OUT), "source_sets_85_23_150": len(SRC_OUT), "links": len(LINKS), "legacy_ids": len(LEG)},
       "components": comp_list, "requirements": REQ_OUT, "source_sets": SRC_OUT, "links": LINKS, "legacy_id_map": LEG, "defects": [{"id": d, "title": t, "component_keys": k} for d, (t, k) in DEFECTS.items()]}
json.dump(REG, open(os.path.join(OUT, "atlasz_id_registry.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def wcsv(name, rows, cols):
    with open(os.path.join(OUT, name), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([("; ".join(map(str, r.get(c))) if isinstance(r.get(c), (list, tuple)) else (json.dumps(r.get(c), ensure_ascii=False) if isinstance(r.get(c), dict) else r.get(c, ""))) for c in cols])
CC = ["id", "name", "category", "kind", "function", "requirement_ids", "source_chapters", "code_files", "related_component_ids", "external_dependencies", "integration_status", "test_ids", "test_results",
      "tested_function", "live_evidence", "last_commit", "version", "last_checked", "status", "known_defects", "missing_functions", "owner_approval_needed", "next_action", "legacy", "natural_key", "natural_key_status"]
wcsv("components.csv", comp_list, CC)
wcsv("requirement_component_links.csv", LINKS, ["requirement_id", "legacy_requirement_id", "component_id", "relation"])
wcsv("legacy_id_map.csv", LEG, ["scheme", "legacy_id", "atl_id", "source", "note", "component_ids"])
RC = ["atl_id", "legacy_id", "chapter", "part", "source_line", "kind", "status", "deferred", "component_ids", "link_state", "source_text", "evidence", "missing", "fix", "external", "owner_decision"]
wcsv("requirements.csv", REQ_OUT, RC)
wcsv("source_sets_85_23_150.csv", SRC_OUT, ["atl_id", "legacy_id", "name", "status", "component_ids", "files", "evidence", "missing", "external", "ownerDecision"])
wcsv("id_ledger.csv", [dict(key=k, **v) for k, v in sorted(LEDGER["entries"].items(), key=lambda kv: kv[1]["id"])], ["id", "category", "key", "name", "first_seen", "first_seen_commit", "status", "retired_at"])

# SQLite
dbp = os.path.join(OUT, "atlasz_id_registry.sqlite")
if os.path.exists(dbp):
    os.remove(dbp)
db = sqlite3.connect(dbp)
db.executescript("""
CREATE TABLE components(id TEXT PRIMARY KEY, name TEXT, category TEXT, kind TEXT, function TEXT, source_chapters TEXT, code_files TEXT, external_dependencies TEXT, integration_status TEXT,
  test_results TEXT, tested_function TEXT, live_evidence TEXT, last_commit TEXT, version TEXT, last_checked TEXT, status TEXT, known_defects TEXT, missing_functions TEXT, owner_approval_needed TEXT, next_action TEXT, natural_key TEXT UNIQUE, ledger_status TEXT);
CREATE TABLE requirements(atl_id TEXT PRIMARY KEY, legacy_id TEXT, chapter INTEGER, part TEXT, source_line INTEGER, kind TEXT, status TEXT, deferred TEXT, link_state TEXT, source_text TEXT, evidence TEXT, missing TEXT, fix TEXT, external TEXT, owner_decision TEXT);
CREATE TABLE source_sets(atl_id TEXT PRIMARY KEY, legacy_id TEXT, name TEXT, status TEXT, evidence TEXT, missing TEXT, external TEXT, owner_decision TEXT);
CREATE TABLE req_component_links(requirement_id TEXT, component_id TEXT, relation TEXT, legacy_requirement_id TEXT, PRIMARY KEY(requirement_id, component_id));
CREATE TABLE component_relations(component_id TEXT, related_component_id TEXT, PRIMARY KEY(component_id, related_component_id));
CREATE TABLE component_tests(component_id TEXT, test_id TEXT, PRIMARY KEY(component_id, test_id));
CREATE TABLE legacy_ids(scheme TEXT, legacy_id TEXT, atl_id TEXT, source TEXT, note TEXT, component_ids TEXT);
CREATE TABLE id_ledger(id TEXT PRIMARY KEY, category TEXT, natural_key TEXT UNIQUE, name TEXT, first_seen TEXT, first_seen_commit TEXT, status TEXT, retired_at TEXT);
CREATE TABLE history(at TEXT, commit_id TEXT, id TEXT, event TEXT, detail TEXT);
CREATE INDEX i_links_c ON req_component_links(component_id);
CREATE INDEX i_legacy ON legacy_ids(legacy_id);
""")
J = lambda v: json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v
db.executemany("INSERT INTO components VALUES(%s)" % ",".join("?" * 22), [(c["id"], c["name"], c["category"], c["kind"], c["function"], J(c["source_chapters"]), J(c.get("code_files", [])), J(c.get("external_dependencies", [])), c["integration_status"], c["test_results"], c["tested_function"], c["live_evidence"], c["last_commit"], c["version"], c["last_checked"], c["status"], J(c["known_defects"]), c["missing_functions"], c["owner_approval_needed"], c["next_action"], c["natural_key"], c["natural_key_status"]) for c in comp_list])
db.executemany("INSERT INTO requirements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [(r["atl_id"], r["legacy_id"], r["chapter"], r["part"], r["source_line"], r["kind"], r["status"], str(r["deferred"]), r["link_state"], r["source_text"], r["evidence"], r["missing"], r["fix"], r["external"], r["owner_decision"]) for r in REQ_OUT])
db.executemany("INSERT INTO source_sets VALUES(?,?,?,?,?,?,?,?)", [(r["atl_id"], r["legacy_id"], r.get("name"), r["status"], r.get("evidence"), r.get("missing"), r.get("external"), r.get("ownerDecision")) for r in SRC_OUT])
db.executemany("INSERT INTO req_component_links VALUES(?,?,?,?)", [(l["requirement_id"], l["component_id"], l["relation"], l["legacy_requirement_id"]) for l in LINKS])
db.executemany("INSERT OR IGNORE INTO component_relations VALUES(?,?)", [(c["id"], x) for c in comp_list for x in c.get("related_component_ids", [])])
db.executemany("INSERT OR IGNORE INTO component_tests VALUES(?,?)", [(c["id"], x) for c in comp_list for x in c.get("test_ids", [])])
db.executemany("INSERT INTO legacy_ids VALUES(?,?,?,?,?,?)", [(l["scheme"], l["legacy_id"], l["atl_id"], l["source"], l["note"], l["component_ids"]) for l in LEG])
db.executemany("INSERT INTO id_ledger VALUES(?,?,?,?,?,?,?,?)", [(v["id"], v["category"], k, v["name"], v["first_seen"], v["first_seen_commit"], v["status"], v.get("retired_at")) for k, v in LEDGER["entries"].items()])
hist = [json.loads(l) for l in open(HIST_P, encoding="utf-8")] if os.path.exists(HIST_P) else []
db.executemany("INSERT INTO history VALUES(?,?,?,?,?)", [(h["at"], h["commit"], h["id"], h["event"], json.dumps(h, ensure_ascii=False)) for h in hist])
db.commit(); db.close()

stc = collections.Counter(c["status"] for c in comp_list)
cc = collections.Counter(c["category"] for c in comp_list)
print("components", len(comp_list), dict(sorted(cc.items())))
print("status", dict(stc))
print("requirements", len(REQ_OUT), "sets", len(SRC_OUT), "links", len(LINKS), "legacy", len(LEG), "history_new", len(HISTORY_NEW))
print("reqs with component:", sum(1 for r in REQ_OUT if r["component_ids"]), "without:", sum(1 for r in REQ_OUT if not r["component_ids"]))
