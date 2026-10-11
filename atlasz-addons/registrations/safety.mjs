// Registrations: owner control, security and approval modules. Everything here ends in the SAME objects the running Control Center uses (ctx.ownerControl(), ctx.recovery()).
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ANY, NONE, str, num, arr, obj, cap, POLICY, must } from "./_util.mjs";
import { GATE_IDS, GATE_NAMES, runSecurityGates } from "../security-gates.mjs";
import { classifyComputerAction, COMPUTER_ACTION_LEVELS } from "../computer-use-fabric.mjs";
import { auditExtensionFolder } from "../browser-extension-guard.mjs";
import { createTenantRegistry, OWNER_TENANT, signEntitlement, checkEntitlement } from "../tenant-isolation.mjs";
import { generateOwnerKeyPair } from "../owner-auth.mjs";
import { DISTINCTIONS } from "../owner-control/claim-distinctions.mjs";
import { SAFE_MODE_ALLOWED } from "../owner-control/safe-mode-scope.mjs";
import { CANDIDATES, mapRecoverySources } from "../owner-control/recovery-source-map.mjs";
import { RECOVERY_CATEGORIES } from "../owner-control/recovery-points.mjs";
import { CONTROLLED_PATHS, VERDICTS } from "../owner-control/control-chain.mjs";
import { createApprovalGateway as createLegacyApprovalGateway } from "../approval-command-gateway.mjs";

export function registerSafety(broker, ctx) {
  const oc = () => ctx.ownerControl();
  broker.register({ id: "owner-control", source: "atlasz-addons/owner-control/owner-control-system.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.security,
    purpose: "Unified owner control: owner authority, kill switch, safe mode, security brain, financial firewall (NO-SPEND default), approval gateway, 30-agent governor, recovery and system doctor assembled into one chain that the Master consults before every consequential step.",
    capabilities: [
      cap("status", "READ_STATUS", () => JSON.parse(JSON.stringify(oc().status())), { description: "Live status of every layer of the control chain." }),
      cap("evaluate", "READ_STATUS", ({ operation, actorType, actorId, spendUsd }) => { const d = oc().chain.evaluate({ actor: { type: actorType, id: actorId }, operation, spendUsd: spendUsd ?? 0 }); return { verdict: d.verdict, allowed: d.allowed, layer: d.layer, reason: d.reason, approvalRequired: d.approvalRequired ? true : false }; },
        { input: obj({ operation: str(), actorType: str(), actorId: str(), spendUsd: num({ minimum: 0 }) }, ["operation", "actorType", "actorId"]), description: "Ask the chain what it WOULD decide (no side effects other than the black-box record)." }),
      cap("firewall", "READ_STATUS", () => JSON.parse(JSON.stringify(oc().firewall.summary())), { description: "Financial firewall summary: estimated, actual, verified revenue kept apart." }),
      cap("topology", "READ_STATUS", () => JSON.parse(JSON.stringify(oc().agents.report())), { description: "Fixed 5 SEARCH + 25 EXECUTION topology and registered tools." })
    ],
    selfTest: { capability: "status", expect: r => (r.controlledPaths >= CONTROLLED_PATHS.length && r.killSwitch?.mode ? true : "chain status incomplete") } });
  broker.register({ id: "owner-control/control-chain", source: "atlasz-addons/owner-control/control-chain.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "INTERNAL_LIBRARY", consumer: "owner-control", policy: POLICY.security, purpose: "The single evaluation path (owner authority -> kill switch -> safe mode -> security brain -> financial firewall -> owner approval) used inside the owner-control assembly." });
  for (const [id, file, what] of [
    ["owner-control/financial-firewall", "financial-firewall", "NO-SPEND default financial firewall; estimated/actual/verified kept separate"],
    ["owner-control/agent-governor", "agent-governor", "fixed 5+25 agent topology governor; no unregistered agent or tool"],
    ["owner-control/claim-distinctions", "claim-distinctions", "weaker states (DRAFT, INVOICE, SIMULATION...) never become stronger ones without independent verification"],
    ["owner-control/safe-mode-scope", "safe-mode-scope", "safe-mode scope and module isolation used by the control chain"],
    ["owner-control/recovery-points", "recovery-points", "categorised recovery points, drills, last-known-good and rollback"],
    ["owner-control/owner-control-system", "owner-control-system", "assembly of the whole owner-control stack"]
  ]) broker.register({ id, source: "atlasz-addons/owner-control/" + file + ".mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "INTERNAL_LIBRARY", consumer: "owner-control", policy: POLICY.security, purpose: "Part of the owner-control stack in the running application: " + what + "." });
  broker.register({ id: "owner-control/recovery-source-map", source: "atlasz-addons/owner-control/recovery-source-map.mjs", manager: "RECOVERY_MAINTENANCE", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Resolve each recovery category to a REAL local directory (never a secret store, never outside the allowed roots) or report NOT_CONFIGURED with the exact reason.",
    capabilities: [cap("map", "READ_STATUS", () => { const r = mapRecoverySources({ dataDir: ctx.stateDir, appDir: ctx.appDir }); return { mapped: r.mapped, notConfigured: r.notConfigured, report: r.report }; }, { description: "Which recovery categories have a real source directory on this machine." })],
    selfTest: { capability: "map", expect: r => (r.mapped + r.notConfigured === RECOVERY_CATEGORIES.length ? true : "category count mismatch") } });
  broker.register({ id: "security-gates", source: "atlasz-addons/security-gates.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "The twelve named security end-to-end gates (23-point item 22): each imports the real modules and attacks them with synthetic data; PASS means tested locally, not LIVE.",
    capabilities: [
      cap("list", "READ_STATUS", () => ({ gates: GATE_IDS.map(id => ({ id, name: GATE_NAMES[id] })) })),
      cap("run", "RUN_SYSTEM_DOCTOR", async ({ only }) => { const r = await runSecurityGates({ only: only ?? null, workRoot: os.tmpdir() }); return { total: r.total, passed: r.passed, failed: r.failed, exitCode: r.exitCode, gates: r.gates.map(g => ({ id: g.id, status: g.status, checks: g.checks, failedChecks: g.failedChecks })), meaning: r.meaning }; },
        { input: obj({ only: arr(str({ maxLength: 8 })) }), timeoutMs: 120000, description: "Run all gates (or the named ones) in a scratch directory." })],
    selfTest: { capability: "list", expect: r => (r.gates.length === GATE_IDS.length && GATE_IDS.length === 12 ? true : "expected 12 gates") } });
  broker.register({ id: "browser-extension-guard", source: "atlasz-addons/browser-extension-guard.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.low,
    purpose: "Static security audit of the browser-extension folder (manifest permissions, CSP, forbidden keys); read-only and confined to the shipped extension directory.",
    capabilities: [cap("audit", "READ_STATUS", () => { const r = auditExtensionFolder(path.join(ctx.appDir, "browser-extension")); return { ok: r.ok, status: r.status, findings: (r.findings ?? []).slice(0, 50), files: (r.inventory ?? []).length }; }, { description: "Audit the shipped browser-extension folder." })],
    selfTest: { capability: "audit", expect: r => (typeof r.status === "string" ? true : "no status") } });
  broker.register({ id: "computer-use-fabric", source: "atlasz-addons/computer-use-fabric.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.security,
    purpose: "Computer-use action policy: AUTO / ASK_OWNER / FORBIDDEN classification. Only the policy is active; NO computer-use provider is connected (external blocker), so nothing can be executed through it.",
    capabilities: [cap("classify", "READ_STATUS", ({ action }) => ({ action, level: classifyComputerAction(action) }), { input: obj({ action: str({ maxLength: 80 }) }, ["action"]) })],
    selfTest: { capability: "classify", args: { action: "sign-contract" }, expect: r => (r.level === COMPUTER_ACTION_LEVELS.ASK_OWNER ? true : "sign-contract must ask the owner") } });
  broker.register({ id: "tenant-isolation", source: "atlasz-addons/tenant-isolation.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "OFFLINE_ACTIVATED", policy: POLICY.security,
    purpose: "Commercial licensing FOUNDATION: strict per-tenant directories and owner-signed entitlements. Nothing is sold or published; the owner tenant JOCI is unreachable from any customer tenant.",
    activation: "Activated only when the owner decides to host a second tenant (separate decision and approval). The activation path is exercised by tests: createTenantRegistry -> create(tenant) -> pathFor() containment and signEntitlement/checkEntitlement with a real Ed25519 key." });
  broker.register({ id: "approval-command-gateway", source: "atlasz-addons/approval-command-gateway.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "SUPERSEDED", supersededBy: "owner-control", policy: POLICY.security,
    purpose: "First-generation approval gateway (critical-action list with an owner verifier).", rationale: "The running application uses owner-control/approval-gateway behind the unified control chain with signed, single-use, subject-bound approvals; this earlier gateway has no persistence or nonce store, so activating it would create a second, weaker approval path." });
  broker.register({ id: "guardrail-engine", source: "atlasz-addons/guardrail-engine.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "SUPERSEDED", supersededBy: "owner-control", policy: POLICY.security,
    purpose: "Early guardAction() high-risk action list.", rationale: "Covered by the owner authority catalogue (OPERATIONS) inside the control chain, which is stricter (subject-bound approvals, financial firewall, security brain) and is the path every Master action takes." });
  broker.register({ id: "enterprise-control-plane", source: "atlasz-addons/enterprise-control-plane.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "SUPERSEDED", supersededBy: "owner-control", policy: POLICY.security,
    purpose: "Process-global agent control registry with its own kill switch variable.", rationale: "A second, in-memory kill switch would compete with the persistent, owner-signed emergency stop that the control chain already enforces; the 5+25 agent governor replaces its agent registry." });
  if (typeof ctx.credentialBroker === "function") broker.register({ id: "credential-broker", source: "atlasz-addons/credential-broker.mjs", manager: "SECURITY_APPROVAL_MANAGER", lifecycle: "ON_DEMAND", policy: POLICY.external,
    purpose: "Agents never see a raw credential: one HTTPS request is made under an owner-signed GRANT (exact hosts, methods, paths, rate limits, expiry); the secret is added from the vault and the answer is redacted.",
    capabilities: [
      cap("summary", "READ_STATUS", () => JSON.parse(JSON.stringify(ctx.credentialBroker().summary())), { description: "Grant count, request statistics and audit head." }),
      cap("grants", "READ_STATUS", () => ({ grants: ctx.credentialBroker().listGrants().map(g => ({ id: g.id, credential: g.credential, hosts: g.hosts, methods: g.methods, agents: g.agents, roles: g.roles, expiresAt: g.expiresAt })) })),
      cap("request", "EXTERNAL_READ", async a => JSON.parse(JSON.stringify(await ctx.credentialBroker().request(a))), { input: obj({ agentId: str({ maxLength: 40 }), grantId: str({ maxLength: 48 }), url: str({ maxLength: 2000 }), method: str({ maxLength: 8 }) }, ["agentId", "grantId", "url"], true), timeoutMs: 30000, description: "One brokered HTTPS request under an owner-signed grant." })],
    selfTest: { capability: "summary", expect: r => (typeof r.grants === "number" && r.integrity === "OK" ? true : "broker integrity " + r.integrity) } });
}
