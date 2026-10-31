import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <ComingSoonPage
      title="Payments"
      description="Review Payment Guardian checks, authorize with your wallet, and follow HSP status."
      icon={CreditCard}
      emptyTitle="Payments arrive in an upcoming step"
      emptyDescription="Spending-policy checks, wallet authorization and live payment status."
      planned={["Payment Guardian summary before you sign", "Authorize in MetaMask via the HSP checkout", "Live HSP status: submitted, processing, finalized", "Settlement is shown as paid only after independent verification"]}
      note="Payment authorization always happens in your wallet. This app never handles private keys."
    />
  );
}
