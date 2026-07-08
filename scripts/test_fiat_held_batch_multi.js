import { network } from "hardhat";

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// EscrowState (batch): LOCKED=0, RELEASED=1, REFUNDED=2
const ESCROW = { LOCKED: 0n, RELEASED: 1n, REFUNDED: 2n };
// ShippingStatus (multi): LOCKED=0, DISPATCHED=1, RELEASED=2, DISPUTED=3, REFUNDED=4
const SHIP = { LOCKED: 0n, RELEASED: 2n, REFUNDED: 4n };

const hashOf = (ethers, s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function main() {
  console.log("========================================================");
  console.log("   AQUADEX — FIAT HELD BATCH & MULTI (Gap 3) TEST SUITE  ");
  console.log("========================================================\n");

  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();
  const breeder = signers[1];
  const buyer = signers[2];
  const treasury = signers[3];
  const kevin = signers[4]; // FIAT_RELAYER_ROLE
  const steve = signers[5];
  const coFounder = signers[6];
  const stranger = signers[7];

  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();

  const AquadexMarketplace = await ethers.getContractFactory("AquadexMarketplace");
  const marketplace = await AquadexMarketplace.deploy(
    managerAddr, treasury.address, treasury.address, kevin.address, steve.address, coFounder.address
  );
  await marketplace.waitForDeployment();
  const marketplaceAddr = await marketplace.getAddress();

  // Seed a species via the (hardcoded) impersonated curator so mintSpecimen works.
  const curatorAddr = await manager.curator();
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [curatorAddr] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [curatorAddr, "0x56BC75E2D63100000"] });
  const curatorSigner = await ethers.getSigner(curatorAddr);
  await (await manager.connect(curatorSigner).addSpecies(
    "Paracheirodon innesi", "Neon Tetra", "ipfs://uri", 0, 220, 260, 60, 75
  )).wait();
  console.log(`Species seeded via curator ${curatorAddr}.\n`);

  const priceCents = 12000;

  // ══════════════════════════════ BATCH ══════════════════════════════
  console.log("──── HELD BATCH ────\n");

  // Breeder logs a spawn, then lists a batch of juveniles.
  await (await manager.connect(breeder).logSpawnEvent(1, 150, "ipfs://spawn")).wait();
  const spawnId = 1;
  const pricePerFish = ethers.parseEther("0.05");
  await (await marketplace.connect(breeder).createBatchListing(spawnId, 10, pricePerFish)).wait();
  const batchListingId = 1;
  let bl = await marketplace.batchListings(batchListingId);
  assert(bl.quantity === 10n && bl.isActive, "batch listing should start with qty 10, active");

  // [B1] purchaseBatchFiat now creates a HELD (LOCKED) escrow.
  console.log("[B1] purchaseBatchFiat creates a LOCKED (held) escrow...");
  const bHash1 = hashOf(ethers, "pi_batch_release");
  await (await marketplace.connect(kevin).purchaseBatchFiat(batchListingId, 3, buyer.address, priceCents, bHash1)).wait();
  let pid = await marketplace.fiatBatchPurchaseId(bHash1);
  assert(pid !== 0n, "B1: fiatBatchPurchaseId should be recorded");
  let purchase = await marketplace.escrowPurchases(pid);
  assert(purchase.state === ESCROW.LOCKED, "B1: batch escrow should be LOCKED (held), not RELEASED");
  assert(purchase.amountLocked === 0n, "B1: fiat batch escrow holds no ETH");
  bl = await marketplace.batchListings(batchListingId);
  assert(bl.quantity === 7n, "B1: batch qty should drop 10 -> 7");
  console.log("    OK — held escrow created, quantity decremented.\n");

  // [B2] release flips to RELEASED (payout trigger).
  console.log("[B2] releaseFiatBatchEscrow (relayer) flips to RELEASED...");
  await (await marketplace.connect(kevin).releaseFiatBatchEscrow(bHash1)).wait();
  purchase = await marketplace.escrowPurchases(pid);
  assert(purchase.state === ESCROW.RELEASED, "B2: batch escrow should be RELEASED");
  console.log("    OK — released.\n");

  // [B3] refund restores the juveniles to the listing.
  console.log("[B3] refundFiatBatchEscrow restores quantity...");
  const bHash2 = hashOf(ethers, "pi_batch_refund");
  await (await marketplace.connect(kevin).purchaseBatchFiat(batchListingId, 4, buyer.address, priceCents, bHash2)).wait();
  bl = await marketplace.batchListings(batchListingId);
  assert(bl.quantity === 3n, "B3: batch qty should drop 7 -> 3 after second purchase");
  await (await marketplace.connect(kevin).refundFiatBatchEscrow(bHash2)).wait();
  const pid2 = await marketplace.fiatBatchPurchaseId(bHash2);
  purchase = await marketplace.escrowPurchases(pid2);
  assert(purchase.state === ESCROW.REFUNDED, "B3: batch escrow should be REFUNDED");
  bl = await marketplace.batchListings(batchListingId);
  assert(bl.quantity === 7n && bl.isActive, "B3: batch qty should be restored 3 -> 7 and active");
  console.log("    OK — refunded and quantity restored.\n");

  // ══════════════════════════════ MULTI ══════════════════════════════
  console.log("──── HELD MULTI ────\n");

  // Mint 6 specimens to the breeder and list each (custody -> marketplace).
  for (let i = 0; i < 6; i++) {
    await (await manager.connect(breeder).mintSpecimen(1, 0, breeder.address, 0, 0, 0, "ipfs://spec")).wait();
  }
  const price = ethers.parseEther("0.2");
  async function list(tokenId) {
    await (await manager.connect(breeder).approve(marketplaceAddr, tokenId)).wait();
    await (await marketplace.connect(breeder).listSpecimen(tokenId, price)).wait();
  }
  for (let t = 1; t <= 6; t++) await list(t);

  // [M1] lockMultipleFiat holds the NFTs (listings deactivated, NFTs in custody).
  console.log("[M1] lockMultipleFiat holds specimens in escrow...");
  const mHash1 = hashOf(ethers, "pi_multi_release");
  const set1 = [1, 2, 3];
  await (await marketplace.connect(kevin).lockMultipleFiat(set1, buyer.address, priceCents, mHash1)).wait();
  let esc = await marketplace.fiatMultiEscrow(mHash1);
  assert(esc.buyer === buyer.address, "M1: escrow buyer mismatch");
  assert(esc.seller === breeder.address, "M1: escrow seller mismatch");
  assert(esc.status === SHIP.LOCKED, "M1: escrow status should be LOCKED");
  assert(esc.tokenCount === 3n, "M1: escrow should hold 3 tokens");
  for (const t of set1) assert((await manager.ownerOf(t)) === marketplaceAddr, `M1: token ${t} should stay in custody`);
  for (const t of set1) assert((await marketplace.listings(t)).active === false, `M1: listing ${t} should be deactivated`);
  console.log("    OK — 3 specimens held, listings deactivated.\n");

  // [M2] release transfers all NFTs to the buyer.
  console.log("[M2] releaseFiatMultiEscrow transfers all NFTs to buyer...");
  await (await marketplace.connect(kevin).releaseFiatMultiEscrow(mHash1)).wait();
  esc = await marketplace.fiatMultiEscrow(mHash1);
  assert(esc.status === SHIP.RELEASED, "M2: escrow status should be RELEASED");
  for (const t of set1) assert((await manager.ownerOf(t)) === buyer.address, `M2: token ${t} should be owned by buyer`);
  console.log("    OK — all specimens released to buyer.\n");

  // [M3] refund returns all NFTs to the seller.
  console.log("[M3] refundFiatMultiEscrow returns all NFTs to seller...");
  const mHash2 = hashOf(ethers, "pi_multi_refund");
  const set2 = [4, 5, 6];
  await (await marketplace.connect(kevin).lockMultipleFiat(set2, buyer.address, priceCents, mHash2)).wait();
  await (await marketplace.connect(kevin).refundFiatMultiEscrow(mHash2)).wait();
  esc = await marketplace.fiatMultiEscrow(mHash2);
  assert(esc.status === SHIP.REFUNDED, "M3: escrow status should be REFUNDED");
  for (const t of set2) assert((await manager.ownerOf(t)) === breeder.address, `M3: token ${t} should be back with seller`);
  console.log("    OK — all specimens returned to seller.\n");

  // [M4] negative — unauthorized release is rejected.
  console.log("[M4] Unauthorized caller cannot release/refund...");
  let reverted = false;
  try {
    await (await marketplace.connect(stranger).releaseFiatMultiEscrow(mHash1)).wait();
  } catch (e) { reverted = true; }
  assert(reverted, "M4: stranger must not release a multi escrow");
  console.log("    OK — unauthorized multi release reverted.\n");

  console.log("========================================================");
  console.log("     ALL HELD BATCH & MULTI ASSERTIONS PASSED           ");
  console.log("========================================================");
}

main().catch((error) => {
  console.error("Test Suite Failed:", error);
  process.exitCode = 1;
});
