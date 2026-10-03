# Runtime validation of already-present modules

Current source has had several ESM named-import fixes. Source presence is not runtime proof.

Required work:
1. Deploy current HEAD of atlasz-30-runtime to atlasz-30-workers.
2. Validate all named ESM imports/exports before startup.
3. Start node atlasz-runtime/supervisor-safe.mjs.
4. Prove /health and /status return success.
5. Prove exactly 5 SEARCH + 25 EXECUTION agents.
6. Prove internal Integration Hub loads and snapshot works.
7. Exercise representative adapters without external side effects: checkpoint, ledgers, planner, QA, recovery, tool registry, project registry, emergency gate, profit accounting.
8. Record deployment ID, commit SHA, health evidence and any failing stack traces.
9. Do not mark modules LIVE solely because import succeeds.
