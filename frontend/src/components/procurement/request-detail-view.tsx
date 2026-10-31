"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Ban, FileText, Loader2, Lock, Wallet } from "lucide-react";
import { formatDateTime } from "@/components/common/format";
import { DemoNotice } from "@/components/common/data-source-notice";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { Timeline } from "@/components/procurement/timeline";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { deliveryLabel, getCategory } from "@/constants/categories";
import { useCancelRequest, useRequestDetail } from "@/hooks/use-procurement";
import { formatAmount } from "@/lib/utils";
import { NotFoundError } from "@/services/errors";

export function RequestDetailView({ requestId }: { requestId: string }) {
  const { data, isPending, isError, error, refetch } = useRequestDetail(requestId);
  const cancel = useCancelRequest();
  const [open, setOpen] = useState(false);

  if (isPending) return <div role="status" aria-label="Loading request"><Skeleton className="mb-4 h-32 w-full rounded-xl" /><div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-96 rounded-xl lg:col-span-2" /><Skeleton className="h-96 rounded-xl" /></div></div>;
  if (isError) {
    return error instanceof NotFoundError
      ? <EmptyState title="Request not found" description="This procurement request doesn’t exist in this workspace. Demo requests live only in this browser tab." action={<Button asChild variant="outline"><Link href="/procurement">Back to procurement</Link></Button>} className="rounded-xl border bg-surface" />
      : <ErrorState title="Couldn’t load this request" message={error.message} onRetry={() => void refetch()} />;
  }

  const { request: r, quotations, events, selectedAgentName } = data;
  const selected = quotations.find((q) => q.id === r.selectedQuotationId);
  const open_ = r.status === "awaiting_quotes" || r.status === "quotes_ready" || r.status === "provider_selected";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/procurement" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" /> All requests</Link>
      {r.source === "demo" && <DemoNotice><strong className="font-semibold">Demo request.</strong> Stored only in this browser tab. Quotations and the recommendation are illustrative.</DemoNotice>}

      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><ProcurementStatusBadge status={r.status} /><Badge variant="outline">{getCategory(r.category).label}</Badge>{r.origin === "assistant" && <Badge variant="outline">Created via AI assistant</Badge>}</div>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-navy sm:text-2xl">{r.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Created {formatDateTime(r.createdAt)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {quotations.length > 0 && <Button asChild><Link href={`/procurement/${r.id}/quotations`}><FileText /> {r.status === "quotes_ready" ? "Compare quotations" : "View quotations"}</Link></Button>}
            {open_ && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button variant="outline"><Ban /> Cancel request</Button></DialogTrigger>
                <DialogContent>
                  <DialogTitle>Cancel this request?</DialogTitle>
                  <DialogDescription>The request will be closed and providers stop being considered. Nothing has been paid, so there is nothing to refund.</DialogDescription>
                  {cancel.isError && <p role="alert" className="text-sm font-medium text-danger">{cancel.error.message}</p>}
                  <div className="flex justify-end gap-2">
                    <DialogClose asChild><Button variant="outline">Keep request</Button></DialogClose>
                    <Button variant="navy" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id, { onSuccess: () => setOpen(false) })}>{cancel.isPending ? <><Loader2 className="animate-spin motion-reduce:animate-none" /> Cancelling…</> : "Cancel request"}</Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Request details</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.description}</p>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div><dt className="text-xs font-medium text-muted-foreground">Maximum budget</dt><dd className="mt-0.5 text-lg font-bold text-navy">{formatAmount(r.maxBudget)} {r.asset}</dd></div>
                <div><dt className="text-xs font-medium text-muted-foreground">Preferred delivery</dt><dd className="mt-0.5 font-medium">{deliveryLabel(r.preferredDeliveryMinutes)}</dd></div>
                <div><dt className="text-xs font-medium text-muted-foreground">Quotations</dt><dd className="mt-0.5 font-medium">{quotations.length}</dd></div>
              </dl>
              <div><h3 className="mb-2 text-sm font-semibold">Requirements</h3>{r.requiredCapabilities.length ? <ul className="flex flex-wrap gap-2" aria-label="Required capabilities">{r.requiredCapabilities.map((c) => <li key={c}><Badge variant="brand">{c}</Badge></li>)}</ul> : <p className="text-sm text-muted-foreground">No specific capabilities requested.</p>}</div>
              {r.additionalInstructions && <div><h3 className="mb-1 text-sm font-semibold">Additional instructions</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.additionalInstructions}</p></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Quotations</CardTitle><CardDescription>{quotations.length ? "Provider responses for this request." : "No provider has quoted yet."}</CardDescription></CardHeader>
            <CardContent>
              {quotations.length === 0 ? <p className="text-sm text-muted-foreground">No available provider could quote within your budget and asset.</p> : (
                <ul className="divide-y">
                  {quotations.map((q) => (
                    <li key={q.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0"><p className="font-medium">{q.serviceName}</p><p className="text-xs text-muted-foreground">~{deliveryLabel(q.deliveryMinutes)} · {q.reputation !== null ? `${q.reputation.toFixed(1)}/5 (sample)` : "no rating"}</p></div>
                      <div className="flex items-center gap-3"><strong className="text-navy">{formatAmount(q.price)} {q.asset}</strong>{q.status === "selected" ? <Badge variant="brand">Selected</Badge> : q.id === r.recommendation?.recommendedQuotationId ? <Badge variant="success">AI pick</Badge> : null}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle><CardDescription>Only events that actually happened are listed.</CardDescription></CardHeader>
            <CardContent><Timeline events={events} /></CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Selected provider</CardTitle></CardHeader>
            <CardContent>
              {selected ? (
                <div className="flex flex-col gap-2">
                  <p className="font-semibold"><Link href={`/marketplace/${selected.agentId}`} className="hover:text-brand">{selectedAgentName}</Link></p>
                  <p className="text-sm text-muted-foreground">{selected.serviceName}</p>
                  <p className="text-xl font-bold text-navy">{formatAmount(selected.price)} {selected.asset}</p>
                  <p className="text-xs text-muted-foreground">Delivery ~{deliveryLabel(selected.deliveryMinutes)}</p>
                  {r.status === "provider_selected" && <Button asChild variant="outline" size="sm" className="mt-1 w-fit"><Link href={`/procurement/${r.id}/quotations`}>Change selection <ArrowRight /></Link></Button>}
                </div>
              ) : <p className="text-sm text-muted-foreground">No provider selected yet.{r.status === "quotes_ready" && " Compare the quotations to choose one."}</p>}
            </CardContent>
          </Card>

          {r.payment && (
            <Card className="border-warning/30">
              <CardHeader><div className="flex items-center gap-2"><Wallet className="size-4 text-warning" aria-hidden="true" /><CardTitle>Payment</CardTitle></div><CardDescription>Ready for review. Nothing is paid until you approve and sign.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="font-semibold text-navy">{formatAmount(r.payment.amount)} {r.payment.asset}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Status</dt><dd><Badge variant="warning">Awaiting authorization</Badge></dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">Next: the backend runs the Payment Guardian, you review the conditions, then your wallet signs in the HSP checkout. Nothing has been signed or paid yet.</p>
                <Button asChild data-testid="review-payment"><Link href={`/procurement/${r.id}/pay`}><Lock /> Review &amp; authorize payment</Link></Button>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
