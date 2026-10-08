// Typed tool registry + strict schema validation (85-capability audit: G06 Function Calling, GE08 Structured Tool Invocation,
// P14 Strict Structured Output, C06 MCP-style descriptors, M05/C05 skill/tool packaging, A10 application assistance).
//
// One shared module: a model/agent may only call a REGISTERED function, with arguments that match its schema EXACTLY (no coercion, no extra
// keys), and every call is classified by the Owner Authority + control chain before the handler can run. Handler output is validated too:
// an invalid result is rejected, never returned. Nothing here grants authority; it only routes calls through the existing chain.
//
// Schema dialect = a deliberately small JSON-Schema subset. An unsupported keyword is a registration error (fail closed), never ignored.
const ALLOWED_KEYS = new Set(["type", "enum", "const", "required", "properties", "additionalProperties", "items", "minLength", "maxLength", "pattern", "minimum", "maximum", "minItems", "maxItems", "description", "nullable"]);
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
export const LIMITS = Object.freeze({ maxDepth: 8, maxStringLen: 20000, maxArray: 1000, maxPattern: 200, maxKeys: 200 });
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Validate that a schema itself uses only the supported subset. Throws SCHEMA_INVALID:<reason>. */
export function checkSchema(schema, depth = 0) {
  if (depth > LIMITS.maxDepth) throw new Error("SCHEMA_INVALID:TOO_DEEP");
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("SCHEMA_INVALID:NOT_AN_OBJECT");
  for (const k of Object.keys(schema)) if (!ALLOWED_KEYS.has(k)) throw new Error("SCHEMA_INVALID:UNSUPPORTED_KEYWORD:" + k);
  if (schema.type === undefined && schema.enum === undefined && schema.const === undefined) throw new Error("SCHEMA_INVALID:TYPE_REQUIRED");
  if (schema.type !== undefined && !TYPES.has(schema.type)) throw new Error("SCHEMA_INVALID:UNKNOWN_TYPE:" + schema.type);
  if (schema.pattern !== undefined) { if (typeof schema.pattern !== "string" || schema.pattern.length > LIMITS.maxPattern) throw new Error("SCHEMA_INVALID:PATTERN"); try { new RegExp(schema.pattern); } catch { throw new Error("SCHEMA_INVALID:PATTERN"); } }
  if (schema.properties) { if (Object.keys(schema.properties).length > LIMITS.maxKeys) throw new Error("SCHEMA_INVALID:TOO_MANY_PROPERTIES"); for (const [k, v] of Object.entries(schema.properties)) { if (FORBIDDEN_KEYS.has(k)) throw new Error("SCHEMA_INVALID:FORBIDDEN_PROPERTY:" + k); checkSchema(v, depth + 1); } }
  if (schema.items) checkSchema(schema.items, depth + 1);
  if (schema.required && (!Array.isArray(schema.required) || schema.required.some(r => typeof r !== "string"))) throw new Error("SCHEMA_INVALID:REQUIRED");
  return true;
}

const typeOf = v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
/** Strict validation. No coercion ("5" is not a number), no extra keys unless additionalProperties:true. Returns {ok, errors:[{path,code}]}. */
export function validate(schema, value, path = "$", depth = 0, errors = []) {
  const err = (code) => { errors.push({ path, code }); return errors; };
  if (depth > LIMITS.maxDepth) { err("TOO_DEEP"); return { ok: false, errors }; }
  if (value === null && schema.nullable === true) return { ok: errors.length === 0, errors };
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) err("CONST_MISMATCH");
  if (schema.enum !== undefined && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) err("NOT_IN_ENUM");
  if (schema.type !== undefined) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === "integer" && t === "number" && Number.isInteger(value)) || (schema.type === "number" && t === "number" && Number.isFinite(value));
    if (!ok) { err("TYPE_MISMATCH:expected " + schema.type + " got " + t); return { ok: false, errors }; }
  }
  if (typeof value === "string") {
    if (value.length > LIMITS.maxStringLen) err("STRING_TOO_LONG");
    if (schema.minLength !== undefined && value.length < schema.minLength) err("TOO_SHORT");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) err("TOO_LONG");
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) err("PATTERN_MISMATCH");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) err("BELOW_MINIMUM");
    if (schema.maximum !== undefined && value > schema.maximum) err("ABOVE_MAXIMUM");
  }
  if (Array.isArray(value)) {
    if (value.length > LIMITS.maxArray) err("ARRAY_TOO_LARGE");
    if (schema.minItems !== undefined && value.length < schema.minItems) err("TOO_FEW_ITEMS");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err("TOO_MANY_ITEMS");
    if (schema.items) value.slice(0, LIMITS.maxArray).forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, depth + 1, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const props = schema.properties ?? {};
    for (const r of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, r)) errors.push({ path: `${path}.${r}`, code: "REQUIRED_MISSING" });
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) { errors.push({ path: `${path}.${k}`, code: "FORBIDDEN_KEY" }); continue; }
      if (Object.prototype.hasOwnProperty.call(props, k)) validate(props[k], value[k], `${path}.${k}`, depth + 1, errors);
      else if (schema.additionalProperties !== true) errors.push({ path: `${path}.${k}`, code: "ADDITIONAL_PROPERTY" });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Parse a model's text output as JSON and validate it. Never repairs or coerces: invalid output is rejected. */
export function parseStructured(schema, text) {
  checkSchema(schema);
  let v; try { v = JSON.parse(String(text)); } catch { return { ok: false, errors: [{ path: "$", code: "NOT_JSON" }], value: null }; }
  const r = validate(schema, v); return { ...r, value: r.ok ? v : null };
}

const sleepFail = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("TOOL_TIMEOUT")), ms));

/**
 * createToolRegistry({ chain, authority?, blackBox?, now? })
 *  chain     - the existing control chain (evaluate()). REQUIRED: without it nothing runs (fail closed).
 * register({name, description, operation, input, output, handler, version, timeoutMs, spendUsd})
 *  operation - a key of the Owner Authority catalogue (e.g. READ_STATUS, DRAFT, SEND_EXTERNAL). Unknown operations are refused at call time by the chain.
 */
export function createToolRegistry({ chain, blackBox = null, now = () => new Date().toISOString() } = {}) {
  if (!chain || typeof chain.evaluate !== "function") throw new Error("CONTROL_CHAIN_REQUIRED");
  const tools = new Map(), stats = { calls: 0, ok: 0, rejected: 0 };
  const log = (kind, d) => { try { blackBox?.record({ kind, ...d }); } catch { /* audit failure must not change the verdict; the chain already audited */ } };

  function register({ name, description = "", operation, input, output = null, handler, version = "1.0.0", timeoutMs = 10000, spendUsd = 0 } = {}) {
    if (!/^[a-z][a-z0-9_.]{1,63}$/.test(String(name))) throw new Error("TOOL_NAME_INVALID");
    if (tools.has(name)) throw new Error("TOOL_ALREADY_REGISTERED:" + name);
    if (typeof handler !== "function") throw new Error("TOOL_HANDLER_REQUIRED");
    if (typeof operation !== "string" || !operation) throw new Error("TOOL_OPERATION_REQUIRED");
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("TOOL_VERSION_INVALID");
    if (!(timeoutMs > 0 && timeoutMs <= 120000)) throw new Error("TOOL_TIMEOUT_INVALID");
    checkSchema(input); if (input.type !== "object") throw new Error("SCHEMA_INVALID:TOOL_INPUT_MUST_BE_OBJECT");
    if (output) checkSchema(output);
    tools.set(name, Object.freeze({ name, description: String(description).slice(0, 500), operation, input, output, handler, version, timeoutMs, spendUsd: Number(spendUsd) || 0 }));
    return { name, version };
  }

  /** Model-facing function manifest: names, descriptions and parameter schemas ONLY. Handlers and approvals are never exposed. */
  function describe() { return [...tools.values()].map(t => ({ name: t.name, description: t.description, version: t.version, parameters: t.input, returns: t.output, operation: t.operation })); }

  /** invoke never throws. status: OK | UNKNOWN_TOOL | INVALID_ARGUMENTS | DENIED | REQUIRES_APPROVAL | HANDLER_ERROR | OUTPUT_INVALID | TIMEOUT */
  async function invoke(name, args, { actor = { type: "TOOL", id: String(name) }, ownerApproval = null } = {}) {
    stats.calls++;
    const t = tools.get(name), done = (status, extra = {}) => { if (status === "OK") stats.ok++; else stats.rejected++; log("TOOL_CALL", { tool: name, status, actor: actor?.id ?? null, ...(extra.errors ? { errors: extra.errors.slice(0, 5) } : {}) }); return { status, tool: name, at: now(), ...extra }; };
    if (!t) return done("UNKNOWN_TOOL");
    const v = validate(t.input, args);
    if (!v.ok) return done("INVALID_ARGUMENTS", { errors: v.errors });
    let d;
    try { d = chain.evaluate({ actor, operation: t.operation, params: args, spendUsd: t.spendUsd, ownerApproval }); } catch (e) { return done("DENIED", { reason: "CHAIN_ERROR_FAIL_CLOSED" }); }
    if (!d?.allowed) return done(d?.verdict === "REQUIRE_APPROVAL" ? "REQUIRES_APPROVAL" : "DENIED", { reason: d?.reason ?? "NOT_ALLOWED", layer: d?.layer ?? null });
    let out;
    try { out = await Promise.race([Promise.resolve().then(() => t.handler(structuredClone(args))), sleepFail(t.timeoutMs)]); }
    catch (e) { return done(e.message === "TOOL_TIMEOUT" ? "TIMEOUT" : "HANDLER_ERROR", { error: String(e.message).slice(0, 200) }); }
    if (t.output) { const o = validate(t.output, out); if (!o.ok) return done("OUTPUT_INVALID", { errors: o.errors }); }
    return done("OK", { result: out });
  }
  /** Governance view of one tool (no handler, no schema): lets a broker verify that a policy entry still matches what is really registered. */
  function inspect(name) { const t = tools.get(name); return t ? { name: t.name, operation: t.operation, spendUsd: t.spendUsd, timeoutMs: t.timeoutMs, version: t.version } : null; }
  return { register, describe, inspect, invoke, has: n => tools.has(n), stats: () => ({ ...stats, tools: tools.size }) };
}
