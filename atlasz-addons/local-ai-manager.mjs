// 23-point item 6: Local AI manager (Ollama). Discovery, status, fit table, install PLAN (text only), registry hand-off.
// WHAT THIS IS: a read-only manager for a LOCAL Ollama server on 127.0.0.1. WHAT IT IS NOT: an installer. It never downloads, installs, starts,
// pulls or executes anything (no child_process import; plan() returns text for the OWNER to read and run by hand).
//   discoverHardware()         reuses embedding-provider detectEmbeddingRuntime (RAM, CPU, GPU hints, Ollama binary on PATH). No network.
//   status()                   GET /api/version + /api/tags on the loopback base URL through an INJECTED fetchImpl. Every response is size-capped
//                              (streamed with a byte limit), parsed with reserved keys dropped, and validated field by field; malformed data is never trusted.
//                              Vocabulary: NOT_INSTALLED / INSTALLED_NOT_RUNNING / RUNNING / MODEL_PRESENT. There is no LIVE here: a local server
//                              answering is not evidence that a model produces useful output.
//   fitTable()                 chat-model RAM/CPU fit against this machine. The table is an ESTIMATE (approximate Q4 sizes from public model pages,
//                              not verified offline) and the owner may replace it (setFitTable, validated).
//   plan({model})              the exact install/serve/pull/verify steps as TEXT. executes:false always. The model name is validated so the text is shell-safe.
//   registerDiscovered(reg)    adds discovered local models to a model-registry (createModelRegistry API) as DISABLED, LOCAL, FREE entries on the
//                              loopback-only "ollama-local" provider. It never enables anything.
//   health()                   loopback probe (version endpoint) with latency; result is PROBE_PASSED / PROBE_FAILED, never LIVE.
// Base URL: only http://127.0.0.1[:port] exactly. "localhost", [::1], 0x7f.1, 2130706433, userinfo, paths and https to other hosts are refused
// (names can be re-pointed; numeric IPv4 forms normalise silently in WHATWG URL parsing, so the RAW string is checked).
// Status honesty: IMPLEMENTED + unit TESTED with fake fetch. Not CONNECTED to a real Ollama in this repository; not LIVE.
import crypto from "node:crypto";
import { detectEmbeddingRuntime } from "./embedding-provider.mjs";
import { SEED_PROVIDERS } from "./model-registry.mjs";
import { emergencyGate } from "./emergency-stop.mjs";
import { RESERVED } from "./safe-keys.mjs";

export const LOCAL_AI_STATUSES = Object.freeze(["NOT_INSTALLED", "INSTALLED_NOT_RUNNING", "RUNNING", "MODEL_PRESENT"]);
export const LOCAL_AI_LIMITS = Object.freeze({ maxResponseBytes: 1024 * 1024, maxModels: 200, timeoutMs: 5000, maxFitEntries: 60, maxText: 120 });
export const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_PROVIDER_ID = "ollama-local";
// Ollama model name: [namespace/]name[:tag]. Letters, digits, . _ - only, so the name is also safe to show inside a shell command.
export const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,2}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:[-+.][0-9A-Za-z.-]{1,40})?$/;
const DIGEST_RE = /^(?:sha256:)?[a-f0-9]{12,64}$/;
const BASE_RE = /^http:\/\/127\.0\.0\.1(?::([1-9]\d{0,4}))?\/?$/;
const REG_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ctl = /[\u0000-\u001f\u007f\u2028\u2029\p{Cf}]/u;
const sha = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const err = code => Object.assign(new Error(code), { code });

/** Chat-model fit data. ESTIMATE: approximate download size and working RAM for the default (about 4-bit) quantisation, from public model pages.
 *  Not verified offline; tags and sizes change. The owner edits this table (setFitTable). It is planning data, never evidence that a model exists. */
export const CHAT_MODEL_FIT_TABLE = Object.freeze([
  { model: "llama3.2:1b", params: "1B", approxDownloadGB: 1.3, approxRamGB: 2, minCpuCores: 2, languages: "multilingual (Hungarian quality unverified)", note: "Smallest usable chat model; weak reasoning." },
  { model: "gemma2:2b", params: "2B", approxDownloadGB: 1.6, approxRamGB: 3, minCpuCores: 2, languages: "multilingual (Hungarian quality unverified)", note: "Small; licence terms are Google's Gemma terms." },
  { model: "llama3.2:3b", params: "3B", approxDownloadGB: 2.0, approxRamGB: 4, minCpuCores: 4, languages: "multilingual (Hungarian quality unverified)", note: "Reasonable small default on 8 GB machines." },
  { model: "phi3:mini", params: "3.8B", approxDownloadGB: 2.2, approxRamGB: 4, minCpuCores: 4, languages: "English-centred", note: "Good English reasoning for its size." },
  { model: "mistral:7b", params: "7B", approxDownloadGB: 4.1, approxRamGB: 8, minCpuCores: 4, languages: "English + major European languages", note: "Apache-2.0." },
  { model: "qwen2.5:7b", params: "7B", approxDownloadGB: 4.7, approxRamGB: 8, minCpuCores: 4, languages: "multilingual (Hungarian quality unverified)", note: "Strong multilingual quality for its size." },
  { model: "llama3.1:8b", params: "8B", approxDownloadGB: 4.9, approxRamGB: 8, minCpuCores: 4, languages: "multilingual (Hungarian quality unverified)", note: "Llama community licence." },
  { model: "gemma2:9b", params: "9B", approxDownloadGB: 5.4, approxRamGB: 10, minCpuCores: 6, languages: "multilingual (Hungarian quality unverified)", note: "Gemma terms." },
  { model: "qwen2.5:14b", params: "14B", approxDownloadGB: 9.0, approxRamGB: 16, minCpuCores: 8, languages: "multilingual (Hungarian quality unverified)", note: "Needs a 32 GB machine to be comfortable." },
  { model: "llama3.3:70b", params: "70B", approxDownloadGB: 43, approxRamGB: 64, minCpuCores: 16, languages: "multilingual (Hungarian quality unverified)", note: "Workstation class; CPU-only inference is very slow." }
]);
export const FIT_TABLE_LABEL = "ESTIMATE";

/** Raw-string loopback check. Returns {origin, port} or throws LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1. */
export function assertLoopbackBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.length > 40) throw err("LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1");
  const m = BASE_RE.exec(baseUrl); if (!m) throw err("LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1");
  const port = m[1] ? Number(m[1]) : 80; if (port > 65535) throw err("LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1");
  let u; try { u = new URL(baseUrl); } catch { throw err("LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1"); }
  if (u.hostname !== "127.0.0.1" || u.username || u.password || u.protocol !== "http:") throw err("LOCAL_AI_BASE_URL_MUST_BE_127_0_0_1");      // belt and braces: the WHATWG view must agree
  return { origin: u.origin, port };
}

/** Validate an owner-supplied fit table. Returns {table} or {error}. */
export function validateFitTable(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > LOCAL_AI_LIMITS.maxFitEntries) return { error: "FIT_TABLE_SIZE_INVALID" };
  const out = [], seen = new Set();
  for (const e of entries) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return { error: "FIT_ENTRY_NOT_OBJECT" };
    if (typeof e.model !== "string" || !MODEL_NAME_RE.test(e.model) || seen.has(e.model)) return { error: "FIT_ENTRY_MODEL_INVALID:" + String(e.model).slice(0, 40) };
    const n = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
    if (!n(e.approxDownloadGB, 0.01, 2000) || !n(e.approxRamGB, 0.1, 4096) || !(Number.isInteger(e.minCpuCores) && e.minCpuCores >= 1 && e.minCpuCores <= 512)) return { error: "FIT_ENTRY_NUMBERS_INVALID:" + e.model };
    const txt = v => v === undefined ? "" : typeof v === "string" && v.length <= LOCAL_AI_LIMITS.maxText && !ctl.test(v) ? v : null;
    const params = txt(e.params), languages = txt(e.languages), note = txt(e.note);
    if (params === null || languages === null || note === null) return { error: "FIT_ENTRY_TEXT_INVALID:" + e.model };
    seen.add(e.model); out.push(Object.freeze({ model: e.model, params, approxDownloadGB: e.approxDownloadGB, approxRamGB: e.approxRamGB, minCpuCores: e.minCpuCores, languages, note }));
  }
  return { table: Object.freeze(out) };
}

/** Fit rating for one entry against a hardware summary {ramMB, cpus}. ESTIMATE. */
export function rateFit(entry, hw) {
  const ramGB = (hw?.ramMB ?? 0) / 1024, cpus = hw?.cpus ?? 0;
  const fit = ramGB >= entry.approxRamGB * 1.5 && cpus >= entry.minCpuCores ? "COMFORTABLE" : ramGB >= entry.approxRamGB ? "TIGHT" : "TOO_LARGE";
  return { ...entry, fit, basis: FIT_TABLE_LABEL };
}

async function readBounded(res, max) {
  const cl = typeof res?.headers?.get === "function" ? res.headers.get("content-length") : null;
  if (cl !== null && cl !== undefined && Number(cl) > max) throw err("RESPONSE_TOO_LARGE");
  if (res?.body && typeof res.body.getReader === "function") {
    const r = res.body.getReader(), chunks = []; let n = 0;
    for (;;) {
      const { done, value } = await r.read(); if (done) break;
      const b = value instanceof Uint8Array ? value : Buffer.from(String(value));
      n += b.byteLength; if (n > max) { try { await r.cancel(); } catch { /* ignore */ } throw err("RESPONSE_TOO_LARGE"); }
      chunks.push(b);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  if (typeof res?.text !== "function") throw err("RESPONSE_UNREADABLE");
  const t = await res.text(); if (typeof t !== "string") throw err("RESPONSE_UNREADABLE");
  if (Buffer.byteLength(t) > max) throw err("RESPONSE_TOO_LARGE");
  return t;
}
const parseJson = t => { try { return JSON.parse(t, (k, v) => (RESERVED.has(k) ? undefined : v)); } catch { throw err("RESPONSE_NOT_JSON"); } };

/** Validate one /api/tags entry. Returns the clean entry or null. */
export function validateTagEntry(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const name = typeof e.name === "string" ? e.name : typeof e.model === "string" ? e.model : null;
  if (!name || !MODEL_NAME_RE.test(name)) return null;
  if (e.size !== undefined && !(Number.isSafeInteger(e.size) && e.size >= 0 && e.size <= 4 * 1024 ** 4)) return null;
  if (e.digest !== undefined && !(typeof e.digest === "string" && DIGEST_RE.test(e.digest))) return null;
  const d = e.details && typeof e.details === "object" && !Array.isArray(e.details) ? e.details : {};
  const s = v => (typeof v === "string" && v.length <= 40 && /^[A-Za-z0-9._ -]*$/.test(v) ? v : null);
  return { name, sizeBytes: e.size ?? null, digest: e.digest ? e.digest.replace(/^sha256:/, "") : null, family: s(d.family), parameterSize: s(d.parameter_size), quantization: s(d.quantization_level), format: s(d.format) };
}

export function registryIdFor(name) {
  let id = "ollama-" + String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
  if (id.length > 64) id = id.slice(0, 55).replace(/[-.]+$/, "") + "-" + sha(name).slice(0, 8);
  return REG_ID_RE.test(id) ? id : null;
}

export function createLocalAiManager({ baseUrl = DEFAULT_BASE_URL, fetchImpl = null, detect = detectEmbeddingRuntime, detectOptions = {}, gate = emergencyGate, fitTable = CHAT_MODEL_FIT_TABLE, now = () => new Date().toISOString(), clock = () => Date.now(), timeoutMs = LOCAL_AI_LIMITS.timeoutMs, maxResponseBytes = LOCAL_AI_LIMITS.maxResponseBytes } = {}) {
  const base = assertLoopbackBaseUrl(baseUrl);      // refused at construction: a non-loopback manager never exists
  if (!(Number.isInteger(maxResponseBytes) && maxResponseBytes > 0 && maxResponseBytes <= LOCAL_AI_LIMITS.maxResponseBytes)) throw err("MAX_RESPONSE_BYTES_INVALID");
  let table = validateFitTable(fitTable).table; if (!table) throw err("FIT_TABLE_INVALID");
  let last = null;

  function discoverHardware() {
    let r; try { r = detect(detectOptions); } catch (e) { return { ok: false, reason: "HARDWARE_DETECTION_FAILED", detail: String(e?.message ?? e).slice(0, 120) }; }
    return { ok: true, platform: r.platform, arch: r.arch, cpus: r.cpus, ramMB: r.ramMB, freeMB: r.freeMB, gpu: r.gpu, accel: r.accel, ollamaBinaryFound: Boolean(r.ollama?.binary), node: r.node, note: "Detection only: nothing was downloaded, installed or started, and no network call was made." };
  }

  async function get(pathname) {
    if (typeof fetchImpl !== "function") throw err("FETCH_NOT_CONFIGURED");
    const url = base.origin + pathname, ac = new AbortController(); let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(err("TIMEOUT")); }, timeoutMs); });
    try {
      const res = await Promise.race([Promise.resolve().then(() => fetchImpl(url, { method: "GET", redirect: "error", signal: ac.signal, headers: { accept: "application/json" } })), timeout]);
      if (!res || typeof res !== "object") throw err("RESPONSE_INVALID");
      if (typeof res.url === "string" && res.url && res.url !== url) throw err("RESPONSE_FROM_OTHER_URL");      // a redirect slipped through: refuse
      if (res.status !== 200) throw err("HTTP_" + (Number.isInteger(res.status) ? res.status : "INVALID"));
      return parseJson(await Promise.race([readBounded(res, maxResponseBytes), timeout]));
    } catch (e) { throw err(e?.code ?? (e?.name === "AbortError" ? "TIMEOUT" : "UNREACHABLE")); }
    finally { clearTimeout(timer); }
  }

  async function status() {
    const g = gate({ external: false }); if (g && g.allowed === false) return (last = { ok: false, state: null, reason: "EMERGENCY_STOP:" + g.reason, checkedAt: now() });
    const hw = discoverHardware(), binary = hw.ok && hw.ollamaBinaryFound;
    let version = null, versionError = null;
    try { const v = await get("/api/version"); if (!v || typeof v !== "object" || typeof v.version !== "string" || !VERSION_RE.test(v.version)) throw err("VERSION_MALFORMED"); version = v.version; }
    catch (e) { versionError = e.code ?? "UNREACHABLE"; }
    if (version === null) {
      const state = binary ? "INSTALLED_NOT_RUNNING" : "NOT_INSTALLED";
      return (last = { ok: true, state, baseUrl: base.origin, binaryFound: binary, version: null, models: [], probe: versionError, checkedAt: now(),
        note: state === "NOT_INSTALLED" ? "No Ollama binary on PATH and nothing answered on the loopback port. Installing is an owner decision (see plan())." : "The binary is present but the loopback server did not answer. Starting it is an owner action (ollama serve)." });
    }
    let models = [], rejected = 0, tagsError = null;
    try {
      const t = await get("/api/tags");
      if (!t || typeof t !== "object" || !Array.isArray(t.models)) throw err("TAGS_MALFORMED");
      if (t.models.length > LOCAL_AI_LIMITS.maxModels) throw err("TOO_MANY_MODELS");
      const seen = new Set();
      for (const e of t.models) { const c = validateTagEntry(e); if (!c || seen.has(c.name)) { rejected++; continue; } seen.add(c.name); models.push(c); }
    } catch (e) { tagsError = e.code ?? "TAGS_FAILED"; models = []; }
    const state = models.length ? "MODEL_PRESENT" : "RUNNING";
    return (last = { ok: true, state, baseUrl: base.origin, binaryFound: binary, version, models, rejectedEntries: rejected, tagsError, checkedAt: now(),
      note: (binary ? "" : "Server answered on loopback but no binary is on PATH (container or other install). ") + "RUNNING/MODEL_PRESENT means the local server answered; it is not evidence of output quality and not LIVE." });
  }

  async function health() {
    const g = gate({ external: false }); if (g && g.allowed === false) return { ok: false, result: "PROBE_NOT_RUN", reason: "EMERGENCY_STOP:" + g.reason };
    const t0 = clock();
    try { const v = await get("/api/version"); if (!v || typeof v.version !== "string" || !VERSION_RE.test(v.version)) throw err("VERSION_MALFORMED"); return { ok: true, result: "PROBE_PASSED", version: v.version, latencyMs: Math.max(0, clock() - t0), at: now(), target: base.origin + "/api/version", note: "Loopback version probe only; not a generation test; not LIVE." }; }
    catch (e) { return { ok: false, result: "PROBE_FAILED", reason: e.code ?? "UNREACHABLE", latencyMs: Math.max(0, clock() - t0), at: now() }; }
  }

  function fit(hw = null) {
    const h = hw ?? discoverHardware();
    if (!h || h.ok === false) return { ok: false, reason: "HARDWARE_UNKNOWN", label: FIT_TABLE_LABEL };
    return { ok: true, label: FIT_TABLE_LABEL, note: "ESTIMATE: approximate sizes for the default ~4-bit quantisation; not verified offline. Owner-editable.", ramMB: h.ramMB, cpus: h.cpus, accel: h.accel, models: table.map(e => rateFit(e, h)) };
  }
  function setFitTable(entries) { const v = validateFitTable(entries); if (v.error) return { ok: false, reason: v.error }; table = v.table; return { ok: true, entries: table.length, label: FIT_TABLE_LABEL }; }

  /** Install/pull steps as TEXT ONLY. Never executes. */
  function plan({ model = null, platform = null, hardware = null } = {}) {
    if (model !== null && (typeof model !== "string" || !MODEL_NAME_RE.test(model))) return { ok: false, executes: false, reason: "MODEL_NAME_INVALID" };
    const hw = hardware ?? discoverHardware(), plat = platform ?? (hw.ok ? hw.platform : null);
    if (!["linux", "darwin", "win32"].includes(plat)) return { ok: false, executes: false, reason: "PLATFORM_UNSUPPORTED_OR_UNKNOWN" };
    const entry = model ? table.find(e => e.model === model) ?? null : null, rated = entry && hw.ok ? rateFit(entry, hw) : null;
    const steps = [];
    const add = (title, text, command = null) => steps.push(Object.freeze({ n: steps.length + 1, title, text, command }));
    if (!(last && last.state && last.state !== "NOT_INSTALLED")) {
      if (plat === "linux") add("Review and install Ollama", "Download the official install script, READ it, then run it. This is an owner action; ATLASZ does not run it.", "curl -fsSL https://ollama.com/install.sh -o ollama-install.sh && less ollama-install.sh && sh ollama-install.sh");
      else add("Install Ollama", "Download the official installer for this platform from https://ollama.com/download and install it by hand. Verify the publisher signature before running it.", null);
    }
    add("Start the server on loopback only", "Bind to 127.0.0.1 so nothing outside this machine can reach it.", plat === "win32" ? "set OLLAMA_HOST=127.0.0.1:" + base.port + " && ollama serve" : "OLLAMA_HOST=127.0.0.1:" + base.port + " ollama serve");
    if (model) {
      add("Pull the model (download)", "Downloads the model weights" + (entry ? " (about " + entry.approxDownloadGB + " GB, ESTIMATE)" : " (size unknown: not in the fit table)") + ". Check the licence first. This is an owner decision.", "ollama pull " + model);
      add("Verify", "Confirm the model is listed, then let ATLASZ re-read the status (it will register the model DISABLED).", "ollama list");
    } else add("Choose a model", "Pick a model from fitTable() that is COMFORTABLE or TIGHT for this machine, then ask for plan({model}).", null);
    const warnings = [];
    if (rated?.fit === "TOO_LARGE") warnings.push("ESTIMATE says this model is TOO_LARGE for this machine's RAM.");
    if (model && !entry) warnings.push("Model is not in the fit table: size, RAM need and licence are unknown.");
    return Object.freeze({ ok: true, executes: false, kind: "TEXT_PLAN_ONLY", platform: plat, model, fit: rated ? rated.fit : null, basis: FIT_TABLE_LABEL, steps: Object.freeze(steps), warnings: Object.freeze(warnings), ownerActionRequired: true,
      note: "Text only. ATLASZ never downloads, installs, starts or pulls anything; the owner runs these steps by hand. Nothing here costs money, but downloads use bandwidth and disk." });
  }

  /** Add discovered local models to a model registry as DISABLED, LOCAL, FREE entries. Uses the last status() unless one is given. */
  function registerDiscovered(registry, { statusResult = null } = {}) {
    const s = statusResult ?? last;
    if (!registry || typeof registry.addModel !== "function" || typeof registry.listProviders !== "function" || typeof registry.getModel !== "function") return { ok: false, reason: "REGISTRY_REQUIRED" };
    if (!s || !s.ok || s.state !== "MODEL_PRESENT" || !Array.isArray(s.models)) return { ok: false, reason: "NO_DISCOVERED_MODELS_RUN_STATUS_FIRST" };
    let prov = registry.listProviders().find(p => p.id === OLLAMA_PROVIDER_ID);
    if (!prov) { const seed = SEED_PROVIDERS.find(p => p.id === OLLAMA_PROVIDER_ID); const r = registry.addProvider({ ...seed, egressHosts: [...seed.egressHosts] }); if (!r.ok) return { ok: false, reason: "PROVIDER_ADD_FAILED:" + r.reason }; prov = registry.listProviders().find(p => p.id === OLLAMA_PROVIDER_ID); }
    if (!prov || prov.kind !== "LOCAL" || JSON.stringify(prov.egressHosts) !== JSON.stringify(["127.0.0.1"]) || prov.credentialRef !== null) return { ok: false, reason: "OLLAMA_PROVIDER_NOT_LOOPBACK_LOCAL" };
    const added = [], skipped = [], refused = [];
    for (const m of s.models.slice(0, LOCAL_AI_LIMITS.maxModels)) {
      const c = validateTagEntry({ name: m.name, size: m.sizeBytes ?? undefined, digest: m.digest ?? undefined }); const id = c ? registryIdFor(c.name) : null;
      if (!c || !id) { refused.push({ name: String(m?.name).slice(0, 80), reason: "NAME_INVALID" }); continue; }
      if (registry.getModel(id)) { skipped.push({ id, reason: "ALREADY_REGISTERED" }); continue; }
      const embed = /embed/i.test(c.name) || /bert/i.test(m.family ?? "");
      const r = registry.addModel({ id, providerId: OLLAMA_PROVIDER_ID, displayName: ("Ollama " + c.name).slice(0, 200), version: c.digest ? "0.0.0-d" + c.digest.slice(0, 12) : "0.0.0", costClass: "FREE", costPer1kTokensUsd: 0, capabilities: [embed ? "embedding" : "text"] });
      if (r.ok) added.push({ id, name: c.name, capabilityGuess: embed ? "embedding" : "text", enabled: false }); else refused.push({ id, reason: r.reason });
    }
    return { ok: true, added, skipped, refused, note: "Registered DISABLED. Enabling a free local model is a separate registry action; the capability is a guess from the name." };
  }

  return { discoverHardware, status, health, fit, fitTable: fit, setFitTable, plan, registerDiscovered, lastStatus: () => (last ? structuredClone(last) : null), baseUrl: base.origin,
    summary: () => ({ implementation: "IMPLEMENTED", connected: false, live: false, lastState: last?.state ?? null, note: "Read-only manager. Status comes from a loopback probe through the injected fetch; no install, no download, no execution." }) };
}
