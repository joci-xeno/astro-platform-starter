// Property-name safety for stores keyed by user-supplied ids. A name such as "__proto__", "constructor" or "toString" must never be usable as a tenant/id/key:
// assigning to "__proto__" changes a prototype and reading "constructor" on a plain object returns Object's own function (found by the independent verification pass).
// Two layers: refuse these names at validation (RESERVED / okName) and read stored objects only through own() (so a hand-edited file cannot reintroduce them).
export const RESERVED = Object.freeze(new Set(["__proto__", "constructor", "prototype", ...Object.getOwnPropertyNames(Object.prototype)]));
export const okName = (re, s) => typeof s === "string" && re.test(s) && !RESERVED.has(s);
export const own = (o, k) => (o !== null && typeof o === "object" && typeof k === "string" && Object.hasOwn(o, k) ? o[k] : undefined);
export const ownProp = own;
