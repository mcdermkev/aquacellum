/**
 * create-test-seller.js
 *
 * Creates a Stripe Connected Account (test mode) for the deployer wallet
 * and inserts the mapping into Supabase so the checkout flow works.
 *
 * Run: node scripts/create-test-seller.js
 */

import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("frontend/.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
if (!STRIPE_SECRET_KEY) {
  console.error("❌ Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const SELLER_WALLET = "0xc42ed9f8fc56f89380a8ed337169899f425dc934";
const SELLER_EMAIL = "mcdermkev@gmail.com";

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function stripeRequest(endpoint, body) {
  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(STRIPE_SECRET_KEY + ":").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return response.json();
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Create Test Seller Account                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ─── Check if seller already exists in Supabase ──────────────────────────
  const checkResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/seller_stripe_accounts?wallet_address=eq.${SELLER_WALLET}&select=*`,
    { headers: supabaseHeaders }
  );
  const existing = await checkResponse.json();

  if (existing.length > 0) {
    console.log("  ✅ Seller record already exists:");
    console.log(`     Stripe Account: ${existing[0].stripe_account_id}`);
    console.log(`     Onboarding complete: ${existing[0].onboarding_complete}`);
    
    if (!existing[0].onboarding_complete) {
      console.log("\n  Marking onboarding_complete = true for testing...");
      await fetch(
        `${SUPABASE_URL}/rest/v1/seller_stripe_accounts?wallet_address=eq.${SELLER_WALLET}`,
        {
          method: "PATCH",
          headers: supabaseHeaders,
          body: JSON.stringify({ onboarding_complete: true }),
        }
      );
      console.log("  ✅ Updated to onboarding_complete = true");
    }
    console.log("\n  Done — seller is ready for testing.\n");
    return;
  }

  // ─── Create Stripe Connected Account (Express) ───────────────────────────
  console.log("  Creating Stripe Connected Account (Express)...");

  const account = await stripeRequest("/accounts", {
    type: "express",
    email: SELLER_EMAIL,
    "metadata[wallet_address]": SELLER_WALLET,
    "metadata[platform]": "aquadex",
    "business_profile[name]": "Aquadex Test Seller",
    "business_profile[product_description]": "Live aquarium fish specimens",
    "business_profile[mcc]": "5947",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
  });

  if (account.error) {
    console.error(`  ❌ Stripe error: ${account.error.message}`);
    process.exit(1);
  }

  console.log(`  ✅ Created Stripe account: ${account.id}`);

  // ─── Insert into Supabase ────────────────────────────────────────────────
  console.log("  Inserting seller record into Supabase...");

  const insertResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/seller_stripe_accounts`,
    {
      method: "POST",
      headers: supabaseHeaders,
      body: JSON.stringify({
        wallet_address: SELLER_WALLET,
        stripe_account_id: account.id,
        email: SELLER_EMAIL,
        display_name: "Kevin McDermott",
        onboarding_complete: true, // For testing — skip real KYC
      }),
    }
  );

  if (!insertResponse.ok) {
    const err = await insertResponse.text();
    console.error(`  ❌ Supabase insert failed: ${err}`);
    process.exit(1);
  }

  const inserted = await insertResponse.json();
  console.log(`  ✅ Seller record inserted`);
  console.log("");
  console.log("  Summary:");
  console.log(`    Wallet: ${SELLER_WALLET}`);
  console.log(`    Stripe Account: ${account.id}`);
  console.log(`    Onboarding: true (test mode — skipped KYC)`);
  console.log("");
  console.log("  ⚠️  Note: This is a test-mode Connected Account.");
  console.log("  For Stripe Connect destination charges to work fully in test mode,");
  console.log("  the account needs charges_enabled = true. In test mode Stripe");
  console.log("  usually enables this automatically, but if checkout fails with");
  console.log("  'destination account not ready', complete onboarding via the link below.");
  console.log("");

  // Generate onboarding link just in case
  const link = await stripeRequest("/account_links", {
    account: account.id,
    type: "account_onboarding",
    return_url: "https://aquacellum.com/seller/onboarding-complete",
    refresh_url: "https://aquacellum.com/seller/onboarding-refresh",
  });

  if (link.url) {
    console.log(`  Onboarding URL (if needed): ${link.url}`);
  }

  console.log("\n  Done — seller is ready for E2E testing.\n");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
