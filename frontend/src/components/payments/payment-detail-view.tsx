"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, ReceiptText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { PageHeader } from "@/components/layout/page-header";
import { DemoNotice } from "@/components/common/data-source-notice";
import { AddressText } from "@/components/common/address-text";
import { formatDateTime } from "@/components/common/format";
import { PaymentConditions } from "@/components/payments/payment-conditions";
import { HspProgress } from "@/components/payments/hsp-progress";
import { DemoBadge, PaymentStatusBadge } from "@/components/payments/payment-status-badge";
import { usePayment, usePaymentStatus, useRefreshStatus } from "@/hooks/use-payments";
import { describePaymentError } from "@/lib/payment-errors";
import { isTerminal } from "@/types/payment";

const EVENT_LABEL: Record<string, string> = {
  payment_intent_created: "Payment created and validated",
  payment_authorization_requested: "Authorization review prepared",
  hsp_order_created: "HSP order registered",
  hsp_status_changed: "HSP status changed",
  payment_settled: "Settlement recorded",
  payment_settled_verified: "Settlement verified",
  payment_verification_failed: "Settlement verification failed",
  payment_cancelled: "Payment cancelled",
  payment_failed: "Payment failed",
  payment_expired: "Payment expired",
};
const humanize = (t: string) => EVENT_LABEL[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Item({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-medium text-foreground" data-testid={testId}>{children}</dd></div>;
}

export function PaymentDetailView({ paymentId }: { paymentId: string }) {
  const q = usePayment(paymentId);
  const registered = q.data?.status?.hsp?.orderState === "created";
  const polled = usePaymentStatus(paymentId, q.data?.payment.status, registered);
  const refresh = useRefreshStatus();
  const back = <Button asChild variant="outline"><Link href="/payments"><ArrowLeft /> All payments</Link></Button>;

  if (q.isLoading) return <div><PageHeader title="Payment" actions={back} /><div className="grid gap-4 lg:grid-cols-3" aria-busy="true"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div></div>;
  if (q.isError || !q.data) return <div><PageHeader title="Payment" actions={back} /><Card><ErrorState title="Payment not found" message={describePaymentError(q.error).message} onRetry={() => void q.refetch()} /></Card></div>;

  const { payment, receipt, events } = q.data;
  const status = polled.data ?? q.data.status;
  const p = { ...payment, status: polled.data?.status ?? payment.status };
  const hsp = status?.hsp ?? null;
  const txHash = receipt?.txHash ?? hsp?.txHash ?? p.txHash;
  const demo = p.source === "demo";
  const linkable = !p.requestId.startsWith("demo-sample");
  const payer = receipt?.payerAddress ?? hsp?.payerAddress ?? null;

  return (
    <div>
      <PageHeader
        title="Payment details"
        description={`${p.providerName}`}
        actions={<>{back}{p.status === "SETTLED" && <Button asChild><Link href={`/payments/${p.id}/receipt`}><ReceiptText /> View receipt</Link></Button>}</>}
      />
      {demo && <DemoNotice className="mb-4">Demo record. No HSP order exists for it and nothing was settled on-chain; there is no transaction hash.</DemoNotice>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2"><CardTitle>Status</CardTitle><PaymentStatusBadge status={p.status} />{demo && <DemoBadge />}</div>
              <CardDescription>A payment is complete only when the backend has verified settlement. A wallet signature alone is not proof of payment.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Item label="Payment ID"><code className="break-all font-mono text-xs">{p.id}</code></Item>
                <Item label="Procurement request">{linkable ? <Link href={`/procurement/${p.requestId}`} className="text-brand hover:underline">View request</Link> : <span className="text-muted-foreground">Sample record</span>}</Item>
                <Item label="Payer wallet">{payer ? <AddressText value={payer} chainId={p.chainId} /> : <span className="text-muted-foreground">Not yet known</span>}</Item>
                <Item label="Receiver">{p.recipient ? <AddressText value={p.recipient} chainId={p.chainId} /> : <span className="text-muted-foreground">Not available (demo)</span>}</Item>
                <Item label="Mandate status" testId="mandate-status">{hsp?.orderState === "created" ? "Cart Mandate registered with HSP" : hsp ? hsp.orderState : "No HSP order registered"}</Item>
                <Item label="Authorization status" testId="authorization-status">{hsp?.gatewayStatus ? `HSP: ${hsp.gatewayStatus.replace("payment-", "")}` : hsp?.orderState === "created" ? "Waiting for your signature" : "Not started"}</Item>
                <Item label="Settlement status" testId="settlement-status">{status?.settledAndVerified ? (demo ? "Demo sample (not real)" : "Verified by PayMesh") : "Not verified"}</Item>
                <Item label="Transaction hash">{txHash ? <AddressText value={txHash} chainId={p.chainId} kind="tx" /> : <span className="text-muted-foreground">None yet</span>}</Item>
                <Item label="Created">{formatDateTime(p.createdAt)}</Item>
                <Item label="Last update">{formatDateTime(p.updatedAt)}</Item>
              </dl>
              {p.failureReason && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">Reason: {p.failureReason}</p>}
              {hsp && !demo && <HspProgress view={status} />}
              <div className="flex flex-wrap gap-3">
                {!isTerminal(p.status) && linkable && <Button asChild><Link href={`/procurement/${p.requestId}/pay`}>Continue payment <ArrowRight /></Link></Button>}
                {!demo && hsp?.orderState === "created" && !isTerminal(p.status) && (
                  <Button variant="outline" onClick={() => refresh.mutate(p.id)} disabled={refresh.isPending}>{refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh from HSP</Button>
                )}
              </div>
              {refresh.error && <p role="alert" className="text-sm text-danger">{describePaymentError(refresh.error).message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity timeline</CardTitle><CardDescription>Events recorded by the backend. Nothing is added by this screen.</CardDescription></CardHeader>
            <CardContent>
              {events.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded yet.</p> : (
                <ol className="relative flex flex-col gap-4 border-l pl-5" aria-label="Payment activity timeline" data-testid="payment-timeline">
                  {events.map((e) => (
                    <li key={e.id} className="relative">
                      <span aria-hidden="true" className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full bg-teal" />
                      <p className="text-sm font-medium text-foreground" data-testid="timeline-title">{humanize(e.type)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(e.at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <aside><PaymentConditions p={p} title="Payment conditions" description="Frozen by the backend when the payment was created." /></aside>
      </div>
    </div>
  );
}
