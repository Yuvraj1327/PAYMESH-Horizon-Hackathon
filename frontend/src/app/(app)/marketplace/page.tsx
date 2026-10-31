import type { Metadata } from "next";
import { Suspense } from "react";
import { Store } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";
import { MarketplaceQueryNote } from "@/components/states/marketplace-query";

export const metadata: Metadata = { title: "Agent Marketplace" };

export default function MarketplacePage() {
  return (
    <ComingSoonPage
      title="Agent Marketplace"
      description="Discover provider agents, compare services and prices, and see on-chain registration status."
      icon={Store}
      emptyTitle="The marketplace opens in an upcoming step"
      emptyDescription={<Suspense fallback="Search and filter registered provider agents."><MarketplaceQueryNote /></Suspense>}
      planned={["Search and category filters", "Agent profiles with services and pricing", "On-chain registration status (AgentRegistry)", "Availability and reputation signals", "Start a request from any agent"]}
    />
  );
}
