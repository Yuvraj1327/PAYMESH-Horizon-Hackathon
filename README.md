# PayMesh — Step 1: Core Backend

AI-powered **agent-to-agent procurement and payments** on HashKey Chain, built for the HSK Chain Horizon Hackathon 2026 (*Agent Payments & A2A Settlement* track).

> **Status: Steps 1 + 2 implemented and tested against test doubles.** Marketplace, procurement, Claude agents, spending policies,
> the real **HSP (HashKey Merchant) integration** — HMAC auth, ES256K Cart Mandate, order creation, status tracking, webhooks,
> authoritative settlement verification (gateway **and** chain), receipts, Receiving-Agent confirmation — and `AgentRegistry`.
> **Not yet proven against the live HSP gateway**: that needs your QA credentials (see `HSP_INTEGRATION.md` §7). Mainnet contract deployment is prepared but **not performed**.
> Docs: [`HSP_INTEGRATION.md`](HSP_INTEGRATION.md) (verified protocol + open questions + frontend contract) · [`PAYMENT_FLOW.md`](PAYMENT_FLOW.md) (lifecycle & failure handling).

## Repository layout

```
paymesh/
├── backend/                    FastAPI service (Python)
│   ├── app/
│   │   ├── main.py             app factory, middleware, CORS, routers
│   │   ├── api/v1/             users, agents, services, procurement, quotations, ai, policies,
│   │   │                       payments, transactions, blockchain, health
│   │   ├── core/               config, logging (redaction), errors, Supabase-JWT auth dependencies
│   │   ├── database/           async engine/session, declarative base + column types
│   │   ├── models/             the 12 SQLAlchemy tables + enums
│   │   ├── schemas/            Pydantic v2 request/response models
│   │   ├── services/           marketplace, procurement engine, policies, discovery, demo agents
│   │   ├── agents/             Buyer / Provider / Payment agents, prompts, structured outputs
│   │   ├── payments/           state machine, Payment Guardian, payment service, hsp_service (order/sync/verify/webhook), monitor (poller)
│   │   ├── integrations/
│   │   │   ├── anthropic/      Claude client: tool-use loop, validation, limits, timeouts
│   │   │   ├── supabase/       JWT verification (HS256 secret or JWKS)
│   │   │   ├── hsp/            authentication, tokens (official addresses), mandate, gateway (HTTPX), webhooks, verification
│   │   │   └── blockchain/     read-only web3.py client for AgentRegistry
│   │   ├── middleware/         request-id/logging/security headers, rate limiting
│   │   └── scripts/            seed_demo.py, hsp_qa_order.py (manual QA end-to-end + verification)
│   ├── alembic/versions/       0001 schema, 0002 RLS + grants + triggers, 0003 HSP flows/receipts/webhook events
│   ├── tests/                  pytest suite (see Testing)
│   ├── requirements*.txt, .env.example, Procfile, pytest.ini
└── contracts/                  Hardhat project: AgentRegistry.sol, tests, deploy script
```

## Architecture

```
 Next.js PWA (Step 3) ──Supabase JWT──▶ FastAPI ──▶ Supabase Postgres (RLS)
   user's wallet signs in HSP checkout     │
                                          ├─▶ Claude (tool use, structured output, validated)
                                          ├─▶ Payment Guardian  (deterministic; AI cannot influence it)
                                          ├─▶ HSP gateway client (HMAC + ES256K, HTTPX) ◀── signed webhooks
                                          └─▶ HashKey Chain RPC (read-only; no keys held)
```

**Trust boundaries (the important part)**

| Concern | Rule |
|---|---|
| Identity | Only from a verified Supabase JWT (`alg` allow-list, `aud`, `iss`, `exp`). Role is read from `profiles.role`; clients can never set it (`extra=forbid`, column-level grants, no claim is trusted). |
| Ownership | Every query is scoped server-side; foreign objects return `404`, never `403`, to prevent ID probing. |
| AI | Claude proposes, code decides. Output is Pydantic-validated; every ID it returns must belong to the server-computed eligible set; AI-extracted budgets must literally appear in the user's text; price and payout address on a quotation always come from the DB (never from the model or the client). If Claude is down or returns junk, deterministic fallbacks run. Untrusted text is fenced in `<untrusted_data>` with escaping. |
| Money | `Numeric(38,18)`; amounts/addresses validated (EIP-55 enforced); payment intents carry an **immutable snapshot** + SHA-256 hash (ORM guard **and** a Postgres trigger); a partial unique index allows at most one live intent per quotation; idempotency keys; daily limit computed under a row lock. |
| Settlement | `SETTLED` is unreachable without a `VerifiedSettlement` produced by the verifier: fresh HSP record **and** on-chain `Transfer` evidence **and** replay checks. A 2xx, a webhook body or a bare tx hash never settles. Delivery refuses unless the payment is `SETTLED` **and** a receipt row exists. |
| Keys | The backend holds **no wallet keys** and never touches a user's signature. The only key is the HSP *merchant* ES256K key (signs Cart Mandates; cannot move funds). Deploy keys live only in the shell environment of whoever runs Hardhat. |
| Errors | One envelope `{error:{code,message,details,request_id}}`; internals never leak; logs redact keys/JWTs/DB passwords. |

### Payment lifecycle

`DRAFT → VALIDATED → AWAITING_SIGNATURE → SIGNED → SUBMITTED → PENDING → SETTLED`, with `FAILED / EXPIRED / CANCELLED` branches.
Users drive an intent to `AWAITING_SIGNATURE` and register the HSP order; `SIGNED…SETTLED` follow the official HSP statuses and are server-only.
Full table and failure handling: [`PAYMENT_FLOW.md`](PAYMENT_FLOW.md).

### Payment Guardian rules (all failures reported together)

request ownership · quotation↔request association · provider selection · request/quotation status & expiry · provider active · **recipient unchanged since quote** · recipient valid / not the buyer · amount > 0 and ≤ request budget · asset matches budget and platform list · chain allowed · policy exists & enabled · per-transaction limit · policy asset/network · permitted agents · **daily limit** · duplicate prevention (idempotency key + DB index).

## Prerequisites

Python 3.12+ (tested on 3.13), Node 20+ (tested on 22), PostgreSQL 15+ (Supabase). Optional: Anthropic API key.

## Setup

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # fill in values (see comments in the file)
alembic upgrade head            # runs 0001 (schema) + 0002 (RLS, grants, triggers)
python -m app.scripts.seed_demo # needs DEMO_*_WALLET addresses you control
uvicorn app.main:app --reload   # http://localhost:8000/docs  (docs are disabled when APP_ENV=production)
```

**Supabase notes**
- `DATABASE_URL`: use the Supabase connection string (`postgresql://…` is converted to `asyncpg`). The transaction pooler (port 6543) is detected and prepared statements are disabled automatically. Run migrations over the **direct/session** connection.
- The backend connects as the privileged `postgres` role (bypasses RLS) and authorizes in code. RLS is the second wall for anything using `anon`/`authenticated` (supabase-js, PostgREST): read-only, own rows only; `profiles.role` is not updatable; financial tables have no client write access at all.
- Auth: new projects with asymmetric signing keys need only `SUPABASE_URL` (JWKS). Legacy projects also set `SUPABASE_JWT_SECRET`.
- Promote an admin directly in SQL: `update profiles set role='admin' where email='you@example.com';`

**Contracts**
```bash
cd contracts && npm install
npm test                                  # Hardhat tests (add HARDHAT_SOLCJS=1 if binaries.soliditylang.org is unreachable)
npm run deploy:testnet                    # needs DEPLOYER_PRIVATE_KEY in your shell env; chain 133
# Mainnet requires: CONFIRM_MAINNET_DEPLOY=I_UNDERSTAND npm run deploy:mainnet   (NOT done in Step 1)
```
Then set `AGENT_REGISTRY_ADDRESS` in `backend/.env`. The agent id on-chain is the agent's UUID left-aligned in a `bytes32` (`agent_uuid_to_bytes32`).

## API (all under `/api/v1`, Bearer JWT unless noted)

| Group | Endpoints |
|---|---|
| health (no auth) | `GET /health`, `GET /health/ready` (also at `/health`) |
| users | `GET/PATCH /users/me` |
| agents | `POST /agents`, `GET /agents` (q, category, kind, mine, paging), `GET/PATCH/DELETE /agents/{id}`, `POST /agents/{id}/suspend` (admin), `POST /agents/demo/seed` (admin) |
| services | `POST /services`, `GET /services` (agent_id, category, asset, max_price), `GET/PATCH/DELETE /services/{id}` |
| procurement | `POST/GET /procurement/requests`, `GET …/{id}`, `GET …/{id}/candidates`, `POST …/{id}/quotations` (broadcast), `GET …/{id}/quotations`, `POST …/{id}/recommend`, `POST …/{id}/select`, `POST …/{id}/cancel`, `POST …/{id}/deliver` (409 until payment is `SETTLED` + receipt) |
| quotations | `POST /quotations` (external provider answers a solicited request), `GET /quotations`, `GET /quotations/{id}`, `POST /quotations/{id}/withdraw` |
| ai | `GET /ai/status`, `POST /ai/extract-requirements`, `POST /ai/requests/{id}/recommend`, `GET /ai/requests/{id}/messages` (agent console), `POST /ai/payments/{id}/explain` |
| policies | `GET/PUT /policies/me` |
| payments | `POST /payments/intents` (`Idempotency-Key`), `GET /payments/intents[/{id}]` (history), `POST …/{id}/validate` (dry run), `POST …/{id}/authorize`, `POST …/{id}/mandate` (Cart Mandate → HSP order → `payment_url`), `GET …/{id}/signing-data`, `GET …/{id}/status` (syncs HSP, throttled), `POST …/{id}/verify`, `GET …/{id}/receipt`, `POST …/{id}/cancel` (refused once an HSP order exists), `GET /payments/provider/intents`, `GET /payments/provider/intents/{id}/verification[?refresh=true]` |
| webhooks (no JWT; HMAC-signed) | `POST /webhooks/hsp` |
| transactions | `GET /transactions/events`, `GET /transactions/receipts` (verified receipts only) |
| blockchain | `GET /blockchain/status`, `GET /blockchain/agents/{id}/onchain`, `POST /blockchain/agents/{id}/verify-registration` (backend re-reads the registry; client claims are never trusted) |

Pagination: `?limit=1..100&offset=`; lists return `{items,total,limit,offset}`.

**Demo vs. external agents.** Demo agents (`kind=demo`, `is_demo=true`, no owner, admin-managed) quote automatically and their deliverables are labelled `demo_content: true`. External agents (`kind=external`) are owned by a user, are solicited via `agent_messages`, and answer through `POST /quotations`. All three demo agents share the `crypto_research` category so a research request yields three quotes (0.25 / 0.40 / 0.60 USDT).

## Testing

```bash
cd backend && pytest -q                                   # 167 tests on in-memory SQLite; no network; HSP + RPC are in-process fakes
TEST_DATABASE_URL=postgresql://…/paymesh_test pytest -q   # same suite on real Postgres (+3 concurrency tests); RESETS that DB's tables
TEST_POSTGRES_URL=postgresql://…/postgres pytest -m postgres   # migrations 0001-0003 + RLS + grants + triggers on a scratch DB
HSP_LIVE_QA=1 HSP_QA_APP_KEY=… HSP_QA_APP_SECRET=… HSP_QA_MERCHANT_KEY_FILE=… HSP_QA_PAY_TO=0x… pytest -m hsp_live -s   # REAL QA gateway, no funds
RUN_NETWORK_TESTS=1 pytest -m network                     # live HashKey RPC
cd ../contracts && HARDHAT_SOLCJS=1 npm test              # 12 contract tests (omit the flag if solc binaries are downloadable)
```
`tests/hsp_fakes.py::FakeHSP` re-implements the *documented* gateway checks (HMAC + nonce replay + ES256K JWT + `cart_hash` + order rules) independently of the app code. It proves the client satisfies the written spec — **not** that the live gateway works.
No test makes a real payment.

## Payment testing (testnet)
1. Onboard with HashKey (HSP_INTEGRATION.md §1): generate the secp256k1 key, register the public key, get `app_key`/`app_secret`, set the webhook URL to `https://<backend>/api/v1/webhooks/hsp`.
2. `HSP_BASE_URL=https://merchant-qa.hashkeymerchant.com`, `HSK_CHAIN_ID=133`, `HSK_RPC_URL=https://testnet.hsk.xyz`, `SUPPORTED_ASSETS=USDT` (or `USDT,USDC`).
3. Fund a test wallet with HashKey-testnet USDT/USDC and a little HSK for gas (`python -m app.scripts.hsp_qa_order …` for a no-database smoke test, or drive the API from the frontend).
4. After one real QA payment, read `payment_receipts.verification_details`; tune `HSP_AMOUNT_SHORTFALL_BPS` only if HSP deducts fees from the payee.

## Mainnet configuration (prepared — NOT executed)
* Backend: `HSP_BASE_URL=https://hsp.hashkey.com` (or staging), `HSK_CHAIN_ID=177`, `HSK_RPC_URL=https://mainnet.hsk.xyz`, `APP_ENV=production`, mainnet-approved HSP credentials. The service refuses to boot or create orders if host and chain disagree; in production on-chain verification is always `strict`.
* Contract: `cd contracts && npm test && npm run preflight:mainnet` (read-only: chain id, deployer balance, source SHA-256, runtime bytecode hash) → review → then, with explicit approval, `DEPLOYER_PRIVATE_KEY=… CONFIRM_MAINNET_DEPLOY=I_UNDERSTAND npm run deploy:mainnet` → set `AGENT_REGISTRY_ADDRESS`. Never put the deployer key in the backend environment.

## Deployment (Railway)
`Procfile` runs `uvicorn … --proxy-headers` and `alembic upgrade head` as the release step. Set all variables from `.env.example` as service secrets; use the **direct/session** Supabase connection for migrations. Run **one** instance if `HSP_BACKGROUND_POLL=true` (rate limits and AI budgets are also per-process).

## HSP
Verified protocol facts, the implementation map, the frontend contract and the **open questions** are in [`HSP_INTEGRATION.md`](HSP_INTEGRATION.md).
Short version: orders are created with the official Merchant API (HMAC + ES256K Cart Mandate); the user pays in HSP's hosted checkout with MetaMask; PayMesh tracks status by webhook + polling and settles only after an independent gateway-and-chain verification.

## Known limitations
* **Not exercised against the live HSP gateway or HashKey RPC** (sandbox egress is blocked); use `hsp_qa_order.py` / `-m hsp_live` with your credentials.
* **Payer-side PaymentMandate** (`/payment/pay-mandate`, EIP-712 typed data) is undocumented publicly, so the wallet step is HSP's hosted checkout. An agent-signed, headless flow needs the Agentic Payment Guide (HSP_INTEGRATION.md §6).
* HSP has no documented order-cancel: after `/mandate` an intent can only complete, fail or expire.
* The on-chain amount check assumes the payee receives the full order amount (stablecoin ≈ 1 USD); tune `HSP_AMOUNT_SHORTFALL_BPS` after a real payment.
* Reviews endpoints, a scheduler for `expire_stale()`, Redis-backed rate limits/AI budgets, and refunds of "paid after close" payments are not implemented.
* Mainnet contract deployment intentionally **not** performed.
