// V7.3 §47 Commercial / licensing FOUNDATION (no sale, nothing published): strict per-tenant directories, per-tenant config and vault namespace,
// and owner-signed entitlements. JOCI's own data lives in the reserved tenant "JOCI" and is unreachable from any customer tenant.
import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify, sign, createPrivateKey } from "node:crypto";

export const OWNER_TENANT = "JOCI";
const ID = /^[a-z][a-z0-9-]{2,40}$/;
const canon = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}));

export function createTenantRegistry({ rootDir } = {}) {
  if (!rootDir) throw new Error("ROOT_DIR_REQUIRED");
  fs.mkdirSync(rootDir, { recursive: true });
  const regFile = path.join(rootDir, "tenants.json");
  let reg = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, "utf8")) : { tenants: {} };
  const save = () => { const t = regFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(reg)); fs.renameSync(t, regFile); };
  const valid = id => id === OWNER_TENANT || ID.test(String(id));
  function create(id, { displayName = id } = {}) {
    if (!valid(id)) throw new Error("BAD_TENANT_ID"); if (reg.tenants[id]) throw new Error("TENANT_EXISTS");
    const base = path.join(rootDir, "tenants", id);
    for (const sub of ["data", "config", "vault", "documents"]) fs.mkdirSync(path.join(base, sub), { recursive: true, mode: 0o700 });
    reg.tenants[id] = { id, displayName, createdAt: new Date().toISOString(), vaultNamespace: "tenant:" + createHash("sha256").update(id).digest("hex").slice(0, 16), status: "ACTIVE" };
    save(); return { ...reg.tenants[id], dir: base };
  }
  const get = id => { if (!reg.tenants[id]) throw new Error("UNKNOWN_TENANT"); return reg.tenants[id]; };
  /** Resolve a path INSIDE one tenant's area; any attempt to leave it (.., absolute, symlink to elsewhere) throws. */
  function pathFor(tenantId, area, rel = "") {
    get(tenantId); if (!["data", "config", "vault", "documents"].includes(area)) throw new Error("BAD_AREA");
    const root = path.resolve(rootDir, "tenants", tenantId, area), p = path.resolve(root, rel);
    if (p !== root && !p.startsWith(root + path.sep)) throw new Error("PATH_ESCAPES_TENANT");
    if (fs.existsSync(p) && !(fs.realpathSync(p) + path.sep).startsWith(fs.realpathSync(root) + path.sep) && fs.realpathSync(p) !== fs.realpathSync(root)) throw new Error("PATH_ESCAPES_TENANT");
    return p;
  }
  /** Guard for any data access: the acting tenant may only touch its own records. Only the owner tenant may read others (audited by caller). */
  function assertAccess(actingTenant, targetTenant) {
    get(actingTenant); get(targetTenant);
    if (actingTenant !== targetTenant && actingTenant !== OWNER_TENANT) throw new Error("CROSS_TENANT_ACCESS_DENIED");
    return true;
  }
  const suspend = id => { get(id).status = "SUSPENDED"; save(); };
  return { create, get, pathFor, assertAccess, suspend, list: () => Object.values(reg.tenants).map(t => ({ ...t })) };
}

/** Entitlements are signed by JOCI's key (Ed25519). The customer instance carries only the public key, so it cannot mint or extend its own license. */
export function signEntitlement(privateKeyPem, ent) {
  const body = { tenantId: ent.tenantId, features: [...ent.features].sort(), expiresAt: ent.expiresAt, issuedAt: ent.issuedAt ?? new Date().toISOString(), seats: ent.seats ?? 1 };
  return { ...body, signature: sign(null, Buffer.from(canon(body)), createPrivateKey(privateKeyPem)).toString("base64") };
}
export function checkEntitlement(ent, { publicKeyB64, tenantId, feature = null, now = Date.now() } = {}) {
  if (!ent || typeof ent.signature !== "string") return { valid: false, reason: "NO_ENTITLEMENT" };
  const { signature, ...body } = ent;
  try {
    const pub = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    if (!verify(null, Buffer.from(canon(body)), pub, Buffer.from(signature, "base64"))) return { valid: false, reason: "BAD_SIGNATURE" };
  } catch { return { valid: false, reason: "BAD_KEY_OR_SIGNATURE" }; }
  if (body.tenantId !== tenantId) return { valid: false, reason: "WRONG_TENANT" };
  if (!Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= now) return { valid: false, reason: "EXPIRED" };
  if (feature && !body.features.includes(feature)) return { valid: false, reason: "FEATURE_NOT_LICENSED:" + feature };
  return { valid: true, features: body.features, expiresAt: body.expiresAt };
}
