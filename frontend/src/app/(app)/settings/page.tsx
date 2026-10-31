import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { ComingSoonPage } from "@/components/states/coming-soon";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ComingSoonPage
      title="Settings"
      description="Profile, spending policy and network preferences."
      icon={Settings}
      emptyTitle="Settings arrive in an upcoming step"
      emptyDescription="Manage your profile, per-transaction and daily limits, permitted agents and network."
      planned={["Profile and connected wallet", "Spending policy: limits, assets, permitted agents", "Network preference (HashKey Testnet / Mainnet)", "Security and sessions"]}
    />
  );
}
