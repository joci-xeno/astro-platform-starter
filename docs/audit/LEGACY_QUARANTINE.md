# Legacy competition runtime — quarantine record
Files: `atlasz-runtime/supervisor.js`, `atlasz-runtime/worker.js`, `atlasz-runtime/agent-child.js` (and the `atlasz-competition-v1` policy inside `worker.js`).
Status: **QUARANTINED — not deleted, not activated, not registered in the module broker.** Final removal needs an explicit owner decision.
Enforced by `atlasz-tests/policy-guards.test.mjs`: the files may not be referenced from `atlasz-addons/`, `atlasz-control-center/` or `supervisor-safe.mjs`; the canonical start script must be `node supervisor-safe.mjs`; the legacy policy name may only exist in `worker.js`.
Open item (owner decision): `atlasz-runtime/package.json` `start` still points to the legacy `supervisor.js`; changing it touches the quarantine policy, so it is recorded as B6-005 and left unchanged.


## Update (Batch 7A)
`atlasz-runtime/package.json` `start` now runs `supervisor-safe.mjs`. The three legacy files remain quarantined (not deleted, activated or registered). `atlasz-runtime/Dockerfile.worker` now starts only `supervisor-safe.mjs` (build from the repo root; legacy files are not copied into the image). Image build itself is unverified until a Docker daemon is available. Removal of the legacy files stays an owner decision (B6-005).
