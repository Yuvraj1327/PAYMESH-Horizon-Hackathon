# HSP integration — what is verified, how PayMesh uses it, and what is still open

**Source of truth:** the official HashKey Merchant docs, `hashkey-merchant/hashkey-merchant.github.io`
(branch `page`, `docs/en/*.md`, commit `8460bdd`, changelog up to **v2.3.0 — 2026-10-16**), read directly in this build.
Everything marked **VERIFIED** below is quoted from that source. Anything not in it is under **OPEN** — it is not implemented.

> Not readable from the build sandbox: the DoraHacks *Agentic Payment Setup Guide* and `hashfans.io` (egress blocked / JS-rendered).
> The merchant docs are public and sufficient for the order → pay → settle flow below. See **OPEN** for the one thing the guide may add.

## 1. VERIFIED protocol facts (and where PayMesh implements them)

| Topic | Official behaviour | PayMesh |
|---|---|---|
| Hosts | QA `https://merchant-qa.hashkeymerchant.com` (**testnet tokens only**) · Staging `https://merchant-stg.hashkeymerchant.com` and Production `https://hsp.hashkey.com` (**mainnet tokens only**) | `HSP_BASE_URL`; `Settings.hsp_environment_error()` refuses QA+chain 177 and prod+chain 133 |
| Credentials | secp256k1 keypair (public key registered at onboarding) → `app_key`, `app_secret` from the merchant console | `HSP_APP_KEY`, `HSP_APP_SECRET`, `HSP_MERCHANT_PRIVATE_KEY_*` (server-side only, never in API responses/DB/logs) |
| Request auth | Headers `X-App-Key`, `X-Signature`, `X-Timestamp` (unix s), `X-Nonce` (UUID or 12–32 hex). `bodyHash = hex(SHA256(canonicalJSON(body)))` (empty for GET). `message = METHOD\nPATH\nQUERY\nbodyHash\ntimestamp\nnonce`. `signature = hex(HMAC_SHA256(app_secret, message))`. Skew ±300 s; nonce unique per app within 5 min | `integrations/hsp/authentication.py`; fresh timestamp+nonce **per attempt**; the exact canonical bytes that were hashed are the bytes sent |
| Merchant JWT | `cart_mandate.merchant_authorization` = ES256K JWT, header `{"alg":"ES256K","typ":"JWT"}`, claims `iss, sub, aud="HashkeyMerchant", iat, exp, jti, cart_hash`; `cart_hash = hex(SHA256(canonicalJSON(contents)))` | `build_merchant_authorization` |
| Canonical JSON | keys sorted recursively, compact, arrays keep order (RFC 8785-aligned) | `canonical_json` (tests use the docs' own examples) |
| Create order | `POST /api/v1/merchant/orders` → `{code:0, data:{payment_request_id, payment_url, multi_pay}}`; duplicate `cart_mandate_id` → `40001` | `HSPGateway.create_order` (never auto-retried) |
| Cart Mandate | `contents{id, user_cart_confirmation_required, payment_request{method_data[{supported_methods:"https://www.x402.org/", data{x402Version:2, network, chain_id, contract_address, pay_to, coin}}], details{id, display_items?, total{label,amount{currency:"USD",value}}, modifiers?}}, cart_expiry (RFC 3339), merchant_name}` | `integrations/hsp/mandate.py` — built **only** from the intent's immutable snapshot |
| Query | `GET /api/v1/merchant/payments?` exactly one of `cart_mandate_id` \| `payment_request_id` \| `flow_id` → payment record (status, tx_signature, payer_address, to_pay_address, chain `eip155:N`, token, token_address, amounts, …) | `HSPGateway.get_payment` (GETs retried safely) |
| Statuses | `payment-required → -submitted → -verified → -processing → -included → -safe → -finalized`, or `-failed`. Terminal: finalized, failed. *"wait for finalized when you need irreversible settlement"* | `HSPStatus`, mapping in §3 |
| Webhooks | POST to your `webhook_url` (HTTPS) at `payment-included/safe/finalized/failed`. `X-Signature: t=<ts>,v1=<hex>`, `v1 = HMAC_SHA256(app_secret, "{t}.{raw_body}")`, ±300 s, constant-time compare. 2xx within 10 s else retry (1 m, 5 m, 15 m, 1 h, 6 h, 24 h). Handlers must be idempotent | `POST /api/v1/webhooks/hsp`, `integrations/hsp/webhooks.py` |
| Payer flow | *"User signs — completes **EIP-712** authorization in the wallet"*; *"Checkout builds PaymentMandate and submits to gateway"*. Protocol per token: **EIP-3009** (USDC) or **Permit2** (USDT) | PayMesh sends the user to `payment_url` (hosted checkout) — see §4 |
| Tokens (HashKey) | Testnet **133**: USDC `0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6` (EIP-3009), USDT `0x372325443233fEbaC1F6998aC750276468c83CC6` (Permit2). Mainnet **177**: USDC `0x054ed45810DbBAb8B27668922D110669c9D88D0a` (EIP-3009), USDT `0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029` (Permit2). 6 decimals. Network names `hashkey-testnet` / `hashkey` | `integrations/hsp/tokens.py` (the **only** place addresses live; 4 test-pinned rows) |
| Errors | envelope `{code,msg,data}`; `10001` params, `10002` unauthorized, `10003` not found, `10004` conflict, `10007` rate limited, `40001` mandate state/duplicate | `gateway._parse` → typed `HSP*Error`s |

## 2. Why the wallet step is HSP's hosted checkout (and not a backend-built "signing payload")

The public reference documents the **Cart Mandate** completely, but the **Payment Mandate is produced by HSP's checkout page**:
the user opens `payment_url`, the checkout shows the order, the wallet signs the EIP-712 authorization, and the checkout
submits the PaymentMandate to the gateway. The request schema of the payer-side submit route
(`/api/v1/payment/pay-mandate`) and the exact EIP-712 domain/types are **not** in the public docs. Several hackathon
repos reverse-engineered them, and one of them states plainly that the route and the `user_authorization` format are
"not yet confirmed by HashKey". Per the instruction *"never invent … signature specifications"*, PayMesh does **not**
fabricate those typed-data structures and does **not** touch the user's signature at all. Consequences, all good for safety:

* the backend never sees, validates-by-guessing, stores or replays a user signature — HSP's gateway validates it;
* the user's wallet (MetaMask) does the signing, on HSP's page, against the **exact order PayMesh registered**;
* PayMesh's security rests on what it *can* check authoritatively: that the order HSP holds equals the user-approved
  snapshot (§5), and that the payment truly settled to the right payee on the right chain (§3).

## 3. Settlement = gateway record **and** chain evidence

Internal state ← official status (`integrations/hsp/schemas.py`, `payments/hsp_service.py`):

| Official HSP status | Internal state | Notes |
|---|---|---|
| (order registered) `payment-required` | `AWAITING_SIGNATURE` | user is at checkout |
| `payment-submitted`, `payment-verified` | `SIGNED → SUBMITTED` | authorization is at the gateway |
| `payment-processing`, `payment-included`, `payment-safe` | `PENDING` | tx hash recorded when present; **not settlement** |
| `payment-finalized` | `PENDING` → **`SETTLED` only after verification passes** | `HSP_SETTLEMENT_MIN_STATUS` may be `payment-safe` |
| `payment-failed` | `FAILED` | terminal |

`payments/hsp_service.verify` re-queries the gateway (never trusts a webhook body) and runs these checks, all stored in
`payment_receipts.verification_details`: status ≥ minimum · `payment_request_id`/`content_id` match · payee equals snapshot recipient ·
chain `eip155:{id}` · token symbol **and official address** · stablecoin rate within 0.95–1.05 · order amount equals the intent amount ·
payer equals the buyer's registered wallet (if any) · tx hash well-formed and **never used by another payment** · on our own RPC:
tx found, status 1, finalized (or ≥ `HSP_MIN_CONFIRMATIONS`), and an ERC-20 `Transfer(token, payer → payee)` ≥ the order amount.
Only then: receipt row (unique per intent and per tx hash, append-only in Postgres) → `SETTLED`.
A payment that reaches HSP for an intent PayMesh already closed (expired/cancelled/failed) is logged as
`payment_received_for_closed_intent` for manual refund — it is never delivered against.

## 4. Frontend contract (no frontend files were touched)

All calls: `Authorization: Bearer <Supabase JWT>`. Errors use `{error:{code,message,details,request_id}}`.

1. `POST /api/v1/payments/intents {request_id}` (+ optional `Idempotency-Key`) → intent `VALIDATED`.
2. `POST /api/v1/payments/intents/{id}/authorize` → `AWAITING_SIGNATURE` + `review` object to display (provider, recipient, amount, asset, chain, expiry, `snapshot_hash`).
3. After the user confirms the review: `POST /api/v1/payments/intents/{id}/mandate` → registers the order → `{payment_url, payment_request_id, cart_expiry, …}`.
4. `GET /api/v1/payments/intents/{id}/signing-data` → `{mode:"hsp_hosted_checkout", payment_url, review{token_address, authorization_scheme, …}, expires_at, instructions}`.
   **Open `payment_url`** (same-tab redirect or new tab; the user's MetaMask signs there). Do not embed it in an iframe unless HashKey confirms it allows framing. Chain: 133 testnet / 177 mainnet (`wagmi` network switch on the HSP page itself).
5. Poll `GET /api/v1/payments/intents/{id}/status` every 3–5 s (throttled server-side; `throttled:true` means "no new data yet") until `status` is `SETTLED`, `FAILED`, `EXPIRED`. Show `hsp.gateway_status` as progress only; **show "paid" only when `settled_and_verified` is true**.
6. `POST …/verify` (optional, idempotent) forces authoritative verification; `GET …/receipt` returns the receipt; `GET /api/v1/payments/intents` is history.
7. Provider dashboard: `GET /api/v1/payments/provider/intents`, `GET /api/v1/payments/provider/intents/{id}/verification[?refresh=true]` → `eligible_for_delivery`; delivery itself is `POST /api/v1/procurement/requests/{id}/deliver`.
8. A user cannot cancel after step 3 (HSP has no documented order-cancel): `409 hsp_order_registered`; the order simply expires at `cart_expiry`.

## 5. Safeguards specific to this integration

* One HSP order per intent: deterministic `PM-{intent}` / `PMR-{intent}` ids, unique DB columns, row-locked creation. An *ambiguous* create (timeout/5xx/`40001`) is recorded as `create_uncertain` and **never retried** (would risk two payable orders).
* The cart is built after a full Payment-Guardian re-validation + snapshot-hash check; changed policy/recipient/quote ⇒ intent `FAILED`, nothing sent.
* `payment_url` must be `https`. Environment (QA vs prod) and chain must agree.
* Idempotent, replay-safe webhooks: body SHA-256 dedupe, error ⇒ non-2xx so HSP retries, unknown orders acknowledged and ignored.

## 6. OPEN — needs HashKey / the Agentic Payment Guide (nothing below is guessed in code)

1. **Payer-side `pay-mandate` schema + EIP-712 typed data** — only needed if you want an agent to sign/submit *without* the hosted checkout. Not implemented. Provide the guide text and it can be added behind a flag in `integrations/hsp/` without touching the rest.
2. **Onboarding** — public key registration, `supported_chain_tokens`, `service_rate`, `webhook_url` (must be HTTPS and point at `/api/v1/webhooks/hsp`). Whether mainnet production access needs approval is not stated.
3. **`pay_to` policy** — the docs show `pay_to` as the payee address; whether it must be pre-registered/allow-listed per merchant, and whether `service_rate` fees are taken from the payee amount (affects `HSP_AMOUNT_SHORTFALL_BPS`; default 0 = exact), is not stated. Run one QA payment and read `verification_details` before tuning.
4. **`flow_id`** — the overview says order creation returns it; the API reference response does not. PayMesh keys everything on `payment_request_id` and records `flow_id` from payment queries.
5. **Query before payment** — behaviour of `GET /merchant/payments` for an order nobody has paid yet is undocumented; PayMesh treats `10003`/404 as "no payer activity".
6. **JWT `aud`** — docs say `HashkeyMerchant`; a third-party note says SDKs use `HashKeyMerchant`. The docs value is used and configurable (`HSP_JWT_AUDIENCE`). If QA rejects with `10002`, try the alternative.
7. **Hosted-checkout framing / redirect params** — undocumented.

## 7. How to prove it against the real gateway (needs your credentials; moves no funds until a wallet pays)

```bash
export HSP_BASE_URL=https://merchant-qa.hashkeymerchant.com HSK_CHAIN_ID=133 HSK_RPC_URL=https://testnet.hsk.xyz
export HSP_APP_KEY=… HSP_APP_SECRET=… HSP_MERCHANT_PRIVATE_KEY_FILE=/path/merchant_private_key.pem
python -m app.scripts.hsp_qa_order create --pay-to 0xYourTestRecipient --amount 0.01 --dry-run   # inspect the cart
python -m app.scripts.hsp_qa_order create --pay-to 0xYourTestRecipient --amount 0.01             # real QA order -> payment_url
# open payment_url, pay with a testnet wallet that holds HashKey-testnet USDT/USDC, then:
python -m app.scripts.hsp_qa_order watch --payment-request-id PMR-QA-… --pay-to 0xYourTestRecipient --amount 0.01
HSP_LIVE_QA=1 HSP_QA_APP_KEY=… HSP_QA_APP_SECRET=… HSP_QA_MERCHANT_KEY_FILE=… HSP_QA_PAY_TO=0x… pytest -m hsp_live -s
```
`watch` prints every verification check (PASS/FAIL, expected vs actual) — paste that output as your testnet evidence.
