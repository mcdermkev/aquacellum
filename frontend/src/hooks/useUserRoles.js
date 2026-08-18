/**
 * useUserRoles.js
 *
 * React Query hook for a wallet's server-authoritative keeper roles
 * (founder / steward). Returns the query object; `data` is a string[] of role
 * keys, defaulting to [] until loaded.
 *
 * Used to gate social-authority UI (via entitlements ctx.roles) and to render a
 * Founder/Steward badge on a profile. Roles are conferred server-side and can
 * never be set from the client — see rolesApi.js.
 */

import { useQuery } from "@tanstack/react-query";
import { getUserRoles } from "../services/rolesApi";
import { getCurrentWallet, isSupabaseConfigured } from "../services/supabaseClient";
import { unwrap } from "../utils/unwrapEnvelope";

export function useUserRoles(walletAddress) {
  const wallet = walletAddress || getCurrentWallet();

  return useQuery({
    queryKey: ["reef", "user-roles", wallet],
    queryFn: () => unwrap(getUserRoles(wallet), "getUserRoles"),
    enabled: !!wallet && isSupabaseConfigured(),
    // Roles change rarely (a manual grant), so cache generously.
    staleTime: 5 * 60 * 1000,
  });
}
