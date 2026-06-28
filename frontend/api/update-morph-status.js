/**
 * Vercel Serverless Function: /api/update-morph-status
 *
 * Curator-gated status flip for morph submissions (pending → verified/rejected).
 * Uses the Supabase service role key (bypasses RLS — the morph_submissions
 * UPDATE policy is service_role-only), but first verifies that the caller is the
 * on-chain curator by reading `curator()` from the AquadexManager contract.
 *
 * "curator" is an on-chain contract role with no Supabase JWT claim, so RLS
 * cannot express it — hence this privileged route (same pattern the app uses for
 * xp_events → /api/validate-xp).
 *
 * POST body: { id, status, callerWallet, note? }
 * Returns: { data: row } | { error: string }
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY, plus a manager address
 * (VITE_MANAGER_ADDRESS / MANAGER_ADDRESS) and an RPC URL
 * (VITE_RPC_URL / BASE_SEPOLIA_RPC_URL) in the environment.
 *
 * NOTE (security): this verifies callerWallet == on-chain curator, but does not
 * yet verify a signature/Privy token proving control of that wallet. The curator
 * address is public, so for full hardening add signed-proof verification.
 */

import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { handleCorsPreFlight } from "./_lib/cors.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MANAGER_ADDRESS =
  process.env.MANAGER_ADDRESS ||
  process.env.VITE_MANAGER_ADDRESS ||
  process.env.VITE_CONTRACT_ADDRESS ||
  "";
const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  process.env.BASE_SEPOLIA_RPC_URL ||
  "";

const VALID_STATUSES = ["pending", "verified", "rejected"];

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _supabase;
}

/**
 * Read the on-chain curator address. Returns lowercased address, or null if it
 * can't be resolved (missing config / RPC failure).
 */
async function getOnChainCurator() {
  if (!MANAGER_ADDRESS || !RPC_URL) return { error: "not_configured" };
  try {
    // ethers v5 API (the installed major version).
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(
      MANAGER_ADDRESS,
      ["function curator() view returns (address)"],
      provider
    );
    const addr = await contract.curator();
    return { curator: String(addr).toLowerCase() };
  } catch (err) {
    console.error("[update-morph-status] curator() read failed:", err.message);
    return { error: "rpc_failed" };
  }
}

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error("[update-morph-status] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return res.status(503).json({ error: "Service not configured (missing Supabase env vars)" });
  }

  const { id, status, callerWallet, note } = req.body || {};

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "id is required" });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  if (!callerWallet || typeof callerWallet !== "string") {
    return res.status(400).json({ error: "callerWallet is required" });
  }

  // Verify the caller is the on-chain curator.
  const { curator, error: curatorErr } = await getOnChainCurator();
  if (curatorErr === "not_configured") {
    return res.status(503).json({ error: "Curator verification not configured (missing manager address / RPC URL)" });
  }
  if (curatorErr === "rpc_failed" || !curator) {
    return res.status(502).json({ error: "Could not verify curator on-chain. Try again." });
  }
  if (callerWallet.toLowerCase() !== curator) {
    return res.status(403).json({ error: "Only the curator can review morph submissions." });
  }

  try {
    const { data, error } = await supabase
      .from("morph_submissions")
      .update({
        status,
        reviewer_wallet: callerWallet.toLowerCase(),
        review_note: typeof note === "string" && note.trim() ? note.trim() : null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[update-morph-status] Update failed:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ data });
  } catch (err) {
    console.error("[update-morph-status] Unexpected error:", err);
    return res.status(500).json({ error: err.message });
  }
}
