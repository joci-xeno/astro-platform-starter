#!/usr/bin/env node
// ATLASZ owner CLI — runs on JOCI's own device. The private key never goes to the server or into git.
//   node owner-cli.mjs keygen  --out <path-to-private.pem>        (prints the PUBLIC key for ATLASZ_OWNER_PUBLIC_KEY)
//   node owner-cli.mjs sign    --key <pem> --action <ACTION> [--subject S] [--ttl-seconds 60]   (prints approval JSON)
//   node owner-cli.mjs emergency --key <pem> --state-dir <dir> --mode PAUSE_ALL|STOP_EXTERNAL_ACTIONS|RUNNING [--reason R] [--confirm RESUME]
//     (alternate kill-switch path that works even if the GUI/runtime is down: it operates on the durable state dir)
// This CLI is an interim secure base. The final Windows Control Center exposes the same owner functions graphically.
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { generateOwnerKeyPair, issueOwnerApproval, createOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createEmergencyStop } from "../atlasz-addons/emergency-stop.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const arg = n => { const i = rest.indexOf("--" + n); return i >= 0 ? rest[i + 1] : undefined; };
const pubFromPem = pem => createPublicKey(createPrivateKey(pem)).export({ format: "der", type: "spki" }).toString("base64");
try {
  if (cmd === "keygen") {
    const out = arg("out"); if (!out) throw new Error("--out required");
    if (fs.existsSync(out)) throw new Error("REFUSING_TO_OVERWRITE_EXISTING_KEY");
    const k = generateOwnerKeyPair();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, k.privateKeyPem, { mode: 0o600 });
    console.log("Private key written to " + out + " (keep it ONLY on your device; back it up offline).");
    console.log("Set this on the server as ATLASZ_OWNER_PUBLIC_KEY:\n" + k.publicKeyB64);
  } else if (cmd === "sign") {
    const pem = fs.readFileSync(arg("key"), "utf8");
    console.log(JSON.stringify(issueOwnerApproval({ privateKeyPem: pem, action: arg("action"), subject: arg("subject") ?? null, ttlMs: Number(arg("ttl-seconds") || 60) * 1000 })));
  } else if (cmd === "emergency") {
    const pem = fs.readFileSync(arg("key"), "utf8"), dir = arg("state-dir"), mode = arg("mode");
    // No stateDir here on purpose: the running server owns owner-auth-audit.jsonl; two processes must not append to one hash chain.
    const auth = createOwnerAuth({ publicKeyB64: pubFromPem(pem) });
    const es = createEmergencyStop({ statePath: path.join(dir, "emergency-stop.json"), auditPath: path.join(dir, "emergency-audit.jsonl"), ownerAuth: auth });
    const action = mode === "RUNNING" ? "EMERGENCY_RESUME" : "EMERGENCY_STOP";
    const approval = issueOwnerApproval({ privateKeyPem: pem, action, subject: mode, ttlMs: 60000 });
    console.log(JSON.stringify(es.setMode({ mode, ownerApproval: approval, reason: arg("reason") || "owner CLI", confirm: arg("confirm") ?? null }), null, 1));
  } else { console.error("usage: keygen | sign | emergency (see header)"); process.exit(2); }
} catch (e) { console.error("ERROR: " + e.message); process.exit(1); }
