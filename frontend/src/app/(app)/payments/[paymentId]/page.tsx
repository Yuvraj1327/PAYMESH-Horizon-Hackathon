import type { Metadata } from "next";
import { PaymentDetailView } from "@/components/payments/payment-detail-view";

export const metadata: Metadata = { title: "Payment details" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return <PaymentDetailView paymentId={paymentId} />;
}
