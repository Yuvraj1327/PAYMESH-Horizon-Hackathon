# PayMesh Frontend — Final (Step 4: integration, testing, PWA, production polish)

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn-style UI · wagmi + viem (MetaMask) · TanStack Query · Supabase Auth · PWA.
Steps 1–3 (foundation, marketplace/procurement, wallet/payments/HSP) are preserved; Step 4 connects them to the real FastAPI backend.

## Two modes
| | Demo mode | Live mode |
|---|---|---|
| Trigger | `NEXT_PUBLIC_API_BASE_URL` empty | `NEXT_PUBLIC_API_BASE_URL` set (+ Supabase vars) |
| Auth | none (labelled preview identity) | Supabase email/password; the backend verifies every JWT |
| Data | labelled sample data in the browser session; stops before HSP | the real FastAPI endpoints; nothing is substituted when a call fails |

## Run / test / build
```bash
npm install
cp .env.example .env.local      # placeholders only; see comments inside
npm run dev                     # http://localhost:3000
npm test                        # 76 unit + contract tests (vitest)
npm run check                   # typecheck + lint + tests + production build
```

## Deploy (Vercel)
1. Import the repo, **Root Directory = `frontend`**, framework Next.js (`vercel.json` is included).
2. Set environment variables per environment (Settings → Environment Variables): `NEXT_PUBLIC_API_BASE_URL` (https), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_HSK_CHAIN_ID` (**133** until real-fund payments are approved), `NEXT_PUBLIC_SITE_URL`, optional `NEXT_PUBLIC_EXPLORER_URL_133/177`. Never put service-role, Anthropic or HSP secrets here.
3. On the backend set `CORS_ORIGINS` to the Vercel URL, and add the URL to Supabase Auth → URL configuration.
4. Redeploy (NEXT_PUBLIC_* values are baked in at build time). Production builds refuse a plain-http API URL (except localhost).

## Security notes
* The Supabase session is stored by supabase-js in `localStorage` (standard for a browser SPA calling a separate API). Mitigations: strict CSP, no `dangerouslySetInnerHTML`, no user HTML rendered, https-only checkout links. Residual risk: CSP still allows `'unsafe-inline'` scripts (Next bootstrap); move to nonces/middleware to remove it.
* Sign-out and session expiry clear the query cache, disconnect the wallet and delete app-stored keys. Protected routes are a UX convenience only; the backend and RLS are the authority.
* A 401 triggers one session refresh and one retry; if that fails the user is signed out. Payment mutations are never retried automatically.
* The service worker caches only hashed static assets and `/offline`; never documents, API, auth or payment responses. A new version waits for the user to tap "Update".


Built on Step 1 (foundation) and Step 2 (marketplace, procurement). Step 3 adds MetaMask, the Payment Center, the authorization workflow, receipts, transactions and Payment Guardian settings.

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn-style UI (Radix + cva) · Lucide · React Hook Form + Zod · TanStack Query · wagmi + viem · PWA.

## Structure
```
src/app/            routes: (app)/dashboard|marketplace|procurement|agents|payments|transactions|developers|settings,
                    manifest.ts, offline, not-found, error/loading boundaries
src/components/     ui/ (primitives) · layout/ (shell, sidebar, header, nav) · dashboard/ · states/ (loading/empty/error/coming-soon)
src/constants/      navigation
src/hooks/          use-dashboard (TanStack Query), use-current-user (preview identity until auth)
src/services/       dashboard.ts (integration boundary) + demo-data.ts (clearly labelled demo data)
src/lib/            env (validated NEXT_PUBLIC_*), api/client (typed fetch, error envelope), web3/{chains,config}
public/sw.js        privacy-preserving service worker; public/icons/ PWA icons
```

## Integration map
| Concern | Where |
|---|---|
| API client, 401 refresh/retry | `src/lib/api/client.ts` |
| Supabase auth, route gate | `src/lib/auth/`, `src/components/auth/` |
| Live adapters (DTO → UI models) | `src/services/live/` |
| Payments (live + labelled demo) | `src/services/payments/`, `src/services/demo/payments.ts` |
| Wallet / chains | `src/hooks/use-wallet.ts`, `src/lib/web3/` |
| Missing backend contracts, statuses | `INTEGRATION_STATUS.md` |

## Safety notes
* Demo data is labelled everywhere (banner, badges) and contains no tx hashes or addresses; the payment overview states "Verified on-chain settlements: 0".
* No secrets in the browser: only `NEXT_PUBLIC_*`, validated in `lib/env.ts` (a bad chain id fails the build/start).
* Service worker caches only hashed static assets, icons and `/offline`; never documents, API calls, cross-origin or authenticated requests.
* Security headers + CSP in `next.config.ts` (tighten `script-src` with nonces later).
* System font stack (no Google Fonts fetch at build).


## Routes (all connected)
`/login` `/register` · `/dashboard` · `/marketplace` `/marketplace/[agentId]` · `/procurement` `/procurement/new` `/procurement/[requestId]` `/procurement/[requestId]/quotations` `/procurement/[requestId]/pay` · `/agents` · `/payments` `/payments/[paymentId]` `/payments/[paymentId]/receipt` · `/transactions` · `/developers` · `/settings`

## Step 2 — routes
| Route | Purpose |
|---|---|
| `/marketplace` | search, category chips, sort, verified/available filters (URL-driven) |
| `/marketplace/[agentId]` | capabilities, services, pricing, provider info, reviews, Hire Agent |
| `/procurement` | KPIs, request history with search + status filter |
| `/procurement/new` | validated request form + AI Buyer assistant |
| `/procurement/[requestId]` | details, quotations, selected provider, real-event timeline, payment-preparation state |
| `/procurement/[requestId]/quotations` | comparison, AI recommendation with visible factors, explicit provider selection |
| `/agents` | Buyer / Provider / Payment agent roles (logical app-level roles, not deployed services) |

## Demo vs real
* **Demo mode** is active when `NEXT_PUBLIC_API_BASE_URL` is empty. Agents, quotations, assistant replies and request history come from `src/services/demo/` and are stored in `sessionStorage` (`paymesh.demo.v1`). Demo agents are not registered on-chain and have no wallet address; reviews are flagged as samples.
* The assistant and recommendation are deterministic heuristics (labelled "Demo"), not an LLM. Replace `src/services/assistant.ts` with a FastAPI/Claude call later.
* **Live mode** (API base URL set): services throw `BackendNotConnectedError` rather than calling invented endpoints.
* Selecting a provider only sets the request to "awaiting payment authorization". No wallet connection, signing, Payment Guardian, HSP mandate or transaction exists yet (Step 3).


## Step 3 — wallet, payments, HSP
| Route | Purpose |
|---|---|
| header | MetaMask connect/disconnect, short address + copy, native balance, network, switch-network prompts |
| `/payments` | KPIs, status filters, search, payment list |
| `/procurement/[requestId]/pay` | Payment review & authorization (create → Guardian → review → approve → HSP checkout → verified) |
| `/payments/[paymentId]` · `/receipt` | Conditions, mandate/authorization/settlement status, timeline · verified receipt, print, JSON download |
| `/transactions` | Search (payment ID / tx hash), status + network filters, date sort, pagination |
| `/settings` | Wallet & network card, Payment Guardian policy form |

**How signing works (verified from `HSP_INTEGRATION.md`, built from the official HSP merchant docs):** PayMesh registers a Cart Mandate on the backend, then the user opens HSP's *hosted checkout* (`payment_url`) where MetaMask signs HSP's EIP-712 authorization and HSP submits the Payment Mandate. This app never builds, sees or submits a signature, and does not do an ERC-20 transfer. The backend has no endpoint that accepts a user signature; the public docs do not specify the payer-side format. A payment is "completed" only when the backend reports `settled_and_verified`.

**Backend endpoints used:** `POST/GET /payments/intents`, `GET /payments/intents/{id}`, `POST …/validate|authorize|mandate|verify|cancel`, `GET …/signing-data|status|receipt`, `GET /transactions/events|receipts`, `GET/PUT /policies/me`. All responses are Zod-validated.

**Demo vs live:** with `NEXT_PUBLIC_API_BASE_URL` empty, a labelled local engine serves the payment screens; it can reach the review step but never creates an HSP order, never signs, never produces a transaction hash. With the URL set, every payment screen uses the real endpoints above.

**Config:** `NEXT_PUBLIC_EXPLORER_URL_133/177` (optional, https) enable explorer links; none is hardcoded because public sources disagree for testnet.

```bash
npm test      # 61 logic + live-contract tests (vitest)
npm run check # typecheck + lint + tests + build
```
