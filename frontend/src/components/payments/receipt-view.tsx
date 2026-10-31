"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, Printer, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/states";
import { PageHeader } from "@/components/layout/page-header";
import { DemoNotice } from "@/components/common/data-source-notice";
import { AddressText } from "@/components/common/address-text";
import { formatDateTime } from "@/components/common/format";
import { usePayment, useReceipt } from "@/hooks/use-payments";
import { buildReceiptDocument, downloadJson } from "@/lib/receipt";
import { formatTokenAmount } from "@/lib/decimal";
import { describePaymentError } from "@/lib/payment-errors";
import { chainLabel } from "@/lib/web3/chains";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-sm font-medium text-foreground">{children}</dd></div>;
}

export function ReceiptView({ paymentId }: { paymentId: string }) {
  const pay = usePayment(paymentId);
  const rec = useReceipt(paymentId, pay.data?.payment.status === "SETTLED");
  const back = <Button asChild variant="outline" className="print:hidden"><Link href={`/payments/${paymentId}`}><ArrowLeft /> Payment details</Link></Button>;

  if (pay.isLoading || rec.isLoading) return <div><PageHeader title="Receipt" actions={back} /><Skeleton className="h-96" aria-busy="true" /></div>;
  if (pay.isError || !pay.data) return <div><PageHeader title="Receipt" actions={back} /><Card><ErrorState title="Payment not found" message={describePaymentError(pay.error).message} onRetry={() => void pay.refetch()} /></Card></div>;
  if (rec.isError) return <div><PageHeader title="Receipt" actions={back} /><Card><ErrorState title="Could not load receipt" message={describePaymentError(rec.error).message} onRetry={() => void rec.refetch()} /></Card></div>;

  const payment = pay.data.payment;
  const receipt = rec.data;
  if (!receipt || payment.status !== "SETTLED") {
    return (
      <div><PageHeader title="Receipt" actions={back} />
        <Card><EmptyState title="No verified receipt yet" description="A receipt is issued only after the backend verifies settlement. A wallet signature or an HSP status alone is not enough." action={<Button asChild variant="outline"><Link href={`/payments/${paymentId}`}>Back to payment</Link></Button>} /></Card>
      </div>
    );
  }
  const demo = receipt.source === "demo";
  const chainId = receipt.chainId ?? payment.chainId;
  const doc = () => downloadJson(`paymesh-receipt-${receipt.reference}.json`, buildReceiptDocument(payment, receipt));

  return (
    <div>
      <PageHeader title="Payment receipt" description={demo ? "Demo sample" : "Verified settlement"} actions={<>{back}<Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer /> Print</Button><Button onClick={doc} data-testid="download-receipt" className="print:hidden"><Download /> Download</Button></>} />
      {demo && <DemoNotice className="mb-4">Demo sample receipt. It is not an on-chain settlement and carries no transaction hash.</DemoNotice>}
      <Card className="mx-auto max-w-2xl" data-testid="receipt">
        <CardHeader>
          <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-success" aria-hidden="true" /><CardTitle>{demo ? "Sample receipt" : "Verified by PayMesh"}</CardTitle></div>
          <p className="text-sm text-muted-foreground">Reference <span className="font-mono text-foreground" data-testid="receipt-reference">{receipt.reference}</span></p>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Amount"><span className="text-lg font-bold text-navy">{formatTokenAmount(receipt.verifiedAmount ?? payment.amount)} {payment.asset}</span></Row>
            <Row label="Provider">{payment.providerName}</Row>
            <Row label="Payer">{receipt.payerAddress ? <AddressText value={receipt.payerAddress} chainId={chainId} /> : "—"}</Row>
            <Row label="Receiver">{(receipt.recipient ?? payment.recipient) ? <AddressText value={receipt.recipient ?? payment.recipient} chainId={chainId} /> : "—"}</Row>
            <Row label="Network">{chainLabel(chainId)}</Row>
            <Row label="Transaction hash">{receipt.txHash ? <AddressText value={receipt.txHash} chainId={chainId} kind="tx" /> : "None (demo)"}</Row>
            {receipt.blockNumber != null && <Row label="Block">{receipt.blockNumber}</Row>}
            <Row label="Settlement status">{receipt.settlementStatus}</Row>
            <Row label="Verified at">{receipt.verifiedAt ? formatDateTime(receipt.verifiedAt) : "—"}</Row>
            <Row label="Payment ID"><code className="font-mono text-xs">{payment.id}</code></Row>
          </dl>
          {receipt.checks.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-sm font-semibold text-foreground">Verification checks</h2>
              <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Verification checks">
                {receipt.checks.map((c) => <li key={c.name} className="flex items-center gap-2 text-xs">{c.ok ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <XCircle className="size-4 text-danger" aria-hidden="true" />}{c.name.replace(/_/g, " ")}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
