import { CATEGORIES } from "@/constants/categories";
import { cmp, lte } from "@/lib/money";
import type { Agent, AgentService, CategoryId, PaymentAsset } from "@/types/agent";

export interface MatchCriteria {
  category: CategoryId;
  requiredCapabilities: string[];
  maxBudget: string;
  asset: PaymentAsset;
  preferredAgentId?: string | null;
}

export interface Candidate {
  agent: Agent;
  service: AgentService;
  /** 1 exact category, 0.6 adjacent, 0 unrelated. */
  categoryScore: number;
  matchedCapabilities: string[];
  /** 0..1: share of requested capabilities matched (category relevance when none were requested). */
  capabilityMatch: number;
  relevance: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function categoryScore(request: CategoryId, agent: CategoryId): number {
  if (request === agent) return 1;
  const meta = CATEGORIES.find((c) => c.id === request);
  return meta?.adjacent.includes(agent) ? 0.6 : 0;
}

/** Returns the agent capabilities that satisfy at least one requested capability, plus how many requests were met. */
export function matchCapabilities(requested: string[], agentCaps: string[]): { matched: string[]; metCount: number } {
  const matched = new Set<string>();
  let met = 0;
  for (const r of requested.map(norm).filter(Boolean)) {
    const hit = agentCaps.filter((c) => norm(c).includes(r) || r.includes(norm(c)));
    if (hit.length > 0) { met += 1; hit.forEach((h) => matched.add(h)); }
  }
  return { matched: [...matched], metCount: met };
}

/** Cheapest service in the request's asset that fits the budget (exact decimal comparison). */
export function pickService(agent: Agent, asset: PaymentAsset, maxBudget: string): AgentService | null {
  const ok = agent.services.filter((s) => s.asset === asset && lte(s.price, maxBudget));
  ok.sort((a, b) => cmp(a.price, b.price));
  return ok[0] ?? null;
}

/**
 * Ranks available agents for a request. Offline agents cannot quote; agents with no service inside the budget are excluded.
 * A preferred agent (from "Hire Agent") is always placed first if it is eligible.
 */
export function findCandidates(agents: readonly Agent[], c: MatchCriteria, limit = 3): Candidate[] {
  const out: Candidate[] = [];
  for (const agent of agents) {
    if (agent.availability === "offline") continue;
    const service = pickService(agent, c.asset, c.maxBudget);
    if (!service) continue;
    const cat = categoryScore(c.category, agent.category);
    const { matched, metCount } = matchCapabilities(c.requiredCapabilities, agent.capabilities);
    const capabilityMatch = c.requiredCapabilities.length > 0 ? metCount / c.requiredCapabilities.length : cat;
    const relevance = cat * 0.7 + capabilityMatch * 0.3;
    if (cat === 0 && metCount === 0 && c.preferredAgentId !== agent.id) continue;
    out.push({ agent, service, categoryScore: cat, matchedCapabilities: matched, capabilityMatch, relevance });
  }
  out.sort((a, b) => b.relevance - a.relevance || cmp(a.service.price, b.service.price) || a.agent.name.localeCompare(b.agent.name));
  const top = out.slice(0, limit);
  if (c.preferredAgentId && !top.some((t) => t.agent.id === c.preferredAgentId)) {
    const pref = out.find((t) => t.agent.id === c.preferredAgentId);
    if (pref) top.splice(top.length >= limit ? limit - 1 : top.length, 1, pref);
  }
  const pi = top.findIndex((t) => t.agent.id === c.preferredAgentId);
  if (pi > 0) { const [p] = top.splice(pi, 1); if (p) top.unshift(p); }
  return top;
}
