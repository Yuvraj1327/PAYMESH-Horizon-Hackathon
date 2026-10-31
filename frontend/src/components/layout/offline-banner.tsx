"use client";

import { ShieldAlert, WifiOff } from "lucide-react";
import { env } from "@/lib/env";
import { useOnline } from "@/hooks/use-online";

/** Shown whenever the app targets HashKey mainnet, where payments move real funds. */
export function MainnetBanner() {
  if (env.chainId !== 177) return null;
  return (
    <div role="note" data-testid="mainnet-banner" className="flex items-center gap-2 border-b border-danger/30 bg-danger-bg px-4 py-2 text-sm text-danger">
      <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
      <p><strong className="font-semibold">Mainnet.</strong> This deployment targets HashKey Chain mainnet: payments use real funds. Review every payment carefully.</p>
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" data-testid="offline-banner" className="sticky top-16 z-10 flex items-center gap-2 border-b border-warning/30 bg-warning-bg px-4 py-2 text-sm text-warning">
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <p><strong className="font-semibold">You’re offline.</strong> Payments and live data are unavailable until you reconnect. Nothing is queued or submitted automatically.</p>
    </div>
  );
}
