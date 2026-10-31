"use client";

import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Placeholder only. It deliberately does not call wagmi connectors, request accounts or sign anything.
 * `aria-disabled` (not `disabled`) keeps it focusable so the tooltip is reachable by keyboard users.
 */
export function WalletButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
          className="shrink-0 cursor-not-allowed text-muted-foreground hover:bg-surface"
        >
          <Wallet />
          <span className="hidden sm:inline">Connect Wallet</span>
          <span className="sm:hidden">Wallet</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>MetaMask connection arrives in a later step. No wallet is requested yet.</TooltipContent>
    </Tooltip>
  );
}
