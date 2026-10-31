// Pre-deployment checklist for AgentRegistry. READ-ONLY: sends no transaction.
//
//   npx hardhat run scripts/preflight.js --network hskTestnet
//   npx hardhat run scripts/preflight.js --network hskMainnet
//
// Prints everything a reviewer should sign off before `deploy.js` is run (network, chain id, deployer + balance,
// gas price, SHA-256 of the Solidity source, keccak of the compiled runtime bytecode) and exits non-zero on a problem.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");

const EXPECTED = { hskTestnet: 133n, hskMainnet: 177n, hardhat: 31337n, localhost: 31337n };

async function main() {
  const problems = [];
  const net = hre.network.name;
  const { chainId } = await hre.ethers.provider.getNetwork();
  const block = await hre.ethers.provider.getBlockNumber();
  console.log(`network      : ${net}`);
  console.log(`chain id     : ${chainId} (expected ${EXPECTED[net] ?? "n/a"})`);
  console.log(`latest block : ${block}`);
  if (EXPECTED[net] !== undefined && chainId !== EXPECTED[net]) problems.push("RPC chain id does not match the selected network");

  const signers = await hre.ethers.getSigners();
  if (!signers.length) problems.push("no deployer: set DEPLOYER_PRIVATE_KEY in your shell environment");
  else {
    const bal = await hre.ethers.provider.getBalance(signers[0].address);
    const fee = await hre.ethers.provider.getFeeData();
    console.log(`deployer     : ${signers[0].address}`);
    console.log(`balance      : ${hre.ethers.formatEther(bal)} HSK (native gas token; NOT a payment asset)`);
    console.log(`gas price    : ${fee.gasPrice ?? "unknown"}`);
    if (bal === 0n) problems.push("deployer has no HSK for gas");
  }

  const src = path.join(__dirname, "../contracts/AgentRegistry.sol");
  const art = path.join(__dirname, "../artifacts/contracts/AgentRegistry.sol/AgentRegistry.json");
  console.log(`source sha256: ${crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex")}`);
  if (!fs.existsSync(art)) problems.push("not compiled: run `npm run compile` (and `npm test`) first");
  else {
    const a = JSON.parse(fs.readFileSync(art, "utf8"));
    console.log(`runtime keccak: ${hre.ethers.keccak256(a.deployedBytecode)}`);
  }
  if (net === "hskMainnet") {
    console.log("\nMAINNET: deploy.js additionally requires CONFIRM_MAINNET_DEPLOY=I_UNDERSTAND. Review the above, run the tests, ");
    console.log("and obtain explicit approval for this exact source hash before deploying.");
  }
  if (problems.length) {
    console.error("\nPREFLIGHT FAILED:\n - " + problems.join("\n - "));
    process.exitCode = 1;
  } else console.log("\nPREFLIGHT OK");
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
