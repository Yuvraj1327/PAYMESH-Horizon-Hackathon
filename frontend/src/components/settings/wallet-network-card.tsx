"use client";

import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressText } from "@/components/common/address-text";
import { useWallet } from "@/hooks/use-wallet";
import { chainLabel, getChain } from "@/lib/web3/chains";

export function WalletNetworkCard() {
  const w = useWallet();
  const target = getChain(w.targetChainId);
  return (
    <Card id="wallet">
      <CardHeader><div className="flex items-center gap-2"><Wallet className="size-5 text-brand" aria-hidden="true" /><CardTitle>Wallet & network</CardTitle></div><CardDescription>PayMesh connects to MetaMask only when you ask, and never sees your keys.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Wallet</dt><dd className="mt-0.5">{w.status === "connected" ? <AddressText value={w.address} chainId={w.walletChainId} /> : <span className="text-muted-foreground">Not connected</span>}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Wallet network</dt><dd className="mt-0.5 font-medium">{w.status === "connected" ? chainLabel(w.walletChainId) : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">App target network</dt><dd className="mt-0.5 font-medium">{target.name} ({target.id})</dd></div>
          <div><dt className="text-xs text-muted-foreground">Native balance</dt><dd className="mt-0.5 font-medium">{w.balance ? `${Number(w.balance.value).toFixed(4)} ${w.balance.symbol}` : "—"}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {w.status !== "connected" ? <Button variant="outline" size="sm" onClick={w.connect} disabled={w.status === "connecting" || w.status === "unavailable"}>{w.status === "unavailable" ? "MetaMask not found" : "Connect wallet"}</Button>
            : <>
              {!w.onTargetNetwork && <Button variant="outline" size="sm" onClick={() => void w.switchNetwork(w.targetChainId)} disabled={w.isSwitching}>Switch to {target.name}</Button>}
              <Button variant="ghost" size="sm" onClick={() => void w.disconnect()}>Disconnect</Button>
            </>}
        </div>
        {w.error && <p role="alert" className="text-sm text-danger">{w.error.message}</p>}
      </CardContent>
    </Card>
  );
}
