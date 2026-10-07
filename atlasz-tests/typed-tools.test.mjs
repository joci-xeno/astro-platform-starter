import test from "node:test";
import assert from "node:assert/strict";
import { checkSchema, validate, parseStructured, createToolRegistry, LIMITS } from "../atlasz-addons/typed-tools.mjs";
import { rig } from "./owner-control-rig.mjs";
import { rm } from "./helpers.mjs";

const S = { type: "object", required: ["to", "n"], properties: { to: { type: "string", minLength: 1, maxLength: 20, pattern: "^[a-z]+$" }, n: { type: "integer", minimum: 1, maximum: 5 }, tags: { type: "array", items: { type: "string" }, maxItems: 2 }, mode: { enum: ["a", "b"] } } };

test("schema validation is strict: no coercion, no extra keys, bounds, enum, patterns, nested paths", () => {
  assert.equal(validate(S, { to: "bob", n: 3 }).ok, true);
  const code = (v) => validate(S, v).errors.map(e => e.code.split(":")[0] + "@" + e.path);
  assert.deepEqual(code({ to: "bob", n: "3" }), ["TYPE_MISMATCH@$.n"]);                 // "3" is not an integer: never coerced
  assert.deepEqual(code({ to: "bob", n: 2.5 }), ["TYPE_MISMATCH@$.n"]);
  assert.deepEqual(code({ to: "bob" }), ["REQUIRED_MISSING@$.n"]);
  assert.deepEqual(code({ to: "bob", n: 1, evil: 1 }), ["ADDITIONAL_PROPERTY@$.evil"]);
  assert.deepEqual(code({ to: "BOB", n: 1 }), ["PATTERN_MISMATCH@$.to"]);
  assert.deepEqual(code({ to: "bob", n: 9 }), ["ABOVE_MAXIMUM@$.n"]);
  assert.deepEqual(code({ to: "bob", n: 1, tags: ["a", "b", "c"] }), ["TOO_MANY_ITEMS@$.tags"]);
  assert.deepEqual(code({ to: "bob", n: 1, tags: [1] }), ["TYPE_MISMATCH@$.tags[0]"]);
  assert.deepEqual(code({ to: "bob", n: 1, mode: "z" }), ["NOT_IN_ENUM@$.mode"]);
  assert.equal(validate(S, { to: "x", n: NaN }).ok, false); assert.equal(validate(S, null).ok, false); assert.equal(validate(S, []).ok, false);
  assert.ok(validate(S, JSON.parse('{"to":"bob","n":1,"__proto__":{"x":1}}')).errors.some(e => e.code === "FORBIDDEN_KEY"));
});

test("schema definitions fail closed: unsupported keywords, unknown types, bad patterns and depth are registration errors", () => {
  assert.throws(() => checkSchema({ type: "string", format: "email" }), /UNSUPPORTED_KEYWORD:format/);
  assert.throws(() => checkSchema({ type: "string", oneOf: [] }), /UNSUPPORTED_KEYWORD:oneOf/);
  assert.throws(() => checkSchema({ type: "date" }), /UNKNOWN_TYPE/);
  assert.throws(() => checkSchema({ type: "string", pattern: "(" }), /PATTERN/);
  assert.throws(() => checkSchema({ type: "string", pattern: "a".repeat(LIMITS.maxPattern + 1) }), /PATTERN/);
  assert.throws(() => checkSchema({ minLength: 1 }), /TYPE_REQUIRED/);
  let deep = { type: "string" }; for (let i = 0; i < 12; i++) deep = { type: "object", properties: { x: deep } };
  assert.throws(() => checkSchema(deep), /TOO_DEEP/);
});

test("strict structured output: invalid, non-JSON and extra-field model output is rejected, never repaired", () => {
  const out = { type: "object", required: ["verdict"], properties: { verdict: { enum: ["ACCEPT", "REJECT"] } } };
  assert.equal(parseStructured(out, '{"verdict":"ACCEPT"}').ok, true);
  assert.equal(parseStructured(out, '{"verdict":"MAYBE"}').ok, false);
  assert.equal(parseStructured(out, "Sure! {\"verdict\":\"ACCEPT\"}").errors[0].code, "NOT_JSON");
  assert.equal(parseStructured(out, '{"verdict":"ACCEPT","note":"x"}').value, null);
});

test("registry: calls are schema-checked, chain-classified, owner-gated; unknown tools, bad output, timeouts and handler errors are contained", async () => {
  const r = rig(); try {
    const reg = createToolRegistry({ chain: r.sys.chain, blackBox: r.blackBox });
    let ran = 0;
    reg.register({ name: "status.read", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, handler: () => { ran++; return { ok: true }; } });
    reg.register({ name: "mail.send", operation: "SEND_EXTERNAL", input: S, handler: a => { ran++; return { sent: a.to }; } });
    reg.register({ name: "bad.out", operation: "READ_STATUS", input: { type: "object", properties: {} }, output: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, handler: () => ({ ok: "yes" }) });
    reg.register({ name: "slow", operation: "READ_STATUS", input: { type: "object", properties: {} }, timeoutMs: 20, handler: () => new Promise(() => {}) });
    reg.register({ name: "boom", operation: "READ_STATUS", input: { type: "object", properties: {} }, handler: () => { throw new Error("kaput"); } });
    reg.register({ name: "ghost.op", operation: "NOT_A_REAL_OPERATION", input: { type: "object", properties: {} }, handler: () => { ran++; return 1; } });

    assert.deepEqual((await reg.invoke("status.read", {})).result, { ok: true }); assert.equal(ran, 1);
    assert.equal((await reg.invoke("nope", {})).status, "UNKNOWN_TOOL");
    assert.equal((await reg.invoke("status.read", { extra: 1 })).status, "INVALID_ARGUMENTS"); assert.equal(ran, 1);        // handler never runs on bad args
    const bad = await reg.invoke("mail.send", { to: "BOB", n: 1 }, { actor: { type: "AGENT", id: "E1" } }); assert.equal(bad.status, "INVALID_ARGUMENTS"); assert.equal(ran, 1);
    const need = await reg.invoke("mail.send", { to: "bob", n: 1 }, { actor: { type: "AGENT", id: "E1" } }); assert.equal(need.status, "REQUIRES_APPROVAL"); assert.equal(ran, 1);   // external send needs Joci
    const ok = await reg.invoke("mail.send", { to: "bob", n: 1 }, { actor: { type: "AGENT", id: "E1" }, ownerApproval: r.opApproval("SEND_EXTERNAL", { to: "bob", n: 1 }) });
    assert.equal(ok.status, "OK"); assert.deepEqual(ok.result, { sent: "bob" }); assert.equal(ran, 2);
    const swapped = await reg.invoke("mail.send", { to: "eve", n: 1 }, { actor: { type: "AGENT", id: "E1" }, ownerApproval: r.opApproval("SEND_EXTERNAL", { to: "bob", n: 1 }) });
    assert.notEqual(swapped.status, "OK"); assert.equal(ran, 2);                                                       // approval is bound to the exact arguments
    assert.equal((await reg.invoke("ghost.op", {}, { actor: { type: "AGENT", id: "E1" } })).status, "DENIED"); assert.equal(ran, 2);   // unknown operation fails closed
    assert.equal((await reg.invoke("status.read", {}, { actor: { type: "WIZARD", id: "x" } })).status, "DENIED");                       // unknown actor fails closed
    const bo = await reg.invoke("bad.out", {}); assert.equal(bo.status, "OUTPUT_INVALID"); assert.equal(bo.result, undefined);          // invalid output is not returned
    assert.equal((await reg.invoke("slow", {})).status, "TIMEOUT");
    assert.equal((await reg.invoke("boom", {})).status, "HANDLER_ERROR");
    r.stop();                                                                                                           // emergency stop: external tool blocked
    assert.equal((await reg.invoke("mail.send", { to: "bob", n: 1 }, { actor: { type: "AGENT", id: "E1" }, ownerApproval: r.opApproval("SEND_EXTERNAL", { to: "bob", n: 1 }) })).status, "DENIED");
    const m = JSON.stringify(reg.describe()); assert.ok(!/handler|ownerApproval/.test(m)); assert.equal(reg.describe().length, 6);   // manifest exposes schemas only
    assert.ok(r.blackBox.query({ kind: "TOOL_CALL" }).length >= 10);
  } finally { rm(r.dir); }
});

test("registration is validated: bad names, duplicate names, non-object input, missing handler, unsupported schema", () => {
  const r = rig(); try {
    const reg = createToolRegistry({ chain: r.sys.chain }), base = { name: "t.one", operation: "READ_STATUS", input: { type: "object", properties: {} }, handler: () => 1 };
    assert.throws(() => reg.register({ ...base, name: "Bad Name" }), /TOOL_NAME_INVALID/);
    reg.register(base); assert.throws(() => reg.register(base), /ALREADY_REGISTERED/);
    assert.throws(() => reg.register({ ...base, name: "t.two", handler: null }), /HANDLER_REQUIRED/);
    assert.throws(() => reg.register({ ...base, name: "t.three", input: { type: "string" } }), /MUST_BE_OBJECT/);
    assert.throws(() => reg.register({ ...base, name: "t.four", input: { type: "object", properties: { a: { type: "string", format: "uri" } } } }), /UNSUPPORTED_KEYWORD/);
    assert.throws(() => createToolRegistry({}), /CONTROL_CHAIN_REQUIRED/);
  } finally { rm(r.dir); }
});
