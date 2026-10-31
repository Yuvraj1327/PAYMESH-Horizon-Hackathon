export type WalletErrorKind = "rejected" | "unavailable" | "wrong_network" | "unsupported_network" | "rpc" | "pending" | "unknown";

export interface WalletErrorInfo { kind: WalletErrorKind; message: string }

function code(e: unknown): number | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  if (typeof c === "number") return c;
  const inner = (e as { cause?: unknown } | null)?.cause;
  return inner && inner !== e ? code(inner) : undefined;
}

function nameOf(e: unknown): string {
  return String((e as { name?: unknown } | null)?.name ?? "");
}

/** Maps wallet/RPC errors to messages a person can act on. Never exposes raw provider payloads. */
export function describeWalletError(e: unknown): WalletErrorInfo {
  const c = code(e);
  const n = nameOf(e);
  const msg = String((e as { message?: unknown } | null)?.message ?? "");
  if (c === 4001 || /UserRejected/i.test(n) || /user rejected|user denied/i.test(msg)) {
    return { kind: "rejected", message: "You declined the request in your wallet. Nothing was changed." };
  }
  if (c === -32002 || /already pending/i.test(msg)) {
    return { kind: "pending", message: "A request is already open in MetaMask. Open the extension and respond to it." };
  }
  if (/ConnectorNotFound|ProviderNotFound/i.test(n) || /provider not found|connector not found/i.test(msg)) {
    return { kind: "unavailable", message: "MetaMask was not found in this browser. Install or enable the MetaMask extension, then try again." };
  }
  if (c === 4902 || /ChainNotConfigured/i.test(n) || /unrecognized chain/i.test(msg)) {
    return { kind: "wrong_network", message: "Your wallet does not know this network yet. Approve adding it when MetaMask asks." };
  }
  if (/SwitchChain/i.test(n)) {
    return { kind: "wrong_network", message: "The network could not be switched. Switch to the HashKey network inside MetaMask and try again." };
  }
  if (/insufficient funds/i.test(msg) || /insufficient/i.test(n)) {
    return { kind: "rpc", message: "Insufficient HSK for network fees on this account." };
  }
  if (/HttpRequest|RpcRequest|timeout|network error|failed to fetch/i.test(`${n} ${msg}`) || (c !== undefined && c <= -32000 && c >= -32099)) {
    return { kind: "rpc", message: "The network (RPC) did not respond. Check your connection and try again." };
  }
  return { kind: "unknown", message: "The wallet request failed. Try again, or reconnect your wallet." };
}
