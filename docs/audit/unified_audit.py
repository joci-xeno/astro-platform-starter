"""Unified 85 + 23 + 150 + Global Business audit. READ-ONLY planning generator: it reads the 85-capability registry and the hand-written mapping
(pkg150_map.txt) and writes docs/ATLASZ_V73_UNIFIED_AUDIT.md + docs/audit/pkg150_traceability.csv. It changes no registry status and no source code."""
import csv, json, os, collections
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(H)
reg = {r['id']: r for r in csv.DictReader(open(os.path.join(D, 'atlasz_capability_audit_85.csv'), encoding='utf-8'))}
src = {o['id']: o for o in json.load(open(os.path.join(H, 'pkg150_source_ids.json'), encoding='utf-8'))}
CL = {'C': 'COVERED_BY_VERIFIED_85', 'P': 'PARTIAL', 'M': 'MISSING', 'E': 'EXTERNAL_BLOCKER'}
EV = {'R': 'REGISTRY-TESTED (existing tests with fakes/sandbox; not re-run for this item)', 'S': 'SOURCE-INSPECTION ONLY', 'N': 'NOTHING EXISTS'}
rows = []
for l in open(os.path.join(H, 'pkg150_map.txt'), encoding='utf-8'):
    if l.startswith('#') or not l.strip(): continue
    i, c, e, mods, r85, p23, gb, note = l.rstrip('\n').split('|')
    assert i in src, i
    for x in r85.split(','):
        assert x == '-' or x in reg, (i, x)
    rows.append(dict(id=i, ns='PKG150-' + i, group=src[i]['group'], gname=src[i]['group_name'], desc=src[i]['desc'], cls=CL[c], ev=EV[e], evc=e, mods=mods, r85=r85, p23=p23, gb=gb, note=note))
assert len(rows) == 150 and {r['id'] for r in rows} == set(src)
with open(os.path.join(H, 'pkg150_traceability.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['namespaced_id', 'source_id', 'group', 'description', 'class', 'evidence_level', 'existing_modules', 'registry85_refs', 'p23_refs', 'global_business_refs', 'later_work_or_external_dependency'])
    for r in rows: w.writerow([r['ns'], r['id'], r['gname'], r['desc'], r['cls'], r['ev'], r['mods'], r['r85'], r['p23'], r['gb'], r['note']])
cnt = collections.Counter(r['cls'] for r in rows); evc = collections.Counter(r['evc'] for r in rows)
c85 = collections.Counter(r['final_status'] for r in reg.values())
# reverse index 85 -> 150
rev = collections.defaultdict(list)
for r in rows:
    for x in r['r85'].split(','):
        if x != '-': rev[x].append(r['ns'].replace('PKG150-', ''))
p23 = {1: ('API Key Vault', 'PARTIAL', 'secret-vault, owner-keystore', 'backup package + passphrase, auto-lock, rotation, credential broker'),
 2: ('Malware/ransomware defense', 'MISSING', 'restricted-node, code-sandbox, inbox security screen', 'quarantine, scanner, archive limits, ransomware monitoring (environment discovery first)'),
 3: ('Exfiltration/intrusion prevention', 'PARTIAL', 'secret-patterns, brain/security-brain, guardrail-engine, agent-tool-broker', 'per-provider egress allowlist, commit leak gate'),
 4: ('AI Models dashboard (13 providers)', 'PARTIAL', 'model-gateway, Control Center models view', '13 provider cards; no provider LIVE'),
 5: ('Multi-model routing', 'PARTIAL', 'cost-model-router, provider-resilience, model-gateway, brain/model-intelligence', 'duplicate-billing guard, live comparison data'),
 6: ('Local AI manager (Ollama)', 'MISSING', '-', 'hardware discovery, approved install'),
 7: ('Chat providers center (15)', 'MISSING', 'universal-inbox, inbox-pipeline, connector-catalog', 'official-API adapters only; unofficial routes stay unavailable'),
 8: ('Markdown memory', 'PARTIAL', 'project-memory, brain/memory-fabric, knowledge-projects', 'MEMORY.md / daily file layout, versioning'),
 9: ('SQLite FTS5', 'MISSING', 'knowledge-projects (own BM25)', 'new dependency (evaluate only)'),
 10: ('Local semantic/hybrid search', 'MISSING', 'enterprise-knowledge-agentic-rag (structure)', 'local embeddings + vector index'),
 11: ('Central coordinator/delegation', 'PARTIAL', 'master-planner-orchestrator, brain/orchestrator, agent-tool-broker', 'M04 PARTIAL'),
 12: ('Scheduled background work', 'COVERED (C12 VERIFIED_WORKING)', 'scheduler', 'mail/calendar monitoring needs connectors'),
 13: ('Proactive goal-based work', 'PARTIAL', 'suggestions, master-brief, human-core', 'goal-to-plan generation'),
 14: ('Maker-checker', 'PARTIAL', 'business/judge, qa-reviewer, anti-collusion-guard, brain/verifier', 'enforced per capability'),
 15: ('Secure shared workspace', 'PARTIAL', 'tenant-isolation, shared-project-registry', 'project ACL, modification audit'),
 16: ('Agent-to-agent messaging', 'MISSING', 'handoff-ledger (hand-offs only)', 'messaging with loop limits'),
 17: ('Permanent + temporary agents', 'PARTIAL', 'fixed 30 roster, agent-factory (owner-gated)', 'temporary sub-agents; must not enlarge the 30'),
 18: ('Dynamic model assignment', 'PARTIAL', 'brain/model-intelligence, cost-model-router', 'per-agent table'),
 19: ('Network/system hardening', 'PARTIAL', 'Control Center binds 127.0.0.1; owner-auth', 'Railway config unchanged by order; investigate exposure/auth first'),
 20: ('Unified Control Center', 'PARTIAL', 'atlasz-control-center', 'Vault, Chat, Local models, Security panels; mobile'),
 21: ('Autonomous problem solving', 'PARTIAL', 'self-healing-loop, stall-replanner, system-doctor', 'root-cause automation'),
 22: ('E2E testing', 'PARTIAL', '1090 tests, 52 probes, mutation method', 'security gates 1-12 as a named suite'),
 23: ('Safe self-maintenance', 'PARTIAL', 'update-center, local-update-adapters', 'source signing; production steps owner-gated')}
gbmap = [('§2 Worldwide discovery', 'PARTIAL', 'brain/search-pipeline, market-intelligence-engine, tech-watch', 'source adapters, eligibility model; needs source allowlist'),
 ('§3 Company/organization intelligence', 'MISSING', 'brain/search-pipeline (VERIFY SOURCE step), unified-entity-graph, business/entity-graph', 'record store with provenance/confidence'),
 ('§4 30-agent distribution', 'PARTIAL', 'supervisor-safe 5+25, master-planner-orchestrator, agent-portfolio-manager', 'dynamic assignment by reliability'),
 ('§5 Commercial scoring', 'PARTIAL', 'opportunity-qualification-engine, money-supervisor, brain/opportunity-intelligence', 'win-probability and payment-risk data'),
 ('§6 End-to-end execution', 'PARTIAL', 'money-pipeline-controller, business/job-system, delivery-engine, invoice-engine, profit-ledger', 'no real payment rail; cycle unproven'),
 ('§7 Model evolution (A/B/C)', 'PARTIAL', 'brain/model-intelligence, model-gateway, provider-resilience', 'discovery, candidates, benchmarks, policy, rollback. NOT before the 85 (owner order)'),
 ('§8 Learning', 'PARTIAL', 'experience-learning-engine, brain/memory-fabric, agent-portfolio-manager', 'source/model performance aggregation'),
 ('§9 Security & owner authority', 'COVERED (C13 VERIFIED_WORKING) + 23-point gaps', 'owner-control/*, brain/security-brain', 'Fortress package not in repo'),
 ('§10 Module architecture', 'PARTIAL', 'capability-registry, plugin-manager, internal-integration-hub', 'versioned contracts, flags'),
 ('§11 Dashboard', 'PARTIAL', 'atlasz-control-center', 'model/opportunity/target panels; live-vs-simulated labels'),
 ('§12 Independent verification', 'PARTIAL', 'docs/audit/*, 52 probes, mutgen method', 'owner confirmation needed for VERIFIED'),
 ('Revenue Persistence Engine', 'PARTIAL', 'scheduler, checkpoint-engine, stall-replanner, money-supervisor', 'pipeline replenishment, failover, multi-day carry-over, target ledger (verified collected only)')]
groups = collections.defaultdict(list)
for r in rows: groups[r['group']].append(r)
dups = [('Code review', ['OP04', 'SN07', 'S507', 'O515'], 'P07 / code-review / qa-reviewer: build once'),
 ('Checkpoint & resume', ['S08', 'GE03', 'GE14', 'O514', 'S04'], 'P08 / P05 / checkpoint-engine / recovery'),
 ('Cost & effort routing', ['S07', 'GE09', 'HK04', 'HK13', 'AS15'], 'C10 / G13 / cost-model-router / model-intelligence'),
 ('Website comparison & monitoring', ['MR07', 'MR12', 'MR15', 'MR11'], 'P13 / page-ingest / text-compare / tech-watch'),
 ('Debugging & repair', ['S03', 'SN02', 'S506', 'S501', 'SN01'], 'C01 / self-healing-loop; all depend on a missing code-edit workflow'),
 ('Research quality & citations', ['AS04', 'AS12', 'GR05', 'GR11', 'MR05', 'O512', 'OP14'], 'M08 / C08 / research-ledger'),
 ('Contract analysis', ['OP09', 'O510'], 'one clause-analysis module'),
 ('Root-cause / diagnostics', ['AS13', 'OP12', 'O511'], 'system-doctor / black-box'),
 ('Independent verification & acceptance', ['AS02', 'O503', 'O505', 'O515', 'OP13'], 'P10 / judge / R6 method'),
 ('Parallel / delegated agents', ['GE02', 'OP15', 'SN14', 'S510', 'S15'], 'C03 / master-planner / broker (30 agents)'),
 ('Data cleaning & extraction', ['S12', 'HK03', 'HK10', 'SN09', 'SN04', 'SN13'], 'M07 analyst'),
 ('Computer / browser operation', ['S01', 'S13', 'GE12', 'MR10', 'HK14'], 'C04 / GE06 / M01 blocked'),
 ('Market & social signals', ['GR02', 'GR03', 'GR04', 'GR09', 'GR10', 'GR12'], 'G01 / P09 / market-intelligence-engine + Global Business §2'),
 ('Image / video / voice providers', ['GR06', 'GR07', 'GR13', 'GR14', 'GE08'], 'G08-G11 / GE03 provider-blocked'),
 ('Architecture / change analysis', ['S10', 'OP03', 'OP08', 'O509', 'O501'], 'repo-analyzer / digital-twin')]
L = []
A = L.append
A('# ATLASZ V7.3 — Unified 85 + 23 + 150 + Global Business Capability Audit\n')
A('**READ-ONLY audit and integration analysis** (owner authorization: audit only; this is NOT the 150-capability development phase and the activation phrase was not given). No code, registry status, dependency, agent, deployment or credential was changed. Generated by `docs/audit/unified_audit.py` from `pkg150_map.txt` (hand-made mapping) and the 85-capability registry.\n')
A('## 1. Executive summary\n')
A(f'- 150 source items audited one by one (10 groups x 15); original identifiers preserved in `docs/audit/pkg150_source_ids.json`; cross-package references use `PKG150-<id>`.')
A(f'- Result: **{cnt["COVERED_BY_VERIFIED_85"]} covered by a registry item that is already VERIFIED_WORKING, {cnt["PARTIAL"]} partial, {cnt["MISSING"]} missing, {cnt["EXTERNAL_BLOCKER"]} external blocker** (sum {sum(cnt.values())}).')
A(f'- Evidence levels: {evc["R"]} items map to modules that registry items cite with existing tests (fakes/sandbox, **not re-run for this audit**); {evc["S"]} rest on source inspection only; {evc["N"]} have nothing in the repository.')
A(f'- 85 original capabilities unchanged: {c85["VERIFIED_WORKING"]} VERIFIED_WORKING / {c85["PARTIAL"]} PARTIAL / {c85["MISSING"]} MISSING / {c85["EXTERNAL_BLOCKER"]} EXTERNAL_BLOCKER. Nothing here promotes a status.')
A('- 23-point package (23 items): 1 covered by a verified registry item (12 Scheduled work), 16 partial, 6 missing (2 malware defense, 6 Ollama, 7 chat providers, 9 FTS5, 10 semantic search, 16 agent messaging). Global Business package: see section 7.')
A('- **Nothing in the 150 is LIVE.** No live model provider, source, browser, voice, vision or payment rail is connected. "Covered" means only that a registry capability already VERIFIED by independent rounds addresses it within its tested scope; it is still sandbox/fake-provider evidence.')
A('- Many of the 150 are duplicates or near-duplicates of each other and of the 85 (section 6). The real number of distinct missing building blocks is far smaller than the count of missing rows.\n')
A('### Evidence limits (read this before relying on any row)\n')
A('1. This audit is **source inspection plus registry lookup**. No test, probe or mutation run was executed for any of the 150 items. The last real test run (1090/1090, 52/52 probes) covers the existing code, not these requirements.\n2. Classification rules: C = a VERIFIED_WORKING registry item covers it; P = something of the capability itself exists; M = nothing of the capability itself exists (prerequisites may); E = its core needs a live provider, data source, hardware or approval that is not connected and no deterministic implementation exists.\n3. Judgement calls are mine and reviewable: the CSV lists modules and the rule behind each row. Module headers were read for the main modules; for others only the name/grep hits were used (marked S).\n4. Vendor attributions in the 150 titles (GPT, Claude, Merlin, Grok, Gemini) are the owner\'s idea labels; no vendor feature claim is verified or relied on.\n5. Registry rule stands: a registry entry is not proof; VERIFIED_WORKING needs independent evidence and the owner\'s confirmation.\n')
A('## 2. Identifier conflicts and namespacing\n')
A('- The 150 package uses `GE01`-`GE15` (Gemini group). The 85-capability registry already has `GE01`-`GE13`. Source identifiers are kept as written; cross-package tracking uses **`PKG150-GE01` ... `PKG150-GE15`**. Registry rows were not renamed.')
A('- Other prefixes (S, AS, OP, SN, HK, MR, GR, O5, S5) do not clash with registry capability IDs. `S01`-`S15` are distinct from the registry requirement IDs `V73-S##-###`, but the namespacing is applied to all 150 for consistency.')
A('- Registry capabilities with IDs `M`, `C`, `G`, `A`, `P` (e.g. `P07`) are always written without the `PKG150-` prefix.\n')
A('## 3. Traceability matrix — all 150 capabilities\n')
A('Columns: namespaced ID | description (original) | class | evidence | existing modules | 85 refs | 23-pt refs | Global Business refs | later work / external dependency. Same data in `docs/audit/pkg150_traceability.csv`.\n')
for g in range(1, 11):
    rs = groups[g]; A(f'### Group {g} — {rs[0]["gname"]}\n')
    A('| ID | Capability | Class | Ev | Existing modules | 85 | 23 | GB | Later work / dependency |'); A('|---|---|---|---|---|---|---|---|---|')
    for r in rs:
        A(f'| {r["ns"]} | {r["desc"]} | {r["cls"]} | {r["evc"]} | {r["mods"].replace(",", ", ")} | {r["r85"].replace(",", ", ")} | {r["p23"]} | {r["gb"]} | {r["note"]} |')
    gc = collections.Counter(r['cls'] for r in rs); A(f'\nGroup counts: covered {gc["COVERED_BY_VERIFIED_85"]}, partial {gc["PARTIAL"]}, missing {gc["MISSING"]}, external blocker {gc["EXTERNAL_BLOCKER"]}.\n')
A('Ev: R = module cited by registry item with existing tests (not re-run); S = source inspection only; N = nothing exists. 23 = 23-point item numbers; GB = Global Business section (RPE = Revenue Persistence Engine).\n')
A('## 4. The 23 integration requirements (updated comparison)\n')
A('| # | Requirement | Status (source/registry basis) | Existing | Gap / dependency |'); A('|---|---|---|---|---|')
for k, v in p23.items(): A(f'| {k} | {v[0]} | {v[1]} | {v[2]} | {v[3]} |')
pc = collections.Counter(v[1].split(' ')[0] for v in p23.values()); A(f'\nCounts: {dict(pc)}. Preliminary technical decisions recorded (planning only, nothing installed): SQLite FTS5 (item 9), Ollama (6) and a malware scanner (2) are to be *evaluated*, not installed; chat providers (7) only where a lawful, officially supported API exists; Railway network configuration is left unchanged; network exposure and authentication get investigated before any binding change is proposed (item 19: Control Center binds 127.0.0.1, the Railway runtime binds 0.0.0.0 by design).\n')
A('## 5. Cross-reference to the original 85 (which of the 150 touch each registry item)\n')
A('| 85 ID | Registry status | Capability | PKG150 items |'); A('|---|---|---|---|')
for k in reg:
    if rev.get(k): A(f'| {k} | {reg[k]["final_status"]} | {reg[k]["description"]} | {", ".join(sorted(rev[k]))} |')
unref = [k for k in reg if not rev.get(k)]
A(f'\n85 items referenced by no 150 idea: {", ".join(unref)}.\n')
A('## 6. Duplicate and overlap analysis\n')
A('Groups of 150-items that should be built (or covered) once, with the existing anchor:\n')
A('| Cluster | Items | Anchor |'); A('|---|---|---|')
for n, ids, a in dups: A(f'| {n} | {", ".join(ids)} | {a} |')
A('\nOverlap with the 23-point package: model items (S07, GE09, HK04, HK13, AS15, MR06) = 23 items 4/5/18; scheduling/continuity (S08, GE03, GE14) = 12; coordination (GE02, OP15, SN14) = 11/16/17; security/audit (AS05, O503) = 3/22; updates/release (SN15, S512) = 23. Overlap with Global Business: HK04/S07/GE09/MR06 = §7; GR01-GR12 = §2; AS08 = §5; S08/GE03/O514 = Revenue Persistence Engine.\n')
A('## 7. Global Business Intelligence & Model Evolution roadmap integration\n')
A('| Section | Status | Existing | Gap |'); A('|---|---|---|---|')
for a in gbmap: A('| ' + ' | '.join(a) + ' |')
A('\nPriority rule (owner): the original 85 stay first; Automatic AI Model Evolution is **not** moved ahead of them without approval.\n')
A('## 8. Verified existing functionality vs unverified code presence\n')
A(f'- **Registry-verified (independent rounds, fake/sandbox providers):** {", ".join(k for k,v in reg.items() if v["final_status"]=="VERIFIED_WORKING")}. Only the 150 rows marked C rest on these.')
A('- **Code present, tested by authors, not independently verified (PARTIAL in registry):** everything marked P with Ev=R.')
A('- **Code present, no item-level test checked here:** every Ev=S row.')
A('- **Nothing present:** Ev=N rows (list in the CSV).')
A('- **R6 caveat:** even the verified items passed 15 independent rounds only in the sense that the last round found no HIGH/CRITICAL defects; owner confirmation is still required before any VERIFIED_WORKING claim is relied upon.\n')
A('## 9. Missing and partially implemented — building blocks (deduplicated)\n')
A('Distinct missing building blocks behind the 150 rows (each unlocks several items):\n')
blocks = [('Code-edit / repair workflow with test generation', 'C01, S09, OP02, AS06, SN01, S501, S502, S506, SN02, S03'), ('Live model provider(s) and independent judge route', 'AS03, AS10, GE15, HK09, HK11, HK12, SN10, MR03, AS01'),
 ('Browser extension / sidebar (M01)', 'MR01, MR02, MR15, HK14, MR13'), ('Computer-use / screen / vision / voice / video / geo providers', 'S01, S13, MR10, GE12, GE06, GE08, GR06, GR07, GR13, GR14'),
 ('Live web/social/market data sources behind an approved allowlist', 'GR01, GR02, GR09, GR12, MR12, GR03, GR04, GR10'), ('Contract/legal clause analysis', 'OP09, O510'),
 ('Document generation (docx/pdf/xlsx) and doc-sync', 'OP06, SN03, SN04, S508'), ('Migration / decision / campaign planners', 'OP11, O507, O504, O502, O501, O506, O513'),
 ('Data-quality monitor and sync checks', 'HK15, S509, S514')]
A('| Building block | Items it unlocks |'); A('|---|---|')
for b in blocks: A(f'| {b[0]} | {b[1]} |')
A('')
A('## 10. External blockers and required owner decisions\n')
A('- Source allowlist (no external discovery network access until approved); live provider keys/spend approval; browser/computer-use/vision/voice providers; payment rail; legal review for contract analysis and procurement eligibility; hardware for local models.')
A('- Decisions: (1) confirm order 85 -> 23-point -> Global Business -> 150; (2) approve evaluating (not installing) SQLite FTS5, Ollama, a malware scanner; (3) chat-provider list limited to official APIs; (4) which duplicates anchor which clusters (section 6); (5) whether the PKG150 namespace is accepted; (6) whether R6 limits (unkeyed hashes, Python sandbox escape, A13 heuristics, M01 not built) are accepted before expansion.\n')
A('## 11. Dependency-aware future development plan (needs separate authorization; nothing starts)\n')
A('0. **Finish the 85**: owner confirmation round for the 18 verified; clean independent rounds for the PARTIAL ones (A13, plugin system, M08, M12 and the rest); M01 decision.')
A('1. **Foundation (no spend, offline):** module interface contract + feature flags; evidence/claim vocabulary shared by all new modules; PKG150 traceability kept in the registry pipeline.')
A('2. **Security & vault (23-pt 1-3, 19):** backup package, auto-lock, credential broker, egress allowlist design, quarantine design; network exposure/auth investigation; scanner evaluation (not installed).')
A('3. **Memory & search (8-10):** markdown memory layout, FTS5 evaluation, local embedding evaluation; unlocks AS11, OP10, S08/GE03 and MR05/GE01.')
A('4. **Coordination (11, 14, 16, 17):** agent-to-agent messaging with loop limits, temporary sub-agents inside the 30-agent cap; unlocks GE02, OP15, SN14, S510, AS10, O508.')
A('5. **Code-edit workflow with sandbox and test generation:** unlocks the largest cluster of missing rows (C01, S09, OP02, AS06, SN01, S501-S506).')
A('6. **Models (4, 5, 6, 18 + Global Business §7):** provider cards, then candidate registry/benchmarks/policy/rollback, one provider at a time after approval.')
A('7. **Data sources & company intelligence (Global Business §2-3, GR*, MR12):** per-source adapters after the allowlist; organization records with provenance.')
A('8. **Revenue persistence (Global Business RPE):** pipeline replenishment, failover, multi-day carry-over, target ledger counting only verified collected revenue.')
A('9. **Control Center panels (20), chat providers (7), documents/spreadsheets generation, contract analysis.**')
A('10. **Final audit/repair cycle** with independent verification and owner confirmation.\n')
A('## 12. Restrictions observed\n')
A('No application code changed, no dependency installed, no paid call, no deploy, `main`/Railway/credentials untouched, no message sent, no agent created, 85 statuses unchanged, 150-capability implementation not started.')
open(os.path.join(D, 'ATLASZ_V73_UNIFIED_AUDIT.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(dict(cnt), dict(evc), dict(pc), len(unref))
