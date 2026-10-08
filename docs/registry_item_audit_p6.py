# Round 6 item-level statuses (Task 2: sandbox / multimodal / observation memory / live voice). Every change is backed by code + a passing test in this repo.
# Nothing here is LIVE against a real provider: no STT/TTS/OCR/vision credentials, no spend, no production deployment.
A, T, C = "atlasz-addons/", "atlasz-tests/", "atlasz-control-center/"
I = {
 "V73-S04-010": dict(status="PARTIAL", implementation_location=A+"observation-memory.mjs; "+A+"voice-conversation.mjs", tests=[T+"observation-memory.test.mjs", T+"observation-memory-hosted.test.mjs"],
   evidence=["Observation memory: consent, retention, correction, real deletion, tenant isolation; owner can save a voice transcript turn as a memory note (voice-conversation-hosted.test)"], blocker="Recall is keyword-based, not semantic; nothing is captured automatically"),
 "V73-S05-013": dict(status="PARTIAL", implementation_location=C+"core.mjs (voiceAction remember); "+A+"observation-memory.mjs", tests=[T+"voice-conversation-hosted.test.mjs"],
   evidence=["Owner-chosen transcript turn becomes an ordinary observation with source.ref {conversationId, turn}; no automatic linkage by design"], blocker="No automatic or project linkage; no live voice provider so only mock-provider transcripts exist"),
 "V73-S23-012": dict(status="PARTIAL", implementation_location=A+"modality-fabric.mjs; "+A+"document-center.mjs", tests=[T+"modality-fabric.test.mjs", T+"modality-fabric-hosted.test.mjs", T+"document-center.test.mjs"],
   evidence=["Images (PNG/JPEG/GIF/WEBP/BMP) are identified and parsed for size/EXIF flags and stored as METADATA_ONLY documents; GPS flagged, coordinates never extracted"], blocker="No OCR/vision provider: image content is not understood and not searchable"),
}
