import { createConfig, http } from "wagmi";
import { hashkeyMainnet, hashkeyTestnet } from "@/lib/web3/chains";

/**
 * wagmi configuration (integration boundary for the MetaMask step).
 * Step 1 registers NO connectors: the app never prompts for a wallet, reads accounts or signs anything yet.
 * Step 2 adds `injected()` (MetaMask) here. Wallet signatures always happen in the user's wallet; the private key
 * never reaches this app or the backend.
 */
export const wagmiConfig = createConfig({
  chains: [hashkeyTestnet, hashkeyMainnet],
  connectors: [],
  transports: {
    [hashkeyTestnet.id]: http(),
    [hashkeyMainnet.id]: http(),
  },
  ssr: true,
});
