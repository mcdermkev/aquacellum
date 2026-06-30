/**
 * Aquadex Protocol — AquadexCompanion (Echo) Deployment
 *
 * Deploys the soulbound Echo companion NFT contract.
 * Constructor arg: _relayer address (deployer acts as initial relayer)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-companion.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";
import { writeFileSync, readFileSync } from "fs";

// Deployer / initial relayer
const KEVIN = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Deploy AquadexCompanion (Echo Soulbound NFT)     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const conn = await network.create("baseSepolia");
  const { ethers } = conn;

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log("  Deployer:", deployerAddress);

  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log("  Balance:", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.error("❌  Deployer wallet has 0 ETH. Get Base Sepolia testnet ETH.");
    process.exit(1);
  }

  // ─── Deploy AquadexCompanion ─────────────────────────────────────────
  console.log("📦  Deploying AquadexCompanion...");
  console.log(`    Relayer: ${KEVIN} (deployer — initial relayer)\n`);

  const CompanionFactory = await ethers.getContractFactory("AquadexCompanion");
  const companion = await CompanionFactory.deploy(KEVIN);
  await companion.waitForDeployment();
  const companionAddress = await companion.getAddress();

  console.log(`  ✅  AquadexCompanion deployed → ${companionAddress}`);
  console.log(`      TX: ${companion.deploymentTransaction().hash}\n`);

  // ─── Update deployed-addresses-sepolia.json ──────────────────────────
  let existing = {};
  try {
    existing = JSON.parse(readFileSync("deployed-addresses-sepolia.json", "utf8"));
  } catch {
    // File doesn't exist or is malformed — start fresh
  }

  existing.contracts = existing.contracts || {};
  existing.contracts.AquadexCompanion = companionAddress;
  existing.companionDeployedAt = new Date().toISOString();

  writeFileSync("deployed-addresses-sepolia.json", JSON.stringify(existing, null, 2));
  console.log("  📄  Address saved → deployed-addresses-sepolia.json");

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log("\n=============================================================");
  console.log("  ✅  ECHO COMPANION DEPLOYMENT COMPLETE");
  console.log("=============================================================");
  console.log(`  AquadexCompanion : ${companionAddress}`);
  console.log(`  Relayer          : ${KEVIN}`);
  console.log(`  Network          : Base Sepolia (Chain ID: 84532)`);
  console.log("-------------------------------------------------------------");
  console.log("  🔍  View on BaseScan:");
  console.log(`      → https://sepolia.basescan.org/address/${companionAddress}`);
  console.log("-------------------------------------------------------------");
  console.log("  📋  Next steps:");
  console.log("      1. Copy ABI from artifacts to frontend/src/abi/");
  console.log(`      2. Add VITE_COMPANION_ADDRESS=${companionAddress} to .env`);
  console.log("      3. Verify on BaseScan:");
  console.log(`         npx hardhat verify --network baseSepolia ${companionAddress} ${KEVIN}`);
  console.log("=============================================================\n");
}

main().catch((error) => {
  console.error("\n❌  Deployment failed:", error);
  process.exitCode = 1;
});
