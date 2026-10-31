"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createService, listMyAgents, registerAgent, seedDemoAgents, type AgentInput, type ServiceInput } from "@/services/developer";
import { updateMe } from "@/services/profile";
import { isDemoMode } from "@/lib/env";

export function useMyAgents() {
  return useQuery({ queryKey: ["my-agents"], queryFn: listMyAgents, enabled: !isDemoMode, retry: false });
}

function useInvalidateAgents() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["my-agents"] }), qc.invalidateQueries({ queryKey: ["agents"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
}

export function useRegisterAgent() {
  const inv = useInvalidateAgents();
  return useMutation({ retry: false, mutationFn: (i: AgentInput) => registerAgent(i), onSuccess: inv });
}

export function useCreateService() {
  const inv = useInvalidateAgents();
  return useMutation({ retry: false, mutationFn: (i: ServiceInput) => createService(i), onSuccess: inv });
}

export function useSeedDemoAgents() {
  const inv = useInvalidateAgents();
  return useMutation({ retry: false, mutationFn: seedDemoAgents, onSuccess: inv });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({ retry: false, mutationFn: updateMe, onSuccess: (p) => { qc.setQueryData(["me"], p); } });
}
