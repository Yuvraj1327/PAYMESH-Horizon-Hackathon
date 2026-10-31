# PayMesh Frontend — Step 1 (Foundation & Dashboard)

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn-style UI (Radix + cva) · Lucide · React Hook Form + Zod · TanStack Query · wagmi + viem · PWA.

## Run
```bash
cd frontend
npm install
cp .env.example .env.local     # optional; defaults run the app on labelled demo data (testnet target)
npm run dev                    # http://localhost:3000  -> redirects to /dashboard
npm run check                  # typecheck + lint + production build
npm run build && npm start     # production server (the service worker only registers in production)
npm run icons                  # regenerate PWA PNG icons (needs Python + Pillow)
```

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

## Integration boundaries (nothing is wired yet)
| Concern | Where | State |
|---|---|---|
| FastAPI backend | `lib/api/client.ts`, `services/*` | typed client + Zod-validated responses; dashboard still returns demo data |
| Supabase auth | `registerAccessTokenProvider`, `use-current-user` | preview user only |
| MetaMask | `lib/web3/config.ts` (wagmi, **no connectors**), `WalletButton` | placeholder; never requests accounts |
| HashKey chains | `lib/web3/chains.ts` | ids 133/177 + RPC URLs; no token addresses or explorer URLs invented |
| HSP payments | — | later step; wallet signing happens in HSP's hosted checkout, never in this app's code |

## Safety notes
* Demo data is labelled everywhere (banner, badges) and contains no tx hashes or addresses; the payment overview states "Verified on-chain settlements: 0".
* No secrets in the browser: only `NEXT_PUBLIC_*`, validated in `lib/env.ts` (a bad chain id fails the build/start).
* Service worker caches only hashed static assets, icons and `/offline`; never documents, API calls, cross-origin or authenticated requests.
* Security headers + CSP in `next.config.ts` (tighten `script-src` with nonces later).
* System font stack (no Google Fonts fetch at build).
