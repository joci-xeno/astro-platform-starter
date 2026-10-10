// Unified programme M5: owner-facing memory controls for the Control Center. Everything here is a thin layer over the real modules (memory-store, agent-memory, embedding-provider):
// no figure is invented, nothing reports success unless the underlying call did. Reads need only the dashboard token; every change that touches the signed-approval rules
// (forget, declassify, retention sweep, activating an embedding model) is signed from the keystore passphrase and bound to the exact subject, exactly like the other owner actions.
import path from "node:path";
import fs from "node:fs";
import { createMemoryStore } from "../atlasz-addons/memory-store.mjs";
import { createAgentMemory } from "../atlasz-addons/agent-memory.mjs";
import { detectEmbeddingRuntime, activateOllama, deactivateEmbedding, readActivation, loadActivatedProvider, embedSubject } from "../atlasz-addons/embedding-provider.mjs";

const CLASSES = ["PUBLIC", "PERSONAL", "CONFIDENTIAL"];
export function createMemoryPanel({ stateDir, ownerAuth, sign, fetchImpl = globalThis.fetch, detect = detectEmbeddingRuntime } = {}) {
  const storeDir = path.join(stateDir, "memory", "knowledge-store"), accDir = path.join(stateDir, "memory", "agent-access"), cfgFile = path.join(stateDir, "memory", "embedding-activation.json");
  let store = null, am = null;
  // The owner key may be provisioned (or replaced) while this process runs: look it up at every use, and treat "no key" as "not approved", never as an error that hides the panel.
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } } };
  const open = () => {
    if (store) return;
    store = createMemoryStore({ dir: storeDir, ownerAuth: auth, semanticProvider: loadActivatedProvider({ configFile: cfgFile, fetchImpl }) });
    am = createAgentMemory({ store, dir: accDir, ownerAuth: auth });
  };
  const reset = () => { try { store?.close(); } catch { /* closed */ } store = null; am = null; };
  const need = (v, what) => { if (typeof v !== "string" || !v) throw new Error(what + "_REQUIRED"); return v; };
  const approve = (passphrase, action, subject) => { need(passphrase, "PASSPHRASE"); const doc = sign(passphrase, action, subject); return doc; };

  /** Everything the Memory panel shows. Counts come from the store; "indexing" and "retrieval" come from its own status; errors come from the modules' own diagnostics. */
  function view({ limit = 100 } = {}) {
    open(); const st = store.status(), v = store.verify(), dg = am.diagnose(), n = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 100));
    const list = am.owner.list({ limit: n }), sem = store.semanticStatus(), act = readActivation(cfgFile), hw = detect();
    const quarantine = (() => { try { return fs.readdirSync(path.join(storeDir, "quarantine")).slice(-20); } catch { return []; } })();
    const tagOf = (tags, pfx) => tags.filter(t => t.startsWith(pfx)).map(t => t.slice(pfx.length));
    return {
      state: "CONNECTED", tenantId: am.tenantId,
      store: { backend: st.backend, notes: st.notes, byClassification: st.byClassification, quarantined: st.quarantined, trashed: st.trashed, searches: st.searches, hiddenAttempts: st.hiddenAttempts, auditOk: v.auditOk, consistent: v.consistent, externallyEdited: v.externallyEdited, unreadable: v.unreadable, classificationMismatch: v.classificationMismatch, files: v.files, indexed: v.indexed },
      indexing: { backend: st.backend, lexical: st.backend === "SQLITE_FTS5" ? "SQLite FTS5 (BM25)" : "in-memory lexical fallback (SQLite/FTS5 unavailable)", ngramSimilarity: "local hashed n-gram (NOT neural)", semantic: sem },
      embedding: { activation: act, runtime: { node: hw.node, platform: hw.platform, arch: hw.arch, cpus: hw.cpus, ramMB: hw.ramMB, accel: hw.accel, ollamaBinary: hw.ollama.binary, onnxruntimeNode: hw.onnx.onnxruntimeNode, neuralReady: hw.neuralReady, blockers: hw.blockers, recommendation: hw.recommendation, candidates: hw.candidates.map(c => ({ id: c.id, sizeMB: c.sizeMB, dim: c.dim, languages: c.languages, license: c.license, fit: c.fit, usableNow: c.usableNow })) }, approvalNeeded: act ? null : { action: "EMBEDDING_ACTIVATE", subjectFor: "embedding:ollama:<model>", prerequisites: hw.blockers } },
      notes: list.ok ? list.notes.map(x => ({ id: x.id, title: x.title, classification: x.classification, updated: x.updated, scope: tagOf(x.tags, "scope-")[0] ?? "owner/unscoped", kind: tagOf(x.tags, "kind-")[0] ?? null, provenance: tagOf(x.tags, "prov-")[0] ?? null, project: tagOf(x.tags, "proj-")[0] ?? null, agent: tagOf(x.tags, "agent-")[0] ?? null, ttl: tagOf(x.tags, "ttl-")[0] ?? null })) : [],
      pendingForgets: am.owner.pendingForgets().map(p => ({ ...p, subject: store.forgetSubject(p.id)?.subject ?? null })),
      retention: am.owner.retentionPreview(),
      agents: am.owner.activity(), accessLog: am.owner.accessLog(30).map(e => ({ at: e.at ?? e.ts ?? null, event: e.event, data: e.data })),
      diagnostics: { agentMemory: dg, quarantineFiles: quarantine, auditOk: { store: store.auditVerify().ok, access: am.auditVerify().ok }, recentErrors: dg.recentErrors }
    };
  }

  async function action({ op, ...a } = {}) {
    open();
    switch (op) {
      case "search": { const r = await am.owner.search({ query: a.query, limit: a.limit ?? 10 }); return r.ok ? { ok: true, retrieval: r.retrieval, backend: r.backend, semantic: r.semantic, results: r.results.map(x => ({ id: x.id, title: x.title, classification: x.classification, tags: x.tags, score: x.score, lexical: x.lexical, similarity: x.similarity, neural: x.neural, passage: x.passage })) } : r; }
      case "get": return store.get(need(a.id, "ID"), { id: "OWNER", clearance: "CONFIDENTIAL" });
      case "addNote": {
        const cls = a.classification ?? "PERSONAL"; if (!CLASSES.includes(cls)) throw new Error("CLASSIFICATION_INVALID");
        return store.write({ authorId: "OWNER", title: a.title, body: a.body, tags: Array.isArray(a.tags) ? a.tags : [], classification: cls, source: "owner:control-center", clearance: "CONFIDENTIAL" });
      }
      case "approveForget": { const id = need(a.id, "ID"), sub = store.forgetSubject(id); if (!sub) throw new Error("NOT_FOUND"); return am.owner.approveForget(id, approve(a.passphrase, sub.action, sub.subject)); }
      case "rejectForget": return am.owner.rejectForget(need(a.id, "ID"));
      case "forget": { const id = need(a.id, "ID"), sub = store.forgetSubject(id); if (!sub) throw new Error("NOT_FOUND"); return am.owner.forgetNow(id, approve(a.passphrase, sub.action, sub.subject)); }
      case "declassify": { const id = need(a.id, "ID"), sub = store.declassifySubject(id, a.to); if (!sub) throw new Error("NOT_A_LOWERING_OR_NOT_FOUND"); return store.update(id, { authorId: "OWNER", clearance: "CONFIDENTIAL", classification: a.to }, { ownerApproval: approve(a.passphrase, sub.action, sub.subject) }); }
      case "retentionApply": { const p = am.owner.retentionPreview(); if (!p.ok) return p; if (!p.ids.length) return { ok: true, retired: [] }; if (typeof a.subject !== "string" || a.subject !== p.subject) throw new Error("REVIEWED_SET_CHANGED"); return am.owner.retentionApply(approve(a.passphrase, p.action, p.subject), { subject: a.subject }); }
      case "rebuildIndex": return store.rebuildIndex({ reason: "OWNER_CONTROL_CENTER" });
      case "verify": return store.verify();
      case "reindexSemantic": return store.reindexSemantic({ maxNotes: a.maxNotes ?? 200, full: a.full === true });
      case "activateEmbedding": {
        const model = need(a.model, "MODEL"); if (!hasPassphrase(a)) throw new Error("PASSPHRASE_REQUIRED");
        const rec = activateOllama({ configFile: cfgFile, model, ownerAuth: auth, ownerApproval: sign(a.passphrase, "EMBEDDING_ACTIVATE", embedSubject("ollama", model)) });
        reset(); return { ok: true, activation: { model: rec.model, baseUrl: rec.baseUrl, activatedAt: rec.activatedAt }, note: "Activated for local use only. This does NOT install or download anything: the model must already be present in the local Ollama. Run a reindex to build the vectors; until then and whenever the server is unreachable, search stays lexical." };
      }
      case "deactivateEmbedding": { const r = deactivateEmbedding({ configFile: cfgFile }); reset(); return r; }
      default: throw new Error("UNKNOWN_MEMORY_OP");
    }
  }
  const hasPassphrase = a => typeof a.passphrase === "string" && a.passphrase.length > 0;
  return { view, action, close: reset };
}
