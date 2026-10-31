"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payments, rotateIdempotencyKey } from "@/services/payments";
import { singleFlight } from "@/lib/single-flight";
import { POLLING_STATUSES, type PolicyInput } from "@/types/payment";
import type { PaymentStatus } from "@/types/payment";

export const payKeys = {
  list: ["payments"] as const,
  detail: (id: string) => ["payment", id] as const,
  status: (id: string) => ["payment-status", id] as const,
  guardian: (id: string) => ["payment-guardian", id] as const,
  signing: (id: string) => ["payment-signing", id] as const,
  forRequest: (requestId: string) => ["payment-for-request", requestId] as const,
  policy: ["spending-policy"] as const,
};

export function usePayments() {
  return useQuery({ queryKey: payKeys.list, queryFn: () => payments.list(), retry: false });
}

export function usePayment(id: string | null) {
  return useQuery({ queryKey: payKeys.detail(id ?? "none"), queryFn: () => payments.detail(id as string), enabled: !!id, retry: false });
}

export function usePaymentForRequest(requestId: string) {
  return useQuery({ queryKey: payKeys.forRequest(requestId), queryFn: () => payments.activeForRequest(requestId), retry: false });
}

/** Dry-run of the backend Guardian (changes nothing). Re-asked every time the screen opens. */
export function useGuardian(id: string | null) {
  return useQuery({
    queryKey: payKeys.guardian(id ?? "none"), queryFn: () => payments.validate(id as string),
    enabled: !!id, staleTime: 0, gcTime: 0, retry: false,
  });
}

export function useSigningData(id: string | null, enabled: boolean) {
  return useQuery({ queryKey: payKeys.signing(id ?? "none"), queryFn: () => payments.signingData(id as string), enabled: !!id && enabled, retry: false, staleTime: 60_000 });
}

/**
 * Polls the backend for HSP progress while the payment is in flight (every 4 s; the backend throttles gateway
 * queries itself). Polling is a GET, never a state-changing call, and stops on any terminal status.
 */
export function usePaymentStatus(id: string, status: PaymentStatus | undefined, orderRegistered: boolean) {
  const qc = useQueryClient();
  const active = !!status && POLLING_STATUSES.includes(status) && orderRegistered;
  const q = useQuery({
    queryKey: payKeys.status(id), queryFn: () => payments.status(id, true), enabled: active,
    refetchInterval: (query) => (query.state.data && !POLLING_STATUSES.includes(query.state.data.status) ? false : 4000),
    refetchIntervalInBackground: false, retry: false, staleTime: 0,
  });
  const last = useRef<string | null>(null);
  const seen = q.data ? `${q.data.status}|${q.data.hsp?.gatewayStatus ?? ""}|${q.data.settledAndVerified}` : null;
  useEffect(() => {
    if (seen && last.current !== null && last.current !== seen) {
      void qc.invalidateQueries({ queryKey: payKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: payKeys.list });
      void qc.invalidateQueries({ queryKey: ["payment-for-request"] });
    }
    last.current = seen;
  }, [seen, id, qc]);
  return q;
}

function useRefreshAll() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: payKeys.list }),
    qc.invalidateQueries({ queryKey: ["payment"] }),
    qc.invalidateQueries({ queryKey: ["payment-for-request"] }),
    qc.invalidateQueries({ queryKey: ["payment-status"] }),
  ]);
}

// All payment mutations: retry is OFF (no blind retries) and concurrent calls with the same key share one request.
export function useCreatePayment() {
  const refresh = useRefreshAll();
  return useMutation({
    retry: false,
    mutationFn: (v: { requestId: string; quotationId?: string; fresh?: boolean }) => singleFlight(`create:${v.requestId}`, async () => {
      if (v.fresh) rotateIdempotencyKey(v.requestId);
      return payments.create(v.requestId, v.quotationId);
    }),
    onSuccess: refresh,
  });
}

export function useAuthorizePayment() {
  const refresh = useRefreshAll();
  return useMutation({ retry: false, mutationFn: (id: string) => singleFlight(`authorize:${id}`, () => payments.authorize(id)), onSuccess: refresh, onError: refresh });
}

/** Registers the HSP order (Cart Mandate) and returns the checkout link. Idempotent on the backend. */
export function useApprovePayment() {
  const refresh = useRefreshAll();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) => singleFlight(`mandate:${id}`, async () => {
      const mandate = await payments.createMandate(id);
      const signing = await payments.signingData(id);
      qc.setQueryData(payKeys.signing(id), signing);
      return { mandate, signing };
    }),
    onSuccess: refresh, onError: refresh,
  });
}

export function useVerifyPayment() {
  const refresh = useRefreshAll();
  return useMutation({ retry: false, mutationFn: (id: string) => singleFlight(`verify:${id}`, () => payments.verify(id)), onSuccess: refresh, onError: refresh });
}

export function useRefreshStatus() {
  const refresh = useRefreshAll();
  return useMutation({ retry: false, mutationFn: (id: string) => singleFlight(`status:${id}`, () => payments.status(id, true)), onSuccess: refresh });
}

export function useCancelPayment() {
  const refresh = useRefreshAll();
  return useMutation({ retry: false, mutationFn: (id: string) => singleFlight(`cancel:${id}`, () => payments.cancel(id)), onSuccess: refresh });
}

export function useReceipt(id: string | null, enabled = true) {
  return useQuery({ queryKey: ["payment-receipt", id], queryFn: () => payments.receipt(id as string), enabled: !!id && enabled, retry: false });
}

export function usePolicy() {
  return useQuery({ queryKey: payKeys.policy, queryFn: () => payments.getPolicy(), retry: false });
}

export function useSavePolicy() {
  const qc = useQueryClient();
  return useMutation({ retry: false, mutationFn: (v: PolicyInput) => singleFlight("policy:save", () => payments.savePolicy(v)), onSuccess: (p) => { qc.setQueryData(payKeys.policy, p); } });
}
