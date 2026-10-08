#!/usr/bin/env python3
"""Task 3 roadmap + reconciliation generator (reproducible). Inputs: registry JSON, docs/audit/item_audit.json, capability audit JSON, master gap register CSV.
Outputs: docs/audit/open_items_detail.csv (one row per registry row), docs/audit/reconciliation.json, docs/audit/roadmap.json.  The markdown reports are rendered from these by docs/audit/render_reports.py."""
import json, csv, re, os
from collections import Counter, defaultdict
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
J = lambda p: json.load(open(os.path.join(root, p), encoding="utf-8"))
reg = J("docs/atlasz_v73_requirement_registry.json")["requirements"]; ia = {r["id"]: r for r in J("docs/audit/item_audit.json")}; cap = J("docs/atlasz_capability_audit_85.json")["capabilities"]
gaps = list(csv.DictReader(open(os.path.join(root, "docs/atlasz_master_gap_register.csv"), encoding="utf-8")))
LABELS = {"MISSING", "PARTIAL", "BROKEN", "EXISTS_AND_WORKING", "DEFERRED_BY_OWNER", "BLOCKED_AWAITING_JOCI_APPROVAL", "EXTERNAL_BLOCKER", "STRUCTURAL_ONLY", "EXISTS_NEEDS_TEST"}
PROCESS_SECTIONS = {42, 43, 44, 50}
def kind(x):
    i = x["id"]
    if x["level"] == "section": return "SECTION_ROLLUP"
    if i.startswith("ATLASZ-PKG84"): return "IMPLEMENTATION_RECORD"
    if x["title"].strip().rstrip(";") in LABELS: return "STATUS_LABEL"
    if i.startswith("V73-") and x["section"] in PROCESS_SECTIONS: return "PROCESS_OR_AUDIT_TASK"
    if i.startswith("V73-"): return "PRODUCT_REQUIREMENT"
    return "SUPPLEMENTARY_REQUIREMENT"
CLASS = {"EXISTS_AND_WORKING": "IMPLEMENTED", "PARTIAL": "PARTIAL", "STRUCTURAL_ONLY": "PARTIAL", "EXISTS_NEEDS_TEST": "PARTIAL", "MISSING": "MISSING", "EXTERNAL_BLOCKER": "EXTERNALLY_BLOCKED", "BLOCKED_AWAITING_JOCI_APPROVAL": "AWAITING_OWNER_APPROVAL"}
# ---- milestones (execution order is the order of this list; deps name earlier or parallel milestones)
MS = [
 ("M1", "Safety & reliability baseline", [], "Fix the unauthenticated runtime dashboard, close recovery/reliability/audit gaps, remove status-language gaps. Everything later depends on this.",
  "Runtime HTTP server serves only a minimal /health without a token; all other routes need the owner token or are removed; negative tests prove it. Backup/restore/LKG drills pass on a clean data dir; audit chains verify; every reliability item has a test that fails when the guard is removed (mutation).", "none"),
 ("M2", "Agent runtime integration (30 agents, Brain, tools)", ["M1"], "Make the governed dispatch able to run typed tools (kp/research/sandbox/obs/media/model) for the 30 agents through the Security Brain and control chain; connect or retire the 32 hub-bag-only modules and the duplicates; complete orchestrator, judge/QA/guardrails, digital twin, watchdog, queue items.",
  "An end-to-end job (SANDBOX) is planned by the Brain, executed by a named agent via at least 3 typed tools, judged by the independent QA, logged to the Black Box and visible in the Control Center; the 30-agent roster is unchanged; each hub-bag module is invoked by a workflow or removed; no duplicate implementation remains for qualify/approval-gateway/deal-state.", "model provider only for non-mock reasoning (EXTERNAL)"),
 ("M3", "Knowledge, memory and documents", ["M2"], "Finish Document Center, Document Intelligence, memory/learning and knowledge items on top of Knowledge Projects, Research Ledger and Observation Memory.",
  "Every ingest format has an extractor test with hostile samples; permission-aware search covered by cross-tenant tests; memory/learning items have retention, correction and deletion tests; OCR remains an external slot.", "OCR/embeddings providers (EXTERNAL)"),
 ("M4", "Money & business workflow (no real money)", ["M2", "M3"], "Wire deal, proposal, delivery, invoice, profit, tax/accounting, inbox and follow-up modules into one SANDBOX workflow with evidence gates; keep SENT/PAID/DELIVERED distinct.",
  "A SANDBOX deal runs lead>proposal>delivery>invoice>payment-claim with owner approvals and independent verification; no state can advance without typed evidence; unknown revenue is never zero; Control Center money panels read the persisted state; LIVE adapters stay absent.", "bank/email/payment providers and owner decisions (EXTERNAL / OWNER)"),
 ("M5", "Models, multimodal and live voice providers", ["M2"], "Provider-backed model routing, STT/TTS/OCR/vision slots, multimodal generation. Mock-first; live only after owner-approved provider + own probe.",
  "Each slot has a probe that can only pass against a real endpoint; mocks are labelled; cost estimate + approval flow exists; with no provider every slot reports NOT_CONNECTED.", "ALL providers EXTERNAL; spending needs owner approval"),
 ("M6", "Tools, connectors, computer use and office/web automation", ["M2", "M1"], "Tool fabric completion, connector catalogue, governed computer-use and browser, office automation, web operations, location intelligence.",
  "Every tool has a typed schema, owner-authority class and a negative test; computer-use actions are AUTO/ASK/FORBIDDEN-enforced in a sandbox; connectors report NOT_CONNECTED until a probe passes.", "browser host, credentials (EXTERNAL)"),
 ("M7", "Personal ATLASZ, Human Core, modes and mobile", ["M2", "M3"], "Personal layer, emotional/human impact items, operating modes, mobile control.",
  "Each mode changes behaviour only through the control chain; human-impact verdicts shown on approval cards; mobile control is read/approve-only behind strong auth.", "mobile client (EXTERNAL)"),
 ("M8", "Windows desktop / Control Center completion", ["M1"], "Complete the Control Center panels, plugins/skins, update centre and the desktop shell acceptance items. Windows evidence needs a Windows host and an approved installer build.",
  "Every panel has a route test and a UI smoke; plugin permission tests pass; installer evidence recorded from a real Windows run (owner-approved build).", "Windows machine, installer build approval, code signing (EXTERNAL/OWNER)"),
 ("M9", "Intelligence, performance and software/automation factories", ["M2", "M3", "M6"], "Market/opportunity intelligence, performance engine, technology watch, software factory.",
  "Intelligence outputs carry source+retrievedAt and an ASSUMPTION/VERIFIED label; performance metrics come from measured data only; factories produce artifacts only inside the sandbox.", "web/search providers (EXTERNAL)"),
 ("M10", "Process, registry, acceptance and commercial track", ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"], "Close process/acceptance items last: registry fields, audit-task items, acceptance criteria, prohibitions, commercial plan.",
  "Registry integrity tests green; every acceptance criterion maps to evidence; commercial/licensing stays OWNER_DECISION until Joci authorises.", "owner decisions"),
]
SEC = {2: "M1", 14: "M1", 34: "M1", 36: "M1", 37: "M1", 51: "M1", 52: "M1", 3: "M2", 9: "M2", 10: "M2", 15: "M2", 16: "M2", 17: "M2", 7: "M3", 23: "M3", 24: "M3", 11: "M4", 13: "M4", 25: "M4", 27: "M4",
       5: "M5", 8: "M5", 28: "M5", 18: "M6", 19: "M6", 20: "M6", 26: "M6", 30: "M6", 32: "M6", 4: "M7", 6: "M7", 38: "M7", 39: "M7", 21: "M8", 22: "M8", 46: "M8", 29: "M9", 31: "M9", 33: "M9", 40: "M9",
       0: "M10", 1: "M10", 45: "M10", 12: "M10", 35: "M10", 41: "M10", 42: "M10", 43: "M10", 44: "M10", 47: "M10", 48: "M10", 49: "M10", 50: "M10"}
PKG = {"003": "M1", "004": "M2", "007": "M4", "008": "M4", "010": "M4", "011": "M4", "014": "M4", "015": "M8", "016": "M1", "018": "M3", "019": "M3", "020": "M7", "021": "M2", "022": "M2", "023": "M7", "024": "M5",
       "025": "M10", "026": "M3", "027": "M3", "028": "M6", "029": "M5", "030": "M3", "031": "M5"}
PFX = {"ATLASZ-T3": "T3", "ATLASZ-SV": "M1", "ATLASZ-REG": "M10", "ATLASZ-BR": "M2", "ATLASZ-OSC": "M1", "ATLASZ-UC": "M8", "ATLASZ-CR": "M8", "ATLASZ-CC": "M8"}
T3 = {"001": "M1", "002": "M1", "003": "M2", "004": "M2", "005": "M1", "006": "M8", "007": "M8", "008": "M8", "009": "M4"}
def milestone(x):
    i = x["id"]
    if i.startswith("ATLASZ-T3-"): return T3[i[-3:]]
    if i.startswith("ATLASZ-PKG84-"): return PKG.get(i[-3:], "M10")
    for p, m in PFX.items():
        if i.startswith(p): return m
    return SEC.get(x["section"], "UNASSIGNED")
EXT = re.compile(r"provider|credential|\bAPI\b|Railway|Windows|installer|Electron|STT|TTS|OCR|vision|embedding|bank|PayPal|email provider|SMS|SMTP|IMAP|domain|DNS|hosting|certificate|code.?sign|mobile|camera|microphone", re.I)
OWN = re.compile(r"JOCI|owner (decision|approval)|spend|contract|deploy|production|legal|accountant|sign", re.I)
rows = []; mcount = defaultdict(Counter)
for x in reg:
    a = ia.get(x["id"], {}); k = kind(x); cl = CLASS[x["status"]]; m = milestone(x)
    wc = a.get("work_categories") or []
    txt = " ".join([x.get("blocker") or "", " ".join(x.get("evidence") or [])])
    need_code = "BUILD from scratch (no implementation found)" if x["status"] == "MISSING" else ("Complete: " + ((x.get("blocker") or "see evidence")[:160]) if "CODE_COMPLETION" in wc or x["status"] in ("PARTIAL", "STRUCTURAL_ONLY") else "")
    need_int = "Connect to a runtime workflow / Control Center (module is " + (a.get("invocation") or "unknown") + ", reach " + (a.get("reach") or "NONE") + ")" if "INTEGRATION" in wc or a.get("flags") else ""
    need_sec = "Security review: screening, permission, audit, negative tests" if "SECURITY_REVIEW" in wc else ""
    need_tests = ("Add tests (none pass for this item)" if "TESTS" in wc else "Extend with negative + mutation tests") if cl != "IMPLEMENTED" else ""
    ext = "YES: " + (x.get("blocker") or "")[:120] if (cl == "EXTERNALLY_BLOCKED" or (EXT.search(x.get("blocker") or "") and cl != "IMPLEMENTED")) else ""
    own = "YES" if (cl == "AWAITING_OWNER_APPROVAL" or OWN.search(x.get("blocker") or "")) and cl != "IMPLEMENTED" else ""
    rows.append(dict(id=x["id"], level=x["level"], kind=k, section=x["section"], title=x["title"][:140], registry_status=x["status"], final_class=cl, live_verified="NO", priority=x.get("priority_proposed"), milestone=m,
        verification_level=a.get("verification_level", ""), flags="|".join(a.get("flags") or []), required_code=need_code, required_integration=need_int, required_security=need_sec, required_tests=need_tests,
        external_dependency=ext, owner_approval=own, current_location=(x.get("implementation_location") or "")[:160], tests_passing="|".join(a.get("tests_passing") or []), evidence=((x.get("evidence") or [""])[0])[:200]))
    if k in ("PRODUCT_REQUIREMENT", "SUPPLEMENTARY_REQUIREMENT"): mcount[m][cl] += 1
with open(os.path.join(root, "docs/audit/open_items_detail.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
# ---- reconciliation
items = [r for r in rows if r["level"] == "item"]
byk = Counter((r["kind"], r["final_class"]) for r in items); kinds = Counter(r["kind"] for r in rows)
open_items = [r for r in items if r["final_class"] != "IMPLEMENTED"]
gcount = Counter(g["source"] for g in gaps)
linked = [c for c in cap if c["status"] != "VERIFIED_WORKING" and c["registry_links"]]; unlinked = [c["id"] for c in cap if c["status"] != "VERIFIED_WORKING" and not c["registry_links"]]
reg_ids = {r["id"] for r in rows}
dangling = sorted({l for c in cap for l in c["registry_links"] if l not in reg_ids})
overlap_open = Counter(r["kind"] for r in open_items)
rec = dict(registry_rows=len(rows), by_level=Counter(r["level"] for r in rows), by_kind=kinds, items_by_class=Counter(r["final_class"] for r in items), by_kind_class={f"{k}|{c}": n for (k, c), n in byk.items()},
    registry_status_all=Counter(r["registry_status"] for r in rows), registry_status_items=Counter(r["registry_status"] for r in items), open_items=len(open_items), open_items_by_kind=overlap_open,
    unique_open_requirements=overlap_open["PRODUCT_REQUIREMENT"] + overlap_open["SUPPLEMENTARY_REQUIREMENT"], capability=Counter(c["status"] for c in cap), capability_open=sum(1 for c in cap if c["status"] != "VERIFIED_WORKING"),
    capability_open_linked_to_registry=len(linked), capability_open_without_link=unlinked, capability_dangling_links=dangling, gap_register_total=len(gaps), gap_register_by_source=gcount,
    gap_register_formula=f"{gcount['REGISTRY']} registry item gaps + {gcount['CAPABILITY_85']} open capabilities + {gcount['IMPORT_SCAN']} import-scan orphans (+ {sum(v for k,v in gcount.items() if k not in ('REGISTRY','CAPABILITY_85','IMPORT_SCAN'))} other scans)",
    milestone_counts={m: dict(c) for m, c in mcount.items()}, unassigned=[r["id"] for r in rows if r["milestone"] == "UNASSIGNED"])
json.dump(rec, open(os.path.join(root, "docs/audit/reconciliation.json"), "w"), indent=1, default=dict)
json.dump([dict(id=i, name=n, depends_on=d, scope=s, acceptance=ac, gates=g, open_requirements=dict(mcount[i])) for i, n, d, s, ac, g in MS], open(os.path.join(root, "docs/audit/roadmap.json"), "w"), indent=1)
print(json.dumps(rec, indent=1, default=dict)[:3800])
