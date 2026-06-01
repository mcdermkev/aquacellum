/**
 * Aquadex Protocol — Base Sepolia Deployment Orchestrator
 *
 * Deployment order:
 *   1. AquadexManager  (inherits AquadexStorage; curator hardcoded to Kevin's wallet)
 *   2. AquadexMarketplace  (wired to Manager; fee split configured for testnet)
 *
 * Fee distribution (testnet):
 *   • 65% Operations  → Kevin's wallet (testnet holding environment)
 *   • 35% Co-Founders → Kevin (slot 1) + Steve (slot 2) + Kevin (slot 3 placeholder)
 *
 * Note: AquadexGovernance is intentionally excluded from this launch phase.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-base-sepolia.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";

// ---------------------------------------------------------------------------
// Wallet addresses — testnet configuration
// ---------------------------------------------------------------------------
const KEVIN   = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934"; // Deployer / Curator / Ops holding
const STEVE   = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0"; // Co-Founder slot 2
// Co-Founder slot 3 points back to Kevin for testnet (placeholder until third founder wallet confirmed)
const CO_FOUNDER_SLOT3 = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";

// For the testnet, both treasury buckets (marine conservation + ecosystem) are
// consolidated into Kevin's wallet as the operations holding environment.
const MARINE_CONSERVATION_TREASURY = KEVIN;
const ECOSYSTEM_TREASURY           = KEVIN;

// ---------------------------------------------------------------------------

async function main() {
  // Hardhat v3: ethers is accessed via network.create()
  const conn = await network.create("baseSepolia");
  const { ethers } = conn;

  // Resolve the deployer signer from the private key in .env
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log("=============================================================");
  console.log("  Aquadex Protocol — Base Sepolia Deployment");
  console.log("=============================================================");
  console.log(`  Network      : baseSepolia`);
  console.log(`  Deployer     : ${deployerAddress}`);
  console.log(`  Curator      : ${KEVIN}  (hardcoded in AquadexStorage)`);

  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log(`  ETH Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("-------------------------------------------------------------\n");

  if (balance === 0n) {
    console.error("❌  Deployer wallet has 0 ETH. Get Base Sepolia testnet ETH from:");
    console.error("    https://www.coinbase.com/faucet");
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Step 1 — Deploy AquadexManager
  // (AquadexStorage is inherited; curator is hardcoded to Kevin inside Storage constructor)
  // -------------------------------------------------------------------------
  console.log("📦  [1/2] Deploying AquadexManager...");
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddress = await manager.getAddress();
  console.log(`    ✅  AquadexManager deployed → ${managerAddress}`);

  // -------------------------------------------------------------------------
  // Step 2 — Deploy AquadexMarketplace
  // Constructor args wire the fee distribution to testnet addresses.
  // -------------------------------------------------------------------------
  console.log("\n📦  [2/2] Deploying AquadexMarketplace...");
  console.log("    Fee split configuration:");
  console.log(`      marineConservationTreasury → ${MARINE_CONSERVATION_TREASURY}  (Kevin — ops holding)`);
  console.log(`      ecosystemTreasury          → ${ECOSYSTEM_TREASURY}  (Kevin — ops holding)`);
  console.log(`      kevin  (founder slot 1)    → ${KEVIN}`);
  console.log(`      steve  (founder slot 2)    → ${STEVE}`);
  console.log(`      coFounder (slot 3)         → ${CO_FOUNDER_SLOT3}  (Kevin placeholder)`);

  const AquadexMarketplace = await ethers.getContractFactory("AquadexMarketplace");
  const marketplace = await AquadexMarketplace.deploy(
    managerAddress,
    MARINE_CONSERVATION_TREASURY,
    ECOSYSTEM_TREASURY,
    KEVIN,
    STEVE,
    CO_FOUNDER_SLOT3
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log(`    ✅  AquadexMarketplace deployed → ${marketplaceAddress}`);

  // -------------------------------------------------------------------------
  // Deployment summary
  // -------------------------------------------------------------------------
  console.log("\n=============================================================");
  console.log("  ✅  DEPLOYMENT COMPLETE");
  console.log("=============================================================");
  console.log(`  AquadexManager     : ${managerAddress}`);
  console.log(`  AquadexMarketplace : ${marketplaceAddress}`);
  console.log(`  Curator (Kevin)    : ${KEVIN}`);
  console.log(`  Network            : Base Sepolia (Chain ID: 84532)`);
  console.log("-------------------------------------------------------------");
  console.log("  🔍  View on BaseScan:");
  console.log(`      Manager     → https://sepolia.basescan.org/address/${managerAddress}`);
  console.log(`      Marketplace → https://sepolia.basescan.org/address/${marketplaceAddress}`);
  console.log("-------------------------------------------------------------");
  console.log("  📋  Next steps:");
  console.log("      1. Copy the addresses above into your frontend config.");
  console.log("      2. Run contract verification (optional):");
  console.log(`         npx hardhat verify --network baseSepolia ${managerAddress}`);
  console.log(`         npx hardhat verify --network baseSepolia ${marketplaceAddress} \\`);
  console.log(`           ${managerAddress} \\`);
  console.log(`           ${MARINE_CONSERVATION_TREASURY} \\`);
  console.log(`           ${ECOSYSTEM_TREASURY} \\`);
  console.log(`           ${KEVIN} \\`);
  console.log(`           ${STEVE} \\`);
  console.log(`           ${CO_FOUNDER_SLOT3}`);
  console.log("=============================================================\n");

  // -------------------------------------------------------------------------
  // Write deployed addresses to a JSON file for frontend Phase 4 pickup
  // -------------------------------------------------------------------------
  const { writeFileSync } = await import("fs");
  const deploymentOutput = {
    network: "baseSepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      AquadexManager: managerAddress,
      AquadexMarketplace: marketplaceAddress,
    },
    roles: {
      curator: KEVIN,
      marineConservationTreasury: MARINE_CONSERVATION_TREASURY,
      ecosystemTreasury: ECOSYSTEM_TREASURY,
      kevin: KEVIN,
      steve: STEVE,
      coFounder: CO_FOUNDER_SLOT3,
    },
  };

  writeFileSync(
    "deployed-addresses-sepolia.json",
    JSON.stringify(deploymentOutput, null, 2)
  );
  console.log("  📄  Addresses saved → deployed-addresses-sepolia.json");
}

main().catch((error) => {
  console.error("\n❌  Deployment failed:", error);
  process.exitCode = 1;
});
