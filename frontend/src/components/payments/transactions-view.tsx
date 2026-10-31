"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/states";
import { PageHeader } from "@/components/layout/page-header";
import { DemoNotice } from "@/components/common/data-source-notice";
import { PaymentRow } from "@/components/payments/payments-dashboard";
import { usePayments } from "@/hooks/use-payments";
import { FILTER_OPTIONS } from "@/lib/payment-status";
import { queryTransactions, type TxQuery } from "@/lib/transactions";
import { describePaymentError } from "@/lib/payment-errors";
import type { PaymentFilter } from "@/types/payment";

const PAGE_SIZE = 10;

export function TransactionsView() {
  const q = usePayments();
  const [state, setState] = useState<Omit<TxQuery, "pageSize">>({ text: "", status: "all", network: "all", sort: "newest", page: 1 });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const result = useMemo(() => queryTransactions(items, { ...state, pageSize: PAGE_SIZE }), [items, state]);
  const set = (patch: Partial<typeof state>) => setState((s) => ({ ...s, page: 1, ...patch }));
  const hasDemo = items.some((p) => p.source === "demo");

  return (
    <div>
      <PageHeader title="Transactions" description="Your payment history. Only settlements verified by the backend are shown as completed." />
      {hasDemo && <DemoNotice className="mb-4">Demo records. None of these are on-chain transactions, and none has a transaction hash.</DemoNotice>}
      <Card>
        <div className="grid gap-3 border-b p-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="tx-search" aria-label="Search by payment ID or transaction hash" placeholder="Payment ID or transaction hash" className="pl-9" value={state.text} onChange={(e) => set({ text: e.target.value })} />
          </div>
          <Select id="tx-status" aria-label="Filter by status" value={state.status} onChange={(e) => set({ status: e.target.value as PaymentFilter })}>
            {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === "all" ? "All statuses" : o.label}</option>)}
          </Select>
          <Select id="tx-network" aria-label="Filter by network" value={state.network} onChange={(e) => set({ network: e.target.value as TxQuery["network"] })}>
            <option value="all">All networks</option><option value="133">HashKey Testnet</option><option value="177">HashKey Mainnet</option>
          </Select>
          <Select id="tx-sort" aria-label="Sort by date" value={state.sort} onChange={(e) => set({ sort: e.target.value as TxQuery["sort"] })}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </Select>
        </div>
        {q.isLoading ? <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
          : q.isError ? <ErrorState title="Could not load transactions" message={describePaymentError(q.error).message} onRetry={() => void q.refetch()} />
          : items.length === 0 ? <EmptyState icon={Receipt} title="No transactions yet" description="Payments you authorize will appear here." action={<Button asChild variant="outline"><Link href="/procurement">Go to procurement</Link></Button>} />
          : result.total === 0 ? <EmptyState title="No transactions match" description="Adjust the search or filters." action={<Button variant="outline" onClick={() => set({ text: "", status: "all", network: "all" })}>Clear filters</Button>} />
          : (
            <>
              <ul aria-label="Transactions" className="divide-y" data-testid="tx-list">{result.rows.map((p) => <PaymentRow key={p.id} p={p} />)}</ul>
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t p-3 text-sm">
                <span className="text-muted-foreground" data-testid="tx-count">{result.total} transaction{result.total === 1 ? "" : "s"} · page {result.page} of {result.pages}</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, page: result.page - 1 }))} disabled={result.page <= 1} aria-label="Previous page"><ChevronLeft /> Prev</Button>
                  <Button variant="outline" size="sm" onClick={() => setState((s) => ({ ...s, page: result.page + 1 }))} disabled={result.page >= result.pages} aria-label="Next page">Next <ChevronRight /></Button>
                </span>
              </nav>
            </>
          )}
      </Card>
      {q.data?.truncated && <p className="mt-3 text-xs text-muted-foreground" role="note">Showing your {items.length} most recent of {q.data.total} payments; search covers these only.</p>}
    </div>
  );
}
