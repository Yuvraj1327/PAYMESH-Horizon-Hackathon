import type { Metadata } from "next";
import { ReceiptView } from "@/components/payments/receipt-view";

export const metadata: Metadata = { title: "Payment receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return <ReceiptView paymentId={paymentId} />;
}
