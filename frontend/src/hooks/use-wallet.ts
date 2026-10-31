"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { formatUnits } from "viem";
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { env } from "@/lib/env";
import { isSupportedChainId, type SupportedChainId } from "@/lib/web3/chains";
import { describeWalletError, type WalletErrorInfo } from "@/lib/web3/errors";

/** True after hydration; wallet state is only rendered client-side to avoid server/client mismatches. */
const noopSubscribe = () => () => {};
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected";

/**
 * Single wallet hook for the app: connect / disconnect / switch network, with human-readable errors.
 * Account and chain changes are picked up automatically (wagmi subscribes to `accountsChanged` / `chainChanged`).
 * The hook never signs, sends or reads anything beyond the address, chain id and native balance.
 */
export function useWallet() {
  const mounted = useMounted();
  const conn = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connectAsync, isPending: isConnecting } = useConnect();
  const { mutateAsync: disconnectAsync } = useDisconnect();
  const { mutateAsync: switchAsync, isPending: isSwitching } = useSwitchChain();
  const [error, setError] = useState<WalletErrorInfo | null>(null);
  const [providerFound, setProviderFound] = useState<boolean | null>(null);

  const connector = connectors[0];
  useEffect(() => {
    let live = true;
    Promise.resolve(connector ? connector.getProvider() : undefined)
      .then((p) => { if (live) setProviderFound(!!p); })
      .catch(() => { if (live) setProviderFound(false); });
    return () => { live = false; };
  }, [connector]);

  const connected = mounted && conn.status === "connected" && !!conn.address;
  const walletChainId = connected ? conn.chainId : undefined;
  const supported = isSupportedChainId(walletChainId);
  const targetChainId = env.chainId as SupportedChainId;

  const balance = useBalance({
    address: connected ? conn.address : undefined,
    chainId: supported ? walletChainId : undefined,
    query: { enabled: connected && supported, refetchInterval: 30_000 },
  });

  const connect = useCallback(async () => {
    setError(null);
    if (!connector) { setError(describeWalletError({ name: "ConnectorNotFoundError" })); return; }
    try {
      await connectAsync({ connector });
    } catch (e) {
      setError(describeWalletError(e));
    }
  }, [connector, connectAsync]);

  const disconnect = useCallback(async () => {
    setError(null);
    try { await disconnectAsync(); } catch (e) { setError(describeWalletError(e)); }
  }, [disconnectAsync]);

  const switchNetwork = useCallback(async (chainId: SupportedChainId) => {
    setError(null);
    try { await switchAsync({ chainId }); } catch (e) { setError(describeWalletError(e)); }
  }, [switchAsync]);

  const status: WalletStatus = !mounted ? "disconnected"
    : connected ? "connected"
    : isConnecting || conn.status === "connecting" || conn.status === "reconnecting" ? "connecting"
    : providerFound === false ? "unavailable" : "disconnected";

  return {
    mounted, status, address: connected ? conn.address : undefined,
    walletChainId, supported, onTargetNetwork: connected && walletChainId === targetChainId, targetChainId,
    balance: balance.data ? { value: formatUnits(balance.data.value, balance.data.decimals), symbol: balance.data.symbol } : null,
    balanceLoading: balance.isLoading, balanceError: balance.isError,
    isSwitching, error, clearError: () => setError(null),
    connect, disconnect, switchNetwork,
  };
}
