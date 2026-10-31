"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock, Coins, CreditCard, Search, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/states";
import { PageHeader } from "@/components/layout/page-header";
import { DemoNotice } from "@/components/common/data-source-notice";
import { AddressText } from "@/components/common/address-text";
import { DemoBadge, PaymentStatusBadge } from "@/components/payments/payment-status-badge";
import { usePayments } from "@/hooks/use-payments";
import { computeKpis, FILTER_OPTIONS, matchesFilter } from "@/lib/payment-status";
import { chainLabel } from "@/lib/web3/chains";
import { describePaymentError } from "@/lib/payment-errors";
import { formatDateTime } from "@/components/common/format";
import { cn } from "@/lib/utils";
import { formatTokenAmount as formatAmount } from "@/lib/decimal";
import type { PaymentFilter, PaymentRecord } from "@/types/payment";

function Kpi({ id, label, value, hint, icon: Icon, tone }: { id: string; label: string; value: string; hint?: string; icon: typeof CreditCard; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tone)}><Icon className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="truncate text-2xl font-bold text-navy" data-testid={id}>{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function PaymentRow({ p }: { p: PaymentRecord }) {
  return (
    <li className="grid gap-3 px-4 py-4 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center" data-testid="payment-row" data-status={p.status}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Link href={`/payments/${p.id}`} className="truncate font-mono text-xs text-brand hover:underline" title={p.id}>{p.id.length > 20 ? `${p.id.slice(0, 8)}…${p.id.slice(-4)}` : p.id}</Link>
          <PaymentStatusBadge status={p.status} />
          {p.source === "demo" && <DemoBadge />}
        </p>
        <p className="mt-1 truncate text-sm text-foreground">{p.providerName}</p>
        <p className="text-xs text-muted-foreground">Procurement <span className="font-mono">{p.requestId.length > 14 ? `${p.requestId.slice(0, 8)}…` : p.requestId}</span></p>
      </div>
      <div>
        <p className="text-base font-bold text-navy">{formatAmount(p.amount)} <span className="text-xs font-medium text-muted-foreground">{p.asset}</span></p>
        <p className="text-xs text-muted-foreground">{chainLabel(p.chainId)}</p>
      </div>
      <div className="text-xs text-muted-foreground">
        <p>{formatDateTime(p.createdAt)}</p>
        <p className="mt-1 flex items-center gap-1">Tx: {p.txHash ? <AddressText value={p.txHash} chainId={p.chainId} kind="tx" /> : <span>—</span>}</p>
      </div>
      <Button asChild variant="outline" size="sm"><Link href={`/payments/${p.id}`}>Details <ArrowRight /></Link></Button>
    </li>
  );
}

export function PaymentsDashboard() {
  const q = usePayments();
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [text, setText] = useState("");
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const kpis = useMemo(() => computeKpis(items), [items]);
  const counts = useMemo(() => Object.fromEntries(FILTER_OPTIONS.map((o) => [o.value, items.filter((p) => matchesFilter(p.status, o.value)).length])) as Record<PaymentFilter, number>, [items]);
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    return items.filter((p) => matchesFilter(p.status, filter) && (!t || [p.id, p.requestId, p.providerName, p.txHash ?? ""].some((v) => v.toLowerCase().includes(t))));
  }, [items, filter, text]);
  const hasDemo = items.some((p) => p.source === "demo");

  return (
    <div>
      <PageHeader title="Payments" description="Authorize provider payments with your wallet and follow HSP settlement. A payment counts as completed only after the backend verifies it." actions={<Button asChild variant="outline"><Link href="/transactions">Transaction history</Link></Button>} />
      {hasDemo && <DemoNotice className="mb-4">Demo records. These payments are illustrative: no HSP order exists for them and nothing was settled on-chain. Real payments appear here once the backend is connected.</DemoNotice>}

      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState title="Could not load payments" message={describePaymentError(q.error).message} onRetry={() => void q.refetch()} /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi id="kpi-total-payments" label="Total payments" value={String(kpis.total)} icon={CreditCard} tone="bg-navy-50 text-navy" />
            <Kpi id="kpi-successful-payments" label="Successful" value={String(kpis.successful)} hint="Verified by the backend" icon={CheckCircle2} tone="bg-success-bg text-success" />
            <Kpi id="kpi-pending-payments" label="Pending" value={String(kpis.pending)} hint="In progress" icon={Clock} tone="bg-warning-bg text-warning" />
            <Kpi id="kpi-failed-payments" label="Failed" value={String(kpis.failed)} hint="Failed or expired" icon={XCircle} tone="bg-danger-bg text-danger" />
            <Kpi id="kpi-payment-volume" label="Payment volume" value={kpis.volume.length ? kpis.volume.map((v) => `${formatAmount(v.amount)} ${v.asset}`).join(" + ") : "0"} hint="Verified settlements only" icon={Coins} tone="bg-info-bg text-info" />
          </div>
          {q.data?.truncated && <p className="mt-3 text-xs text-muted-foreground" role="note">Showing your {items.length} most recent payments of {q.data.total}. Totals above cover only these.</p>}

          <Card className="mt-6">
            <div className="flex flex-col gap-3 border-b p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="pay-search" aria-label="Search payments" placeholder="Search by payment ID, procurement ID, provider or transaction hash" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((o) => (
                  <button key={o.value} type="button" aria-pressed={filter === o.value} onClick={() => setFilter(o.value)} data-filter={o.value}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", filter === o.value ? "border-navy bg-navy text-white" : "bg-surface text-muted-foreground hover:bg-muted")}>
                    {o.label} <span className="opacity-70">{counts[o.value]}</span>
                  </button>
                ))}
              </div>
            </div>
            {items.length === 0 ? (
              <EmptyState icon={CreditCard} title="No payments yet" description="Select a provider on a procurement request, then review and authorize the payment." action={<Button asChild><Link href="/procurement">Go to procurement</Link></Button>} />
            ) : shown.length === 0 ? (
              <EmptyState title="No payments match" description="Try a different status or clear the search." action={<Button variant="outline" onClick={() => { setFilter("all"); setText(""); }}>Clear filters</Button>} />
            ) : (
              <ul aria-label="Payments" className="divide-y">{shown.map((p) => <PaymentRow key={p.id} p={p} />)}</ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
