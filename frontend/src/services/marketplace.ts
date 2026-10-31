import { isDemoMode } from "@/lib/env";
import { cmp } from "@/lib/money";
import { NotFoundError, delay } from "@/services/errors";
import { liveApi } from "@/services/live/api";
import { mapAgent } from "@/services/live/mappers";
import { DEMO_AGENTS, getDemoAgent } from "@/services/demo/agents";
import type { Agent, AgentFilters } from "@/types/agent";

const AVAIL_ORDER = { available: 0, busy: 1, offline: 2 } as const;

export function minPrice(agent: Agent): string {
  return agent.services.reduce((m, s) => (cmp(s.price, m) < 0 ? s.price : m), agent.services[0]?.price ?? "0");
}

/** Pure filter + sort used by the demo service (and unit-tested). */
export function filterAndSortAgents(agents: readonly Agent[], f: AgentFilters): Agent[] {
  const q = f.q?.trim().toLowerCase();
  let list = agents.filter((a) => {
    if (f.category && f.category !== "all" && a.category !== f.category) return false;
    if (f.verifiedOnly && !a.verified) return false;
    if (f.availableOnly && a.availability !== "available") return false;
    if (q) {
      const hay = [a.name, a.description, ...a.capabilities, ...a.services.map((s) => s.name)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const byName = (a: Agent, b: Agent) => a.name.localeCompare(b.name);
  switch (f.sort ?? "rating_desc") {
    case "price_asc": list = [...list].sort((a, b) => cmp(minPrice(a), minPrice(b)) || byName(a, b)); break;
    case "price_desc": list = [...list].sort((a, b) => cmp(minPrice(b), minPrice(a)) || byName(a, b)); break;
    case "availability": list = [...list].sort((a, b) => AVAIL_ORDER[a.availability] - AVAIL_ORDER[b.availability] || byName(a, b)); break;
    default: list = [...list].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b)); // unrated last
  }
  return list;
}

/** All marketplace agents from the backend, with their services joined (two calls, agents + services). */
export async function listLiveAgents(): Promise<Agent[]> {
  const [agents, services] = await Promise.all([liveApi.agents(), liveApi.services()]);
  return agents.map((a) => mapAgent(a, services));
}

export async function listAgents(filters: AgentFilters): Promise<Agent[]> {
  if (!isDemoMode) return filterAndSortAgents(await listLiveAgents(), filters);
  await delay(250);
  return filterAndSortAgents(DEMO_AGENTS, filters);
}

export async function getAgent(id: string): Promise<Agent> {
  if (!isDemoMode) {
    const [a, services] = await Promise.all([liveApi.agent(id), liveApi.services(id)]);
    return mapAgent(a, services);
  }
  await delay(200);
  const a = getDemoAgent(id);
  if (!a) throw new NotFoundError("Agent");
  return a;
}
