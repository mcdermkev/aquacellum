// scripts/seed-rich-dev-mode.js
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getNextSpawnLogId(manager) {
  let id = 1;
  while (true) {
    const log = await manager.spawnLogs(id);
    if (log.breeder === "0x0000000000000000000000000000000000000000") {
      return id;
    }
    id++;
  }
}

async function main() {
  const managerAddress = process.env.MANAGER_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

  const managerAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "abi", "AquadexManager.json"), "utf8")
  );
  const marketplaceAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "abi", "AquadexMarketplace.json"), "utf8")
  );

  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();

  // Test Accounts
  const [owner, breeder, buyer, breeder2, treasury] = signers;

  console.log("--- Seeding Rich Development Data ---");
  console.log(`Owner/Curator: ${owner.address}`);
  console.log(`Breeder 1:     ${breeder.address}`);
  console.log(`Buyer:         ${buyer.address}`);
  console.log(`Breeder 2:     ${breeder2.address}`);
  console.log(`Treasury:      ${treasury.address}`);

  // Connect contracts for each signer
  const managerOwner = new ethers.Contract(managerAddress, managerAbi, owner);
  const managerBreeder = new ethers.Contract(managerAddress, managerAbi, breeder);
  const managerBuyer = new ethers.Contract(managerAddress, managerAbi, buyer);
  const managerBreeder2 = new ethers.Contract(managerAddress, managerAbi, breeder2);

  const marketplaceOwner = new ethers.Contract(marketplaceAddress, marketplaceAbi, owner);
  const marketplaceBreeder = new ethers.Contract(marketplaceAddress, marketplaceAbi, breeder);
  const marketplaceBuyer = new ethers.Contract(marketplaceAddress, marketplaceAbi, buyer);
  const marketplaceBreeder2 = new ethers.Contract(marketplaceAddress, marketplaceAbi, breeder2);

  // ==========================================
  // 1. REGISTER TANKS
  // ==========================================
  console.log("\n--- 1. Registering Containment Systems (Tanks & Baskets) ---");

  // Owner child basket (parent ID: 1)
  const ownerBasketId = Number(await managerOwner.nextTankId());
  console.log(`Registering Breeder Basket under Owner's Tank 1 (expected ID: ${ownerBasketId})...`);
  let tx = await managerOwner.registerTank(
    "Egg Isolation Basket 10L",
    0, // Freshwater
    10, // 10 Liters
    2, // ContainmentType.Basket
    1, // Parent Unit ID: 1
    "Main Room",
    "Rack A",
    "Shelf 1"
  );
  await tx.wait();
  console.log(`- Registered Egg Isolation Basket 10L (ID: ${ownerBasketId}, parent: 1) for Owner`);

  // Breeder 1 Tanks
  const breederTubId = Number(await managerBreeder.nextTankId());
  console.log(`Registering Breeder 1 Tub (expected ID: ${breederTubId})...`);
  tx = await managerBreeder.registerTank(
    "Breeder Spawning Tub 300L",
    0, // Freshwater
    300, // 300 Liters
    1, // ContainmentType.Tub
    0, // No parent
    "Breeding Garage",
    "Rack G1",
    "Row 1"
  );
  await tx.wait();
  console.log(`- Registered Breeder Spawning Tub 300L (ID: ${breederTubId}) for Breeder 1`);

  const breederBasketId = Number(await managerBreeder.nextTankId());
  console.log(`Registering Breeder 1 Basket (expected ID: ${breederBasketId})...`);
  tx = await managerBreeder.registerTank(
    "Neon Tetra Fry grow-out Basket",
    0, // Freshwater
    20, // 20 Liters
    2, // ContainmentType.Basket
    breederTubId, // Parent Unit ID
    "Breeding Garage",
    "Rack G1",
    "Row 1"
  );
  await tx.wait();
  console.log(`- Registered Neon Tetra Fry grow-out Basket (ID: ${breederBasketId}, parent: ${breederTubId}) for Breeder 1`);

  // Buyer Tanks
  const buyerTankId = Number(await managerBuyer.nextTankId());
  console.log(`Registering Buyer Tank (expected ID: ${buyerTankId})...`);
  tx = await managerBuyer.registerTank(
    "Hobbyist Show Tank 200L",
    0, // Freshwater
    200, // 200 Liters
    0, // ContainmentType.Tank
    0, // No parent
    "Living Room",
    "Display Stand",
    "Cabinet A"
  );
  await tx.wait();
  console.log(`- Registered Hobbyist Show Tank 200L (ID: ${buyerTankId}) for Buyer`);

  // Breeder 2 Tanks
  const breeder2TankId = Number(await managerBreeder2.nextTankId());
  console.log(`Registering Breeder 2 Tank (expected ID: ${breeder2TankId})...`);
  tx = await managerBreeder2.registerTank(
    "Nano Planted Guppy Tank 40L",
    0, // Freshwater
    40, // 40 Liters
    0, // ContainmentType.Tank
    0, // No parent
    "Home Office",
    "Desk Rack",
    "Right Shelf"
  );
  await tx.wait();
  console.log(`- Registered Nano Planted Guppy Tank 40L (ID: ${breeder2TankId}) for Breeder 2`);


  // ==========================================
  // 2. MINT SPECIMENS
  // ==========================================
  console.log("\n--- 2. Minting Specimen Tokens ---");

  // Breeder 1 mints: Neon Tetra (speciesId = 1) and Discus (speciesId = 3)
  console.log("Minting specimens for Breeder 1...");
  
  const breederNeonId = Number(await managerBreeder.totalSpecimensMinted()) + 1;
  tx = await managerBreeder.mintSpecimen(
    1, // Neon Tetra
    Math.round(Date.now() / 1000) - 86400 * 45, // 45 days old
    breeder.address,
    breederTubId, // placed in Breeder Spawning Tub
    0, 0, // no parents
    "ipfs://bafybeifishpicneonbreeder"
  );
  await tx.wait();
  console.log(`- Breeder 1 minted Neon Tetra Specimen #${breederNeonId} in Tank ${breederTubId}`);

  const breederDiscusId = Number(await managerBreeder.totalSpecimensMinted()) + 1;
  tx = await managerBreeder.mintSpecimen(
    3, // Discus
    Math.round(Date.now() / 1000) - 86400 * 90, // 90 days old
    breeder.address,
    breederTubId, // placed in Breeder Spawning Tub
    0, 0, // no parents
    "ipfs://bafybeifishpicdiscusbreeder"
  );
  await tx.wait();
  console.log(`- Breeder 1 minted Discus Specimen #${breederDiscusId} in Tank ${breederTubId}`);

  // Owner mints: Convict Cichlid (speciesId = 4) and Guppy (speciesId = 7)
  console.log("Minting specimens for Owner...");
  
  const ownerConvictId = Number(await managerOwner.totalSpecimensMinted()) + 1;
  tx = await managerOwner.mintSpecimen(
    4, // Convict cichlid
    Math.round(Date.now() / 1000) - 86400 * 60,
    owner.address,
    1, // Tank ID: 1
    0, 0,
    "ipfs://bafybeifishpicconvict"
  );
  await tx.wait();
  console.log(`- Owner minted Convict Cichlid Specimen #${ownerConvictId} in Tank 1`);

  const ownerGuppyId = Number(await managerOwner.totalSpecimensMinted()) + 1;
  tx = await managerOwner.mintSpecimen(
    7, // Guppy
    Math.round(Date.now() / 1000) - 86400 * 10,
    owner.address,
    ownerBasketId, // Basket ID
    0, 0,
    "ipfs://bafybeifishpicguppyowner"
  );
  await tx.wait();
  console.log(`- Owner minted Guppy Specimen #${ownerGuppyId} in Basket ${ownerBasketId}`);

  // Breeder 2 mints: Guppy (speciesId = 7)
  console.log("Minting specimens for Breeder 2...");
  
  const breeder2GuppyId = Number(await managerBreeder2.totalSpecimensMinted()) + 1;
  tx = await managerBreeder2.mintSpecimen(
    7, // Guppy
    Math.round(Date.now() / 1000) - 86400 * 30,
    breeder2.address,
    breeder2TankId, // Tank ID
    0, 0,
    "ipfs://bafybeifishpicguppybreeder2"
  );
  await tx.wait();
  console.log(`- Breeder 2 minted Guppy Specimen #${breeder2GuppyId} in Tank ${breeder2TankId}`);


  // ==========================================
  // 3. LOG WATER PARAMETERS
  // ==========================================
  console.log("\n--- 3. Logging Water Parameters (Testing Health Alerts) ---");

  // Owner Tank 1 - Healthy/Ideal parameters
  console.log("Logging IDEAL parameters for Owner's Tank 1...");
  tx = await managerOwner.logWaterParameters(
    1, // Tank ID
    245, // 24.5 C (Scaled x10)
    72,  // 7.2 pH (Scaled x10)
    10000, // 1.0000 SG (Scaled x10000)
    0,   // 0.00 ppm Ammonia (Scaled x100)
    0,   // 0.00 ppm Nitrite
    500, // 5.00 ppm Nitrate (Scaled x100)
    "Weekly parameters logged. All systems stable, clear fresh biotope."
  );
  await tx.wait();
  console.log("- Logged healthy parameters for Tank 1");

  // Breeder Spawning Tub ID - Elevated parameters to trigger red warning/health alerts!
  console.log(`Logging ALERT parameters for Breeder's Spawning Tub ${breederTubId}...`);
  tx = await managerBreeder.logWaterParameters(
    breederTubId, // Tank ID
    282, // 28.2 C
    61,  // 6.1 pH
    10000,
    15,  // 0.15 ppm Ammonia (Scaled x100) -> WARNING (> 0.05)
    8,   // 0.08 ppm Nitrite (Scaled x100)   -> WARNING (> 0.05)
    3500, // 35.00 ppm Nitrate (Scaled x100) -> WARNING (> 20.0)
    "Spawning tub has high nitrogen load. Requires immediate 30% water change and filter clean."
  );
  await tx.wait();
  console.log(`- Logged elevated warning parameters for Tank ${breederTubId} (Health Alert simulation)`);


  // ==========================================
  // 4. LOG SPAWN EVENTS & MARKETPLACE BATCHES
  // ==========================================
  console.log("\n--- 4. Logging Spawn Events and Creating Batch Listings ---");

  // Breeder 1 logs spawn event and lists batch
  const breederSpawnId = await getNextSpawnLogId(managerBreeder);
  console.log(`Breeder 1 spawn logging and batch listing (expected spawnId: ${breederSpawnId})...`);
  tx = await managerBreeder.logSpawnEvent(
    1, // Neon Tetra
    150, // eggCount
    "bafybeihusbandrynotesneonbreeder"
  );
  await tx.wait();
  console.log(`- Breeder 1 logged Neon Tetra Spawn #${breederSpawnId} with 150 eggs`);

  tx = await marketplaceBreeder.createBatchListing(
    breederSpawnId,
    120, // 120 available fry
    ethers.parseEther("0.004") // 0.004 ETH per fry
  );
  await tx.wait();
  const breederBatchListingId = Number(await marketplaceBreeder.spawnToListing(breederSpawnId));
  console.log(`- Created Batch Listing #${breederBatchListingId} for Neon Tetra Spawn #${breederSpawnId} (120 juveniles @ 0.004 ETH)`);

  // Breeder 2 logs spawn event and lists batch
  const breeder2SpawnId = await getNextSpawnLogId(managerBreeder2);
  console.log(`Breeder 2 spawn logging and batch listing (expected spawnId: ${breeder2SpawnId})...`);
  tx = await managerBreeder2.logSpawnEvent(
    7, // Guppy
    95,
    "bafybeihusbandrynotesguppybreeder2"
  );
  await tx.wait();
  console.log(`- Breeder 2 logged Guppy Spawn #${breeder2SpawnId} with 95 fry`);

  tx = await marketplaceBreeder2.createBatchListing(
    breeder2SpawnId,
    80, // 80 available fry
    ethers.parseEther("0.002") // 0.002 ETH per fry
  );
  await tx.wait();
  const breeder2BatchListingId = Number(await marketplaceBreeder2.spawnToListing(breeder2SpawnId));
  console.log(`- Created Batch Listing #${breeder2BatchListingId} for Guppy Spawn #${breeder2SpawnId} (80 juveniles @ 0.002 ETH)`);


  // ==========================================
  // 5. LIST INDIVIDUAL SPECIMENS
  // ==========================================
  console.log("\n--- 5. Creating Individual Specimen Listings ---");

  // Standard P2P Listing: Owner lists Convict Cichlid
  console.log(`Owner listing Specimen #${ownerConvictId} (Convict Cichlid) - Standard P2P...`);
  tx = await managerOwner.approve(marketplaceAddress, ownerConvictId);
  await tx.wait();
  tx = await marketplaceOwner.listSpecimen(ownerConvictId, ethers.parseEther("0.02"));
  await tx.wait();
  console.log(`- Listed Specimen #${ownerConvictId} on Marketplace for 0.02 ETH`);

  // Shipping-Enabled Listing: Breeder 1 lists Discus
  console.log(`Breeder 1 listing Specimen #${breederDiscusId} (Discus) - Shipping Enabled...`);
  tx = await managerBreeder.approve(marketplaceAddress, breederDiscusId);
  await tx.wait();
  tx = await marketplaceBreeder.createShippingListing(
    breederDiscusId,
    ethers.parseEther("0.08"), // price: 0.08 ETH
    ethers.parseEther("0.01")  // shippingFee: 0.01 ETH
  );
  await tx.wait();
  console.log(`- Created Shipping Listing for Specimen #${breederDiscusId} (Discus) for 0.08 ETH + 0.01 ETH shipping`);


  // ==========================================
  // 6. ESCROW PURCHASES & FULFILLMENTS
  // ==========================================
  console.log("\n--- 6. Creating Active Escrow Fulfillments ---");

  // Shipping batch purchase: Buyer purchases 20 Neon Tetras from Breeder 1's batch
  console.log(`Buyer purchasing 20 Neon Tetras via Shipping batch purchase from Listing #${breederBatchListingId}...`);
  tx = await marketplaceBuyer.purchaseBatch(
    breederBatchListingId,
    20, // Quantity
    { value: ethers.parseEther("0.08") } // 20 * 0.004 = 0.08 ETH
  );
  await tx.wait();
  console.log(`- Buyer purchased 20 Neon Tetras. Locked in Escrow Purchase (Fulfillment: Shipping)`);

  // In-Person PIN purchase: Buyer purchases 30 Guppies from Breeder 2's batch
  console.log(`Buyer purchasing 30 Guppies via In-Person PIN handshake purchase from Listing #${breeder2BatchListingId}...`);
  tx = await marketplaceBuyer.purchaseInPerson(
    breeder2BatchListingId,
    30, // Quantity
    "4321", // PIN
    { value: ethers.parseEther("0.06") } // 30 * 0.002 = 0.06 ETH
  );
  await tx.wait();
  console.log(`- Buyer purchased 30 Guppies. Locked in Escrow Purchase (Fulfillment: In-Person, PIN: 4321)`);

  // Shipping Specimen purchase: Buyer purchases Breeder 1's Discus listing
  console.log(`Buyer purchasing Breeder 1's Discus Specimen #${breederDiscusId} (Shipping Escrow)...`);
  tx = await marketplaceBuyer.purchaseShippingListing(
    breederDiscusId,
    { value: ethers.parseEther("0.09") } // subtotal 0.08 + shipping 0.01 = 0.09 ETH
  );
  await tx.wait();
  console.log(`- Buyer purchased Discus Specimen #${breederDiscusId}. Escrow status set to LOCKED.`);

  // Breeder 1 dispatches shipment, registering tracking code and starting the 3-day safety window
  console.log(`Breeder 1 dispatching Discus Specimen #${breederDiscusId} shipment...`);
  tx = await marketplaceBreeder.dispatchShipping(
    breederDiscusId,
    "USPS-PRIORITY-FISH-998822"
  );
  await tx.wait();
  console.log(`- Breeder 1 dispatched Discus shipment. Tracking number: USPS-PRIORITY-FISH-998822. Status: DISPATCHED.`);

  console.log("\n--- Rich Dev Seeding Complete ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
