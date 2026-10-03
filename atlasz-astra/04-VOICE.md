# 04 Voice

Attach real STT and TTS providers to atlasz-addons/voice-interface.mjs without putting credentials in source. Voice must route commands through MASTER and the same approval gates; voice cannot bypass owner approval.

Test: microphone → STT → MASTER intent → safe action/dry-run → TTS response. Mark LIVE only after end-to-end evidence.
