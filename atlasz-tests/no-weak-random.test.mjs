import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { traceEvent } from "../atlasz-addons/tracing-evals.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git", "atlasz-tests", "docs"].includes(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) yield* walk(f); else if (/\.(mjs|js|cjs)$/.test(e.name)) yield f; } }

test("regression guard (ATLASZ-T3-005): no production source uses Math.random()", () => {
  const hits = [];
  for (const f of walk(ROOT)) if (/Math\s*\.\s*random\s*\(/.test(fs.readFileSync(f, "utf8"))) hits.push(path.relative(ROOT, f));
  assert.deepEqual(hits, [], "Math.random() is predictable; use node:crypto");
});
test("trace ids are unpredictable and unique (1000 events, 16 hex chars each)", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) { const t = traceEvent({ type: "X", agentId: "a", durationMs: 1 }); const id = t.traceId ?? t.event?.traceId ?? t.id; assert.match(String(id), /^[0-9a-f]{16}$/); ids.add(id); }
  assert.equal(ids.size, 1000);
});
test("trace id does not depend on Math.random (stubbing it has no effect on uniqueness)", () => {
  const orig = Math.random; Math.random = () => 0.5;
  try { const a = traceEvent({ type: "X", durationMs: 1 }), b = traceEvent({ type: "X", durationMs: 1 }); const ida = a.traceId ?? a.event?.traceId ?? a.id, idb = b.traceId ?? b.event?.traceId ?? b.id; assert.notEqual(ida, idb); }
  finally { Math.random = orig; }
});
