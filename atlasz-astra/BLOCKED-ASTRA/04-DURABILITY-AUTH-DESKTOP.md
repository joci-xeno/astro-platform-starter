# Durability, owner authentication and desktop

Requires environment/platform work beyond source-only wiring:
1. Durable persistence for projects/tasks/progress/checkpoints/emergency state; prove restart/redeploy resume.
2. Strong owner authentication replacing simple boolean approval assertions.
3. Runtime-driven Mission Control/status dashboard.
4. Windows Desktop/Control Center using backend-held secrets; no API keys embedded in the desktop binary.
5. Voice must never bypass owner approval.
6. Preserve emergency stop and audit trail across restart where infrastructure permits.
