"use client";

import { AlertTriangle, ArrowLeftRight, ChevronDown, Loader2, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CopyButton } from "@/components/common/copy-button";
import { useWallet } from "@/hooks/use-wallet";
import { chainLabel, hashkeyMainnet, hashkeyTestnet } from "@/lib/web3/chains";
import { shortAddress } from "@/lib/web3/address";

/** Header wallet control: connect, address + copy, balance, network, switch network, disconnect. */
export function WalletMenu() {
  const w = useWallet();

  if (!w.mounted || w.status === "disconnected" || w.status === "connecting" || w.status === "unavailable") {
    return (
      <div className="flex flex-col items-end">
        <Button
          variant="outline"
          size="sm"
          onClick={w.connect}
          disabled={w.status === "connecting"}
          className="shrink-0"
          aria-describedby={w.error ? "wallet-hint" : undefined}
        >
          {w.status === "connecting" ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Wallet />}
          <span className="hidden sm:inline">{w.status === "connecting" ? "Connecting…" : "Connect Wallet"}</span>
          <span className="sm:hidden">{w.status === "connecting" ? "…" : "Wallet"}</span>
        </Button>
        {w.error && (
          <p id="wallet-hint" role="alert" className="absolute top-14 right-4 z-30 max-w-72 rounded-lg border border-warning/40 bg-surface p-3 text-xs text-foreground shadow-pop sm:right-6">
            {w.error.message}
            <button type="button" onClick={w.clearError} className="ml-2 font-medium text-brand underline">Dismiss</button>
          </p>
        )}
      </div>
    );
  }

  const wrong = !w.supported;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex shrink-0 items-center gap-2 rounded-full border bg-surface py-1.5 pl-3 pr-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Wallet ${w.address ?? ""} connected${wrong ? ", unsupported network" : ""}`}
        data-testid="wallet-trigger"
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${wrong ? "bg-warning" : "bg-success"}`} />
        <span className="font-mono text-xs">{shortAddress(w.address)}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          <span className="block text-xs font-normal text-muted-foreground">Connected with MetaMask</span>
          <span className="mt-1 flex items-center gap-1">
            <code className="truncate font-mono text-xs text-foreground" title={w.address}>{shortAddress(w.address, 8, 6)}</code>
            {w.address && <CopyButton value={w.address} label="Copy address" />}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-1.5 px-2 py-1.5 text-xs">
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Network</span><span className="font-medium text-foreground" data-testid="wallet-network">{chainLabel(w.walletChainId)}</span></div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Balance</span>
            <span className="font-medium text-foreground" data-testid="wallet-balance">
              {wrong ? "Switch network" : w.balanceLoading ? "Loading…" : w.balanceError ? "Unavailable" : w.balance ? `${Number(w.balance.value).toFixed(4)} ${w.balance.symbol}` : "—"}
            </span>
          </div>
          <p className="text-muted-foreground">Native balance (network fees). Payment assets are shown on the payment screen.</p>
        </div>
        {wrong && (
          <p role="alert" className="mx-2 mb-1 flex gap-2 rounded-md bg-warning-bg px-2 py-1.5 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> This network is not supported. Switch to a HashKey network.</p>
        )}
        {w.error && <p role="alert" className="mx-2 mb-1 rounded-md bg-danger-bg px-2 py-1.5 text-xs text-danger">{w.error.message}</p>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Switch network</DropdownMenuLabel>
        {[hashkeyTestnet, hashkeyMainnet].map((c) => (
          <DropdownMenuItem key={c.id} disabled={w.isSwitching || w.walletChainId === c.id} onSelect={(e) => { e.preventDefault(); void w.switchNetwork(c.id); }}>
            <ArrowLeftRight /> {c.name}{w.walletChainId === c.id ? " (current)" : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void w.disconnect()}><LogOut /> Disconnect</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
