// V7.3 §12: LIVE/tested may never be asserted by a bare flag. A caller must hand over probe evidence
// produced by a real call: {probeId, outcome:"PASS", at:<ISO>, target}. Anything else counts as UNTESTED.
export function validProbeEvidence(e) {
  return Boolean(e && typeof e === "object" && typeof e.probeId === "string" && e.probeId
    && e.outcome === "PASS" && typeof e.target === "string" && e.target && Number.isFinite(Date.parse(e.at)));
}
export const isTested = (flag, evidence) => flag === true && validProbeEvidence(evidence);
