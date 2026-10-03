# 03 Desktop and Computer Use

Build/attach a sandboxed Computer Use provider to atlasz-addons/computer-use-fabric.mjs. Desired hierarchy is immutable: JOCI/OWNER → MASTER → Planner → Agents → Tools/Computer Use.

AUTO: ordinary browsing/clicking/typing/research/file handling in allowed sandbox.
ASK_JOCI: spend, purchase, subscription, contract acceptance/signing, payment, banking/account-security/credential changes, sensitive external publication/deletion.
FORBIDDEN: disable/change owner authority, bypass approval, exfiltrate secrets, disable audit.

Create Windows ATLASZ Desktop/Control Center only after backend status endpoints are stable. UI must read runtime status dynamically; never hardcode agent/module counts. No API keys in desktop binary.
