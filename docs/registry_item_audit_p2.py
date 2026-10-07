# Item-level statuses for the P2 sections (S11, S25, S26, S27, S35). Same rules as the P0 file.
A, T, R = "atlasz-addons/", "atlasz-tests/", "atlasz-runtime/"
TESTS = dict(auth=T+"owner-auth.test.mjs", es=T+"emergency-stop.test.mjs", gated=T+"gated-modules.test.mjs", q=T+"durable-queue.test.mjs", br=T+"backup-recovery.test.mjs",
  uc=T+"update-center.test.mjs", cr=T+"canonical-runtime.test.mjs", cq=T+"canonical-queue-safety.test.mjs", safe=T+"safety-modules.test.mjs", cc=T+"control-center.test.mjs",
  c1=T+"contract-existing-modules.test.mjs", c2=T+"contract-core-engine.test.mjs", pe=T+"probe-evidence.test.mjs", stop=T+"stop-enforcement.test.mjs", ar=T+"approval-requests.test.mjs",
  reg=T+"registry-integrity.test.mjs", pol=T+"policy-guards.test.mjs", mt=T+"contract-money-tax.test.mjs", ev=T+"evidence-record.test.mjs")
EW, NT, PA, SO, MI, EB, JA = "EXISTS_AND_WORKING", "EXISTS_NEEDS_TEST", "PARTIAL", "STRUCTURAL_ONLY", "MISSING", "EXTERNAL_BLOCKER", "BLOCKED_AWAITING_JOCI_APPROVAL"
MEM = "In-memory module state: lost on restart"
NOPROV = "EXTERNAL: no credentials/provider connected; any paid API needs separate Joci approval"
I = {}
def add(sec, rows):
    for n, (st, loc, tests, ev, blk) in rows.items():
        I["V73-S%02d-%03d" % (sec, n)] = dict(status=st, implementation_location=loc, tests=[TESTS[t] for t in tests.split()] if tests else [], evidence=[ev] if ev else [], blocker=blk)
def many(sec, rng, row):
    add(sec, {n: row for n in rng})
NOPAY = "EXTERNAL: no payment/bank evidence source; nothing counts as revenue"
add(11, {
 1: (PA, A+"money-pipeline-controller.mjs; profit-ledger.mjs", "c1 mt", "State machine and ledger honesty rules tested", NOPAY),
 2: (PA, R+"supervisor-safe.mjs; "+A+"opportunity-qualification-engine.mjs", "cr mt", "HN discovery with injected fetch; qualification tested", "One public source; real network unverified here"),
 3: (EW, A+"opportunity-qualification-engine.mjs; "+R+"supervisor-safe.mjs", "mt cr", "Blockers: upfront spend, illegal/deceptive, non-remote, license, missing evidence", None),
 4: (PA, A+"buyer-decision-maker-finder.mjs", "mt", "Query/normalise/rank/ready rules tested", "EXTERNAL: no contact data source (Clay/Hunter not connected)"),
 5: (PA, A+"buyer-decision-maker-finder.mjs", "mt", "Same module", "EXTERNAL: no contact data source"), 6: (PA, A+"client-dna-engine.mjs", "mt", "Tenant-scoped profile", MEM),
 7: (EW, A+"deal-state.mjs", "mt gated", "Forward-only states; approvals/evidence gates", None), 8: (NT, A+"proposal-quote-engine.mjs", "gated", "Owner gate tested; build/validate not", None),
 9: (NT, A+"negotiation-engine.mjs", "gated", "Owner gate tested; assessment not", None), 10: (EW, A+"follow-up-engine.mjs", "mt", "2/5/10-day schedule; stops on reply", "Nothing sends follow-ups (no delivery adapter)"),
 11: (EW, A+"delivery-engine.mjs", "mt gated", "QA -> owner approval -> external evidence", "Nothing is actually delivered"), 12: (EW, A+"invoice-engine.mjs", "mt gated", "Amount, owner approval, external reference rules", "Nothing is actually sent"),
 13: (PA, A+"payment-confirmation-adapter.mjs", "c1", "Refuses unsigned/unconfirmed/non-final/no-evidence", "providerConfirmed/signatureVerified are caller-asserted; real provider verification adapter missing (EXTERNAL)"),
 14: (EW, A+"profit-ledger.mjs; profit-accounting-engine.mjs", "c1 mt", "Only confirmed, evidenced receipts are profit", None), 15: (PA, A+"profit-accounting-engine.mjs; budget-consumption-governor.mjs", "mt c1", "Costs recorded", MEM),
 16: (PA, A+"agent-portfolio-manager.mjs", "c2", "Ranking by net value", MEM), 17: (SO, A+"market-intelligence-engine.mjs", "", "Strategy proposal logic; untested", "EXTERNAL: data sources"),
 18: (MI, None, "", "No business proof package module", None)})
many(25, range(1, 11), (MI, None, "", "No universal inbox module", None))
add(25, {3: (PA, A+"delivery-engine.mjs; invoice-engine.mjs", "mt", "Delivery/invoice 'sent' needs external evidence (truthful send state for those objects only)", "No inbox"), 8: (PA, A+"audit-chain.mjs", "safe", "Generic audit chain", "No inbox")})
add(26, {1: (MI, None, "", "No email module", None), 2: (MI, None, "", "No calendar", None), 3: (MI, None, "", "No user task creation", None), 4: (MI, None, "", "No file organisation", None),
 5: (MI, None, "", "No document generation", None), 6: (MI, None, "", "No report generation (backup/doctor reports only)", None), 7: (PA, A+"deal-state.mjs; "+R+"supervisor-safe.mjs", "mt cr", "Deal states and leads list", MEM),
 8: (PA, R+"supervisor-safe.mjs", "cq", "Timer-based recurring screening/search", "No user-defined workflows"), 9: (MI, None, "", "No reminders/alerts", None), 10: (MI, None, "", "No import/export", None),
 11: (MI, None, "", "No templating", None), 12: (EW, A+"approval-requests.mjs", "ar cc", "Approval cards with signed decisions", "No runtime flow files requests yet")})
add(27, {
 1: (PA, A+"tax-accounting-engine.mjs", "mt", "Plan/prepare gating tested; calculator injected", "EXTERNAL: verified CRA/BC rule sources and a deterministic calculator are not provided"),
 2: (PA, A+"tax-accounting-engine.mjs", "mt", "GST_HST workflow defined; BLOCKED until rules verified", "EXTERNAL: verified rules"), 3: (PA, A+"tax-accounting-engine.mjs", "mt", "BC_PST workflow defined; BLOCKED until rules verified", "EXTERNAL: verified rules"),
 4: (SO, A+"tax-accounting-engine.mjs", "", "Workflow step names only", None), 5: (MI, None, "", "No receipt capture", None), 6: (MI, None, "", "No categorisation", None),
 7: (PA, A+"invoice-engine.mjs", "mt", "Invoice objects", MEM), 8: (PA, A+"payment-confirmation-adapter.mjs", "c1", "Payment events normalised", MEM),
 9: (EW, A+"profit-accounting-engine.mjs", "mt", "Verified profit only", None), 10: (MI, None, "", "No accountant export package", None),
 11: (PA, A+"audit-chain.mjs; tax-accounting-engine.mjs", "safe", "Audit sink injected; chain exists", None), 12: (MI, None, "", "Only a PLANNED label in completion-registry; no code", None)})
add(35, {
 1: (EW, "atlasz-tests/", "reg", "Unit tests (150+) run with npm test", None), 2: (PA, "atlasz-tests/", "cq", "In-process integration (queue+safety+runtime)", "Not all modules"),
 3: (PA, "atlasz-tests/", "cc cr", "Real-process E2E for runtime and Control Center", "No external-provider E2E"), 4: (EB, None, "", "None", "EXTERNAL: providers/credentials; Joci approval for spend"),
 5: (EB, None, "", "None", "EXTERNAL: not built/run on Windows"), 6: (MI, None, "", "No file handling feature", None), 7: (MI, None, "", "No DB exists", None),
 8: (EW, "atlasz-tests/durable-queue.test.mjs", "q cq", "Queue crash/idempotency/DLQ", None), 9: (PA, "atlasz-tests/", "cr cq", "Screening execution only", None),
 10: (MI, None, "", "No MASTER runtime", None), 11: (EB, None, "", "None", "EXTERNAL: STT/TTS"), 12: (EB, None, "", "Gate tested only", "EXTERNAL: provider"),
 13: (EB, None, "", "None", "EXTERNAL"), 14: (PA, "atlasz-tests/", "mt gated", "State-machine tests", "No real delivery"), 15: (PA, "atlasz-tests/", "mt", "Invoice rules tested", "No real invoice sent"),
 16: (PA, "atlasz-tests/", "c1", "Refusal paths tested", "No provider verification"), 17: (EW, "atlasz-tests/", "br cc", "Backup/restore/drill tests", None), 18: (EW, "atlasz-tests/", "cc stop es", "Real-process kill switch E2E", None)})
many(35, range(19, 28), (EW, A+"evidence-record.mjs; scripts/make-evidence.mjs", "ev", "Structured evidence record with timestamp, component, version/commit/build, environment, test type, result, trace id, error/blocker and MOCK/SANDBOX/STAGING/PRODUCTION label", "Records produced locally only; no production evidence exists"))
