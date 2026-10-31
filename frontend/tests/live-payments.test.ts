import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the live backend client. Fixtures mirror the FastAPI response shapes in
 * backend/app/schemas/payments.py and payments/hsp_service.py (decimals as strings, error envelope, Page[T]).
 */
const INTENT = {
  id: "11111111-1111-4111-8111-111111111111", request_id: "22222222-2222-4222-8222-222222222222", quotation_id: "33333333-3333-4333-8333-333333333333",
  buyer_id: "44444444-4444-4444-8444-444444444444", provider_agent_id: "55555555-5555-4555-8555-555555555555", amount: "0.25000000", asset: "USDT", chain_id: 133,
  recipient: "0x1111111111111111111111111111111111111111", status: "VALIDATED", conditions_snapshot: { provider_name: "Crypto Research Agent" }, snapshot_hash: "ab".repeat(32),
  expires_at: "2026-10-31T12:00:00Z", failure_reason: null, created_at: "2026-10-31T11:30:00Z", updated_at: "2026-10-31T11:30:00Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let calls: { url: string; init?: RequestInit }[] = [];
function mockFetch(routes: Record<string, () => Response>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => `${init?.method ?? "GET"} ${new URL(url).pathname}${new URL(url).search}`.startsWith(k));
    if (!key) return json({ error: { code: "not_found", message: "no route in test", details: null, request_id: "t" } }, 404);
    return routes[key]!();
  }));
}

async function load() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
  return import("@/services/payments/live");
}

beforeEach(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("live payments client", () => {
  it("lists intents, trims decimals, attaches tx hashes from receipts and flags live source", async () => {
    mockFetch({
      "GET /api/v1/payments/intents": () => json({ items: [{ ...INTENT, status: "SETTLED" }], total: 140, limit: 100, offset: 0 }),
      "GET /api/v1/transactions/receipts": () => json({ items: [{ id: "r1", payment_intent_id: INTENT.id, receipt_reference: "RCPT-1", transaction_hash: `0x${"c".repeat(64)}`, settlement_status: "settled", verification_details: {}, created_at: "2026-10-31T11:40:00Z" }], total: 1, limit: 100, offset: 0 }),
    });
    const { liveBackend } = await load();
    const list = await liveBackend.list();
    expect(list.items[0]).toMatchObject({ amount: "0.25", providerName: "Crypto Research Agent", status: "SETTLED", source: "live", txHash: `0x${"c".repeat(64)}` });
    expect(list.truncated).toBe(true);
    expect(calls[0]!.url).toContain("limit=100");
    expect((calls[0]!.init?.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("still lists payments when the receipts endpoint fails (no hashes invented)", async () => {
    mockFetch({ "GET /api/v1/payments/intents": () => json({ items: [INTENT], total: 1, limit: 100, offset: 0 }) });
    const { liveBackend } = await load();
    const list = await liveBackend.list();
    expect(list.items[0]!.txHash).toBeNull();
  });

  it("creates an intent with an Idempotency-Key header and reports created vs existing", async () => {
    mockFetch({
      "GET /api/v1/payments/intents": () => json({ items: [], total: 0, limit: 20, offset: 0 }),
      "POST /api/v1/payments/intents": () => json(INTENT, 201),
    });
    const { liveBackend } = await load();
    const r = await liveBackend.create(INTENT.request_id);
    expect(r.created).toBe(true);
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect((post.init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^pm-/);
    expect(JSON.parse(post.init!.body as string)).toEqual({ request_id: INTENT.request_id });
  });

  it("turns a 422 payment_validation_failed into a blocked error carrying the Guardian's failures", async () => {
    mockFetch({
      "GET /api/v1/payments/intents": () => json({ items: [], total: 0, limit: 20, offset: 0 }),
      "POST /api/v1/payments/intents": () => json({ error: { code: "payment_validation_failed", message: "Payment validation failed: daily_limit", details: [{ rule: "daily_limit", message: "Daily spending limit exceeded" }], request_id: "r" } }, 422),
    });
    const { liveBackend } = await load();
    const { PaymentBlockedError } = await import("@/services/payments/types");
    await expect(liveBackend.create(INTENT.request_id)).rejects.toSatisfy((e: unknown) => e instanceof PaymentBlockedError && e.failures[0]?.rule === "daily_limit");
  });

  it("never treats gateway progress as paid: settled only when the backend says settled_and_verified", async () => {
    mockFetch({ "GET /api/v1/payments/intents/": () => json({ payment_intent_id: INTENT.id, status: "PENDING", settled_and_verified: false, hsp: { order_state: "created", gateway_status: "payment-finalized", payment_request_id: "PMR-1", flow_id: null, tx_hash: `0x${"d".repeat(64)}`, payer_address: null, cart_expiry: null, last_polled_at: null }, throttled: false, note: null }) });
    const { liveBackend } = await load();
    const s = await liveBackend.status(INTENT.id, true);
    expect(s.settledAndVerified).toBe(false);
    expect(s.status).toBe("PENDING");
    expect(s.hsp?.gatewayStatus).toBe("payment-finalized");
    expect(calls[0]!.url).toContain("refresh=true");
  });

  it("refuses a non-https checkout link", async () => {
    mockFetch({ "GET /api/v1/payments/intents/": () => json({ mode: "hsp_hosted_checkout", payment_url: "http://evil.example/pay", cart_mandate_id: "PM-1", payment_request_id: "PMR-1", expires_at: null, review: { recipient: INTENT.recipient, amount: "0.25", asset: "USDT", chain_id: 133, token_address: null, authorization_scheme: null }, instructions: [] }) });
    const { liveBackend } = await load();
    await expect(liveBackend.signingData(INTENT.id)).rejects.toMatchObject({ code: "unsafe_payment_url" });
  });

  it("returns the https checkout URL and the backend-supplied token address untouched", async () => {
    mockFetch({ "GET /api/v1/payments/intents/": () => json({ mode: "hsp_hosted_checkout", payment_url: "https://hsp.example/checkout/abc", cart_mandate_id: "PM-1", payment_request_id: "PMR-1", expires_at: "2026-10-31T12:00:00Z", review: { recipient: INTENT.recipient, amount: "0.25", asset: "USDT", chain_id: 133, token_address: "0x2222222222222222222222222222222222222222", authorization_scheme: "permit2" }, instructions: ["x"] }) });
    const { liveBackend } = await load();
    const s = await liveBackend.signingData(INTENT.id);
    expect(s).toMatchObject({ paymentUrl: "https://hsp.example/checkout/abc", tokenAddress: "0x2222222222222222222222222222222222222222", authorizationScheme: "permit2" });
  });

  it("rejects malformed backend data instead of using it", async () => {
    mockFetch({ "GET /api/v1/payments/intents": () => json({ items: [{ id: 1 }], total: 1, limit: 100, offset: 0 }) });
    const { liveBackend } = await load();
    await expect(liveBackend.list()).rejects.toThrow();
  });

  it("treats a missing receipt (404 receipt_not_found) as 'no receipt yet', not an error", async () => {
    mockFetch({ "GET /api/v1/payments/intents/": () => json({ error: { code: "receipt_not_found", message: "No verified receipt for this payment yet", details: null, request_id: "r" } }, 404) });
    const { liveBackend } = await load();
    expect(await liveBackend.receipt(INTENT.id)).toBeNull();
  });

  it("saves the policy with the backend's field names, amounts as strings", async () => {
    mockFetch({ "PUT /api/v1/policies/me": () => json({ id: "pol", max_transaction_amount: "5.00000000", daily_spending_limit: "20", permitted_agent_ids: [], allow_all_agents: true, allowed_assets: ["USDT"], allowed_chain_ids: [133], enabled: true, updated_at: "2026-10-31T11:00:00Z" }) });
    const { liveBackend } = await load();
    const p = await liveBackend.savePolicy({ maxTransactionAmount: "5", dailySpendingLimit: "20", allowAllAgents: true, permittedAgentIds: [], allowedAssets: ["USDT"], allowedChainIds: [133], enabled: true });
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ max_transaction_amount: "5", daily_spending_limit: "20", allow_all_agents: true, permitted_agent_ids: [], allowed_assets: ["USDT"], allowed_chain_ids: [133], enabled: true });
    expect(p.maxTransactionAmount).toBe("5");
  });

  it("returns null when no policy exists yet", async () => {
    mockFetch({ "GET /api/v1/policies/me": () => json({ error: { code: "policy_not_found", message: "No spending policy configured", details: null, request_id: "r" } }, 404) });
    const { liveBackend } = await load();
    expect(await liveBackend.getPolicy()).toBeNull();
  });
});
