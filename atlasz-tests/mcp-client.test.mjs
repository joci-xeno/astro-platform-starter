import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createMcpClient, LIMITS, argsHash } from "../atlasz-addons/mcp-client.mjs";
import { detectNodeRestrictions } from "../atlasz-addons/restricted-node.mjs";
import { tmp, rm } from "./helpers.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-server");
const key = generateOwnerKeyPair(), ap = (action, subject) => issueOwnerApproval({ privateKeyPem: key.privateKeyPem, action, subject });
const caps = detectNodeRestrictions(), ISOLATED = caps.permission && caps.namespace;
function rig(o = {}) {
  const root = tmp("mcp-"), c = createMcpClient({ stateDir: path.join(root, "st"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }), ...o });
  const reg = c.register({ id: "fixture", dir: FIX, entry: "server.mjs", description: "local test server" });
  const started = async (extra = {}) => { const s = await c.start("fixture", { ownerApproval: ap("MCP_SERVER_START", reg.subject) }); return s; };
  const call = (tool, args = {}, approve = true, sid = "fixture") => c.callTool(sid, tool, args, { ownerApproval: approve ? ap("MCP_TOOL_CALL", c.callSubject(sid, tool, args)) : null });
  return { root, c, reg, started, call, done: () => { c.stopAll(); rm(root); } };
}

test("registration: nothing runs; ids, entries and folders are validated; the approval subject is bound to the folder content hash", () => {
  const r = rig();
  try {
    assert.equal(r.reg.ok, true); assert.match(r.reg.subject, /^fixture#[0-9a-f]{64}$/); assert.equal(r.reg.action, "MCP_SERVER_START"); assert.deepEqual(r.c.list(), [{ id: "fixture", description: "local test server", running: false, tools: [] }]);
    const t = (patch, reason) => assert.equal(r.c.register({ id: "other", dir: FIX, entry: "server.mjs", ...patch }).reason, reason, JSON.stringify(patch));
    t({ id: "Bad Id" }, "SERVER_ID_INVALID"); t({ id: undefined }, "SERVER_ID_INVALID"); t({ id: "fixture" }, "ALREADY_REGISTERED"); t({ entry: "../x.mjs" }, "ENTRY_INVALID"); t({ entry: "/abs.mjs" }, "ENTRY_INVALID"); t({ entry: "server.txt" }, "ENTRY_INVALID"); t({ entry: 5 }, "ENTRY_INVALID");
    t({ dir: "" }, "DIR_REQUIRED"); t({ dir: undefined }, "DIR_REQUIRED"); t({ dir: path.join(r.root, "nope") }, "DIR_REJECTED"); t({ entry: "missing.mjs" }, "ENTRY_FILE_MISSING");
    const link = path.join(r.root, "linkdir"); fs.mkdirSync(link); fs.symlinkSync("/etc/passwd", path.join(link, "l")); fs.writeFileSync(path.join(link, "s.mjs"), "1"); t({ dir: link, entry: "s.mjs" }, "DIR_REJECTED");
    for (let i = 0; i < LIMITS.maxServers; i++) r.c.register({ id: "s" + i + "x", dir: FIX, entry: "server.mjs" }); assert.equal(r.c.register({ id: "last-one", dir: FIX, entry: "server.mjs" }).reason, "TOO_MANY_SERVERS");
  } finally { r.done(); }
  assert.throws(() => createMcpClient({}), /REQUIRED/);
});
test("start needs the owner's approval for exactly this folder content; unknown server, wrong subject, wrong action and replay are refused; the kill switch blocks it", async () => {
  let stop = false; const r = rig({ isStopped: () => { if (stop === "throw") throw new Error("x"); return stop; } });
  try {
    assert.equal((await r.c.start("nope")).reason, "UNKNOWN_SERVER");
    for (const bad of [null, undefined, {}, ap("MCP_TOOL_CALL", r.reg.subject), ap("MCP_SERVER_START", "fixture#" + "0".repeat(64)), ap("MCP_SERVER_START", "other#" + r.reg.subject.split("#")[1])]) assert.match((await r.c.start("fixture", { ownerApproval: bad })).reason, /^OWNER_APPROVAL_REQUIRED/);
    stop = true; assert.equal((await r.c.start("fixture", { ownerApproval: ap("MCP_SERVER_START", r.reg.subject) })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); stop = "throw"; assert.equal((await r.c.start("fixture", {})).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE");
    assert.equal(r.c.list()[0].running, false); assert.equal(r.c.auditVerify().ok, true);
  } finally { r.done(); }
});
test("a modified server folder needs a new approval (content hash binding)", async () => {
  const root = tmp("mcpm-"), dir = path.join(root, "srv"); fs.cpSync(FIX, dir, { recursive: true });
  const c = createMcpClient({ stateDir: path.join(root, "st"), ownerAuth: createOwnerAuth({ publicKeyB64: key.publicKeyB64 }) });
  try {
    const reg = c.register({ id: "mod", dir, entry: "server.mjs" }), approval = ap("MCP_SERVER_START", reg.subject);
    fs.appendFileSync(path.join(dir, "server.mjs"), "\n// changed after approval");
    assert.match((await c.start("mod", { ownerApproval: approval })).reason, /^OWNER_APPROVAL_REQUIRED/);
    fs.symlinkSync("/etc/passwd", path.join(dir, "late-link")); assert.equal((await c.start("mod", { ownerApproval: approval })).reason, "DIR_REJECTED", "a link planted after registration is refused");
  } finally { c.stopAll(); rm(root); }
});
test("full session against the local server: handshake, tool descriptors validated (bad ones dropped), every call needs an approval bound to the exact arguments", { skip: !ISOLATED && "host cannot isolate network: covered by the fail-closed test" }, async () => {
  const r = rig();
  try {
    const s = await r.started(); assert.equal(s.ok, true, JSON.stringify(s)); assert.equal(s.isolation, "PERMISSION+NETWORK_NAMESPACE");
    assert.ok(!s.tools.some(t => ["oneof", "bad name!"].includes(t.name)), "unsupported schema keyword and invalid names are dropped"); assert.deepEqual(s.dropped.map(d => d.name).sort(), ["bad name!", "echo", "oneof"]);
    assert.ok(s.tools.every(t => t.risk === "HIGH_RISK_CHANGE")); assert.ok(!JSON.stringify(s).includes("ABCDEFGHIJKLMNOPQRSTUV"), "secrets in descriptors are redacted"); assert.equal(r.c.list()[0].running, true);
    assert.equal((await r.c.start("fixture", {})).reason, "ALREADY_RUNNING");
    const e = await r.call("echo", { text: "hi" }); assert.deepEqual([e.ok, e.text, e.untrusted, e.isError], [true, "echo:hi", true, false]);
    assert.equal((await r.call("add", { a: 2, b: 3 })).text, "5");
    // approval is bound to the exact arguments and to the tool
    const forAdd23 = ap("MCP_TOOL_CALL", r.c.callSubject("fixture", "add", { a: 2, b: 3 }));
    assert.match((await r.c.callTool("fixture", "add", { a: 2, b: 4 }, { ownerApproval: forAdd23 })).reason, /^OWNER_APPROVAL_REQUIRED/);
    assert.match((await r.c.callTool("fixture", "echo", { text: "x" }, { ownerApproval: forAdd23 })).reason, /^OWNER_APPROVAL_REQUIRED/);
    assert.match((await r.call("add", { a: 1, b: 1 }, false)).reason, /^OWNER_APPROVAL_REQUIRED/);
    assert.match((await r.c.callTool("fixture", "add", { a: 1, b: 1 }, { ownerApproval: ap("MCP_SERVER_START", r.c.callSubject("fixture", "add", { a: 1, b: 1 })) })).reason, /^OWNER_APPROVAL_REQUIRED/, "a start approval is not a call approval");
    assert.equal(argsHash({ b: 1, a: 2 }), argsHash({ a: 2, b: 1 }), "key order does not matter");
    // validation before sending
    for (const [tool, args, reason] of [["add", { a: "2", b: 3 }, "INVALID_ARGUMENTS"], ["add", { a: 2 }, "INVALID_ARGUMENTS"], ["add", { a: 2, b: 3, c: 4 }, "INVALID_ARGUMENTS"], ["echo", { text: "x".repeat(101) }, "INVALID_ARGUMENTS"], ["nope", {}, "UNKNOWN_TOOL"], ["oneof", {}, "UNKNOWN_TOOL"], ["echo", [], "ARGUMENTS_INVALID"], ["echo", null, "ARGUMENTS_INVALID"]]) assert.equal((await r.call(tool, args)).reason, reason, tool + JSON.stringify(args));
    assert.equal((await r.c.callTool("nope-server", "echo", {})).reason, "SERVER_NOT_RUNNING");
    assert.equal(r.c.auditVerify().ok, true); const kinds = r.c.audit().map(a => a.type ?? a.kind ?? a.event); assert.ok(kinds.includes("MCP_SERVER_STARTED") && kinds.includes("MCP_CALL") && kinds.includes("MCP_CALL_REFUSED"));
    assert.ok(!JSON.stringify(r.c.audit()).includes("echo:hi"), "audit holds only an argument hash, not content");
  } finally { r.done(); }
});
test("hostile server behaviour is contained: injection/secret output flagged and redacted, huge output truncated, non-text parts dropped, errors reported, timeouts and crashes end the session, no network, no file access outside its folder", { skip: !ISOLATED && "host cannot isolate network" }, async () => {
  const r = rig({ limits: { ...LIMITS, requestTimeoutMs: 700 } });
  try {
    assert.equal((await r.started()).ok, true);
    const ev = await r.call("evil"); assert.deepEqual([ev.ok, ev.untrusted, ev.injectionSignals >= 1], [true, true, true]); assert.ok(!ev.text.includes("ABCDEFGHIJKLMNOPQRSTUV") && ev.text.includes("[redacted]"));
    const big = await r.call("big"); assert.deepEqual([big.truncated, big.text.length], [true, LIMITS.maxResultChars]);
    const mixed = await r.call("mixed"); assert.deepEqual([mixed.text, mixed.nonTextPartsDropped], ["caption", 2]);
    assert.deepEqual([(await r.call("fail")).isError, (await r.call("fail")).text], [true, "it failed"]);
    const er = await r.call("rpcerr"); assert.deepEqual([er.ok, er.reason, er.code], [false, "SERVER_ERROR", -32000]); assert.ok(!er.message.includes("ABCDEFGHIJKLMNOPQRSTUV"));
    assert.match((await r.call("readfs")).text, /^DENIED:ERR_ACCESS_DENIED/, "the server cannot read outside its own folder");
    assert.match((await r.call("net")).text, /^NONET:/, "the server has no network");
    assert.equal((await r.call("hang")).reason, "TIMEOUT"); assert.equal(r.c.list()[0].running, true, "a timeout of one call does not kill the session");
    assert.equal((await r.call("crash")).reason, "PROCESS_EXITED"); assert.equal(r.c.list()[0].running, false); assert.equal((await r.call("echo", { text: "x" })).reason, "SERVER_NOT_RUNNING");
  } finally { r.done(); }
});
test("kill switch mid-session: the next call is refused and the server is stopped; stop() and stopAll() end sessions; a stopped server can be started again with a new approval", { skip: !ISOLATED && "host cannot isolate network" }, async () => {
  let stop = false; const r = rig({ isStopped: () => stop });
  try {
    assert.equal((await r.started()).ok, true); assert.equal((await r.call("echo", { text: "a" })).ok, true);
    stop = true; assert.equal((await r.call("echo", { text: "b" })).reason, "OWNER_STOP_OR_SAFE_MODE_ACTIVE"); assert.equal(r.c.list()[0].running, false, "server stopped, not just refused");
    stop = false; assert.equal((await r.started()).ok, true); assert.deepEqual(r.c.stop("fixture"), { ok: true }); assert.equal(r.c.list()[0].running, false); assert.deepEqual(r.c.stop("fixture"), { ok: true, already: true });
    assert.equal((await r.started()).ok, true); r.c.stopAll(); assert.equal(r.c.list()[0].running, false);
  } finally { r.done(); }
});
test("fail closed: where the host cannot isolate the network or Node, the server is never started unrestricted", async () => {
  const r = rig({ nodeBin: "/nonexistent/node" });
  try { const s = await r.c.start("fixture", { ownerApproval: ap("MCP_SERVER_START", r.reg.subject) }); assert.deepEqual([s.ok, s.reason], [false, "SANDBOX_UNAVAILABLE"]); assert.equal(r.c.list()[0].running, false); } finally { r.done(); }
  const r2 = rig({ caps: { permission: true, namespace: false, platform: "test" } });
  try { const s = await r2.c.start("fixture", { ownerApproval: ap("MCP_SERVER_START", r2.reg.subject) }); assert.deepEqual([s.ok, s.reason], [false, "NETWORK_ISOLATION_UNAVAILABLE"], "no network namespace => the server is not started at all"); } finally { r2.done(); }
});
test("protocol edge cases: bad handshakes and tool lists end the start; replies without jsonrpc/result are ignored; oversize lines kill the session; at most 50 tools; duplicate names dropped; image parts never count as text", { skip: !ISOLATED && "host cannot isolate network" }, async () => {
  const r = rig({ limits: { ...LIMITS, requestTimeoutMs: 600, startTimeoutMs: 1500 } });
  try {
    for (const [mode, reason] of [["bad-init", /^INITIALIZE_FAILED/], ["flood", /^INITIALIZE_FAILED:LINE_TOO_LARGE/], ["bad-list", /^TOOLS_LIST_FAILED/]]) {
      const reg = r.c.register({ id: mode, dir: FIX, entry: "server.mjs" }); const s = await r.c.start(mode, { ownerApproval: ap("MCP_SERVER_START", reg.subject) });
      assert.equal(s.ok, false, mode); assert.match(s.reason, reason, mode); assert.equal(r.c.list().find(x => x.id === mode).running, false, mode + " is not left running");
    }
    const reg = r.c.register({ id: "many", dir: FIX, entry: "server.mjs" }); const m = await r.c.start("many", { ownerApproval: ap("MCP_SERVER_START", reg.subject) });
    assert.equal(m.ok, true); assert.equal(m.tools.length, LIMITS.maxTools);
    assert.equal((await r.started()).ok, true);
    assert.equal(r.c.list().find(x => x.id === "fixture").tools.filter(t => t === "echo").length, 1, "duplicate tool name dropped");
    assert.equal((await r.call("nojsonrpc")).reason, "TIMEOUT"); assert.equal((await r.call("empty")).reason, "TIMEOUT");
    const sn = await r.call("sneaky"); assert.deepEqual([sn.text, sn.nonTextPartsDropped], ["visible", 1]);
    assert.match((await r.call("writefs")).text, /^DENIED:ERR_ACCESS_DENIED/, "the server cannot write even inside its own folder"); assert.equal(fs.existsSync(path.join(FIX, "written.txt")), false);
    assert.equal((await r.call("echo", { text: "x".repeat(25000) })).reason, "ARGUMENTS_INVALID", "oversize arguments are refused before schema validation");
  } finally { r.done(); }
});
