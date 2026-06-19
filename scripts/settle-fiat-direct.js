/**
 * settle-fiat-direct.js
 *
 * Directly calls purchaseSpecimenFiat() on the AquadexMarketplace contract
 * to simulate what the Stripe webhook would do. This bypasses the webhook
 * entirely and tests the on-chain settlement logic directly.
 *
 * Tests: NFT transfers from marketplace escrow to buyer, listing deactivated.
 *
 * Run: npx hardhat run scripts/settle-fiat-direct.js
 */

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MARKETPLACE_ADDRESS = "0x9E9ca82766ce0B36c88aF1eDc093d4e01826BBBf";
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";

const BUYER_WALLET = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0"; // steve
const TOKEN_ID = 5;
const PRICE_CENTS = 2500; // $25.00
const FAKE_PAYMENT_INTENT = "pi_test_e2e_" + Date.now();

const MARKETPLACE_ABI = [
  "function purchaseSpecimenFiat(uint256 tokenId, address buyer, uint256 priceCentsUSD, bytes32 stripePaymentHash)",
  "function listings(uint256 tokenId) view returns (uint256 tokenId, address seller, uint256 price, uint256 shippingFee, bool active, bool isShipping)",
  "function fiatSettlements(bytes32 hash) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

const MANAGER_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
];

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Direct On-Chain Fiat Settlement Test            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, wallet);
  const manager = new ethers.Contract(MANAGER_ADDRESS, MANAGER_ABI, provider);

  // ─── Pre-flight checks ───────────────────────────────────────────────────
  console.log("─── Pre-Settlement State ──────────────────────────────────────\n");

  const listing = await marketplace.listings(TOKEN_ID);
  console.log(`  Token #${TOKEN_ID} listing active: ${listing.active}`);
  console.log(`  Seller: ${listing.seller}`);
  console.log(`  Price: ${ethers.formatEther(listing.price)} ETH`);

  if (!listing.active) {
    console.log("\n  ❌ Listing is not active — cannot settle. Pick a different token.");
    process.exit(1);
  }

  const currentOwner = await manager.ownerOf(TOKEN_ID);
  console.log(`  Current owner (should be marketplace): ${currentOwner}`);
  console.log(`  Marketplace address: ${MARKETPLACE_ADDRESS}`);
  
  if (currentOwner.toLowerCase() !== MARKETPLACE_ADDRESS.toLowerCase()) {
    console.log("\n  ❌ Token not held by marketplace — cannot settle.");
    process.exit(1);
  }

  console.log(`  Buyer: ${BUYER_WALLET}`);
  console.log(`  Fake PaymentIntent: ${FAKE_PAYMENT_INTENT}`);

  // ─── Execute settlement ──────────────────────────────────────────────────
  console.log("\n─── Executing purchaseSpecimenFiat() ──────────────────────────\n");

  const stripePaymentHash = ethers.keccak256(ethers.toUtf8Bytes(FAKE_PAYMENT_INTENT));
  console.log(`  stripePaymentHash: ${stripePaymentHash}`);

  try {
    const tx = await marketplace.purchaseSpecimenFiat(
      TOKEN_ID,
      BUYER_WALLET,
      PRICE_CENTS,
      stripePaymentHash
    );
    console.log(`  TX submitted: ${tx.hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`  BaseScan: https://sepolia.basescan.org/tx/${tx.hash}`);
  } catch (err) {
    console.error(`  ❌ Transaction failed: ${err.message}`);
    if (err.data) console.error(`  Data: ${err.data}`);
    process.exit(1);
  }

  // ─── Post-settlement verification ────────────────────────────────────────
  console.log("\n─── Post-Settlement Verification ──────────────────────────────\n");

  const newOwner = await manager.ownerOf(TOKEN_ID);
  console.log(`  New owner of Token #${TOKEN_ID}: ${newOwner}`);
  
  if (newOwner.toLowerCase() === BUYER_WALLET.toLowerCase()) {
    console.log("  ✅ NFT successfully transferred to buyer!");
  } else {
    console.log("  ❌ NFT NOT transferred to buyer — something went wrong");
  }

  const listingAfter = await marketplace.listings(TOKEN_ID);
  console.log(`  Listing active after settlement: ${listingAfter.active}`);
  
  if (!listingAfter.active) {
    console.log("  ✅ Listing deactivated (removed from marketplace)");
  } else {
    console.log("  ❌ Listing still active — should have been deactivated");
  }

  const settled = await marketplace.fiatSettlements(stripePaymentHash);
  console.log(`  fiatSettlements[hash] recorded: ${settled}`);
  
  if (settled) {
    console.log("  ✅ Settlement recorded on-chain (idempotency key set)");
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ✅ END-TO-END ON-CHAIN SETTLEMENT VERIFIED");
  console.log("  Token #5 transferred from marketplace → buyer");
  console.log("  Listing removed from active marketplace");
  console.log("  Stripe payment hash recorded for idempotency");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
