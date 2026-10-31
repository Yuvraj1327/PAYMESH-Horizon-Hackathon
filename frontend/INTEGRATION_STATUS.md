# PayMesh frontend — integration status & missing backend contracts

Statuses: **Completed**, **Partially Completed**, **Not Implemented**, **Blocked**.

| Area | Status | Notes |
|---|---|---|
| Supabase email/password sign-in, register, session persistence/refresh, sign-out, protected routes | Completed | Other methods (OAuth, magic link, wallet sign-in) need Supabase project config and UI; not built. Verified against a mock GoTrue, **not** a real Supabase project. |
| Role-based UI (user/admin) | Completed | Role from `GET /users/me`; admin seeding tool in Developers. |
| Marketplace + agent details | Completed (live) | Agents and services are joined client-side (two endpoints). Backend has 4 categories; ratings = `reputation`; **no reviews endpoint** (none shown). |
| Procurement create/list/detail/select/cancel | Completed (live) | Title, capabilities, delivery and notes are folded into the single `description` field; title is derived from the first line. The backend cannot target a preferred agent. |
| Quotations + recommendation | Completed (live) | Recommendation is Claude/rule-based from the backend; the backend returns a score + note per quote, **no per-factor breakdown or capability match**, so none is shown. |
| AI assistant | Partially Completed | Backend has only `POST /ai/extract-requirements` (no chat endpoint). Replies are templated by the UI from that real extraction; provider matching runs client-side on live listings. |
| Payment intent, Guardian, review, mandate, checkout, status, receipt | Completed (live) | See Step 3 report. Verified against a mock backend, not the real HSP gateway. |
| **Signed authorization submission from the app** | **Blocked** | The backend/HSP flow signs on HSP's hosted checkout. The payer-side `pay-mandate` schema/EIP-712 types are not public (HSP_INTEGRATION.md §6). The app opens the checkout and never touches a signature. |
| Real HSP settlement on testnet | **Blocked** | Needs HSP QA credentials, a registered merchant key and a funded testnet wallet. |
| Provider notification of payment | Partially Completed | Provider endpoints exist (`/payments/provider/...`) and are documented in Developers; no provider dashboard UI. |
| Notifications | Partially Completed | **No notifications API.** The bell shows recent activity derived from real requests/payments; no unread state or push. |
| Transaction history search/sort | Partially Completed | List endpoint lacks search/date/network params → done client-side over the latest 100. |
| Block explorer links | Partially Completed | Shown only when `NEXT_PUBLIC_EXPLORER_URL_*` is set (testnet URL could not be verified). |
| PWA (manifest, icons, SW, offline, install, update prompt) | Completed | Install prompt appears only where the browser fires `beforeinstallprompt`. |
| On-chain agent registration UI | Not Implemented | Backend has `/blockchain/agents/{id}/verify-registration`; wallet-side registry call not built. |

## Missing / desirable backend contracts
1. Notifications endpoint (list + unread) or SSE/webhook for status changes.
2. Reviews/ratings endpoint for agents.
3. Search, network and date filters + total volume on `GET /payments/intents`.
4. Per-factor recommendation scores and capability match in `RecommendationOut` / `QuotationOut`.
5. A procurement `title`, `required_capabilities` and `preferred_agent_id` on `ProcurementCreate`.
6. A conversational endpoint for the Buyer Agent (optional).
7. Official payer-side HSP Payment Mandate schema (to allow in-app signing).
