/**
 * appConfig.js — Application-level constants and configuration
 * 
 * Extracted from App.jsx for clarity and reusability.
 * These are environment-independent (not .env vars) — they're
 * deployment-specific addresses and access control lists.
 */

// ── Deployed Contract Addresses — Base Sepolia Testnet ─────────────────────
// Deployed: May 29, 2026 | Chain ID: 84532
export const CONTRACT_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
export const MARKETPLACE_ADDRESS = "0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e";
export const COMPANION_ADDRESS = import.meta.env.VITE_COMPANION_ADDRESS || "0x90EB869AE5c7b0BcecF1b0BFE74A148A50C653B8";

// ── Founders Dashboard Access Control ──────────────────────────────────────
// Only these wallet addresses can see the "Founders" tab.
// `account` from useAuth() is the Privy embedded wallet (EOA), NOT the smart wallet.
export const FOUNDER_WALLETS = [
  "0x53d3c6f4f11b0b08bc1a5034bbce7d46198b6851", // Kevin — old shared smart wallet (legacy)
  "0x9174d162ed1ab6594064fa0ffbfaf063dc20f3c6", // Kevin — per-user smart wallet (current)
  "0x41e562ee88825ad8d79b48311a30742ac276c9eb", // Second founder — Smart wallet
];

// Also match by prefix+suffix for partial-match fallback (truncated addresses)
export const FOUNDER_WALLET_PATTERNS = [
  { prefix: "0x53d3c6", suffix: "6851" },
  { prefix: "0x4a85", suffix: "a6d3" },  // EOA (Privy embedded wallet)
  { prefix: "0x41e562", suffix: "c9eb" }, // Second founder
  { prefix: "0x9174d1", suffix: "f3c6" }, // Kevin per-user smart wallet
];

// ── Storefront Beta Allowlist ─────────────────────────────────────────────
// Wallets that can access the "My Store" tab during beta.
export const STOREFRONT_BETA_WALLETS = [
  ...FOUNDER_WALLETS,
  // Add beta tester wallets below:
  // "0xYOUR_TESTER_WALLET_HERE",
];

// ── Valid tab names for URL hash routing ──────────────────────────────────
// Note: the legacy "storefront" ("My Store") tab was consolidated into
// "breeder-terminal". App.jsx redirects any old /app/storefront links there.
export const VALID_TABS = [
  "tanks", "breeder", "directory", "gallery", "map",
  "orders", "incoming", "reef", "settings", "founders",
  "breeder-terminal",
];

/**
 * Check if a wallet address (EOA or smart wallet) belongs to a founder.
 */
export function isFounderWallet(account, smartWalletAddress = null) {
  if (!account) return false;
  const addr = account.toLowerCase();
  if (FOUNDER_WALLETS.includes(addr)) return true;
  if (FOUNDER_WALLET_PATTERNS.some(
    (p) => addr.startsWith(p.prefix.toLowerCase()) && addr.endsWith(p.suffix.toLowerCase())
  )) return true;
  if (smartWalletAddress && FOUNDER_WALLETS.includes(smartWalletAddress.toLowerCase())) return true;
  return false;
}

/**
 * Format a sync timestamp into a human-readable relative time.
 */
export function formatSyncTime(date) {
  if (!date) return "";
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  return date.toLocaleDateString();
}
