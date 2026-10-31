import { WifiOff } from "lucide-react";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        icon={WifiOff}
        title="You’re offline"
        description="PayMesh needs a connection to show payments and agent activity. Nothing sensitive is stored on this device. Reconnect and try again."
      />
    </main>
  );
}
