import test from "node:test";
import assert from "node:assert/strict";
import { registerModelProvider, modelProviderHealth } from "../atlasz-addons/multi-model-brain.mjs";
import { connectFabricTool, toolFabricSummary } from "../atlasz-addons/tool-fabric.mjs";
import { createVoiceInterface } from "../atlasz-addons/voice-interface.mjs";
import { createComputerUseFabric } from "../atlasz-addons/computer-use-fabric.mjs";
import { validProbeEvidence } from "../atlasz-addons/probe-evidence.mjs";

const good = { probeId: "p1", outcome: "PASS", at: new Date().toISOString(), target: "real-endpoint" };
const adapter = { invoke: async () => ({}), transcribe: async () => "", speak: async () => "", name: "x" };

test("validProbeEvidence rejects incomplete evidence", () => {
  assert.equal(validProbeEvidence(good), true);
  for (const bad of [null, true, {}, { ...good, outcome: "FAIL" }, { ...good, at: "nope" }, { ...good, target: "" }]) assert.equal(validProbeEvidence(bad), false);
});
test("model provider: tested:true without evidence stays CONNECTED_UNTESTED", () => {
  const a = registerModelProvider({ id: "p-a", label: "A", adapter, models: ["m"], tested: true });
  assert.equal(a.state, "CONNECTED_UNTESTED");
  const b = registerModelProvider({ id: "p-b", label: "B", adapter, models: ["m"], tested: true, probeEvidence: good });
  assert.equal(b.state, "LIVE");
  assert.equal(modelProviderHealth().live, 1);
});
test("tool fabric: LIVE needs probe evidence", () => {
  const t1 = connectFabricTool({ id: "web-search", adapter, tested: true });
  assert.equal(t1.state, "CONNECTED_UNTESTED"); assert.equal(toolFabricSummary().live, 0);
  const t2 = connectFabricTool({ id: "web-search", adapter, tested: true, probeEvidence: good });
  assert.equal(t2.state, "LIVE"); assert.equal(toolFabricSummary().live, 1);
});
test("voice and computer-use: bare tested flag is not LIVE", () => {
  assert.equal(createVoiceInterface({ stt: { ...adapter, tested: true }, tts: { ...adapter, tested: true } }).status().state, "CONNECTED_UNTESTED");
  assert.equal(createVoiceInterface({ stt: { ...adapter, tested: true, probeEvidence: good }, tts: { ...adapter, tested: true, probeEvidence: good } }).status().state, "LIVE");
  assert.equal(createComputerUseFabric({ provider: { name: "p", tested: true } }).status().state, "CONNECTED_UNTESTED");
  assert.equal(createComputerUseFabric({ provider: { name: "p", tested: true, probeEvidence: good } }).status().state, "LIVE");
});
