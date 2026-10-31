import { matchesFilter } from "@/lib/payment-status";
import type { PaymentFilter, PaymentRecord } from "@/types/payment";

export interface TxQuery { text: string; status: PaymentFilter; network: "all" | "133" | "177"; sort: "newest" | "oldest"; page: number; pageSize: number }

/** Pure search / filter / sort / paginate over the fetched records (the backend list endpoint has no search parameters). */
export function queryTransactions(items: PaymentRecord[], q: TxQuery) {
  const t = q.text.trim().toLowerCase();
  const filtered = items.filter((p) =>
    matchesFilter(p.status, q.status)
    && (q.network === "all" || String(p.chainId) === q.network)
    && (!t || p.id.toLowerCase().includes(t) || (p.txHash ?? "").toLowerCase().includes(t)));
  filtered.sort((a, b) => (q.sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  const pages = Math.max(1, Math.ceil(filtered.length / q.pageSize));
  const page = Math.min(Math.max(1, q.page), pages);
  return { total: filtered.length, pages, page, rows: filtered.slice((page - 1) * q.pageSize, page * q.pageSize) };
}
