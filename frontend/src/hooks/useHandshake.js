import { db } from "../db";
import { ethers } from "ethers";

export function useHandshake() {
  // Generates a secure random 32-byte hex string salt using window.crypto.getRandomValues
  const generateSalt = () => {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return "0x" + Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  };

  /**
   * Generates commitment hash and caches pre-image details in Dexie.
   * If purchaseId is not yet known (before contract call), a temporary ID (e.g. listingId)
   * can be passed, and then updated via updatePurchaseId once the transaction completes.
   */
  const generateCommitment = async (purchaseId, pin, buyerAddress) => {
    const salt = generateSalt();
    // ethers v5 uses solidityKeccak256 instead of solidityPackedKeccak256
    const commitmentHash = ethers.utils.solidityKeccak256(
      ["uint256", "bytes32", "address"],
      [Number(pin), salt, buyerAddress]
    );

    // Save pre-image details directly to Dexie pendingHandshakes table
    await db.pendingHandshakes.put({
      purchaseId: Number(purchaseId),
      pin: pin.toString(),
      salt,
      buyerAddress
    });

    return { commitmentHash, salt };
  };

  /**
   * Helper to update the Dexie record from a temporary ID to the final purchaseId
   */
  const updatePurchaseId = async (tempId, finalPurchaseId) => {
    const record = await db.pendingHandshakes.get(Number(tempId));
    if (record) {
      // Delete temporary record
      await db.pendingHandshakes.delete(Number(tempId));
      // Save under final purchaseId
      await db.pendingHandshakes.put({
        ...record,
        purchaseId: Number(finalPurchaseId)
      });
    }
  };

  const getPendingHandshake = async (purchaseId) => {
    return await db.pendingHandshakes.get(Number(purchaseId));
  };

  const removePendingHandshake = async (purchaseId) => {
    await db.pendingHandshakes.delete(Number(purchaseId));
  };

  return {
    generateSalt,
    generateCommitment,
    updatePurchaseId,
    getPendingHandshake,
    removePendingHandshake
  };
}
