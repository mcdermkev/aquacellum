/**
 * wallet.js — canonical wallet-address normalization helpers.
 *
 * THE INVARIANT (site-wide): wallet addresses are stored and compared in
 * canonical LOWERCASE. The Supabase session wallet (getCurrentWallet) is
 * lowercase, and the `20260630_normalize_wallet_casing` migration lowercases
 * every wallet column in the DB and installs triggers that force lowercase
 * forever.
 *
 * WHY THIS HELPER EXISTS: addresses that arrive from a wallet provider / on-chain
 * source (Privy/MetaMask/ethers via `useAuth().account`, contract reads, etc.)
 * are EIP-55 CHECKSUMMED (mixed case). Those values never pass through the DB
 * triggers, so any client-side comparison between a provider address and a
 * lowercase DB/session value must normalize BOTH sides or it silently fails
 * (e.g. "is this my post/order/listing/conversation" checks return false).
 *
 * Always compare wallets with `sameWallet(a, b)` rather than `a === b`.
 */

/**
 * Normalize a wallet address to canonical form (trimmed, lowercase).
 * Returns null for any falsy / non-string input so callers can guard cleanly.
 *
 * @param {unknown} addr
 * @returns {string|null}
 */
export function normalizeWallet(addr) {
  if (!addr || typeof addr !== "string") return null;
  const trimmed = addr.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Case-insensitive, null-safe wallet equality.
 * Returns false if either side is missing (two missing wallets are NOT "equal").
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameWallet(a, b) {
  const na = normalizeWallet(a);
  const nb = normalizeWallet(b);
  if (na === null || nb === null) return false;
  return na === nb;
}
