// Deploy AgentRegistry.
//
//   npx hardhat run scripts/deploy.js --network hskTestnet
//   CONFIRM_MAINNET_DEPLOY=I_UNDERSTAND npx hardhat run scripts/deploy.js --network hskMainnet
//
// Mainnet is refused unless CONFIRM_MAINNET_DEPLOY is set explicitly. The deployer key is read only from
// DEPLOYER_PRIVATE_KEY in this process's environment (see hardhat.config.js). Step 1 does NOT deploy to mainnet.
const hre = require("hardhat");

const EXPECTED = { hskTestnet: 133n, hskMainnet: 177n };

async function main() {
  const net = hre.network.name;
  const { chainId } = await hre.ethers.provider.getNetwork();
  if (net in EXPECTED && chainId !== EXPECTED[net]) {
    throw new Error(`Chain id mismatch: network ${net} expects ${EXPECTED[net]}, RPC reports ${chainId}`);
  }
  if (net === "hskMainnet" && process.env.CONFIRM_MAINNET_DEPLOY !== "I_UNDERSTAND") {
    throw new Error("Refusing to deploy to HashKey Chain MAINNET without CONFIRM_MAINNET_DEPLOY=I_UNDERSTAND");
  }
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer account: set DEPLOYER_PRIVATE_KEY in the environment");

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${net} (chain ${chainId})`);
  console.log(`Deployer: ${deployer.address}  balance: ${hre.ethers.formatEther(balance)} HSK`);

  const registry = await (await hre.ethers.getContractFactory("AgentRegistry")).deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log(`AgentRegistry deployed at ${address}`);
  console.log(`tx: ${registry.deploymentTransaction().hash}`);
  console.log(`\nSet in backend/.env:\n  AGENT_REGISTRY_ADDRESS=${address}\n  HSK_CHAIN_ID=${chainId}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
