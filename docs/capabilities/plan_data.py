# Dependency-ordered plan for the ORIGINAL 85 capabilities (ids and names come from docs/capability_audit_data.py and are NEVER changed here).
# batch: build order. mode: BUILD_NOW (sandbox, no provider/approval) | BUILD_SLICE (feasible slice now, rest external) | FOLLOWS (status follows another capability)
#        M2_GATED (needs the agent tool path = owner approval of the M2 package) | EXTERNAL (provider / credential / hardware / network needed) | OWNER (owner decision) | REVERIFY (already VERIFIED_WORKING)
# deps: capability ids or shared foundations that must exist first.
P = {
# B0 foundations
"C10": ("B0", "BUILD_NOW", [], "effort/depth allocation by complexity, risk, budget (pure policy, no spend)"),
"G13": ("B0", "BUILD_NOW", [], "context-window manager + token accounting per conversation (provider caching stays external)"),
"M03": ("B0", "BUILD_NOW", ["G13"], "multi-model conversation object: turns, per-turn model switch, context management; live provider external"),
"P16": ("B0", "BUILD_NOW", ["M03"], "long-session continuity: durable conversation state"),
"GE01": ("B0", "BUILD_NOW", [], "chunker / map-reduce plan for large documents; true long-context model use external"),
"M07": ("B0", "BUILD_NOW", [], "deterministic analyst library: CSV load, clean, stats, chart specs, reproducible report"),
"GE07": ("B0", "FOLLOWS", ["M07"], "analytical code execution = M07 + sandbox"),
"M13": ("B0", "BUILD_NOW", [], "safe SVG/HTML preview renderer for charts, diagrams and documents"),
"C09": ("B0", "FOLLOWS", ["M13"], "same as M13"),
"P18": ("B0", "BUILD_NOW", ["M13"], "region annotation schema + highlight rendering"),
"A07": ("B0", "BUILD_NOW", ["M13", "P18"], "visual guidance descriptors rendered in Control Center"),
# B1 knowledge / workflow
"G07": ("B1", "BUILD_NOW", [], "persistent collection index for the enterprise RAG module"),
"GE09": ("B1", "FOLLOWS", ["G07"], "file search and RAG on the persistent index; generative synthesis external"),
"C07": ("B1", "BUILD_NOW", [], "durable decision log with provenance + durable shared-project registry"),
"P03": ("B1", "BUILD_NOW", [], "tags, reading list and idea model on top of Knowledge Projects"),
"C05": ("B1", "BUILD_NOW", [], "versioned skill definitions with permission boundary and pass/fail test gate"),
"M05": ("B1", "BUILD_NOW", ["C05"], "versioned plugin install from package + rollback of a bad version"),
"GE11": ("B1", "BUILD_NOW", ["P06"], "workflow templates and delegation primitives"),
"P06": ("B1", "BUILD_NOW", [], "parameterised reusable workflows, schedulable"),
"P11": ("B1", "BUILD_NOW", [], "batch engine: per-item checkpoint, rate limit, error isolation"),
"P08": ("B1", "BUILD_NOW", ["P11"], "task-level resume contract across a real process restart"),
"P05": ("B1", "BUILD_NOW", ["P08"], "per-task state rewind that never touches financial/audit facts"),
"P13": ("B1", "BUILD_NOW", [], "structured diff of user-supplied page texts"),
"P02": ("B1", "BUILD_NOW", [], "supplied timestamped transcript -> index -> summary/action steps (video analysis itself stays external)"),
"M01": ("B1", "BUILD_SLICE", [], "page text extraction + untrusted-content screening; browser extension host external"),
"C06": ("B1", "BUILD_SLICE", [], "MCP JSON-RPC client + discovery tested against a local test server; real server external"),
# B2 engineering
"P07": ("B2", "BUILD_NOW", [], "static code review checks (secrets, injection patterns, test presence)"),
"C01": ("B2", "BUILD_SLICE", ["P07", "M06"], "governed repo analysis + sandboxed test run; edits via owner approval"),
"P04": ("B2", "BUILD_SLICE", ["C01", "M13"], "template-based prototype scaffolds with tests; model-written prototypes external"),
# B3 assistance
"A08": ("B3", "BUILD_NOW", [], "suggestion engine across state sources with suppression and rate limits; suggestions never act"),
"P20": ("B3", "FOLLOWS", ["A08"], "cross-source next-step suggestions"),
"A11": ("B3", "BUILD_NOW", ["A08"], "preference/history store"),
"P01": ("B3", "BUILD_NOW", ["P03"], "spaced-repetition scheduler + quizzes from supplied content; novel lessons need a model"),
"M12": ("B3", "BUILD_NOW", ["C05"], "assistant profiles (instructions, tools, memory scope, permissions) separate from the fixed 30"),
"C03": ("B3", "BUILD_SLICE", ["P11"], "task ownership, handoff verification, duplicate-work detection (runtime tool use is M2)"),
"G12": ("B3", "BUILD_NOW", [], "server-sent-events stream of tool calls/progress in the Control Center (localhost)"),
"A13": ("B3", "BUILD_SLICE", [], "UI accessibility audit of the Control Center; scene descriptions need a vision provider"),
# gated
"G06": ("M2", "M2_GATED", [], "agent/model selects and invokes typed tools through the broker"),
"GE08": ("M2", "M2_GATED", ["G06"], ""), "P14": ("M2", "M2_GATED", ["G06"], ""), "M04": ("M2", "M2_GATED", ["G06"], ""), "A10": ("M2", "M2_GATED", ["G06"], ""),
"A12": ("OWN", "OWNER", [], "mobile transport needs an exposed endpoint = network exposure decision"),
"GE13": ("OWN", "OWNER", [], "deployment is not performed without owner approval"),
# re-verify
"C11": ("RV", "REVERIFY", [], "re-verified in this programme"), "C12": ("RV", "REVERIFY", [], "re-verified"), "C13": ("RV", "REVERIFY", [], "re-verified"),
}
EXTERNAL = ["M09","M10","C04","G01","G02","G04","G08","G09","G10","G11","GE03","GE05","GE06","GE10","GE12","A01","A02","A03","A06","A09","P09","P17"]
# Partially built; the remaining gap needs a live provider/credential or container-grade isolation that this workspace does not have -> nothing further to build in the sandbox, documented as a blocker.
PROVIDER_PARTIAL = {"C02": "real computer-use provider", "M02": "embedding provider for semantic retrieval; vision/OCR for images", "M06": "container/VM-grade isolation", "G05": "same as M06", "M08": "live web provider",
  "C08": "same as M08", "M11": "email/chat connector credentials + language model", "G03": "live independent models", "GE02": "OCR/STT/vision providers", "GE04": "live search provider",
  "A04": "translation provider", "A05": "embedding provider", "P10": "two live providers", "P12": "vision provider", "P19": "embedding / vision provider"}
BUILD_NOW_EXTRA = {"P15": ("B0", "BUILD_NOW", ["P18"], "detail-level chooser: pure policy over modality, size, privacy class and budget; providers external")}
P.update(BUILD_NOW_EXTRA)
