import test from "node:test";
import assert from "node:assert/strict";
import { chooseDetail } from "../atlasz-addons/detail-level.mjs";

const MB = 1024 * 1024;
test("detail-level mutation: size thresholds per modality and exact boundary", () => {
  assert.equal(chooseDetail({ modality: "video", bytes: 20 * MB, provider: "LOCAL", purpose: "AUDIT" }).level, "FULL");
  assert.equal(chooseDetail({ modality: "document", bytes: 20 * MB, provider: "LOCAL", purpose: "AUDIT" }).level, "STANDARD");
  assert.equal(chooseDetail({ modality: "document", bytes: 20 * MB + 1, provider: "LOCAL", purpose: "AUDIT" }).level, "SAMPLE");
  assert.equal(chooseDetail({ modality: "document", bytes: 6 * MB, provider: "LOCAL", purpose: "AUDIT" }).level, "STANDARD");
  assert.equal(chooseDetail({ modality: "document", bytes: 5 * MB, provider: "LOCAL", purpose: "AUDIT" }).level, "FULL");
});
test("detail-level mutation: providerUsed and spend are exact", () => {
  const a = chooseDetail({ modality: "image", bytes: 1, privacy: "PUBLIC", provider: "EXTERNAL", providerFree: true, budgetUsd: 5 });
  assert.equal(a.spendUsd, 0); assert.equal(a.providerUsed, true);
  const b = chooseDetail({ modality: "image", bytes: 1, privacy: "PUBLIC", provider: "NONE" });
  assert.equal(b.providerUsed, false); assert.equal(b.level, "METADATA_ONLY");
  const c = chooseDetail({ modality: "image", bytes: 1, privacy: "CONFIDENTIAL", provider: "EXTERNAL" });
  assert.equal(c.providerUsed, false); assert.equal(c.level, "METADATA_ONLY");
});
