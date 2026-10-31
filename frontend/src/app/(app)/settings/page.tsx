import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { GuardianSettings } from "@/components/settings/guardian-settings";
import { ProfileCard } from "@/components/settings/profile-card";
import { WalletNetworkCard } from "@/components/settings/wallet-network-card";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Profile, wallet, network and your Payment Guardian spending policy." />
      <div className="flex flex-col gap-6">
        <ProfileCard />
        <WalletNetworkCard />
        <GuardianSettings />
      </div>
    </>
  );
}
