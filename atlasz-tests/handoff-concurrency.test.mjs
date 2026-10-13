// Directive §4: concurrent SEARCH agents, duplicates, interrupted tasks, corrupted data, restart recovery. FIXTURE records. Part of it runs REAL concurrent OS processes against one shared store.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { spawn } from "node:child_process";
import { normalizeOpportunity, createOpportunityRegistry, createMasterIntake } from "../atlasz-addons/opportunity-intake.mjs";
import { tmp, rm } from "./helpers.mjs";

const ROOT = new URL("..", import.meta.url).pathname, CAPS = ["data.csv_to_json", "doc.extract_summary"];
const rec = (i, o = {}) => normalizeOpportunity({ sourceId: "fixture-src", externalId: "E" + i, title: "Convert CSV file number " + i + " to JSON", description: "Convert a CSV spreadsheet into JSON, remote, fixed price contract, deliver a validated file. Reference " + i + ".", buyerName: "Buyer " + i, valueAmount: 500 + i, currency: "USD", url: "https://example.org/n/" + i, remote: true, ...o }, { retrieval: "FIXTURE", discoveredAt: "2026-10-12T10:00:00.000Z" }).record;
const open = d => { const registry = createOpportunityRegistry({ dir: path.join(d, "reg") }); return { registry, mi: createMasterIntake({ dir: path.join(d, "mi"), registry, capabilities: CAPS }) }; };

test("all five SEARCH agents can submit; each hand-off is attributed and routed exactly once", () => {
  const d = tmp("hc-"); try { const { mi, registry } = open(d); const out = [1, 2, 3, 4, 5].map(n => mi.receive({ agentId: "SEARCH-" + n, record: rec(n) }));
    assert.ok(out.every(r => r.ok && r.state === "ROUTED" || r.state === "HELD_NEEDS_INFO"), JSON.stringify(out.map(r => r.state))); assert.deepEqual(out.map(r => r.from), ["SEARCH-1", "SEARCH-2", "SEARCH-3", "SEARCH-4", "SEARCH-5"]);
    assert.equal(registry.counts().total, 5); assert.equal(mi.list().length, 5);
    assert.equal(mi.receive({ agentId: "SEARCH-6", record: rec(9) }).ok, false); assert.equal(mi.receive({ agentId: "EXECUTION-1", record: rec(9) }).ok, false); assert.equal(mi.list().length, 5, "refused senders leave nothing behind");
  } finally { rm(d); }
});
test("the same opportunity found by several agents becomes ONE opportunity and ONE hand-off (exactly once for assignment)", () => {
  const d = tmp("hc-"); try { const { mi, registry } = open(d); const rs = [1, 2, 3, 4, 5].map(n => mi.receive({ agentId: "SEARCH-" + n, record: rec(1) }));
    assert.equal(new Set(rs.map(r => r.taskId)).size, 1); assert.equal(mi.list().length, 1); assert.equal(registry.counts().total, 1); assert.equal(rs.filter(r => !r.duplicate).length, 1, "only the first is new"); assert.equal(mi.list()[0].from, "SEARCH-1", "first finder keeps credit");
    const upd = mi.receive({ agentId: "SEARCH-2", record: rec(1, { valueAmount: 9000 }) }); assert.equal(upd.ok, true); const o = registry.get(rs[0].opportunityId); assert.equal(o.history.length >= 1, true, "update keeps history"); assert.equal(registry.counts().total, 1);
  } finally { rm(d); }
});
test("two instances over one store (Control Center + runtime) do not lose each other's hand-offs", () => {
  const d = tmp("hc-"); try { const A = open(d), B = open(d); A.mi.receive({ agentId: "SEARCH-1", record: rec(1) }); B.mi.receive({ agentId: "SEARCH-2", record: rec(2) }); A.mi.receive({ agentId: "SEARCH-3", record: rec(3) }); B.mi.receive({ agentId: "SEARCH-4", record: rec(4) });
    for (const x of [A, B, open(d)]) { assert.equal(x.mi.list().length, 4); assert.equal(x.registry.counts().total, 4); } assert.equal(A.mi.verify().ok, true); assert.equal(A.registry.verify().ok, true);
  } finally { rm(d); }
});
test("REAL concurrent OS processes: 5 SEARCH agents x 12 records (with overlaps) against one store lose nothing and duplicate nothing", async () => {
  const d = tmp("hc-"); try {
    const script = path.join(d, "agent.mjs");
    fs.writeFileSync(script, `import path from "node:path"; import { normalizeOpportunity, createOpportunityRegistry, createMasterIntake } from ${JSON.stringify(path.join(ROOT, "atlasz-addons/opportunity-intake.mjs"))};
const [,, dir, agent, from, to] = process.argv; const registry = createOpportunityRegistry({ dir: path.join(dir, "reg") }), mi = createMasterIntake({ dir: path.join(dir, "mi"), registry, capabilities: ["data.csv_to_json"] });
for (let i = +from; i < +to; i++) { const r = normalizeOpportunity({ sourceId: "fixture-src", externalId: "E" + i, title: "Convert CSV file number " + i + " to JSON", description: "Convert a CSV spreadsheet into JSON, remote, fixed price contract, deliver a validated file. Reference " + i + ".", buyerName: "Buyer " + i, valueAmount: 500 + i, currency: "USD", url: "https://example.org/n/" + i, remote: true }, { retrieval: "FIXTURE", discoveredAt: "2026-10-12T10:00:00.000Z" }).record; const h = mi.receive({ agentId: agent, record: r }); if (!h.ok) { console.error("FAIL", JSON.stringify(h)); process.exit(3); } }`);
    // agents cover overlapping ranges: 0-12, 8-20, 16-28, 24-36, 32-44 + wrap 0-4 => 44 distinct ids
    const ranges = [[0, 12], [8, 20], [16, 28], [24, 36], [32, 44]];
    const codes = await Promise.all(ranges.map(([a, b], n) => new Promise(res => { const c = spawn(process.execPath, [script, d, "SEARCH-" + (n + 1), String(a), String(b)], { stdio: ["ignore", "ignore", "pipe"] }); let e = ""; c.stderr.on("data", x => e += x); c.on("exit", code => res({ code, e })); })));
    assert.deepEqual(codes.map(c => c.code), [0, 0, 0, 0, 0], JSON.stringify(codes));
    const { mi, registry } = open(d); assert.equal(mi.list().length, 44, "every distinct opportunity exactly once"); assert.equal(registry.counts().total, 44); assert.equal(mi.verify().ok, true); assert.equal(registry.verify().ok, true);
    assert.ok(mi.list().every(h => ["ROUTED", "HELD_NEEDS_INFO", "REJECTED"].includes(h.state)), "no hand-off is left half-way");
    assert.equal(Object.values(mi.summary()).reduce((a, b) => a + b, 0), 44);
  } finally { rm(d); }
});
test("interrupted hand-offs resume after restart exactly once; corrupted stores are refused, never overwritten", () => {
  const d = tmp("hc-"); try {
    const registry = createOpportunityRegistry({ dir: path.join(d, "reg") }); const crashing = createMasterIntake({ dir: path.join(d, "mi"), registry, capabilities: CAPS, crashAfter: "RISK_SCREENED" });
    for (let n = 1; n <= 3; n++) assert.throws(() => crashing.receive({ agentId: "SEARCH-" + n, record: rec(n) }), /SIMULATED_CRASH/);
    const again = createMasterIntake({ dir: path.join(d, "mi"), registry: createOpportunityRegistry({ dir: path.join(d, "reg") }), capabilities: CAPS }); const r = again.resume(); assert.equal(r.resumed.length, 3); assert.ok(r.resumed.every(x => ["ROUTED", "HELD_NEEDS_INFO", "REJECTED"].includes(x.state)));
    assert.equal(again.resume().resumed.length, 0, "second resume finds nothing to redo"); assert.equal(again.list().length, 3);
    for (const n of [1, 2, 3]) assert.equal(again.receive({ agentId: "SEARCH-" + n, record: rec(n) }).duplicate, true);
    const f = path.join(d, "mi", "handoffs.json"); fs.writeFileSync(f, "{broken"); assert.throws(() => open(d), /HANDOFF_STORE_UNREADABLE/); assert.equal(fs.readFileSync(f, "utf8"), "{broken", "corrupt store left untouched for the owner");
    const g = path.join(d, "reg", "opportunities.json"); fs.writeFileSync(f, JSON.stringify({ handoffs: {} })); fs.writeFileSync(g, "[]"); assert.throws(() => open(d), /OPPORTUNITY_STORE_UNREADABLE/);
  } finally { rm(d); }
});
