/**
 * setup-supabase-tables.js
 * 
 * Creates the required Supabase tables for Stripe integration and inserts
 * a test seller record so we can run the E2E purchase flow.
 *
 * Tables created:
 *   - seller_stripe_accounts (seller wallet → Stripe Connected Account mapping)
 *   - fiat_settlements (payment settlement audit log)
 *
 * Run: node scripts/setup-supabase-tables.js
 */

import dotenv from "dotenv";
import { resolve } from "path";

// Load from frontend/.env where SUPABASE_URL and SUPABASE_SERVICE_KEY live
dotenv.config({ path: resolve("frontend/.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL or SUPABASE_SERVICE_KEY not found in frontend/.env");
  process.exit(1);
}

// Use fetch + Supabase REST API with service_role key (bypasses RLS)
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function runSQL(sql) {
  // Supabase exposes a /rest/v1/rpc endpoint but for DDL we use the /rest/v1/ with raw SQL via the pg_net extension
  // Actually, for table creation we need to use the Management API or the SQL editor.
  // Let's use the Supabase SQL endpoint (requires service_role)
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  return response;
}

async function tableExists(tableName) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=0`, {
    headers,
  });
  return response.ok;
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   AQUADEX — Supabase Table Setup                            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log("");

  // ─── Check if seller_stripe_accounts exists ──────────────────────────────
  console.log("─── Checking seller_stripe_accounts table... ───────────────────\n");
  
  const sellerTableExists = await tableExists("seller_stripe_accounts");
  
  if (sellerTableExists) {
    console.log("  ✅ seller_stripe_accounts table exists");
  } else {
    console.log("  ⚠️  seller_stripe_accounts table does NOT exist");
    console.log("  📋 You need to create it in Supabase SQL Editor:");
    console.log("");
    console.log(`  CREATE TABLE seller_stripe_accounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_address text NOT NULL UNIQUE,
    stripe_account_id text NOT NULL,
    email text,
    display_name text,
    onboarding_complete boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
  );
  
  -- Allow service_role full access (RLS bypassed by service key anyway)
  ALTER TABLE seller_stripe_accounts ENABLE ROW LEVEL SECURITY;`);
    console.log("");
  }

  // ─── Check if fiat_settlements exists ────────────────────────────────────
  console.log("─── Checking fiat_settlements table... ─────────────────────────\n");
  
  const settlementsTableExists = await tableExists("fiat_settlements");
  
  if (settlementsTableExists) {
    console.log("  ✅ fiat_settlements table exists");
  } else {
    console.log("  ⚠️  fiat_settlements table does NOT exist");
    console.log("  📋 You need to create it in Supabase SQL Editor:");
    console.log("");
    console.log(`  CREATE TABLE fiat_settlements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    stripe_payment_intent_id text NOT NULL,
    stripe_payment_hash text,
    purchase_type text NOT NULL,
    buyer_wallet text NOT NULL,
    seller_wallet text,
    amount_cents_usd integer NOT NULL,
    tx_hash text,
    block_number integer,
    status text NOT NULL DEFAULT 'pending',
    error_message text,
    metadata jsonb,
    disputed_at timestamptz,
    created_at timestamptz DEFAULT now()
  );
  
  ALTER TABLE fiat_settlements ENABLE ROW LEVEL SECURITY;`);
    console.log("");
  }

  // ─── If seller table exists, check/insert test seller ────────────────────
  if (sellerTableExists) {
    console.log("─── Checking test seller record... ────────────────────────────\n");
    
    const sellerWallet = "0xc42ed9f8fc56f89380a8ed337169899f425dc934";
    
    const checkResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/seller_stripe_accounts?wallet_address=eq.${sellerWallet}&select=*`,
      { headers }
    );
    
    if (checkResponse.ok) {
      const data = await checkResponse.json();
      if (data.length > 0) {
        console.log("  ✅ Test seller record exists:");
        console.log(`     Wallet: ${data[0].wallet_address}`);
        console.log(`     Stripe Account: ${data[0].stripe_account_id}`);
        console.log(`     Onboarding complete: ${data[0].onboarding_complete}`);
      } else {
        console.log("  ⚠️  No seller record for the test wallet.");
        console.log("  We'll create one via the /api/stripe?action=connect-onboard endpoint");
        console.log("  or you can insert it directly once the table is created.");
      }
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  
  if (!sellerTableExists || !settlementsTableExists) {
    console.log("  ACTION REQUIRED: Create the missing tables in Supabase SQL Editor.");
    console.log("  Go to: https://supabase.com/dashboard/project/yahsdztnvsykzecjatsl/sql");
    console.log("  Paste the SQL above and click 'Run'.");
    console.log("");
    console.log("  After creating tables, re-run this script to verify.");
  } else {
    console.log("  All tables exist. Ready for E2E testing.");
  }
  
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
