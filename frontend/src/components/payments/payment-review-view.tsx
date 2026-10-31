"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Loader2, Lock, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { PageHeader } from "@/components/layout/page-header";
import { DemoNotice } from "@/components/common/data-source-notice";
import { AddressText } from "@/components/common/address-text";
import { GuardianPanel } from "@/components/payments/guardian-panel";
import { PaymentConditions } from "@/components/payments/payment-conditions";
import { HspProgress } from "@/components/payments/hsp-progress";
import { DemoBadge, PaymentStatusBadge } from "@/components/payments/payment-status-badge";
import { WalletReadiness, useWalletReadiness } from "@/components/wallet/wallet-readiness";
import { useRequestDetail } from "@/hooks/use-procurement";
import { useNow } from "@/hooks/use-now";
import { useOnline } from "@/hooks/use-online";
import { useApprovePayment, useAuthorizePayment, useCancelPayment, useCreatePayment, useGuardian, usePayment, usePaymentForRequest, usePaymentStatus, useSigningData, useVerifyPayment } from "@/hooks/use-payments";
import { buildGuardianChecks, isBlocked } from "@/lib/guardian";
import { describePaymentError } from "@/lib/payment-errors";
import { formatTokenAmount } from "@/lib/decimal";
import { PaymentBlockedError } from "@/services/payments";
import { isTerminal, type GuardianResult, type PaymentRecord } from "@/types/payment";
import { cn } from "@/lib/utils";

const STEPS = ["Provider selected", "Payment created", "Guardian checks", "Review & approve", "Sign in HSP checkout", "Settlement verified"] as const;

function stepIndex(p: PaymentRecord | null | undefined, orderRegistered: boolean): number {
  if (!p) return 1;
  switch (p.status) {
    case "DRAFT": case "VALIDATED": return 2;
    case "AWAITING_SIGNATURE": return orderRegistered ? 4 : 3;
    case "SIGNED": case "SUBMITTED": case "PENDING": return 4;
    case "SETTLED": return 6;
    default: return 2;
  }
}

function Stepper({ current, failed }: { current: number; failed: boolean }) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Payment progress" data-testid="pay-stepper">
      {STEPS.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <li key={s} aria-current={active ? "step" : undefined} data-step={i} data-done={done} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium", done ? "border-teal/40 bg-teal/5 text-foreground" : active ? (failed ? "border-danger/40 bg-danger-bg text-danger" : "border-brand bg-info-bg text-info") : "bg-surface text-muted-foreground")}>
            {done ? <CheckCircle2 className="size-4 shrink-0 text-teal" aria-hidden="true" /> : <span className="flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]">{i + 1}</span>}
            <span>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = describePaymentError(error);
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger" data-testid="pay-error">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div><p className="font-semibold">{e.title}</p><p>{e.message}</p></div>
    </div>
  );
}

export function PaymentReviewView({ requestId }: { requestId: string }) {
  const now = useNow();
  const online = useOnline();
  const req = useRequestDetail(requestId);
  const active = usePaymentForRequest(requestId);
  const payment = active.data ?? null;
  const detail = usePayment(payment?.id ?? null);
  const live = detail.data?.payment ?? payment;
  const orderRegistered = detail.data?.status?.hsp?.orderState === "created";
  const polled = usePaymentStatus(live?.id ?? "none", live?.status, orderRegistered);
  const statusView = polled.data ?? detail.data?.status ?? null;
  const status = polled.data?.status ?? live?.status;
  const p: PaymentRecord | null = live && status ? { ...live, status } : live;
  const registered = orderRegistered || (statusView?.hsp?.orderState === "created");

  const create = useCreatePayment();
  const authorize = useAuthorizePayment();
  const approve = useApprovePayment();
  const verify = useVerifyPayment();
  const cancel = useCancelPayment();
  const [approved, setApproved] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const guardianOn = !!p && (p.status === "VALIDATED" || (p.status === "AWAITING_SIGNATURE" && !registered));
  const guardian = useGuardian(guardianOn ? p.id : null);
  const blockedFromCreate = create.error instanceof PaymentBlockedError ? create.error : authorize.error instanceof PaymentBlockedError ? authorize.error : null;
  const guardianData = guardian.data ?? null;
  const checks = useMemo(() => {
    const result: GuardianResult | null = blockedFromCreate
      ? { evaluated: true, valid: false, failures: blockedFromCreate.failures, hspConfigured: null, source: "demo" }
      : guardianData;
    return buildGuardianChecks(result, { expiresAt: p?.expiresAt, now });
  }, [blockedFromCreate, guardianData, p?.expiresAt, now]);
  const blocked = isBlocked(checks);

  const signing = useSigningData(p?.id ?? null, !!p && p.status === "AWAITING_SIGNATURE" && registered);
  const checkout = approve.data?.signing ?? signing.data ?? null;

  const readiness = useWalletReadiness({ chainId: p?.chainId ?? 0, expectedPayer: null, tokenAddress: checkout?.tokenAddress, amount: p?.amount ?? "0", asset: p?.asset ?? "" });
  const expired = !!p && !isTerminal(p.status) && new Date(p.expiresAt).getTime() <= now;

  const title = req.data?.request.title;
  const selectedQuotation = req.data?.quotations.find((q) => q.id === req.data?.request.selectedQuotationId) ?? null;
  const demo = (p?.source ?? (req.data ? req.data.request.source : "live")) === "demo";

  const header = <PageHeader title="Payment review & authorization" description={title ? `For “${title}”. Nothing is paid until you approve and sign in your wallet.` : "Review the payment conditions, check the Payment Guardian results, then authorize with your wallet."} actions={<Button asChild variant="outline"><Link href={`/procurement/${requestId}`}><ArrowLeft /> Back to request</Link></Button>} />;

  if (active.isLoading) return <div>{header}<div className="grid gap-4 lg:grid-cols-3" aria-busy="true"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div></div>;
  if (active.isError) return <div>{header}<Card><ErrorState title="Could not load payment" message={describePaymentError(active.error).message} onRetry={() => void active.refetch()} /></Card></div>;

  const step = stepIndex(p, registered);
  const failed = !!p && ["FAILED", "EXPIRED", "CANCELLED"].includes(p.status);

  return (
    <div>
      {header}
      {demo && <DemoNotice className="mb-4">Demo mode. You can walk through creation, Guardian checks and review, but no HSP order is created, no wallet signature is requested and nothing is paid. The flow stops at the HSP step.</DemoNotice>}
      <Stepper current={failed ? step : step} failed={failed} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* A. No payment yet */}
          {!p && (
            <>
              <Card>
                <CardHeader><CardTitle>Create the payment</CardTitle><CardDescription>This asks the backend to freeze the payment conditions and run the Payment Guardian. Nothing is signed, sent or paid.</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {selectedQuotation ? (
                    <dl className="grid gap-3 sm:grid-cols-3 text-sm">
                      <div><dt className="text-xs text-muted-foreground">Selected provider</dt><dd className="font-medium">{req.data?.selectedAgentName ?? "Provider"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Quoted amount</dt><dd className="text-lg font-bold text-navy">{formatTokenAmount(selectedQuotation.price)} {selectedQuotation.asset}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{selectedQuotation.serviceName}</dd></div>
                    </dl>
                  ) : <p className="text-sm text-muted-foreground">The backend uses the provider you selected for this request.</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => create.mutate({ requestId })} disabled={create.isPending || !online} data-testid="create-intent">
                      {create.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {create.isPending ? "Creating…" : "Create payment & run Guardian checks"}
                    </Button>
                  </div>
                  {create.error && !(create.error instanceof PaymentBlockedError) && <ErrorNote error={create.error} />}
                </CardContent>
              </Card>
              {blockedFromCreate && <GuardianPanel checks={checks} demo={demo} />}
            </>
          )}

          {/* B. Validated: guardian + request authorization */}
          {p && p.status === "VALIDATED" && (
            <>
              <GuardianPanel checks={checks} loading={guardian.isFetching} error={guardian.isError ? describePaymentError(guardian.error).message : null} demo={demo} />
              <Card>
                <CardHeader><CardTitle>Next: authorization review</CardTitle><CardDescription>The backend re-validates everything and prepares the review you will approve. Still no signature or payment.</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => authorize.mutate(p.id)} disabled={authorize.isPending || guardian.isFetching || blocked || expired || !online} data-testid="request-authorization">
                      {authorize.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />} {authorize.isPending ? "Preparing…" : "Continue to review"}
                    </Button>
                    <CancelButton p={p} confirm={confirmCancel} setConfirm={setConfirmCancel} onCancel={() => cancel.mutate(p.id)} pending={cancel.isPending} />
                  </div>
                  {blocked && <p className="text-sm text-danger">A blocked payment cannot be authorized.</p>}
                  <ErrorNote error={authorize.error instanceof PaymentBlockedError ? null : authorize.error ?? cancel.error} />
                </CardContent>
              </Card>
            </>
          )}

          {/* C. Awaiting authorization: review + wallet + approval */}
          {p && p.status === "AWAITING_SIGNATURE" && !registered && !checkout && (
            <>
              <GuardianPanel checks={checks} loading={guardian.isFetching} error={guardian.isError ? describePaymentError(guardian.error).message : null} demo={demo} />
              <Card data-testid="approval-card">
                <CardHeader><CardTitle>Approve this payment</CardTitle><CardDescription>Your wallet signs the payment itself on HSP’s secure checkout, after this step. Approving here only registers the order with HSP.</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <WalletReadiness input={{ chainId: p.chainId, tokenAddress: null, amount: p.amount, asset: p.asset }} />
                  <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--color-brand)]" checked={approved} onChange={(e) => setApproved(e.target.checked)} data-testid="approve-checkbox" />
                    <span>I reviewed the provider, recipient, <strong>{formatTokenAmount(p.amount)} {p.asset}</strong> and network, and I approve this payment. I understand my wallet will ask me to sign in the HSP checkout.</span>
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => approve.mutate(p.id)}
                      disabled={!approved || !readiness.ready || blocked || guardian.isFetching || approve.isPending || expired || !online}
                      data-testid="approve-payment"
                    >
                      {approve.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {approve.isPending ? "Registering order…" : "Approve & continue to HSP checkout"}
                    </Button>
                    <CancelButton p={p} confirm={confirmCancel} setConfirm={setConfirmCancel} onCancel={() => cancel.mutate(p.id)} pending={cancel.isPending} />
                  </div>
                  {!online && <p role="status" className="text-xs text-warning">Payments are unavailable while you are offline.</p>}
                  {!readiness.ready && <p className="text-xs text-muted-foreground">Connect your wallet and switch to the payment’s network to continue.</p>}
                  {expired && <p role="alert" className="text-sm text-danger">The authorization window has ended. Start a new payment.</p>}
                  <ErrorNote error={approve.error ?? cancel.error} />
                </CardContent>
              </Card>
            </>
          )}

          {/* D. Order registered: checkout */}
          {p && (p.status === "AWAITING_SIGNATURE" && (registered || checkout)) && (
            <Card data-testid="checkout-card" className="border-brand/40">
              <CardHeader><CardTitle>Sign in the HSP checkout</CardTitle><CardDescription>Your order is registered. Open the HSP checkout, review it, and sign with MetaMask there. PayMesh never sees your signature or keys.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-4">
                {checkout ? (
                  <>
                    <WalletReadiness input={{ chainId: p.chainId, tokenAddress: checkout.tokenAddress, amount: p.amount, asset: p.asset }} />
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-muted-foreground">Authorization method</dt><dd>{checkout.authorizationScheme ?? "Determined by HSP for this token"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Order valid until</dt><dd>{checkout.expiresAt ? new Date(checkout.expiresAt).toLocaleString() : "—"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Payment token contract</dt><dd><AddressText value={checkout.tokenAddress} chainId={p.chainId} empty="Provided by HSP" /></dd></div>
                      <div><dt className="text-xs text-muted-foreground">HSP order</dt><dd className="break-all font-mono text-xs">{checkout.paymentRequestId ?? "—"}</dd></div>
                    </dl>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button asChild data-testid="open-checkout">
                        <a href={checkout.paymentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open HSP checkout</a>
                      </Button>
                      <Button variant="outline" onClick={() => void polled.refetch()} disabled={polled.isFetching}><RefreshCw className={polled.isFetching ? "animate-spin" : ""} /> Check status</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">This page keeps checking the backend while you pay. Wallet signatures are not payments: the payment completes only after the backend verifies settlement.</p>
                  </>
                ) : signing.isError ? <ErrorNote error={signing.error} /> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading checkout link…</p>}
                <ErrorNote error={approve.error} />
              </CardContent>
            </Card>
          )}

          {/* E. Processing */}
          {p && ["SIGNED", "SUBMITTED", "PENDING"].includes(p.status) && (
            <Card data-testid="processing-card">
              <CardHeader><CardTitle>HSP settlement in progress</CardTitle><CardDescription>Your signed payment reached HSP. PayMesh verifies it with the gateway and on-chain evidence before marking it complete.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <HspProgress view={statusView} />
                {statusView?.hsp?.txHash && <p className="text-sm">Transaction: <AddressText value={statusView.hsp.txHash} chainId={p.chainId} kind="tx" /> <span className="text-xs text-muted-foreground">(reported by HSP, not yet verified)</span></p>}
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => verify.mutate(p.id)} disabled={verify.isPending || !online} data-testid="verify-payment">{verify.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify settlement now</Button>
                </div>
                <ErrorNote error={verify.error ?? (polled.isError ? polled.error : null)} />
              </CardContent>
            </Card>
          )}

          {/* F. Settled */}
          {p && p.status === "SETTLED" && (
            <Card className="border-success/40" data-testid="settled-card">
              <CardHeader><div className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success" aria-hidden="true" /><CardTitle>Payment verified</CardTitle></div><CardDescription>{demo ? "Demo sample: this is not an on-chain settlement." : "The PayMesh backend verified this settlement with HSP and on-chain evidence."}</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <Button asChild><Link href={`/payments/${p.id}/receipt`}>View receipt <ArrowRight /></Link></Button>
                <Button asChild variant="outline"><Link href={`/payments/${p.id}`}>Payment details</Link></Button>
              </CardContent>
            </Card>
          )}

          {/* G. Failed / expired / cancelled */}
          {p && failed && (
            <Card className="border-danger/40" data-testid="terminal-card">
              <CardHeader><div className="flex items-center gap-2"><AlertTriangle className="size-5 text-danger" aria-hidden="true" /><CardTitle>Payment {p.status === "FAILED" ? "failed" : p.status === "EXPIRED" ? "expired" : "cancelled"}</CardTitle></div>
                <CardDescription>{p.status === "EXPIRED" ? "The authorization window ended before payment completed." : p.status === "CANCELLED" ? "You cancelled this payment. Nothing was paid." : "The backend stopped this payment."}{p.failureReason ? ` Reason: ${p.failureReason}.` : ""}</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">If you already signed in the HSP checkout, check the payment details before starting again. Nothing is retried automatically.</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" asChild><Link href={`/payments/${p.id}`}>Payment details</Link></Button>
                  <Button onClick={() => create.mutate({ requestId, fresh: true })} disabled={create.isPending} data-testid="new-payment">{create.isPending ? <Loader2 className="animate-spin" /> : null} Start a new payment</Button>
                </div>
                <ErrorNote error={create.error instanceof PaymentBlockedError ? null : create.error} />
              </CardContent>
            </Card>
          )}
          {p && failed && create.error instanceof PaymentBlockedError && <GuardianPanel checks={checks} demo={demo} />}
        </div>

        <aside className="flex flex-col gap-6">
          {p ? (
            <>
              <Card><CardContent className="flex flex-wrap items-center gap-2 p-4"><span className="text-xs text-muted-foreground">Status</span><PaymentStatusBadge status={p.status} />{p.source === "demo" && <DemoBadge />}<Link href={`/payments/${p.id}`} className="ml-auto text-xs font-medium text-brand hover:underline">Details</Link></CardContent></Card>
              <PaymentConditions p={p} />
            </>
          ) : (
            <Card><CardHeader><CardTitle>How authorization works</CardTitle></CardHeader><CardContent><ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground"><li>The backend freezes the payment conditions and runs the Payment Guardian.</li><li>You review them and approve explicitly.</li><li>You sign in the HSP checkout with MetaMask.</li><li>PayMesh verifies settlement before showing it as paid.</li></ol></CardContent></Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function CancelButton({ p, confirm, setConfirm, onCancel, pending }: { p: PaymentRecord; confirm: boolean; setConfirm: (v: boolean) => void; onCancel: () => void; pending: boolean }) {
  if (!confirm) return <Button variant="ghost" onClick={() => setConfirm(true)} disabled={pending} data-testid="cancel-payment">Cancel payment</Button>;
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-danger/30 px-2 py-1 text-sm">
      Cancel {formatTokenAmount(p.amount)} {p.asset}?
      <Button size="sm" variant="outline" onClick={() => { setConfirm(false); onCancel(); }} disabled={pending} data-testid="confirm-cancel">Yes, cancel</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
    </span>
  );
}
