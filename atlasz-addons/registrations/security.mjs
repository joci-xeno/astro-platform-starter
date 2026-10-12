// Registrations: containment, untrusted-file intake and verified payment events. All capabilities are READ-ONLY views: no file content, no secret and no money movement is reachable through them.
import { NONE, obj, str, cap, POLICY } from "./_util.mjs";
import { SIG_TOLERANCE_SEC } from "../business/payment-events.mjs";
import { SEVERITIES } from "../incident-response.mjs";
import { INTAKE_MAX_BYTES } from "../file-intake.mjs";
import { ENGINES } from "../malware-scanner.mjs";

export function registerSecurity(broker, ctx) {
  broker.register({ id: "incident-response", source: "atlasz-addons/incident-response.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.security,
    purpose: "Code-enforced containment independent of the Brain: confirmed serious incident -> agent/tool blocked, tasks suspended, evidence preserved, owner alerted. Clearing needs a signed single-use owner approval. Read-only here.",
    capabilities: [
      cap("status", "READ_STATUS", () => { const l = ctx.incidentResponse().list(); return { total: l.length, open: l.filter(i => i.state !== "CLEARED").length, blocks: ctx.incidentResponse().blocks().length, auditChain: ctx.incidentResponse().verify(), severities: SEVERITIES }; }, { description: "Counts of incidents and active blocks plus audit-chain integrity." }),
      cap("open", "READ_STATUS", () => ({ incidents: ctx.incidentResponse().list().filter(i => i.state !== "CLEARED").slice(0, 100).map(i => ({ id: i.id, severity: i.severity, kind: i.kind, agentId: i.agentId ?? null, state: i.state, at: i.at })) }), { description: "Open incidents (no evidence payloads)." })],
    selfTest: { capability: "status", expect: r => (r.auditChain?.ok !== false && Array.isArray(r.severities) ? true : "incident audit chain invalid") } });
  broker.register({ id: "file-intake", source: "atlasz-addons/file-intake.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.security,
    purpose: "Untrusted file intake: isolated quarantine, type/size/content validation, scan by an ESTABLISHED engine (ClamAV / Windows Defender), never executed, never reachable by privileged tools, release only with a signed owner approval. If no engine is installed every file stays HELD. Read-only status here; no file content is exposed.",
    capabilities: [
      cap("status", "READ_STATUS", () => ({ ...ctx.intakeStatus(), maxBytes: INTAKE_MAX_BYTES, engines: Object.keys(ENGINES), auditChain: ctx.fileIntake().verify() }), { description: "Scanner presence (honest NO_SCANNER_INSTALLED state) and held-file count." }),
      cap("list", "READ_STATUS", () => ({ files: ctx.fileIntake().list().slice(0, 200).map(f => ({ id: f.id, name: f.name, state: f.state, size: f.size, sha256: f.sha256, at: f.at })) }), { description: "Metadata of intake files (never content)." })],
    selfTest: { capability: "status", expect: r => (typeof r.scannerState === "string" && r.auditChain?.ok !== false ? true : "intake status incomplete") } });
  broker.register({ id: "malware-scanner", source: "atlasz-addons/malware-scanner.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "INTERNAL_LIBRARY", consumer: "file-intake", policy: POLICY.security, purpose: "Thin adapter to established scanners (ClamAV clamscan/clamdscan, Microsoft Defender MpCmdRun). It is NOT an antivirus engine; unavailable/erroring engine = file HELD, never 'clean'." });
  broker.register({ id: "business/payment-events", source: "atlasz-addons/business/payment-events.mjs", manager: "FINANCIAL_REVENUE_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.money,
    purpose: "Verified payment-event ledger: Stripe-compatible HMAC signature check (tolerance " + SIG_TOLERANCE_SEC + " s), persistent dedupe, pending/succeeded/failed/refund/dispute/payout kept apart, payout never treated as bank receipt without reconciliation evidence. It records facts only: it cannot initiate payments, refunds or transfers. Live use BLOCKED until a webhook secret exists.",
    capabilities: [cap("summary", "READ_STATUS", () => JSON.parse(JSON.stringify(ctx.paymentEvents().summary())), { description: "Counts and amounts by verified state; no raw payloads." })],
    selfTest: { capability: "summary", expect: r => (r && typeof r === "object" && ctx.paymentEvents().verify().ok !== false ? true : "payment-event audit chain invalid") } });
}
