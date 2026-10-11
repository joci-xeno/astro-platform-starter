// Owner-facing Security Center (23-point items 3/4: malware defences, intrusion detection). Today it connects ONE real control: the file quarantine.
// Honest by construction: it lists what is held, verifies the quarantine audit chain and stored hashes, and releases or deletes a held file only with a signed,
// single-use owner approval bound to the exact file (and, for release, a fixed destination inside the app's own "quarantine-released" folder, never an owner-typed path).
// The wiring list says exactly what is and is not connected; no scanner is configured, so "no detection" is never reported as "clean".
import fs from "node:fs";
import path from "node:path";
import { anchorAddSubject, anchorRemoveSubject, keyIdOf } from "../atlasz-addons/release-signing.mjs";
import { createQuarantine, releaseSubject, deleteSubject, sanitiseName } from "../atlasz-addons/quarantine.mjs";

export function createSecurityCenterPanel({ stateDir, ownerAuth, sign, isStopped = () => false, scanner = null, releaseVerifier = null } = {}) {
  const dir = path.join(stateDir, "quarantine"), outDir = path.join(stateDir, "quarantine-released");
  const auth = { verifyApproval: (...a) => { try { return ownerAuth().verifyApproval(...a); } catch { return { allowed: false, reason: "NO_OWNER_KEY" }; } } };
  let q = null;
  const quarantine = () => (q ??= createQuarantine({ dir, ownerAuth: auth, scanner, isStopped }));
  const need = (v, w) => { if (typeof v !== "string" || !v) throw new Error(w + "_REQUIRED"); return v; };
  const SHA = /^[0-9a-f]{64}$/;

  const anchors = () => { try { return { ok: true, list: releaseVerifier ? releaseVerifier().listTrustAnchors().map(a => ({ keyId: a.keyId, components: a.components, label: a.label })) : [] }; } catch (e) { return { ok: false, list: [], error: String(e?.message ?? e).slice(0, 100) }; } };
  function view() {
    const c = quarantine(), v = c.verify();
    const items = c.list().map(r => ({ sha256: r.sha256, name: r.originalName, size: r.size, type: r.type, status: r.status, assessment: r.assessment, reason: r.reason, source: r.source, at: r.quarantinedAt,
      findings: (r.findings ?? []).slice(0, 8).map(f => f.code), scan: r.scan?.status, storedIntact: r.storedIntact })).slice(-200);
    return { state: "CONNECTED", trustAnchors: anchors(), status: c.status(), integrity: { ok: v.ok, chainOk: v.chain?.ok ?? false, tampered: v.tampered ?? [], unrecorded: v.unrecorded ?? [], reason: v.reason ?? null }, items,
      wiring: [
        { name: "Document ingest pre-scan", state: "CONNECTED", note: "Blocking archive/executable findings are held here instead of being stored." },
        { name: "Malware scanner", state: scanner ? "CONFIGURED_UNTESTED" : "BLOCKED_NO_SCANNER_CHOSEN", note: "Only structural checks run until the owner approves a scanner. No detection would not mean safe." },
        { name: "Inbox / downloads intake", state: "NOT_CONNECTED" }, { name: "Update signature verification", state: releaseVerifier ? "CONNECTED_TO_STAGING" : "NOT_CONNECTED", note: "Packages carrying release-signature.json are verified before staging; unsigned ones are staged but labelled UNSIGNED. Requiring a signature is off until you add a trust anchor." }, { name: "Ransomware canary monitor", state: "NOT_CONNECTED" }],
      note: "Held files are never opened, executed or indexed. Releasing needs your signed approval for that exact file." };
  }
  function action(a) {
    const c = quarantine();
    switch (a.op) {
      case "verify": return { ok: true, ...c.verify() };
      case "release": {
        const sha = need(a.sha256, "SHA256"); if (!SHA.test(sha)) return { ok: false, reason: "SHA256_INVALID" };
        const rec = c.get(sha); if (!rec) return { ok: false, reason: "NOT_IN_QUARANTINE" };
        fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
        const dest = path.join(outDir, sha.slice(0, 12) + "-" + sanitiseName(rec.originalName ?? "file"));
        need(a.passphrase, "PASSPHRASE");
        return c.release(sha, { destPath: dest, ownerApproval: sign(a.passphrase, "QUARANTINE_RELEASE", releaseSubject(sha, dest)) });
      }
      case "delete": { const sha = need(a.sha256, "SHA256"); if (!SHA.test(sha)) return { ok: false, reason: "SHA256_INVALID" }; need(a.passphrase, "PASSPHRASE"); return c.remove(sha, { ownerApproval: sign(a.passphrase, "QUARANTINE_DELETE", deleteSubject(sha)) }); }
      case "anchorAdd": {
        if (!releaseVerifier) return { ok: false, reason: "RELEASE_VERIFIER_NOT_AVAILABLE" };
        const pk = need(a.publicKeyB64, "PUBLIC_KEY"), comps = String(need(a.components, "COMPONENTS")).split(",").map(x => x.trim()).filter(Boolean); need(a.passphrase, "PASSPHRASE");
        const kid = keyIdOf(pk); releaseVerifier().addTrustAnchor({ publicKeyB64: pk, components: comps, label: String(a.label ?? "").slice(0, 80) }, { ownerApproval: sign(a.passphrase, "RELEASE_TRUST_ANCHOR_ADD", anchorAddSubject(kid, pk, comps)) });
        return { ok: true, keyId: kid };
      }
      case "anchorRemove": { if (!releaseVerifier) return { ok: false, reason: "RELEASE_VERIFIER_NOT_AVAILABLE" }; const kid = need(a.keyId, "KEY_ID"); need(a.passphrase, "PASSPHRASE"); return { ok: true, removed: releaseVerifier().removeTrustAnchor(kid, { ownerApproval: sign(a.passphrase, "RELEASE_TRUST_ANCHOR_REMOVE", anchorRemoveSubject(kid)) }) }; }
      default: throw new Error("UNKNOWN_SECURITY_OP");
    }
  }
  return { view, action, quarantine };
}
