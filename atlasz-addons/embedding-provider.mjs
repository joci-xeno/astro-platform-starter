// Unified programme M5: neural semantic retrieval - runtime detection, model candidates and embedding providers.
// WHAT THIS IS: the plumbing and the safety rules. WHAT IT IS NOT: a bundled model. No model is downloaded, no dependency is installed and nothing is activated here.
//   * detectEmbeddingRuntime() inspects this machine (RAM, CPU, GPU hints, Ollama binary / ONNX runtime presence) and rates the candidate models against it. It makes no network call.
//   * A provider is a small object { id, kind, model, dim, embed(texts) }. kind is "NEURAL" only for a real embedding model; the deterministic test fixture is kind "TEST_FIXTURE" and can never be reported as neural.
//   * The only real provider supported is a LOCAL Ollama server on a loopback address (the text never leaves the machine). Activating it needs a single-use owner approval bound to provider+model (EMBEDDING_ACTIVATE).
//   * Every vector that comes back is validated (count, dimension, finite numbers) and L2-normalised; a malformed answer is an error, never a silent zero vector.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

export const EMBED_LIMITS = Object.freeze({ batch: 16, maxChars: 8000, timeoutMs: 30_000, maxDim: 4096 });

/** Approximate figures from the public model cards, for planning only: verify size, licence and hash before approving a download. */
export const CANDIDATE_MODELS = Object.freeze([
  { id: "multilingual-e5-small", params: "118M", sizeMB: 470, ramNeededMB: 1200, dim: 384, languages: "100 languages (incl. Hungarian)", license: "MIT", via: ["onnx-runtime"], note: "Smallest model that is multilingual; needs 'query: ' / 'passage: ' prefixes." },
  { id: "bge-m3", params: "568M", sizeMB: 1200, ramNeededMB: 3000, dim: 1024, languages: "100+ languages (incl. Hungarian)", license: "MIT", via: ["ollama", "onnx-runtime"], note: "Best multilingual quality of the list; the heaviest." },
  { id: "nomic-embed-text", params: "137M", sizeMB: 274, ramNeededMB: 1000, dim: 768, languages: "English-centred", license: "Apache-2.0", via: ["ollama"], note: "Easy Ollama pull; weaker on Hungarian." },
  { id: "bge-small-en-v1.5", params: "33M", sizeMB: 130, ramNeededMB: 500, dim: 384, languages: "English", license: "MIT", via: ["onnx-runtime"], note: "Tiny and fast; English only." },
  { id: "all-MiniLM-L6-v2", params: "22M", sizeMB: 90, ramNeededMB: 400, dim: 384, languages: "English", license: "Apache-2.0", via: ["onnx-runtime"], note: "Smallest; the classic baseline." },
  { id: "mxbai-embed-large", params: "335M", sizeMB: 670, ramNeededMB: 1800, dim: 1024, languages: "English", license: "Apache-2.0", via: ["ollama"], note: "Strong English quality." }
]);

function onPath(bin, env = process.env) {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of String(env.PATH ?? "").split(path.delimiter)) { if (!dir) continue; for (const e of exts) { const f = path.join(dir, bin + e); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ } } }
  return null;
}
function resolves(pkg) { try { createRequire(import.meta.url).resolve(pkg); return true; } catch { return false; } }

export function detectEmbeddingRuntime({ env = process.env, os: osImpl = os, exists = fs.existsSync, findBinary = onPath, canResolve = resolves } = {}) {
  const ramMB = Math.round(osImpl.totalmem() / 1048576), freeMB = Math.round(osImpl.freemem() / 1048576), cpus = osImpl.cpus().length;
  const gpu = { nvidia: Boolean(exists("/proc/driver/nvidia/version") || findBinary("nvidia-smi", env)), appleSilicon: process.platform === "darwin" && process.arch === "arm64", directml: process.platform === "win32" };
  const ollama = { binary: findBinary("ollama", env), endpoint: String(env.ATLASZ_OLLAMA_URL ?? "http://127.0.0.1:11434"), reachabilityChecked: false };
  const onnx = { onnxruntimeNode: canResolve("onnxruntime-node"), transformersJs: canResolve("@huggingface/transformers") || canResolve("@xenova/transformers") };
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const accel = gpu.nvidia || gpu.appleSilicon ? "GPU_AVAILABLE_UNVERIFIED" : "CPU_ONLY";
  const fits = CANDIDATE_MODELS.map(m => ({ ...m, fit: ramMB >= m.ramNeededMB * 2 ? "COMFORTABLE" : ramMB >= m.ramNeededMB ? "TIGHT" : "TOO_LARGE", usableNow: (m.via.includes("ollama") && Boolean(ollama.binary)) || (m.via.includes("onnx-runtime") && onnx.onnxruntimeNode) }));
  const ready = fits.some(m => m.usableNow && m.fit !== "TOO_LARGE");
  return {
    node: process.versions.node, nodeMajor, platform: process.platform, arch: process.arch, cpus, ramMB, freeMB, gpu, accel, ollama, onnx, candidates: fits,
    neuralReady: ready,
    blockers: ready ? [] : [
      ...(ollama.binary || onnx.onnxruntimeNode ? [] : ["No local inference runtime is installed (no Ollama binary, no onnxruntime-node). Installing one is an owner decision."]),
      "No embedding model is present locally; downloading one needs the owner's approval (name, size, licence and hash are listed in `candidates`)."
    ],
    recommendation: ramMB >= 3000 ? { model: "bge-m3", why: "multilingual (Hungarian + English), fits this machine's RAM", runtime: "ollama" } : { model: "multilingual-e5-small", why: "smallest multilingual model", runtime: "onnx-runtime" },
    note: "Detection only: nothing was downloaded, installed or started, and no network call was made."
  };
}

// ---------------------------------------------------------------------------- vector helpers
export function normalise(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; const n = Math.sqrt(s); if (!(n > 0) || !Number.isFinite(n)) throw new Error("EMBEDDING_ZERO_VECTOR"); const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) { o[i] = v[i] / n; if (!Number.isFinite(o[i])) throw new Error("EMBEDDING_NOT_FINITE"); } return o; }      // checks the Float32 result too: 1e300 overflows when cast
export const cosineSim = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
function validateVectors(raw, count, dim) {
  if (!Array.isArray(raw) || raw.length !== count) throw new Error("EMBEDDING_COUNT_MISMATCH");
  const want = dim || (Array.isArray(raw[0]) ? raw[0].length : 0);      // every vector in a batch must share one dimension
  return raw.map(r => {
    if (!Array.isArray(r) || r.length < 2 || r.length > EMBED_LIMITS.maxDim) throw new Error("EMBEDDING_SHAPE_INVALID");
    if (want && r.length !== want) throw new Error("EMBEDDING_DIMENSION_CHANGED");
    for (const x of r) if (typeof x !== "number" || !Number.isFinite(x)) throw new Error("EMBEDDING_NOT_FINITE");
    return normalise(Float32Array.from(r));
  });
}
const checkTexts = texts => { if (!Array.isArray(texts) || !texts.length || texts.length > EMBED_LIMITS.batch) throw new Error("EMBEDDING_BATCH_INVALID"); for (const t of texts) if (typeof t !== "string" || !t.trim() || t.length > EMBED_LIMITS.maxChars) throw new Error("EMBEDDING_TEXT_INVALID"); };
export const embedSubject = (providerId, model) => "embedding:" + providerId + ":" + model;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function checkOllama(model, baseUrl) {
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(model)) throw new Error("EMBEDDING_MODEL_INVALID");
  let u; try { u = new URL(baseUrl); } catch { throw new Error("EMBEDDING_URL_INVALID"); }
  if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname) || u.username || u.password) throw new Error("EMBEDDING_ENDPOINT_MUST_BE_LOOPBACK");      // the text of private notes never leaves this machine
  return u;
}
function buildOllama({ model, u, fetchImpl, dim, timeoutMs }) {
  let known = dim;
  return {
    id: "ollama", kind: "NEURAL", model, get dim() { return known; },
    async embed(texts) {
      checkTexts(texts); const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetchImpl(new URL("/api/embed", u).href, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, input: texts }), signal: ac.signal, redirect: "error" });
        if (!res.ok) throw new Error("EMBEDDING_HTTP_" + res.status);
        const body = await res.json(); const vecs = validateVectors(body?.embeddings, texts.length, known); known = vecs[0].length; return vecs;
      } catch (e) { throw new Error(e?.name === "AbortError" ? "EMBEDDING_TIMEOUT" : String(e?.message ?? e).startsWith("EMBEDDING_") ? e.message : "EMBEDDING_PROVIDER_ERROR"); }
      finally { clearTimeout(timer); }
    }
  };
}

/** Local Ollama embedding provider. Loopback only, owner-approved, validated output. `fetchImpl` is injectable for tests; production uses the global fetch. */
export function createOllamaProvider({ model, baseUrl = "http://127.0.0.1:11434", fetchImpl = globalThis.fetch, ownerAuth = null, ownerApproval = null, dim = null, timeoutMs = EMBED_LIMITS.timeoutMs } = {}) {
  const u = checkOllama(model, baseUrl);
  if (!ownerAuth) throw new Error("EMBEDDING_OWNER_AUTH_REQUIRED");
  const v = ownerAuth.verifyApproval(ownerApproval, { action: "EMBEDDING_ACTIVATE", subject: embedSubject("ollama", model) }); if (!v.allowed) throw new Error("EMBEDDING_OWNER_APPROVAL_REQUIRED:" + v.reason);
  return buildOllama({ model, u, fetchImpl, dim, timeoutMs });
}

// ---- Activation record. The signed approval is single use, so it is checked ONCE, when the owner activates; the runtime then reads this record at start-up (same trust level as the other state files).
// The record can only ever enable the loopback-only provider for a model name; it cannot name another host.
export function activateOllama({ configFile, model, baseUrl = "http://127.0.0.1:11434", ownerAuth, ownerApproval, nowFn = () => new Date().toISOString() } = {}) {
  const u = checkOllama(model, baseUrl);
  if (!ownerAuth) throw new Error("EMBEDDING_OWNER_AUTH_REQUIRED");
  const v = ownerAuth.verifyApproval(ownerApproval, { action: "EMBEDDING_ACTIVATE", subject: embedSubject("ollama", model) }); if (!v.allowed) throw new Error("EMBEDDING_OWNER_APPROVAL_REQUIRED:" + v.reason);
  const rec = { v: 1, provider: "ollama", model, baseUrl: u.origin, activatedAt: nowFn(), approvalNonce: v.nonce ?? null }, t = configFile + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 }); fs.writeFileSync(t, JSON.stringify(rec), { mode: 0o600 }); fs.renameSync(t, configFile); return rec;
}
export function deactivateEmbedding({ configFile } = {}) { try { fs.unlinkSync(configFile); return { ok: true, removed: true }; } catch (e) { return e?.code === "ENOENT" ? { ok: true, removed: false } : { ok: false, reason: "DEACTIVATE_FAILED:" + String(e?.code ?? "ERROR") }; } }
export function readActivation(configFile) {
  try {
    const r = JSON.parse(fs.readFileSync(configFile, "utf8")); if (r?.v !== 1 || r.provider !== "ollama") return null;
    const u = checkOllama(r.model, r.baseUrl); return { model: r.model, baseUrl: u.origin, activatedAt: String(r.activatedAt ?? ""), approvalNonce: r.approvalNonce ?? null };
  } catch { return null; }      // missing, damaged or tampered into something not loopback: no provider (lexical fallback)
}
export function loadActivatedProvider({ configFile, fetchImpl = globalThis.fetch, timeoutMs = EMBED_LIMITS.timeoutMs } = {}) {
  const a = readActivation(configFile); if (!a) return null;
  return buildOllama({ model: a.model, u: new URL(a.baseUrl), fetchImpl, dim: null, timeoutMs });
}

/** Deterministic toy embedder for tests ONLY. It groups words into a few hand-made topics so paraphrases land close together. It is not a neural model and says so. */
export function createFixtureProvider({ topics } = {}) {
  const T = topics ?? [["car", "vehicle", "automobile", "auto", "truck", "drive"], ["roof", "shingles", "gutter", "leak", "ceiling"], ["invoice", "bill", "payment", "receipt", "charge"], ["email", "message", "mail", "letter"], ["tax", "vat", "levy", "duty"], ["paint", "painting", "coat", "brush", "wall"]];
  const dim = T.length + 8, hash = w => { let h = 2166136261; for (const c of w) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  return {
    id: "fixture", kind: "TEST_FIXTURE", model: "toy-topics-v1", dim,
    async embed(texts) {
      checkTexts(texts);
      return texts.map(t => { const v = new Float32Array(dim); for (const w of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) { const i = T.findIndex(g => g.includes(w)); if (i >= 0) v[i] += 1; else v[T.length + (hash(w) % 8)] += 0.15; } if (!v.some(x => x)) v[dim - 1] = 1; return normalise(v); });
    }
  };
}
export const isNeural = p => Boolean(p) && p.kind === "NEURAL";
export const providerFingerprint = p => crypto.createHash("sha256").update([p.id, p.kind, p.model].join("\0")).digest("hex").slice(0, 16);
