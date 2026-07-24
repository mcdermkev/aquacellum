/**
 * finalize-marketplace-v3.js
 *
 * Idempotent post-deploy setup for the v3 marketplace (fulfillCashPickup).
 * Separated from the deploy so RPC propagation lag on a just-deployed address
 * can't abort the deploy itself. Safe to re-run.
 *
 *   1. Wait for the new contract's code to be visible on the RPC node.
 *   2. Ensure FIAT_RELAYER_ROLE on the backend relayer wallet.
 *   3. Approve the new marketplace as operator on AquadexManager.
 *   4. Persist deployed-addresses-sepolia.json.
 *
 * Run: npx hardhat run scripts/finalize-marketplace-v3.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";
import { readFileSync, writeFileSync } from "fs";

const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const PREVIOUS_MARKETPLACE = "0xEC4d21Aa32c6c378Ba43E6d9038e93A9702177BF";
const NEW_MARKETPLACE = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";

const kevin = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";
const steve = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0";

function readRelayerKey() {
  try {
    const env = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("RELAYER_PRIVATE_KEY="));
    if (!line) return null;
    return line.slice("RELAYER_PRIVATE_KEY=".length).trim().replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const conn = await network.create("baseSepolia");
  const { ethers } = conn;
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("\n  Deployer:", deployerAddress);
  console.log("  New Marketplace:", NEW_MARKETPLACE);

  // ─── 1. Wait for code propagation ──────────────────────────────────────────
  console.log("\n─── 1. Waiting for contract code on RPC ────────────────────────");
  let code = "0x";
  for (let i = 0; i < 20; i++) {
    code = await ethers.provider.getCode(NEW_MARKETPLACE);
    if (code && code !== "0x") break;
    process.stdout.write(".");
    await sleep(3000);
  }
  if (!code || code === "0x") {
    throw new Error("Contract code not visible after ~60s — check the deploy tx.");
  }
  console.log("\n  ✅ Code present.");

  const abi = [
    "function grantRole(bytes32 role, address account) external",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function FIAT_RELAYER_ROLE() view returns (bytes32)",
  ];
  const marketplace = new ethers.Contract(NEW_MARKETPLACE, abi, deployer);
  const FIAT_RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FIAT_RELAYER_ROLE"));

  // ─── 2. FIAT_RELAYER_ROLE ──────────────────────────────────────────────────
  console.log("\n─── 2. Ensuring FIAT_RELAYER_ROLE ──────────────────────────────");
  let relayerAddress = deployerAddress;
  const relayerKey = readRelayerKey();
  if (relayerKey) {
    try { relayerAddress = new ethers.Wallet(relayerKey).address; } catch { /* keep deployer */ }
  }
  console.log("  Relayer wallet:", relayerAddress);
  if (await marketplace.hasRole(FIAT_RELAYER_ROLE, relayerAddress)) {
    console.log("  ✅ Relayer already holds FIAT_RELAYER_ROLE.");
  } else {
    const tx = await marketplace.grantRole(FIAT_RELAYER_ROLE, relayerAddress);
    await tx.wait();
    console.log("  ✅ FIAT_RELAYER_ROLE granted.");
  }

  // ─── 3. Approve on Manager ─────────────────────────────────────────────────
  console.log("\n─── 3. Approving new marketplace on Manager ────────────────────");
  const managerAbi = [
    "function setApprovalForAll(address operator, bool approved) external",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
  ];
  const manager = new ethers.Contract(MANAGER_ADDRESS, managerAbi, deployer);
  if (await manager.isApprovedForAll(deployerAddress, NEW_MARKETPLACE)) {
    console.log("  ✅ Already approved.");
  } else {
    const tx = await manager.setApprovalForAll(NEW_MARKETPLACE, true);
    await tx.wait();
    console.log("  ✅ Approved as operator.");
  }

  // ─── 4. Persist addresses ──────────────────────────────────────────────────
  console.log("\n─── 4. Writing deployed-addresses-sepolia.json ─────────────────");
  const info = {
    network: "baseSepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      AquadexManager: MANAGER_ADDRESS,
      AquadexMarketplace: NEW_MARKETPLACE,
      AquadexMarketplace_OLD: PREVIOUS_MARKETPLACE,
    },
    roles: {
      curator: kevin,
      marineConservationTreasury: kevin,
      ecosystemTreasury: kevin,
      kevin,
      steve,
      coFounder: kevin,
      fiatRelayer: relayerAddress,
    },
  };
  writeFileSync("deployed-addresses-sepolia.json", JSON.stringify(info, null, 2));
  console.log("  ✅ Written.");
  console.log("\n  Setup complete.\n");
}

main().catch((err) => {
  console.error("Finalize failed:", err.shortMessage || err.message);
  process.exit(1);
});
