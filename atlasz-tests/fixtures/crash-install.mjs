// Child process for the crash-recovery test: dies hard in the middle of an install (after the code swap).
import fs from "node:fs";
import path from "node:path";
import { createOwnerAuth, issueOwnerApproval } from "../../atlasz-addons/owner-auth.mjs";
import { createUpdateCenter } from "../../atlasz-addons/update-center.mjs";
const [stateDir, backupRoot, installDir] = process.argv.slice(2);
const pem = process.env.TEST_OWNER_PEM, pub = process.env.TEST_OWNER_PUB;
const ownerAuth = createOwnerAuth({ publicKeyB64: pub });
const uc = createUpdateCenter({ stateDir, backupRoot, ownerAuth, adapters: {
  detector: async () => [{ componentId: "mod-a", version: "1.1.0", riskTags: [] }],
  stager: async ({ update, stagingDir }) => { fs.writeFileSync(path.join(stagingDir, "VERSION"), update.version); return { ok: true }; },
  tester: async ({ phase }) => { if (phase === "POST_INSTALL") process.exit(42); return { passed: true, evidence: "staging ok" }; },
  securityHealth: async () => ({ ok: true })
} });
uc.registerComponent({ id: "mod-a", kind: "MODULE", version: "1.0.0", installDir });
await uc.checkForUpdates();
const approval = issueOwnerApproval({ privateKeyPem: pem, action: "INSTALL_UPDATE", subject: "mod-a@1.1.0" });
await uc.safeUpdate("mod-a@1.1.0", { ownerApproval: approval });
process.exit(0);
