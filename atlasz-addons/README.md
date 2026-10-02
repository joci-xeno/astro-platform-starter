# ATLASZ additive modules

These files are additive only. They do not modify or replace the existing ATLASZ runtime.

Prepared modules:
- Money Supervisor: prioritizes the next revenue action.
- Deal State: controlled lead-to-paid state machine with owner approval gates.
- Follow-up Engine: T+2/T+5/T+10 scheduling and stop-on-reply.
- QA Reviewer: independent pass/fail and return-to-executor loop.
- Recovery: retry -> alternate tool/model -> blocked/human.
- Profit Ledger: LEAD_VALUE -> PROPOSED -> AGREED -> INVOICED -> PAID; PAID requires external confirmation.

Integration rule:
Astra/current runtime remains authoritative. These modules should only be wired into the live runtime after compatibility review and end-to-end tests. Do not remove or replace existing integrations.
