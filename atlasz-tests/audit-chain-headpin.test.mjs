// Head pin: truncating the tail of an audit log is detected (opt-in per chain).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAuditChain } from "../atlasz-addons/audit-chain.mjs";
import { tmp, rm } from "./helpers.mjs";

const open = d => createAuditChain({ filePath: path.join(d, "a.jsonl"), headPinFile: path.join(d, "a.pin") });
test("tail truncation, full deletion and head swap are detected; normal reopen and append work", () => {
  const d = tmp("pin-"); try {
    const a = open(d); for (let i = 0; i < 4; i++) a.append("E", { i });
    assert.equal(open(d).length(), 4);
    const f = path.join(d, "a.jsonl"), full = fs.readFileSync(f, "utf8"), lines = full.split("\n").filter(Boolean);
    fs.writeFileSync(f, lines.slice(0, 2).join("\n") + "\n"); assert.throws(() => open(d), /AUDIT_CHAIN_TRUNCATED/);
    fs.rmSync(f); assert.throws(() => open(d), /AUDIT_CHAIN_TRUNCATED/);
    fs.writeFileSync(f, full); const b = open(d); b.append("E", { i: 5 }); assert.equal(open(d).length(), 5);
    fs.writeFileSync(path.join(d, "a.pin"), "{bad"); assert.throws(() => open(d), /AUDIT_HEAD_PIN_CORRUPT/);
  } finally { rm(d); }
});
test("a running instance notices truncation on reload/append; chains without a pin behave as before", () => {
  const d = tmp("pin2-"); try {
    const a = open(d); a.append("E", {}); a.append("E", {}); const f = path.join(d, "a.jsonl"), l = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(f, l[0] + "\n"); assert.throws(() => a.append("E", {}), /AUDIT_CHAIN_TRUNCATED/);
    const p = createAuditChain({ filePath: path.join(d, "n.jsonl") }); p.append("E", {}); assert.equal(p.length(), 1);
  } finally { rm(d); }
});
