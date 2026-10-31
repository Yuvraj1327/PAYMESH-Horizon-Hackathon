import { deliveryLabel } from "@/constants/categories";
import { toNumber } from "@/lib/money";
import { formatAmount } from "@/lib/utils";
import type { AIRecommendation, ProcurementRequest, Quotation, QuotationScore, RecommendationFactor } from "@/types/procurement";

export const RECOMMENDATION_FACTORS: readonly RecommendationFactor[] = [
  { key: "price", label: "Price", weight: 0.35 },
  { key: "capability", label: "Capability match", weight: 0.3 },
  { key: "delivery", label: "Delivery time", weight: 0.2 },
  { key: "reputation", label: "Provider reputation", weight: 0.15 },
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreQuotations(
  req: Pick<ProcurementRequest, "maxBudget" | "preferredDeliveryMinutes">, quotes: Quotation[],
): QuotationScore[] {
  const budget = toNumber(req.maxBudget);
  const fastest = Math.min(...quotes.map((q) => q.deliveryMinutes));
  return quotes.map((q) => {
    const price = clamp(100 * (1 - toNumber(q.price) / budget));
    const pref = req.preferredDeliveryMinutes;
    const delivery = clamp(pref !== null ? (q.deliveryMinutes <= pref ? 100 : (100 * pref) / q.deliveryMinutes) : (100 * fastest) / q.deliveryMinutes);
    const capability = clamp(100 * (q.capabilityMatch ?? 0));
    const reputation = clamp(q.reputation !== null ? (q.reputation / 5) * 100 : 50); // unrated = neutral
    const total = RECOMMENDATION_FACTORS.reduce((sum, f) => sum + f.weight * { price, delivery, capability, reputation }[f.key], 0);
    return { quotationId: q.id, price: round1(price), delivery: round1(delivery), capability: round1(capability), reputation: round1(reputation), total: round1(total) };
  });
}

/** Deterministic, explainable recommendation: visible factors + weights, never hidden reasoning. */
export function buildRecommendation(
  req: ProcurementRequest, quotes: Quotation[], agentNames: Record<string, string>, now: Date,
): AIRecommendation | null {
  if (quotes.length === 0) return null;
  const scores = scoreQuotations(req, quotes);
  const best = [...scores].sort((a, b) => b.total - a.total)[0];
  const top = quotes.find((q) => q.id === best?.quotationId);
  if (!best || !top) return null;

  const minPrice = Math.min(...quotes.map((q) => toNumber(q.price)));
  const maxPrice = Math.max(...quotes.map((q) => toNumber(q.price)));
  const minDel = Math.min(...quotes.map((q) => q.deliveryMinutes));
  const maxDel = Math.max(...quotes.map((q) => q.deliveryMinutes));
  const many = quotes.length > 1;
  const highlights: string[] = [];
  const tradeoffs: string[] = [];

  if (many && toNumber(top.price) === minPrice) highlights.push(`Lowest price (${formatAmount(top.price)} ${top.asset})`);
  else highlights.push(`Within budget at ${formatAmount(top.price)} of ${formatAmount(req.maxBudget)} ${top.asset}`);
  if ((top.capabilityMatch ?? 0) >= 1) highlights.push(req.requiredCapabilities.length ? `Covers all ${req.requiredCapabilities.length} requested capabilities` : "Exact category match");
  if (many && top.deliveryMinutes === minDel) highlights.push(`Fastest delivery (${deliveryLabel(top.deliveryMinutes)})`);
  if (top.reputation !== null && top.reputation >= 4.5) highlights.push(`Highly rated (${top.reputation.toFixed(1)}/5, sample rating)`);

  if (many && top.deliveryMinutes === maxDel && minDel !== maxDel) tradeoffs.push(`Slowest delivery of the quotes (${deliveryLabel(top.deliveryMinutes)})`);
  else if (many && top.deliveryMinutes > minDel) tradeoffs.push(`Not the fastest: ${deliveryLabel(top.deliveryMinutes)} vs ${deliveryLabel(minDel)}`);
  if (many && toNumber(top.price) === maxPrice && minPrice !== maxPrice) tradeoffs.push("Highest price of the quotes");
  if ((top.capabilityMatch ?? 0) < 1 && req.requiredCapabilities.length) tradeoffs.push(`Partial capability match (${Math.round((top.capabilityMatch ?? 0) * 100)}%)`);
  if (top.reputation === null) tradeoffs.push("No rating available");

  const name = agentNames[top.agentId] ?? "This provider";
  const rationale = `${name} has the best overall score (${best.total}/100): ${highlights.slice(0, 3).join("; ").toLowerCase()}.` + (tradeoffs[0] ? ` Trade-off: ${tradeoffs[0].charAt(0).toLowerCase()}${tradeoffs[0].slice(1)}.` : "");
  return {
    requestId: req.id, recommendedQuotationId: top.id, factors: [...RECOMMENDATION_FACTORS], scores, rationale,
    highlights, tradeoffs, generatedBy: "demo-heuristic", generatedAt: now.toISOString(),
  };
}
