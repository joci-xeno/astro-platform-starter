# LEGACY_EXCLUDED / DO_NOT_MERGE

`worker.js` carries the `atlasz-competition-v1` policy (300-agent / 6x5 competition architecture).
It is EXCLUDED from the canonical ATLASZ V7.3 runtime (5 SEARCH + 25 EXECUTION = 30) by JOCI decision.

- It is kept (not deleted) so history and the production `start` script (`supervisor.js`) are untouched.
- The canonical runtime `supervisor-safe.mjs` (`npm run start:canonical`), the addons and the Control Center must never import or reference it.
  This is enforced by `atlasz-tests/policy-guards.test.mjs`.
- Do not merge competition logic into the canonical runtime. Generic code may be reused only if independent of the competition system, compatible with V7.3 and covered by tests.
