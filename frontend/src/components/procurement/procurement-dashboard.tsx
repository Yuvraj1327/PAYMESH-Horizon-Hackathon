"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, ClipboardList, FileClock, Plus, RotateCcw, Search, SearchX } from "lucide-react";
import { formatDateTime } from "@/components/common/format";
import { DemoNotice } from "@/components/common/data-source-notice";
import { ProcurementStatusBadge, STATUS_OPTIONS } from "@/components/procurement/status-badge";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategory } from "@/constants/categories";
import { useRequests, useResetDemo } from "@/hooks/use-procurement";
import { formatAmount } from "@/lib/utils";
import type { RequestStatus, RequestSummary } from "@/types/procurement";

export function computeKpis(rows: readonly RequestSummary[]) {
  const is = (...s: RequestStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  return {
    total: rows.length,
    pendingQuotations: is("awaiting_quotes"),
    active: is("awaiting_quotes", "quotes_ready", "provider_selected"),
    completed: is("completed"),
  };
}

export function filterRequests(rows: readonly RequestSummary[], q: string, status: RequestStatus | "all"): RequestSummary[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (!needle) return true;
    return [r.title, r.description, getCategory(r.category).label, r.selectedAgentName ?? ""].join(" ").toLowerCase().includes(needle);
  });
}

function Kpi({ label, value, icon: Icon, hint }: { label: string; value: number; icon: typeof Activity; hint: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-navy" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p></div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand"><Icon className="size-5" aria-hidden="true" /></span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

export function ProcurementDashboard() {
  const { data, isPending, isError, error, refetch } = useRequests();
  const reset = useResetDemo();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<RequestStatus | "all">("all");
  const [open, setOpen] = useState(false);
  const kpis = useMemo(() => computeKpis(data ?? []), [data]);
  const rows = useMemo(() => filterRequests(data ?? [], q, status), [data, q, status]);

  if (isError) return <ErrorState title="Couldn’t load procurement" message={error.message} onRetry={() => void refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <DemoNotice><strong className="font-semibold">Demo workspace.</strong> Requests here are stored only in this browser tab and use illustrative quotations. The “completed” sample is history for demonstration — no payment or delivery took place.</DemoNotice>

      <section aria-label="Procurement summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isPending ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />) : (
          <>
            <Kpi label="Total requests" value={kpis.total} icon={ClipboardList} hint="All requests in this workspace" />
            <Kpi label="Pending quotations" value={kpis.pendingQuotations} icon={FileClock} hint="Waiting for a provider to quote" />
            <Kpi label="Active requests" value={kpis.active} icon={Activity} hint="Not yet completed or cancelled" />
            <Kpi label="Completed requests" value={kpis.completed} icon={CheckCircle2} hint="Finished requests" />
          </>
        )}
      </section>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-base font-semibold text-navy">Request history</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <form role="search" onSubmit={(e) => e.preventDefault()} className="relative sm:w-64">
              <label htmlFor="req-search" className="sr-only">Search requests</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="req-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests…" className="h-9 pl-9" maxLength={100} />
            </form>
            <div className="sm:w-48">
              <label htmlFor="req-status" className="sr-only">Filter by status</label>
              <Select id="req-status" className="h-9" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "all")}>
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>
        </div>

        {isPending ? <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          : data.length === 0 ? <EmptyState icon={ClipboardList} title="No procurement requests yet" description="Create your first request to collect quotations from provider agents." action={<Button asChild><Link href="/procurement/new"><Plus /> New request</Link></Button>} />
          : rows.length === 0 ? <EmptyState icon={SearchX} title="No requests match" description="Try a different search or status filter." action={<Button variant="outline" onClick={() => { setQ(""); setStatus("all"); }}>Clear filters</Button>} />
          : (
            <ul className="divide-y" aria-label="Procurement requests">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/procurement/${r.id}`} className="grid gap-3 p-4 transition-colors hover:bg-muted/60 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{r.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{r.description}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-foreground">{getCategory(r.category).label}</p>
                      <p className="text-xs text-muted-foreground">Budget {formatAmount(r.maxBudget)} {r.asset}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-foreground">{r.quotationCount} {r.quotationCount === 1 ? "quotation" : "quotations"}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.selectedAgentName ? `Selected: ${r.selectedAgentName}` : "No provider selected"}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end lg:gap-1">
                      <ProcurementStatusBadge status={r.status} />
                      <time dateTime={r.createdAt} className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="ghost" size="sm"><RotateCcw /> Reset demo data</Button></DialogTrigger>
          <DialogContent>
            <DialogTitle>Reset demo data?</DialogTitle>
            <DialogDescription>This removes the requests you created in this tab and restores the sample history. Nothing outside this browser tab is affected.</DialogDescription>
            <div className="flex justify-end gap-2">
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button variant="navy" onClick={() => reset.mutate(undefined, { onSuccess: () => setOpen(false) })} disabled={reset.isPending}>Reset</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
