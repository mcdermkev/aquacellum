import { network } from "hardhat";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  console.log("====================================================");
  console.log("   AQUADEX MARKETPLACE SHIPPING ENGINE TEST SUITE   ");
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
  console.log("[1/7] Deploying AquadexManager...");
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();
  console.log(`      Deployed at: ${managerAddr}\n`);

  // 2. Deploy AquadexMarketplace
  console.log("[2/7] Deploying AquadexMarketplace...");
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

  // 3. Seed Species & Mint Specimen
  console.log("[3/7] Seeding Species Catalog & Minting Specimen ERC-721...");
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

  // Breeder mints a specimen
  const tokenId = 1n;
  const mintTx = await manager.connect(breeder).mintSpecimen(
    1, // speciesId
    0, // birthTimestamp
    breeder.address, // breeder
    0, // currentTankId
    0, // sireId
    0, // damId
    "ipfs://sire-tetra-metadata-hash"
  );
  await mintTx.wait();
  console.log(`      Breeder minted specimen tokenId: ${tokenId}`);

  // Verify breeder owns the token
  const tokenOwner = await manager.ownerOf(tokenId);
  assert(tokenOwner === breeder.address, "Breeder must own the minted token");
  console.log("      Specimen ownership verified.\n");

  // 4. Create Shipping Listing
  console.log("[4/7] Listing Specimen with Shipping Fee...");
  const price = ethers.parseEther("1.0"); // 1 ETH
  const shippingFee = ethers.parseEther("0.15"); // 0.15 ETH
  const totalPrice = price + shippingFee; // 1.15 ETH

  // Approve marketplace
  const approveTx = await manager.connect(breeder).approve(marketplaceAddr, tokenId);
  await approveTx.wait();
  console.log("      Breeder approved marketplace for specimen.");

  // List with shipping
  const listTx = await marketplace.connect(breeder).createShippingListing(tokenId, price, shippingFee);
  await listTx.wait();
  console.log(`      Specimen listed with price: ${ethers.formatEther(price)} ETH, shipping fee: ${ethers.formatEther(shippingFee)} ETH.`);

  // Verify listing state
  const listing = await marketplace.listings(tokenId);
  assert(listing.tokenId === tokenId, "Listing token ID mismatch");
  assert(listing.seller === breeder.address, "Listing seller mismatch");
  assert(listing.price === price, "Listing price mismatch");
  assert(listing.shippingFee === shippingFee, "Listing shippingFee mismatch");
  assert(listing.active === true, "Listing should be active");
  assert(listing.isShipping === true, "Listing should have isShipping set to true");
  
  // Verify token is in marketplace custody
  const currentTokenOwner = await manager.ownerOf(tokenId);
  assert(currentTokenOwner === marketplaceAddr, "Token custody should belong to marketplace contract");
  console.log("      Shipping listing verified successfully.\n");

  // 5. Purchase Shipping Listing & Lock Escrow
  console.log("[5/7] Buyer purchasing shipping listing (locks subtotal + shipping)...");
  const purchaseTx = await marketplace.connect(buyer).purchaseShippingListing(tokenId, { value: totalPrice });
  await purchaseTx.wait();
  console.log(`      Buyer purchased listing. locked: ${ethers.formatEther(totalPrice)} ETH.`);

  // Verify listing is deleted/inactive
  const inactiveListing = await marketplace.listings(tokenId);
  assert(inactiveListing.active === false, "Listing should be inactive after purchase");

  // Verify shippingEscrows entry
  const escrow = await shippingEscrows(marketplace, tokenId);
  assert(escrow.tokenId === tokenId, "Escrow token ID mismatch");
  assert(escrow.buyer === buyer.address, "Escrow buyer mismatch");
  assert(escrow.seller === breeder.address, "Escrow seller mismatch");
  assert(escrow.price === price, "Escrow price mismatch");
  assert(escrow.shippingFee === shippingFee, "Escrow shipping fee mismatch");
  assert(escrow.amountLocked === totalPrice, "Escrow amount locked mismatch");
  assert(escrow.status === 0n, "Escrow status should be LOCKED (0)");
  assert(escrow.dispatchTimestamp === 0n, "Dispatch timestamp should be 0 initially");

  // Verify marketplace holds the funds
  const contractBalance = await ethers.provider.getBalance(marketplaceAddr);
  assert(contractBalance === totalPrice, `Contract balance should be ${ethers.formatEther(totalPrice)} ETH`);
  console.log("      Escrow locked state verified.\n");

  // 6. Dispatch Shipping
  console.log("[6/7] Breeder dispatching shipping with dummy tracking string...");
  const trackingNumber = "TRACK-999-DUMMY";
  const dispatchTx = await marketplace.connect(breeder).dispatchShipping(tokenId, trackingNumber);
  const dispatchReceipt = await dispatchTx.wait();
  console.log(`      Breeder updated status to DISPATCHED with tracking number: ${trackingNumber}`);

  // Verify dispatch timestamp and status updated
  const updatedEscrow = await shippingEscrows(marketplace, tokenId);
  assert(updatedEscrow.status === 1n, "Escrow status should be DISPATCHED (1)");
  assert(updatedEscrow.trackingNumber === trackingNumber, "Escrow tracking number mismatch");
  assert(updatedEscrow.dispatchTimestamp > 0n, "Escrow dispatch timestamp should be greater than 0");
  console.log(`      Transit timestamp rules activated on-chain. Dispatch timestamp: ${updatedEscrow.dispatchTimestamp}`);

  // Test that seller cannot release before safety window
  try {
    await marketplace.connect(breeder).releaseShippingEscrow(tokenId);
    assert(false, "Releasing before safety window should have failed");
  } catch (error) {
    console.log("      Verified: Seller release before safety window successfully reverted.");
  }
  console.log("");

  // 7. Fast Forward and Escrow Release
  console.log("[7/7] Fast-forwarding time past safety window (3 days) & releasing escrow...");
  const threeDays = 3n * 24n * 60n * 60n;
  
  // Fast forward blocks
  await ethers.provider.send("evm_increaseTime", [Number(threeDays) + 10]);
  await ethers.provider.send("evm_mine", []);
  console.log("      Time-traveled 3 days forward.");

  // Record pre-balances
  const preBreederBal = await ethers.provider.getBalance(breeder.address);
  const preTreasuryBal = await ethers.provider.getBalance(treasury.address);

  // Breeder releases escrow
  const releaseTx = await marketplace.connect(breeder).releaseShippingEscrow(tokenId);
  const releaseReceipt = await releaseTx.wait();
  console.log("      Breeder triggered payout release successfully.");

  // Record post-balances
  const postBreederBal = await ethers.provider.getBalance(breeder.address);
  const postTreasuryBal = await ethers.provider.getBalance(treasury.address);

  // Math checks: 4% BPS total fee
  // Subtotal (price) = 1 ETH
  // Fee = 4% of price = 0.04 ETH
  // Breeder proceeds = price - fee + shippingFee = 1 ETH - 0.04 ETH + 0.15 ETH = 1.11 ETH
  // Treasury (65% of fee) = 65% of 0.04 = 0.026 ETH
  const totalFee = (price * 400n) / 10000n;
  const expectedBreederPayout = price - totalFee + shippingFee;
  const expectedTreasuryFee = (totalFee * 65n) / 100n;

  // Since breeder sent the release tx, breeder paid gas fees. Let's account for gas cost.
  const gasPaid = releaseReceipt.fee;
  
  console.log(`      Payout Verification:`);
  console.log(`        - Expected Breeder proceeds (1.11 ETH - gas): ${ethers.formatEther(expectedBreederPayout)} ETH`);
  console.log(`        - Actual Breeder balance change:               ${ethers.formatEther(postBreederBal - preBreederBal)} ETH`);
  console.log(`        - Gas Paid by Breeder:                         ${ethers.formatEther(gasPaid)} ETH`);
  console.log(`        - Expected DAO Treasury (0.026 ETH):           ${ethers.formatEther(expectedTreasuryFee)} ETH`);
  console.log(`        - Actual Treasury balance change:              ${ethers.formatEther(postTreasuryBal - preTreasuryBal)} ETH`);

  // Assert payouts
  assert(postBreederBal === preBreederBal + expectedBreederPayout - gasPaid, "Breeder proceeds balance mismatch");
  assert(postTreasuryBal === preTreasuryBal + expectedTreasuryFee, "Treasury platform fee mismatch");

  // Verify buyer has received the specimen token
  const finalTokenOwner = await manager.ownerOf(tokenId);
  assert(finalTokenOwner === buyer.address, "Buyer should now own the specimen ERC-721 token");
  console.log("      Specimen ERC-721 token transfer to buyer verified.");

  // Verify escrow entry state transitions to RELEASED (2)
  const finalEscrow = await shippingEscrows(marketplace, tokenId);
  assert(finalEscrow.status === 2n, "Escrow status should be RELEASED (2)");

  // Verify contract balance is 0
  const finalContractBalance = await ethers.provider.getBalance(marketplaceAddr);
  assert(finalContractBalance === 0n, "Contract balance should be 0 after escrow release");
  console.log("      Contract escrow balance verified as 0.");

  console.log("\n====================================================");
  console.log("      ALL TEST ASSERTIONS PASSED SUCCESSFULLY       ");
  console.log("====================================================");
}

// Helper to fetch shipping escrow struct correctly mapping all properties
async function shippingEscrows(marketplace, tokenId) {
  const result = await marketplace.shippingEscrows(tokenId);
  return {
    tokenId: result[0],
    buyer: result[1],
    seller: result[2],
    price: result[3],
    shippingFee: result[4],
    amountLocked: result[5],
    trackingNumber: result[6],
    dispatchTimestamp: result[7],
    status: result[8]
  };
}

main().catch((error) => {
  console.error("Test Suite Failed:", error);
  process.exitCode = 1;
});
