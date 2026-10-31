import type { Metadata } from "next";
import { PaymentReviewView } from "@/components/payments/payment-review-view";

export const metadata: Metadata = { title: "Payment review" };

export default async function PayPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <PaymentReviewView requestId={requestId} />;
}
