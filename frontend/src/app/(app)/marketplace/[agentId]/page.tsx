import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentDetailView } from "@/components/marketplace/agent-detail-view";

export const metadata: Metadata = { title: "Agent details" };

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return (
    <>
      <PageHeader title="Agent details" description="Capabilities, services, pricing and provider information." />
      <AgentDetailView agentId={agentId} />
    </>
  );
}
