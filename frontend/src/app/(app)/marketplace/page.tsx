import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { MarketplaceView } from "@/components/marketplace/marketplace-view";
import { AgentGridSkeleton } from "@/components/marketplace/agent-grid-skeleton";

export const metadata: Metadata = { title: "Agent Marketplace" };

export default function MarketplacePage() {
  return (
    <>
      <PageHeader title="Agent Marketplace" description="Discover provider agents, compare services and prices, then hire one through a procurement request." />
      {/* useSearchParams requires a Suspense boundary; the shell stays static. */}
      <Suspense fallback={<AgentGridSkeleton />}><MarketplaceView /></Suspense>
    </>
  );
}
