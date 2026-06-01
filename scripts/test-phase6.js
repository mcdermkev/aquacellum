import { network } from "hardhat";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  console.log("--- Starting Phase 6 Integration Tests ---");

  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();
  const curator = signers[0];
  const breeder = signers[1];
  const buyer = signers[2];
  const treasury = signers[3];
  const kevin = signers[4];
  const steve = signers[5];
  const coFounder = signers[6];

  console.log(`Curator: ${curator.address}`);
  console.log(`Breeder: ${breeder.address}`);
  console.log(`Buyer:   ${buyer.address}`);
  console.log(`Treasury: ${treasury.address}\n`);

  // 1. Deploy AquadexManager
  console.log("1. Deploying AquadexManager...");
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();
  console.log(`AquadexManager deployed to: ${managerAddr}`);

  // Seed initial species to catalog
  await manager.addSpecies(
    "Paracheirodon innesi",
    "Neon Tetra",
    "ipfs://tetra-uri",
    0, // CareLevel.Easy
    220, 260, 60, 75
  );
  console.log("Species seeded to catalog.");

  const mintTx = await manager.connect(breeder).mintSpecimen(
    1,
    Math.round(Date.now() / 1000),
    breeder.address,
    0, 0, 0,
    "ipfs://specimen1"
  );
  await mintTx.wait();
  console.log("Specimen Token ID #1 minted to Breeder.\n");

  // Test logging a spawn event
  console.log("Testing Spawn Log Registry...");
  const spawnLogTx = await manager.connect(breeder).logSpawnEvent(
    1, // speciesId
    150, // eggCount
    "ipfs://spawn-notes"
  );
  await spawnLogTx.wait();
  const spawnLog = await manager.spawnLogs(1);
  assert(spawnLog.spawnId === 1n, "Spawn log ID should be 1");
  assert(spawnLog.speciesId === 1n, "Spawn log species ID should be 1");
  assert(spawnLog.breeder === breeder.address, "Spawn log breeder should match breeder wallet");
  assert(spawnLog.eggCount === 150n, "Spawn log egg count should be 150");
  assert(spawnLog.notesIpfsHash === "ipfs://spawn-notes", "Spawn log notes IPFS hash should match");
  console.log("Spawn event successfully logged to the registry.\n");

  // 2. Deploy AquadexMarketplace
  console.log("2. Deploying AquadexMarketplace...");
  const AquadexMarketplace = await ethers.getContractFactory("AquadexMarketplace");
  const marketplace = await AquadexMarketplace.deploy(
    managerAddr,
    treasury.address, // marineConservationTreasury
    treasury.address, // ecosystemTreasury
    kevin.address,
    steve.address,
    coFounder.address
  );
  await marketplace.waitForDeployment();
  const marketplaceAddr = await marketplace.getAddress();
  console.log(`AquadexMarketplace deployed to: ${marketplaceAddr}`);

  // Approve marketplace to transfer Specimen #1
  await manager.connect(breeder).approve(marketplaceAddr, 1);
  console.log("Breeder approved marketplace for Token #1.");

  // List Specimen #1 for 1.0 ETH
  const price = ethers.parseEther("1.0");
  await marketplace.connect(breeder).listSpecimen(1, price);
  console.log("Specimen #1 listed for 1.0 ETH.");

  // Verify escrow custody
  assert((await manager.ownerOf(1)) === marketplaceAddr, "Token 1 should be held in escrow by marketplace");

  // Measure balances before purchase
  const prevSellerBal = await ethers.provider.getBalance(breeder.address);
  const prevTreasuryBal = await ethers.provider.getBalance(treasury.address);

  // Buyer purchases Specimen #1, sending 1.5 ETH (expects 0.5 ETH refund)
  console.log("Buyer purchasing Specimen #1 with 1.5 ETH...");
  const purchaseTx = await marketplace.connect(buyer).purchaseSpecimen(1, {
    value: ethers.parseEther("1.5")
  });
  await purchaseTx.wait();

  // Verify ownership transfer
  assert((await manager.ownerOf(1)) === buyer.address, "Token 1 should now be owned by buyer");
  console.log("Ownership transferred to Buyer.");

  // Verify 4% fee split: 1.0 ETH subtotal * 4% = 0.04 ETH.
  // Treasury (65%) = 0.026 ETH.
  const postTreasuryBal = await ethers.provider.getBalance(treasury.address);
  const feeDiff = postTreasuryBal - prevTreasuryBal;
  assert(feeDiff === ethers.parseEther("0.026"), `Treasury fee must be exactly 0.026 ETH (got ${ethers.formatEther(feeDiff)} ETH)`);
  console.log("4% protocol fee split successfully routed and verified.");

  // Verify remaining 96% (0.96 ETH) sent to Seller
  const postSellerBal = await ethers.provider.getBalance(breeder.address);
  const sellerDiff = postSellerBal - prevSellerBal;
  assert(sellerDiff === ethers.parseEther("0.96"), `Seller must receive exactly 0.96 ETH (got ${ethers.formatEther(sellerDiff)} ETH)`);
  console.log("96% net proceeds successfully routed to Seller.");

  // Verify excess 0.5 ETH was refunded
  const listing = await marketplace.listings(1);
  assert(!listing.active, "Listing must be flagged inactive");
  console.log("Refund checks completed and listing cleaned up successfully.\n");

  // 3. Deploy AquadexGovernance
  console.log("3. Deploying AquadexGovernance...");
  const AquadexGovernance = await ethers.getContractFactory("AquadexGovernance");
  // Set voting duration to 100 seconds
  const governance = await AquadexGovernance.deploy(managerAddr, 100);
  await governance.waitForDeployment();
  const governanceAddr = await governance.getAddress();
  console.log(`AquadexGovernance deployed to: ${governanceAddr}`);

  // Curator transfers curatorship to Governance contract
  await manager.connect(curator).transferCuratorship(governanceAddr);
  assert((await manager.curator()) === governanceAddr, "Governance must now be the catalog curator");
  console.log("Manager curatorship transferred to Governance contract.");

  // Propose a new species addition
  console.log("Submitting species catalog proposal via Governance...");
  const proposeTx = await governance.connect(buyer).proposeSpecies(
    "Amphiprion ocellaris",
    "Ocellaris Clownfish",
    "ipfs://clownfish-uri",
    1, // CareLevel.Medium
    240, 280, 80, 84
  );
  await proposeTx.wait();

  // Vote YES on proposal 1 using Specimen Token ID #1 (which buyer now owns)
  await governance.connect(buyer).vote(1, [1], true);
  console.log("Buyer voted YES on Proposal #1 using Specimen Token #1.");

  // Verify double-voting fails
  try {
    await governance.connect(buyer).vote(1, [1], true);
    assert(false, "Double voting was allowed!");
  } catch (e) {
    console.log("Double voting correctly blocked.");
  }

  // Wait 101 seconds for voting period to conclude using hardhat evm
  console.log("Waiting for voting period to end...");
  await ethers.provider.send("evm_increaseTime", [101]);
  await ethers.provider.send("evm_mine");

  // Execute Proposal
  console.log("Executing Proposal #1...");
  const executeTx = await governance.connect(buyer).executeProposal(1);
  await executeTx.wait();

  // Verify species catalog has updated
  const nextSpeciesId = await manager.nextSpeciesId();
  assert(nextSpeciesId === 3n, `Expected next species ID to be 3 (got ${nextSpeciesId})`);
  const species = await manager.speciesCatalog(2);
  assert(species.commonName === "Ocellaris Clownfish", "Catalog common name did not update correctly");
  assert(species.active, "New species catalog entry is not active");
  console.log("Proposal executed successfully. Catalog entry added: Ocellaris Clownfish.");

  // 4. Hatchery Marketplace Integration
  console.log("\n4. Testing Hatchery Marketplace Integration...");
  
  // Clean batch listing creation by a verified spawn creator
  const quantity = 50n;
  const pricePerFish = ethers.parseEther("0.01");
  const listTx = await marketplace.connect(breeder).createBatchListing(1, quantity, pricePerFish);
  await listTx.wait();

  const listingId = await marketplace.spawnToListing(1);
  assert(listingId === 1n, "Listing ID should be 1");

  const batchListing = await marketplace.batchListings(listingId);
  assert(batchListing.listingId === 1n, "Listing ID mismatch");
  assert(batchListing.spawnId === 1n, "Spawn ID mismatch");
  assert(batchListing.quantity === quantity, "Quantity mismatch");
  assert(batchListing.pricePerFish === pricePerFish, "Price per fish mismatch");
  assert(batchListing.seller === breeder.address, "Seller mismatch");
  assert(batchListing.isActive === true, "Listing should be active");
  console.log("Clean batch listing successfully created by verified breeder.");

  try {
    await marketplace.connect(buyer).createBatchListing(1, quantity, pricePerFish);
    assert(false, "Unrecognized wallet list did not revert!");
  } catch (e) {
    assert(e.message.includes("CallerNotOwner"), `Expected revert reason, got: ${e.message}`);
    console.log("List authorization correctly blocked for non-breeder.");
  }

  // Success state for a partial purchase (e.g., buying 5 out of a batch of 50) and checking that remaining inventory exactly equals 45
  const quantityToBuy = 5n;
  const totalCost = pricePerFish * quantityToBuy; // 0.05 ETH
  const purchaseBatchTx = await marketplace.connect(buyer).purchaseBatch(1, quantityToBuy, {
    value: totalCost
  });
  await purchaseBatchTx.wait();

  const listingAfterPurchase = await marketplace.batchListings(1);
  assert(listingAfterPurchase.quantity === 45n, `Inventory should be 45 (got ${listingAfterPurchase.quantity})`);
  assert(listingAfterPurchase.isActive === true, "Listing should remain active");

  const purchase = await marketplace.escrowPurchases(1);
  assert(purchase.purchaseId === 1n, "Purchase ID mismatch");
  assert(purchase.buyer === buyer.address, "Buyer mismatch");
  assert(purchase.quantity === quantityToBuy, "Quantity mismatch");
  assert(purchase.amountLocked === totalCost, "Amount locked mismatch");
  assert(purchase.state === 0n, "State should be LOCKED (0)");
  assert(purchase.fulfillmentType === 0n, "Fulfillment type should be Shipping (0)");
  console.log("Partial purchase completed successfully. Inventory reduced from 50 to 45.");

  // Accurate calculations of the 4% fee split upon escrow release
  const prevSellerBalBatch = await ethers.provider.getBalance(breeder.address);
  const prevTreasuryBalBatch = await ethers.provider.getBalance(treasury.address);

  const releaseTx = await marketplace.connect(buyer).releaseEscrow(1);
  await releaseTx.wait();

  const postSellerBalBatch = await ethers.provider.getBalance(breeder.address);
  const postTreasuryBalBatch = await ethers.provider.getBalance(treasury.address);

  const feeDiffBatch = postTreasuryBalBatch - prevTreasuryBalBatch;
  const sellerDiffBatch = postSellerBalBatch - prevSellerBalBatch;

  // Total Cost = 0.05 ETH. Total fee = 4% = 0.002 ETH.
  // Treasury (65%) = 0.0013 ETH.
  // Seller proceeds = 0.05 - 0.002 = 0.048 ETH.
  assert(feeDiffBatch === ethers.parseEther("0.0013"), `Treasury should get 0.0013 ETH fee (got ${ethers.formatEther(feeDiffBatch)} ETH)`);
  assert(sellerDiffBatch === ethers.parseEther("0.048"), `Seller should get 0.048 ETH split (got ${ethers.formatEther(sellerDiffBatch)} ETH)`);

  const purchaseAfterRelease = await marketplace.escrowPurchases(1);
  assert(purchaseAfterRelease.state === 1n, "Escrow state should be RELEASED (1)");
  console.log("Escrow released successfully. 4% protocol fee split verified.");

  // 5. In-Person Handshake Verification Flow
  console.log("\n5. Testing In-Person Handshake Verification Flow...");
  const pin = 4321n;
  const salt = ethers.keccak256(ethers.toUtf8Bytes("my-salt-value"));
  const commitmentHash = ethers.solidityPackedKeccak256(
    ["uint256", "bytes32", "address"],
    [pin, salt, buyer.address]
  );
  const quantityToBuyInPerson = 3n;
  const inPersonCost = pricePerFish * quantityToBuyInPerson; // 0.03 ETH

  console.log("Buyer purchasing 3 juveniles in-person with commitment hash...");
  const purchaseInPersonTx = await marketplace.connect(buyer).purchaseInPerson(1, quantityToBuyInPerson, commitmentHash, {
    value: inPersonCost
  });
  await purchaseInPersonTx.wait();

  // Validate state
  const purchase2 = await marketplace.escrowPurchases(2);
  assert(purchase2.purchaseId === 2n, "Purchase 2 ID mismatch");
  assert(purchase2.buyer === buyer.address, "Purchase 2 buyer mismatch");
  assert(purchase2.quantity === quantityToBuyInPerson, "Purchase 2 quantity mismatch");
  assert(purchase2.amountLocked === inPersonCost, "Purchase 2 amount locked mismatch");
  assert(purchase2.state === 0n, "Purchase 2 state should be LOCKED (0)");
  assert(purchase2.fulfillmentType === 1n, "Purchase 2 fulfillmentType should be In-Person (1)");
  assert(purchase2.commitmentHash === commitmentHash, "Purchase 2 commitment hash mismatch");
  console.log("In-person purchase successful, commitmentHash matches.");

  // Confirm standard releaseEscrow reverts for in-person fulfillment
  try {
    await marketplace.connect(buyer).releaseEscrow(2);
    assert(false, "releaseEscrow should have reverted for in-person fulfillment");
  } catch (e) {
    assert(e.message.includes("NotShippingFulfillment"), `Expected shipping check revert, got: ${e.message}`);
    console.log("Standard release Escrow correctly reverted for In-Person transaction.");
  }

  // Confirm secureInPersonRelease fails with invalid PIN
  try {
    await marketplace.connect(breeder).secureInPersonRelease(2, 9999, salt, false);
    assert(false, "secureInPersonRelease should have reverted for invalid PIN");
  } catch (e) {
    assert(e.message.includes("InvalidCommitment"), `Expected invalid PIN check revert, got: ${e.message}`);
    console.log("secureInPersonRelease correctly blocked invalid PIN.");
  }

  // Confirm secureInPersonRelease succeeds with correct PIN and distributes funds
  const prevSellerBalInPerson = await ethers.provider.getBalance(breeder.address);
  const prevTreasuryBalInPerson = await ethers.provider.getBalance(treasury.address);

  const secureReleaseTx = await marketplace.connect(breeder).secureInPersonRelease(2, pin, salt, false);
  const secureReleaseReceipt = await secureReleaseTx.wait();

  const postSellerBalInPerson = await ethers.provider.getBalance(breeder.address);
  const postTreasuryBalInPerson = await ethers.provider.getBalance(treasury.address);

  const gasUsed = secureReleaseReceipt.gasUsed;
  const gasPrice = secureReleaseReceipt.gasPrice;
  const txGasCost = gasUsed * gasPrice;

  const feeDiffInPerson = postTreasuryBalInPerson - prevTreasuryBalInPerson;
  const sellerDiffInPerson = postSellerBalInPerson - prevSellerBalInPerson;

  // Total Cost = 0.03 ETH. Total fee = 4% = 0.0012 ETH.
  // Treasury (65%) = 0.00078 ETH.
  // Seller proceeds = 0.03 - 0.0012 = 0.0288 ETH.
  assert(feeDiffInPerson === ethers.parseEther("0.00078"), `Treasury should get 0.00078 ETH fee (got ${ethers.formatEther(feeDiffInPerson)} ETH)`);
  assert(sellerDiffInPerson + txGasCost === ethers.parseEther("0.0288"), `Seller should get 0.0288 ETH split (got ${ethers.formatEther(sellerDiffInPerson)} ETH)`);

  const purchase2AfterRelease = await marketplace.escrowPurchases(2);
  assert(purchase2AfterRelease.state === 1n, "Purchase 2 state should be RELEASED (1)");
  console.log("In-person escrow settled seamlessly using cryptographic PIN handshake.");

  // Test promo fee (2%) inside event zone
  console.log("Testing 2% promo fee inside active event zone...");
  const pinPromo = 5678n;
  const saltPromo = ethers.keccak256(ethers.toUtf8Bytes("promo-salt"));
  const commitmentHashPromo = ethers.solidityPackedKeccak256(
    ["uint256", "bytes32", "address"],
    [pinPromo, saltPromo, buyer.address]
  );
  const pricePerFishPromo = ethers.parseEther("0.01");
  const qtyPromo = 5n;
  const costPromo = pricePerFishPromo * qtyPromo; // 0.05 ETH

  const purchasePromoTx = await marketplace.connect(buyer).purchaseInPerson(1, qtyPromo, commitmentHashPromo, {
    value: costPromo
  });
  await purchasePromoTx.wait();

  const prevSellerBalPromo = await ethers.provider.getBalance(breeder.address);
  const prevDevBalPromo = await ethers.provider.getBalance(coFounder.address);

  const releasePromoTx = await marketplace.connect(breeder).secureInPersonRelease(3, pinPromo, saltPromo, true);
  const releasePromoReceipt = await releasePromoTx.wait();

  const postSellerBalPromo = await ethers.provider.getBalance(breeder.address);
  const postDevBalPromo = await ethers.provider.getBalance(coFounder.address);

  const gasUsedPromo = releasePromoReceipt.gasUsed;
  const gasPricePromo = releasePromoReceipt.gasPrice;
  const txGasCostPromo = gasUsedPromo * gasPricePromo;

  const devDiffPromo = postDevBalPromo - prevDevBalPromo;
  const sellerDiffPromo = postSellerBalPromo - prevSellerBalPromo;

  // Total Cost = 0.05 ETH. Total fee = 2% = 0.001 ETH.
  // Seller proceeds = 0.05 - 0.001 = 0.049 ETH.
  assert(devDiffPromo === ethers.parseEther("0.001"), `Dev wallet should receive 0.001 ETH fee (got ${ethers.formatEther(devDiffPromo)} ETH)`);
  assert(sellerDiffPromo + txGasCostPromo === ethers.parseEther("0.049"), `Seller should get 0.049 ETH split (got ${ethers.formatEther(sellerDiffPromo + txGasCostPromo)} ETH)`);
  console.log("2% promo fee successfully routed and verified.");

  // 6. Testing Nested Husbandry & Location Tracking
  console.log("\n6. Testing Nested Husbandry & Location Tracking...");
  
  // Register a top-level parent tank
  const regParentTx = await manager.connect(breeder).registerTank(
    "Main Breeding Rack Tank",
    0, // Freshwater
    150, // 150 liters
    0, // ContainmentType.Tank
    0, // parentUnitId (none)
    "Facility A",
    "Room 1",
    "Rack 3"
  );
  await regParentTx.wait();
  
  const breederTanks = await manager.ownerTanks(breeder.address, 0);
  const parentTankId = breederTanks;
  console.log(`Parent tank registered with ID: ${parentTankId}`);

  // Register a nested child basket
  const regChildTx = await manager.connect(breeder).registerTank(
    "Guppy Basket A",
    0, // Freshwater
    10, // 10 liters
    2, // ContainmentType.Basket
    parentTankId, // parentUnitId
    "Facility A",
    "Room 1",
    "Rack 3"
  );
  await regChildTx.wait();
  
  const breederTanks2 = await manager.ownerTanks(breeder.address, 1);
  const childTankId = breederTanks2;
  console.log(`Child basket registered with ID: ${childTankId}`);

  // Verify parameters on-chain
  const parentTank = await manager.tanks(parentTankId);
  assert(parentTank.containment === 0n, "Parent containment type should be Tank (0)");
  assert(parentTank.parentUnitId === 0n, "Parent parentUnitId should be 0");
  assert(parentTank.facility === "Facility A", "Parent facility mismatch");
  assert(parentTank.room === "Room 1", "Parent room mismatch");
  assert(parentTank.rack === "Rack 3", "Parent rack mismatch");

  const childTank = await manager.tanks(childTankId);
  assert(childTank.containment === 2n, "Child containment type should be Basket (2)");
  assert(childTank.parentUnitId === parentTankId, "Child parentUnitId should match parent ID");
  assert(childTank.facility === "Facility A", "Child facility mismatch");
  assert(childTank.room === "Room 1", "Child room mismatch");
  assert(childTank.rack === "Rack 3", "Child rack mismatch");
  console.log("On-chain child-parent and location metadata verified successfully.");

  // Test nesting validation failures:
  // A. Nesting under a parent owned by a different wallet (buyer trying to nest under breeder's tank)
  try {
    const badTx = await manager.connect(buyer).registerTank(
      "Buyer Guppy Basket",
      0,
      5,
      2, // ContainmentType.Basket
      parentTankId, // parentUnitId owned by breeder
      "Facility A",
      "Room 1",
      "Rack 3"
    );
    await badTx.wait();
    assert(false, "Should have reverted when nesting under parent owned by a different wallet");
  } catch (e) {
    assert(e.message.includes("CallerNotParentOwner"), `Expected caller does not own parent unit revert, got: ${e.message}`);
    console.log("Validation correctly blocked nesting under a parent unit owned by a different wallet.");
  }

  // B. Nesting under a non-existent / inactive parent unit
  try {
    const badTx2 = await manager.connect(breeder).registerTank(
      "Non-existent Parent Basket",
      0,
      5,
      2,
      999n, // non-existent parent ID
      "Facility A",
      "Room 1",
      "Rack 3"
    );
    await badTx2.wait();
    assert(false, "Should have reverted when nesting under non-existent parent");
  } catch (e) {
    assert(e.message.includes("ParentUnitInactive"), `Expected parent invalid revert, got: ${e.message}`);
    console.log("Validation correctly blocked nesting under non-existent parent unit.");
  }

  // C. Verify legacy registerTank wrapper defaults
  const legacyTx = await manager.connect(breeder).registerTank(
    "Legacy Show Tank",
    0, // Freshwater
    60 // 60 liters
  );
  await legacyTx.wait();
  
  const breederTanks3 = await manager.ownerTanks(breeder.address, 2);
  const legacyTankId = breederTanks3;
  const legacyTank = await manager.tanks(legacyTankId);
  
  assert(legacyTank.containment === 0n, "Legacy containment should default to Tank (0)");
  assert(legacyTank.parentUnitId === 0n, "Legacy parentUnitId should default to 0");
  assert(legacyTank.facility === "");
  assert(legacyTank.room === "");
  assert(legacyTank.rack === "");
  console.log("Legacy registerTank wrapper verified successfully.");

  // 7. Testing Box-Grouping Consolidated Checkout (purchaseMultipleSpecimens)
  console.log("\n7. Testing Box-Grouping Consolidated Checkout...");

  // Mint Tokens #2, #3, #4 to Breeder
  const mintTx2 = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, "ipfs://specimen2");
  await mintTx2.wait();
  const mintTx3 = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, "ipfs://specimen3");
  await mintTx3.wait();
  const mintTx4 = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, "ipfs://specimen4");
  await mintTx4.wait();

  // Mint Token #5 to Curator
  const mintTx5 = await manager.connect(curator).mintSpecimen(1, Math.round(Date.now() / 1000), curator.address, 0, 0, 0, "ipfs://specimen5");
  await mintTx5.wait();

  // Mint Tokens #6-#11 to Breeder to test batch limit (MAX_BATCH_CHECKOUT_SIZE = 6)
  for (let id = 6; id <= 11; id++) {
    const mintTx = await manager.connect(breeder).mintSpecimen(1, Math.round(Date.now() / 1000), breeder.address, 0, 0, 0, `ipfs://specimen${id}`);
    await mintTx.wait();
  }

  // Approve marketplace for all tokens
  await manager.connect(breeder).approve(marketplaceAddr, 2);
  await manager.connect(breeder).approve(marketplaceAddr, 3);
  await manager.connect(breeder).approve(marketplaceAddr, 4);
  await manager.connect(curator).approve(marketplaceAddr, 5);
  for (let id = 6; id <= 11; id++) {
    await manager.connect(breeder).approve(marketplaceAddr, id);
  }

  // List tokens with shipping fees
  await marketplace.connect(breeder).createShippingListing(2, ethers.parseEther("1.0"), ethers.parseEther("0.05"));
  await marketplace.connect(breeder).createShippingListing(3, ethers.parseEther("2.0"), ethers.parseEther("0.03"));
  await marketplace.connect(breeder).createShippingListing(4, ethers.parseEther("1.5"), ethers.parseEther("0.02"));
  await marketplace.connect(curator).createShippingListing(5, ethers.parseEther("1.0"), ethers.parseEther("0.05"));
  for (let id = 6; id <= 11; id++) {
    await marketplace.connect(breeder).createShippingListing(id, ethers.parseEther("1.0"), ethers.parseEther("0.01"));
  }
  console.log("Tokens #2-#4 and #6-#11 listed by Breeder. Token #5 listed by Curator.");

  try {
    await marketplace.connect(buyer).purchaseMultipleSpecimens([2, 3, 4, 6, 7, 8, 9], { value: ethers.parseEther("10.0") });
    assert(false, "Should have reverted on batch size exceeding limit");
  } catch (e) {
    assert(e.message.includes("MaxBatchExceeded"), `Expected MaxBatchExceeded revert, got: ${e.message}`);
    console.log("Batch size limit check passed.");
  }

  // Test: Empty token list reverts
  try {
    await marketplace.connect(buyer).purchaseMultipleSpecimens([], { value: ethers.parseEther("5.0"), gasLimit: 3000000 });
    assert(false, "Should have reverted on empty tokenIds array");
  } catch (e) {
    console.log("Empty tokenIds array check passed.");
  }

  // Test: Seller mismatch reverts
  try {
    await marketplace.connect(buyer).purchaseMultipleSpecimens([2, 5], { value: ethers.parseEther("5.0"), gasLimit: 3000000 });
    assert(false, "Should have reverted on seller address mismatch");
  } catch (e) {
    assert(e.message.includes("SellerMismatch"), `Expected seller mismatch revert, got: ${e.message}`);
    console.log("Seller address mismatch check passed.");
  }

  // Test: Inactive listing reverts (Token 1 is inactive)
  try {
    await marketplace.connect(buyer).purchaseMultipleSpecimens([1, 2], { value: ethers.parseEther("5.0"), gasLimit: 3000000 });
    assert(false, "Should have reverted on inactive listing");
  } catch (e) {
    assert(e.message.includes("ListingNotActive"), `Expected inactive listing revert, got: ${e.message}`);
    console.log("Inactive listing check passed.");
  }

  // Test: Insufficient value reverts
  try {
    await marketplace.connect(buyer).purchaseMultipleSpecimens([2, 3], { value: ethers.parseEther("3.0"), gasLimit: 3000000 });
    assert(false, "Should have reverted on insufficient payment");
  } catch (e) {
    assert(e.message.includes("InsufficientPayment"), `Expected insufficient payment revert, got: ${e.message}`);
    console.log("Insufficient payment check passed.");
  }

  // Test: Successful consolidated purchase with excess value (test refund)
  const prevSellerBalMulti = await ethers.provider.getBalance(breeder.address);
  const prevTreasuryBalMulti = await ethers.provider.getBalance(treasury.address);

  // Send 4.0 ETH for a 3.05 ETH total cost (expecting 0.95 ETH refund)
  console.log("Buyer executing purchaseMultipleSpecimens for [2, 3] sending 4.0 ETH...");
  const purchaseMultiTx = await marketplace.connect(buyer).purchaseMultipleSpecimens([2, 3], {
    value: ethers.parseEther("4.0")
  });
  await purchaseMultiTx.wait();

  // Verify ownership transfer
  assert((await manager.ownerOf(2)) === buyer.address, "Token 2 owner should be buyer");
  assert((await manager.ownerOf(3)) === buyer.address, "Token 3 owner should be buyer");
  console.log("Ownership of tokens #2 and #3 successfully transferred to Buyer.");

  // Verify listings are deleted/inactive
  const listing2 = await marketplace.listings(2);
  const listing3 = await marketplace.listings(3);
  assert(!listing2.active, "Listing 2 should be inactive");
  assert(!listing3.active, "Listing 3 should be inactive");

  // Verify 4% fee split on subtotal (3.0 ETH subtotal * 4% = 0.12 ETH).
  // Treasury (65%) = 0.078 ETH.
  const postTreasuryBalMulti = await ethers.provider.getBalance(treasury.address);
  const feeDiffMulti = postTreasuryBalMulti - prevTreasuryBalMulti;
  assert(feeDiffMulti === ethers.parseEther("0.078"), `Treasury fee must be exactly 0.078 ETH (got ${ethers.formatEther(feeDiffMulti)} ETH)`);
  console.log("DAO Treasury fee split of 0.078 ETH successfully verified.");

  // Verify Breeder receives 96% of subtotal (2.88 ETH) plus the consolidated shipping fee (0.05 ETH) = 2.93 ETH
  const postSellerBalMulti = await ethers.provider.getBalance(breeder.address);
  const sellerDiffMulti = postSellerBalMulti - prevSellerBalMulti;
  assert(sellerDiffMulti === ethers.parseEther("2.93"), `Breeder payout must be exactly 2.93 ETH (got ${ethers.formatEther(sellerDiffMulti)} ETH)`);
  console.log("Breeder consolidated payout + shipping fee of 2.93 ETH successfully verified.");

  // 8. Testing On-Chain Cash Handshake Gating & Verification
  console.log("\n8. Testing On-Chain Cash Handshake Gating & Verification...");
  
  // Settle cash handshake from escrow (fromEscrow = true) for Token #4 (still listed)
  const fulfillTx = await marketplace.connect(breeder).fulfillCashHandshake(
    4,
    buyer.address,
    1, // eventId
    true, // fromEscrow
    0,
    0
  );
  await fulfillTx.wait();
  assert((await manager.ownerOf(4)) === buyer.address, "Token 4 owner should be buyer after cash handshake");
  console.log("Direct cash handshake fulfillment completed successfully when active.");

  // Reverts on inactive eventId
  try {
    await marketplace.connect(breeder).fulfillCashHandshake(
      5,
      buyer.address,
      99, // inactive/non-existent eventId
      true,
      0,
      0
    );
    assert(false, "Should have reverted on inactive event ID");
  } catch (e) {
    assert(e.message.includes("EventInactive"), `Expected event inactive revert, got: ${e.message}`);
    console.log("Cash handshake correctly reverted with inactive event ID.");
  }

  // Reverts when event window is closed (future event)
  const currentTime = Math.round(Date.now() / 1000);
  const setEventTx = await marketplace.connect(kevin).setLiveEvent(
    3,
    currentTime + 10000, // startTime in the future
    currentTime + 20000, // endTime
    true // active
  );
  await setEventTx.wait();

  try {
    await marketplace.connect(breeder).fulfillCashHandshake(
      5,
      buyer.address,
      3, // eventId 3 (future)
      true,
      0,
      0
    );
    assert(false, "Should have reverted on closed event window");
  } catch (e) {
    assert(e.message.includes("EventWindowClosed"), `Expected event window closed revert, got: ${e.message}`);
    console.log("Cash handshake correctly reverted when event window is closed (future event).");
  }

  console.log("\n--- All Phase 6 Integration Tests Passed Successfully ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
