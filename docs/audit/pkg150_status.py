"""Development-status ledger for the 150 PKG150 capabilities (evidence-based; regenerate with `python3 docs/audit/pkg150_status.py`).
Reads docs/audit/pkg150_traceability.csv (pre-development audit) and overlays what has since been built. A capability is only ever labelled with what the repository proves:
  IMPLEMENTED_TESTED_NOT_CONNECTED  new module + automated tests with fakes; NOT wired into the runtime/Control Center, never LIVE
  PARTIAL_PRE_EXISTING              parts exist from earlier milestones (see existing_modules); no new work in this wave
  NOT_STARTED                       nothing built yet
  EXTERNAL_BLOCKER                  needs a live provider / data source / hardware / owner approval that is not connected
  COVERED_BY_VERIFIED_85            covered by an original-85 item whose classification is VERIFIED_WORKING
IMPLEMENTED != CONNECTED != TESTED != LIVE. Nothing here is VERIFIED_WORKING (that needs the owner's confirmation)."""
import csv, glob, os
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(H, '..', '..'))
NEW = {  # id -> (module files, note)
 'GE15': (['alt-solution-harness'], 'harness runs injected alternatives in a sandbox; no live model'),
 'O501': (['architecture-assessor'], ''), 'AS06': (['architecture-assessor'], ''), 'O506': (['architecture-assessor'], ''),
 'MR01': (['browser-extension-guard', 'browser-extension'], 'MV3 extension source + static guard; not loaded in a browser'),
 'MR02': (['browser-extension-guard', 'translation-feedback'], ''), 'MR13': (['browser-extension-guard'], ''), 'MR15': (['browser-extension-guard'], ''), 'HK14': (['browser-extension-guard'], ''),
 'O502': (['campaign-manager'], ''), 'S501': (['campaign-manager'], ''), 'SN01': (['campaign-manager'], ''),
 'OP09': (['contract-analysis'], 'clause finder, not legal advice'), 'O510': (['contract-analysis'], ''),
 'HK15': (['data-quality'], ''), 'S509': (['data-quality'], ''),
 'AS10': (['debate-protocol'], ''), 'O508': (['debate-protocol'], ''), 'O504': (['decision-analysis'], ''),
 'S508': (['doc-sync'], ''), 'OP06': (['doc-sync'], ''), 'S514': (['doc-sync'], 'HU/EN interface verifier'),
 'S06': (['form-assistant'], 'plans only; never submits'), 'OP11': (['migration-planner'], ''), 'O507': (['migration-planner'], ''),
 'AS03': (['multi-solution'], ''), 'MR09': (['social-drafts'], 'drafts only, never posted'),
 'O513': (['test-intelligence'], ''), 'S09': (['test-intelligence'], ''), 'S502': (['test-intelligence'], ''),
 'HK09': (['translation-feedback'], ''), 'HK11': (['translation-feedback'], ''), 'HK12': (['translation-feedback'], ''),
}
def tests_for(mod):
    out = []
    for pat in (f'{mod}.test.mjs', f'w*-{mod}.test.mjs', f'*{mod}*.test.mjs'):
        out += [os.path.basename(p) for p in glob.glob(os.path.join(ROOT, 'atlasz-tests', pat))]
    return sorted(set(out))
rows = list(csv.DictReader(open(os.path.join(H, 'pkg150_traceability.csv'), encoding='utf-8')))
with open(os.path.join(H, 'pkg150_status.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['namespaced_id', 'description', 'baseline_class', 'status', 'new_modules', 'tests', 'connected', 'live', 'existing_modules', 'blocker_or_next_action'])
    for r in rows:
        sid = r['source_id']; mods, note = NEW.get(sid, ([], ''))
        have = [m for m in mods if os.path.exists(os.path.join(ROOT, 'atlasz-addons', m + '.mjs')) or os.path.isdir(os.path.join(ROOT, m))]
        tests = sorted({t for m in have for t in tests_for(m)})
        if have and tests: status = 'IMPLEMENTED_TESTED_NOT_CONNECTED'
        elif r['class'] == 'COVERED_BY_VERIFIED_85': status = 'COVERED_BY_VERIFIED_85'
        elif r['class'] == 'EXTERNAL_BLOCKER': status = 'EXTERNAL_BLOCKER'
        elif r['class'] == 'PARTIAL': status = 'PARTIAL_PRE_EXISTING'
        else: status = 'NOT_STARTED'
        nxt = (note + '; ' if note else '') + ('wire into runtime + Control Center; ' if status == 'IMPLEMENTED_TESTED_NOT_CONNECTED' else '') + r['later_work_or_external_dependency']
        w.writerow([r['namespaced_id'], r['description'], r['class'], status, ' '.join(have), ' '.join(tests), 'NO', 'NO', r['existing_modules'], nxt.strip('; ')])
import collections
c = collections.Counter(); [c.update([x['status']]) for x in csv.DictReader(open(os.path.join(H, 'pkg150_status.csv'), encoding='utf-8'))]
print(dict(c), sum(c.values()))
