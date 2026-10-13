# -*- coding: utf-8 -*-
# Part 2 of build_system_inventory.py (executed in the same namespace). RECORDS ONLY.

# ------------------------------------------------------------------------------------------------ false "needs new module" items: tests exist (ATL-TST)
TST_COMPS = {c: r for c, r in comps.items() if r["category"] == "TST"}
TSTKW = [(r"queue", r"queue|dead-letter"), (r"money", r"money|financial|payment|profit|ledger"), (r"control center", r"control-center|control_center|cc-|server"),
         (r"approval", r"approval|owner-auth|gateway"), (r"kill", r"emergency|kill|safe-mode"), (r"update center", r"update"), (r"contract", r"contract"),
         (r"negative", r"negative|bypass|mutation|policy"), (r"mutation", r"mutation|bypass")]
for d in DIRS:
    if d["needs_new_module"] and not d["pln"] and d["status"] != "MISSING":
        t = d["text"].lower()
        picks = []
        for kw, rx in TSTKW:
            if re.search(kw, t):
                picks = [c for c, r in TST_COMPS.items() if re.search(rx, r["name"], re.I)][:5]
                break
        if picks and not d["components"]:
            d["components"] = picks
        d["needs_new_module"] = False
        d["notes"] = (d["notes"] + "; " if d["notes"] else "") + "tesztkategória/teszt-készlet: az atlasz-tests (ATL-TST-*) hordozza, külön új modul nem szükséges"

# ------------------------------------------------------------------------------------------------ PLN bookkeeping
for slug, m in PLN.items():
    m["matched_req"] = sorted(a for a, r in REQ.items() if r.get("pln") == slug)
    m["matched_dir"] = sorted(d["id"] for d in DIRS if d["pln"] == slug)
    m["status"] = {"NEW": "PLANNED", "EXTEND": "PLANNED_EXTEND", "DEFERRED": "PLANNED_DEFERRED", "DECISION": "DECISION_PENDING"}[m["kind"]]
    for a in m["matched_req"]:
        REQ[a].setdefault("pln_id", m["id"])
for a, r in REQ.items():
    r["pln_id"] = PLN[r["pln"]]["id"] if r.get("pln") else ""
for d in DIRS:
    d["pln_id"] = PLN[d["pln"]]["id"] if d.get("pln") else ""
    if d["pln_id"]:
        d["pln_ids"] = [d["pln_id"]]
empty_pln = [s for s, m in PLN.items() if not m["matched_req"] and not m["matched_dir"]]

# ------------------------------------------------------------------------------------------------ sources / findings / decisions
def short(s, n=160):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[:n - 1] + "…"

# findings: CONFLICT / UNREGISTERED / ELTÉRÉS notes
FIND = {}
def norm_note(s):
    return re.sub(r"\s+", " ", s.strip().lower())[:140]
def classify_conflict(t):
    tl = t.lower()
    if re.search(r"regiszter|ledger|nyilvántart|planned|missing|not_started|elavult|registry|docs/", tl):
        return "REGISTER_STALE"
    return "CODE_VS_DOC"
UNREG_RESOLVED = {}
reg_paths = {}
for cid, r in comps.items():
    for f in re.split(r";\s*", r["code_files"] or ""):
        if f.strip():
            reg_paths.setdefault(f.strip(), cid)
for p, cid in {**SRC_FILES, **CFG_FILES}.items():
    reg_paths.setdefault(p, cid)
def resolve_path(p):
    p = p.split("#")[0]
    if p in reg_paths:
        return reg_paths[p]
    if p.endswith("/"):
        cand = [c for f, c in reg_paths.items() if f.startswith(p)]
        if cand:
            return cand[0]
    return None
for d in DIRS:
    if not d["notes"]:
        continue
    parts = re.split(r"\s*;\s*(?=(?:CONFLICT|UNREGISTERED|ELTÉRÉS):)", d["notes"])
    for part in parts:
        m = re.match(r"(CONFLICT|UNREGISTERED|ELTÉRÉS):\s*(.*)", part, re.S)
        if not m:
            continue
        kind, txt = m.group(1), m.group(2).strip()
        key = kind + "|" + norm_note(txt)
        f = FIND.setdefault(key, {"kind": kind, "text": txt, "dirs": [], "comps": set()})
        f["dirs"].append(d["id"])
        f["comps"].update(d["components"])
FINDINGS = []
for key in sorted(FIND):
    f = FIND[key]
    sub = ""
    status = "OPEN"
    resolved = ""
    if f["kind"] == "CONFLICT":
        sub = classify_conflict(f["text"])
    elif f["kind"] == "ELTÉRÉS":
        sub = "STATUS_DIFF"; status = "RECORDED"
    else:
        sub = "UNREGISTERED_PATH"
        pm = re.match(r"([^\s;,]+)", f["text"])
        path = pm.group(1) if pm else f["text"]
        cid = resolve_path(path)
        if cid:
            status = "RESOLVED_BY_V2_REGISTRATION"; resolved = cid
        else:
            sub = "UNREGISTERED_PATH_OPEN"
    fid = alloc("FND", "fnd:" + hashlib.sha1(key.encode()).hexdigest()[:14], f["kind"] + ": " + short(f["text"], 100))
    FINDINGS.append(dict(id=fid, kind=f["kind"], subtype=sub, text=f["text"], status=status, resolved_by=resolved, dir_ids=sorted(set(f["dirs"])), component_ids=sorted(f["comps"]), wrk_ids=[]))

# decisions
DECISIONS = []
DEC_CL = [
    ("owner-key", r"kulcs|key", "Tulajdonosi kulcs (owner-key) kiadása / provisionálása és aláírt jóváhagyások"),
    ("egress", r"egress|host|hoszt", "Egress-policy és host/hoszt jóváhagyás aláírása"),
    ("model-enable", r"model_?enable|költségkeret|költés|költségvállal", "Modell-engedélyezés (MODEL_ENABLE) és költségkeret / költés jóváhagyása"),
    ("stripe-koho", r"stripe|koho", "Stripe / KOHO aktiválás engedélye"),
    ("windows", r"windows", "Windows-teszt / kézi Windows futtatás jóváhagyása"),
    ("voice", r"hangteszt|hang", "Hangteszt (TTS/STT) jóváhagyása"),
    ("computer-use", r"computer use", "Computer Use engedélyezése (minden következményes lépés)"),
    ("remote", r"távoli", "Távoli elérés engedélyezése"),
    ("tax", r"adószabály|adó", "Adószabályok / adószabály-forrás jóváhagyása"),
    ("commercial", r"kereskedelmi", "Kereskedelmi (licenc) modell döntése"),
    ("legacy", r"legacy", "Legacy fájlok sorsa"),
    ("source", r"forrás|adatszolgáltató|licenc", "Élő források / adatszolgáltató és licenc jóváhagyása"),
    ("policy", r"policy|szabály", "Tulajdonosi policy-döntések"),
]
dec_hits = collections.defaultdict(lambda: {"dirs": [], "texts": collections.Counter()})
other_hits = {"dirs": [], "texts": collections.Counter()}
for d in DIRS:
    od = (d["owner_decision"] or "").strip()
    if not od:
        continue
    low = od.lower()
    for k, rx, nm in DEC_CL:
        if re.search(rx, low):
            h = dec_hits[k]; h["dirs"].append(d["id"]); h["texts"][od[:100]] += 1
            break
    else:
        other_hits["dirs"].append(d["id"]); other_hits["texts"][od[:100]] += 1
for k, rx, nm in DEC_CL:
    if k in dec_hits:
        h = dec_hits[k]
        did = alloc("DEC", "dec:" + k, nm)
        DECISIONS.append(dict(id=did, key=k, name=nm, origin="DIRECTIVE_ASSESSMENT", detail="; ".join("%s (%d)" % (t, c) for t, c in h["texts"].most_common(6)), dir_ids=sorted(set(h["dirs"])), pln_ids=[], status="OPEN", wrk_ids=[]))
did = alloc("DEC", "dec:other-owner-decisions", "Egyéb tulajdonosi döntések (tételes lista a részletekben)")
DECISIONS.append(dict(id=did, key="other", name="Egyéb tulajdonosi döntések (tételes lista a részletekben)", origin="DIRECTIVE_ASSESSMENT",
                      detail="; ".join("%s (%d)" % (t, c) for t, c in other_hits["texts"].most_common(40)), dir_ids=sorted(set(other_hits["dirs"])), pln_ids=[], status="OPEN", wrk_ids=[]))
for slug, m in PLN.items():
    if m["owner"]:
        did = alloc("DEC", "dec:pln:" + slug, "Döntés: " + short(m["name"], 80))
        DECISIONS.append(dict(id=did, key="pln:" + slug, name="Döntés / jóváhagyás: " + short(m["name"], 100), origin="PLANNED_MODULE", detail=m["owner"], dir_ids=[], pln_ids=[m["id"]], status="OPEN", wrk_ids=[]))
        m["dec_id"] = did
# legacy runtime decision
did = alloc("DEC", "dec:legacy-runtime", "Döntés: a karanténba tett régi competition-v1 futtatókörnyezet sorsa (archiválás / eltávolítás / marad karanténban)")
DECISIONS.append(dict(id=did, key="legacy-runtime", name="A karanténba tett régi futtatókörnyezet (worker.js, supervisor.js, agent-child.js) sorsa", origin="V2_CORRECTION",
                      detail="A v1 leltár ezeket rendes elemnek vette; v2-ben LEGACY_QUARANTINED. Törlés/archiválás csak tulajdonosi döntéssel.", dir_ids=[], pln_ids=[], status="OPEN", wrk_ids=[]))
DEC_BY_KEY = {d["key"]: d for d in DECISIONS}

# ------------------------------------------------------------------------------------------------ work plan
WORK = []
WORK_BY_ID = {}
def new_work(origin, key, prio, title, work, comps_=(), pln=None, reqs_=(), dirs_=(), impl=0.0, ver=0.0, verify="", accept="", ext="", owner="", deps=(), deferred=False, finds=(), decs=()):
    wid = alloc("WRK", key, title)
    w = dict(id=wid, origin=origin, priority=prio, title=title, work=work, component_ids=list(dict.fromkeys(comps_)), pln_id=pln or "", requirement_ids=list(dict.fromkeys(reqs_)),
             directive_count=len(dirs_), directive_ids=list(dirs_), depends_on=list(dict.fromkeys(deps)), impl_h=round(float(impl), 2), ver_h=round(float(ver), 2),
             verify_method=verify, acceptance=accept, external=ext, owner_decision=owner, deferred=deferred, status="OPEN", finding_ids=list(finds), decision_ids=list(decs))
    w["total_h"] = round(w["impl_h"] + w["ver_h"], 2)
    WORK.append(w); WORK_BY_ID[wid] = w
    return w

DEFAULT_VERIFY = "célzott node --test (egység + integráció) + bekötés-ellenőrzés (integration matrix / UI-smoke / API-sweep); fixture-bizonyíték NEM élő bizonyíték"
DEFECT_H = {"D-01": (3, 2), "D-02": (3, 2), "D-03": (2, 2), "D-04": (12, 6), "D-05": (20, 10), "D-06": (3, 2), "D-07": (4, 2), "D-08": (2, 2), "D-09": (6, 3), "D-10": (2, 2), "D-11": (4, 2), "D-12": (12, 5)}
DEFECT_ACCEPT = {
 "D-01": "A Security & Supervision nézet hibamentesen megjelenik (UI-smoke), sv.notes objektum kezelve; regressziós teszt zöld.",
 "D-02": "Hibánál nem 200/ok:true; a UI hibát mutat; negatív teszt zöld.",
 "D-03": "durable-queue.ack idegen bérlőre elutasít; teszt.",
 "D-04": "Állapotmappa-zár/példányzár: két runtime nem bérelheti ugyanazt a feladatot; kétpéldányos teszt.",
 "D-05": "A ~25 közös tár zár vagy atomi írás mögött; párhuzamos-írás teszt, nincs utolsó-író-nyer.",
 "D-06": "A kanonikus runtime csak engedélyezett címen hallgat (konfigurálható), teszt; Railway-igény külön döntés.",
 "D-07": "Hang UI nyelvváltó a bemenet nyelvét is váltja; 'Jó reggelt' gomb hangot ad (hangteszt tulajdonosi).",
 "D-08": "A discoveryScheduler().tick() hívva van (tick-loop), teszt bizonyítja; élő forrás nélkül fixture.",
 "D-09": "Egyetlen karantén-tár vagy release/delete route jóváhagyással; teszt.",
 "D-10": "A teszt determinisztikus (nem időzítésérzékeny), 20 egymás utáni futás zöld.",
 "D-11": "A SEARCH kérés az aláírt egress-policy-n megy; teszt: policy nélkül elutasít.",
 "D-12": "central.snapshot források bekötve, vault auto-lock bekapcsolható, mentés titkosított opcióval; teszt."}
DEFECT_WORK = {
 "D-01": "app.js Security & Supervision nézet: az sv.notes objektumot (nem tömb) normalizálni/Object.entries-szel kezelni a .map hívás előtt; UI-smoke regressziós teszt mind a 61 nézetre. Fájlok: atlasz-control-center/public/app.js.",
 "D-02": "server.mjs/core.mjs: /api/updates/install és /api/plugins/enable hibaágon nem-2xx státusz és ok:false; app.js: hibás válasznál ne jelenjen meg 'done'; negatív route-tesztek.",
 "D-03": "durable-queue.ack: a bérlő (lease owner) ellenőrzése, idegen bérlő ack-jének elutasítása; negatív teszt.",
 "D-04": "Állapotmappa-zár (instance lock) a runtime indításakor (file-lock) + a master-coordinator/durable-queue bérlet védelme; kétpéldányos teszt.",
 "D-05": "A ~25 zár nélküli közös tár (business/store, knowledge-projects, personal-command-center, observation-memory stb.) írásainak zárolása vagy atomi cseréje (file-lock); párhuzamos-írás teszt.",
 "D-06": "supervisor-safe.mjs: a bind cím legyen konfigurálható (alapértelmezett loopback); a Railway-igény külön tulajdonosi döntés; teszt.",
 "D-07": "Hang UI: a nyelvváltó a felismerés (STT) nyelvét is állítsa; a 'Jó reggelt' gomb szólaltassa meg a köszöntést; UI-teszt (hangteszt tulajdonosi).",
 "D-08": "A tick-loop/supervisor hívja a discoveryScheduler().tick()-et; teszt: ütemezett felderítés fixture-forrással.",
 "D-09": "A két karantén-tár (quarantine, file-intake) egységesítése; release/delete route tulajdonosi jóváhagyással; teszt.",
 "D-10": "m5-verification-round2 teszt: időzítésfüggés megszüntetése (determinisztikus óra/várakozás); 20 egymás utáni zöld futás.",
 "D-11": "supervisor-safe.mjs: a SEARCH worker hn.algolia kérése az aláírt egress-policy-n (egress-policy) menjen át; policy nélkül tiltás; teszt.",
 "D-12": "central.snapshot források bekötése; vault auto-lock bekapcsolhatóvá tétele (alapérték tulajdonosi döntés); backup-recovery titkosított mentési opció; teszt."}
v1_cov = set()
v1_defect_work = {}
for i, w in enumerate(v1_work):
    cids = ids_in(w["component_ids"])
    title = w["title"]
    m = re.match(r"(D-\d\d):", title)
    if m and m.group(1) == "D-11":
        cids = [("ATL-OPS-0034" if c == "ATL-OPS-0036" else c) for c in cids]
    legacy_row = bool(cids) and all(c in LEGACY_COMPS for c in cids)
    n = 0
    mm = re.search(r"(\d+) kapcsolt követelmény", w["required_action"])
    if mm:
        n = int(mm.group(1))
    if m:
        impl, ver = DEFECT_H[m.group(1)]
        acc = DEFECT_ACCEPT[m.group(1)]
    elif title.startswith("Részleges"):
        impl, ver, acc = min(2 + 0.15 * n, 16), min(1 + 0.08 * n, 8), "A kapcsolt követelmények státusza a bizonyíték szerint javul; maradék külső függőség külön jelölve."
    elif title.startswith("Külső blokkoló"):
        impl, ver, acc = 3, 4, "Hitelesítő adat a vaultban, aláírt egress-policy, tulajdonosi engedély után élő próba lefutott és naplózva; előtte NEM állítható működőnek."
    elif title.startswith("Csak fake"):
        impl, ver, acc = 2, 3, "Valódi környezeti próba tulajdonosi engedéllyel; eredmény bizonyítékként rögzítve."
    elif title.startswith("Csak váz"):
        impl, ver, acc = 3, 2, "Bekötés + teszt kész, vagy tulajdonosi döntés a komponens sorsáról rögzítve."
    else:
        impl, ver, acc = 3, 1.5, "Közvetlen teszt írva és zöld."
    prio = w["priority"]
    work_txt = DEFECT_WORK[m.group(1)] if m else w["required_action"]
    if legacy_row:
        title = "Legacy-karantén (v2 javítás): " + title.split(": ", 1)[-1]
        work_txt = "A v1 'részleges' besorolás hibás volt: karanténba tett régi futtatókörnyezeti fájl. Tulajdonosi döntés: archiválás/eltávolítás vagy végleges karantén."
        impl, ver, acc = 1, 0.5, "Döntés rögzítve; a fájl nem szerepel a kanonikus futtatókörnyezetben."
        prio = "P3"
    wk = new_work("V1_WORKLIST", "wrk:v1:" + hashlib.sha1((w["title"] + "|" + w["component_ids"]).encode()).hexdigest()[:14], prio, title, work_txt, cids,
                  reqs_=re.findall(r"ATL-[A-Z]+-\d{4}", w["requirement_ids"]), impl=impl, ver=ver, verify=DEFAULT_VERIFY, accept=acc, ext=w["external_dependency"],
                  owner="tulajdonosi jóváhagyás a javításhoz (v1 szabály)" if prio in ("P0", "P1") else "")
    wk["v1_row"] = i + 1
    if m:
        v1_defect_work[m.group(1)] = wk
    for c in cids:
        v1_cov.add(c)
# defect dependencies (hand-set, acyclic)
def dep(a, b):
    if a in v1_defect_work and b in v1_defect_work:
        v1_defect_work[a]["depends_on"].append(v1_defect_work[b]["id"])
dep("D-04", "D-03"); dep("D-05", "D-04")
for w in v1_defect_work.values():
    if w["origin"] == "V1_WORKLIST":
        pass

# component-level tasks for non-verified components without a v1 task
HOURS_STATUS = {"NOT_YET_VERIFIED": (0.0, 1.5), "PARTIAL": (3.0, 1.5), "CONNECTED_UNTESTED": (1.0, 2.0), "STRUCTURAL_ONLY": (3.0, 2.0), "MISSING": (6.0, 3.0),
                "MOCK_ONLY": (2.0, 3.0), "EXTERNAL_BLOCKER": (3.0, 4.0), "BROKEN": (4.0, 2.0), "OWNER_APPROVAL_REQUIRED": (0.5, 0.5), "LEGACY_QUARANTINED": (1.0, 0.5)}
TITLE_STATUS = {"NOT_YET_VERIFIED": "Ellenőrzés", "PARTIAL": "Részleges", "CONNECTED_UNTESTED": "Bekötve, teszt hiányzik", "STRUCTURAL_ONLY": "Csak váz", "MISSING": "Hiányzó komponens",
                "MOCK_ONLY": "Csak fixture/mock", "EXTERNAL_BLOCKER": "Külső blokkoló", "BROKEN": "Hibás", "OWNER_APPROVAL_REQUIRED": "Tulajdonosi jóváhagyás szükséges", "LEGACY_QUARANTINED": "Karanténba tett legacy fájl"}
inherited_children = collections.defaultdict(list)
for cid, r in comps.items():
    if r.get("origin") == "V2_REGISTERED" and r["status_basis"].startswith("ÖRÖKÖLT"):
        inherited_children[r["related_component_ids"]].append(cid)
GROUPED = collections.defaultdict(list)
for cid, r in comps.items():
    st = r["status"]
    if st in ("VERIFIED_WORKING", "N/A") or cid in v1_cov:
        continue
    if r.get("origin") == "V2_REGISTERED" and r["status_basis"].startswith("ÖRÖKÖLT"):
        continue   # covered by the parent component task
    if r.get("origin") == "V2_REGISTERED" and r["kind"] == "DISCOVERY_SOURCE":
        GROUPED["disc"].append(cid); continue
    ih, vh = HOURS_STATUS.get(st, (2.0, 1.0))
    kids = inherited_children.get(cid, [])
    nm = r["name"]
    if st == "LEGACY_QUARANTINED":
        new_work("V2_CORRECTION", "wrk:v2:comp:" + r["natural_key"], "P3", "Legacy fájl sorsa: " + nm, "Tulajdonosi döntés után: archiválás/eltávolítás vagy végleges karantén; a policy-guards teszt őrzi a kizárást.",
                 [cid], impl=ih, ver=vh, verify="policy-guards teszt + git-történet ellenőrzés", accept="Döntés rögzítve; a fájl nem szerepel a kanonikus futtatókörnyezetben.", owner="legacy fájlok sorsa (DEC)", decs=[DEC_BY_KEY["legacy-runtime"]["id"]])
        continue
    prio = {"BROKEN": "P0", "STRUCTURAL_ONLY": "P2", "CONNECTED_UNTESTED": "P2", "MISSING": "P2", "NOT_YET_VERIFIED": "P3", "PARTIAL": "P3", "MOCK_ONLY": "P4", "EXTERNAL_BLOCKER": "P4", "OWNER_APPROVAL_REQUIRED": "P4"}.get(st, "P3")
    work = {"NOT_YET_VERIFIED": "Futtatható ellenőrzés vagy teszt készítése és lefuttatása; státusz a bizonyíték szerint frissítendő.",
            "PARTIAL": "Hiányzó funkciók pótlása és bekötés-ellenőrzés: " + short(r.get("missing_functions", ""), 160),
            "CONNECTED_UNTESTED": "Közvetlen teszt írása a már bekötött komponenshez.", "STRUCTURAL_ONLY": "Bekötés + teszt, vagy tulajdonosi döntés a komponens sorsáról.",
            "MISSING": "A hiányzó komponens megépítése/bekötése.", "MOCK_ONLY": "Valódi környezeti próba tulajdonosi engedéllyel.", "EXTERNAL_BLOCKER": "Hitelesítő adat/engedély után élő próba.",
            "BROKEN": "Hiba javítása és regressziós teszt.", "OWNER_APPROVAL_REQUIRED": "Tulajdonosi jóváhagyás beszerzése."}.get(st, "Munka a státusz szerint.")
    if kids:
        work += " (A komponens %d beágyazott elemét is érinti: menedzser/kapu/executor.)" % len(kids)
        ih += 0.25 * len(kids); vh += 0.25 * len(kids)
    new_work("V2_COMPONENT", "wrk:v2:comp:" + r["natural_key"], prio, "%s: %s" % (TITLE_STATUS.get(st, st), nm), work, [cid] + kids, impl=ih, ver=vh, verify=DEFAULT_VERIFY,
             accept="A komponens státusza a bizonyíték alapján legalább CONNECTED_TESTED/VERIFIED_WORKING (fixture szint) vagy a blokkoló külső függőség tételesen rögzítve.",
             ext=r.get("external_dependencies", "") if st in ("EXTERNAL_BLOCKER", "MOCK_ONLY") else "")
if GROUPED["disc"]:
    ids = GROUPED["disc"]
    new_work("V2_COMPONENT", "wrk:v2:disc-sources", "P3", "Felderítési forrás-leírók ellenőrzése (%d db)" % len(ids), "Mindegyik SOURCE_CATALOGUE leíróhoz leíró-szintű teszt (allowlist, formátum, blokkolási ok); élő olvasás csak jóváhagyással.",
             ids, impl=0.0, ver=0.4 * len(ids), verify="global-discovery teszt bővítése fixture-ekkel", accept="Mind a 19 leíró tesztelve; státusz a bizonyíték szerint.", ext="külső hálózat (élő olvasás tiltva)")

# PLN tasks
V1_BY_COMP = collections.defaultdict(list)
for w in WORK:
    for c in w["component_ids"]:
        V1_BY_COMP[c].append(w)
PLN_TASK = {}
for slug, m in PLN.items():
    kind = m["kind"]
    deferred = kind == "DEFERRED"
    prefix = {"NEW": "ÚJ MODUL", "EXTEND": "BŐVÍTÉS", "DEFERRED": "HALASZTOTT", "DECISION": "DÖNTÉS+ELŐKÉSZÍTÉS"}[kind]
    deps = []
    for c in m["rel_ids"]:
        for w in V1_BY_COMP.get(c, []):
            if w["origin"] == "V1_WORKLIST" and w["title"].startswith("D-") and w["priority"] in ("P0", "P1"):
                deps.append(w["id"])
    if m.get("dec_id"):
        pass
    phases = "terv/szerződés -> megépítés vagy bővítés -> bekötés (%s) -> teszt -> hibajavítás -> igazolt lezárás" % (m["wiring"] or "lásd kapcsolatok")
    reqs_ = m["matched_req"]
    w = new_work("V2_PLANNED_MODULE", "wrk:v2:pln:" + slug, "P5" if deferred else m["prio"], "%s: %s" % (prefix, short(m["name"], 150)), phases,
                 m["rel_ids"], pln=m["id"], reqs_=reqs_, dirs_=m["matched_dir"], impl=m["impl"], ver=m["ver"], verify=DEFAULT_VERIFY + ("; külső szolgáltatás csak jóváhagyással" if m["ext"] else ""),
                 accept=m["accept"], ext=m["ext"], owner=m["owner"], deps=deps, deferred=deferred, decs=[m["dec_id"]] if m.get("dec_id") else [])
    if deferred:
        w["note"] = "HALASZTOTT: nem aktivált, nem része az aktív órasummáknak; az órák tájékoztató becslések"
    PLN_TASK[slug] = w
    m["wrk_id"] = w["id"]
    if m.get("dec_id"):
        DEC_BY_KEY["pln:" + slug]["wrk_ids"].append(w["id"])
        w["depends_on"].append(DEC_BY_KEY["pln:" + slug]["id"])    # decision first

# decision-request tasks (small, owner-facing)
for dd in DECISIONS:
    if dd["origin"] == "PLANNED_MODULE":
        continue
    w = new_work("V2_DECISION", "wrk:v2:dec:" + dd["key"], "P4" if dd["key"] not in ("owner-key",) else "P2", "Tulajdonosi döntés előkészítése: " + short(dd["name"], 110),
                 "A döntés tételes összegyűjtése, kockázat/költség ismertetése a tulajdonosnak; döntés rögzítése. Részletek: " + short(dd["detail"], 300),
                 [], dirs_=dd["dir_ids"], impl=0.5, ver=0.0, verify="döntés rögzítve a history.jsonl-ben", accept="Írásos tulajdonosi döntés vagy elutasítás.", owner=dd["name"], decs=[dd["id"]])
    dd["wrk_ids"].append(w["id"])

# requirement gap tasks: requirement rows still uncovered
covered_comps = set()
def refresh_cov():
    covered_comps.clear()
    for w in WORK:
        covered_comps.update(w["component_ids"])
refresh_cov()
REQ_COMPS = {}
for rid, lst in REQ_LINKS.items():
    REQ_COMPS[rid] = [c for c, rel in lst if rel != "VERIFIED_BY_TEST" and comps.get(c, {}).get("category") != "TST"]
def row_needs_work(r):
    return r["status"] in NONVER and r["kind"] not in ("HEADING", "CONTEXT")
uncovered = collections.defaultdict(list)
for a, r in REQ.items():
    if row_needs_work(r) and not r["pln"] and not (set(REQ_COMPS.get(a, [])) & covered_comps):
        uncovered[(r["chapter"], r["status"])].append(a)
for (chap, st), lst in sorted(uncovered.items(), key=lambda x: (int(x[0][0]), x[0][1])):
    ih, vh = {"PARTIAL": (1.0, 0.5), "STRUCTURAL_ONLY": (1.5, 1.0), "EXTERNAL_BLOCKER": (1.0, 1.5), "MOCK_ONLY": (1.0, 1.5), "OWNER_APPROVAL_REQUIRED": (0.25, 0.25),
              "CONNECTED_UNTESTED": (0.25, 1.0), "NOT_YET_VERIFIED": (0.0, 0.75), "BROKEN": (3.0, 1.5), "MISSING": (4.0, 2.0)}[st]
    fixes = collections.Counter(short(REQ[a]["fix"], 110) for a in lst if REQ[a]["fix"] and REQ[a]["fix"] != "-")
    ext = "; ".join(sorted({REQ[a]["external"] for a in lst if REQ[a]["external"] and REQ[a]["external"] != "-"}))[:200]
    new_work("V2_REQ_GAP", "wrk:v2:reqgap:%s:%s" % (chap, st), "P4" if st in ("EXTERNAL_BLOCKER", "MOCK_ONLY", "OWNER_APPROVAL_REQUIRED") else "P3",
             "Követelmény-hiányok lezárása: %s. fejezet, %s (%d db)" % (chap, st, len(lst)), "Teendők (gyakoriság szerint): " + " | ".join("%s ×%d" % (t, n) for t, n in fixes.most_common(6)),
             [], reqs_=lst, impl=ih * len(lst), ver=vh * len(lst), verify=DEFAULT_VERIFY, accept="Mind a %d követelmény státusza a bizonyíték alapján frissítve; hiány esetén külön PLANNED modul jelölve." % len(lst), ext=ext)

# source-set (CAP / SIR) rows not covered
uncov_ss = collections.defaultdict(list)
refresh_cov()
for a, r in SRCSET.items():
    pre = a[4:7]
    cset = set(ids_in(r["component_ids"])) - {c for c in comps if comps[c]["category"] == "TST"}
    if r["status"] in NONVER and pre in ("CAP", "SIR") and not (cset & covered_comps):
        uncov_ss[(pre, r["status"])].append(a)
for (pre, st), lst in sorted(uncov_ss.items()):
    ih, vh = {"PARTIAL": (2.0, 1.0), "EXTERNAL_BLOCKER": (1.0, 2.0), "STRUCTURAL_ONLY": (3.0, 2.0)}.get(st, (2.0, 1.0))
    new_work("V2_REQ_GAP", "wrk:v2:ssgap:%s:%s" % (pre, st), "P3" if st != "EXTERNAL_BLOCKER" else "P4", "%s tételek lezárása (%s, %d db)" % ("Eredeti 85 képesség" if pre == "CAP" else "23 biztonsági/infra követelmény", st, len(lst)),
             "Tételenkénti hiányok pótlása a source_sets mátrix 'missing' oszlopa szerint.", [], reqs_=lst, impl=ih * len(lst), ver=vh * len(lst), verify=DEFAULT_VERIFY, accept="Tételek státusza a bizonyíték szerint.")

# FUT (150 ideas) -> deferred idea backlog (not activated)
for a, r in sorted(SRCSET.items()):
    if a.startswith("ATL-FUT") and r["status"] != "VERIFIED_WORKING":
        ih, vh = {"PARTIAL": (4.0, 2.0), "STRUCTURAL_ONLY": (8.0, 3.0), "MISSING": (16.0, 6.0), "EXTERNAL_BLOCKER": (3.0, 4.0)}.get(r["status"], (4.0, 2.0))
        w = new_work("V2_DEFERRED_IDEA", "wrk:v2:fut:" + a, "P5", "Halasztott ötlet: %s (%s)" % (r["name"], r["status"]), "Csak a tulajdonos külön döntése után: " + short(r["missing"], 200),
                     ids_in(r["component_ids"]), reqs_=[a], impl=ih, ver=vh, verify=DEFAULT_VERIFY, accept="Nincs aktiválás a tulajdonosi döntésig.", ext=r["external"], deferred=True)
        w["note"] = "HALASZTOTT ÖTLET (150-es lista): nem aktivált; órák tájékoztató becslések"

# findings: bulk tasks
for sub, title, hrs in (("REGISTER_STALE", "Nyilvántartás/dokumentáció ↔ kód ellentmondások feloldása (elavult V7.3/ledger sorok frissítése)", 0.25),
                        ("CODE_VS_DOC", "Kód ↔ dokumentáció ellentmondások egyenkénti feloldása", 0.75), ("UNREGISTERED_PATH_OPEN", "Nem nyilvántartott útvonalak felvétele a leltárba", 0.25)):
    fl = [f for f in FINDINGS if f["subtype"] == sub]
    if fl:
        w = new_work("V2_FINDING", "wrk:v2:fnd:" + sub, "P3", title + " (%d db)" % len(fl), "Minden megállapítás (ATL-FND) külön ellenőrzendő és lezárandó; a leltár változásnaplóval frissül.",
                     sorted({c for f in fl for c in f["component_ids"]}), dirs_=sorted({d for f in fl for d in f["dir_ids"]})[:50], impl=hrs * len(fl), ver=0.0, verify="egyenkénti ellenőrzés + regisztrált változásnapló", accept="Mindegyik FND lezárva (RESOLVED) vagy tulajdonosi döntésre átadva.", finds=[f["id"] for f in fl])
        for f in fl:
            f["wrk_ids"].append(w["id"])
# final zero-tolerance task
active = [w for w in WORK if not w["deferred"]]
new_work("V2_FINAL", "wrk:v2:final-zero-tolerance", "P3", "VÉGSŐ teljes rendszervizsgálat (ZERO TOLERANCE elfogadás)", "A tulajdonos által jóváhagyott fejlesztések végén teljes újra-ellenőrzés: minden ATL-elem, követelmény, biztonsági és működési hiba.",
         [], impl=0, ver=40, verify="teljes gate + UI-smoke + API-sweep + követelmény-újraellenőrzés + független ellenőr", accept="Nincs megoldatlan ismert működési vagy biztonsági hiba (ZERO TOLERANCE); a státuszok bizonyíték-alapúak.",
         deps=["ALL_ACTIVE_TASKS"])
new_work("V2_FINAL", "wrk:v2:inventory-maintenance", "P3", "Leltár-karbantartás minden lezárt modul után (history.jsonl, státusz, kapcsolatok)", "Modulonként: állapot-frissítés, változásnapló, kapcsolatok újraellenőrzése, duplikált/elveszett azonosító vizsgálat.",
         [], impl=0, ver=1.0 * len([m for m in PLN.values() if m["kind"] != "DEFERRED"]), verify="docs/system_inventory/validate (build + ellenőrzés)", accept="A validáció hibamentes.")

# map work ids back
WORK_BY_PLN = {w["pln_id"]: w for w in WORK if w["pln_id"]}
exec(open(os.path.join(OUT, "build_part3.py"), encoding="utf-8").read())
