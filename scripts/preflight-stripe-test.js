/**
 * preflight-stripe-test.js
 * 
 * Checks all prerequisites for an end-to-end Stripe fiat purchase test:
 *   1. Relayer wallet has FIAT_RELAYER_ROLE on AquadexMarketplace
 *   2. There is at least one active listing on-chain (or we know we need to create one)
 *   3. Relayer wallet has enough ETH for gas
 *   4. Stripe keys are configured (can reach the API)
 *   5. Seller has a connected Stripe account in Supabase (checked via the API)
 *
 * Run: npx hardhat run scripts/preflight-stripe-test.js
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config();

// ─── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const RELAYER_KEY = process.env.PRIVATE_KEY; // deployer == relayer on testnet
const MARKETPLACE_ADDRESS = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";

const FIAT_RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FIAT_RELAYER_ROLE"));

// ABI fragments we need
const MARKETPLACE_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function listings(uint256 tokenId) view returns (uint256 tokenId, address seller, uint256 price, uint256 shippingFee, bool active, bool isShipping)",
  "function fiatSettlements(bytes32 hash) view returns (bool)",
];

const MANAGER_ABI = [
  "function totalSpecimensMinted() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function specimens(uint256 id) view returns (uint256 specimenId, uint256 speciesId, uint256 birthTimestamp, address breeder, uint256 currentTankId, uint256 sireId, uint256 damId, string ipfsMetadataUri, uint8 status)",
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Stripe E2E Preflight Check                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // --- Provider & Wallet Setup ---
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  if (!RELAYER_KEY) {
    fail("PRIVATE_KEY not set in .env — cannot check relayer wallet");
    process.exit(1);
  }

  const relayerWallet = new ethers.Wallet(RELAYER_KEY, provider);
  const relayerAddress = relayerWallet.address;

  console.log("─── 1. Network & Wallet ───────────────────────────────────────\n");
  
  const network = await provider.getNetwork();
  info(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  info(`Relayer wallet: ${relayerAddress}`);
  
  const balance = await provider.getBalance(relayerAddress);
  const balanceEth = ethers.formatEther(balance);
  
  if (balance > ethers.parseEther("0.001")) {
    pass(`Relayer balance: ${balanceEth} ETH (sufficient for gas)`);
  } else {
    fail(`Relayer balance: ${balanceEth} ETH — needs Base Sepolia ETH for gas!`);
    info("Get testnet ETH from: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet");
  }

  // --- FIAT_RELAYER_ROLE Check ---
  console.log("\n─── 2. FIAT_RELAYER_ROLE ───────────────────────────────────────\n");

  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);

  const hasRole = await marketplace.hasRole(FIAT_RELAYER_ROLE, relayerAddress);
  if (hasRole) {
    pass(`Relayer ${relayerAddress} has FIAT_RELAYER_ROLE`);
  } else {
    fail(`Relayer ${relayerAddress} does NOT have FIAT_RELAYER_ROLE`);
    info("Grant it with: marketplace.grantRole(FIAT_RELAYER_ROLE, relayerAddress)");
    info("Only an account with DEFAULT_ADMIN_ROLE can grant this.");
  }

  // --- Active Listings Check ---
  console.log("\n─── 3. Active Listings ────────────────────────────────────────\n");

  const manager = new ethers.Contract(MANAGER_ADDRESS, MANAGER_ABI, provider);
  const totalMinted = await manager.totalSpecimensMinted();
  info(`Total specimens minted: ${totalMinted}`);

  let activeListing = null;
  const maxCheck = Math.min(Number(totalMinted), 50); // Check up to 50 tokens

  for (let i = 1; i <= maxCheck; i++) {
    try {
      const listing = await marketplace.listings(i);
      if (listing.active) {
        activeListing = {
          tokenId: i,
          seller: listing.seller,
          price: listing.price,
          isShipping: listing.isShipping,
        };
        break;
      }
    } catch (e) {
      // Token may not exist or listing slot is empty
    }
  }

  if (activeListing) {
    pass(`Found active listing: Token #${activeListing.tokenId}`);
    info(`  Seller: ${activeListing.seller}`);
    info(`  Price: ${ethers.formatEther(activeListing.price)} ETH`);
    info(`  Shipping: ${activeListing.isShipping}`);
  } else {
    warn("No active listings found on-chain (checked tokens 1–" + maxCheck + ")");
    info("You'll need to mint a specimen and list it before testing.");
    info("The test script can do this for you (next step).");
  }

  // --- Stripe API Check ---
  console.log("\n─── 4. Stripe API Keys ────────────────────────────────────────\n");

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey) {
    // Check frontend .env
    try {
      const frontendEnv = readFileSync("frontend/.env", "utf8");
      const match = frontendEnv.match(/STRIPE_SECRET_KEY=(.+)/);
      if (match) {
        info("STRIPE_SECRET_KEY found in frontend/.env (not root .env)");
        // Quick Stripe API ping
        const response = await fetch("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${match[1].trim()}` },
        });
        if (response.ok) {
          pass("Stripe API reachable — keys are valid");
          const data = await response.json();
          info(`  Stripe mode: ${data.livemode ? "LIVE ⚠️" : "TEST ✅"}`);
          info(`  Available balance: ${data.available?.[0]?.amount || 0} cents ${data.available?.[0]?.currency || "usd"}`);
        } else {
          fail(`Stripe API returned ${response.status} — check your secret key`);
        }
      } else {
        fail("STRIPE_SECRET_KEY not found in root or frontend .env");
      }
    } catch (e) {
      fail("Could not read frontend/.env to find Stripe key");
    }
  } else {
    const response = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${stripeSecretKey}` },
    });
    if (response.ok) {
      pass("Stripe API reachable — keys are valid");
      const data = await response.json();
      info(`  Stripe mode: ${data.livemode ? "LIVE ⚠️" : "TEST ✅"}`);
    } else {
      fail(`Stripe API returned ${response.status} — check your secret key`);
    }
  }

  if (stripeWebhookSecret) {
    pass(`STRIPE_WEBHOOK_SECRET is set (${stripeWebhookSecret.substring(0, 10)}...)`);
  } else {
    // Check frontend .env
    try {
      const frontendEnv = readFileSync("frontend/.env", "utf8");
      const match = frontendEnv.match(/STRIPE_WEBHOOK_SECRET=(.+)/);
      if (match) {
        pass(`STRIPE_WEBHOOK_SECRET found in frontend/.env (${match[1].trim().substring(0, 10)}...)`);
      } else {
        fail("STRIPE_WEBHOOK_SECRET not found");
      }
    } catch (e) {
      warn("STRIPE_WEBHOOK_SECRET not in root .env (may be in Vercel env vars only)");
    }
  }

  // --- Supabase seller_stripe_accounts check (via deployed API) ---
  console.log("\n─── 5. Seller Stripe Connect Account ──────────────────────────\n");

  const sellerWallet = relayerAddress; // On testnet, deployer is likely the seller too
  
  try {
    const apiUrl = `https://aquacellum.com/api/stripe?action=connect-onboard&wallet=${sellerWallet.toLowerCase()}`;
    const response = await fetch(apiUrl);
    
    if (response.ok) {
      const data = await response.json();
      if (data.connected && data.onboardingComplete) {
        pass(`Seller ${sellerWallet} has a connected Stripe account`);
        info(`  Stripe Account ID: ${data.stripeAccountId}`);
        info(`  Charges enabled: ${data.chargesEnabled}`);
        info(`  Payouts enabled: ${data.payoutsEnabled}`);
      } else if (data.connected && !data.onboardingComplete) {
        warn(`Seller has a Stripe account but onboarding is incomplete`);
        info("Complete onboarding at: POST /api/stripe?action=connect-onboard with walletAddress");
      } else {
        warn(`Seller ${sellerWallet} has NO connected Stripe account`);
        info("The seller needs to onboard via POST /api/stripe?action=connect-onboard");
        info("For testing, you can insert a test record directly in Supabase:");
        info("  Table: seller_stripe_accounts");
        info("  wallet_address: " + sellerWallet.toLowerCase());
        info("  stripe_account_id: (create via Stripe dashboard or API)");
        info("  onboarding_complete: true");
      }
    } else {
      warn(`API returned ${response.status} — could not check seller status`);
      info("This might mean the API isn't deployed yet or Supabase isn't configured.");
    }
  } catch (e) {
    warn(`Could not reach API: ${e.message}`);
    info("Make sure aquacellum.com is deployed and /api/stripe?action=connect-onboard is working.");
  }

  // --- Summary ---
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  PREFLIGHT COMPLETE — Review results above before testing.");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Preflight script failed:", err);
  process.exit(1);
});
