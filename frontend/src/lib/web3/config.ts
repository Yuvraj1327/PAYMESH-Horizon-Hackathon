import { createConfig, http, injected } from "wagmi";
import { hashkeyMainnet, hashkeyTestnet } from "@/lib/web3/chains";

/**
 * wagmi configuration. MetaMask connects through the browser's injected EIP-1193 provider (`target: "metaMask"`,
 * no SDK or relay). The app never requests private keys: signing for payments happens in the wallet on HSP's checkout.
 * Connecting is always user-initiated (button click); nothing prompts on page load.
 */
export const wagmiConfig = createConfig({
  chains: [hashkeyTestnet, hashkeyMainnet],
  connectors: [injected({ target: "metaMask" })],
  transports: {
    [hashkeyTestnet.id]: http(),
    [hashkeyMainnet.id]: http(),
  },
  ssr: true,
});
