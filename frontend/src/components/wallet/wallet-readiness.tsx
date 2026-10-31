"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { erc20Abi, formatUnits, isAddress } from "viem";
import { useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { chainLabel, isSupportedChainId } from "@/lib/web3/chains";
import { sameAddress, shortAddress } from "@/lib/web3/address";
import { cmp } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface ReadinessInput {
  chainId: number;
  /** The payer wallet the backend has on file for this user (if any). */
  expectedPayer?: string | null;
  /** ERC-20 address supplied by the BACKEND (never hardcoded here). Enables a balance check. */
  tokenAddress?: string | null;
  amount: string;
  asset: string;
}

type ItemState = "ok" | "warn" | "todo";
interface Item { id: string; label: string; detail: string; state: ItemState; action?: React.ReactNode }

/**
 * Pre-flight for the wallet step. Only "connected" and "on the payment's network" gate the Approve button (the HSP
 * checkout needs both). Everything else is advice. None of this is payment-policy enforcement; the backend does that.
 */
export function useWalletReadiness(input: ReadinessInput) {
  const w = useWallet();
  const connected = w.status === "connected";
  const tokenOk = !!input.tokenAddress && isAddress(input.tokenAddress) && isSupportedChainId(input.chainId);
  const enabled = connected && w.walletChainId === input.chainId && tokenOk;
  const bal = useReadContract({ address: input.tokenAddress as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [w.address as `0x${string}`], chainId: input.chainId as 133 | 177, query: { enabled: enabled && !!w.address } });
  const dec = useReadContract({ address: input.tokenAddress as `0x${string}`, abi: erc20Abi, functionName: "decimals", chainId: input.chainId as 133 | 177, query: { enabled } });

  const items: Item[] = [];
  items.push(connected
    ? { id: "connected", label: "Wallet connected", state: "ok", detail: shortAddress(w.address, 8, 6) }
    : { id: "connected", label: "Connect your wallet", state: "todo", detail: w.status === "unavailable" ? "MetaMask was not found in this browser." : "Connect MetaMask so you can sign in the HSP checkout.", action: w.status === "unavailable" ? undefined : <Button size="sm" variant="outline" onClick={w.connect} disabled={w.status === "connecting"}>{w.status === "connecting" ? <Loader2 className="animate-spin" /> : null} Connect wallet</Button> });

  if (connected) {
    const right = w.walletChainId === input.chainId;
    items.push(right
      ? { id: "network", label: "Correct network", state: "ok", detail: chainLabel(input.chainId) }
      : { id: "network", label: `Switch to ${chainLabel(input.chainId)}`, state: "todo", detail: `Your wallet is on ${chainLabel(w.walletChainId)}. This payment settles on ${chainLabel(input.chainId)}.`,
          action: isSupportedChainId(input.chainId) ? <Button size="sm" variant="outline" onClick={() => void w.switchNetwork(input.chainId as 133 | 177)} disabled={w.isSwitching}>{w.isSwitching ? <Loader2 className="animate-spin" /> : null} Switch network</Button> : undefined });

    if (input.expectedPayer) {
      items.push(sameAddress(input.expectedPayer, w.address)
        ? { id: "payer", label: "Matches your registered payer wallet", state: "ok", detail: shortAddress(input.expectedPayer, 8, 6) }
        : { id: "payer", label: "Different from your registered wallet", state: "warn", detail: `The backend has ${shortAddress(input.expectedPayer, 8, 6)} on file. Paying from another account may fail verification.` });
    }
    if (right) {
      if (w.balance && Number(w.balance.value) === 0) items.push({ id: "gas", label: "No HSK for network fees", state: "warn", detail: "This account holds no HSK. The HSP checkout may need some for fees." });
      if (tokenOk && bal.data !== undefined && dec.data !== undefined) {
        const have = formatUnits(bal.data, dec.data);
        const enough = cmp(have.includes(".") ? have : `${have}.0`, input.amount) >= 0;
        items.push(enough
          ? { id: "asset", label: `${input.asset} balance sufficient`, state: "ok", detail: `${have} ${input.asset} available` }
          : { id: "asset", label: `Low ${input.asset} balance`, state: "warn", detail: `${have} ${input.asset} available; this payment needs ${input.amount}.` });
      }
    }
  }
  const ready = connected && w.walletChainId === input.chainId;
  return { items, ready, error: w.error, clearError: w.clearError };
}

export function WalletReadiness({ input }: { input: ReadinessInput }) {
  const r = useWalletReadiness(input);
  return (
    <div data-testid="wallet-readiness">
      <ul className="divide-y rounded-lg border" aria-label="Wallet readiness">
        {r.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-item={i.id} data-state={i.state}>
            {i.state === "ok" ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" /> : i.state === "warn" ? <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden="true" /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground">{i.label}</p><p className={cn("text-xs", i.state === "warn" ? "text-warning" : "text-muted-foreground")}>{i.detail}</p></div>
            {i.action}
          </li>
        ))}
      </ul>
      {r.error && <p role="alert" className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{r.error.message} <button type="button" className="ml-1 font-medium underline" onClick={r.clearError}>Dismiss</button></p>}
    </div>
  );
}
