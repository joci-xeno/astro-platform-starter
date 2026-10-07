import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createSecretVault, generateVaultKey } from "../atlasz-addons/secret-vault.mjs";
import { createConnectorCatalog, CONNECTOR_DESCRIPTORS } from "../atlasz-addons/connector-catalog.mjs";
import { tmp, rm } from "./helpers.mjs";

const SECRET = "fixture-token-ABCDEF123456";
async function rig(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization }); handler(req, res); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const k = generateOwnerKeyPair(), auth = createOwnerAuth({ publicKeyB64: k.publicKeyB64 });
  const d = tmp(), vault = createSecretVault({ dir: d, keyB64: generateVaultKey(), ownerAuth: auth });
  const ap = (a, s) => issueOwnerApproval({ privateKeyPem: k.privateKeyPem, action: a, subject: s });
  const descriptors = {
    alpha: { name: "Alpha", base, vault: "ALPHA_TOKEN", auth: t => ({ authorization: "Bearer " + t }), probe: { path: "/me" }, capabilities: [] },
    nofree: { name: "NoFree", base, vault: "NOFREE_KEY", auth: t => ({ authorization: "Bearer " + t }), probe: null, capabilities: [] }
  };
  return { seen, srv, vault, ap, descriptors, d, close: () => { srv.close(); rm(d); } };
}

test("connector: no credential -> BLOCKED_NO_CREDENTIALS and no network call", async () => {
  const r = await rig((q, s) => s.end("{}"));
  try {
    const c = createConnectorCatalog({ vault: r.vault, descriptors: r.descriptors });
    assert.equal(c.status("alpha").state, "BLOCKED_NO_CREDENTIALS");
    assert.equal((await c.probe("alpha")).state, "BLOCKED_NO_CREDENTIALS");
    assert.equal(r.seen.length, 0);
    await assert.rejects(c.read("alpha", "/x"), /CONNECTOR_NOT_LIVE/);
  } finally { r.close(); }
});
test("connector: credential alone is not LIVE; passing GET probe makes it LIVE; failure drops it", async () => {
  let code = 200;
  const r = await rig((q, s) => { s.statusCode = code; s.end(JSON.stringify({ echo: SECRET })); });
  try {
    r.vault.set("ALPHA_TOKEN", SECRET, { ownerApproval: r.ap("VAULT_SET", "ALPHA_TOKEN") });
    const c = createConnectorCatalog({ vault: r.vault, descriptors: r.descriptors });
    assert.equal(c.status("alpha").state, "CREDENTIALS_PRESENT_UNTESTED");
    assert.equal(c.status("alpha").live, false);
    const p = await c.probe("alpha");
    assert.equal(p.ok, true); assert.equal(p.state, "LIVE");
    assert.equal(r.seen[0].method, "GET"); assert.equal(r.seen[0].auth, "Bearer " + SECRET);
    const rd = await c.read("alpha", "/data");
    assert.equal(rd.body.includes(SECRET), false);           // server echoed the secret; it is redacted
    code = 401;
    assert.equal((await c.probe("alpha")).state, "PROBE_FAILED");
    assert.equal(c.status("alpha").live, false);              // old evidence removed on failure
  } finally { r.close(); }
});
test("connector: no safe probe stays NO_SAFE_PROBE (never auto-LIVE); owner stop blocks calls; host escape refused", async () => {
  const r = await rig((q, s) => s.end("{}"));
  try {
    r.vault.set("NOFREE_KEY", SECRET, { ownerApproval: r.ap("VAULT_SET", "NOFREE_KEY") });
    r.vault.set("ALPHA_TOKEN", SECRET, { ownerApproval: r.ap("VAULT_SET", "ALPHA_TOKEN") });
    let stopped = false;
    const c = createConnectorCatalog({ vault: r.vault, descriptors: r.descriptors, gate: () => ({ allowed: !stopped }) });
    assert.equal((await c.probe("nofree")).state, "NO_SAFE_PROBE");
    assert.equal(c.status("nofree").live, false);
    await c.probe("alpha");
    stopped = true;
    assert.equal((await c.probe("alpha")).state, "OWNER_STOP");
    await assert.rejects(c.read("alpha", "/x"), /OWNER_STOP/);
    stopped = false;
    await assert.rejects(c.read("alpha", "http://evil.example/steal"), /HOST_NOT_ALLOWED/);
  } finally { r.close(); }
});
test("connector: real descriptors cover requested set, only GET-style probes, unknown probes are null", () => {
  const ids = Object.keys(CONNECTOR_DESCRIPTORS);
  for (const x of ["github","railway","gmail","drive","calendar","airtable","agentmail","hunter","clay","firecrawl","exa","tavily"]) assert.ok(ids.includes(x), x);
  for (const x of ["agentmail","clay","firecrawl","exa","tavily"]) assert.equal(CONNECTOR_DESCRIPTORS[x].probe, null);
  assert.equal(CONNECTOR_DESCRIPTORS.railway.probe.unverifiedEndpoint, true);
});
