# Payment integration handoff (Astra → ATLASZ)

Astra prepares the Stripe registration and Stripe–KOHO integration separately. ATLASZ creates **no** Stripe account and **no** parallel financial system.

## How a package is received
1. Astra provides a separate reviewed Git branch or a code package (never credentials, never bank data).
2. `atlasz-addons/payment-package-intake.mjs` `reviewPackage(dir)` runs read-only (it never executes package code or contacts a network). BLOCKERS: embedded Stripe/other credentials, private keys, IBAN / Canadian transit-account / card numbers, `.env`/credential files, symlinks, money-moving API calls without an owner-approval gate, no tests.
3. Manual review of source and tests; compatibility checks against: the vault (credentials by reference only), the owner-approval system (every charge/refund/transfer/payout-change bound to action+subject), the revenue ledger (`PAID` only with external evidence and `confirmedReceived`), and the Control Center (verified receipts shown apart from estimates).
4. Merge into `atlasz-v73-integration` only after the security and integration tests pass. Never into `main` without separate authorization.

## Invariants that stay in force
- Real charges, refunds, transfers and payout changes need a separate signed owner approval each.
- A Stripe webhook or API response alone never moves an opportunity to `PAID`; the ledger needs the evidence record and the owner-visible confirmation.
- Sandbox/test-mode results are SANDBOX, never LIVE; invoice ≠ paid.

Status: intake gate IMPLEMENTED and TESTED; no Astra package received yet (EXTERNAL_BLOCKER: waiting for Astra).
