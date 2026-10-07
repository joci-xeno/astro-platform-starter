import fs from "node:fs";
import path from "node:path";
import { generateOwnerKeyPair, issueOwnerApproval, configureOwnerAuth, getDefaultOwnerAuth } from "../atlasz-addons/owner-auth.mjs";
import { createEmergencyStop } from "../atlasz-addons/emergency-stop.mjs";
import { createSafeMode } from "../atlasz-addons/safe-mode.mjs";
import { createBlackBox } from "../atlasz-addons/brain/black-box.mjs";
import { createSecurityBrain } from "../atlasz-addons/brain/security-brain.mjs";
import { createVerifier } from "../atlasz-addons/brain/verifier.mjs";
import { createOwnerControlSystem } from "../atlasz-addons/owner-control/owner-control-system.mjs";
import { approvalActionName } from "../atlasz-addons/owner-control/owner-authority.mjs";
import { tmp } from "./helpers.mjs";

export const KEY = generateOwnerKeyPair();
configureOwnerAuth({ publicKeyB64: KEY.publicKeyB64 });
export const ownerAuth = getDefaultOwnerAuth();
export const sign = (action, subject, extra = {}) => issueOwnerApproval({ privateKeyPem: KEY.privateKeyPem, action, subject, ...extra });
export const roster = () => [...Array.from({ length: 5 }, (_, i) => ({ id: "S" + (i + 1), team: "SEARCH" })), ...Array.from({ length: 25 }, (_, i) => ({ id: "E" + (i + 1), team: "EXECUTION" }))];

export function rig(o = {}) {
  const dir = tmp("oc-");
  const emergency = createEmergencyStop({ statePath: path.join(dir, "es.json"), auditPath: path.join(dir, "es.jsonl"), ownerAuth });
  const safeMode = createSafeMode({ statePath: path.join(dir, "sm.json"), auditPath: path.join(dir, "sm.jsonl"), ownerAuth });
  const blackBox = createBlackBox({ filePath: path.join(dir, "bb.jsonl") });
  const security = o.noSecurity ? null : createSecurityBrain({ ownerAuth, safeMode, blackBox });
  const verifier = createVerifier({ lookups: o.lookups ?? {} });
  const sources = {};
  for (const [cat, files] of Object.entries(o.sources ?? {})) { const d = path.join(dir, "src", cat); fs.mkdirSync(d, { recursive: true }); for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c); sources[cat] = d; }
  const sys = createOwnerControlSystem({ dir: path.join(dir, "oc"), ownerAuth, gate: o.gate ?? (x => emergency.gate(x)), emergencyStatus: () => emergency.status(), safeMode, security, blackBox, verifier,
    roster: o.roster ?? roster(), tools: o.tools ?? ["web-search"], sources });
  const opApproval = (op, params = {}, spend = 0, extra = {}) => sign(approvalActionName(op), sys.chain.subjectFor(op, params, spend), extra);
  const stop = (mode = "PAUSE_ALL") => emergency.setMode({ mode, ownerApproval: sign("EMERGENCY_STOP", mode), reason: "test" });
  const resume = () => emergency.setMode({ mode: "RUNNING", ownerApproval: sign("EMERGENCY_RESUME", "RUNNING"), confirm: "RESUME", reason: "test" });
  return { dir, emergency, safeMode, blackBox, security, verifier, sys, sources, opApproval, stop, resume };
}
