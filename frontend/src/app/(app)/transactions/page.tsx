import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";

export const metadata: Metadata = { title: "Transactions" };

export default function TransactionsPage() {
  return (
    <ComingSoonPage
      title="Transactions"
      description="Payment history and verified receipts."
      icon={Receipt}
      emptyTitle="Transaction history arrives in an upcoming step"
      emptyDescription="A searchable ledger of payments with verified receipts and audit events."
      planned={["Payment history with status filters", "Verified receipts with chain and transaction details", "Audit trail of each payment\u2019s lifecycle", "Export for your records"]}
      note="Only settlements verified by the backend will be listed as completed."
    />
  );
}
