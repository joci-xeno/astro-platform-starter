// Delivery adapter for authorised DIGITAL work products over an owner-approved, LOCAL channel: a hash-verified delivery package (artifacts + manifest) written under a fixed outbox.
// It proves that the verified artifacts exist, are unchanged and were packaged. It does NOT transmit anything to the customer: handing the package over is a separate, owner-approved external
// action, so evidence from this adapter says channelKind LOCAL_PACKAGE and is never customer receipt. Fail closed: every artifact must still match its registered hash and be QA-verified.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const sha = b => createHash("sha256").update(b).digest("hex");
export const APPROVED_CHANNEL = "LOCAL_PACKAGE";

export function createPackageDeliveryAdapter({ outboxDir, artifacts, environment = "SANDBOX", maxBytes = 25 * 1024 * 1024, now = () => new Date().toISOString() } = {}) {
  if (!outboxDir || !artifacts?.get || !artifacts?.read) throw new Error("OUTBOX_AND_ARTIFACT_REGISTRY_REQUIRED");
  fs.mkdirSync(outboxDir, { recursive: true, mode: 0o700 });
  const root = path.resolve(outboxDir);
  return { name: "package-delivery-adapter", channelKind: "LOCAL_PACKAGE", async deliver({ id, jobId, artifactIds, recipient, idempotencyKey }) {
    if (!/^dlv-\d{5}$/.test(String(id ?? ""))) return { accepted: false, reason: "DELIVERY_ID_INVALID" };
    if (!Array.isArray(artifactIds) || !artifactIds.length || artifactIds.length > 50) return { accepted: false, reason: "ARTIFACTS_REQUIRED" };
    const dir = path.resolve(root, id); if (path.dirname(dir) !== root) return { accepted: false, reason: "PATH_ESCAPE_REFUSED" };
    const manifestFile = path.join(dir, "manifest.json");
    if (fs.existsSync(manifestFile)) { try { const m = JSON.parse(fs.readFileSync(manifestFile, "utf8")); return { accepted: true, reference: "pkg-" + m.manifestSha256.slice(0, 24), environment, idempotent: true, channelKind: "LOCAL_PACKAGE" }; } catch { return { accepted: false, reason: "EXISTING_PACKAGE_UNREADABLE_NOT_OVERWRITTEN" }; } }
    const files = []; let total = 0;
    for (const aid of artifactIds) {
      const meta = artifacts.get(aid); if (!meta) return { accepted: false, reason: "UNKNOWN_ARTIFACT:" + aid };
      if (meta.verificationStatus !== "VERIFIED" || meta.verification?.hash !== meta.hash) return { accepted: false, reason: "ARTIFACT_NOT_QA_VERIFIED:" + aid };
      const buf = artifacts.read(aid); if (!buf) return { accepted: false, reason: "ARTIFACT_CONTENT_MISSING:" + aid };
      if (sha(buf) !== meta.hash) return { accepted: false, reason: "ARTIFACT_HASH_MISMATCH:" + aid };
      total += buf.length; if (total > maxBytes) return { accepted: false, reason: "PACKAGE_TOO_LARGE" };
      files.push({ artifactId: aid, name: "artifact-" + String(files.length + 1).padStart(2, "0") + ".bin", sha256: meta.hash, bytes: buf.length, buf });
    }
    const tmp = dir + ".partial"; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
    for (const f of files) fs.writeFileSync(path.join(tmp, f.name), f.buf, { mode: 0o400 });
    for (const f of files) if (sha(fs.readFileSync(path.join(tmp, f.name))) !== f.sha256) { fs.rmSync(tmp, { recursive: true, force: true }); return { accepted: false, reason: "POST_WRITE_VERIFICATION_FAILED" }; }
    const body = { deliveryId: id, jobId: jobId ?? null, recipient: recipient ?? null, idempotencyKey: idempotencyKey ?? null, createdAt: now(), environment, channelKind: "LOCAL_PACKAGE", files: files.map(({ buf, ...x }) => x), transmittedToCustomer: false };
    const manifestSha256 = sha(JSON.stringify(body)); fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({ ...body, manifestSha256 }, null, 1), { mode: 0o400 });
    fs.renameSync(tmp, dir);
    return { accepted: true, reference: "pkg-" + manifestSha256.slice(0, 24), environment, channelKind: "LOCAL_PACKAGE" };
  } };
}
