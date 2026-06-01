import { network } from "hardhat";

async function main() {
  const connection = await network.create();
  const { ethers } = connection;
  const [owner] = await ethers.getSigners();

  console.log("Deploying AquadexManager...");
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const address = await manager.getAddress();
  console.log("AquadexManager deployed to:", address);

  // 1. Add a species
  console.log("\n--- Testing Master Catalog Curation ---");
  let tx = await manager.addSpecies(
    "Paracheirodon innesi",
    "Neon Tetra",
    "ipfs://bafybeiccanonicaltetrainfo",
    0, // CareLevel.Easy
    220, // 22.0 C
    265, // 26.5 C
    60, // 6.0 pH
    75  // 7.5 pH
  );
  await tx.wait();
  console.log("Species added!");

  tx = await manager.addSpecies(
    "Amphiprion ocellaris",
    "Ocellaris Clownfish",
    "ipfs://bafybeiccanonicalclownfishinfo",
    1, // CareLevel.Medium
    240, 270, 81, 84
  );
  await tx.wait();
  console.log("Second species added!");

  const species = await manager.speciesCatalog(1);
  console.log("Species 1 Scientific Name:", species.scientificName, "| Common Name:", species.commonName);

  // 2. Register Tanks
  console.log("\n--- Testing Tank Registry ---");
  tx = await manager.registerTank("Show Tank 200L", 0, 200); // Freshwater, 200L
  await tx.wait();
  tx = await manager.registerTank("Breeding Cubes", 0, 40); // Freshwater, 40L
  await tx.wait();
  console.log("Tanks registered!");

  const tank1 = await manager.tanks(1);
  console.log("Tank 1 Name:", tank1.name, "| Owner:", tank1.owner);

  // 3. Mint Specimens
  console.log("\n--- Testing Specimen Minting ---");
  tx = await manager.mintSpecimen(1, 0, owner.address, 1, 0, 0, "ipfs://sire-tetra");
  await tx.wait();
  tx = await manager.mintSpecimen(1, 0, owner.address, 1, 0, 0, "ipfs://dam-tetra");
  await tx.wait();
  tx = await manager.mintSpecimen(1, 0, owner.address, 1, 0, 0, "ipfs://independent-tetra");
  await tx.wait();
  console.log("Specimens minted!");

  // Helper function to read specimen arrays
  async function getTankSpecimens(tankId) {
    const specs = [];
    let idx = 0;
    while (true) {
      try {
        const specId = await manager.tankSpecimenIds(tankId, idx);
        specs.push(Number(specId));
        idx++;
      } catch (e) {
        break; // Out of bounds reached
      }
    }
    return specs;
  }

  let tank1Specs = await getTankSpecimens(1);
  console.log("Tank 1 Specimen IDs before move (expected [1, 2, 3]):", tank1Specs);

  // 4. Move specimen and test O(1) swap-and-pop
  console.log("\n--- Testing O(1) Swap-and-Pop Move ---");
  // Move specimen 2 (Dam) to Tank 2
  tx = await manager.moveSpecimenToTank(2, 2);
  await tx.wait();
  console.log("Specimen 2 moved to Tank 2!");

  let tank1SpecsAfter = await getTankSpecimens(1);
  let tank2SpecsAfter = await getTankSpecimens(2);
  console.log("Tank 1 Specimen IDs after move (expected [1, 3]):", tank1SpecsAfter);
  console.log("Tank 2 Specimen IDs after move (expected [2]):", tank2SpecsAfter);

  // Verify index maps
  const idx1 = await manager.specimenTankIndex(1);
  const idx3 = await manager.specimenTankIndex(3);
  const idx2 = await manager.specimenTankIndex(2);
  console.log("Specimen 1 Index in Tank 1 (expected 0):", idx1.toString());
  console.log("Specimen 3 Index in Tank 1 (expected 1):", idx3.toString());
  console.log("Specimen 2 Index in Tank 2 (expected 0):", idx2.toString());

  // 5. Water snapshot logging
  console.log("\n--- Testing Water snapshots ---");
  tx = await manager.logWaterParameters(
    1, // tankId
    245, // 24.5 C
    72,  // 7.2 pH
    0,   // no salinity for freshwater
    0,   // 0 ppm ammonia
    0,   // 0 ppm nitrite
    500, // 5.0 ppm nitrate
    "Performed 20% water change"
  );
  await tx.wait();
  console.log("Water parameters logged!");

  const waterLog = await manager.tankParameterLogs(1, 0);
  console.log("Tank 1 Log 0 Notes:", waterLog.notes, "| Temp:", (Number(waterLog.tempCelsiusX10) / 10).toFixed(1), "C");

  // 6. Spawn records
  console.log("\n--- Testing Spawn logs & Offspring pedigree ---");
  tx = await manager.initiateSpawn(1, 2, 1, "ipfs://spawn-tetra-logs");
  await tx.wait();
  console.log("Spawn record initiated!");

  const spawn = await manager.spawnRecords(1);
  console.log("Spawn 1 Sire ID:", spawn.sireId.toString(), "| Dam ID:", spawn.damId.toString());

  // Register offspring
  tx = await manager.registerSpawnOffspring(1, 1, Math.floor(Date.now() / 1000), "ipfs://offspring-4");
  await tx.wait();
  console.log("Offspring registered!");

  // Test parent species mismatch validation
  try {
    await manager.registerSpawnOffspring(1, 2, Math.floor(Date.now() / 1000), "ipfs://mismatched-offspring");
    throw new Error("Should have reverted due to species mismatch!");
  } catch (e) {
    if (e.message.includes("AquadexManager: Biological parent species mismatch")) {
      console.log("Mismatched parent species check reverted correctly!");
    } else {
      throw e;
    }
  }

  const offspring = await manager.specimens(4);
  console.log("Offspring 4 Sire ID:", offspring.sireId.toString(), "| Dam ID:", offspring.damId.toString());
  console.log("Offspring 4 currentTankId:", offspring.currentTankId.toString());

  // 7. Breed mapping validation
  console.log("\n--- Testing Breed Gallery Indexing ---");
  const breedCount = await manager.getSpecimensCountByBreed(1);
  const breedSpecimens = await manager.getSpecimensByBreed(1);
  console.log("Breed 1 specimen count (expected 4):", breedCount.toString());
  console.log("Breed 1 specimen list (expected [1, 2, 3, 4]):", breedSpecimens.map(id => Number(id)));

  if (Number(breedCount) !== 4) {
    throw new Error(`Expected breed count to be 4, got ${breedCount}`);
  }
  if (breedSpecimens.length !== 4 || Number(breedSpecimens[0]) !== 1 || Number(breedSpecimens[3]) !== 4) {
    throw new Error(`Expected breed specimens to be [1, 2, 3, 4], got [${breedSpecimens}]`);
  }
  console.log("Breed Gallery Indexing works perfectly!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
