// scripts/seed-additional-data.js
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const managerAddress = process.env.MANAGER_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const managerAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "abi", "AquadexManager.json"), "utf8")
  );

  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();
  const breeder = signers[1]; // Signer index 1 is Breeder

  console.log("--- Seeding Mock Specimens and Spawn Logs ---");
  console.log(`Using Breeder address: ${breeder.address}`);

  const manager = new ethers.Contract(managerAddress, managerAbi, breeder);

  // 1. Mint specimens for Neon Tetra (speciesId = 1)
  console.log("\nMinting specimens for Neon Tetra (Species ID 1)...");
  let tx = await manager.mintSpecimen(
    1, // speciesId
    Math.round(Date.now() / 1000) - 86400 * 30, // 30 days old
    breeder.address, // breeder
    0, // currentTankId (None)
    0, 0, // sire, dam
    "ipfs://bafybeifishpic1"
  );
  await tx.wait();
  console.log("- Minted Specimen #1 for Neon Tetra");

  tx = await manager.mintSpecimen(
    1, // speciesId
    Math.round(Date.now() / 1000) - 86400 * 60, // 60 days old
    breeder.address, // breeder
    0, // currentTankId (None)
    0, 0, // sire, dam
    "ipfs://bafybeifishpic2"
  );
  await tx.wait();
  console.log("- Minted Specimen #2 for Neon Tetra");

  // 2. Mint specimen for Discus (speciesId = 3)
  console.log("\nMinting specimen for Discus (Species ID 3)...");
  tx = await manager.mintSpecimen(
    3, // speciesId
    Math.round(Date.now() / 1000) - 86400 * 15, // 15 days old
    breeder.address, // breeder
    0, // currentTankId (None)
    0, 0, // sire, dam
    "ipfs://bafybeifishpic3"
  );
  await tx.wait();
  console.log("- Minted Specimen #3 for Discus");

  // 3. Log Spawn Events
  console.log("\nLogging Spawn Events...");
  
  // Neon Tetra spawn log 1
  tx = await manager.logSpawnEvent(
    1, // speciesId
    90, // eggCount
    "bafybeihusbandrynotes1" // IPFS notes hash
  );
  await tx.wait();
  console.log("- Logged Neon Tetra spawn log: 90 eggs");

  // Neon Tetra spawn log 2
  tx = await manager.logSpawnEvent(
    1, // speciesId
    140, // eggCount
    "bafybeihusbandrynotes2" // IPFS notes hash
  );
  await tx.wait();
  console.log("- Logged Neon Tetra spawn log: 140 eggs");

  // Discus spawn log 1
  tx = await manager.logSpawnEvent(
    3, // speciesId
    220, // eggCount
    "bafybeihusbandrynotes3" // IPFS notes hash
  );
  await tx.wait();
  console.log("- Logged Discus spawn log: 220 eggs");

  // 4. Create Batch Listings on Marketplace
  console.log("\nCreating Batch Listings on Marketplace...");
  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS || "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1";
  const marketplaceAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "abi", "AquadexMarketplace.json"), "utf8")
  );
  const marketplace = new ethers.Contract(marketplaceAddress, marketplaceAbi, breeder);

  tx = await marketplace.createBatchListing(
    1, // spawnId
    50, // quantity
    ethers.parseEther("0.005") // pricePerFish
  );
  await tx.wait();
  console.log("- Created Batch Listing #1 for Neon Tetra spawn log #1 (50 available @ 0.005 ETH)");

  tx = await marketplace.createBatchListing(
    2, // spawnId
    100, // quantity
    ethers.parseEther("0.006") // pricePerFish
  );
  await tx.wait();
  console.log("- Created Batch Listing #2 for Neon Tetra spawn log #2 (100 available @ 0.006 ETH)");

  tx = await marketplace.createBatchListing(
    3, // spawnId
    120, // quantity
    ethers.parseEther("0.02") // pricePerFish
  );
  await tx.wait();
  console.log("- Created Batch Listing #3 for Discus spawn log #1 (120 available @ 0.02 ETH)");

  console.log("\n--- Mock Data Seeding Complete ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
