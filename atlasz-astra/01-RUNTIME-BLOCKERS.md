# 01 Runtime blockers

1. Deploy current HEAD of branch atlasz-30-runtime to existing Railway service atlasz-30-workers. Do not replace the service.
2. Run Node/ESM import validation across atlasz-addons/internal-integration-hub.mjs and every imported module. Fix export-name mismatches additively.
3. Confirm node atlasz-runtime/supervisor-safe.mjs starts and /health returns HTTP 200.
4. Confirm /status reports exactly 5 SEARCH and 25 EXECUTION agents.
5. Add durable Railway volume/state persistence if not present, but do not destroy existing state or services; owner approval if any paid plan/cost is required.
6. Verify ATLASZ_WORKER_URL in outreach executor points to the intended healthy worker service.
7. Verify outreach executor behavior: QUEUED_FOR_SEND must never be counted as SENT. SENT only after real provider acceptance.
