import { describe, expect, it, beforeEach } from "vitest";
import { DEMO_AGENTS } from "@/services/demo/agents";
import { findCandidates, matchCapabilities, pickService } from "@/services/demo/matching";
import { RECOMMENDATION_FACTORS, buildRecommendation, scoreQuotations } from "@/services/demo/recommend";
import { SelectionError, applySelection, createRequestRecords, type DemoDb } from "@/services/demo/engine";
import { createSeedDb } from "@/services/demo/seed";
import { filterAndSortAgents, minPrice } from "@/services/marketplace";
import { buildReply, extractRequirements, missingFields, parseBudget, parseDeliveryMinutes, recommendAgents } from "@/services/demo/assistant-engine";
import { assertValidInput, dedupeCaps, normalizeAmount, requestFormSchema } from "@/lib/validation";
import { cmp, lte, toMicro } from "@/lib/money";
import { _clearCache, getDb, mutateDb, resetDb } from "@/services/demo/store";
import type { NewRequestInput } from "@/types/procurement";

const NOW = new Date("2026-10-31T12:00:00Z");
const base: NewRequestInput = {
  title: "Crypto market research", description: "I need a cryptocurrency market research report within a 1 USDT budget.",
  category: "research", requiredCapabilities: [], maxBudget: "1", asset: "USDT", preferredDeliveryMinutes: null, additionalInstructions: "", origin: "form",
};
const names = (c: { agent: { name: string } }[]) => c.map((x) => x.agent.name);

describe("money", () => {
  it("compares exact decimals", () => {
    expect(toMicro("0.25")).toBe(250000n);
    expect(lte("0.10", "0.1")).toBe(true);
    expect(cmp("0.4", "0.25")).toBe(1);
    expect(toMicro("0.1234569")).toBe(123456n); // sub-micro digits are truncated, never rounded (forms allow max 6 decimals)
  });
});

describe("matching", () => {
  it("returns the three demo agents for a research request, as in the spec example", () => {
    const c = findCandidates(DEMO_AGENTS, { category: "research", requiredCapabilities: [], maxBudget: "1", asset: "USDT" });
    expect(names(c)).toEqual(["Crypto Research Agent", "Market Data Agent", "AI Analytics Agent"]);
    expect(c.map((x) => [x.service.price, x.service.deliveryMinutes])).toEqual([["0.25", 5], ["0.40", 3], ["0.60", 2]]);
  });
  it("never includes offline agents or agents whose cheapest service exceeds the budget", () => {
    const c = findCandidates(DEMO_AGENTS, { category: "data_services", requiredCapabilities: [], maxBudget: "0.5", asset: "USDT" }, 10);
    expect(names(c)).not.toContain("On-chain Data Fetcher"); // offline
    expect(c.every((x) => lte(x.service.price, "0.5"))).toBe(true);
    expect(findCandidates(DEMO_AGENTS, { category: "research", requiredCapabilities: [], maxBudget: "0.1", asset: "USDT" })).toEqual([]);
  });
  it("only matches services priced in the request asset", () => {
    expect(findCandidates(DEMO_AGENTS, { category: "research", requiredCapabilities: [], maxBudget: "5", asset: "USDC" })).toEqual([]);
  });
  it("matches capabilities case-insensitively and partially", () => {
    const r = matchCapabilities(["market RESEARCH", "sentiment"], ["Market research", "Sentiment analysis", "Trend analysis"]);
    expect(r.metCount).toBe(2);
    expect(r.matched.sort()).toEqual(["Market research", "Sentiment analysis"]);
  });
  it("puts a preferred ('hired') agent first when it is eligible, and ignores it when over budget", () => {
    const c = findCandidates(DEMO_AGENTS, { category: "research", requiredCapabilities: [], maxBudget: "1", asset: "USDT", preferredAgentId: "ai-analytics-agent" });
    expect(c[0]?.agent.id).toBe("ai-analytics-agent");
    const over = findCandidates(DEMO_AGENTS, { category: "research", requiredCapabilities: [], maxBudget: "1", asset: "USDT", preferredAgentId: "contract-reviewer-agent" });
    expect(names(over)).not.toContain("Contract Reviewer Agent");
  });
  it("picks the cheapest in-budget service", () => {
    const a = DEMO_AGENTS.find((x) => x.id === "crypto-research-agent")!;
    expect(pickService(a, "USDT", "5")?.price).toBe("0.25");
    expect(pickService(a, "USDT", "0.2")).toBeNull();
  });
});

describe("recommendation", () => {
  const rec = () => {
    const { request, quotations } = createRequestRecords(base, DEMO_AGENTS, NOW);
    return { request, quotations };
  };
  it("weights sum to 1 and scores stay within 0..100", () => {
    expect(RECOMMENDATION_FACTORS.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
    const { request, quotations } = rec();
    for (const s of scoreQuotations(request, quotations)) for (const v of [s.total, s.price, s.delivery, s.capability, s.reputation]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
  it("recommends the lowest-price, best-match quote and explains it with visible factors", () => {
    const { request, quotations } = rec();
    const r = request.recommendation!;
    const top = quotations.find((q) => q.id === r.recommendedQuotationId)!;
    expect(top.agentId).toBe("crypto-research-agent");
    expect(r.highlights.join(" ")).toMatch(/Lowest price/);
    expect(r.tradeoffs.join(" ")).toMatch(/Slowest delivery/);
    expect(r.rationale).toContain("Crypto Research Agent");
    expect(r.rationale).not.toMatch(/chain[- ]of[- ]thought/i);
    expect(r.generatedBy).toBe("demo-heuristic");
  });
  it("scores delivery against the user's deadline when one is given", () => {
    const { request, quotations } = rec();
    const mk = (m: number, i: number) => ({ ...quotations[0]!, id: `q${i}`, deliveryMinutes: m });
    const sc = scoreQuotations({ ...request, preferredDeliveryMinutes: 5 }, [mk(3, 1), mk(5, 2), mk(20, 3)]);
    expect(sc.map((s) => s.delivery)).toEqual([100, 100, 25]);
    const rel = scoreQuotations({ ...request, preferredDeliveryMinutes: null }, [mk(2, 1), mk(4, 2)]);
    expect(rel.map((s) => s.delivery)).toEqual([100, 50]); // no deadline: relative to the fastest quote
  });
  it("returns null when there are no quotations", () => {
    expect(buildRecommendation({ ...rec().request }, [], {}, NOW)).toBeNull();
  });
  it("treats unrated providers neutrally and says so", () => {
    const { request, quotations } = rec();
    const q = { ...quotations[0]!, reputation: null };
    expect(scoreQuotations(request, [q])[0]!.reputation).toBe(50);
    expect(buildRecommendation(request, [q], { [q.agentId]: "X" }, NOW)!.tradeoffs).toContain("No rating available");
  });
});

describe("request lifecycle", () => {
  it("records only events that happened, in order, none in the future", () => {
    const { request, quotations, events } = createRequestRecords(base, DEMO_AGENTS, NOW);
    expect(request.status).toBe("quotes_ready");
    expect(quotations).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["request_created", "requirements_extracted", "agents_discovered", "quotations_received", "recommendation_generated"]);
    expect(events.every((e) => new Date(e.at) <= NOW)).toBe(true);
    expect([...events].sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.type)).toEqual(events.map((e) => e.type));
    expect(events.map((e) => e.type)).not.toContain("provider_selected");
  });
  it("stays awaiting_quotes with honest events when nothing matches", () => {
    const { request, quotations, events } = createRequestRecords({ ...base, maxBudget: "0.05" }, DEMO_AGENTS, NOW);
    expect(request.status).toBe("awaiting_quotes");
    expect(quotations).toEqual([]);
    expect(request.recommendation).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["request_created", "requirements_extracted", "agents_discovered"]);
    expect(events[2]!.detail).toMatch(/No available provider/);
  });
  it("rejects invalid input with the same rules as the form", () => {
    for (const bad of [{ maxBudget: "0" }, { maxBudget: "-1" }, { maxBudget: "abc" }, { maxBudget: "1.1234567" }, { title: "ab" }, { description: "too short" }, { asset: "DOGE" as never }]) {
      expect(() => createRequestRecords({ ...base, ...bad }, DEMO_AGENTS, NOW)).toThrow();
    }
  });
  describe("selection", () => {
    let db: DemoDb;
    let id: string;
    beforeEach(() => {
      db = { version: 1, requests: [], quotations: [], events: [] };
      const r = createRequestRecords(base, DEMO_AGENTS, NOW);
      db.requests.push(r.request); db.quotations.push(...r.quotations); db.events.push(...r.events);
      id = r.request.id;
    });
    it("selects a provider, prepares (not executes) payment, and records the events", () => {
      const q = db.quotations[1]!;
      applySelection(db, id, q.id, DEMO_AGENTS, NOW);
      const req = db.requests[0]!;
      expect(req.status).toBe("provider_selected");
      expect(req.selectedQuotationId).toBe(q.id);
      expect(req.payment).toMatchObject({ quotationId: q.id, amount: q.price, asset: "USDT", state: "awaiting_authorization" });
      expect(db.quotations.map((x) => x.status).sort()).toEqual(["not_selected", "not_selected", "selected"]);
      expect(db.events.slice(-2).map((e) => e.type)).toEqual(["provider_selected", "payment_authorization_pending"]);
      expect(db.events.at(-1)!.detail).toMatch(/Nothing has been authorized or paid/);
    });
    it("allows changing the selection before payment; exactly one quotation stays selected", () => {
      applySelection(db, id, db.quotations[0]!.id, DEMO_AGENTS, NOW);
      applySelection(db, id, db.quotations[2]!.id, DEMO_AGENTS, new Date(NOW.getTime() + 5000));
      expect(db.quotations.filter((q) => q.status === "selected")).toHaveLength(1);
      expect(db.requests[0]!.selectedQuotationId).toBe(db.quotations[2]!.id);
      expect(db.requests[0]!.payment!.quotationId).toBe(db.quotations[2]!.id);
    });
    it("refuses foreign quotations, unknown requests and closed requests", () => {
      expect(() => applySelection(db, id, "quo_nope", DEMO_AGENTS, NOW)).toThrow(SelectionError);
      expect(() => applySelection(db, "req_nope", db.quotations[0]!.id, DEMO_AGENTS, NOW)).toThrow(SelectionError);
      db.requests[0]!.status = "cancelled";
      expect(() => applySelection(db, id, db.quotations[0]!.id, DEMO_AGENTS, NOW)).toThrow(SelectionError);
    });
  });
});

describe("seed + store", () => {
  it("seeds a labelled, internally consistent history", () => {
    const db = createSeedDb(NOW);
    expect(db.requests.map((r) => r.status).sort()).toEqual(["awaiting_quotes", "cancelled", "completed", "provider_selected", "quotes_ready"]);
    expect(db.requests.every((r) => r.source === "demo")).toBe(true);
    expect(db.events.find((e) => e.type === "request_completed_sample")!.detail).toMatch(/no payment or delivery took place/);
    for (const r of db.requests) expect(db.events.some((e) => e.requestId === r.id && e.type === "request_created")).toBe(true);
    expect(db.events.every((e) => new Date(e.at) <= new Date(NOW.getTime() + 1000))).toBe(true);
  });
  it("persists mutations in memory and resets to the seed", () => {
    _clearCache();
    const n = getDb().requests.length;
    mutateDb((db) => { db.requests.pop(); });
    expect(getDb().requests.length).toBe(n - 1);
    resetDb();
    expect(getDb().requests.length).toBe(n);
  });
});

describe("marketplace filtering and sorting", () => {
  const f = (o: Parameters<typeof filterAndSortAgents>[1]) => filterAndSortAgents(DEMO_AGENTS, o);
  it("searches by name, service and capability", () => {
    expect(f({ q: "crypto research" }).map((a) => a.id)).toEqual(["crypto-research-agent"]);
    expect(f({ q: "ohlc" }).map((a) => a.id)).toEqual(["market-data-agent"]);
    expect(f({ q: "SENTIMENT" }).map((a) => a.id)).toEqual(["ai-analytics-agent"]);
    expect(f({ q: "zzz-nothing" })).toEqual([]);
  });
  it("filters by category, verified and availability", () => {
    expect(f({ category: "data_services" }).map((a) => a.id).sort()).toEqual(["market-data-agent", "onchain-fetcher-agent"]);
    expect(f({ verifiedOnly: true })).toHaveLength(3);
    expect(f({ availableOnly: true }).every((a) => a.availability === "available")).toBe(true);
    expect(f({ category: "all" })).toHaveLength(DEMO_AGENTS.length);
  });
  it("sorts by price, rating (unrated last) and availability", () => {
    expect(f({ sort: "price_asc" })[0]!.id).toBe("crypto-research-agent");
    const desc = f({ sort: "price_desc" });
    expect(minPrice(desc[0]!)).toBe("1.50");
    const rated = f({ sort: "rating_desc" });
    expect(rated[0]!.rating).toBe(4.8);
    expect(rated.at(-1)!.rating).toBeNull();
    const av = f({ sort: "availability" }).map((a) => a.availability);
    expect(av).toEqual([...av].sort((a, b) => ["available", "busy", "offline"].indexOf(a) - ["available", "busy", "offline"].indexOf(b)));
  });
  it("never represents demo agents as on-chain registered or gives them wallet addresses", () => {
    for (const a of DEMO_AGENTS) { expect(a.registration.onChain).toBe(false); expect(a.walletAddress).toBeUndefined(); expect(a.source).toBe("demo"); expect(a.reviews.every((r) => r.isSample)).toBe(true); }
  });
});

describe("assistant extraction (demo heuristics)", () => {
  it("understands the spec example", () => {
    const x = extractRequirements("I need a cryptocurrency market research report within a 1 USDT budget.", null);
    expect(x).toMatchObject({ category: "research", maxBudget: "1", asset: "USDT", preferredDeliveryMinutes: null });
    expect(x.requiredCapabilities).toContain("Market research");
    expect(missingFields(x)).toEqual([]);
    const recs = recommendAgents(DEMO_AGENTS, x);
    expect(recs[0]!.agentName).toBe("Crypto Research Agent");
    expect(recs[0]!.factors.map((f) => f.label)).toEqual(expect.arrayContaining(["Price", "Capability match", "Delivery", "Rating"]));
  });
  it("parses budgets and deadlines", () => {
    expect(parseBudget("under 0.5 USDT")).toEqual({ amount: "0.5", asset: "USDT" });
    expect(parseBudget("budget of 2,5 usdc")).toEqual({ amount: "2.5", asset: "USDC" });
    expect(parseBudget("budget 3")).toEqual({ amount: "3", asset: null });
    expect(parseBudget("no numbers here")).toEqual({ amount: null, asset: null });
    expect(parseBudget("delivered within 5 minutes")).toEqual({ amount: null, asset: null });
    expect(parseDeliveryMinutes("delivered within 5 minutes")).toBe(5);
    expect(parseDeliveryMinutes("within 2 hours")).toBe(120);
    expect(parseDeliveryMinutes("whenever")).toBeNull();
  });
  it("asks for what is missing and merges follow-ups", () => {
    const first = extractRequirements("I need a research report on layer-2 tokens", null);
    expect(missingFields(first)).toEqual(["maximum budget"]);
    expect(buildReply(first, [], missingFields(first))).toMatch(/still need: maximum budget/);
    const second = extractRequirements("budget is 0.5 USDT, within 15 minutes", first);
    expect(second).toMatchObject({ category: "research", maxBudget: "0.5", preferredDeliveryMinutes: 15, title: first.title });
    expect(missingFields(second)).toEqual([]);
  });
  it("reports honestly when nothing fits the budget", () => {
    const x = extractRequirements("market research report, budget 0.05 USDT", null);
    expect(recommendAgents(DEMO_AGENTS, x)).toEqual([]);
    expect(buildReply(x, [], [])).toMatch(/No available agent/);
  });
});

describe("validation", () => {
  const ok = { title: "My request", category: "research", description: "A sufficiently long description of the task.", capabilities: ["Market research"], maxBudget: "1.5", asset: "USDT", preferredDelivery: "none", additionalInstructions: "" };
  it("accepts a valid form and rejects each invalid field", () => {
    expect(requestFormSchema.safeParse(ok).success).toBe(true);
    const bad: Array<[string, unknown]> = [["title", "ab"], ["category", "unknown"], ["description", "short"], ["maxBudget", "0"], ["maxBudget", "1e3"], ["maxBudget", "1.1234567"], ["asset", "BTC"], ["preferredDelivery", "7"], ["capabilities", Array(11).fill("abc")], ["additionalInstructions", "x".repeat(1001)]];
    for (const [k, v] of bad) expect(requestFormSchema.safeParse({ ...ok, [k]: v }).success, `${k}=${String(v).slice(0, 10)}`).toBe(false);
  });
  it("normalizes amounts and capability lists", () => {
    expect(normalizeAmount("01.500000")).toBe("1.5");
    expect(normalizeAmount("2")).toBe("2");
    expect(normalizeAmount("0.50")).toBe("0.5");
    expect(dedupeCaps(["A b", "a B", " ", "C"])).toEqual(["A b", "C"]);
    expect(() => assertValidInput({ ...base, maxBudget: "" })).toThrow();
  });
});
