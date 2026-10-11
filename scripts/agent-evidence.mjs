// Per-agent runtime evidence for all 30 permanent agents (SANDBOX workforce, owner-provided FIXTURE inputs - labelled; no network, no money, no external contact).
// For every agent: receive a task, produce an output, have it independently checked by a DIFFERENT agent, report to management (ledger/events), be paused (refused) and recover. Memory/tool findings are reported honestly.
process.env.ATLASZ_TEST_MODE = "1";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createAgentRegistry } from "../atlasz-addons/agent-registry.mjs"; import { createWorkforce } from "../atlasz-addons/agent-workforce.mjs"; import { BUILTIN_EXECUTORS } from "../atlasz-addons/agent-executors.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), date = process.argv[2] ?? "2026-10-11";
const d = fs.mkdtempSync(path.join(os.tmpdir(), "atlasz-agents-"));
const wf = createWorkforce({ dir: path.join(d, "wf"), registry: createAgentRegistry({ dir: path.join(d, "reg") }), sleep: async () => {}, executors: { ...BUILTIN_EXECUTORS } });
const rows = [];
for (let i = 1; i <= 5; i++) {
  const id = "SEARCH-" + i, r = { agent: id, team: "SEARCH", provenance: "FIXTURE_OWNER_PROVIDED" };
  const x = wf.discoverOpportunity(id, { title: "Fixture lead " + i, sourceType: "OWNER_PROVIDED", sourceRef: "audit-fixture-" + i, sourceExcerpt: "A small firm needs CSV price lists " + i + " converted to JSON.", estimatedValueUsd: 100, winProbability: 0.5, effortHours: 2 });
  r.receivedTask = x.ok === true; r.producedOutput = !!x.taskId;
  const c = x.ok ? await wf.checkTask(x.taskId) : null; r.independentCheck = c?.decision ?? null; r.checkerIsDifferent = !!c && c.checker !== c.maker && c.maker === id; r.checker = c?.checker ?? null;
  wf.registry.setPaused(id, true, "audit"); const p = wf.discoverOpportunity(id, { title: "Paused " + i, sourceType: "OWNER_PROVIDED", sourceRef: "audit-p-" + i, sourceExcerpt: "x", estimatedValueUsd: 1 }); r.refusedWhilePaused = p.ok === false; wf.registry.setPaused(id, false);
  const y = wf.discoverOpportunity(id, { title: "After pause " + i, sourceType: "OWNER_PROVIDED", sourceRef: "audit-a-" + i, sourceExcerpt: "Another firm needs a report summary " + i + ".", estimatedValueUsd: 50 }); r.recoveredAfterPause = y.ok === true;
  rows.push(r);
}
for (let i = 1; i <= 25; i++) {
  const id = "EXECUTION-" + i, r = { agent: id, team: "EXECUTION", provenance: "FIXTURE_OWNER_PROVIDED" };
  const x = await wf.executeTask(id, { executor: "csv_to_json", input: { csv: "a,b\n" + i + ",2\n" }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
  r.receivedTask = x.ok === true; r.producedOutput = !!x.taskId;
  const c = x.ok ? await wf.checkTask(x.taskId) : null; r.independentCheck = c?.decision ?? null; r.checkerIsDifferent = !!c && c.checker !== id; r.checker = c?.checker ?? null;
  wf.registry.setPaused(id, true, "audit"); const p = await wf.executeTask(id, { executor: "csv_to_json", input: { csv: "a\n1\n" }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" }); r.refusedWhilePaused = p.ok === false; wf.registry.setPaused(id, false);
  const y = await wf.executeTask(id, { executor: "csv_to_json", input: { csv: "z\n" + i + "\n" }, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" }); r.recoveredAfterPause = y.ok === true;
  const bad = await wf.executeTask(id, { executor: "no_such_tool", input: {}, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" }); r.unapprovedToolRefused = bad.ok === false;
  rows.push(r);
}
const sys = wf.systemView();
const ok = r => r.receivedTask && r.producedOutput && r.independentCheck === "ACCEPT" && r.checkerIsDifferent && r.refusedWhilePaused && r.recoveredAfterPause;
const out = { generatedAt: new Date().toISOString(), scope: "SANDBOX fixtures, one workforce instance; proves the mechanism per agent identity, not commercial work", agents: rows.length, fullyProven: rows.filter(ok).length, failing: rows.filter(r => !ok(r)).map(r => r.agent), eventsChainIntact: sys.integrity,
  notProvenPerAgent: ["memory retrieval per agent (generic gateway + project scope tested in m5-memory-integration and master-coordinator tests, scenario E; not exercised for each of the 30 identities here)", "model use per agent (0 providers LIVE, so no agent can call an AI model)", "real external work (no connector source approved; no customer, contract, or payment exists)"], rows };
fs.writeFileSync(path.join(root, "docs/audit", "agent_evidence_" + date + ".json"), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, "docs/audit", "agent_evidence_" + date + ".md"), ["# 30-agent runtime evidence " + date, "", out.scope, "", "Fully proven: " + out.fullyProven + "/30. Integrity: " + JSON.stringify(out.eventsChainIntact), "", "| Agent | Task received | Output | Independent check (checker) | Refused when paused | Recovered | Unapproved tool refused |", "|---|---|---|---|---|---|---|", ...rows.map(r => "| " + r.agent + " | " + r.receivedTask + " | " + r.producedOutput + " | " + r.independentCheck + " (" + r.checker + ") | " + r.refusedWhilePaused + " | " + r.recoveredAfterPause + " | " + (r.unapprovedToolRefused ?? "n/a") + " |"), "", "## Not proven per agent", ...out.notProvenPerAgent.map(x => "- " + x), ""].join("\n"));
console.log(JSON.stringify({ agents: out.agents, fullyProven: out.fullyProven, failing: out.failing, integrity: out.eventsChainIntact }));
process.exit(0);
