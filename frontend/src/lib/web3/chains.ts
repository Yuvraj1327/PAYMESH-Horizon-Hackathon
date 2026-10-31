import { defineChain } from "viem";

/**
 * HashKey Chain network definitions (chain ids and RPC URLs per the official configuration).
 * Block-explorer URLs and token contract addresses are intentionally NOT hardcoded here: payment assets and
 * addresses come from the backend / HSP documentation, never from guesses in the UI.
 */
export const hashkeyTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz"] } },
  testnet: true,
});

export const hashkeyMainnet = defineChain({
  id: 177,
  name: "HashKey Chain",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.hsk.xyz"] } },
});

export const SUPPORTED_CHAINS = [hashkeyTestnet, hashkeyMainnet] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]["id"];

export function getChain(id: SupportedChainId) {
  return id === 177 ? hashkeyMainnet : hashkeyTestnet;
}
