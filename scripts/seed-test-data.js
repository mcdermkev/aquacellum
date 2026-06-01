/**
 * seed-test-data.js
 * Creates test tanks, mints specimens, and creates marketplace listings
 * for end-to-end testing on Base Sepolia.
 * 
 * Usage: npx hardhat run scripts/seed-test-data.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const connection = await network.connect();
  const { ethers } = connection;

  const signers = await ethers.getSigners();
  const curator = signers[0];
  console.log(`Curator/Breeder wallet: ${curator.address}`);

  const balance = await ethers.provider.getBalance(curator.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Load deployed addresses
  const deployed = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "deployed-addresses-sepolia.json"), "utf8")
  );
  const managerAddress = deployed.contracts.AquadexManager;
  const marketplaceAddress = deployed.contracts.AquadexMarketplace;

  // Load ABIs from artifacts
  const managerArtifact = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "artifacts", "contracts", "AquadexManager.sol", "AquadexManager.json"), "utf8")
  );
  const marketplaceArtifact = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "artifacts", "contracts", "AquadexMarketplace.sol", "AquadexMarketplace.json"), "utf8")
  );

  const manager = new ethers.Contract(managerAddress, managerArtifact.abi, curator);
  const marketplace = new ethers.Contract(marketplaceAddress, marketplaceArtifact.abi, curator);

  console.log(`AquadexManager: ${managerAddress}`);
  console.log(`AquadexMarketplace: ${marketplaceAddress}\n`);

  // =========================================================================
  // 1. Register Test Tanks
  // =========================================================================
  console.log("=== REGISTERING TANKS ===\n");

  const tanks = [
    { name: "Living Room Display", type: 0, volume: 200, containment: 0, facility: "Home", room: "Living Room", rack: "Stand A" },
    { name: "Breeding Rack Unit 1", type: 0, volume: 80, containment: 0, facility: "Home", room: "Fish Room", rack: "Rack 1" },
    { name: "Quarantine Tub", type: 0, volume: 40, containment: 1, facility: "Home", room: "Fish Room", rack: "Floor" },
  ];

  const tankIds = [];
  for (const tank of tanks) {
    try {
      console.log(`  Registering: "${tank.name}" (${tank.volume}L ${tank.facility}/${tank.room})`);
      const tx = await manager["registerTank(string,uint8,uint32,uint8,uint256,string,string,string)"](
        tank.name,
        tank.type,
        tank.volume,
        tank.containment,
        0, // parentUnitId (no parent)
        tank.facility,
        tank.room,
        tank.rack
      );
      const receipt = await tx.wait();
      // Parse the TankRegistered event to get the tank ID
      const event = receipt.logs.find(l => l.fragment && l.fragment.name === "TankRegistered");
      const tankId = event ? Number(event.args[0]) : tankIds.length + 1;
      tankIds.push(tankId);
      console.log(`  ✅ Tank #${tankId} registered | TX: ${receipt.hash}\n`);
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}\n`);
      tankIds.push(tankIds.length + 1); // estimate
    }
  }

  // =========================================================================
  // 2. Mint Test Specimens
  // =========================================================================
  console.log("\n=== MINTING SPECIMENS ===\n");

  const specimens = [
    { speciesId: 1, name: "Convict Cichlid", tankIdx: 0, sireId: 0, damId: 0 },
    { speciesId: 1, name: "Convict Cichlid", tankIdx: 0, sireId: 0, damId: 0 },
    { speciesId: 3, name: "Betta", tankIdx: 1, sireId: 0, damId: 0 },
    { speciesId: 12, name: "Neon Tetra", tankIdx: 0, sireId: 0, damId: 0 },
    { speciesId: 12, name: "Neon Tetra", tankIdx: 0, sireId: 0, damId: 0 },
    { speciesId: 12, name: "Neon Tetra", tankIdx: 0, sireId: 0, damId: 0 },
    { speciesId: 14, name: "Guppy", tankIdx: 1, sireId: 0, damId: 0 },
    { speciesId: 14, name: "Guppy", tankIdx: 1, sireId: 0, damId: 0 },
    { speciesId: 4, name: "Common Goldfish", tankIdx: 2, sireId: 0, damId: 0 },
    { speciesId: 17, name: "Freshwater Angelfish", tankIdx: 0, sireId: 0, damId: 0 },
  ];

  const specimenIds = [];
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < specimens.length; i++) {
    const spec = specimens[i];
    const tankId = tankIds[spec.tankIdx] || 1;
    const birthTimestamp = now - (86400 * (30 + i * 7)); // stagger birth dates

    try {
      console.log(`  [${i+1}/${specimens.length}] Minting: ${spec.name} → Tank #${tankId}`);
      const tx = await manager.mintSpecimen(
        spec.speciesId,
        birthTimestamp,
        curator.address, // breeder
        tankId,
        spec.sireId,
        spec.damId,
        "" // ipfsMetadataUri (empty for now)
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment && l.fragment.name === "SpecimenRegistered");
      const specimenId = event ? Number(event.args[0]) : i + 1;
      specimenIds.push(specimenId);
      console.log(`  ✅ Specimen #${specimenId} minted | TX: ${receipt.hash}\n`);
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}\n`);
      specimenIds.push(i + 1);
    }
  }

  // =========================================================================
  // 3. Create Marketplace Listings
  // =========================================================================
  console.log("\n=== CREATING MARKETPLACE LISTINGS ===\n");

  // First, approve the marketplace to transfer our specimens
  console.log("  Approving marketplace for all specimens...");
  try {
    const tx = await manager.setApprovalForAll(marketplaceAddress, true);
    await tx.wait();
    console.log("  ✅ Marketplace approved for all transfers\n");
    await new Promise(r => setTimeout(r, 1500));
  } catch (err) {
    console.error(`  ❌ Approval failed: ${err.message}\n`);
  }

  // List some specimens
  const listings = [
    { specimenIdx: 3, price: "0.001" },  // Neon Tetra #1
    { specimenIdx: 4, price: "0.001" },  // Neon Tetra #2
    { specimenIdx: 6, price: "0.002" },  // Guppy #1
    { specimenIdx: 9, price: "0.005" },  // Angelfish
  ];

  for (const listing of listings) {
    const tokenId = specimenIds[listing.specimenIdx];
    const priceWei = ethers.parseEther(listing.price);

    try {
      console.log(`  Listing Specimen #${tokenId} for ${listing.price} ETH`);
      const tx = await marketplace.listSpecimen(tokenId, priceWei);
      const receipt = await tx.wait();
      console.log(`  ✅ Listed | TX: ${receipt.hash}\n`);
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}\n`);
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n========================================");
  console.log("TEST DATA SEEDING COMPLETE!");
  console.log("========================================");
  console.log(`  Tanks registered: ${tankIds.length}`);
  console.log(`  Specimens minted: ${specimenIds.length}`);
  console.log(`  Listings created: ${listings.length}`);
  console.log(`\n  Tank IDs: ${tankIds.join(", ")}`);
  console.log(`  Specimen IDs: ${specimenIds.join(", ")}`);
  console.log("========================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
