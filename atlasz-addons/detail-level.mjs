// Adaptive multimodal processing policy (85-capability programme: P15). Decides HOW MUCH of an image/audio/video/document to process for a purpose, under privacy and budget.
// Pure policy, no provider call: it only answers METADATA_ONLY | SAMPLE | STANDARD | FULL and why. CONFIDENTIAL content never goes to an external provider. Unknown inputs fail closed.
export const MODALITIES = Object.freeze(["text", "document", "image", "audio", "video"]);
export const PRIVACY = Object.freeze(["PUBLIC", "PERSONAL", "CONFIDENTIAL"]);
export const PURPOSES = Object.freeze(["INDEX", "SUMMARY", "ANSWER", "AUDIT"]);
export const LEVELS = Object.freeze(["METADATA_ONLY", "SAMPLE", "STANDARD", "FULL"]);
const MB = 1024 * 1024;
export function chooseDetail({ modality, bytes, privacy = "CONFIDENTIAL", purpose = "SUMMARY", provider = "NONE", providerFree = true, budgetUsd = 0 } = {}) {
  if (!MODALITIES.includes(modality)) return { ok: false, reason: "MODALITY_INVALID" };
  if (!Number.isFinite(bytes) || bytes < 0) return { ok: false, reason: "BYTES_INVALID" };
  if (!PURPOSES.includes(purpose)) return { ok: false, reason: "PURPOSE_INVALID" };
  if (!["NONE", "LOCAL", "EXTERNAL"].includes(provider)) return { ok: false, reason: "PROVIDER_INVALID" };
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) return { ok: false, reason: "BUDGET_INVALID" };
  const reasons = [], priv = PRIVACY.includes(privacy) ? privacy : "CONFIDENTIAL"; if (priv !== privacy) reasons.push("unknown privacy class -> CONFIDENTIAL");
  let idx = { INDEX: 1, SUMMARY: 2, ANSWER: 2, AUDIT: 3 }[purpose];
  const heavy = modality === "video" ? 50 * MB : modality === "audio" ? 25 * MB : modality === "image" ? 10 * MB : 5 * MB;
  if (bytes > heavy * 4) { idx = Math.min(idx, 1); reasons.push("very large input -> sample"); } else if (bytes > heavy) { idx = Math.min(idx, 2); reasons.push("large input -> standard at most"); }
  let usable = provider !== "NONE";
  if (provider === "NONE") { idx = 0; reasons.push("no provider: built-in metadata/structure analysis only"); }
  if (provider === "EXTERNAL" && priv === "CONFIDENTIAL") { idx = 0; usable = false; reasons.push("CONFIDENTIAL content is never sent to an external provider"); }
  if (provider === "EXTERNAL" && providerFree !== true && budgetUsd === 0) { idx = 0; usable = false; reasons.push("external provider is not free and no spend is approved"); }
  if (provider === "EXTERNAL" && priv === "PERSONAL") { idx = Math.min(idx, 2); reasons.push("PERSONAL content: never FULL on an external provider"); }
  return { ok: true, level: LEVELS[idx], providerUsed: usable, privacy: priv, spendUsd: 0, reasons };
}
