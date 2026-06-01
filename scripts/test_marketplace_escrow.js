import { network } from "hardhat";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  console.log("====================================================");
  console.log("   AQUADEX MARKETPLACE ESCROW ENGINE TEST SUITE     ");
  console.log("====================================================\n");

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

  console.log("Accounts loaded:");
  console.log(`- Curator (Protocol Admin): ${curator.address}`);
  console.log(`- Breeder (Seller):         ${breeder.address}`);
  console.log(`- Buyer:                    ${buyer.address}`);
  console.log(`- Treasury (DAO Wallet):    ${treasury.address}\n`);

  // 1. Deploy AquadexManager
  console.log("[1/6] Deploying AquadexManager...");
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();
  console.log(`      Deployed at: ${managerAddr}\n`);

  // 2. Deploy AquadexMarketplace
  console.log("[2/6] Deploying AquadexMarketplace...");
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
  console.log(`      Deployed at: ${marketplaceAddr}\n`);

  // 3. Seed Species & Log Spawn
  console.log("[3/6] Seeding Species Catalog & Logging Spawn Event...");
  // Add species to catalog
  const addSpeciesTx = await manager.connect(curator).addSpecies(
    "Pterophyllum scalare",
    "Angelfish",
    "ipfs://bafkreiavfny7scee4mxyvc4pgoqicts4tzaq3f7fepprixftea6vj4lllu",
    0, // CareLevel.Easy
    240, 280, 60, 75
  );
  await addSpeciesTx.wait();
  console.log("      Species added: Pterophyllum scalare (Angelfish)");

  // Log spawn event to generate spawnId
  const spawnLogTx = await manager.connect(breeder).logSpawnEvent(
    1, // speciesId
    200, // eggCount
    "ipfs://spawn-notes-hash-placeholder"
  );
  await spawnLogTx.wait();
  console.log("      Breeder logged spawn event (Spawn ID: 1)");

  // Assert spawn details
  const spawnLog = await manager.spawnLogs(1);
  assert(spawnLog.spawnId === 1n, "Spawn ID should be 1");
  assert(spawnLog.breeder === breeder.address, "Spawn breeder should be breeder");
  console.log("      Spawn event validated successfully.\n");

  // 4. Create Batch Listing
  console.log("[4/6] Creating Batch Listing...");
  const listQty = 50n;
  const pricePerFish = ethers.parseEther("0.015"); // 0.015 ETH per fish
  const createTx = await marketplace.connect(breeder).createBatchListing(
    1, // spawnId
    listQty,
    pricePerFish
  );
  await createTx.wait();
  console.log(`      Batch listing created for ${listQty} juveniles @ 0.015 ETH each.`);

  // Assert listing details
  const listingId = 1;
  const listing = await marketplace.batchListings(listingId);
  assert(listing.listingId === 1n, "Listing ID should be 1");
  assert(listing.spawnId === 1n, "Spawn ID should be 1");
  assert(listing.quantity === listQty, "Quantity should match listQty");
  assert(listing.pricePerFish === pricePerFish, "Price should match pricePerFish");
  assert(listing.seller === breeder.address, "Seller should match breeder address");
  assert(listing.isActive === true, "Listing should be active");
  console.log("      Listing validated successfully.\n");

  // 5. Buyer Purchase In Person
  console.log("[5/6] Purchasing batch (In-Person pickup with PIN)...");
  const purchaseQty = 10n;
  const pin = "7890";
  const totalPrice = purchaseQty * pricePerFish; // 0.15 ETH

  console.log(`      Buyer purchasing ${purchaseQty} fish, locking ${ethers.formatEther(totalPrice)} ETH in escrow...`);
  
  const purchaseTx = await marketplace.connect(buyer).purchaseInPerson(
    listingId,
    purchaseQty,
    pin,
    { value: totalPrice }
  );
  await purchaseTx.wait();

  // Verify escrow lock state
  const purchaseId = 1;
  const purchase = await marketplace.escrowPurchases(purchaseId);
  assert(purchase.purchaseId === 1n, "Purchase ID should be 1");
  assert(purchase.listingId === 1n, "Listing ID should be 1");
  assert(purchase.buyer === buyer.address, "Buyer address should match");
  assert(purchase.quantity === purchaseQty, "Purchase quantity should match");
  assert(purchase.amountLocked === totalPrice, "Amount locked should match totalPrice");
  assert(purchase.state === 0n, "Escrow state should be LOCKED (0)");
  assert(purchase.fulfillmentType === 1n, "Fulfillment type should be In-Person (1)");

  // Verify batch listing remaining quantity
  const updatedListing = await marketplace.batchListings(listingId);
  assert(updatedListing.quantity === listQty - purchaseQty, "Listing quantity should be reduced");
  assert(updatedListing.isActive === true, "Listing should remain active");

  // Verify contract holds the funds
  const contractBalance = await ethers.provider.getBalance(marketplaceAddr);
  assert(contractBalance === totalPrice, "Contract balance should equal total price locked");
  console.log(`      Escrow locked state verified. Contract balance: ${ethers.formatEther(contractBalance)} ETH.\n`);

  // 6. Secure Handshake & Payout Split
  console.log("[6/6] Executing PIN verification (secureInPersonRelease) & routing payouts...");
  
  // Record balances before release
  const preBreederBal = await ethers.provider.getBalance(breeder.address);
  const preTreasuryBal = await ethers.provider.getBalance(treasury.address);

  // Execute release using curator signer to avoid breeder/treasury gas cost impact in balance check
  const releaseTx = await marketplace.connect(curator).secureInPersonRelease(purchaseId, pin);
  await releaseTx.wait();
  console.log("      PIN verification successful. Escrow released.");

  // Record balances after release
  const postBreederBal = await ethers.provider.getBalance(breeder.address);
  const postTreasuryBal = await ethers.provider.getBalance(treasury.address);

  // Calculate expected payouts: 4% BPS total fee.
  // Payout splits: 96% to breeder.
  // 65% of fee (25% Marine + 40% Ecosystem) to treasury.
  const totalFee = (totalPrice * 400n) / 10000n;
  const breederPayout = totalPrice - totalFee;
  const treasuryFee = (totalFee * 65n) / 100n;

  console.log(`      Expected Payouts:`);
  console.log(`        - Breeder (96%):  ${ethers.formatEther(breederPayout)} ETH`);
  console.log(`        - Treasury (2.6%): ${ethers.formatEther(treasuryFee)} ETH`);

  // Assert balance updates
  assert(postBreederBal === preBreederBal + breederPayout, "Breeder did not receive exactly 96% payout split");
  assert(postTreasuryBal === preTreasuryBal + treasuryFee, "Treasury did not receive exactly 65% of the 4% fee split");

  // Assert escrow state is RELEASED
  const resolvedPurchase = await marketplace.escrowPurchases(purchaseId);
  assert(resolvedPurchase.state === 1n, "Escrow state should be RELEASED (1)");

  // Assert contract holds 0 funds now
  const finalContractBalance = await ethers.provider.getBalance(marketplaceAddr);
  assert(finalContractBalance === 0n, "Contract balance should be 0 after release");

  console.log("      All balance routing assertions passed successfully!\n");

  console.log("====================================================");
  console.log("      ALL TEST ASSERTIONS PASSED SUCCESSFULLY       ");
  console.log("====================================================");
}

main().catch((error) => {
  console.error("Test Suite Failed:", error);
  process.exitCode = 1;
});
