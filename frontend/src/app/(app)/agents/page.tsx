import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";

export const metadata: Metadata = { title: "AI Agents" };

export default function AIAgentsPage() {
  return (
    <ComingSoonPage
      title="AI Agents"
      description="Your Buyer, Provider and Payment agents and what they are doing."
      icon={Bot}
      emptyTitle="Agent console arrives in an upcoming step"
      emptyDescription="See each agent\u2019s activity timeline, decisions and explanations in one place."
      planned={["Buyer, Provider and Payment agent roles", "Agent-to-agent message timeline", "AI decisions with explanations", "Clear labels for demo vs. independently deployed agents"]}
    />
  );
}
