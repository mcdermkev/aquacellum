/**
 * deploy-marketplace-v2.js
 *
 * Deploys the updated AquadexMarketplace contract with fiat settlement functions.
 * Then sets up all necessary roles and re-lists Token #5 for the E2E test.
 *
 * Steps:
 *   1. Deploy new AquadexMarketplace
 *   2. Grant FIAT_RELAYER_ROLE to the deployer/relayer wallet
 *   3. Approve the new marketplace on AquadexManager (so it can transfer NFTs)
 *   4. Transfer Token #5 from old marketplace escrow back to seller (cancel old listing)
 *   5. List Token #5 on the new marketplace
 *
 * Run: npx hardhat run scripts/deploy-marketplace-v2.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";
import { writeFileSync } from "fs";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Deploy Marketplace v2 (Fiat Settlement)         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Hardhat v3: ethers via network connection
  const conn = await network.create("baseSepolia");
  const { ethers } = conn;

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  
  console.log("  Deployer:", deployerAddress);
  
  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log("  Balance:", ethers.formatEther(balance), "ETH\n");

  // ─── Existing addresses ──────────────────────────────────────────────────
  const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
  const OLD_MARKETPLACE = "0x16168B514144e0380610b78d904a4de51ba03Ca3";

  // Constructor args (same as original deployment)
  const kevin = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";
  const steve = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0";
  const coFounder = kevin; // Testnet: kevin holds coFounder slot

  // Treasury addresses (testnet: all point to kevin)
  const marineConservationTreasury = kevin;
  const ecosystemTreasury = kevin;

  // ─── 1. Deploy new AquadexMarketplace ────────────────────────────────────
  console.log("─── 1. Deploying AquadexMarketplace v2 ────────────────────────\n");

  const MarketplaceFactory = await ethers.getContractFactory("AquadexMarketplace");
  
  const marketplace = await MarketplaceFactory.deploy(
    MANAGER_ADDRESS,
    marineConservationTreasury,
    ecosystemTreasury,
    kevin,
    steve,
    coFounder
  );

  await marketplace.waitForDeployment();
  const newMarketplaceAddress = await marketplace.getAddress();
  
  console.log(`  ✅ New Marketplace deployed: ${newMarketplaceAddress}`);
  console.log(`     TX: ${marketplace.deploymentTransaction().hash}\n`);

  // ─── 2. Grant FIAT_RELAYER_ROLE ──────────────────────────────────────────
  console.log("─── 2. Granting FIAT_RELAYER_ROLE to deployer ──────────────────\n");

  const FIAT_RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FIAT_RELAYER_ROLE"));
  
  const grantTx = await marketplace.grantRole(FIAT_RELAYER_ROLE, deployerAddress);
  await grantTx.wait();
  console.log("  ✅ FIAT_RELAYER_ROLE granted to", deployerAddress);

  // ─── 3. Cancel listing on OLD marketplace (get Token #5 back) ────────────
  console.log("\n─── 3. Recovering Token #5 from old marketplace ────────────────\n");

  const oldMarketplaceAbi = ["function cancelListing(uint256 tokenId) external"];
  const oldMarketplace = new ethers.Contract(OLD_MARKETPLACE, oldMarketplaceAbi, deployer);
  
  try {
    const cancelTx = await oldMarketplace.cancelListing(5);
    await cancelTx.wait();
    console.log("  ✅ Token #5 listing cancelled on old marketplace (returned to seller)");
  } catch (err) {
    console.log("  ⚠️  Could not cancel old listing:", err.message.substring(0, 80));
    console.log("     (May already be cancelled or old contract doesn't support this)");
  }

  // ─── 4. Approve new marketplace on AquadexManager ────────────────────────
  console.log("\n─── 4. Approving new marketplace on AquadexManager ─────────────\n");

  const managerAbi = [
    "function setApprovalForAll(address operator, bool approved) external",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "function ownerOf(uint256 tokenId) view returns (address)",
  ];
  const manager = new ethers.Contract(MANAGER_ADDRESS, managerAbi, deployer);

  const approveTx = await manager.setApprovalForAll(newMarketplaceAddress, true);
  await approveTx.wait();
  console.log("  ✅ Marketplace approved as operator on AquadexManager");

  // ─── 5. List Token #5 on new marketplace ─────────────────────────────────
  console.log("\n─── 5. Listing Token #5 on new marketplace ─────────────────────\n");

  // Check we own the token
  const owner = await manager.ownerOf(5);
  console.log(`  Token #5 owner: ${owner}`);
  
  if (owner.toLowerCase() !== deployerAddress.toLowerCase()) {
    console.log("  ⚠️  We don't own Token #5 — skipping listing.");
    console.log("     You'll need to list manually once you recover it.");
  } else {
    // Price in wei — set to 0.001 ETH (irrelevant for fiat, just for on-chain record)
    const price = ethers.parseEther("0.001");
    const listTx = await marketplace.listSpecimen(5, price);
    await listTx.wait();
    console.log("  ✅ Token #5 listed at 0.001 ETH (fiat price determined off-chain)");
  }

  // ─── 6. Save addresses ───────────────────────────────────────────────────
  console.log("\n─── 6. Saving deployment info ──────────────────────────────────\n");

  const deploymentInfo = {
    network: "baseSepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      AquadexManager: MANAGER_ADDRESS,
      AquadexMarketplace: newMarketplaceAddress,
      AquadexMarketplace_OLD: OLD_MARKETPLACE,
    },
    roles: {
      curator: kevin,
      marineConservationTreasury: kevin,
      ecosystemTreasury: kevin,
      kevin: kevin,
      steve: steve,
      coFounder: kevin,
    },
  };

  writeFileSync(
    "deployed-addresses-sepolia.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("  ✅ Written to deployed-addresses-sepolia.json");

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("");
  console.log(`  New Marketplace: ${newMarketplaceAddress}`);
  console.log(`  Old Marketplace: ${OLD_MARKETPLACE} (deprecated)`);
  console.log(`  Manager:         ${MANAGER_ADDRESS} (unchanged)`);
  console.log("");
  console.log("  Next steps:");
  console.log("  - Update MARKETPLACE_ADDRESS in Vercel env vars");
  console.log("  - Update frontend/.env MARKETPLACE_ADDRESS");
  console.log("  - Redeploy to Vercel");
  console.log("  - Run settle-fiat-direct.js to test");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
