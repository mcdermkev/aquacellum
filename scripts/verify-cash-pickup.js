/**
 * verify-cash-pickup.js — end-to-end testnet verification of the cash-pickup
 * fulfillment path (checklist item 2, Step D).
 *
 * Proves the full relayer settlement the new stripe.js `cash-confirm` endpoint
 * performs, against the freshly redeployed marketplace on Base Sepolia:
 *
 *   1. Mint a specimen to the seller.
 *   2. List it (escrows the NFT into the marketplace).
 *   3. Issue a signed handoff challenge (issueHandoffChallenge) for that token.
 *   4. Verify it exactly as the endpoint does (verifyHandoffChallenge with the
 *      seller match + the on-chain cashPickupSettled replay guard).
 *   5. Relay fulfillCashPickup(tokenId, buyer, keccak256(nonce)).
 *   6. Assert: buyer owns the NFT, the listing is deactivated, the handoffRef is
 *      marked settled, a replay reverts (EscrowAlreadyResolved), and a fresh
 *      ref on the now-inactive listing reverts (ListingNotActive).
 *
 * This writes persistent testnet state (mints + transfers an NFT) — beta/
 * disposable per the clean-slate posture.
 *
 * Run: npx hardhat run scripts/verify-cash-pickup.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";
import { readFileSync } from "fs";
import { issueHandoffChallenge, verifyHandoffChallenge, HANDOFF_TYPES } from "../frontend/api/_lib/handoffChallenge.js";

const TEST_SECRET = "verify-cash-pickup-secret";
let passes = 0;
let fails = 0;
function check(label, cond) {
  if (cond) { passes++; console.log(`  \u2705 ${label}`); }
  else { fails++; console.log(`  \u274c ${label}`); }
}

function deployed() {
  const j = JSON.parse(readFileSync(new URL("../deployed-addresses-sepolia.json", import.meta.url), "utf8"));
  return { marketplace: j.contracts.AquadexMarketplace, manager: j.contracts.AquadexManager };
}

async function main() {
  const { marketplace: MKT, manager: MGR } = deployed();
  console.log("\n=== Cash Pickup E2E Verification ===");
  console.log("  Marketplace:", MKT);

  const conn = await network.create("baseSepolia");
  const { ethers } = conn;
  const [seller] = await ethers.getSigners();
  const sellerAddr = await seller.getAddress();
  // Distinct recipient (steve slot) so the transfer is observable.
  const buyer = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0";
  console.log("  Seller/relayer:", sellerAddr);
  console.log("  Buyer:", buyer);

  const manager = await ethers.getContractAt("AquadexManager", MGR);
  const marketplace = await ethers.getContractAt("AquadexMarketplace", MKT);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The public RPC read node lags fresh writes by a few seconds; poll a read
  // until it stabilizes rather than trusting the first response.
  async function pollOwner(id, want, tries = 20) {
    for (let i = 0; i < tries; i++) {
      try { const o = (await manager.ownerOf(id)).toLowerCase(); if (o === want.toLowerCase()) return o; } catch { /* not indexed yet */ }
      await sleep(3000);
    }
    return null;
  }

  // ─── 1. Obtain a seller-owned, unlisted specimen ─────────────────────────
  console.log("\n─ 1. Obtain a seller-owned, unlisted specimen ─");
  let tokenId = null;
  const supply = Number(await manager.totalSpecimensMinted());
  // Reuse an existing unlisted token owned by the seller (avoids a needless
  // mint + its propagation lag). Scan the most recent ~12 ids.
  for (let id = supply; id >= 1 && id > supply - 12; id--) {
    try {
      const owner = (await manager.ownerOf(id)).toLowerCase();
      if (owner !== sellerAddr.toLowerCase()) continue;
      const l = await marketplace.listings(id);
      if (!l.active) { tokenId = id; break; }
    } catch { /* skip nonexistent/unreadable */ }
  }
  if (tokenId == null) {
    // None available — mint one and wait for it to be readable.
    console.log("     no reusable token; minting one");
    const mintTx = await manager.mintSpecimen(1, Math.floor(Date.now() / 1000), sellerAddr, 0, 0, 0, "ipfs://verify-cash-pickup");
    const mintRcpt = await mintTx.wait();
    for (const log of mintRcpt.logs) {
      try { const p = manager.interface.parseLog(log); if (p && p.name === "SpecimenRegistered") { tokenId = Number(p.args.tokenId); break; } } catch { /* not ours */ }
    }
    if (tokenId == null) tokenId = Number(await manager.totalSpecimensMinted());
  }
  check("resolved a candidate tokenId", Number.isInteger(tokenId));
  if (tokenId == null) throw new Error("could not obtain a tokenId");
  console.log("     tokenId:", tokenId);
  check("seller owns the token (read stabilized)", (await pollOwner(tokenId, sellerAddr)) !== null);

  // ─── 2. List it (escrow into marketplace) ────────────────────────────────
  console.log("\n─ 2. List specimen (escrow) ─");
  const listTx = await marketplace.listSpecimen(tokenId, ethers.parseEther("0.001"));
  await listTx.wait();
  check("marketplace now escrows the NFT (read stabilized)", (await pollOwner(tokenId, MKT)) !== null);
  check("listing is active", (await marketplace.listings(tokenId)).active === true);

  // ─── 3. Issue + 4. verify the signed handoff challenge ───────────────────
  console.log("\n─ 3-4. Issue + verify handoff challenge ─");
  const { token, payload } = issueHandoffChallenge({
    orderId: `cash_${tokenId}`, buyer, seller: sellerAddr, tokenId,
    type: HANDOFF_TYPES.CASH, secret: TEST_SECRET,
  });
  check("challenge carries explicit tokenId", payload.tokenId === tokenId);
  const handoffRef = ethers.keccak256(ethers.toUtf8Bytes(payload.nonce));

  const verifyRes = await verifyHandoffChallenge(token, {
    secret: TEST_SECRET,
    expectedSeller: sellerAddr,
    isNonceUsed: async () => await marketplace.cashPickupSettled(handoffRef),
  });
  check("challenge verifies (sig + seller match + not yet settled)", verifyRes.ok === true);
  check("wrong-seller submission is rejected", (await verifyHandoffChallenge(token, { secret: TEST_SECRET, expectedSeller: buyer })).ok === false);

  // ─── 5. Relay fulfillCashPickup ──────────────────────────────────────────
  console.log("\n─ 5. Relay fulfillCashPickup ─");
  const ftx = await marketplace.fulfillCashPickup(tokenId, buyer, handoffRef);
  const frcpt = await ftx.wait();
  console.log("     tx:", frcpt.hash);

  // ─── 6. Assertions ───────────────────────────────────────────────────────
  console.log("\n─ 6. Post-settlement assertions ─");
  check("buyer now owns the specimen (read stabilized)", (await pollOwner(tokenId, buyer)) !== null);
  check("handoffRef marked settled on-chain", (await marketplace.cashPickupSettled(handoffRef)) === true);
  check("listing deactivated", (await marketplace.listings(tokenId)).active === false);

  // Replay: same handoffRef must revert (EscrowAlreadyResolved).
  let replayReverted = false, replayReason = "";
  try { await (await marketplace.fulfillCashPickup(tokenId, buyer, handoffRef)).wait(); }
  catch (e) { replayReverted = true; replayReason = e.reason || e.shortMessage || e.message; }
  check(`replay with same handoffRef reverts (${replayReason})`, replayReverted);

  // Fresh ref on the now-inactive listing must revert (ListingNotActive).
  let inactiveReverted = false, inactiveReason = "";
  const freshRef = ethers.keccak256(ethers.toUtf8Bytes("fresh-nonce-" + Date.now()));
  try { await (await marketplace.fulfillCashPickup(tokenId, buyer, freshRef)).wait(); }
  catch (e) { inactiveReverted = true; inactiveReason = e.reason || e.shortMessage || e.message; }
  check(`fresh ref on inactive listing reverts (${inactiveReason})`, inactiveReverted);

  console.log(`\nRESULT: ${fails === 0 ? "PASS" : "FAIL"} (${passes} passed, ${fails} failed)\n`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
