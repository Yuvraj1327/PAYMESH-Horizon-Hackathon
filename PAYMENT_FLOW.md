# PayMesh payment lifecycle

```
 Buyer Agent ─ request ─▶ Provider Agent(s) ─ quotation (price, payee = agent wallet, chain) ─▶ Buyer picks one
                                                                                                   │
 Payment Agent (deterministic Payment Guardian; Claude may only explain) ◀── select ──────────────┘
   POST /payments/intents ............ VALIDATED     immutable snapshot + SHA-256 (ORM guard + Postgres trigger)
   POST …/{id}/authorize ............. AWAITING_SIGNATURE   full re-validation → review payload shown to the user
   POST …/{id}/mandate ............... Cart Mandate built from the snapshot, ES256K-signed, registered at HSP
   GET  …/{id}/signing-data .......... payment_url  ──▶ user's wallet (MetaMask) signs EIP-712 in HSP checkout
                                          HSP: payment-submitted → verified → processing → included → safe → finalized
   webhook / poll / GET …/status ..... internal SIGNED → SUBMITTED → PENDING (tx hash recorded, NOT settlement)
   POST …/{id}/verify  (or auto) ..... gateway re-query + on-chain evidence + replay checks ─ pass ─▶ receipt + SETTLED
   GET  /payments/provider/…/verification  Receiving Agent confirms payment → eligible_for_delivery
   POST /procurement/requests/{id}/deliver  provider delivers (separate delivery_status; proves nothing about quality)
```

## States

| State | Entered by | Leaves to |
|---|---|---|
| `DRAFT` | intent row created | `VALIDATED` (same transaction) |
| `VALIDATED` | Guardian passed, snapshot frozen | `AWAITING_SIGNATURE`, `CANCELLED`, `EXPIRED`, `FAILED` |
| `AWAITING_SIGNATURE` | `/authorize` re-validation passed | `SIGNED…` once HSP reports activity; `EXPIRED`; `FAILED`; **not cancellable after `/mandate`** |
| `SIGNED` → `SUBMITTED` | HSP `payment-submitted` / `-verified` (server only) | `PENDING`, `FAILED` |
| `PENDING` | HSP `-processing` / `-included` / `-safe` (server only) | `SETTLED`, `FAILED`, `EXPIRED` |
| `SETTLED` | `verify` passed (needs `VerifiedSettlement` + receipt row) | terminal |
| `FAILED` / `EXPIRED` / `CANCELLED` | see above | terminal |

`SIGNED/SUBMITTED/PENDING/SETTLED` cannot be reached from any public endpoint; `SETTLED` is impossible without the
verification evidence object. A skipped HSP status (e.g. first poll already shows `payment-included`) walks the
intermediate states one by one, each logged.

## What can go wrong, and what PayMesh does

| Situation | Behaviour |
|---|---|
| User never pays | intent `EXPIRED` at `cart_expiry`; request returns to `selected`; poller keeps watching for late activity for 2 h |
| Paid after PayMesh expired/cancelled/failed the intent | event `payment_received_for_closed_intent` (critical log); **no state change, no delivery** → manual refund |
| HSP/RPC outage | read endpoints return 504/503; money state never changes on an outage; webhooks answer non-2xx so HSP retries |
| Order creation timed out | `create_uncertain`; no retry; intent can only expire (prevents two payable orders) |
| Gateway says finalized but chain disagrees (no tx / reverted / wrong payee, token, amount, payer / reused tx) | `payment_verification_failed` with the failing checks; stays `PENDING`; no receipt; no delivery |
| Webhook forged / replayed / stale | 401 (bad or old signature) · duplicate body = no-op · a signed webhook is only a trigger; truth comes from the gateway re-query |
| Two concurrent verify/webhook/status calls | row-locked; exactly one receipt and one `payment_settled` event (tested on Postgres) |
| Two concurrent intents that together exceed the daily limit | policy row lock; exactly one succeeds (tested on Postgres) |
| Provider changes wallet after quoting | Guardian rejects (`recipient_changed`); after payment, verification is against the snapshot payee |

## Audit trail

`transaction_events` (append-only in Postgres): intent created/validated/…, `hsp_order_created|create_failed|create_uncertain`,
`hsp_status_changed`, `hsp_record_mismatch`, `hsp_tx_hash_reuse_detected`, `hsp_webhook_processed`, `payment_verification_failed`,
`payment_settled_verified`, `payment_received_for_closed_intent`, `payment_settled`, …
`hsp_webhook_events` keeps every authenticated delivery (server-only table). No secrets are stored anywhere; the flow row keeps only the JWT `jti`.
