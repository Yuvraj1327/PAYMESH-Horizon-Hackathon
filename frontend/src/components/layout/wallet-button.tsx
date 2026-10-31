"use client";

import { WalletMenu } from "@/components/wallet/wallet-menu";

/** Header wallet control (MetaMask). Connecting is always an explicit user action. */
export function WalletButton() {
  return <WalletMenu />;
}
