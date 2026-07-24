/**
 * grant-relayer-role.js
 * 
 * Grants FIAT_RELAYER_ROLE to the deployer/relayer wallet on AquadexMarketplace.
 * The deployer (kevin) holds DEFAULT_ADMIN_ROLE, so it can grant any role.
 *
 * Run: npx hardhat run scripts/grant-relayer-role.js
 */

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MARKETPLACE_ADDRESS = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";

const FIAT_RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FIAT_RELAYER_ROLE"));

const ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`\nGranting FIAT_RELAYER_ROLE to ${wallet.address}...`);

  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, ABI, wallet);

  // Check if already granted
  const already = await marketplace.hasRole(FIAT_RELAYER_ROLE, wallet.address);
  if (already) {
    console.log("✅ Role already granted — nothing to do.");
    return;
  }

  const tx = await marketplace.grantRole(FIAT_RELAYER_ROLE, wallet.address);
  console.log(`TX submitted: ${tx.hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`   BaseScan: https://sepolia.basescan.org/tx/${tx.hash}`);

  // Verify
  const verified = await marketplace.hasRole(FIAT_RELAYER_ROLE, wallet.address);
  console.log(`   Role verified: ${verified ? "YES ✅" : "NO ❌"}\n`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
