// Worker entry for the accessibility audit: the engine runs off the request thread so a pathological input can be killed by a timeout instead of hanging the Control Center.
import { parentPort, workerData } from "node:worker_threads";
import { auditAccessibility } from "./a11y-audit.mjs";
try { parentPort.postMessage({ ok: true, result: auditAccessibility(workerData) }); } catch { parentPort.postMessage({ ok: false, reason: "AUDIT_ENGINE_FAILED" }); }
