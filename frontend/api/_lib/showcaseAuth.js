// Fish Room R1.3B — authentication, owner resolution, and wallet-link cryptography.
//
// Owner authority is ALWAYS the server-resolved owner_id derived from the verified Privy subject via
// the allowlisted RPC. A body-supplied owner/subject/entity is never authority. A verified token
// without a wallet claim still authorizes ordinary shell/Room reads and mutations; only wallet-link
// needs the token wallet claim.

import { ethers } from "ethers";
import {
  verifyPrivyToken,
  isPrivyConfigurationFailure,
} from "./verifyPrivyToken.js";

// Read the Fish Room server configuration. Missing sensitive config does not crash; the specific
// action that needs it fails, and bootstrap reports availability.
export function getShowcaseConfig() {
  const appOrigin = (process.env.SHOWCASE_APP_ORIGIN || "").trim();
  const chainId = (process.env.SHOWCASE_CHAIN_ID || "").trim();
  const privyAppId = (process.env.PRIVY_APP_ID || "").trim();
  return {
    appOrigin: appOrigin || null,
    chainId: /^[1-9][0-9]{0,18}$/.test(chainId) ? chainId : null,
    privyAppId: privyAppId || null,
  };
}

// Verify the Privy access token. Returns a discriminated result the route maps to an envelope.
export async function verifyShowcaseSession(req) {
  const result = await verifyPrivyToken(req);
  if (isPrivyConfigurationFailure(result)) {
    return { ok: false, status: 503, code: "authentication_unavailable" };
  }
  if (!result.verified) {
    const code = result.code === "TOKEN_EXPIRED" ? "token_expired"
      : (result.code === "AUTH_HEADER_INVALID" || result.code === "TOKEN_MALFORMED") ? "authentication_required"
      : "token_invalid";
    return { ok: false, status: 401, code };
  }
  return { ok: true, subject: result.userId, walletAddress: result.walletAddress || null };
}

// Resolve the server-owned owner_id for a verified Privy subject (idempotent, allowlisted RPC).
export async function resolveOwnerId(supabase, subject) {
  const { data, error } = await supabase.rpc("showcase_resolve_owner_principal", { p_privy_user_id: subject });
  if (error) return { ok: false, error };
  return { ok: true, ownerId: data };
}

// Normalize a wallet: lowercase is accepted; mixed case only when valid EIP-55; bad checksum rejects.
export function normalizeWallet(input) {
  if (typeof input !== "string" || !/^0x[0-9A-Fa-f]{40}$/.test(input)) return null;
  const lower = input.toLowerCase();
  if (input !== lower) {
    let checksummed;
    try {
      checksummed = ethers.utils.getAddress(input);
    } catch {
      return null;
    }
    if (checksummed !== input) return null; // incorrect mixed case
  }
  let display;
  try {
    display = ethers.utils.getAddress(lower);
  } catch {
    return null;
  }
  return { normalized: lower, display };
}

// The exact section 9 EIP-191 wallet-link message: LF-separated, no trailing LF.
export function buildWalletLinkMessage({ appOrigin, privyAppId, subject, normalizedWallet, chainId, nonce, issuedAt, expirationTime }) {
  const host = new URL(appOrigin).host;
  return [
    "Aquadex Fish Room Wallet Link",
    "",
    "Version: 1",
    "Domain: " + host,
    "Origin: " + appOrigin,
    "Privy App ID: " + privyAppId,
    "Privy Subject: " + subject,
    "Wallet: " + normalizedWallet,
    "Chain ID: " + chainId,
    "Purpose: link_showcase_wallet",
    "Nonce: " + nonce,
    "Issued At: " + issuedAt,
    "Expiration Time: " + expirationTime,
  ].join("\n");
}

// Recover the EIP-191 (personal_sign) signer and return the lowercase address, or null.
export function recoverEip191Signer(message, signature) {
  try {
    return ethers.utils.verifyMessage(message, signature).toLowerCase();
  } catch {
    return null;
  }
}

// Curated publish rollout — the "Steve first" gate. Publishing a Room to a non-private
// visibility (public/unlisted) is DEFAULT-CLOSED: an owner may publish only when their verified
// Privy subject OR their normalized session wallet appears in SHOWCASE_PUBLISH_ALLOWLIST
// (comma-separated). An empty/unset allowlist means nobody may publish. This is env-driven and
// reversible — adding a breeder is a config change, not a deploy. Taking a Room private is never
// gated (the caller only consults this for non-private transitions), so an owner can always
// unpublish. Wallet entries are matched case-insensitively; non-wallet entries match a subject
// verbatim.
export function ownerMayPublish({ subject, walletAddress } = {}) {
  const raw = (process.env.SHOWCASE_PUBLISH_ALLOWLIST || "").trim();
  if (!raw) return false; // default-closed

  const allow = new Set(
    raw
      .split(",")
      .map((entry) => {
        const trimmed = entry.trim();
        return /^0x[0-9A-Fa-f]{40}$/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
      })
      .filter(Boolean)
  );
  if (allow.size === 0) return false;

  if (typeof subject === "string" && subject && allow.has(subject)) return true;
  if (
    typeof walletAddress === "string" &&
    /^0x[0-9A-Fa-f]{40}$/.test(walletAddress) &&
    allow.has(walletAddress.toLowerCase())
  ) {
    return true;
  }
  return false;
}
