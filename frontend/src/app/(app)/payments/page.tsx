import type { Metadata } from "next";
import { PaymentsDashboard } from "@/components/payments/payments-dashboard";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return <PaymentsDashboard />;
}
