# Financial and revenue engine (ATLASZ AURÓRA V7.3)

One authority, no second ledger. Evidence state of everything below: **IMPLEMENTED + TESTED WITH FIXTURES** (signed fake webhooks, owner test key). **Nothing is LIVE**: no Stripe account is connected, no webhook secret exists, no real payment has ever been recorded, real customer revenue = none.

## Who is the authority for what
| Question | Single authority | Notes |
|---|---|---|
| Was money received? | `business/payment-events.mjs` (processor-confirmed, LIVE only) | The cost ledger's own `PAID` entries are *reconciled against it* (`reconcileReceipts`) and never added to it. |
| What did it cost? | `financial-ledger.mjs` COST rows (evidence required, duplicate source+reference refused) | Costs are **unknown** unless the owner signs a completeness attestation (`cost-completeness.mjs`). |
| What is the daily/cumulative net? | `daily-profit-objective.mjs` | Reads the two above plus the documented-rate book (`fx-rates.mjs`). No ledger of its own. |
| May this money-related action happen? | `financial-guard.mjs` + owner approval | Target pressure never grants authority. |

## Net profit definition
`verified net = verified gross receipts − refunds − lost chargebacks − processing fees − AI usage − hosting/infrastructure − currency-conversion costs − other attributable costs`.
Tracked separately and never netted into each other: gross, refunds, lost chargebacks, fees, each cost category, pending payments (processor pending, not earned), outstanding invoices (not paid), open disputes (held out), bank-settlement view (processor "paid" ≠ bank reconciled).
Unknown stays unknown: a missing fee, an unconverted/unrated currency, unattested cost completeness, a corrupt record, a crypto receipt → net is `null` and the reason is listed under `unresolved`. If every *unknown* item can only lower the figure and the known upper bound is below USD 500, the day is `BELOW_MINIMUM` with `statusBasis: UPPER_BOUND_BELOW_MINIMUM…`; otherwise `NOT_VERIFIABLE`.

## Statuses (USD 500 is a floor)
`NOT_VERIFIABLE` · `BELOW_MINIMUM` (< 500.00) · `MINIMUM_MET` (exactly 500.00) · `ABOVE_MINIMUM` (> 500.00). `continueWork` is always `true`; nothing stops at the target.

## Time
Business day = **America/Vancouver** (DST-correct: 23 h on spring-forward, 25 h on fall-back; `dayBounds`). Every record keeps its UTC instant. A receipt belongs to the day of its processor event; a refund to the day of the refund event; a lost chargeback to the day the dispute closed. Earlier days are never rewritten by later corrections — the correction appears on the day it happens (a day can be negative). An open dispute holds the payment out of results until resolved.

## Currency
Original currency and amount stay in the payment record. A non-USD receipt counts only with an owner-signed, source-and-timestamped rate within 72 h of the event (`fx-rates.mjs`, append-only; the nearest rate wins; zero-decimal currencies such as JPY handled). No rate / stale / invalid → the amount is *unverified* and **not counted**. Conversion costs are a separate cost category that must be attested on days with conversions. Crypto currencies are never counted (no authoritative on-chain/settlement path exists): the receipt is listed as `CRYPTO_RECEIPT_SETTLEMENT_NOT_VERIFIED`.

## Crypto / Web3
Crypto/Web3 *development work* is ordinary service revenue (not auto-rejected for being paid in crypto). Crypto investment, trading, token purchases and autonomous investment are **prohibited by policy — even a valid owner signature cannot enable them**. Wallet transfers need a signed approval per transfer. An on-chain transfer is never "settled profit".

## Owner-signed inputs (all via Control Center, all hash-chained and replay-safe)
| Action | Signed `action` | Subject |
|---|---|---|
| Costs of categories X for days A..B are complete | `COST_ATTESTATION` | `attestationSubject({categories,fromDay,toDay})` |
| Revoke an attestation (effective from that day) | `COST_ATTESTATION_REVOKE` | attestation id |
| Record a documented exchange rate | `FX_RATE_RECORD` | `rateSubject({from,rate,asOf,source})` |
| Attach processor-fee evidence to a payment | `PAYMENT_FEE_EVIDENCE` | sha256 of `[paymentKey, feeMinor, currency, source, reference]` |
| Any money-moving action | `FINANCIAL_<ACTION>` | the exact thing approved |

## What is verified how
* Fixture tests: duplicate events (same id, same payment key, replay with different body), missing fees, unknown costs, non-USD with/without/stale/invalid rates, refunds, lost/open/won chargebacks, delayed confirmations, test-mode events, corrupted records, restart, midnight/DST, crypto, unauthorized financial actions, reconciliation, analytics (actual vs estimate), NET_PROFIT stage evidence.
* **Not verified against any real external system**: Stripe webhooks, balance transactions, bank statements, exchange-rate sources.

## Analytics
`revenue-analytics.mjs`: counts, conversion rates (only with ≥ 10 in the denominator, otherwise `null` + reason), average recorded cost per completed job, actual net margin. Estimates sit under `estimates` and are never added to actuals.
