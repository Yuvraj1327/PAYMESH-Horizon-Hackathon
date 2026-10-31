"use client";

import { useQuery } from "@tanstack/react-query";
import { filterAndSortAgents, getAgent, listAgents } from "@/services/marketplace";
import type { AgentFilters } from "@/types/agent";

export function useAgents(filters: AgentFilters) {
  // One fetch for the whole listing; search/filter/sort run locally so changing a filter never calls the backend again.
  return useQuery({ queryKey: ["agents"], queryFn: () => listAgents({}), staleTime: 60_000, select: (list) => filterAndSortAgents(list, filters) });
}

export function useAgent(id: string | null) {
  return useQuery({ queryKey: ["agent", id], queryFn: () => getAgent(id as string), retry: false, enabled: !!id });
}
