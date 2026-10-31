import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoryFromApi, categoryToApi, composeDescription, deriveTitle, mapAgent, mapMessage, mapQuotation, mapRecommendation, mapRequest, statusFromApi } from "@/services/live/mappers";
import { safeNext } from "@/lib/auth/redirect";
import { describeAuthError } from "@/lib/auth/errors";
import { buildDashboard } from "@/services/dashboard";
import type { AgentDto, QuotationDto, RequestDto, ServiceDto } from "@/services/live/schemas";
import type { NewRequestInput } from "@/types/procurement";

const agent: AgentDto = { id: "a1", owner_id: null, kind: "demo", is_demo: true, name: "Crypto Research Agent", description: "d", wallet_address: "0x1111111111111111111111111111111111111111", category: "crypto_research", capabilities: ["Market research"], status: "active", onchain_registration_reference: null, reputation: 4.5, created_at: "2026-01-01T00:00:00Z" };
const svc: ServiceDto = { id: "s1", provider_agent_id: "a1", name: "Brief", description: "", price: "0.25", payment_asset: "USDT", is_available: true, delivery_estimate_minutes: 5, created_at: "" };
const quote: QuotationDto = { id: "q1", request_id: "r1", provider_agent_id: "a1", service_id: "s1", price: "0.25", payment_asset: "USDT", chain_id: 133, pay_to_address: "0x1111111111111111111111111111111111111111", delivery_estimate_minutes: 5, response_details: { summary: "Will do" }, status: "accepted", expires_at: "", created_at: "2026-10-01T00:00:00Z" };
const req: RequestDto = { id: "r1", buyer_id: "b", description: "Crypto market research brief\nNeed a research brief.\nRequired capabilities: Market research, Risk summary", category: "crypto_research", requirements: { delivery_deadline_minutes: 15 }, max_budget: "1", budget_asset: "USDT", status: "selected", selected_provider_id: "a1", selected_quotation_id: "q1", recommendation: null, delivery_status: "not_started", expires_at: null, created_at: "2026-10-01T00:00:00Z" };

describe("live mappers", () => {
  it("maps backend categories both ways; demo-only categories fall back to 'other'", () => {
    expect(categoryFromApi("crypto_research")).toBe("research");
    expect(categoryFromApi("ai_analytics")).toBe("market_intelligence");
    expect(categoryFromApi("market_data")).toBe("data_services");
    expect(categoryFromApi("brand_new")).toBe("other");
    expect(categoryToApi("research")).toBe("crypto_research");
    expect(categoryToApi("development")).toBe("other");
  });
  it("maps an agent without inventing ratings, reviews or availability", () => {
    const a = mapAgent(agent, [svc, { ...svc, id: "s2", provider_agent_id: "other" }, { ...svc, id: "s3", is_available: false }]);
    expect(a).toMatchObject({ source: "live", isPlatformDemo: true, verified: false, availability: "available", rating: 4.5, reviewCount: 0, reviews: [], category: "research" });
    expect(a.services.map((s) => s.id)).toEqual(["s1"]);
    expect(mapAgent({ ...agent, status: "suspended", onchain_registration_reference: "133:0xabc:0xdef", reputation: null }, []).availability).toBe("offline");
    expect(mapAgent({ ...agent, onchain_registration_reference: "133:0xabc:0xdef" }, []).verified).toBe(true);
  });
  it("derives a title and recovers capabilities from the composed description", () => {
    const input: NewRequestInput = { title: "Crypto market research brief", description: "Need a research brief.", category: "research", requiredCapabilities: ["Market research", "Risk summary"], maxBudget: "1", asset: "USDT", preferredDeliveryMinutes: 15, additionalInstructions: "Be concise", origin: "form" };
    const text = composeDescription(input);
    expect(text.split("\n")[0]).toBe("Crypto market research brief");
    expect(text).toContain("Required capabilities: Market research, Risk summary");
    expect(text).toContain("within 15 minutes");
    const r = mapRequest({ ...req, description: text });
    expect(r.title).toBe("Crypto market research brief");
    expect(r.requiredCapabilities).toEqual(["Market research", "Risk summary"]);
    expect(deriveTitle("x".repeat(100)).title.endsWith("…")).toBe(true);
  });
  it("maps request status and prepares payment only from a real selected quotation", () => {
    expect(["created", "quoting", "quoted", "selected", "payment_pending", "completed", "cancelled", "expired"].map(statusFromApi)).toEqual(["awaiting_quotes", "awaiting_quotes", "quotes_ready", "provider_selected", "provider_selected", "completed", "cancelled", "expired"]);
    const r = mapRequest(req, [quote]);
    expect(r).toMatchObject({ status: "provider_selected", source: "live", preferredDeliveryMinutes: 15, payment: { amount: "0.25", state: "awaiting_authorization" } });
    expect(mapRequest(req, []).payment).toBeNull();
  });
  it("never invents a capability match and only marks sample ratings for demo data", () => {
    const q = mapQuotation(quote, agent, svc);
    expect(q).toMatchObject({ capabilityMatch: null, source: "live", status: "selected", summary: "Will do", serviceName: "Brief" });
    expect(mapQuotation({ ...quote, status: "withdrawn" }, undefined, undefined).status).toBe("not_selected");
  });
  it("maps the backend recommendation honestly (no factors it does not have)", () => {
    expect(mapRecommendation("r1", null)).toBeNull();
    expect(mapRecommendation("r1", { recommended_quotation_id: null, ranking: [], rationale: "" })).toBeNull();
    const rec = mapRecommendation("r1", { recommended_quotation_id: "q1", ranking: [{ quotation_id: "q1", score: 91.26, notes: "Cheapest" }], rationale: "Best value", generated_by: "claude" })!;
    expect(rec).toMatchObject({ generatedBy: "claude", factors: [], recommendedQuotationId: "q1" });
    expect(rec.scores[0]).toMatchObject({ total: 91.3, notes: "Cheapest" });
    expect(mapRecommendation("r1", { recommended_quotation_id: "q1", ranking: [], rationale: "x", generated_by: "weird" })!.generatedBy).toBe("deterministic_fallback");
  });
  it("maps agent messages to a timeline without trusting payload types", () => {
    const e = mapMessage({ id: "m", request_id: "r1", sender_role: "buyer_agent", receiver_role: "user", message_type: "recommendation", payload: { rationale: "R".repeat(500) }, created_at: "t" });
    expect(e).toMatchObject({ type: "recommendation", actor: "buyer_agent", title: "Recommendation generated" });
    expect(e.detail.length).toBe(300);
    expect(mapMessage({ id: "m", request_id: null, sender_role: "?", receiver_role: "?", message_type: "weird", payload: { summary: 42 }, created_at: "t" })).toMatchObject({ type: "note", actor: "system", detail: "" });
  });
});

describe("auth helpers", () => {
  it("only allows same-origin post-login paths", () => {
    expect(safeNext("/payments/abc")).toBe("/payments/abc");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/login", "/register?x=1", "/a\nb", "", null, undefined]) expect(safeNext(bad as string | null)).toBe("/dashboard");
  });
  it("maps auth errors without revealing whether an account exists", () => {
    expect(describeAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("Email or password is incorrect.");
    expect(describeAuthError({ code: "email_not_confirmed" })).toMatch(/Confirm your email/);
    expect(describeAuthError({ status: 429 })).toMatch(/Too many/);
    expect(describeAuthError({ code: "user_already_exists" })).not.toMatch(/exists|taken/i);
    expect(describeAuthError({ name: "AuthRetryableFetchError" })).toMatch(/reach/);
    expect(describeAuthError(null)).toBe("Sign-in failed. Please try again.");
  });
});

describe("dashboard aggregation", () => {
  const base = { requests: [], payments: [], agents: [], user: { name: "n", email: null }, source: "live" as const };
  it("is empty and honest with no data", () => {
    const d = buildDashboard(base);
    expect(d.kpis.map((k) => k.value)).toEqual(["0", "0", "0", "0"]);
    expect(d.progress).toMatchObject({ hasRequest: false, settled: false, maxQuotes: 0 });
    expect(d.payments.verifiedOnChain).toBe(0);
  });
  it("counts verified settlements only in live mode and never in demo", () => {
    const pay = { id: "p", requestId: "r", quotationId: "q", providerAgentId: "a", providerName: "A", amount: "0.25", asset: "USDT", chainId: 133, recipient: null, status: "SETTLED" as const, failureReason: null, expiresAt: "", snapshotHash: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", txHash: null, source: "live" as const };
    expect(buildDashboard({ ...base, payments: [pay] }).payments).toMatchObject({ verifiedOnChain: 1, completed: { count: 1, amount: "0.25" } });
    expect(buildDashboard({ ...base, payments: [pay], source: "demo" }).payments.verifiedOnChain).toBe(0);
  });
});

describe("401 handling in the API client", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  it("refreshes once and retries once; the retry carries the new token", async () => {
    const { z } = await import("zod");
    const client = await import("@/lib/api/client");
    let token = "old"; const seen: (string | null)[] = [];
    client.registerAccessTokenProvider(() => token);
    client.registerUnauthorizedHandler(async () => { token = "new"; return true; });
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const h = (init.headers as Record<string, string>)["Authorization"] ?? null; seen.push(h);
      return h === "Bearer new" ? json({ ok: true }) : json({ error: { code: "unauthorized", message: "Missing bearer token", details: null, request_id: "r" } }, 401);
    }));
    const out = await client.apiRequest("/x", { schema: z.object({ ok: z.boolean() }) });
    expect(out.ok).toBe(true);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
  });
  it("signs the user out when the retry is still unauthorized, and does not loop", async () => {
    const { z } = await import("zod");
    const client = await import("@/lib/api/client");
    const expired = vi.fn(); const refresh = vi.fn(async () => true);
    client.registerAccessTokenProvider(() => "t"); client.registerUnauthorizedHandler(refresh); client.registerSessionExpiredHandler(expired);
    const f = vi.fn(async () => json({ error: { code: "unauthorized", message: "bad", details: null, request_id: "r" } }, 401)); vi.stubGlobal("fetch", f);
    await expect(client.apiRequest("/x", { schema: z.unknown() })).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(f).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1); expect(expired).toHaveBeenCalledTimes(1);
  });
  it("does not retry other errors (e.g. a payment 409)", async () => {
    const { z } = await import("zod");
    const client = await import("@/lib/api/client");
    const refresh = vi.fn(async () => true); client.registerUnauthorizedHandler(refresh);
    const f = vi.fn(async () => json({ error: { code: "illegal_transition", message: "x", details: null, request_id: "r" } }, 409)); vi.stubGlobal("fetch", f);
    await expect(client.apiRequest("/x", { method: "POST", body: {}, schema: z.unknown() })).rejects.toMatchObject({ status: 409 });
    expect(f).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled();
  });
  it("rejects a plain-http remote API URL at startup", async () => {
    vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.example.test");
    await expect(import("@/lib/env")).rejects.toThrow(/Invalid public environment configuration/);
    vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:8000");
    await expect(import("@/lib/env")).resolves.toBeTruthy();
  });
});
