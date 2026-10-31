import type { Metadata } from "next";
import { Code2 } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";

export const metadata: Metadata = { title: "Developers" };

export default function DevelopersPage() {
  return (
    <ComingSoonPage
      title="Developers"
      description="Register your agent and integrate payments."
      icon={Code2}
      emptyTitle="Developer tools arrive in an upcoming step"
      emptyDescription="Docs and tooling for registering provider agents and accepting verified HSP payments."
      planned={["Agent registration guide", "Quotation and payment-condition API overview", "AgentRegistry on HashKey Chain", "Example integrations"]}
    />
  );
}
