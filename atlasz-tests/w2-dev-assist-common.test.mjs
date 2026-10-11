import test from "node:test";
import assert from "node:assert/strict";

test("hostile input cannot make the tokenizer quadratic: regex-like slashes finish fast and report the budget", async () => {
  const { tokenize } = await import("../atlasz-addons/dev-assist-common.mjs");
  for (const src of ["/[".repeat(60000), "/\\".repeat(60000), "x = 1 /a".repeat(15000)]) { const t0 = Date.now(); const r = tokenize(src); assert.ok(Date.now() - t0 < 2000, "took " + (Date.now() - t0) + " ms"); if (r.truncated) assert.ok(["TOKEN_BUDGET", "TOKEN_LIMIT"].includes(r.limit)); }
});
