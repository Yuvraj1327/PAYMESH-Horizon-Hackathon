import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AgentConsole } from "@/components/agents/agent-console";

export const metadata: Metadata = { title: "AI Agents" };

export default function AgentsPage() {
  return (
    <>
      <PageHeader title="AI Agents" description="The three agent roles that run your procurement and payments — and what each is doing." />
      <AgentConsole />
    </>
  );
}
