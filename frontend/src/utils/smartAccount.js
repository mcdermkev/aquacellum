/**
 * smartAccount.js
 * Provider and signer utilities for Aquadex Protocol.
 *
 * Network: Base Sepolia Testnet (Chain ID: 84532)
 *
 * Provider strategy:
 *   - If window.ethereum is available (MetaMask / Coinbase Wallet), use Web3Provider
 *     so the user signs transactions with their real wallet.
 *   - If no injected wallet is present (e.g. server-side or headless), fall back to a
 *     read-only JsonRpcProvider pointed at the public Base Sepolia RPC. This allows
 *     read-only contract calls (species catalog, listings) to work without a wallet.
 *
 * Signer strategy:
 *   - If a Privy signer resolver is registered (social login users), use that.
 *   - Otherwise fall back to MetaMask/injected wallet signer.
 *
 * NOTE: Using ethers v5 to avoid circular dependency issues present in v6
 */

import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Network constants
// ---------------------------------------------------------------------------
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_RPC_URL  = "https://base-sepolia-rpc.publicnode.com";

/**
 * Fallback RPC endpoints, in priority order (higher rate limits first).
 *
 * ⚠️ EVERY ENTRY MUST SEND CORS HEADERS. These are called from the browser, so an
 * endpoint without `Access-Control-Allow-Origin` cannot work here at all — no
 * matter that it responds perfectly to curl or to a server-side call.
 *
 * This list used to include `base-sepolia.blockpi.network/v1/rpc/public`, which
 * started returning 521 with no CORS headers. Because `getProvider()` builds a
 * FallbackProvider with a 2s stall timeout, a dead entry is not skipped quietly —
 * reads rotate onto it constantly, and each attempt logs a CORS failure plus an
 * ERR_FAILED. One dead endpoint was producing dozens of console errors per page
 * load while the app still worked, which is the worst kind of fault: loud, and
 * easy to mistake for something else being broken.
 *
 * Verify before adding one, from a browser origin — not with curl:
 *   curl -sI -X OPTIONS <url> -H 'Origin: https://aquacellum.com' \
 *     -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
 * and confirm `eth_chainId` returns 0x14a34 (84532).
 *
 * Checked 2026-08-16: all three below return an ACAO header and chainId 84532.
 */
const RPC_ENDPOINTS = [
  "https://base-sepolia-rpc.publicnode.com",
  "https://sepolia.base.org", // Base's own public endpoint
  "https://base-sepolia.drpc.org",
];

export const BASE_SEPOLIA_CHAIN_PARAMS = {
  chainId:          "0x14A34",          // 84532 in hex
  chainName:        "Base Sepolia",
  nativeCurrency:   { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls:          [BASE_SEPOLIA_RPC_URL],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

// ---------------------------------------------------------------------------
// Privy signer bridge
// The AuthContext registers a signer resolver here so that all components
// importing getSigner() from this file automatically get the right signer
// regardless of login method (Privy or MetaMask).
// ---------------------------------------------------------------------------
let _privySignerResolver = null;

/**
 * Register a signer resolver from the AuthContext.
 * Called once when AuthProvider mounts.
 */
export function registerSignerResolver(resolver) {
  _privySignerResolver = resolver;
}

/**
 * Unregister the signer resolver (cleanup on unmount).
 */
export function unregisterSignerResolver() {
  _privySignerResolver = null;
}

// ---------------------------------------------------------------------------
// Read-only fallback provider (no wallet required)
// ---------------------------------------------------------------------------
let _readOnlyProvider = null;

export function getProvider() {
  if (!_readOnlyProvider) {
    const providers = RPC_ENDPOINTS.map((url, i) => ({
      provider: new ethers.providers.StaticJsonRpcProvider(url, {
        name: "base-sepolia",
        chainId: BASE_SEPOLIA_CHAIN_ID,
      }),
      priority: i + 1,
      stallTimeout: 2000,
      weight: 1,
    }));
    _readOnlyProvider = new ethers.providers.FallbackProvider(
      providers,
      1
    );
  }
  return _readOnlyProvider;
}

// ---------------------------------------------------------------------------
// Legacy session key helpers — kept as no-op for backward compatibility
// ---------------------------------------------------------------------------

export function getSmartAccountAddress() {
  return null;
}

/**
 * Returns a signer for sending transactions.
 * 
 * Priority:
 *   1. If a Privy signer resolver is registered (user logged in via Google/Email),
 *      use the embedded wallet's signer.
 *   2. Otherwise, use MetaMask/injected wallet (window.ethereum).
 * 
 * NOTE: During beta, most on-chain writes go through the server-side relayer
 * (api/relay-transaction) instead of this function. This is used as a fallback
 * for any client-side signing needs.
 */
export async function getSigner() {
  // If Privy auth is active, use its signer
  if (_privySignerResolver) {
    try {
      const signer = await _privySignerResolver();
      if (signer) return signer;
    } catch (err) {
      console.warn("Privy signer unavailable, falling back to injected wallet:", err.message);
    }
  }

  // Fallback: MetaMask / injected wallet
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error(
      "No wallet detected. Please install MetaMask or use Privy login."
    );
  }

  const provider = new ethers.providers.Web3Provider(window.ethereum);

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
    await switchToBaseSepolia();
    return new ethers.providers.Web3Provider(window.ethereum).getSigner();
  }

  return provider.getSigner();
}

/**
 * Prompts the user to switch to Base Sepolia.
 */
export async function switchToBaseSepolia() {
  if (typeof window === "undefined" || !window.ethereum) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_PARAMS.chainId }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [BASE_SEPOLIA_CHAIN_PARAMS],
      });
    } else {
      throw switchError;
    }
  }
}
