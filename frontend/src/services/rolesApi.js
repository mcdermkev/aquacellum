/**
 * rolesApi.js
 *
 * Read access to the server-authoritative keeper-role grants (user_roles table,
 * see supabase/migrations/20260808_keeper_roles.sql).
 *
 * Roles ('founder', 'steward') confer social authority — creating schools,
 * giving audits, mentoring, hosting Tides, moderating. The client may READ these
 * (to gate UI and render a badge) but can NEVER grant them: user_roles has no
 * client write path, only service_role and SECURITY DEFINER functions write.
 *
 * These are consumed by entitlements.hasEntitlement via ctx.roles. Authority is
 * conferred, not earned — XP and tier are irrelevant here by design.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

/**
 * Fetch the active roles held by a wallet.
 *
 * @param {string} [walletAddress] - Defaults to the connected wallet
 * @returns {Promise<{data: string[], error: string|null}>} role keys, e.g. ["founder"]
 */
export async function getUserRoles(walletAddress) {
  if (!isSupabaseConfigured()) return { data: [], error: "Not configured" };

  const wallet = walletAddress || getCurrentWallet();
  if (!wallet) return { data: [], error: "Not connected" };

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("wallet_address", wallet.toLowerCase())
    .eq("active", true);

  if (error) return { data: [], error: error.message };

  return { data: (data || []).map((r) => r.role), error: null };
}
