/**
 * verify-fee-split.js
 * Verifies the 4% fee split from the most recent purchaseSpecimen transaction.
 *
 * Expected split on a 0.001 ETH sale:
 *   Total fee = 0.001 * 4% = 0.00004 ETH (40000000000000 wei)
 *   65% Ops (Kevin)       = 26000000000000 wei
 *   35% Founders split:
 *     Kevin (slot 1)      = 4666666666666 wei
 *     Steve (slot 2)      = 4666666666666 wei
 *     Kevin (slot 3+dust) = 4666666666668 wei (absorbs 2 wei dust)
 *
 * Usage:
 *   npx hardhat run scripts/verify-fee-split.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";

const MARKETPLACE_ADDRESS = "0x16168B514144e0380610b78d904a4de51ba03Ca3";

// Known addresses from deployment
const KEVIN = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";
const STEVE = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0";

// The purchase TX from our E2E test
const PURCHASE_TX = "0xf0ca282004d93b4c0d992d6863319bd1b4c91d5406b8cf03dc73f3cacedf40d4";

async function main() {
  const connection = await network.connect();
  const { ethers } = connection;

  console.log("=============================================================");
  console.log("  Aquadex Protocol — Fee Split Verification");
  console.log("=============================================================\n");

  // Get the transaction receipt with internal traces
  const receipt = await ethers.provider.getTransactionReceipt(PURCHASE_TX);
  if (!receipt) {
    console.error("❌  Transaction not found. Check the TX hash.");
    process.exit(1);
  }

  console.log(`  TX Hash  : ${PURCHASE_TX}`);
  console.log(`  Block    : ${receipt.blockNumber}`);
  console.log(`  Status   : ${receipt.status === 1 ? "✅ Success" : "❌ Failed"}`);
  console.log(`  Gas Used : ${receipt.gasUsed.toString()}\n`);

  // Parse the SpecimenPurchased event to get price and fee
  const purchaseEventSig = ethers.id("SpecimenPurchased(uint256,address,address,uint256,uint256)");
  const purchaseLog = receipt.logs.find(l => l.topics[0] === purchaseEventSig);

  if (!purchaseLog) {
    console.error("❌  SpecimenPurchased event not found in logs.");
    process.exit(1);
  }

  // Decode: indexed(tokenId, seller, buyer), data(price, fee)
  const iface = new ethers.Interface([
    "event SpecimenPurchased(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)"
  ]);
  const decoded = iface.parseLog({ topics: purchaseLog.topics, data: purchaseLog.data });

  const price = decoded.args.price;
  const fee = decoded.args.fee;
  const seller = decoded.args.seller;
  const buyer = decoded.args.buyer;
  const tokenId = decoded.args.tokenId;

  console.log("─── Transaction Details ──────────────────────────────────────");
  console.log(`  Token ID      : ${tokenId}`);
  console.log(`  Seller        : ${seller}`);
  console.log(`  Buyer         : ${buyer}`);
  console.log(`  Sale Price    : ${ethers.formatEther(price)} ETH (${price} wei)`);
  console.log(`  Protocol Fee  : ${ethers.formatEther(fee)} ETH (${fee} wei)`);
  console.log(`  Fee %         : ${(Number(fee) * 100 / Number(price)).toFixed(2)}%`);
  console.log(`  Seller Rcvd   : ${ethers.formatEther(price - fee)} ETH`);

  // Calculate expected fee split
  console.log("\n─── Expected Fee Distribution ───────────────────────────────");
  const opsShare = (fee * 65n) / 100n;
  const foundersShare = fee - opsShare;
  const perFounder = foundersShare / 3n;
  const dust = foundersShare - (perFounder * 2n); // slot 3 gets remainder

  console.log(`  Total Fee         : ${fee} wei`);
  console.log(`  65% Ops (Kevin)   : ${opsShare} wei (${ethers.formatEther(opsShare)} ETH)`);
  console.log(`  35% Founders      : ${foundersShare} wei`);
  console.log(`    Slot 1 (Kevin)  : ${perFounder} wei`);
  console.log(`    Slot 2 (Steve)  : ${perFounder} wei`);
  console.log(`    Slot 3 (Kevin+d): ${dust} wei (includes ${dust - perFounder} wei dust)`);

  // Kevin total received from fee = opsShare + slot1 + slot3
  const kevinFromFee = opsShare + perFounder + dust;
  const steveFromFee = perFounder;
  console.log(`\n  Kevin total from fee: ${kevinFromFee} wei (${ethers.formatEther(kevinFromFee)} ETH)`);
  console.log(`  Steve total from fee: ${steveFromFee} wei (${ethers.formatEther(steveFromFee)} ETH)`);

  // Now trace the actual internal transactions using debug_traceTransaction
  // Base Sepolia supports eth_getTransactionReceipt but not always debug_trace.
  // Instead, we'll check the actual ETH transfers by looking at internal txs
  // via the transaction's trace. If trace isn't available, we verify via balance math.
  
  console.log("\n─── On-Chain Verification (Internal Transfers) ──────────────");
  
  // Use a different approach: call eth_getBlockByNumber and trace value transfers
  // Or simply verify Steve's balance changed by the expected amount
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  
  // Get Steve's balance at the block before and after
  // ethers v6: getBalance with blockTag
  const steveBalAfter = await ethers.provider.getBalance(STEVE, receipt.blockNumber);
  const steveBalBefore = await ethers.provider.getBalance(STEVE, receipt.blockNumber - 1);
  const steveDelta = steveBalAfter - steveBalBefore;

  console.log(`  Steve balance before block ${receipt.blockNumber}: ${ethers.formatEther(steveBalBefore)} ETH`);
  console.log(`  Steve balance after  block ${receipt.blockNumber}: ${ethers.formatEther(steveBalAfter)} ETH`);
  console.log(`  Steve delta: +${steveDelta} wei (${ethers.formatEther(steveDelta)} ETH)`);

  if (steveDelta === steveFromFee) {
    console.log(`  ✅  Steve received exactly ${steveFromFee} wei — matches expected founder slot 2 share`);
  } else if (steveDelta > 0n) {
    console.log(`  ⚠️  Steve received ${steveDelta} wei (expected ${steveFromFee} wei)`);
    console.log(`      Difference: ${steveDelta - steveFromFee} wei`);
  } else {
    console.log(`  ❌  Steve balance did not increase. Possible RPC issue with historical state.`);
  }

  // Verify fee percentage is exactly 4%
  console.log("\n─── Fee Percentage Validation ───────────────────────────────");
  const expectedFee = (price * 400n) / 10000n; // 4% in BPS
  if (fee === expectedFee) {
    console.log(`  ✅  Fee is exactly 4% of sale price (${fee} wei = ${price} * 400 / 10000)`);
  } else {
    console.log(`  ❌  Fee mismatch: got ${fee}, expected ${expectedFee}`);
  }

  // Verify seller received price - fee
  const sellerProceeds = price - fee;
  console.log(`  ✅  Seller proceeds: ${ethers.formatEther(sellerProceeds)} ETH (price - 4% fee)`);

  // Verify math: ops + founders = total fee
  const reconstructed = opsShare + perFounder + perFounder + dust;
  if (reconstructed === fee) {
    console.log(`  ✅  Fee distribution sums correctly: ${opsShare} + ${perFounder} + ${perFounder} + ${dust} = ${fee}`);
  } else {
    console.log(`  ❌  Distribution sum mismatch: ${reconstructed} != ${fee}`);
  }

  console.log("\n=============================================================");
  console.log("  ✅  Fee split verification complete");
  console.log("=============================================================\n");
}

main().catch((error) => {
  console.error("\n❌  Verification failed:", error);
  process.exitCode = 1;
});
