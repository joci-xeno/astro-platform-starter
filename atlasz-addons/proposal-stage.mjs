// Phase E 8.1: proposal-draft stage. A ROUTED (Master-verified) opportunity becomes an owner-reviewable DRAFT made by a real EXECUTION agent (workforce `proposal_draft` executor),
// then recomputed by an independent checker (maker-checker). The draft is never sent: status stays DRAFT_NOT_SENT and sending is a separate owner-approved operation (SEND_EXTERNAL).
// Records here are evidence for the PLAN stage; they do not advance the opportunity by themselves, and a fixture-sourced draft is labelled as such.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const sha = s => createHash("sha256").update(s).digest("hex");
const ORDER = ["DISCOVER", "VERIFY", "QUALIFY", "ESTIMATE", "PLAN"];

/** createProposalStage({dir, registry, workforce, isStopped, now}) -> {draft, get, list, verify} */
export function createProposalStage({ dir, registry, workforce, isStopped = () => false, now = () => new Date().toISOString() } = {}) {
  if (!dir || !registry || !workforce) throw new Error("PROPOSAL_STAGE_NEEDS_DIR_REGISTRY_WORKFORCE");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "proposal-drafts.json");
  let S = { drafts: {} };
  if (fs.existsSync(file)) { try { S = JSON.parse(fs.readFileSync(file, "utf8")); if (!S?.drafts || typeof S.drafts !== "object") throw new Error("shape"); } catch { throw new Error("PROPOSAL_STATE_CORRUPT_NOT_OVERWRITTEN"); } }   // never silently replace invalid state
  const save = () => { const tmpf = file + ".tmp"; fs.writeFileSync(tmpf, JSON.stringify(S, null, 1), { mode: 0o600 }); fs.renameSync(tmpf, file); };
  const inflight = new Set();

  async function draft(opportunityId, { by = "OWNER_PANEL" } = {}) {
    if (isStopped()) return { ok: false, reason: "OWNER_STOP_OR_SAFE_MODE_ACTIVE" };
    const o = registry.get(opportunityId); if (!o) return { ok: false, reason: "UNKNOWN_OPPORTUNITY" };
    if (ORDER.indexOf(o.stage) < 1) return { ok: false, reason: "NOT_VERIFIED_BY_MASTER_INTAKE", stage: o.stage };
    if ((o.riskFlags ?? []).some(f => String(f).startsWith("FRAUD_INDICATOR:"))) return { ok: false, reason: "FRAUD_INDICATORS_PRESENT_NO_DRAFT", flags: o.riskFlags.filter(f => f.startsWith("FRAUD_INDICATOR:")) };
    if (!o.description || o.description.trim().length < 10) return { ok: false, reason: "DESCRIPTION_REQUIRED" };
    const key = sha(JSON.stringify([opportunityId, o.contentHash])).slice(0, 16);
    const prev = S.drafts[key]; if (prev && prev.status === "VERIFIED_DRAFT") return { ok: true, duplicate: true, ...structuredClone(prev) };   // idempotent per opportunity content
    if (inflight.has(key)) return { ok: false, reason: "DRAFT_ALREADY_IN_PROGRESS" }; inflight.add(key);
    try {
      const maker = workforce.selectAgent("EXECUTION", { skill: "doc.proposal_draft" }); if (!maker) return { ok: false, reason: "NO_USABLE_EXECUTION_AGENT_WITH_SKILL" };
      const input = { opportunity: { title: o.title, sourceRef: o.sourceUrl ?? ("registry:" + opportunityId), description: o.description, currency: o.currency ?? undefined, valueAmount: o.budget?.max ?? undefined, valueKind: o.budget?.max != null ? o.budget.kind : undefined, deadline: o.deadline ?? undefined, buyer: o.client ?? undefined, assessedAt: o.lastSeenAt ?? now(), retrieval: o.retrieval, sourceId: o.sourceId ?? undefined } };
      for (const k of Object.keys(input.opportunity)) if (input.opportunity[k] === undefined) delete input.opportunity[k];
      const ex = await workforce.executeTask(maker, { executor: "proposal_draft", input, authorization: { type: "OWNER_DIRECTED" }, via: "OWNER_PANEL" });
      if (!ex.ok) return { ok: false, reason: "EXECUTION_REFUSED:" + (ex.reason ?? "UNKNOWN") };
      const chk = await workforce.checkTask(ex.taskId);
      const t = workforce.getTask(ex.taskId);
      const rec = { draftId: "pd-" + key, opportunityId, retrieval: o.retrieval, fixtureOnly: o.retrieval === "FIXTURE", maker, checker: chk.checker ?? null, taskId: ex.taskId, artifactSha256: t?.resultSha256 ?? null, decision: chk.decision ?? null, status: chk.ok && chk.decision === "ACCEPT" && t?.status === "VERIFIED" ? "VERIFIED_DRAFT" : "NOT_VERIFIED", reasons: chk.reasons ?? [chk.reason].filter(Boolean), sent: false, deliveryStatus: "DRAFT_NOT_SENT", requestedBy: by, at: now(), note: o.retrieval === "FIXTURE" ? "Built from a FIXTURE record: a demonstration, not a real opportunity." : "Owner review and a separate signed approval are required before anything is sent." };
      S.drafts[key] = rec; save();
      return { ok: rec.status === "VERIFIED_DRAFT", ...structuredClone(rec) };
    } finally { inflight.delete(key); }
  }
  const list = () => Object.values(S.drafts).map(x => structuredClone(x)), get = id => list().find(x => x.draftId === id || x.opportunityId === id) ?? null;
  return { draft, get, list };
}
