/**
 * test-e2e-flows.js
 * End-to-end integration test on Base Sepolia using Kevin's wallet.
 * A temporary burner wallet is created and funded on-the-fly to act as buyer.
 * No second private key needed — only PRIVATE_KEY in .env.
 *
 * Tests:
 *   1. View species catalog (read)
 *   2. Register a tank (Kevin)
 *   3. Mint a specimen (Kevin)
 *   4. Create a marketplace listing (Kevin)
 *   5. Purchase the listing (Burner buyer)
 *   6. Verify token ownership transferred to buyer
 *
 * Usage:
 *   npx hardhat run scripts/test-e2e-flows.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";

const MANAGER_ADDRESS     = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKETPLACE_ADDRESS = "0x16168B514144e0380610b78d904a4de51ba03Ca3";

function passed(label) { console.log(`  ✅  ${label}`); }
function failed(label, err) {
  console.log(`  ❌  ${label}`);
  console.log(`      Error: ${err.message?.slice(0, 120)}`);
}
function section(title) {
  console.log(`\n─── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

async function main() {
  const connection = await network.connect();
  const { ethers } = connection;

  const kevinKey = process.env.PRIVATE_KEY;
  if (!kevinKey) {
    console.error("❌  PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const kevin = new ethers.Wallet(kevinKey, ethers.provider);
  const buyer = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log("=============================================================");
  console.log("  Aquadex Protocol — E2E Integration Test (Base Sepolia)");
  console.log("=============================================================");
  console.log(`  Kevin (Seller/Curator) : ${kevin.address}`);
  console.log(`  Buyer (Burner wallet)  : ${buyer.address}`);

  const kevinBal = await ethers.provider.getBalance(kevin.address);
  console.log(`  Kevin ETH balance      : ${ethers.formatEther(kevinBal)} ETH`);

  if (kevinBal === 0n) {
    console.error("❌  Kevin has 0 ETH. Fund the wallet first.");
    process.exit(1);
  }

  // Fund burner buyer with enough for purchase + gas
  section("SETUP: Fund burner buyer wallet");
  const fundAmount = ethers.parseEther("0.002");
  try {
    const fundTx = await kevin.sendTransaction({ to: buyer.address, value: fundAmount });
    await fundTx.wait();
    const buyerBal = await ethers.provider.getBalance(buyer.address);
    console.log(`  Sent ${ethers.formatEther(fundAmount)} ETH to burner`);
    console.log(`  Buyer balance: ${ethers.formatEther(buyerBal)} ETH`);
    passed("Burner wallet funded");
  } catch (err) {
    failed("Fund burner wallet", err);
    process.exit(1);
  }

  // Contract ABIs (minimal interface)
  const managerAbi = [
    "function nextSpeciesId() view returns (uint256)",
    "function speciesCatalog(uint256) view returns (uint256, string, string, string, uint8, int16, int16, uint8, uint8, bool)",
    "function registerTank(string name, uint8 tankType, uint32 volumeLiters) returns (uint256)",
    "function mintSpecimen(uint256 speciesId, uint256 birthTimestamp, address breeder, uint256 currentTankId, uint256 sireId, uint256 damId, string ipfsMetadataUri) returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function setApprovalForAll(address operator, bool approved)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
    "function tanks(uint256) view returns (uint256, address, string, uint8, uint32, uint256, bool, uint8, uint256, string, string, string)",
    "function specimens(uint256) view returns (uint256, uint256, uint256, address, uint256, uint256, uint256, string, uint8)",
    "function totalSpecimensMinted() view returns (uint256)",
    "function nextTankId() view returns (uint256)"
  ];
  const marketplaceAbi = [
    "function listSpecimen(uint256 tokenId, uint256 price)",
    "function purchaseSpecimen(uint256 tokenId) payable",
    "function listings(uint256) view returns (uint256, address, uint256, uint256, bool, bool)"
  ];

  const managerKevin = new ethers.Contract(MANAGER_ADDRESS, managerAbi, kevin);
  const marketplaceKevin = new ethers.Contract(MARKETPLACE_ADDRESS, marketplaceAbi, kevin);
  const marketplaceBuyer = new ethers.Contract(MARKETPLACE_ADDRESS, marketplaceAbi, buyer);

  let results = { passed: 0, failed: 0 };

  // =========================================================================
  // TEST 1: View Species Catalog
  // =========================================================================
  section("TEST 1: View Species Catalog");
  try {
    const nextId = await managerKevin.nextSpeciesId();
    console.log(`  Species in catalog: ${Number(nextId) - 1}`);
    for (let i = 1; i <= Math.min(3, Number(nextId) - 1); i++) {
      const sp = await managerKevin.speciesCatalog(i);
      console.log(`    #${i}: ${sp[2]} (${sp[1]})`); // commonName, scientificName
    }
    passed("Species catalog readable");
    results.passed++;
  } catch (err) {
    failed("Species catalog read", err);
    results.failed++;
  }

  // =========================================================================
  // TEST 2: Register a Tank
  // =========================================================================
  section("TEST 2: Register a Tank");
  let testTankId;
  try {
    const tx = await managerKevin.registerTank("E2E Test Tank", 0, 150);
    await tx.wait();
    const nextTankId = await managerKevin.nextTankId();
    testTankId = Number(nextTankId) - 1;
    const tank = await managerKevin.tanks(testTankId);
    console.log(`  Tank ID=${testTankId}, name="${tank[2]}", volume=${tank[4]}L`);
    if (tank[1].toLowerCase() === kevin.address.toLowerCase()) {
      passed("Tank registered and owned by Kevin");
      results.passed++;
    } else {
      failed("Tank owner mismatch", new Error(`got ${tank[1]}`));
      results.failed++;
    }
  } catch (err) {
    failed("Register tank", err);
    results.failed++;
  }

  // =========================================================================
  // TEST 3: Mint a Specimen
  // =========================================================================
  section("TEST 3: Mint a Specimen");
  let testTokenId;
  try {
    const birthTs = Math.floor(Date.now() / 1000) - 86400 * 30;
    const tx = await managerKevin.mintSpecimen(
      1, birthTs, kevin.address, testTankId || 0, 0, 0, "ipfs://e2e-test-specimen"
    );
    await tx.wait();
    const totalMinted = await managerKevin.totalSpecimensMinted();
    testTokenId = Number(totalMinted);
    const owner = await managerKevin.ownerOf(testTokenId);
    console.log(`  Specimen minted: Token ID=${testTokenId}`);
    console.log(`  Owner: ${owner}`);
    if (owner.toLowerCase() === kevin.address.toLowerCase()) {
      passed("Specimen minted and owned by Kevin");
      results.passed++;
    } else {
      failed("Specimen owner mismatch", new Error(`got ${owner}`));
      results.failed++;
    }
  } catch (err) {
    failed("Mint specimen", err);
    results.failed++;
  }

  // =========================================================================
  // TEST 4: Create Marketplace Listing
  // =========================================================================
  section("TEST 4: Create Marketplace Listing");
  const listingPrice = ethers.parseEther("0.001");
  try {
    const isApproved = await managerKevin.isApprovedForAll(kevin.address, MARKETPLACE_ADDRESS);
    if (!isApproved) {
      console.log("  Approving marketplace...");
      const appTx = await managerKevin.setApprovalForAll(MARKETPLACE_ADDRESS, true);
      await appTx.wait();
    }
    const tx = await marketplaceKevin.listSpecimen(testTokenId, listingPrice);
    await tx.wait();
    const listing = await marketplaceKevin.listings(testTokenId);
    console.log(`  Listed Token #${testTokenId} for ${ethers.formatEther(listing[2])} ETH`);
    console.log(`  Active: ${listing[4]}, Seller: ${listing[1]}`);
    if (listing[4] && listing[1].toLowerCase() === kevin.address.toLowerCase()) {
      passed("Listing created");
      results.passed++;
    } else {
      failed("Listing state wrong", new Error(`active=${listing[4]}`));
      results.failed++;
    }
    const escrowOwner = await managerKevin.ownerOf(testTokenId);
    if (escrowOwner.toLowerCase() === MARKETPLACE_ADDRESS.toLowerCase()) {
      passed("Token in marketplace escrow");
      results.passed++;
    } else {
      failed("Token not in escrow", new Error(`owner=${escrowOwner}`));
      results.failed++;
    }
  } catch (err) {
    failed("Create listing", err);
    results.failed++;
  }

  // =========================================================================
  // TEST 5: Purchase Listing (Burner Buyer)
  // =========================================================================
  section("TEST 5: Purchase Listing (Buyer)");
  try {
    const tx = await marketplaceBuyer.purchaseSpecimen(testTokenId, { value: listingPrice });
    const receipt = await tx.wait();
    console.log(`  Purchase TX: ${receipt.hash}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
    passed("Purchase transaction succeeded");
    results.passed++;
  } catch (err) {
    failed("Purchase listing", err);
    results.failed++;
  }

  // =========================================================================
  // TEST 6: Verify Ownership Transfer
  // =========================================================================
  section("TEST 6: Verify Token Ownership");
  try {
    const newOwner = await managerKevin.ownerOf(testTokenId);
    console.log(`  Token #${testTokenId} new owner: ${newOwner}`);
    if (newOwner.toLowerCase() === buyer.address.toLowerCase()) {
      passed("Token ownership transferred to buyer");
      results.passed++;
    } else {
      failed("Ownership not transferred", new Error(`Expected ${buyer.address}, got ${newOwner}`));
      results.failed++;
    }
    const listing = await marketplaceKevin.listings(testTokenId);
    if (!listing[4]) {
      passed("Listing deactivated after purchase");
      results.passed++;
    } else {
      failed("Listing still active", new Error("active=true"));
      results.failed++;
    }
  } catch (err) {
    failed("Verify ownership", err);
    results.failed++;
  }

  // =========================================================================
  // RESULTS
  // =========================================================================
  console.log("\n=============================================================");
  console.log("  TEST RESULTS");
  console.log("=============================================================");
  console.log(`  ✅  Passed: ${results.passed}`);
  console.log(`  ❌  Failed: ${results.failed}`);
  console.log(`  Total:     ${results.passed + results.failed}`);
  console.log("=============================================================");
  if (results.failed > 0) {
    process.exitCode = 1;
  } else {
    console.log("\n  🎉  All core flows verified on Base Sepolia!");
  }
}

main().catch((error) => {
  console.error("\n❌  Test script failed:", error);
  process.exitCode = 1;
});
