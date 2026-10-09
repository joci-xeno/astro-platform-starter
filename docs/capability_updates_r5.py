"""Stage R5 (2026-10-08) status updates for docs/capability_audit_data.py. Applied by capability_audit_data.py after ROWS.
Rule: VERIFIED_WORKING only where an independent verifier (fresh agent, own scenarios through the Control Center HTTP API, no access to the authors' claims) returned VERIFIED,
no MEDIUM/HIGH defect is open, and the module also has functional + negative + mutation tests in the repository. Everything else keeps PARTIAL with the exact remaining gap."""
IND = "Independent verification R5 (2026-10-08, fresh verifier driving the Control Center HTTP API, own attack scenarios): VERIFIED. "
V, P = "VERIFIED_WORKING", "PARTIAL"
U = {
 "P03": (V, IND + "notes/books/ideas/tags/reading list/search/export, linked-note cleanup, secret redaction, credential-looking tags refused, prototype keys refused, restart persistence. tests: notes-organizer.test, workbench-hosted.", "None for the capability as scoped (export is titles+tags, a documented LOW)."),
 "C05": (V, IND + "skill.submit/gate/activate/run/rollback/deactivate: ungated, unapproved, forged, revoked, tampered and side-effecting skills refused; failing v2 never replaces v1. Approval replay across calls closed in R5 (owner-auth verifier is now process-wide). tests: skill-registry.test, skills-hosted.test.", "Skills can run only the 5 pure actions (by design)."),
 "P08": (V, IND + "Scope: workflow-engine tasks. Simulated crash with a non-idempotent step RUNNING -> restart -> PAUSED/NEEDS_REVIEW; resume refused until an owner-passphrase review; finished steps not re-run. tests: workflow-engine.test, workbench-b1-hosted.", "Planning-brain internal tasks are not resumable through this contract (out of scope of the workflow engine)."),
 "P05": (V, IND + "workflow.rewind is owner-passphrase gated at the Control Center boundary (R5), refuses to rewind past a step with side effects (REWIND_BLOCKED), never touches ledger/audit facts (engine cannot reach them). tests: workflow-engine.test, workbench-b1-hosted.", "None for task-level rewind."),
 "P11": (V, IND + "Batch of N items with checkpoint per item, rate limit, error isolation (one bad item -> DONE_WITH_ERRORS, others run), requeue only failed items, no duplicate side effects, survives restart, refused under kill switch. tests: workflow-engine.test, workbench-b1-hosted.", "batchRun holds the request for up to one rate window (LOW)."),
 "P04": (V, IND + "idea->prototype from 4 templates; TESTS_PASSED_IN_SANDBOX only after a passphrase-approved real run; source/test edits void a pass; names, params and routes validated; hostile preview confined (iframe sandbox + CSP). tests: prototype-builder.test, prototypes-hosted.test.", "None."),
 "M13": (V, IND + "render.chart/diagram/preview: NaN/null/strings refused (never drawn as zero), all output escaped, hostile labels produce no script/handler. tests: render-detail.test, render-mutation.test.", "App-style interactive previews are the static previewPage only."),
 "C09": (V, IND + "see M13 (same renderer and preview path).", "None beyond M13."),
 "P18": (V, IND + "region annotation schema validated, sparse arrays refused, escaped output. tests: render-mutation.test.", "None."),
 "A07": (V, IND + "guidance.build/guidance.step: instruction + overlay descriptors; performedByAtlasz is always false even if the input claims otherwise. tests: render-detail.test.", "Descriptors only: no screen capture or real overlay (A02 external)."),
 "P13": (V, IND + "compare.pages structural diff of owner-supplied pages (script stripped, secrets redacted, injection text flagged not obeyed), 12 ReDoS-style inputs <100 ms. tests: compare-transcript.test, compare-transcript-mutation.test.", "No fetching: pages are supplied by the owner."),
 "P02": (V, IND + "transcript.analyze: ordered steps and chapters, out-of-order cues refused. tests: compare-transcript.test, compare-transcript-mutation.test.", "Needs a transcript (no video/ASR: M09/G09 external)."),
 "P15": (V, IND + "detail.choose: CONFIDENTIAL never external, no spend without approval, level by modality/size/privacy. R5 hardened providerFree to strict boolean. tests: detail-level-mutation.test, render-detail.test.", "Advisory chooser; no multimodal processing behind it (providers external)."),
 "C10": (V, IND + "effort.choose / chunk.plan: effort and depth by complexity, risk and budget, full coverage plans; advisory (typed-tool exposure stays DENY by decision D11). tests: chunker-mutation.test, detail-level-mutation.test.", "Advisory only; not wired into a live model router (no provider)."),
 "M07": (P, "Module analyst.mjs + analyst.run in the Control Center; cleaning, descriptive statistics, correlation, charts, reproducible hash. R5 verifier found blank cells counted as 0 (HIGH): FIXED 2026-10-08 (blank/null = missing everywhere) with tests + mutation. tests: analyst-mutation.test, chunker-analyst.test, stage-r5-fixes.test.", "Fresh independent re-verification after the fix is pending."),
 "GE07": (P, "See M07. Code runs in the sandbox (NAMESPACE JS), analysis pipeline on top is analyst.mjs.", "Re-verification of M07 pending; Python sandbox containment is PARTIAL (see M06)."),
 "P01": (P, "tutor.mjs + tutor.* ops + Control Center panel. R5 verifier: honest unknowns, no answers in quiz, restart persistence OK; mastery could be gamed by instant repeats: FIXED 2026-10-08 (answers before the review is due do not raise the box). tests: tutor.test, stage-r5-fixes.test, workbench-b1-hosted.", "Fresh independent re-verification after the fix is pending."),
 "C01": (P, "code.review, repo analyze, governed test run (owner passphrase, sandboxed) and prototype builder are wired and were verified; R5 fixed review blind spots (concatenated exec, spawn sh -c, comment-only test files).", "No code EDIT workflow (read, review and test only); re-verification of review rules pending."),
 "G12": (P, "SSE feed works end to end (secrets redacted, client cap, resume). R5 verifier: tail checked only the prev link; FIXED 2026-10-08 (entry hash recomputed, prevHash link enforced).", "Fresh re-verification pending."),
 "M12": (P, "Profiles are stored/versioned/validated and check/resolve work (verified R5).", "MEDIUM open: nothing applies a profile to a chat or agent run (conv.create ignores it)."),
 "M08": (P, "Offline ledger sound; R5 found support check accepted contradicting quotes (HIGH): FIXED 2026-10-08 (numbers must appear, polarity must match; support is lexical, labelled as such).", "Live multi-source collection and semantic entailment need a provider (external). Re-verification pending."),
 "C08": (P, "See M08.", "See M08."),
 "GE04": (P, "See M08.", "See M08."),
 "M02": (P, "Verified R5: cited keyword retrieval, tenant isolation, offsets, tamper detection. Secret screening now uses the shared scrubber (R5 fix).", "Semantic retrieval; documents cannot be added over HTTP (module level only)."),
 "A05": (P, "Verified R5 at HTTP and module level; works with retention, correction, forget.", "LOW: retentionDays 0 defaults to 90; purge is not automatic. Text only."),
 "P19": (P, "See A05.", "See A05."),
 "C07": (P, "Verified R5: lifecycle, tamper evidence, restart persistence.", "LOW: evidence provenance is self-asserted free text."),
 "P16": (P, "Verified R5: persisted conversation, context packing, per-turn model switch. R5 fix: hand-written assistant turns are refused.", "Live completion path needs a provider."),
 "M03": (P, "See P16.", "Live multi-model completion needs a provider."),
 "G13": (P, "Context packing and per-conversation usage accounting verified R5.", "Provider prompt caching / routing for cost are absent (provider-dependent)."),
 "A08": (P, "Verified R5: 3 of 6 suggestion sources exercised, canAct:false, dismiss does not change the decision.", "Approvals, plugin and skill sources not exercised end to end."),
 "A11": (P, "Preference store verified R5 (propose/confirm, no silent change).", "Depends on A08 suggestion engine."),
 "P20": (P, "See A08.", "See A08."),
 "M05": (P, "Verified R5: install/enable/rollback/uninstall with owner passphrase, tamper detection; approval replay closed.", "Plugin hooks cannot be executed from any route; status stays ENABLED after post-enable code edits (LOW)."),
 "M06": (P, "JS NAMESPACE sandbox verified R5; R5 fixed shared instance (concurrency cap + audit chain no longer forked per request).", "Python native-module escape (MEDIUM, label overstated); container/VM isolation external."),
 "G05": (P, "See M06.", "See M06."),
 "A13": (P, "a11y-audit logic verified (contrast ratios match an independent formula).", "Not reachable from the Control Center (module + test only)."),
 "GE11": (P, "Templates, params and schedule verified R5.", "'Stateful delegation' = step outputs between steps; no delegation to agents."),
 "P06": (V, IND + "Reusable parameterised workflow templates ({{p.x}}, {{s.step.field}}), schedulable; scheduled template fired once, not re-fired after restart/re-save; forward references, __proto__, secrets, sub-5-minute schedules refused. tests: workflow-engine.test, workbench-b1-hosted.", "None."),
}
def apply(rows):
    out = []
    for r in rows:
        u = U.get(r[0])
        if u:
            st, ev, miss = u
            r = (r[0], r[1], r[2], r[3], st, ev, miss) + tuple(r[7:])
        out.append(r)
    return out
