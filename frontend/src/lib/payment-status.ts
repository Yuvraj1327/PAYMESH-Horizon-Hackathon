import type { PaymentFilter, PaymentRecord, PaymentStatus } from "@/types/payment";
import { isTerminal } from "@/types/payment";
import { toMicro } from "@/lib/money";

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  DRAFT: "Draft",
  VALIDATED: "Validated",
  AWAITING_SIGNATURE: "Awaiting authorization",
  SIGNED: "Processing",
  SUBMITTED: "Processing",
  PENDING: "Processing",
  SETTLED: "Completed",
  FAILED: "Failed",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const FILTER_OPTIONS: { value: PaymentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "awaiting_authorization", label: "Awaiting authorization" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

/** "Pending" = anything still in progress (not terminal); Awaiting authorization / Processing are subsets of it. */
export function matchesFilter(status: PaymentStatus, filter: PaymentFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "pending": return !isTerminal(status);
    case "awaiting_authorization": return status === "AWAITING_SIGNATURE";
    case "processing": return status === "SIGNED" || status === "SUBMITTED" || status === "PENDING";
    case "completed": return status === "SETTLED";
    case "failed": return status === "FAILED";
    case "expired": return status === "EXPIRED";
    case "cancelled": return status === "CANCELLED";
  }
}

export interface PaymentKpis {
  total: number;
  successful: number;
  pending: number;
  failed: number;
  /** Verified-settled volume per asset. Assets are never added together. */
  volume: { asset: string; amount: string }[];
}

function fromMicro(v: bigint): string {
  const s = v.toString().padStart(7, "0");
  const i = s.slice(0, -6), f = s.slice(-6).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

export function computeKpis(items: PaymentRecord[]): PaymentKpis {
  const volume = new Map<string, bigint>();
  let successful = 0, pending = 0, failed = 0;
  for (const p of items) {
    if (p.status === "SETTLED") {
      successful += 1;
      volume.set(p.asset, (volume.get(p.asset) ?? 0n) + toMicro(p.amount));
    } else if (p.status === "FAILED" || p.status === "EXPIRED") failed += 1;
    else if (!isTerminal(p.status)) pending += 1;
  }
  return { total: items.length, successful, pending, failed, volume: [...volume].map(([asset, v]) => ({ asset, amount: fromMicro(v) })) };
}
