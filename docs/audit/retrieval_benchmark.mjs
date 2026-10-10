// Unified programme M5: retrieval benchmark. Prints hardware/runtime detection and the quality of each retrieval mode on the synthetic labelled corpus (14 notes, 11 questions).
//   node docs/audit/retrieval_benchmark.mjs                       -> lexical hybrid (BM25 + n-gram) and the TEST_FIXTURE plumbing run; neural = NOT_RUN
//   node docs/audit/retrieval_benchmark.mjs --activation <file>   -> additionally runs the owner-activated local Ollama model (loopback only); fails honestly if it is not reachable
// The fixture row proves the plumbing, not a model. Only a row labelled NEURAL that really ran against a local embedding server counts as neural evidence.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createMemoryStore } from "../../atlasz-addons/memory-store.mjs";
import { createFixtureProvider, detectEmbeddingRuntime, loadActivatedProvider } from "../../atlasz-addons/embedding-provider.mjs";
import { evaluate, CORPUS, CASES } from "../../atlasz-addons/retrieval-eval.mjs";

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const READER = { id: "BENCH-1", clearance: "PERSONAL" };
async function run(label, provider, k) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-")), m = createMemoryStore({ dir, semanticProvider: provider }), key = new Map();
  try {
    for (const c of CORPUS) key.set(m.write({ authorId: "BENCH-1", title: c.title, body: c.body, tags: [], classification: "PUBLIC" }).id, c.key);
    let note = null; if (provider) { const r = await m.reindexSemantic(); if (!r.ok) return { label, status: "FAILED", reason: r.reason }; }
    const lat = []; const res = await evaluate({ cases: CASES, k, run: async q => { const t0 = performance.now(); const r = await m.searchAsync({ query: q, reader: READER, limit: 5 }); lat.push(performance.now() - t0); note = r.retrieval; return r.results.map(x => key.get(x.id)); } });
    lat.sort((a, b) => a - b);
    return { label, status: "RAN", retrieval: note, k, exactWordQuestions: res.lexicalCases, paraphraseQuestions: res.paraphraseCases, overall: { recallAtK: res.recallAtK, mrr: res.mrr, ndcgAtK: res.ndcgAtK }, medianLatencyMs: Number(lat[Math.floor(lat.length / 2)].toFixed(2)) };
  } finally { m.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const hw = detectEmbeddingRuntime();
const out = { generatedAt: new Date().toISOString(), hardware: { node: hw.node, platform: hw.platform, arch: hw.arch, cpus: hw.cpus, ramMB: hw.ramMB, accel: hw.accel }, runtime: { ollamaBinary: hw.ollama.binary, onnxruntimeNode: hw.onnx.onnxruntimeNode, neuralReady: hw.neuralReady, blockers: hw.blockers, recommendation: hw.recommendation }, results: [] };
for (const k of [1, 3]) {
  out.results.push(await run("BM25 + n-gram (current default, NOT neural)", null, k));
  out.results.push({ ...(await run("TEST_FIXTURE toy embedder (plumbing only, NOT neural)", createFixtureProvider(), k)) });
}
const act = arg("--activation");
if (act) { const p = loadActivatedProvider({ configFile: act }); if (!p) out.results.push({ label: "NEURAL (owner-activated local model)", status: "NOT_RUN", reason: "activation record missing or invalid" }); else for (const k of [1, 3]) { try { out.results.push(await run("NEURAL " + p.model, p, k)); } catch (e) { out.results.push({ label: "NEURAL " + p.model, status: "FAILED", reason: String(e.message).slice(0, 100) }); } } }
else out.results.push({ label: "NEURAL local model", status: "NOT_RUN", reason: "no embedding runtime/model is installed or approved on this machine", approvalNeeded: ["Install a local runtime: Ollama (https://ollama.com) or onnxruntime-node", "Pull one model, e.g. `ollama pull " + hw.recommendation.model + "` (see CANDIDATE_MODELS for size and licence; verify the hash)", "Sign EMBEDDING_ACTIVATE for that model in the Control Center (Memory > Activate)"] });
console.log(JSON.stringify(out, null, 2));
