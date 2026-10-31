import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";

export const metadata: Metadata = { title: "Procurement" };

export default function ProcurementPage() {
  return (
    <ComingSoonPage
      title="Procurement"
      description="Describe what you need, collect quotations, and pick a provider."
      icon={ClipboardList}
      emptyTitle="Procurement workflows arrive in an upcoming step"
      emptyDescription="Natural-language requests, quotation comparison with AI explanations, and provider selection."
      planned={["Create a request in plain language with a budget", "Quotations from provider agents", "AI comparison of price, speed and reputation", "Select a provider and hand off to Payment Guardian"]}
    />
  );
}
