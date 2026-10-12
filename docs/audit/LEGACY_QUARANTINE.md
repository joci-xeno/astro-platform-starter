# Legacy competition runtime — quarantine record
Files: `atlasz-runtime/supervisor.js`, `atlasz-runtime/worker.js`, `atlasz-runtime/agent-child.js` (and the `atlasz-competition-v1` policy inside `worker.js`).
Status: **QUARANTINED — not deleted, not activated, not registered in the module broker.** Final removal needs an explicit owner decision.
Enforced by `atlasz-tests/policy-guards.test.mjs`: the files may not be referenced from `atlasz-addons/`, `atlasz-control-center/` or `supervisor-safe.mjs`; the canonical start script must be `node supervisor-safe.mjs`; the legacy policy name may only exist in `worker.js`.
Open item (owner decision): `atlasz-runtime/package.json` `start` still points to the legacy `supervisor.js`; changing it touches the quarantine policy, so it is recorded as B6-005 and left unchanged.


## Update (Batch 7A)
`atlasz-runtime/package.json` `start` now runs `supervisor-safe.mjs`. The three legacy files remain quarantined (not deleted, activated or registered). `Dockerfile.worker` still launches legacy `supervisor.js`: recorded as an owner/dependency decision under B6-005.
