import { network } from "hardhat";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Helper to read the ShippingEscrow struct into a named object.
async function getEscrow(marketplace, tokenId) {
  const r = await marketplace.shippingEscrows(tokenId);
  return {
    tokenId: r[0], buyer: r[1], seller: r[2], price: r[3], shippingFee: r[4],
    amountLocked: r[5], trackingNumber: r[6], dispatchTimestamp: r[7], status: r[8],
  };
}

// ShippingStatus: LOCKED=0, DISPATCHED=1, RELEASED=2, DISPUTED=3, REFUNDED=4
const STATUS = { LOCKED: 0n, DISPATCHED: 1n, RELEASED: 2n, DISPUTED: 3n, REFUNDED: 4n };

async function main() {
  console.log("====================================================");
  console.log("   AQUADEX — FIAT DISPUTE / REFUND (v2) TEST SUITE   ");
  console.log("====================================================\n");

  const connection = await network.create();
  const { ethers } = connection;

  const signers = await ethers.getSigners();
  const breeder = signers[1];   // seller
  const buyer = signers[2];
  const treasury = signers[3];
  const kevin = signers[4];     // FIAT_RELAYER_ROLE holder (per constructor)
  const steve = signers[5];
  const coFounder = signers[6];
  const stranger = signers[7];  // unauthorized third party

  // Deploy manager + marketplace
  const AquadexManager = await ethers.getContractFactory("AquadexManager");
  const manager = await AquadexManager.deploy();
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();

  const AquadexMarketplace = await ethers.getContractFactory("AquadexMarketplace");
  const marketplace = await AquadexMarketplace.deploy(
    managerAddr, treasury.address, treasury.address,
    kevin.address, steve.address, coFounder.address
  );
  await marketplace.waitForDeployment();
  const marketplaceAddr = await marketplace.getAddress();
  console.log(`Manager:     ${managerAddr}`);
  console.log(`Marketplace: ${marketplaceAddr}`);
  console.log(`Relayer (kevin): ${kevin.address}\n`);

  const price = ethers.parseEther("1.0");
  const shippingFee = ethers.parseEther("0.15");
  const priceCents = 10000; // $100.00 — fiat audit value only

  // The curator is hardcoded in AquadexStorage, so impersonate it to seed a
  // species (mintSpecimen requires a valid, existing species id).
  const curatorAddr = await manager.curator();
  await connection.provider.request({ method: "hardhat_impersonateAccount", params: [curatorAddr] });
  await connection.provider.request({ method: "hardhat_setBalance", params: [curatorAddr, "0x56BC75E2D63100000"] });
  const curatorSigner = await ethers.getSigner(curatorAddr);
  await (await manager.connect(curatorSigner).addSpecies(
    "Paracheirodon innesi", "Neon Tetra", "ipfs://tetra-uri", 0, 220, 260, 60, 75
  )).wait();
  console.log(`Seeded species via impersonated curator ${curatorAddr}.\n`);

  // Mint 4 specimens to the breeder (tokenIds 1..4).
  for (let i = 0; i < 4; i++) {
    const tx = await manager.connect(breeder).mintSpecimen(1, 0, breeder.address, 0, 0, 0, "ipfs://spec");
    await tx.wait();
  }
  console.log("Minted specimens #1-#4 to breeder.\n");

  // Helper: breeder lists a token for shipping (moves NFT into marketplace custody).
  async function listShipping(tokenId) {
    await (await manager.connect(breeder).approve(marketplaceAddr, tokenId)).wait();
    await (await marketplace.connect(breeder).createShippingListing(tokenId, price, shippingFee)).wait();
  }

  // Helper: relayer settles the fiat shipping purchase (creates a fiat escrow, amountLocked=0).
  async function settleFiat(tokenId, tag) {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`pi_${tag}_${tokenId}`));
    await (await marketplace.connect(kevin).purchaseShippingFiat(tokenId, buyer.address, priceCents, hash)).wait();
  }

  // ── Test 1: refundFiatShippingEscrow from LOCKED (relayer returns NFT to seller) ──
  console.log("[1] refundFiatShippingEscrow on a LOCKED fiat escrow (relayer)...");
  await listShipping(1);
  await settleFiat(1, "refund_locked");
  let e = await getEscrow(marketplace, 1);
  assert(e.status === STATUS.LOCKED, "T1: escrow should be LOCKED after fiat settle");
  assert(e.amountLocked === 0n, "T1: fiat escrow amountLocked must be 0");
  assert((await manager.ownerOf(1)) === marketplaceAddr, "T1: NFT should be in marketplace custody");

  await (await marketplace.connect(kevin).refundFiatShippingEscrow(1)).wait();
  e = await getEscrow(marketplace, 1);
  assert(e.status === STATUS.REFUNDED, "T1: escrow should be REFUNDED");
  assert((await manager.ownerOf(1)) === breeder.address, "T1: NFT should be returned to seller");
  console.log("    OK — NFT returned to seller, status REFUNDED.\n");

  // ── Test 2: refundFiatShippingEscrow from DISPATCHED (seller-initiated) ──
  console.log("[2] refundFiatShippingEscrow on a DISPATCHED fiat escrow (seller)...");
  await listShipping(2);
  await settleFiat(2, "refund_dispatched");
  await (await marketplace.connect(breeder).dispatchShipping(2, "TRACK-2")).wait();
  e = await getEscrow(marketplace, 2);
  assert(e.status === STATUS.DISPATCHED, "T2: escrow should be DISPATCHED");

  await (await marketplace.connect(breeder).refundFiatShippingEscrow(2)).wait();
  e = await getEscrow(marketplace, 2);
  assert(e.status === STATUS.REFUNDED, "T2: escrow should be REFUNDED");
  assert((await manager.ownerOf(2)) === breeder.address, "T2: NFT should be returned to seller");
  console.log("    OK — seller refunded a dispatched fiat order, NFT returned.\n");

  // ── Test 3: resolveFiatShippingDispute(refundBuyer=false) → release NFT to buyer ──
  console.log("[3] resolveFiatShippingDispute(refundBuyer=false) releases NFT to buyer (relayer)...");
  await listShipping(3);
  await settleFiat(3, "dispute_release");
  await (await marketplace.connect(breeder).dispatchShipping(3, "TRACK-3")).wait();
  await (await marketplace.connect(buyer).disputeShipping(3)).wait();
  e = await getEscrow(marketplace, 3);
  assert(e.status === STATUS.DISPUTED, "T3: escrow should be DISPUTED");

  await (await marketplace.connect(kevin).resolveFiatShippingDispute(3, false)).wait();
  e = await getEscrow(marketplace, 3);
  assert(e.status === STATUS.RELEASED, "T3: escrow should be RELEASED");
  assert((await manager.ownerOf(3)) === buyer.address, "T3: NFT should be released to buyer");
  console.log("    OK — disputed fiat order released to buyer (previously reverted on crypto path).\n");

  // ── Test 4: resolveFiatShippingDispute(refundBuyer=true) → return NFT to seller ──
  console.log("[4] resolveFiatShippingDispute(refundBuyer=true) returns NFT to seller (relayer)...");
  await listShipping(4);
  await settleFiat(4, "dispute_refund");
  await (await marketplace.connect(breeder).dispatchShipping(4, "TRACK-4")).wait();
  await (await marketplace.connect(buyer).disputeShipping(4)).wait();
  await (await marketplace.connect(kevin).resolveFiatShippingDispute(4, true)).wait();
  e = await getEscrow(marketplace, 4);
  assert(e.status === STATUS.REFUNDED, "T4: escrow should be REFUNDED");
  assert((await manager.ownerOf(4)) === breeder.address, "T4: NFT should be returned to seller");
  console.log("    OK — disputed fiat order refunded, NFT returned to seller.\n");

  // ── Test 5: negative — unauthorized caller cannot refund ──
  console.log("[5] Unauthorized caller is rejected...");
  await listShipping(1); // token #1 is back with the seller; relist a fresh fiat escrow
  // token #1 was returned to breeder in T1; re-approve + list again
  await settleFiat(1, "unauth");
  let reverted = false;
  try {
    await (await marketplace.connect(stranger).refundFiatShippingEscrow(1)).wait();
  } catch (err) {
    reverted = true;
  }
  assert(reverted, "T5: stranger must not be able to refund a fiat escrow");
  e = await getEscrow(marketplace, 1);
  assert(e.status === STATUS.LOCKED, "T5: escrow should remain LOCKED after failed unauthorized refund");
  console.log("    OK — unauthorized refund reverted, escrow untouched.\n");

  // ── Test 6: negative — fiat functions reject a crypto (ETH-locked) escrow ──
  console.log("[6] refundFiatShippingEscrow rejects a crypto (ETH-locked) escrow...");
  // token #2 was returned to breeder in T2; list + buy it with ETH (crypto path).
  await listShipping(2);
  await (await marketplace.connect(buyer).purchaseShippingListing(2, { value: price + shippingFee })).wait();
  e = await getEscrow(marketplace, 2);
  assert(e.amountLocked === price + shippingFee, "T6: crypto escrow should hold ETH");
  reverted = false;
  try {
    await (await marketplace.connect(kevin).refundFiatShippingEscrow(2)).wait();
  } catch (err) {
    reverted = true;
  }
  assert(reverted, "T6: fiat refund must reject an ETH-locked escrow (guarded by amountLocked != 0)");
  console.log("    OK — crypto escrow protected from the fiat-only refund path.\n");

  console.log("====================================================");
  console.log("      ALL FIAT DISPUTE/REFUND ASSERTIONS PASSED      ");
  console.log("====================================================");
}

main().catch((error) => {
  console.error("Test Suite Failed:", error);
  process.exitCode = 1;
});
