import { defineChain } from "viem";
import { env } from "@/lib/env";

/**
 * HashKey Chain network definitions — the ONLY place chain ids / RPC URLs live (centralized).
 * Verified settings: Testnet chain 133 → https://testnet.hsk.xyz · Mainnet chain 177 → https://mainnet.hsk.xyz
 * (also corroborated by third-party chain registries). Native currency HSK, 18 decimals.
 * Token contract addresses are intentionally NOT hardcoded: payment assets and addresses come from the backend / HSP.
 * Block-explorer URLs are NOT hardcoded either (sources disagree for testnet): set NEXT_PUBLIC_EXPLORER_URL_133/177.
 */
export const hashkeyTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz"] } },
  ...(env.explorerUrl133 ? { blockExplorers: { default: { name: "Explorer", url: env.explorerUrl133 } } } : {}),
  testnet: true,
});

export const hashkeyMainnet = defineChain({
  id: 177,
  name: "HashKey Chain",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.hsk.xyz"] } },
  ...(env.explorerUrl177 ? { blockExplorers: { default: { name: "Explorer", url: env.explorerUrl177 } } } : {}),
});

export const SUPPORTED_CHAINS = [hashkeyTestnet, hashkeyMainnet] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]["id"];

export function getChain(id: SupportedChainId) {
  return id === 177 ? hashkeyMainnet : hashkeyTestnet;
}

export function isSupportedChainId(id: number | undefined | null): id is SupportedChainId {
  return id === 133 || id === 177;
}

/** Human name for any chain id; unknown ids are labelled as such rather than guessed. */
export function chainLabel(id: number | undefined | null): string {
  if (id === 133) return hashkeyTestnet.name;
  if (id === 177) return hashkeyMainnet.name;
  return id == null ? "Unknown network" : `Unsupported network (${id})`;
}

export const isTestnetId = (id: number) => id === 133;

function explorerBase(chainId: number): string | null {
  const base = chainId === 133 ? env.explorerUrl133 : chainId === 177 ? env.explorerUrl177 : "";
  return base ? base.replace(/\/$/, "") : null;
}

/** Explorer link only when a verified base URL is configured; the path shape is the common `/tx/{hash}`. */
export function explorerTxUrl(chainId: number, hash: string | null | undefined): string | null {
  const base = explorerBase(chainId);
  return base && hash && /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${base}/tx/${hash}` : null;
}

export function explorerAddressUrl(chainId: number, address: string | null | undefined): string | null {
  const base = explorerBase(chainId);
  return base && address && /^0x[0-9a-fA-F]{40}$/.test(address) ? `${base}/address/${address}` : null;
}
