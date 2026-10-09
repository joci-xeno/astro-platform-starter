// Workbench: the single, validated entry point that connects the capability modules built in the 85-capability programme to real callers (Control Center, scheduler, typed tools).
// B1 adds: project memory + decision log (C07), notes/reading list/ideas (P03), workflows (GE11/P06/P08/P05/P11), page comparison (P13), transcript -> steps (P02).
// B0 operations: conversations (M03/P16/G13), effort allocation (C10), chunking (GE01), analyst (M07/GE07), preview rendering (M13/C09), annotations (P18), guidance (A07), detail level (P15).
// Every op validates its arguments, never throws (returns {ok:false, reason}), caps input sizes, and never spends or sends anything. Rendering returns inert SVG only.
import { createConversationStore } from "./conversation.mjs";
import { chooseEffort } from "./effort-allocation.mjs";
import { chunkText, mapReducePlan } from "./chunker.mjs";
import { analyze, reportToMarkdown } from "./analyst.mjs";
import { renderChart, renderDiagram, renderTextPreview, renderAnnotationOverlay, buildGuidance, renderGuidanceStep, svgToDataUri } from "./render.mjs";
import { chooseDetail } from "./detail-level.mjs";
import { createProjectMemory } from "./project-memory.mjs";
import { createNotesOrganizer } from "./notes-organizer.mjs";
import { createTutor } from "./tutor.mjs";
import { createWorkflowEngine } from "./workflow-engine.mjs";
import { createSkillRegistry } from "./skill-registry.mjs";
import { ingestPage, askPage } from "./page-ingest.mjs";
import { createPreferences } from "./preferences.mjs";
import { createProfiles } from "./assistant-profiles.mjs";
import { createStudy } from "./spaced-repetition.mjs";
import { createSuggestions, collectCandidates } from "./suggestions.mjs";
import { reviewCode } from "./code-review.mjs";
import { comparePages } from "./text-compare.mjs";
import { analyzeTranscript } from "./transcript-actions.mjs";
import { okName, own } from "./safe-keys.mjs";

export const WB_LIMITS = Object.freeze({ csvChars: 400_000, textChars: 400_000, maxChartsReturned: 6 });
const isObj = v => v && typeof v === "object" && !Array.isArray(v);

export function createWorkbench({ conversationFile = null, memoryFile = null, notesFile = null, workflowFile = null, skillsFile = null, prefsFile = null, profilesFile = null, studyFile = null, suggestionsFile = null, tutorFile = null, suggestionExtras = () => ({}), gateway = null, ownerAuth = null, tenantId = "JOCI", now, isStopped = () => false } = {}) {
  const conv = createConversationStore({ file: conversationFile, profileResolver: (tenant, id) => profiles.resolve(tenant, id, { role: "EXECUTION" }), ...(now ? { now } : {}) });
  const T = { tenantId };
  const memory = createProjectMemory({ file: memoryFile, ...(now ? { now } : {}) }), notes = createNotesOrganizer({ file: notesFile, ...(now ? { now } : {}) }), tutor = createTutor({ file: tutorFile, ...(now ? { now } : {}) });
  // Workflow ACTIONS are the only things a step may do. Pure computations are idempotent and rewindable; anything that writes elsewhere is neither (so a crash needs review and a rewind is refused).
  const wfActions = {
    "analyst.analyze": { run: a => { const r = analyze(String(a.csv ?? ""), { ops: [] }); if (!r.ok) throw new Error(r.reason); return { report: r.report, reportHash: r.report.reportHash ?? null }; }, idempotent: true, rewindable: true },
    "chunk.plan": { run: a => { const r = OPS["chunk.plan"](a); if (!r.ok) throw new Error(r.reason); return r; }, idempotent: true, rewindable: true },
    "effort.choose": { run: a => { const r = chooseEffort(a.task, {}); if (!r.ok) throw new Error(r.reason); return r; }, idempotent: true, rewindable: true },
    "text.compare": { run: a => { const r = comparePages(a.pages); if (!r.ok) throw new Error(r.reason); return r; }, idempotent: true, rewindable: true },
    "transcript.analyze": { run: a => { const r = analyzeTranscript(String(a.transcript ?? "")); if (!r.ok) throw new Error(r.reason); return r; }, idempotent: true, rewindable: true },
    "notes.addNote": { run: a => { const r = notes.addNote({ ...T, title: a.title, text: a.text ?? "", tags: a.tags ?? [] }); if (!r.ok) throw new Error(r.reason); return { id: r.id }; }, idempotent: false, rewindable: false },
    "memory.propose": { run: a => { const r = memory.propose(a.projectId, { ...T, actor: "SYSTEM", title: a.title, decision: a.decision, rationale: a.rationale ?? "", session: "workflow" }); if (!r.ok) throw new Error(r.reason); return { id: r.id }; }, idempotent: false, rewindable: false },
  };
  const wf = createWorkflowEngine({ file: workflowFile, actions: wfActions, isStopped, ...(now ? { now } : {}) });
  const skills = createSkillRegistry({ file: skillsFile, actions: wfActions, isStopped, ownerAuth });       // declarative skills; only pure wfActions; the console is the OWNER
  const prefs = createPreferences({ file: prefsFile, ...(now ? { now } : {}) });                  // owner preferences; the console is the OWNER, learning only proposes
  const profiles = createProfiles({ file: profilesFile, skillExists: id => skills.list(T.tenantId).some(k => k.id === id), ...(now ? { now } : {}) });   // configuration for the existing agents only; narrowed by the tool matrix at every use
  const study = createStudy({ file: studyFile, ...(now ? { now } : {}) }), sug = createSuggestions({ file: suggestionsFile, prefs, ...(now ? { now } : {}) });
  // Snapshot of what needs the owner: this workbench's own data plus whatever the host supplies (approvals, plugins). Read-only; a suggestion never acts.
  const snapshots = () => {
    const decisions = []; for (const pr of memory.listProjects(T).slice(0, 50)) { const r = memory.decisions(pr.id, { ...T, status: "PROPOSED" }); if (r.ok) for (const x of r.decisions.slice(0, 20)) decisions.push({ projectId: pr.id, decisionId: x.id, title: x.title }); }
    let extra = {}; try { extra = suggestionExtras() ?? {}; } catch { extra = {}; }
    return { ...extra, decisions, workflows: wf.listInstances({ ...T, status: null }), skills: skills.list(T.tenantId), preferences: prefs.proposals(T.tenantId, { status: "PENDING" }) };
  };
  const OPS = {
    "conv.create": a => conv.create({ ...T, title: a.title, systemPrompt: a.systemPrompt, model: a.model ?? null, profileId: a.profile ?? null }),
    "conv.setProfile": a => conv.setProfile(a.id, { ...T, profileId: a.profile ?? null }),
    "conv.list": () => ({ ok: true, conversations: conv.list(T) }),
    "conv.get": a => conv.get(a.id, T),
    "conv.addTurn": a => { if ((a.role ?? "user") !== "user") throw new Error("ROLE_NOT_ALLOWED: assistant turns are created only by conv.complete (a real model call)"); return conv.addTurn(a.id, { ...T, role: "user", text: a.text }); },
    "conv.setModel": a => conv.setModel(a.id, { ...T, model: a.model }),
    "conv.context": a => conv.context(a.id, { ...T, maxTokens: a.maxTokens ?? 4000 }),
    "conv.usage": a => conv.usageSummary(a.id, T),
    "conv.delete": a => conv.remove(a.id, T),
    "conv.complete": a => conv.complete(a.id, { ...T, gateway, maxTokens: a.maxTokens ?? 4000 }),                 // budget is NOT accepted from the caller: always 0
    "effort.choose": a => chooseEffort(a.task, { budgetUsd: a.budgetUsd ?? 0, freeOnly: a.freeOnly ?? true }),
    "chunk.plan": a => {
      if (typeof a.text !== "string" || a.text.length > WB_LIMITS.textChars) return { ok: false, reason: "TEXT_INVALID_OR_TOO_LARGE" };
      const mt = a.maxTokens ?? 800, c = chunkText(a.text, { maxTokens: mt, overlapTokens: a.overlapTokens ?? Math.min(80, Math.floor(mt / 4)) }); if (!c.ok) return c;
      const plan = mapReducePlan(c.chunks.length, { fanIn: a.fanIn ?? 8 });
      return { ok: true, chunkCount: c.chunks.length, coverage: c.coverage, plan, preview: c.chunks.slice(0, 3).map(x => ({ index: x.index, start: x.start, end: x.end, tokens: x.tokens, text: x.text.slice(0, 120) })) };
    },
    "analyst.run": a => {
      if (typeof a.csv !== "string" || a.csv.length > WB_LIMITS.csvChars) return { ok: false, reason: "CSV_INVALID_OR_TOO_LARGE" };
      if (a.ops !== undefined && (!Array.isArray(a.ops) || a.ops.length > 50 || !a.ops.every(isObj))) return { ok: false, reason: "OPS_INVALID" };
      const r = analyze(a.csv, { ops: a.ops ?? [] }); if (!r.ok) return r;
      const charts = r.charts.slice(0, WB_LIMITS.maxChartsReturned).map(c => { const s = renderChart(c); return s.ok ? { title: c.title, type: c.type, dataUri: svgToDataUri(s.svg) } : { title: c.title, type: c.type, error: s.reason }; });
      return { ok: true, report: r.report, markdown: reportToMarkdown(r.report), charts, note: r.note, rowsReturned: 0 };
    },
    "render.chart": a => { const r = renderChart(a.spec, a.size ?? {}); return r.ok ? { ok: true, dataUri: svgToDataUri(r.svg), bytes: r.bytes } : r; },
    "render.diagram": a => { const r = renderDiagram(a.diagram); return r.ok ? { ok: true, dataUri: svgToDataUri(r.svg), nodes: r.nodes, edges: r.edges } : r; },
    "render.preview": a => renderTextPreview(a.text),
    "annotate": a => { const r = renderAnnotationOverlay(a.annotations, a.size ?? {}); return r.ok ? { ok: true, dataUri: svgToDataUri(r.svg), count: r.count } : r; },
    "guidance.build": a => buildGuidance(a.guidance),
    "guidance.step": a => { const g = buildGuidance(a.guidance); if (!g.ok) return g; const r = renderGuidanceStep(g, a.n, a.size ?? {}); return r.ok ? { ok: true, step: g.steps[a.n - 1], dataUri: svgToDataUri(r.svg) } : r; },
    "detail.choose": a => chooseDetail(a),
    // ---- project memory (C07): the console is the OWNER, so adopt/supersede/revoke act as OWNER; proposals from the console are the owner's own
    "memory.createProject": a => memory.createProject({ ...T, name: a.name, goal: a.goal }),
    "memory.projects": () => ({ ok: true, projects: memory.listProjects(T) }),
    "memory.propose": a => memory.propose(a.projectId, { ...T, actor: "OWNER", title: a.title, decision: a.decision, rationale: a.rationale, session: a.session, evidence: a.evidence }),
    "memory.decisions": a => memory.decisions(a.projectId, { ...T, status: a.status ?? null }),
    "memory.adopt": a => memory.adopt(a.projectId, a.decisionId, { ...T, actor: "OWNER" }),
    "memory.supersede": a => memory.supersede(a.projectId, a.oldId, a.newId, { ...T, actor: "OWNER" }),
    "memory.revoke": a => memory.revoke(a.projectId, a.decisionId, { ...T, actor: "OWNER", reason: a.reason }),
    "memory.context": a => memory.contextFor(a.projectId, { ...T, maxTokens: a.maxTokens ?? 1200, includeProposed: a.includeProposed === true }),
    "memory.verify": () => memory.verify(),
    // ---- notes, reading list, ideas (P03)
    "notes.addNote": a => notes.addNote({ ...T, title: a.title, text: a.text, tags: a.tags }),
    "notes.addBook": a => notes.addBook({ ...T, title: a.title, author: a.author, tags: a.tags, totalPages: a.totalPages ?? null }),
    "notes.setReading": a => notes.setReading(a.id, { ...T, status: a.status, pagesRead: a.pagesRead }),
    "notes.addTakeaway": a => notes.addTakeaway(a.id, { ...T, text: a.text }),
    "notes.addIdea": a => notes.addIdea({ ...T, title: a.title, text: a.text, tags: a.tags, links: a.links }),
    "notes.setIdeaStatus": a => notes.setIdeaStatus(a.id, { ...T, status: a.status }),
    "notes.tag": a => notes.tag(a.id, { ...T, add: a.add, remove: a.remove }),
    "notes.remove": a => notes.remove(a.id, T),
    "notes.search": a => notes.search({ ...T, kind: a.kind ?? null, tags: a.tags ?? [], status: a.status ?? null, q: a.q ?? "", limit: a.limit }),
    "notes.cloud": () => ({ ok: true, tags: notes.tagCloud(T) }),
    "notes.readingList": () => ({ ok: true, ...notes.readingList(T) }),
    "notes.export": () => ({ ok: true, markdown: notes.exportMarkdown(T) }),
    // ---- personal learning tutor (P01): owner-supplied lessons and questions, Leitner-scheduled quizzes, honest progress
    "tutor.create": a => tutor.createCourse({ ...T, id: a.id, title: a.title, lessons: a.lessons, questions: a.questions, actor: "OWNER" }),
    "tutor.courses": () => ({ ok: true, courses: tutor.list(T) }),
    "tutor.lesson": a => tutor.lesson({ ...T, courseId: a.courseId, lessonId: a.lessonId }),
    "tutor.quiz": a => tutor.startQuiz({ ...T, courseId: a.courseId, lessonId: a.lessonId ?? null, count: a.count ?? 5 }),
    "tutor.answer": a => tutor.answer({ ...T, courseId: a.courseId, questionId: a.questionId, choiceIndex: a.choiceIndex, actor: "OWNER" }),
    "tutor.progress": a => tutor.progress({ ...T, courseId: a.courseId }),
    "tutor.plan": a => tutor.plan({ ...T, courseId: a.courseId }),
    "tutor.remove": a => tutor.remove({ ...T, courseId: a.courseId, actor: "OWNER" }),
    // ---- workflows (GE11 / P06 / P08 / P05 / P11)
    "workflow.actions": () => ({ ok: true, actions: wf.actionNames() }),
    "workflow.save": a => wf.saveTemplate({ ...T, id: a.id, name: a.name, params: a.params, steps: a.steps, schedule: a.schedule ?? null }),
    "workflow.templates": () => ({ ok: true, templates: wf.listTemplates(T) }),
    "workflow.template": a => wf.getTemplate(a.id, T),
    "workflow.start": a => wf.start({ ...T, templateId: a.templateId, params: a.params }),
    "workflow.run": a => wf.execute(a.id, T),
    "workflow.resume": a => wf.resume(a.id, T),
    "workflow.cancel": a => wf.cancel(a.id, { ...T, actor: "OWNER" }),
    "workflow.review": a => wf.review(a.id, a.stepId, { ...T, decision: a.decision, actor: "OWNER" }),
    "workflow.rewind": a => wf.rewind(a.id, a.toStepId ?? null, { ...T, actor: "OWNER" }),
    "workflow.instance": a => wf.getInstance(a.id, T),
    "workflow.instances": a => ({ ok: true, instances: wf.listInstances({ ...T, status: a.status ?? null }) }),
    "workflow.batchCreate": a => wf.createBatch({ ...T, templateId: a.templateId, items: a.items, ratePerMinute: a.ratePerMinute ?? 30 }),
    "workflow.batchRun": a => wf.runBatch(a.id, T),
    "workflow.batchRequeue": a => wf.requeueFailed(a.id, T),
    "workflow.batch": a => wf.getBatch(a.id, T),
    "workflow.tick": () => wf.tick(T).then(r => ({ ok: true, started: r })),
    // ---- skills (C05): drafts are tested in a throwaway engine, activated only by the owner for exactly the tested content
    "skill.actions": () => ({ ok: true, actions: skills.pureActions() }),
    "skill.submit": a => skills.submit({ ...T, id: a.id, name: a.name, description: a.description, params: a.params, steps: a.steps, permissions: a.permissions, tests: a.tests, submittedBy: "OWNER" }),
    "skill.gate": a => skills.runGate(T.tenantId, a.id, a.version),
    "skill.subject": a => { const s = skills.subject(String(a.verb), T.tenantId, a.id, a.version); return s ? { ok: true, subject: s } : { ok: false, reason: "VERSION_NOT_FOUND" }; },
    "skill.activate": a => skills.activate(T.tenantId, a.id, a.version, { actor: "OWNER", ownerApproval: a.ownerApproval ?? null }),
    "skill.rollback": a => skills.rollback(T.tenantId, a.id, a.version, { actor: "OWNER", ownerApproval: a.ownerApproval ?? null }),
    "skill.deactivate": a => skills.deactivate(T.tenantId, a.id, { actor: "OWNER", ownerApproval: a.ownerApproval ?? null }),
    "skill.run": a => skills.run(T.tenantId, a.id, a.params ?? {}),
    "skill.list": () => ({ ok: true, skills: skills.list(T.tenantId) }),
    "skill.get": a => skills.get(T.tenantId, a.id),
    // ---- page ingestion (M01 slice): supplied page content -> screened, provenance-tagged, untrusted data; extractive Q&A. Nothing is fetched or executed.
    "page.extract": a => ingestPage({ label: a.label, content: a.content, sourceUrl: a.sourceUrl ?? null }),
    "page.ask": a => { const p = ingestPage({ label: a.label, content: a.content, sourceUrl: a.sourceUrl ?? null }); return p.ok ? askPage(p, a.question) : p; },
    // ---- code review (P07): rule-based, supplied files only; nothing is executed or fetched
    "code.review": a => reviewCode({ files: a.files }),
    // ---- preferences (A11): the console is the OWNER; proposals (also from learning) apply only when confirmed here
    "pref.all": () => ({ ok: true, preferences: prefs.all(T.tenantId), proposals: prefs.proposals(T.tenantId, { status: "PENDING" }) }),
    "pref.set": a => prefs.set(T.tenantId, a.key, a.value, { actor: "OWNER" }),
    "pref.reset": a => prefs.reset(T.tenantId, a.key, { actor: "OWNER" }),
    "pref.propose": a => prefs.propose(T.tenantId, a.key, a.value, { actor: "SYSTEM", reason: a.reason ?? "" }),
    "pref.confirm": a => prefs.confirm(T.tenantId, a.id, { actor: "OWNER" }),
    "pref.reject": a => prefs.rejectProposal(T.tenantId, a.id, { actor: "OWNER" }),
    "pref.choice": a => prefs.recordChoice(T.tenantId, { kind: a.kind, subject: a.subject, actor: "OWNER" }),
    "pref.learn": () => prefs.learn(T.tenantId),
    "pref.history": a => ({ ok: true, history: prefs.history(T.tenantId, a.limit ?? 50) }),
    "pref.export": () => prefs.exportAll(T.tenantId),
    "pref.forgetAll": a => (a.confirm === "FORGET" ? prefs.forgetAll(T.tenantId, { actor: "OWNER" }) : { ok: false, reason: "CONFIRM_FORGET_REQUIRED" }),
    // ---- suggestions (A08/P20): text pointers to things that need the owner; dismiss/acknowledge only hide them
    "suggest.list": () => sug.offer(T.tenantId, collectCandidates(snapshots())),
    "suggest.dismiss": a => sug.dismiss(T.tenantId, a.key, { actor: "OWNER" }),
    "suggest.ack": a => sug.acknowledge(T.tenantId, a.key, { actor: "OWNER" }),
    "suggest.unsnooze": a => sug.unsnooze(T.tenantId, a.key, { actor: "OWNER" }),
    "suggest.status": () => sug.status(T.tenantId),
    // ---- assistant profiles (M12): the console is the OWNER; a profile creates no agent and grants nothing beyond the owner's tool matrix
    "profile.create": a => profiles.create(T.tenantId, { id: a.id, name: a.name, instructions: a.instructions, tools: a.tools, skills: a.skills, memoryScopes: a.memoryScopes, ...Object.fromEntries(Object.keys(a).filter(k => !["id", "name", "instructions", "tools", "skills", "memoryScopes", "actor"].includes(k)).map(k => [k, a[k]])), actor: "OWNER" }),
    "profile.list": () => ({ ok: true, profiles: profiles.list(T.tenantId), grantable: { SEARCH: profiles.grantable("SEARCH"), EXECUTION: profiles.grantable("EXECUTION") } }),
    "profile.get": a => profiles.get(T.tenantId, a.id),
    "profile.resolve": a => profiles.resolve(T.tenantId, a.id, { role: a.role }),
    "profile.check": a => ({ ok: true, ...profiles.check(T.tenantId, a.id, { role: a.role, tool: a.tool ?? null, scope: a.scope ?? null }) }),
    "profile.assign": a => profiles.assign(T.tenantId, a.agentId, a.profile ?? null, { actor: "OWNER" }),
    "profile.assignments": () => ({ ok: true, assignments: profiles.assignments(T.tenantId) }),
    "profile.rollback": a => profiles.rollback(T.tenantId, a.id, a.version, { actor: "OWNER" }),
    "profile.remove": a => profiles.remove(T.tenantId, a.id, { actor: "OWNER" }),
    // ---- study cards (P01): SM-2 scheduling, cloze cards from the owner's own text; the console is the OWNER
    "study.add": a => study.addCard(T.tenantId, { deck: a.deck, front: a.front, back: a.back, tags: a.tags ?? [], actor: "OWNER" }),
    "study.cloze": a => study.addCloze(T.tenantId, { deck: a.deck, text: a.text, tags: a.tags ?? [], actor: "OWNER" }),
    "study.due": a => study.due(T.tenantId, { deck: a.deck ?? null, limit: a.limit }),
    "study.get": a => study.get(T.tenantId, a.id),
    "study.review": a => study.review(T.tenantId, a.id, a.grade, { actor: "OWNER" }),
    "study.suspend": a => study.setSuspended(T.tenantId, a.id, a.value !== false, { actor: "OWNER" }),
    "study.remove": a => study.remove(T.tenantId, a.id, { actor: "OWNER" }),
    "study.stats": a => study.stats(T.tenantId, { deck: a.deck ?? null }),
    "study.export": () => study.exportAll(T.tenantId),
    "study.forgetAll": a => (a.confirm === "FORGET" ? study.forgetAll(T.tenantId, { actor: "OWNER" }) : { ok: false, reason: "CONFIRM_FORGET_REQUIRED" }),
    // ---- comparison (P13) and transcript analysis (P02): both work on text the owner supplies; nothing is fetched
    "compare.pages": a => comparePages(a.pages),
    "transcript.analyze": a => analyzeTranscript(a.transcript, { summarySentences: a.summarySentences }),
  };
  async function run(op, args = {}) {
    const f = own(OPS, op); if (!f) return { ok: false, reason: "OP_UNKNOWN" };
    if (!isObj(args)) return { ok: false, reason: "ARGS_INVALID" };
    try { return await f(args); } catch (e) { return { ok: false, reason: "OP_FAILED", detail: String(e?.message ?? e).slice(0, 120) }; }
  }
  return { run, ops: Object.keys(OPS) };
}

/** Pure computation tools for the typed registry. They are registered but NOT granted to agents: the M2 permission proposal (docs) lists them as DENY until the owner approves. */
export function registerWorkbenchTools(registry) {
  const wb = createWorkbench({});
  const obj = { type: "object", additionalProperties: true, properties: {} };
  registry.register({ name: "effort.choose", description: "Choose reasoning depth/verification from complexity, risk and budget (pure policy; never spends).", operation: "INTERNAL_COMPUTE",
    input: { type: "object", required: ["task"], properties: { task: { type: "object", additionalProperties: true, properties: {} } } }, output: obj, handler: a => wb.run("effort.choose", { task: a.task }) });
  registry.register({ name: "analyst.analyze", description: "Deterministic CSV analysis: profile, statistics, correlations, reproducible report hash (no code execution).", operation: "INTERNAL_COMPUTE",
    input: { type: "object", required: ["csv"], properties: { csv: { type: "string", minLength: 1, maxLength: 200000 } } }, output: obj, handler: async a => { const r = await wb.run("analyst.run", { csv: a.csv }); return r.ok ? { ok: true, report: r.report } : r; } });
  registry.register({ name: "chunk.plan", description: "Split a large text into bounded chunks with a proven coverage and a map-reduce plan.", operation: "INTERNAL_COMPUTE",
    input: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1, maxLength: 200000 }, maxTokens: { type: "integer", minimum: 16, maximum: 8000 } } }, output: obj, handler: a => wb.run("chunk.plan", a) });
}
