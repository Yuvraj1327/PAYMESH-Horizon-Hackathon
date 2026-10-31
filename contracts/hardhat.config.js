require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Offline/sandboxed environments cannot download native solc binaries. Set HARDHAT_SOLCJS=1 to compile with the
// pure-JS `solc` npm package (same compiler version, slower) instead of fetching binaries.soliditylang.org.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (process.env.HARDHAT_SOLCJS !== "1") return runSuper();
  const pkg = require("solc/package.json");
  if (pkg.version !== args.solcVersion) {
    throw new Error(`solc npm package ${pkg.version} != configured ${args.solcVersion}`);
  }
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: args.solcVersion,
    longVersion: pkg.version,
  };
});

// Deployment keys come ONLY from the environment of the machine doing the deploy. They are never read by the
// PayMesh backend, never committed, and never exposed to any AI.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    // HashKey Chain Testnet (chain id 133)
    hskTestnet: { url: process.env.HSK_TESTNET_RPC_URL || "https://testnet.hsk.xyz", chainId: 133, accounts },
    // HashKey Chain Mainnet (chain id 177). Deployment is gated: see scripts/deploy.js
    hskMainnet: { url: process.env.HSK_MAINNET_RPC_URL || "https://mainnet.hsk.xyz", chainId: 177, accounts },
  },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};
