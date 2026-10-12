# Daily profit objective (owner directive)

- **Target:** USD 500 per day of **verified net profit** — a *minimum*, not a ceiling. `OBJECTIVE.stopsWorkWhenReached = false`, `ceilingUsd = null`; once met the status says `MINIMUM_MET` and `continueWork` stays `true`.
- **Results (module `atlasz-addons/daily-profit-objective.mjs`):** processor-confirmed payments (payment-events ledger, LIVE only) − refunds − lost chargebacks − processing fees − documented operating costs (financial ledger, entity ATLASZ_EXTERNAL). Open disputes are held out. Pending/initiated payments are shown as *pending, not earned*.
- **Unknown is never zero:** an unknown fee, a non-USD receipt (no conversion is guessed), unreadable costs or a non-LIVE environment gives `verifiedNetProfitUsd = null` and `NOT_VERIFIABLE`.
- **Forecasts/invoices** appear only under `forecast` (`FORECAST_NOT_RESULT`, `addedToResults:false`).
- **Basis limit:** processor confirmation is not bank receipt; payout bank reconciliation is a separate owner-authorised step. Day boundaries use the reported time zone (default UTC).
- **Continuous discovery:** `createDiscoveryScheduler` — persistent state, checkpoint before each run, minimum interval, per-day cap, exponential backoff, owner-stop honoured, no unbounded loop, no paid call. With no owner-approved live source it reports `NO_AUTHORISED_LIVE_SOURCE_CONNECTED`.
- **Dashboard:** `/api/profit/daily`, Control Center view "Daily Profit Target".
- **Blockers:** no live payment processor events, no live discovery source (needs the owner's signed host egress approval), Stripe webhook secret. Until verified records exist the objective is **not** claimed as achieved.
- Unchanged: exactly 5 SEARCH + 25 EXECUTION agents; all owner approvals; spending/transfers/trading stay owner-gated.
