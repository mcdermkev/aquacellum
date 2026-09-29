/**
 * profileColumns.js
 *
 * Which `profiles` columns the browser may read, and how the signed-in user
 * reads their OWN private fields.
 *
 * WHY. `profiles` used to be fully readable by anyone holding the public anon
 * key, email included. Migration 20261003_profiles_private_columns.sql turns the
 * table into a column allowlist for the anon and authenticated roles. After it,
 * `select("*")` on profiles from the browser fails with 42501, so every browser
 * read must name its columns from PUBLIC_PROFILE_COLUMNS.
 *
 * Private columns (email, notification_preferences, privacy_settings,
 * reward_credits, zone_transfer_cooldown, deletion_requested_at, ban flags ...)
 * are readable only by their owner, through the `my_profile_private()` RPC,
 * which identifies the caller from the signed JWT claim, never from an argument.
 */

import { supabase, getCurrentWallet, isFullyAuthenticated, isSupabaseConfigured } from "./supabaseClient";

/** Every column the database grants to browser roles. Keep in sync with the migration. */
export const PUBLIC_PROFILE_COLUMN_LIST = Object.freeze([
  "wallet_address",
  "display_name",
  "avatar_url",
  "bio",
  "tank_count",
  "species_count",
  "xp_total",
  "companion_tier",
  "created_at",
  "updated_at",
  "accepting_mentees",
  "depth_score",
  "depth_tier",
  "zone_hash",
  "total_xp",
  "current_tier",
]);

/** The same list as a PostgREST select string. */
export const PUBLIC_PROFILE_COLUMNS = PUBLIC_PROFILE_COLUMN_LIST.join(", ");

/**
 * The signed-in user's own full profile row (public + private columns).
 *
 * Requires the JWT bridge: in anon/header mode there is no signed identity and
 * this returns `{ data: null, error: "Not signed in" }` rather than guessing.
 *
 * Deploy-order safety: if the RPC does not exist yet (migration not applied,
 * PostgREST PGRST202), fall back to a direct owner-row read, which still works
 * until the column lockdown lands.
 *
 * @returns {Promise<{ data: object|null, error: string|null }>}
 */
export async function fetchMyPrivateProfile() {
  if (!isSupabaseConfigured()) return { data: null, error: "Not configured" };
  if (!isFullyAuthenticated()) return { data: null, error: "Not signed in" };

  const { data, error } = await supabase.rpc("my_profile_private");
  if (!error) return { data: data || null, error: null };

  if (error.code === "PGRST202") {
    const wallet = getCurrentWallet();
    if (!wallet) return { data: null, error: "Not connected" };
    const { data: row, error: rowError } = await supabase
      .from("profiles")
      .select("*")
      .ilike("wallet_address", wallet)
      .maybeSingle();
    return { data: row || null, error: rowError?.message || null };
  }

  return { data: null, error: error.message || "Could not load your profile" };
}

/**
 * Merge the caller's private fields into a public profile row, but only when
 * the row IS the caller's. Anyone else's row is returned untouched. Failures
 * return the public row as-is so a public read never breaks on the private one.
 *
 * @param {object|null} row - a row selected with PUBLIC_PROFILE_COLUMNS
 * @returns {Promise<object|null>}
 */
export async function withOwnPrivateFields(row) {
  if (!row?.wallet_address) return row;
  const me = getCurrentWallet();
  if (!me || String(row.wallet_address).toLowerCase() !== me) return row;
  try {
    const { data } = await fetchMyPrivateProfile();
    return data ? { ...row, ...data } : row;
  } catch {
    return row;
  }
}
