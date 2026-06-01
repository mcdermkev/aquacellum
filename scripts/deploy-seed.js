import { network } from "hardhat";

async function main() {
  const connection = await network.create();
  const { ethers } = connection;
  const [owner, breeder, buyer, treasury] = await ethers.getSigners();

  console.log("--- Deploying Aquadex Protocol ---");

  // 1. Deploy Manager
  console.log("Deploying AquadexManager...");
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddress = await manager.getAddress();
  console.log("AquadexManager deployed to:", managerAddress);

  // 2. Deploy Marketplace
  console.log("\nDeploying AquadexMarketplace...");
  const AquadexMarketplace = await ethers.getContractFactory("AquadexMarketplace");
  const marketplace = await AquadexMarketplace.deploy(
    managerAddress,
    treasury.address, // marineConservationTreasury
    treasury.address, // ecosystemTreasury
    owner.address,    // kevin
    breeder.address,  // steve
    buyer.address     // coFounder
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("AquadexMarketplace deployed to:", marketplaceAddress);

  // 3. Deploy Governance
  console.log("\nDeploying AquadexGovernance...");
  const AquadexGovernance = await ethers.getContractFactory("AquadexGovernance");
  const governance = await AquadexGovernance.deploy(managerAddress, 86400); // 1 day voting period
  await governance.waitForDeployment();
  const governanceAddress = await governance.getAddress();
  console.log("AquadexGovernance deployed to:", governanceAddress);

  // 4. Curate 3 sample species in Catalog
  console.log("\nCurating Species Catalog...");
  let tx = await manager.addSpecies(
    "Paracheirodon innesi",
    "Neon Tetra",
    "ipfs://bafybeiccanonicaltetrainfo",
    0, // CareLevel.Easy
    220, // 22.0 C
    265, // 26.5 C
    60,  // 6.0 pH
    75   // 7.5 pH
  );
  await tx.wait();
  console.log("- Added Neon Tetra to catalog");
  
  tx = await manager.addSpecies(
    "Amphiprion ocellaris",
    "Ocellaris Clownfish",
    "ipfs://bafybeiccanonicalclownfishinfo",
    1, // CareLevel.Medium
    240, // 24.0 C
    270, // 27.0 C
    81,  // 8.1 pH
    84   // 8.4 pH
  );
  await tx.wait();
  console.log("- Added Ocellaris Clownfish to catalog");

  tx = await manager.addSpecies(
    "Symphysodon aequifasciatus",
    "Discus",
    "ipfs://bafybeiccanonicaldiscusinfo",
    2, // CareLevel.Difficult
    280, // 28.0 C
    310, // 31.0 C
    55,  // 5.5 pH
    65   // 6.5 pH
  );
  await tx.wait();
  console.log("- Added Discus to catalog");

  // 5. Register 2 default tanks for the owner
  console.log("\nRegistering default hobbyist tanks...");
  tx = await manager.registerTank("Community Fresh 120L", 0, 120); // Freshwater, 120 Liters
  await tx.wait();
  console.log("- Registered Community Fresh 120L Tank (ID: 1)");

  tx = await manager.registerTank("Reef Edge 300L", 1, 300); // Saltwater, 300 Liters
  await tx.wait();
  console.log("- Registered Reef Edge 300L Tank (ID: 2)");

  console.log("\n--- Seeding Complete ---");
  console.log(`Manager:     ${managerAddress}`);
  console.log(`Marketplace: ${marketplaceAddress}`);
  console.log(`Governance:  ${governanceAddress}`);
  console.log(`Treasury:    ${treasury.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
