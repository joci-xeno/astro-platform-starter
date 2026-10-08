#!/usr/bin/env python3
"""Task 3 static scan (reproducible): import graph + reachability, typed tools, Control Center routes/views, duplicate exports, security patterns.
Usage: python3 docs/audit/static_scan.py   (from repo root).  Writes docs/audit/static_scan.json.  Static = regex based; limits are listed in the report."""
import os, re, json, sys
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def rd(p):
    try: return open(os.path.join(root, p), encoding="utf-8", errors="replace").read()
    except OSError: return ""
SRC_DIRS = ["atlasz-addons", "atlasz-runtime", "atlasz-control-center", "scripts", "launcher", "netlify", "atlasz-astra"]
files = []
for d in SRC_DIRS:
    for dp, dn, fn in os.walk(os.path.join(root, d)):
        dn[:] = [x for x in dn if x not in ("node_modules", "__pycache__")]
        for f in fn:
            if f.endswith((".mjs", ".js", ".cjs")): files.append(os.path.relpath(os.path.join(dp, f), root))
tests = sorted(f for f in os.listdir(os.path.join(root, "atlasz-tests")) if f.endswith(".test.mjs"))
IMP = re.compile(r'(?:import\s+(?:[^"\';]*?\sfrom\s+)?|import\(\s*|require\(\s*|export\s+[^"\';]*?\sfrom\s+)["\'](\.{1,2}/[^"\']+)["\']')
def resolve(frm, spec):
    p = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    for c in (p, p + ".mjs", p + ".js", p + ".cjs"):
        if os.path.isfile(os.path.join(root, c)): return c
    return None
graph = {f: sorted({r for s in IMP.findall(rd(f)) if (r := resolve(f, s))}) for f in files}
helpers = [f for f in os.listdir(os.path.join(root, "atlasz-tests")) if f.endswith(".mjs") and not f.endswith(".test.mjs")]
for h in helpers: graph["atlasz-tests/" + h] = sorted({r for s_ in IMP.findall(rd("atlasz-tests/" + h)) if (r := resolve("atlasz-tests/" + h, s_))})
tgraph = {t: sorted({r for s in IMP.findall(rd("atlasz-tests/" + t)) if (r := resolve("atlasz-tests/" + t, s))}) for t in tests}
def reach(entries):
    seen, st = set(), [e for e in entries if e in graph]
    while st:
        x = st.pop()
        if x in seen: continue
        seen.add(x); st += graph.get(x, [])
    return seen
# entry points
ENT = {
 "RUNTIME": ["atlasz-runtime/supervisor-safe.mjs"],
 "CONTROL_CENTER": ["atlasz-control-center/server.mjs", "atlasz-control-center/core.mjs"],
 "CLI_AND_SCRIPTS": [f for f in files if f.startswith(("scripts/", "launcher/")) or re.search(r"(owner-cli|cli)\.m?js$", f) or f.startswith("atlasz-control-center/electron") or f.startswith("atlasz-control-center/scripts")],
 "LEGACY_START": ["atlasz-runtime/supervisor.js", "atlasz-runtime/worker.js", "atlasz-runtime/agent-child.js"],
}
R = {k: reach(v) for k, v in ENT.items()}
tested_by = {}
for t, deps in tgraph.items():
    for x in deps: tested_by.setdefault(x, []).append(t)
mods = []
for f in files:
    if not f.startswith(("atlasz-addons/", "atlasz-runtime/", "atlasz-control-center/")): continue
    mods.append(dict(file=f, loc=rd(f).count("\n") + 1, runtime=f in R["RUNTIME"], control_center=f in R["CONTROL_CENTER"], cli=f in R["CLI_AND_SCRIPTS"], legacy=f in R["LEGACY_START"],
                     imported_by=sorted(k for k, v in graph.items() if f in v)[:6], tests=sorted(tested_by.get(f, []))))
for m in mods:
    if m["file"].endswith("public/app.js"): m["runtime"] = False; m["control_center"] = True       # browser asset served by the Control Center server (not in the import graph)
    m["reach"] = "RUNTIME" if m["runtime"] else "CONTROL_CENTER" if m["control_center"] else "CLI" if m["cli"] else "LEGACY_ONLY" if m["legacy"] else "TEST_ONLY" if m["tests"] else "ORPHAN"

# ---- invocation analysis: is a module's code actually CALLED by a production workflow, or only imported / exposed in the hub adapter bag?
IMPSTMT = re.compile(r'import\s*\{([^}]*)\}\s*from\s*["\'](\.{1,2}/[^"\']+)["\']|import\s+(\w+)\s+from\s*["\'](\.{1,2}/[^"\']+)["\']|import\s*\*\s*as\s+(\w+)\s+from\s*["\'](\.{1,2}/[^"\']+)["\']')
def used_symbols(importer):
    txt = rd(importer); res = {}
    region = txt
    hub = importer.endswith("internal-integration-hub.mjs")
    if hub:
        a = txt.index("export function createInternalAddonHub"); b = txt.index("  return {onAgentRegistered"); region = txt[a:b]       # hooks + snapshot only; the adapter bag after b is excluded
    for m in IMPSTMT.finditer(txt):
        names, spec = (m.group(1), m.group(2)) if m.group(2) else (m.group(3) or m.group(5), m.group(4) or m.group(6))
        tgt = resolve(importer, spec)
        if not tgt: continue
        ids = [x.strip().split(" as ")[-1].strip() for x in names.split(",")] if m.group(2) else [names]
        used = [i for i in ids if i and len(re.findall(r"\b" + re.escape(i) + r"\b", region)) >= (1 if hub else 2)]
        if hub: used = [i for i in ids if i and re.search(r"\b" + re.escape(i) + r"\b", region)]
        res.setdefault(tgt, set()).update(used)
    return res
inv = {}
for f in files:
    if f.startswith(("atlasz-addons/", "atlasz-runtime/", "atlasz-control-center/")) and not f.endswith("public/app.js"):
        for tgt, used in used_symbols(f).items():
            if used: inv.setdefault(tgt, set()).add(f)
for m in mods:
    users = sorted(inv.get(m["file"], []))
    nonhub = [u for u in users if not u.endswith("internal-integration-hub.mjs")]
    hubhook = any(u.endswith("internal-integration-hub.mjs") for u in users)
    imported_by_hub = any(x.endswith("internal-integration-hub.mjs") for x in graph and [k for k, v in graph.items() if m["file"] in v])
    m["invocation"] = ("INVOKED_BY_PRODUCTION_CODE" if nonhub else "INVOKED_VIA_HUB_HOOKS" if hubhook else "HUB_ADAPTER_BAG_ONLY" if imported_by_hub else "NOT_INVOKED" if m["reach"] in ("RUNTIME", "CONTROL_CENTER", "CLI") else "n/a")
    m["invoked_by"] = nonhub[:5]
for m in mods:
    if m["file"].endswith("public/app.js"): m["invocation"] = "INVOKED_BY_PRODUCTION_CODE"
# ---- typed tools
tools = {}
for f in files:
    s = rd(f)
    for m in re.finditer(r'registry\.register\(\s*\{\s*name:\s*"([a-z0-9_.]+)"([^\n]{0,400})', s):
        op = re.search(r'operation:\s*"([A-Z_]+)"', s[m.start():m.start() + 1800]); tools[m.group(1)] = dict(file=f, operation=op.group(1) if op else None)
    for m in re.finditer(r'(?:tools|reg|registry)\.register\(\{\s*name:\s*"([a-z0-9_.]+)"', s):
        op = re.search(r'operation:\s*"([A-Z_]+)"', s[m.start():m.start() + 1800]); tools.setdefault(m.group(1), dict(file=f, operation=op.group(1) if op else None))
alltests = {t: rd("atlasz-tests/" + t) for t in tests}
for n, v in tools.items():
    v["tests"] = sorted(t for t, s in alltests.items() if '"' + n + '"' in s)[:5]
    v["registered_in_runtime"] = v["file"] in R["RUNTIME"]
# ---- Control Center routes / views
srv = rd("atlasz-control-center/server.mjs"); app = rd("atlasz-control-center/public/app.js"); core = rd("atlasz-control-center/core.mjs")
routes = sorted(set(re.findall(r'"(/api/[a-zA-Z0-9_/\-]+)"\s*:', srv)))
views = sorted(set(re.findall(r'^\s*(?:async\s+)?([a-z_]+)\s*\(\)\s*\{', app, re.M)) | set(re.findall(r'^views\.([a-z_]+)\s*=', app, re.M)))
nav = re.search(r'const NAMES\s*=\s*\{(.*?)\};', app, re.S); navkeys = re.findall(r'([a-z_]+):\s*"', nav.group(1)) if nav else []
api_used = sorted(set(re.findall(r'["`](/api/[a-zA-Z0-9_/\-]+)', app)))
cc_tests = "\n".join(s for t, s in alltests.items() if "control-center" in t or "hosted" in t or "createControlCenterServer" in s)
route_info = {r: dict(used_by_ui=r in api_used, in_tests=r in cc_tests) for r in routes}
core_exports = set(re.findall(r'return \{([^}]*)\};?\s*\n\s*\}\s*$', core, re.S)[-1:] and re.findall(r'\b([a-zA-Z_]+)\b', re.findall(r'return \{([^}]*)\};?\s*\n\s*\}\s*$', core, re.S)[-1]) or [])
# ---- duplicate exports
exports = {}
for m in mods:
    s = rd(m["file"])
    for n in re.findall(r'export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)', s): exports.setdefault(n, []).append(m["file"])
dups = {n: v for n, v in exports.items() if len(v) > 1}
fac = {}
for m in mods:
    for n in re.findall(r'export\s+(?:async\s+)?function\s+(create[A-Za-z0-9]+)', rd(m["file"])): fac.setdefault(n, []).append(m["file"])
# near-duplicate module names (same stem tokens)
def stem(f): return set(re.sub(r'\.m?js$', '', os.path.basename(f)).split("-")) - {"engine", "center", "fabric", "system", "manager", "brain"}
near = []
mf = [m["file"] for m in mods if m["file"].startswith("atlasz-addons")]
for i, a in enumerate(mf):
    for b in mf[i + 1:]:
        sa, sb = stem(a), stem(b)
        if sa and sb and len(sa & sb) >= 1 and (sa <= sb or sb <= sa) and os.path.basename(a) != os.path.basename(b): near.append([a, b, sorted(sa & sb)])
# ---- security patterns
SEC = []
def hit(kind, f, line, sev, note):
    SEC.append(dict(kind=kind, file=f, line=line, severity=sev, note=note))
for f in files + ["package.json"]:
    s = rd(f)
    for i, ln in enumerate(s.split("\n"), 1):
        if re.search(r'\beval\s*\(|new Function\s*\(', ln) and "//" not in ln.split("eval")[0]: hit("EVAL", f, i, "HIGH", ln.strip()[:120])
        if re.search(r'child_process', ln) and f not in ("atlasz-addons/code-sandbox.mjs",): hit("CHILD_PROCESS", f, i, "REVIEW", ln.strip()[:120])
        if re.search(r'0\.0\.0\.0', ln) and not ln.strip().startswith("//"): hit("BIND_ALL_INTERFACES", f, i, "REVIEW", ln.strip()[:120])
        if re.search(r'(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)', ln) and "test" not in f: hit("SECRET_LITERAL", f, i, "HIGH", "pattern present (value not shown)")
        if re.search(r'rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED', ln): hit("TLS_VERIFY_OFF", f, i, "HIGH", ln.strip()[:120])
        if re.search(r'Math\.random\(\)', ln) and re.search(r'token|nonce|secret|id\b', ln, re.I) and f.startswith("atlasz-"): hit("WEAK_RANDOM_FOR_ID_OR_TOKEN", f, i, "REVIEW", ln.strip()[:120])
        if re.search(r'[!=]==?\s*\w*[tT]oken\b|\b\w*[tT]oken\w*\s*[!=]==?\s', ln) and "timingSafeEqual" not in s and f.startswith("atlasz-control-center") and not ln.strip().startswith("//"): hit("TOKEN_COMPARE_NOT_CONSTANT_TIME", f, i, "REVIEW", ln.strip()[:120])
        if re.search(r'JSON\.parse\(', ln) and "try" not in ln and f.startswith("atlasz-control-center/server"): hit("JSON_PARSE_UNGUARDED_IN_SERVER", f, i, "REVIEW", ln.strip()[:120])
        if re.search(r'\bexec(Sync)?\(|\bspawn(Sync)?\(', ln) and "shell" in ln and "true" in ln: hit("SHELL_TRUE", f, i, "HIGH", ln.strip()[:120])
        if re.search(r'writeFileSync\([^)]*0o[67][67][67]', ln): hit("WORLD_WRITABLE_FILE_MODE", f, i, "REVIEW", ln.strip()[:120])
out = dict(graph=graph, tgraph=tgraph, files=len(files), tests=len(tests), modules=mods, reach_counts={k: len(v) for k, v in R.items()}, tools=tools, routes=route_info, views=views, nav=navkeys, api_used=api_used, ui_core_exports=sorted(core_exports),
           duplicate_exports=dups, factories_multiple=({k: v for k, v in fac.items() if len(v) > 1}), near_duplicate_names=near, security=SEC)
json.dump(out, open(os.path.join(root, "docs/audit/static_scan.json"), "w"), indent=1)
from collections import Counter
print(Counter(m["invocation"] for m in mods)); print("files", len(files), "tests", len(tests), "modules", len(mods)); print(Counter(m["reach"] for m in mods)); print("tools", len(tools), "routes", len(routes), "views", len(views), "nav", len(navkeys))
print("sec", Counter((s["kind"], s["severity"]) for s in SEC))
