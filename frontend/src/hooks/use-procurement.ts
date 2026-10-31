"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelRequest, createRequest, getRequestDetail, listAgentActivity, listRequests, requestQuotations, resetDemoData, selectProvider } from "@/services/procurement";
import type { NewRequestInput } from "@/types/procurement";

export const keys = {
  requests: ["requests"] as const,
  request: (id: string) => ["request", id] as const,
  activity: ["agent-activity"] as const,
};

export function useRequests() {
  return useQuery({ queryKey: keys.requests, queryFn: listRequests });
}

export function useRequestDetail(id: string) {
  return useQuery({ queryKey: keys.request(id), queryFn: () => getRequestDetail(id), retry: false });
}

export function useAgentActivity() {
  return useQuery({ queryKey: keys.activity, queryFn: listAgentActivity });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.requests }), qc.invalidateQueries({ queryKey: ["request"] }), qc.invalidateQueries({ queryKey: keys.activity })]);
}

export function useCreateRequest() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: NewRequestInput) => createRequest(input), onSuccess: invalidate });
}

export function useSelectProvider() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { requestId: string; quotationId: string }) => selectProvider(v.requestId, v.quotationId), onSuccess: invalidate });
}

export function useRequestQuotations() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => requestQuotations(id), onSuccess: invalidate });
}

export function useCancelRequest() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => cancelRequest(id), onSuccess: invalidate });
}

export function useResetDemo() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: resetDemoData, onSuccess: invalidate });
}
