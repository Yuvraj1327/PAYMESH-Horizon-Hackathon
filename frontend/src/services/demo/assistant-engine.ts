import { deliveryLabel, getCategory } from "@/constants/categories";
import { formatAmount } from "@/lib/utils";
import { normalizeAmount } from "@/lib/validation";
import type { Agent, CategoryId, PaymentAsset } from "@/types/agent";
import type { DecisionFactor, ExtractedRequirements, RecommendedAgent } from "@/types/procurement";
import { findCandidates } from "@/services/demo/matching";

/**
 * DEMO extraction/recommendation for the AI Buyer assistant: transparent keyword heuristics, not a language model.
 * In live mode the same shapes come from the backend (Claude runs server-side; the browser never sees keys).
 */
const CATEGORY_KEYWORDS: ReadonlyArray<[CategoryId, RegExp]> = [
  ["data_services", /\b(market data|price data|ohlc|candles?|dataset|data feed|export|snapshot|volumes?)\b/i],
  ["market_intelligence", /\b(trend|sentiment|scenario|intelligence|analytics|forecast|insight)s?\b/i],
  ["development", /\b(smart contracts?|solidity|code review|audit|develop(ment|er)?|script|gas)\b/i],
  ["ai_automation", /\b(automat\w*|workflow|pipeline|schedule|bot)\b/i],
  ["api_services", /\b(api|webhook|endpoint|integration)\b/i],
  ["research", /\b(research|report|brief|investigat\w*|overview|summary|fundamentals)\b/i],
];

const CAPABILITY_KEYWORDS: ReadonlyArray<[RegExp, string]> = [
  [/market research|research report|research brief/i, "Market research"],
  [/token analysis|tokenomics|fundamentals/i, "Token analysis"],
  [/risk/i, "Risk summary"],
  [/sector/i, "Sector overview"],
  [/trend/i, "Trend analysis"],
  [/sentiment/i, "Sentiment analysis"],
  [/scenario/i, "Scenario analysis"],
  [/price data|prices?\b/i, "Price data"],
  [/volume/i, "Volume summary"],
  [/export|csv|json/i, "Data export"],
  [/solidity|smart contract/i, "Solidity review"],
  [/webhook/i, "Webhook setup"],
  [/workflow|automat/i, "Automation"],
];

export function parseBudget(text: string): { amount: string | null; asset: PaymentAsset | null } {
  const withAsset = /(\d+(?:[.,]\d+)?)\s*(usdt|usdc)\b/i.exec(text);
  if (withAsset?.[1] && withAsset[2]) {
    return { amount: normalizeAmount(withAsset[1].replace(",", ".")), asset: withAsset[2].toUpperCase() as PaymentAsset };
  }
  const plain = /\b(?:budget|under|below|max(?:imum)?|up to)\b[^\d]{0,20}(\d+(?:[.,]\d+)?)(?!\s*(?:minutes?|mins?|hours?|hrs?|days?|h)\b)/i.exec(text);
  if (plain?.[1]) return { amount: normalizeAmount(plain[1].replace(",", ".")), asset: null };
  return { amount: null, asset: null };
}

export function parseDeliveryMinutes(text: string): number | null {
  const m = /\b(?:within|in|under|by)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?)\b/i.exec(text);
  if (!m?.[1] || !m[2]) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const minutes = unit.startsWith("m") ? n : unit.startsWith("h") ? n * 60 : n * 1440;
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

export function detectCategory(text: string): CategoryId | null {
  let best: { id: CategoryId; hits: number } | null = null;
  for (const [id, re] of CATEGORY_KEYWORDS) {
    const hits = (text.match(new RegExp(re.source, "gi")) ?? []).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { id, hits };
  }
  return best?.id ?? null;
}

function makeTitle(text: string, category: CategoryId | null): string {
  const cleaned = text.replace(/\s+/g, " ").replace(/^(i (?:need|want|would like)|please|can you|could you)\s+/i, "").trim();
  const words = cleaned.split(" ").slice(0, 8).join(" ").replace(/[.,;:!?]+$/, "");
  const t = words.charAt(0).toUpperCase() + words.slice(1);
  return t.length >= 3 ? t.slice(0, 120) : `${category ? getCategory(category).label : "Service"} request`;
}

/** Merges what the user just said with requirements gathered earlier in the conversation. */
export function extractRequirements(message: string, previous: ExtractedRequirements | null): ExtractedRequirements {
  const budget = parseBudget(message);
  const caps = CAPABILITY_KEYWORDS.filter(([re]) => re.test(message)).map(([, c]) => c);
  const category = detectCategory(message) ?? previous?.category ?? null;
  const merged = [...new Set([...(previous?.requiredCapabilities ?? []), ...caps])].slice(0, 10);
  const fresh = !previous;
  const description = fresh ? message.trim().slice(0, 2000) : `${previous.description} ${message.trim()}`.trim().slice(0, 2000);
  return {
    title: fresh ? makeTitle(message, category) : previous.title,
    category,
    requiredCapabilities: merged,
    maxBudget: budget.amount ?? previous?.maxBudget ?? null,
    asset: budget.asset ?? previous?.asset ?? "USDT",
    preferredDeliveryMinutes: parseDeliveryMinutes(message) ?? previous?.preferredDeliveryMinutes ?? null,
    description,
  };
}

export function missingFields(x: ExtractedRequirements): string[] {
  const out: string[] = [];
  if (!x.category) out.push("service category");
  if (!x.maxBudget) out.push("maximum budget");
  if (x.description.trim().length < 20) out.push("a longer task description");
  return out;
}

export function recommendAgents(agents: readonly Agent[], x: ExtractedRequirements): RecommendedAgent[] {
  if (!x.category || !x.maxBudget) return [];
  const cands = findCandidates(agents, { category: x.category, requiredCapabilities: x.requiredCapabilities, maxBudget: x.maxBudget, asset: x.asset }, 3);
  const minPrice = Math.min(...cands.map((c) => Number(c.service.price)));
  const minDel = Math.min(...cands.map((c) => c.service.deliveryMinutes));
  return cands.map((c) => {
    const factors: DecisionFactor[] = [];
    factors.push({ label: "Price", tone: Number(c.service.price) === minPrice ? "positive" : "neutral",
      detail: `${formatAmount(c.service.price)} ${c.service.asset} — within your ${formatAmount(x.maxBudget as string)} ${x.asset} budget${Number(c.service.price) === minPrice && cands.length > 1 ? " (lowest)" : ""}` });
    factors.push({ label: "Capability match", tone: c.capabilityMatch >= 1 ? "positive" : c.capabilityMatch > 0 ? "neutral" : "caution",
      detail: x.requiredCapabilities.length ? `${c.matchedCapabilities.length ? c.matchedCapabilities.join(", ") : "None of the listed capabilities"} (${Math.round(c.capabilityMatch * 100)}% of requested)` : `${c.categoryScore === 1 ? "Exact" : "Related"} category: ${getCategory(c.agent.category).label}` });
    factors.push({ label: "Delivery", tone: c.service.deliveryMinutes === minDel && cands.length > 1 ? "positive" : "neutral",
      detail: `About ${deliveryLabel(c.service.deliveryMinutes)}${x.preferredDeliveryMinutes !== null ? (c.service.deliveryMinutes <= x.preferredDeliveryMinutes ? " — meets your deadline" : " — slower than your deadline") : ""}` });
    factors.push({ label: "Rating", tone: c.agent.rating !== null && c.agent.rating >= 4.5 ? "positive" : "neutral",
      detail: c.agent.rating !== null ? `${c.agent.rating.toFixed(1)}/5 (sample rating, ${c.agent.reviewCount} reviews)` : "No rating available" });
    if (c.agent.availability === "busy") factors.push({ label: "Availability", tone: "caution", detail: "Currently busy — may respond slower" });
    return { agentId: c.agent.id, agentName: c.agent.name, category: c.agent.category, price: c.service.price, asset: c.service.asset,
      deliveryMinutes: c.service.deliveryMinutes, availability: c.agent.availability, rating: c.agent.rating, matchScore: Math.round(c.relevance * 100), factors };
  });
}

export function buildReply(x: ExtractedRequirements, recs: RecommendedAgent[], missing: string[]): string {
  const parts: string[] = [];
  parts.push(`Here’s what I understood: ${x.category ? getCategory(x.category).label : "service type unclear"}${x.maxBudget ? ` · budget ${formatAmount(x.maxBudget)} ${x.asset}` : ""}${x.preferredDeliveryMinutes !== null ? ` · delivery within ${deliveryLabel(x.preferredDeliveryMinutes)}` : ""}${x.requiredCapabilities.length ? ` · ${x.requiredCapabilities.join(", ")}` : ""}.`);
  if (missing.length) {
    parts.push(`To find providers I still need: ${missing.join(", ")}. For example: “…within a 1 USDT budget”.`);
  } else if (recs.length === 0) {
    parts.push("No available agent has a service that fits that budget and asset. Try raising the budget or broadening the category.");
  } else {
    parts.push(`I found ${recs.length} available agent${recs.length === 1 ? "" : "s"} that fit. ${recs[0]?.agentName} looks like the best match; the factors below show why. You can create a procurement request to collect formal quotations.`);
  }
  return parts.join(" ");
}

export const SUGGESTED_PROMPTS: readonly string[] = [
  "I need a cryptocurrency market research report within a 1 USDT budget.",
  "Get me a market data snapshot with prices and volumes under 0.5 USDT, delivered within 5 minutes.",
  "I want a trend and sentiment analysis on a token, budget 0.75 USDT.",
  "Review a small Solidity contract for gas issues, up to 2 USDT.",
];
