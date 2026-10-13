# Stripe activation — OWNER-ONLY steps (nothing here has been done; Stripe is NOT live)

ATLASZ creates no Stripe account, holds no Stripe secret, and moves no money. Do not paste secret keys, webhook secrets or bank details into chat or into the repository.

What exists in code (tested with signed *fixture* webhooks only): signature verification (HMAC-SHA256, 5-minute tolerance, raw body), idempotent event ledger, out-of-order and conflicting-event handling, refund/dispute history with event times, fee capture from an expanded balance transaction, test/live separation, reconciliation, bank-reconciliation only with owner-authorised evidence.

## What you must do (in this order)
1. Use the **existing** Stripe account prepared by Astra (do not create a second one).
2. **Decide how Stripe reaches the receiver** (owner decision; the code does not expose anything to the internet). The receive-only listener (`atlasz-addons/payment-webhook-receiver.mjs`, path `/payments/webhook`, POST only, raw body, size/time limits) is never started automatically; you start it with a signed `PAYMENT_WEBHOOK_RECEIVER_START` bound to `host:port` (default `127.0.0.1`). Making it reachable from Stripe needs a tunnel, reverse proxy or hosting that **you** choose and, if it costs money, approve separately. Then create a **live-mode webhook endpoint** in the Stripe dashboard pointing at that public URL. Subscribe to: `payment_intent.created|processing|requires_action|succeeded|payment_failed|canceled`, `charge.refunded`, `refund.created|updated`, `charge.dispute.created|closed`, `payout.created|paid|failed|canceled`. Include the expanded `balance_transaction` on charge/payment-intent events if your setup allows it (it carries the real processing fee).
3. Put the endpoint's **signing secret** into the sealed vault under the key `stripe_webhook_secret_live` using the Control Center vault screen (passphrase-protected). Never in chat.
4. Put `invoice_id` in the payment-intent metadata for every invoice payment (the verifier matches on it, amount and currency).
5. Run **one small real payment** you control, then in the Control Center check: webhook accepted, payment shows PAYMENT_SUCCEEDED, fee known (or sign `PAYMENT_FEE_EVIDENCE` with the figure from your Stripe balance report), reconciliation clean.
6. Sign `COST_ATTESTATION` for the days/categories where you can vouch that all costs are in the ledger, and `FX_RATE_RECORD` for any non-USD currency you accept.
7. Only after steps 1–6 succeed with real external data is Stripe "operational". Until then every dashboard keeps showing `PAYMENT_PROCESSOR_WEBHOOK_NOT_CONFIGURED_NO_EVENTS`.

## Safety
Refunds, transfers, payout changes and payment-destination changes always need a separate signed approval for that exact action; the daily target cannot trigger any of them.
