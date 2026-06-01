/**
 * useSponsoredTransaction.js
 * 
 * Hook placeholder — Privy sponsored transactions are disabled.
 * When Privy is re-enabled, this will wrap useSendTransaction with sponsor: true.
 * 
 * For now, all users use the normal MetaMask signer flow (user pays gas).
 */

import { useAuth } from "../contexts/AuthContext";

export function useSponsoredTransaction() {
  const { loginMethod } = useAuth();

  const sendSponsored = async () => {
    throw new Error("Sponsored transactions are disabled. Privy is not configured.");
  };

  return {
    sendSponsored,
    state: null,
    isPrivyUser: false,
  };
}
