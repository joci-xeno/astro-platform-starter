import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair } from "../atlasz-addons/owner-auth.mjs";
import { createTenantRegistry, signEntitlement, checkEntitlement, OWNER_TENANT } from "../atlasz-addons/tenant-isolation.mjs";
import { buildSanitizedDist } from "../scripts/make-sanitized-dist.mjs";
import { tmp, rm } from "./helpers.mjs";

test("tenants get separate dirs, namespaces; paths cannot escape; customers cannot read other tenants or JOCI; only JOCI can", () => {
  const d = tmp("ten-");
  try {
    const r = createTenantRegistry({ rootDir: d }); r.create(OWNER_TENANT); const a = r.create("acme-corp"), b = r.create("beta-llc");
    assert.notEqual(a.vaultNamespace, b.vaultNamespace); assert.notEqual(a.dir, b.dir);
    fs.writeFileSync(r.pathFor("acme-corp", "data", "secret.txt"), "acme only");
    assert.throws(() => r.pathFor("beta-llc", "data", "../../acme-corp/data/secret.txt"), /PATH_ESCAPES_TENANT/);
    assert.throws(() => r.pathFor("beta-llc", "data", "/etc/passwd"), /PATH_ESCAPES_TENANT/);
    fs.symlinkSync(path.join(d, "tenants", "acme-corp", "data"), path.join(d, "tenants", "beta-llc", "data", "link"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => r.pathFor("beta-llc", "data", "link/secret.txt"), /PATH_ESCAPES_TENANT/);
    assert.throws(() => r.assertAccess("beta-llc", "acme-corp"), /CROSS_TENANT_ACCESS_DENIED/);
    assert.throws(() => r.assertAccess("acme-corp", OWNER_TENANT), /CROSS_TENANT_ACCESS_DENIED/);
    assert.equal(r.assertAccess(OWNER_TENANT, "acme-corp"), true);
    assert.throws(() => r.create("Bad Name"), /BAD_TENANT_ID/); assert.throws(() => r.create("acme-corp"), /TENANT_EXISTS/); assert.throws(() => r.pathFor("ghost", "data"), /UNKNOWN_TENANT/);
    assert.equal(createTenantRegistry({ rootDir: d }).list().length, 3);                                    // durable
  } finally { rm(d); }
});
test("entitlements are owner-signed: forged, tampered, wrong-tenant, expired and unlicensed-feature all fail; the customer holds only the public key", () => {
  const k = generateOwnerKeyPair(), other = generateOwnerKeyPair(), future = new Date(Date.now() + 86400000).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  const ent = signEntitlement(k.privateKeyPem, { tenantId: "acme-corp", features: ["MONEY_ENGINE"], expiresAt: future });
  const chk = (e, o = {}) => checkEntitlement(e, { publicKeyB64: k.publicKeyB64, tenantId: "acme-corp", ...o });
  assert.equal(chk(ent, { feature: "MONEY_ENGINE" }).valid, true);
  assert.equal(chk(ent, { feature: "VOICE" }).reason, "FEATURE_NOT_LICENSED:VOICE");
  assert.equal(chk({ ...ent, features: ["MONEY_ENGINE", "VOICE"] }).reason, "BAD_SIGNATURE");                       // tampered
  assert.equal(chk({ ...ent, expiresAt: "2099-01-01T00:00:00Z" }).reason, "BAD_SIGNATURE");                         // cannot extend itself
  assert.equal(chk(ent, { tenantId: "beta-llc" }).reason, "WRONG_TENANT");
  assert.equal(chk(signEntitlement(k.privateKeyPem, { tenantId: "acme-corp", features: [], expiresAt: past })).reason, "EXPIRED");
  assert.equal(checkEntitlement(signEntitlement(other.privateKeyPem, { tenantId: "acme-corp", features: [], expiresAt: future }), { publicKeyB64: k.publicKeyB64, tenantId: "acme-corp" }).reason, "BAD_SIGNATURE");
  assert.equal(chk(null).reason, "NO_ENTITLEMENT");
});
test("sanitized distribution excludes git/state/evidence/keys/legacy worker and drops any file containing a secret", () => {
  const src = tmp("san-src-"), out = tmp("san-out-");
  try {
    const w = (rel, c) => { const p = path.join(src, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
    w("atlasz-addons/ok.mjs", "export const a = 1;"); w("atlasz-addons/leak.mjs", "const k='sk-" + "z".repeat(30) + "'"); w(".git/config", "x"); w("evidence/e.json", "{}"); w("data/atlasz-state.json", "{}");
    w("owner-private-key.enc.pem", "x"); w(".env", "A=1"); w("atlasz-runtime/worker.js", "atlasz-competition-v1"); w("node_modules/x/i.js", "1");
    const r = buildSanitizedDist({ srcRoot: src, outDir: path.join(out, "dist") });
    assert.deepEqual(r.copied.sort(), ["atlasz-addons/ok.mjs"]); assert.deepEqual(r.secretFindingsExcluded, ["atlasz-addons/leak.mjs"]);
    assert.ok(fs.existsSync(path.join(out, "dist", "SANITIZED-MANIFEST.json"))); assert.ok(!fs.existsSync(path.join(out, "dist", "atlasz-runtime", "worker.js")));
  } finally { rm(src); rm(out); }
});
