// Stage R5: fixes from the independent verification round (analyst blank cells, ledger support check, knowledge secret screening, conversation authorship,
// tutor review gating, detail-level strictness, code-review blind spots, chain-verifying stream tail).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { analyze, chartSpecs, parseCsv, reportToMarkdown } from "../atlasz-addons/analyst.mjs";
import { createDocumentCenter } from "../atlasz-addons/document-center.mjs";
import { createKnowledgeProjects } from "../atlasz-addons/knowledge-projects.mjs";
import { createResearchLedger } from "../atlasz-addons/research-ledger.mjs";
import { createTutor } from "../atlasz-addons/tutor.mjs";
import { chooseDetail } from "../atlasz-addons/detail-level.mjs";
import { reviewCode } from "../atlasz-addons/code-review.mjs";
import { createWorkbench } from "../atlasz-addons/workbench.mjs";
import { rig } from "./owner-control-rig.mjs";
import { tmp, rm } from "./helpers.mjs";

const T = "T1", OWNER = { tenantId: T, role: "OWNER" };

test("analyst: a blank cell is MISSING, never 0 - mean, min, histogram, scatter and correlation exclude it", () => {
  const r = analyze("g,x\na,10\na,\nb,30\nb,40\nb,50\n");
  assert.equal(r.report.stats.x.mean, 32.5); assert.equal(r.report.stats.x.min, 10); assert.equal(r.report.stats.x.count, 4);
  assert.deepEqual(r.charts.find(c => c.type === "histogram").values, [10, 30, 40, 50]);
  const s = analyze("a,b\n1,2\n,4\n3,\n4,8\n5,10\n6,12\n"); const sc = s.charts.find(c => c.type === "scatter");
  assert.ok(sc.points.every(([x, y]) => x > 0 && y > 0), "no (0,y) / (x,0) invented points"); assert.equal(sc.points.length, 4);
  assert.equal(s.report.correlations[0].n, 4);
  const t = analyze("a,b\nx,1\ny,oops\nz,3\nw,5\n", { ops: [{ op: "toNumber", column: "b" }] }); assert.equal(t.ok, true);
  assert.equal(t.report.stats.b.count, 3); assert.equal(t.report.stats.b.min, 1, "a cell nulled by toNumber is missing, not 0");
  const md = reportToMarkdown(analyze("na\nme,v\n1,2\n").report ?? { inputHash: "", reportHash: "", rows: 0, columns: 0, steps: [], profile: [], stats: {}, correlations: [] });
  assert.ok(!/^# x/m.test(md));
});

test("analyst: a header with a newline cannot inject a markdown heading into the report", () => {
  const r = analyze('"v\n# INJECTED",w\n1,2\n2,3\n3,5\n'); assert.equal(r.ok, true);
  assert.ok(!/^# INJECTED/m.test(reportToMarkdown(r.report)));
});

async function ledgerWorld() {
  const d = tmp("r5l-"), r = rig(), now = () => "2026-10-07T12:00:00.000Z";
  const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security, now });
  const kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security, now });
  const rl = createResearchLedger({ file: path.join(d, "rl.json"), knowledge: kp, security: r.security, blackBox: r.blackBox, now });
  const p = kp.create({ tenantId: T, name: "W", allowedRoles: ["OWNER", "AGENT"] }), q = rl.openQuestion({ projectId: p.id, text: "What is the rent?" }, OWNER);
  const cite = (text) => { kp.addWebSnapshot(p.id, { tenantId: T, url: "https://example.org/" + Math.random().toString(36).slice(2), retrievedAt: now(), title: "S", text }); return kp.answer(p.id, { query: text, ...OWNER }).passages.find(x => x.text.includes(text.slice(0, 20))).citation; };
  return { rl, q, cite, done: () => { rm(d); r.stop?.(); } };
}
test("research ledger: a quote with a different number, or the opposite polarity, cannot SUPPORT a claim; a genuine quote still can", async () => {
  const w = await ledgerWorld();
  try {
    const f1 = w.rl.addFinding(w.q.id, { claim: "The warehouse lease costs 4200 dollars per month" }, OWNER);
    assert.throws(() => w.rl.attachEvidence(f1.id, { citation: w.cite("The warehouse lease does not cost 4200 dollars per month") }, OWNER), /EVIDENCE_NEGATION_MISMATCH/);
    const f2 = w.rl.addFinding(w.q.id, { claim: "The warehouse lease costs 9999 dollars per month" }, OWNER);
    assert.throws(() => w.rl.attachEvidence(f2.id, { citation: w.cite("The warehouse lease costs 4200 dollars per month and 9 days notice") }, OWNER), /EVIDENCE_NUMBER_NOT_IN_QUOTE:9999/);
    assert.ok(w.rl.attachEvidence(f1.id, { citation: w.cite("The warehouse lease costs 4,200 dollars per month payable monthly") }, OWNER).id);
    const rep = w.rl.report(w.q.id, OWNER); assert.ok(JSON.stringify(rep).includes("NOT semantic verification")); assert.equal(rep.verifiedFacts.length, 0, "a genuine quote is only QUOTE_MATCHED until the owner confirms it"); assert.equal(rep.quoteMatched.length, 1);
  } finally { w.done(); }
});

test("knowledge projects: credential shapes the shared scrubber knows are withheld as SECRET (password=, bearer JWT, slack, anthropic-style keys)", async () => {
  const d = tmp("r5k-"), r = rig();
  try {
    const dc = createDocumentCenter({ dir: path.join(d, "docs"), security: r.security }), kp = createKnowledgeProjects({ file: path.join(d, "kp.json"), documents: dc, security: r.security });
    const p = kp.create({ tenantId: T, name: "K", allowedRoles: ["OWNER"] });
    const shapes = ["password" + "=hunter2hunter2", "Authorization: Bearer " + "eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" + ".abcdefghijklmnopqrstuv", "xox" + "b-123456789012-123456789012-abcdefghijklmnopqrstuvwx", "sk-" + "ant-api03-" + "A".repeat(40)];
    for (const [i, sh] of shapes.entries()) kp.addNote(p.id, { tenantId: T, title: "n" + i, text: "my config " + sh + " end" });
    const raw = fs.readFileSync(path.join(d, "kp.json"), "utf8");
    for (const sh of shapes) assert.ok(!raw.includes(sh), "stored in plaintext: " + sh.slice(0, 12));
    assert.equal(kp.summary(p.id, OWNER).members.filter(m => m.classification === "SECRET").length, 4);
  } finally { rm(d); r.stop?.(); }
});

test("workbench: an assistant turn cannot be written by hand (authorship is only set by a real model call)", async () => {
  const d = tmp("r5w-");
  try {
    const w = createWorkbench({ stateDir: d }); const c = await w.run("conv.create", { title: "t" }); assert.equal(c.ok, true, JSON.stringify(c));
    const bad = await w.run("conv.addTurn", { id: c.id ?? c.conversation?.id, role: "assistant", text: "I computed 42" });
    assert.equal(bad.ok, false); assert.match(JSON.stringify(bad), /ROLE_NOT_ALLOWED/);
    assert.equal((await w.run("conv.addTurn", { id: c.id ?? c.conversation?.id, text: "hello" })).ok, true);
  } finally { rm(d); }
});

test("tutor: repeating an answer before the review is due cannot raise the box (no instant 'mastery'); a wrong answer still resets", () => {
  let t = 1_000_000; const tu = createTutor({ now: () => t });
  tu.createCourse({ tenantId: T, id: "c1", title: "C", actor: "OWNER", lessons: [{ id: "l1", title: "L", text: "x" }], questions: [{ id: "q1", lessonId: "l1", prompt: "p", choices: ["a", "b"], answerIndex: 0 }] });
  const a = tu.answer({ tenantId: T, courseId: "c1", questionId: "q1", choiceIndex: 0, actor: "OWNER" }); assert.equal(a.box, 2);
  t += 12 * 3600000; const early = tu.answer({ tenantId: T, courseId: "c1", questionId: "q1", choiceIndex: 0, actor: "OWNER" }); assert.equal(early.countedForReview, false); assert.equal(early.nextReviewAt, a.nextReviewAt, "practice does not push the review date");
  for (let i = 0; i < 5; i++) assert.equal(tu.answer({ tenantId: T, courseId: "c1", questionId: "q1", choiceIndex: 0, actor: "OWNER" }).box, 2);
  assert.equal(tu.progress({ tenantId: T, courseId: "c1" }).lessons[0].mastered, 0);
  t += 2 * 86400000; assert.equal(tu.answer({ tenantId: T, courseId: "c1", questionId: "q1", choiceIndex: 0, actor: "OWNER" }).box, 3);
  assert.equal(tu.answer({ tenantId: T, courseId: "c1", questionId: "q1", choiceIndex: 1, actor: "OWNER" }).box, 1);
});

test("detail-level: only a boolean true counts as a free provider (the string 'false' does not)", () => {
  const free = chooseDetail({ modality: "image", bytes: 1000, privacy: "PUBLIC", provider: "EXTERNAL", providerFree: "false", budgetUsd: 0 });
  assert.equal(free.providerUsed, false);
  assert.equal(chooseDetail({ modality: "image", bytes: 1000, privacy: "PUBLIC", provider: "EXTERNAL", providerFree: true, budgetUsd: 0 }).providerUsed, true);
});

test("code review: concatenated exec/spawn('sh','-c') are flagged; a comment-only test file does not count as coverage", () => {
  const f = (path, content) => ({ path, content }), rv = files => reviewCode({ files });
  const hi = x => rv([f("a.js", x)]).findings.some(y => y.rule === "SHELL_INJECTION");
  assert.ok(hi("exec(cmd + ' x')")); assert.ok(hi("child_process.exec('ls ' + dir)")); assert.ok(hi("spawn('sh', ['-c', x])")); assert.ok(!hi("execFile('ls', [dir])"));
  assert.deepEqual(rv([f("lib.js", "export const a = 1;"), f("lib.test.js", "// TODO write tests\n/* nothing */")]).tests.untested, ["lib.js"]);
  assert.deepEqual(rv([f("lib.js", "export const a = 1;"), f("lib.test.js", "import {a} from './lib.js'; test('a',()=>{});")]).tests.untested, []);
});
