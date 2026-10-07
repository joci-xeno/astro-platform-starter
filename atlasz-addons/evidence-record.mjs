// ATLASZ runtime evidence record (V7.3 §35). A claim of "TESTED" is only as good as its record:
// timestamp, component, version/commit/build, environment, test type, result, log/trace id, blocker/error, and an explicit
// MOCK / SANDBOX / STAGING / PRODUCTION label. A record labelled PRODUCTION must come from a real production run.
import { randomUUID } from "node:crypto";

export const ENV_LABELS = Object.freeze(["MOCK", "SANDBOX", "STAGING", "PRODUCTION"]);
export const TEST_TYPES = Object.freeze(["UNIT", "INTEGRATION", "E2E", "REAL_RUNTIME", "SMOKE", "REGRESSION", "RECOVERY_DRILL", "SECURITY"]);
export const RESULTS = Object.freeze(["PASS", "FAIL", "BLOCKED", "ERROR"]);

export function buildEvidenceRecord({ component, version = null, commit = null, build = null, environment, label, testType, result, details = {}, error = null, blocker = null, traceId = randomUUID(), at = new Date().toISOString() } = {}) {
  const miss = f => { throw new Error("EVIDENCE_FIELD_INVALID:" + f); };
  if (!component || typeof component !== "string") miss("component");
  if (!version && !commit && !build) miss("version|commit|build");
  if (!environment || typeof environment !== "string") miss("environment");
  if (!ENV_LABELS.includes(label)) miss("label");
  if (!TEST_TYPES.includes(testType)) miss("testType");
  if (!RESULTS.includes(result)) miss("result");
  if (!Number.isFinite(Date.parse(at))) miss("at");
  if (["FAIL", "ERROR", "BLOCKED"].includes(result) && !(error || blocker)) miss("error|blocker (required when result is not PASS)");
  if (label === "PRODUCTION" && environment === "sandbox") miss("label contradicts environment");
  return { at, component, version, commit, build, environment, label, testType, result, traceId, error, blocker, details };
}
