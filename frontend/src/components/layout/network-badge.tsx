"use client";

import { useWallet } from "@/hooks/use-wallet";
import { chainLabel, getChain, isTestnetId } from "@/lib/web3/chains";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Shows the connected wallet's network, or the app's target network while no wallet is connected. */
export function NetworkBadge() {
  const w = useWallet();
  const target = getChain(w.targetChainId);
  const walletConnected = w.status === "connected";
  const shownId = walletConnected ? w.walletChainId : target.id;
  const unsupported = walletConnected && !w.supported;
  const mismatch = walletConnected && w.supported && !w.onTargetNetwork;
  const testnet = shownId != null && isTestnetId(shownId);
  const name = unsupported ? "Unsupported network" : chainLabel(shownId);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="network-badge"
          className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-2 py-1.5 text-xs font-medium text-foreground sm:gap-2 sm:px-3", (unsupported || mismatch) && "border-warning/50 bg-warning-bg/50")}
          aria-label={`Network: ${name}`}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", unsupported || mismatch ? "bg-warning" : testnet ? "bg-teal" : "bg-brand")} />
          <span className="sm:hidden">{unsupported ? "Wrong net" : testnet ? "Testnet" : "Mainnet"}</span>
          <span className="hidden sm:inline">{name.replace("HashKey Chain", "HashKey")}</span>
          {shownId != null && !unsupported && <span className="hidden text-muted-foreground 2xl:inline">· {shownId}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {!walletConnected && `The app targets ${target.name} (chain ${target.id}). Connect a wallet to check your network.`}
        {unsupported && "Your wallet is on a network PayMesh does not support. Use the wallet menu to switch to a HashKey network."}
        {mismatch && `Your wallet is on ${name}, but the app targets ${target.name}. Payments use the network of the payment itself.`}
        {walletConnected && w.onTargetNetwork && `Connected to ${name}.`}
      </TooltipContent>
    </Tooltip>
  );
}
