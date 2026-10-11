// Shared helpers for module registrations. A registration NEVER copies logic: it wires a module's real exports into the broker with a schema, an owner-authority operation class and a self-test.
export const ANY = Object.freeze({ type: "object", additionalProperties: true });
export const NONE = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const str = (o = {}) => ({ type: "string", maxLength: 4000, ...o });
export const num = (o = {}) => ({ type: "number", ...o });
export const int = (o = {}) => ({ type: "integer", ...o });
export const bool = () => ({ type: "boolean" });
export const arr = (items, o = {}) => ({ type: "array", items, maxItems: 200, ...o });
export const obj = (properties = {}, required = [], additional = false) => ({ type: "object", properties, required, additionalProperties: additional });
/** capability helper: operation is an Owner Authority class (READ_STATUS, INTERNAL_COMPUTE, DRAFT, RECOMMEND, SIMULATE, INTERNAL_BRAIN_ACTION, EXTERNAL_READ, ...). */
export const cap = (name, operation, handler, { input = NONE, output = ANY, description = "", timeoutMs = 10000 } = {}) => ({ name, operation, handler, input, output, description, timeoutMs });
export const POLICY = Object.freeze({
  low: { risk: "LOW", ownerApproval: "none: internal, reversible, side-effect-free; still subject to kill switch, safe mode and the control chain" },
  draft: { risk: "MEDIUM", ownerApproval: "none to draft; any external send, contract, payment or publication needs a signed owner approval outside this module" },
  money: { risk: "HIGH", ownerApproval: "every money movement or binding commitment needs a signed owner approval; paid status needs external evidence" },
  security: { risk: "HIGH", ownerApproval: "changes to credentials, hosts, limits or keys need a signed owner approval; reads are free" },
  external: { risk: "HIGH", ownerApproval: "network access only to owner-approved hosts (signed egress policy); no spending" }
});
export const must = (cond, msg) => { if (!cond) throw new Error(msg); return true; };
