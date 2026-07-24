/**
 * deploy-marketplace-v3.js
 *
 * Redeploys AquadexMarketplace to activate fulfillCashPickup (general cash
 * pickup settlement, Task 15 / pre-launch checklist item 2). The contract is
 * NOT upgradeable, so activating the new function requires a fresh deployment.
 *
 * The only source change since the live contract (065cb75 @ 0xEC4d21…77BF) is
 * the additive fulfillCashPickup function + its cashPickupSettled mapping, so
 * this redeploy carries no other behavioral change. Nothing is currently
 * escrowed on the live contract, so under the clean-slate beta posture this
 * loses no on-chain state.
 *
 * Steps:
 *   1. Deploy AquadexMarketplace (same constructor args as the live deploy).
 *   2. Ensure FIAT_RELAYER_ROLE is held by the backend relayer wallet
 *      (constructor auto-grants it to kevin; grant explicitly if the relayer
 *      wallet differs).
 *   3. Approve the new marketplace as operator on AquadexManager so the
 *      deployer/relayer can list (escrow) specimens into it.
 *   4. Persist the new address to deployed-addresses-sepolia.json (retaining
 *      the previous address under AquadexMarketplace_OLD).
 *
 * Run: npx hardhat run scripts/deploy-marketplace-v3.js --network baseSepolia
 */

import "dotenv/config";
import { network } from "hardhat";
import { readFileSync, writeFileSync } from "fs";

// ─── Constants (match the live deployment) ──────────────────────────────────
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const PREVIOUS_MARKETPLACE = "0xEC4d21Aa32c6c378Ba43E6d9038e93A9702177BF";

const kevin = "0xc42eD9F8Fc56F89380a8eD337169899f425Dc934";
const steve = "0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0";
const coFounder = kevin; // testnet: kevin holds the coFounder slot
const marineConservationTreasury = kevin;
const ecosystemTreasury = kevin;

/**
 * Best-effort read of RELAYER_PRIVATE_KEY from frontend/.env so we can confirm
 * the backend relayer wallet holds FIAT_RELAYER_ROLE. Returns null if the file
 * or key is absent (the constructor already grants the role to kevin).
 */
function readRelayerKey() {
  try {
    const env = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("RELAYER_PRIVATE_KEY="));
    if (!line) return null;
    const val = line.slice("RELAYER_PRIVATE_KEY=".length).trim().replace(/^["']|["']$/g, "");
    return val || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Deploy Marketplace v3 (fulfillCashPickup)         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const conn = await network.create("baseSepolia");
  const { ethers } = conn;

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("  Deployer:", deployerAddress);

  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log("  Balance :", ethers.formatEther(balance), "ETH\n");

  // ─── 1. Deploy ────────────────────────────────────────────────────────────
  console.log("─── 1. Deploying AquadexMarketplace v3 ─────────────────────────\n");
  const Factory = await ethers.getContractFactory("AquadexMarketplace");
  const marketplace = await Factory.deploy(
    MANAGER_ADDRESS,
    marineConservationTreasury,
    ecosystemTreasury,
    kevin,
    steve,
    coFounder
  );
  await marketplace.waitForDeployment();
  const newAddress = await marketplace.getAddress();
  console.log(`  ✅ Deployed: ${newAddress}`);
  console.log(`     TX: ${marketplace.deploymentTransaction().hash}\n`);

  // ─── 2. FIAT_RELAYER_ROLE for the backend relayer wallet ───────────────────
  console.log("─── 2. Ensuring FIAT_RELAYER_ROLE on the relayer wallet ────────\n");
  const FIAT_RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FIAT_RELAYER_ROLE"));

  let relayerAddress = deployerAddress;
  const relayerKey = readRelayerKey();
  if (relayerKey) {
    try {
      relayerAddress = new ethers.Wallet(relayerKey).address;
    } catch {
      console.log("  ⚠️  Could not derive relayer address from RELAYER_PRIVATE_KEY; using deployer.");
    }
  }
  console.log("  Relayer wallet:", relayerAddress);

  const hasRole = await marketplace.hasRole(FIAT_RELAYER_ROLE, relayerAddress);
  if (hasRole) {
    console.log("  ✅ Relayer already holds FIAT_RELAYER_ROLE (constructor grant).");
  } else {
    const tx = await marketplace.grantRole(FIAT_RELAYER_ROLE, relayerAddress);
    await tx.wait();
    console.log("  ✅ FIAT_RELAYER_ROLE granted to relayer.");
  }

  // ─── 3. Approve the new marketplace on the Manager ─────────────────────────
  console.log("\n─── 3. Approving new marketplace as operator on Manager ────────\n");
  const managerAbi = [
    "function setApprovalForAll(address operator, bool approved) external",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",
  ];
  const manager = new ethers.Contract(MANAGER_ADDRESS, managerAbi, deployer);
  const approved = await manager.isApprovedForAll(deployerAddress, newAddress);
  if (approved) {
    console.log("  ✅ Already approved.");
  } else {
    const tx = await manager.setApprovalForAll(newAddress, true);
    await tx.wait();
    console.log("  ✅ New marketplace approved as operator.");
  }

  // ─── 4. Persist addresses ──────────────────────────────────────────────────
  console.log("\n─── 4. Writing deployed-addresses-sepolia.json ─────────────────\n");
  const info = {
    network: "baseSepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      AquadexManager: MANAGER_ADDRESS,
      AquadexMarketplace: newAddress,
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

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log(`  New Marketplace: ${newAddress}`);
  console.log(`  Previous       : ${PREVIOUS_MARKETPLACE} (deprecated)`);
  console.log(`  Manager        : ${MANAGER_ADDRESS} (unchanged)`);
  console.log("");
  console.log("  Next: propagate MARKETPLACE_ADDRESS / VITE_MARKETPLACE_ADDRESS");
  console.log("  to .env files + Vercel, then wire fulfillCashPickup in stripe.js.");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Emit the new address on its own line for easy scripting/capture.
  console.log(`NEW_MARKETPLACE_ADDRESS=${newAddress}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
