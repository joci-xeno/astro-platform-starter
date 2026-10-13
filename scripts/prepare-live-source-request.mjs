// Builds the exact, UNSIGNED owner-approval request for the first live discovery source. Nothing is contacted and nothing is approved by running this; the owner signs in the Control Center.
// usage: node scripts/prepare-live-source-request.mjs [--write]   (writes docs/owner/FIRST_LIVE_SOURCE_APPROVAL_REQUEST.{json,md})
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDiscoveryEngine } from "../atlasz-addons/global-discovery.mjs";
import { normaliseEgressPolicy, policySubject } from "../atlasz-addons/egress-policy.mjs";
import { SOURCE_REQUESTS } from "../atlasz-addons/live-discovery-runner.mjs";
import os from "node:os";

export function buildRequest(sourceId = "hn-algolia") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lsr-"));
  try {
    const eng = createDiscoveryEngine({ dir: tmp }), src = eng.sources().find(s => s.id === sourceId); if (!src) throw new Error("UNKNOWN_SOURCE");
    const norm = normaliseEgressPolicy(eng.proposedPolicy(sourceId)); if (norm.error) throw new Error(norm.error);
    return { requestId: "LIVE-SOURCE-1", status: "UNSIGNED_AWAITING_OWNER", action: "EGRESS_POLICY_SET", subject: policySubject(norm.policy), policy: norm.policy,
      source: { id: src.id, name: src.name, host: src.hosts[0], access: src.access, authentication: "NONE (public read-only API; no credential is stored or sent)", exactRequest: SOURCE_REQUESTS[sourceId].url, method: "GET" },
      limits: { minIntervalBetweenRequests: "enforced by the engine (see DISCOVERY_LIMITS.minIntervalMs), the scheduler also enforces 15 min and 96 runs/day", maxResponseBytes: "bounded by DISCOVERY_LIMITS.maxResponseBytes", redirects: "never followed", dnsPinning: "connection pinned to the checked addresses" },
      failureBehaviour: "HTTP error, timeout, parse error or oversize response => run recorded as failed, exponential back-off (10 min doubling to 6 h), no retry storm, owner stop honoured",
      accessRestrictions: "Public Hacker News Search (Algolia) API. Its published usage terms and rate limit could NOT be verified from the sandbox (the documentation page needs JavaScript). Before signing, read https://hn.algolia.com/api and confirm that read-only automated use at this volume is acceptable. ATLASZ makes at most 1 request per 15 minutes from one host.",
      dataHandled: "Public comment text from job-seeking threads. Treated as untrusted data; embedded instructions are ignored; contact is never initiated by ATLASZ.",
      what_it_does_not_allow: ["any other host", "any method except GET", "any port except 443", "sending anything to a poster", "using the data as revenue"],
      howToApprove: "Control Center > Agents > Discovery > host request 'hn-algolia' > enter your owner passphrase (action discoveryApproveHost). The signed policy is hash-bound to the exact JSON above; any change invalidates it.",
      effectIfApproved: "SEARCH agents may read this one host on the schedule above. First success is recorded in first-live-discovery.json and kept separate from fixtures.",
      effectIfNotApproved: "No network contact. Discovery stays fixture/operator-capture only.", revoke: "EGRESS_POLICY_REMOVE (signed) removes the host immediately." };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = buildRequest(), json = JSON.stringify(r, null, 2);
  if (process.argv.includes("--write")) {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "owner"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "FIRST_LIVE_SOURCE_APPROVAL_REQUEST.json"), json + "\n");
    const md = ["# First live discovery source — owner approval request (UNSIGNED)", "", "Status: **" + r.status + "**. Nothing has been contacted. Signing this request is the only thing that allows the connection.", "",
      "- Source: " + r.source.name + " (`" + r.source.id + "`), host **" + r.source.host + "**, port 443, method GET only", "- Authentication: " + r.source.authentication, "- Exact request: `" + r.source.exactRequest + "`", "- Action to sign: `" + r.action + "`", "- Subject (hash of the policy): `" + r.subject + "`", "", "## Access restrictions", r.accessRestrictions, "", "## Limits", ...Object.entries(r.limits).map(([k, v]) => "- " + k + ": " + v), "", "## Failure behaviour", r.failureBehaviour, "", "## Data handled", r.dataHandled, "", "## Not allowed even if approved", ...r.what_it_does_not_allow.map(x => "- " + x), "", "## How to approve", r.howToApprove, "", "## If approved / if not", "- " + r.effectIfApproved, "- " + r.effectIfNotApproved, "- Revoke: " + r.revoke, "", "## Policy JSON", "```json", JSON.stringify(r.policy, null, 2), "```", ""].join("\n");
    fs.writeFileSync(path.join(dir, "FIRST_LIVE_SOURCE_APPROVAL_REQUEST.md"), md); console.log("written docs/owner/FIRST_LIVE_SOURCE_APPROVAL_REQUEST.{json,md}");
  } else console.log(json);
}
