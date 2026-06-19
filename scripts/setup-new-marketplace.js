/**
 * setup-new-marketplace.js
 *
 * Post-deployment setup for the new AquadexMarketplace at:
 *   0x9E9ca82766ce0B36c88aF1eDc093d4e01826BBBf
 *
 * Steps:
 *   1. Grant FIAT_RELAYER_ROLE to deployer
 *   2. Cancel Token #5 listing on old marketplace
 *   3. Approve new marketplace as operator on Manager
 *   4. List Token #5 on new marketplace
 *
 * Run: npx hardhat run scripts/setup-new-marketplace.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";

const NEW_MARKETPLACE = "0x9E9ca82766ce0B36c88aF1eDc093d4e01826BBBf";
const OLD_MARKETPLACE = "0x16168B514144e0380610b78d904a4de51ba03Ca3";
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";

async function main() {
  const conn = await network.create("baseSepolia");
  const { ethers } = conn;
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log("\n  Deployer:", deployerAddress);
  console.log("  New Marketplace:", NEW_MARKETPLACE);

  // ─── 1. Grant FIAT_RELAYER_ROLE ──────────────────────────────────────────
  console.log("\n─── 1. Granting FIAT_RELAYER_ROLE ──────────────────────────────\n");

  const marketplaceAbi = [
    "function grantRole(bytes32 role, address account) external",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function listSpecimen(uint256 tokenId, uint256 price) external",
    "function FIAT_RELAYER_ROLE() view returns (bytes32)",
  ];
  const marketplace = new ethers.Contract(NEW_MARKETPLACE, marketplaceAbi, deployer);

  const FIAT_RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FIAT_RELAYER_ROLE"));
  
  const hasRole = await marketplace.hasRole(FIAT_RELAYER_ROLE, deployerAddress);
  if (hasRole) {
    console.log("  ✅ Already has FIAT_RELAYER_ROLE");
  } else {
    const tx = await marketplace.grantRole(FIAT_RELAYER_ROLE, deployerAddress);
    await tx.wait();
    console.log("  ✅ FIAT_RELAYER_ROLE granted");
  }

  // ─── 2. Cancel old listing ───────────────────────────────────────────────
  console.log("\n─── 2. Cancelling Token #5 on old marketplace ──────────────────\n");

  const oldAbi = ["function cancelListing(uint256 tokenId) external"];
  const oldMarketplace = new ethers.Contract(OLD_MARKETPLACE, oldAbi, deployer);

  try {
    const tx = await oldMarketplace.cancelListing(5);
    await tx.wait();
    console.log("  ✅ Token #5 recovered from old marketplace");
  } catch (err) {
    console.log("  ⚠️  Cancel failed (may already own it):", err.shortMessage || err.message.substring(0, 60));
  }

  // ─── 3. Approve new marketplace ──────────────────────────────────────────
  console.log("\n─── 3. Approving new marketplace on Manager ────────────────────\n");

  const managerAbi = [
    "function setApprovalForAll(address operator, bool approved) external",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
  ];
  const manager = new ethers.Contract(MANAGER_ADDRESS, managerAbi, deployer);

  const approved = await manager.isApprovedForAll(deployerAddress, NEW_MARKETPLACE);
  if (approved) {
    console.log("  ✅ Already approved");
  } else {
    const tx = await manager.setApprovalForAll(NEW_MARKETPLACE, true);
    await tx.wait();
    console.log("  ✅ New marketplace approved as operator");
  }

  // ─── 4. List Token #5 ────────────────────────────────────────────────────
  console.log("\n─── 4. Listing Token #5 on new marketplace ─────────────────────\n");

  const owner = await manager.ownerOf(5);
  console.log(`  Token #5 owner: ${owner}`);

  if (owner.toLowerCase() === deployerAddress.toLowerCase()) {
    const price = ethers.parseEther("0.001");
    const tx = await marketplace.listSpecimen(5, price);
    await tx.wait();
    console.log("  ✅ Token #5 listed on new marketplace");
  } else if (owner.toLowerCase() === NEW_MARKETPLACE.toLowerCase()) {
    console.log("  ✅ Token #5 already held by new marketplace");
  } else {
    console.log("  ⚠️  Token #5 owned by:", owner);
    console.log("     Need to recover it first.");
  }

  console.log("\n  ✅ Setup complete! Ready for E2E test.\n");
}

main().catch((err) => {
  console.error("Setup failed:", err.shortMessage || err.message);
  process.exit(1);
});
