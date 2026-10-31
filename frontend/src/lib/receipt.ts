import type { PaymentRecord, Receipt } from "@/types/payment";

/** The downloadable receipt: only fields the backend verified. A receipt for a payment that is not SETTLED is refused. */
export function buildReceiptDocument(payment: PaymentRecord, receipt: Receipt) {
  if (payment.status !== "SETTLED") throw new Error("A receipt exists only for payments the backend has verified as settled.");
  return {
    kind: receipt.source === "demo" ? "paymesh.demo-receipt" : "paymesh.receipt",
    notice: receipt.source === "demo" ? "DEMO SAMPLE: not an on-chain settlement." : "Verified by the PayMesh backend against HSP and chain evidence.",
    reference: receipt.reference, paymentId: payment.id, procurementRequestId: payment.requestId,
    provider: payment.providerName, payer: receipt.payerAddress, recipient: receipt.recipient ?? payment.recipient,
    amount: receipt.verifiedAmount ?? payment.amount, asset: payment.asset, chainId: receipt.chainId ?? payment.chainId,
    tokenAddress: receipt.tokenAddress, transactionHash: receipt.txHash, blockNumber: receipt.blockNumber,
    settlementStatus: receipt.settlementStatus, verifiedAt: receipt.verifiedAt, issuedAt: receipt.createdAt,
    verificationChecks: receipt.checks,
  };
}

export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
