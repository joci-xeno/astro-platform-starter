# Round 5 item-level statuses. Every status change below is backed by code + a passing test in this repo.
# Nothing here is LIVE against a real provider: no credentials, no spend, no production deployment.
A, T, C = "atlasz-addons/", "atlasz-tests/", "atlasz-control-center/"
EW, PA, MI, EB = "EXISTS_AND_WORKING", "PARTIAL", "MISSING", "EXTERNAL_BLOCKER"
I = {}
def a(sec, n, st, loc, tests, ev, blk=None): I["V73-S%02d-%03d" % (sec, n)] = dict(status=st, implementation_location=loc, tests=tests, evidence=[ev], blocker=blk)
NOINT = "Standalone module + Control Center view; not yet driving the 30-agent runtime"
# ---- S04 Human Core
HC, HT = A+"human-core.mjs; "+A+"master-brief.mjs", [T+"human-core.test.mjs", T+"control-center-home.test.mjs"]
for n, ev in [(1, "Human Core module: character, tone, help planning, impact verdicts, precedence"), (2, "CHARACTER traits + assertNoFalseClaims tested"), (3, "Context detection (EN/HU) tested; heuristic keyword model"),
              (4, "detectContext tested incl. accented Hungarian"), (5, "adaptTone distress/urgent handling tested"), (6, "planHelp tested"), (9, "adaptTone EN/HU tested"), (11, "Tone adapted to detected context"),
              (12, "assessImpact verdicts tested and shown on approval cards"), (13, "assessImpact lists affected parties; unidentified parties => REVIEW"), (14, "couldCauseUnnecessaryHarm derived from party severity")]:
    a(4, n, PA, HC, HT, ev, NOINT + "; heuristics, not a verified emotional-intelligence model")
a(4, 7, EW, A+"human-core.mjs", [T+"human-core.test.mjs"], "PRECEDENCE + decidePrecedence: later layers (compassion, profit) can never override JOCI/safety/financial; unevaluated layers fail closed")
a(4, 8, PA, HC, HT, "assessImpact wired into approval cards (humanImpact row)", "Heuristic rule set; judge is not independent of the requester")
a(4, 16, EW, A+"human-core.mjs; "+C+"core.mjs", HT, "needsOwnerApproval derived from severity/external effect; irreversible external effect => NEEDS_JOCI (tested)")
# ---- S05 Voice (architecture + state machine; no provider)
VS, VT = A+"voice-session.mjs", [T+"voice-session.test.mjs"]
NOPROV = "No tested STT/TTS provider; tests use clearly marked fakes. Not LIVE"
for n, ev in [(1, "Session state machine IDLE/LISTENING/PROCESSING/SPEAKING"), (2, "PUSH_TO_TALK and HANDS_FREE modes"), (5, "Fallback chain; provider usable only with probe evidence"), (8, "Barge-in interrupt tested"),
              (12, "Transcript JSONL"), (14, "Turn latency metrics (median/max)"), (15, "Provider health via status()"), (17, "setEnabled on/off")]:
    a(5, n, PA, VS, VT, ev, NOPROV)
a(5, 11, PA, VS, VT, "Voice approval attempts return NEEDS_STRONG_AUTH; nothing is approved by voice", NOPROV)
a(5, 16, PA, C+"public/app.js (voice)", [T+"control-center-systems.test.mjs"], "Voice panel shows real session status (BLOCKED_NO_PROVIDER)", NOPROV)
# ---- S16 Digital Twin
DT, DTT = A+"digital-twin.mjs", [T+"digital-twin.test.mjs"]
a(16, 1, PA, DT, DTT, "simulate(): rule-based cost/revenue/risk model, always SIMULATED and isProof:false", "Rule-based model of a proposed change, not a behavioural simulation of the live system; not wired into runtime decisions")
a(16, 2, EW, DT, DTT, "riskScore from reversibility, unverified assumptions, spend, conflicts, low probability (tested)")
a(16, 3, EW, DT, DTT, "Assumptions marked SUPPORTED/UNVERIFIED; unverified ones raise risk and force REVISE")
a(16, 5, EW, DT, DTT, "Forbidden/locked resource conflicts => REJECT (tested)")
a(16, 6, EW, DT, DTT, "compare(): risk-adjusted ranking; rejected options never recommended; recommendation only")
# ---- S20 Connectors
CC_, CCT = A+"connector-catalog.mjs; "+A+"provider-resilience.mjs", [T+"connector-catalog.test.mjs", T+"provider-resilience.test.mjs"]
NOCRED = "No credentials in the vault; real endpoints were never contacted (tests use a local fake HTTP server)"
a(20, 1, PA, CC_, CCT, "Descriptors for GitHub, Railway, Gmail, Drive, Calendar, Airtable, AgentMail, Hunter, Clay, Firecrawl, Exa, Tavily + generic read-only REST connector", NOCRED)
a(20, 2, PA, CC_, CCT, "Bearer / API-key auth from vault, token never logged and redacted from responses", NOCRED)
a(20, 4, EW, A+"connector-catalog.mjs; "+A+"secret-vault.mjs", CCT+[T+"safety-modules.test.mjs"], "Credentials only from the encrypted vault; echoed secrets redacted (tested)")
a(20, 5, PA, CC_, CCT, "Read-only probe per connector; LIVE only after a passing probe; failure removes evidence; connectors without a free probe stay NO_SAFE_PROBE", NOCRED)
a(20, 8, PA, A+"provider-resilience.mjs", [T+"provider-resilience.test.mjs"], "Circuit breaker + fallback + no-spend routing tested", "Standalone; not yet the dispatch path of the 30 agents")
# ---- S22 Plugins / Themes
PM, PMT = A+"plugin-manager.mjs; "+C+"core.mjs", [T+"plugin-manager.test.mjs", T+"control-center-plugins.test.mjs"]
a(22, 1, EW, PM, PMT, "Data-only themes with whitelisted CSS variables; apply/clear from the Control Center")
a(22, 2, EW, PM, PMT, "Plugin registry with manifest validation, kinds PLUGIN/EXTENSION/MODULE/THEME/SKIN")
a(22, 3, PA, PM, PMT, "Enable (signed approval), disable, quarantine after failures, reset (signed)", "No install/uninstall package flow")
a(22, 8, EW, PM, PMT, "Grantable vs forbidden permissions (SECRETS, SPEND, OWNER_AUTH, KILL_SWITCH, PAYMENTS, BANKING never grantable)")
a(22, 10, EW, PM, PMT, "enable/disable tested through the Control Center core; code plugins need a signed PLUGIN_ENABLE bound to the id")
a(22, 11, PA, PM, PMT, "Failure counting and quarantine; hooks run in isolated child processes", "No health dashboard beyond status")
# ---- S23/S24 Document Center
DC, DCT = A+"document-center.mjs", [T+"document-center.test.mjs", T+"control-center-systems.test.mjs"]
PDFX = "PDF/DOCX/XLSX are registered but marked UNSUPPORTED_FORMAT unless an extractor is injected"
for n, ev in [(5, "CSV ingested as plain text"), (6, "TXT extraction tested"), (8, "Markdown ingested as plain text"), (14, "Plain-text/HTML extraction")]:
    a(23, n, PA, DC, DCT, ev, PDFX)
a(23, 25, PA, DC, DCT, "Documents associate to jobs and evidence refs", "No folder tree UI")
a(23, 28, PA, DC, DCT, "sha256, size, type, classification, entity, tenant stored", None)
a(23, 29, EW, DC, DCT, "Tenant and role boundaries enforced on list/search/get; SECRET is owner-only with hidden snippets (tested)")
a(24, 1, PA, DC, DCT, "Classification PUBLIC/PERSONAL/CONFIDENTIAL/SECRET; secret detection forces SECRET", "Pattern-based")
a(24, 7, PA, DC, DCT, "candidateAmounts(): heuristic amount candidates (never auto-booked)", "Heuristic; no OCR")
a(24, 8, PA, DC, DCT, "Job/evidence association", None)
a(24, 13, EW, DC, DCT, "sha256 dedupe per tenant (tested)")
# ---- S25 Universal Inbox
UI, UIT = A+"universal-inbox.mjs", [T+"universal-inbox.test.mjs", T+"control-center-systems.test.mjs"]
a(25, 1, PA, UI, UIT, "Hash-chained durable inbox with source types, dedupe and priority", "No live email source (Gmail connector has no credentials)")
a(25, 2, EW, UI, UIT, "Drafts are stored as DRAFT_NOT_SENT and never sent implicitly")
a(25, 3, EW, UI, UIT, "SENT only with provider acceptance evidence; QUEUED != SENT (tested)")
a(25, 7, EW, UI, UIT, "send() requires proven connector, open kill switch and signed INBOX_SEND approval bound to the item (each negative-tested)")
a(25, 8, EW, UI, UIT, "Append-only hash chain with verify()")
a(25, 10, PA, UI, UIT, "syncSystem mirrors approvals, safe mode, dead letters and blockers with priority", "No push/mobile delivery")
# ---- S39 Mobile control (API only)
for n, ep in [(1, "STATUS"), (2, "REFRESH"), (3, "PAUSE"), (4, "RESUME"), (5, "APPROVALS"), (6, "ALERTS"), (7, "MONEY"), (8, "JOBS"), (9, "HEALTH")]:
    a(39, n, PA, A+"mobile-api.mjs; "+C+"core.mjs", [T+"mobile-api.test.mjs"], ep + ": owner-authenticated (signed, endpoint-bound, replay-safe), rate-limited, audited", "Transport-agnostic API only: not exposed on any port and there is no mobile app")
# ---- S40 Technology Watch
TW, TWT = A+"tech-watch.mjs", [T+"tech-watch.test.mjs", T+"control-center-systems.test.mjs"]
a(40, 1, PA, TW, TWT, "Offline feed-file monitor with compatibility check; NO_FEED when no feed exists (no invented news)", "No external feed is fetched; JOCI/Update Center must supply feed files")
a(40, 3, PA, TW, TWT, "Self-inventory of installed components and Node version", None)
a(40, 5, PA, TW, TWT, "Capability gaps from the completion registry and empty capability slots", None)
# ---- S47 Commercial / tenant isolation
TI, TIT = A+"tenant-isolation.mjs; scripts/make-sanitized-dist.mjs", [T+"tenant-isolation.test.mjs"]
a(47, 1, PA, TI, TIT, "Per-tenant data/config/vault/documents dirs, traversal and symlink-escape blocked, cross-tenant access denied", "Directory/namespace isolation inside one process; no per-customer instance deployed")
a(47, 2, PA, TI, TIT, "Separate dirs and vault namespace per tenant", "Same vault key/process")
a(47, 4, PA, TI, TIT, "Owner-signed Ed25519 entitlements verified (tamper/expiry tested)", "No billing or subscription system")
a(47, 5, EW, "scripts/make-sanitized-dist.mjs", TIT, "Sanitized dist excludes git, state, evidence, keys, env files, legacy worker; drops files containing secrets (tested)")
# ---- S21 Control Center panels
a(21, 12, PA, C+"core.mjs; "+C+"public/app.js (home)", [T+"control-center-home.test.mjs"], "Home with daily brief and state-only chat answers (status/approvals/money); owner controls refused", "Not an LLM chat; rule-based answers only")
a(21, 23, PA, C+"public/app.js (finance)", [T+"control-center-finance.test.mjs", T+"financial-ledger.test.mjs"], "Costs from the hash-chained ledger", "No cost sources attached yet")
a(21, 24, PA, C+"public/app.js (finance)", [T+"control-center-finance.test.mjs", T+"financial-ledger.test.mjs"], "Profit = verified received revenue - recorded costs, per entity", "No verified revenue exists yet")
a(21, 31, PA, C+"public/app.js (documents)", [T+"control-center-systems.test.mjs"], "Documents panel over the Document Center", PDFX)
a(21, 39, PA, C+"public/app.js (plugins)", [T+"control-center-plugins.test.mjs"], "Plugins panel with enable/disable/quarantine-reset", None)
a(21, 40, PA, C+"public/app.js (plugins)", [T+"control-center-plugins.test.mjs"], "Theme apply/clear", None)
a(21, 49, PA, C+"public/app.js (finance)", [T+"control-center-finance.test.mjs"], "Cost figure from the ledger", "No cost sources attached yet")
a(21, 50, PA, C+"public/app.js (finance)", [T+"control-center-finance.test.mjs"], "Verified profit figure", "No verified revenue exists yet")
a(21, 51, PA, C+"core.mjs; public/app.js (overview)", [T+"control-center-finance.test.mjs"], "Uptime card from runtime bootedAt", None)
a(21, 13, EB, C+"public/app.js (voice)", [T+"control-center-systems.test.mjs"], "Voice panel shows real session status BLOCKED_NO_PROVIDER", "EXTERNAL: STT/TTS provider")
