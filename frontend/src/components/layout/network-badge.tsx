"use client";

import { env } from "@/lib/env";
import { getChain } from "@/lib/web3/chains";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function NetworkBadge() {
  const chain = getChain(env.chainId);
  const testnet = env.chainId === 133;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-2 py-1.5 text-xs font-medium text-foreground sm:gap-2 sm:px-3"
          aria-label={`Network: ${chain.name}, chain ${chain.id}`}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", testnet ? "bg-teal" : "bg-brand")} />
          <span className="sm:hidden">{testnet ? "Testnet" : "Mainnet"}</span>
          <span className="hidden sm:inline">{testnet ? "HashKey Testnet" : "HashKey Mainnet"}</span>
          <span className="hidden text-muted-foreground 2xl:inline">· {chain.id}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        The app targets {chain.name} (chain {chain.id}). Your wallet’s network is checked once wallet connection is enabled.
      </TooltipContent>
    </Tooltip>
  );
}
