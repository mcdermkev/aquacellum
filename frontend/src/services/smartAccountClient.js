/**
 * smartAccountClient.js
 * 
 * EIP-4337 Account Abstraction via Coinbase Smart Wallet + CDP Paymaster.
 * 
 * Architecture:
 *   - Each user gets a Coinbase Smart Wallet derived from their Privy embedded
 *     wallet (EOA signer). This means each user has their OWN on-chain smart wallet.
 *   - All UserOperations are gas-sponsored by the CDP Paymaster (users pay nothing).
 *   - The bundler batches operations and submits them on-chain.
 *   - NFT transfers in the marketplace move tokens between real user wallets.
 * 
 * The CDP Paymaster URL acts as BOTH bundler and paymaster endpoint.
 */

import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { toCoinbaseSmartAccount, createBundlerClient } from "viem/account-abstraction";
import { toAccount } from "viem/accounts";

// Contract addresses
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKETPLACE_ADDRESS = "0xEC4d21Aa32c6c378Ba43E6d9038e93A9702177BF";

// ABI fragments
const MANAGER_ABI = [
  {
    inputs: [
      { name: "name", type: "string" },
      { name: "tankType", type: "uint8" },
      { name: "volumeLiters", type: "uint32" },
      { name: "containment", type: "uint8" },
      { name: "parentUnitId", type: "uint256" },
      { name: "facility", type: "string" },
      { name: "room", type: "string" },
      { name: "rack", type: "string" },
    ],
    name: "registerTank",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "speciesId", type: "uint256" },
      { name: "birthTimestamp", type: "uint256" },
      { name: "breeder", type: "address" },
      { name: "currentTankId", type: "uint256" },
      { name: "sireId", type: "uint256" },
      { name: "damId", type: "uint256" },
      { name: "ipfsMetadataUri", type: "string" },
    ],
    name: "mintSpecimen",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tankId", type: "uint256" },
      { name: "tempCelsiusX10", type: "int16" },
      { name: "phX10", type: "uint8" },
      { name: "salinitySgX10000", type: "uint16" },
      { name: "ammoniaPpmX100", type: "uint16" },
      { name: "nitritePpmX100", type: "uint16" },
      { name: "nitratePpmX100", type: "uint16" },
      { name: "notes", type: "string" },
    ],
    name: "logWaterParameters",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "specimenId", type: "uint256" },
      { name: "newTankId", type: "uint256" },
    ],
    name: "moveSpecimenToTank",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "sireId", type: "uint256" },
      { name: "damId", type: "uint256" },
      { name: "tankId", type: "uint256" },
      { name: "ipfsLogUri", type: "string" },
    ],
    name: "initiateSpawn",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "speciesId", type: "uint256" },
      { name: "eggCount", type: "uint256" },
      { name: "notesHash", type: "string" },
    ],
    name: "logSpawnEvent",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ERC-721 approval for marketplace
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

const MARKETPLACE_ABI = [
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    name: "listSpecimen",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "cancelListing",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "purchaseSpecimen",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "spawnId", type: "uint256" },
      { name: "quantity", type: "uint256" },
      { name: "pricePerFish", type: "uint256" },
    ],
    name: "createBatchListing",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "listingId", type: "uint256" }],
    name: "cancelBatchListing",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "shippingFee", type: "uint256" },
    ],
    name: "createShippingListing",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ─── Shipping escrow lifecycle ───────────────────────────────────────────
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "purchaseShippingListing",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "trackingNumber", type: "string" },
    ],
    name: "dispatchShipping",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "releaseShippingEscrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "disputeShipping",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "refundBuyer", type: "bool" },
    ],
    name: "resolveShippingDispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Fiat-settled release: transfers only the NFT (funds are held/settled by
  // Stripe, not on-chain). Used instead of releaseShippingEscrow for orders
  // purchased with USD via the *Fiat settlement path.
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "releaseFiatShippingEscrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// ─── CDP Paymaster / Bundler URL ───────────────────────────────────────────
const CDP_BUNDLER_URL = import.meta.env.VITE_CDP_PAYMASTER_URL;

if (!CDP_BUNDLER_URL) {
  console.warn("[4337] VITE_CDP_PAYMASTER_URL not configured — on-chain operations will fail");
}

// ─── No fallback key — users must be logged in for on-chain writes ──────────
// Previously a hardcoded sponsor key was here. Removed for security:
// exposing a private key in the browser bundle allows anyone to drain funds.

// ─── User signer management ───────────────────────────────────────────────
// The user's Privy embedded wallet EIP-1193 provider, set by AuthContext.
let _userEip1193Provider = null;
let _userAddress = null;

/**
 * Register the current user's EIP-1193 provider (from Privy embedded wallet).
 * Called by AuthContext when the user's wallet becomes available.
 * This ensures each user gets their OWN Coinbase Smart Wallet derived from
 * their unique EOA — not a shared app-level wallet.
 */
export function setUserSigner(eip1193Provider, address) {
  // Clear cached clients when switching users
  if (_userAddress && _userAddress.toLowerCase() !== address.toLowerCase()) {
    _cachedClients.clear();
  }
  _userEip1193Provider = eip1193Provider;
  _userAddress = address;
}

/**
 * Clear the registered user signer (on logout).
 */
export function clearUserSigner() {
  _userEip1193Provider = null;
  _userAddress = null;
  _cachedClients.clear();
}

// ─── Singleton cache ───────────────────────────────────────────────────────
let _cachedClients = new Map(); // key = ownerAddress, value = { account, bundlerClient }
let _publicClient = null;

function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(CDP_BUNDLER_URL),
    });
  }
  return _publicClient;
}

/**
 * Get or create a smart account + bundler client for the current user.
 * 
 * If a user signer is registered (via setUserSigner), derives a unique
 * Coinbase Smart Wallet from their Privy embedded wallet (EOA).
 * Falls back to the sponsor key only when no user is logged in.
 */
async function getClientsForSigner() {
  const cacheKey = _userAddress;
  
  if (!cacheKey) {
    throw new Error("User not logged in — on-chain operations require authentication");
  }

  if (_cachedClients.has(cacheKey)) {
    return _cachedClients.get(cacheKey);
  }

  const client = getPublicClient();
  let owner;

  if (_userEip1193Provider && _userAddress) {
    // Per-user smart wallet: create a custom local account that delegates
    // signing to the user's Privy embedded wallet via their EIP-1193 provider.
    // This gives toCoinbaseSmartAccount a `type: 'local'` owner it can use
    // for both address derivation AND UserOperation signing.
    owner = toAccount({
      address: _userAddress,
      async signMessage({ message }) {
        const msg = typeof message === "string" ? message : message.raw;
        return await _userEip1193Provider.request({
          method: "personal_sign",
          params: [msg, _userAddress],
        });
      },
      async signTypedData({ domain, types, primaryType, message }) {
        const typedData = JSON.stringify({
          types: { EIP712Domain: [], ...types },
          domain: domain || {},
          primaryType,
          message,
        });
        return await _userEip1193Provider.request({
          method: "eth_signTypedData_v4",
          params: [_userAddress, typedData],
        });
      },
      async signTransaction(tx) {
        return await _userEip1193Provider.request({
          method: "eth_signTransaction",
          params: [tx],
        });
      },
    });
  } else {
    // No user signer available — cannot derive a smart wallet without a key.
    // Reject early rather than exposing a sponsor key in the browser bundle.
    throw new Error("User not logged in — on-chain operations require authentication");
  }
  
  const account = await toCoinbaseSmartAccount({
    client,
    owners: [owner],
  });

  // Pad gas estimates
  account.userOperation = {
    estimateGas: async (userOperation) => {
      const tempBundler = createBundlerClient({
        account,
        client,
        transport: http(CDP_BUNDLER_URL),
        chain: baseSepolia,
      });
      const estimate = await tempBundler.estimateUserOperationGas(userOperation);
      estimate.preVerificationGas = estimate.preVerificationGas * 2n;
      return estimate;
    },
  };

  const bundlerClient = createBundlerClient({
    account,
    client,
    transport: http(CDP_BUNDLER_URL),
    chain: baseSepolia,
  });

  const result = { account, bundlerClient, publicClient: client };
  _cachedClients.set(cacheKey, result);
  
  return result;
}

/**
 * Submit a batch of contract calls as a single sponsored UserOperation.
 * Each call is: { contract, functionName, args, value? }
 * 
 * Returns { success, userOpHash, txHash? } or { success: false, error }
 */
export async function submitUserOperation(calls) {
  try {
    if (!_userEip1193Provider) {
      console.warn("[4337] submitUserOperation called without user signer — skipping on-chain write");
      return { success: false, error: "User not logged in — on-chain write skipped" };
    }

    const { bundlerClient, account } = await getClientsForSigner();

    // Build the calls array for the bundler
    const formattedCalls = calls.map(call => {
      const target = call.contract === "marketplace" ? MARKETPLACE_ADDRESS : MANAGER_ADDRESS;
      const abi = call.contract === "marketplace" ? MARKETPLACE_ABI : MANAGER_ABI;
      return {
        to: target,
        abi,
        functionName: call.functionName,
        args: call.args,
        ...(call.value ? { value: call.value } : {}),
      };
    });

    // Submit with paymaster sponsorship
    const userOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: formattedCalls,
      paymaster: true,
    });

    // Wait for inclusion
    const receipt = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    return {
      success: true,
      userOpHash: receipt.userOpHash,
      txHash: receipt.receipt?.transactionHash || null,
      receipt,
    };
  } catch (err) {
    console.warn("[4337] UserOperation failed:", err.shortMessage || err.message || err);
    return { success: false, error: err.shortMessage || err.message || "UserOperation failed" };
  }
}

/**
 * Get the smart wallet address for the current user.
 * Returns the user's unique smart wallet if they're logged in,
 * or null if no user is authenticated.
 */
export async function getSmartWalletAddress() {
  if (!_userEip1193Provider || !_userAddress) {
    return null;
  }
  const { account } = await getClientsForSigner();
  return account.address;
}

/**
 * Check if a user signer is currently registered.
 */
export function hasUserSigner() {
  return !!_userEip1193Provider && !!_userAddress;
}

/**
 * Sign an arbitrary UTF-8 message with the user's Privy embedded EOA
 * (personal_sign / EIP-191). Used to authorize sensitive backend actions such
 * as releasing held escrow funds: the server recovers the signer with
 * ethers.utils.verifyMessage and matches it against the order's buyer/seller
 * wallet (the canonical lowercase EOA). Returns the 65-byte hex signature.
 *
 * Throws if no user signer is registered (user not logged in).
 */
export async function signPersonalMessage(message) {
  if (!_userEip1193Provider || !_userAddress) {
    throw new Error("User not logged in — cannot sign this action");
  }
  return await _userEip1193Provider.request({
    method: "personal_sign",
    params: [message, _userAddress],
  });
}

// ─── Manager Call Builders ─────────────────────────────────────────────────

export function buildRegisterTankCall(params) {
  return {
    contract: "manager",
    functionName: "registerTank",
    args: [
      params.name || "My Tank",
      params.tankType || 0,
      params.volumeLiters || 75,
      params.containment || 0,
      BigInt(params.parentUnitId || 0),
      params.facility || "Main Room",
      params.room || "",
      params.rack || "",
    ],
  };
}

export function buildMintSpecimenCall(params) {
  return {
    contract: "manager",
    functionName: "mintSpecimen",
    args: [
      BigInt(params.speciesId || 0),
      BigInt(params.birthTimestamp || Math.floor(Date.now() / 1000)),
      params.breeder || "0x0000000000000000000000000000000000000000",
      0n, // currentTankId: skip on-chain (local Dexie tracks)
      BigInt(params.sireId || 0),
      BigInt(params.damId || 0),
      params.ipfsMetadataUri || "",
    ],
  };
}

export function buildLogWaterParametersCall(params) {
  const tankId = Number(params.tankId || 0);
  if (tankId > 1000000) return null; // Local-only tank
  return {
    contract: "manager",
    functionName: "logWaterParameters",
    args: [
      BigInt(tankId),
      params.tempCelsiusX10 || 0,
      params.phX10 || 0,
      params.salinitySgX10000 || 0,
      params.ammoniaPpmX100 || 0,
      params.nitritePpmX100 || 0,
      params.nitratePpmX100 || 0,
      params.notes || "",
    ],
  };
}

export function buildMoveSpecimenCall(params) {
  return {
    contract: "manager",
    functionName: "moveSpecimenToTank",
    args: [
      BigInt(params.specimenId || 0),
      BigInt(params.targetTankId || 0),
    ],
  };
}

export function buildInitiateSpawnCall(params) {
  return {
    contract: "manager",
    functionName: "initiateSpawn",
    args: [
      BigInt(params.sireId || 0),
      BigInt(params.damId || 0),
      0n, // tankId: skip on-chain (ownership mismatch for local tanks)
      params.ipfsLogUri || "",
    ],
  };
}

export function buildLogSpawnEventCall(params) {
  return {
    contract: "manager",
    functionName: "logSpawnEvent",
    args: [
      BigInt(params.speciesId || 0),
      BigInt(params.eggCount || 0),
      params.notesHash || "",
    ],
  };
}

// ─── Marketplace Call Builders ─────────────────────────────────────────────

export function buildListSpecimenCall(params) {
  return {
    contract: "marketplace",
    functionName: "listSpecimen",
    args: [
      BigInt(params.tokenId || 0),
      BigInt(params.priceWei || 0),
    ],
  };
}

export function buildCancelListingCall(params) {
  return {
    contract: "marketplace",
    functionName: "cancelListing",
    args: [BigInt(params.tokenId || 0)],
  };
}

export function buildPurchaseSpecimenCall(params) {
  return {
    contract: "marketplace",
    functionName: "purchaseSpecimen",
    args: [BigInt(params.tokenId || 0)],
    value: BigInt(params.priceWei || 0),
  };
}

export function buildCreateBatchListingCall(params) {
  return {
    contract: "marketplace",
    functionName: "createBatchListing",
    args: [
      BigInt(params.spawnId || 0),
      BigInt(params.quantity || 0),
      BigInt(params.pricePerFishWei || 0),
    ],
  };
}

export function buildCancelBatchListingCall(params) {
  return {
    contract: "marketplace",
    functionName: "cancelBatchListing",
    args: [BigInt(params.listingId || 0)],
  };
}

export function buildCreateShippingListingCall(params) {
  return {
    contract: "marketplace",
    functionName: "createShippingListing",
    args: [
      BigInt(params.tokenId || 0),
      BigInt(params.priceWei || 0),
      BigInt(params.shippingFeeWei || 0),
    ],
  };
}

// ─── Shipping escrow lifecycle builders ────────────────────────────────────

/**
 * Buyer locks funds (price + shipping fee) into the shipping escrow on-chain.
 * `totalWei` MUST equal listing.price + listing.shippingFee (in wei).
 */
export function buildPurchaseShippingListingCall(params) {
  return {
    contract: "marketplace",
    functionName: "purchaseShippingListing",
    args: [BigInt(params.tokenId || 0)],
    value: BigInt(params.totalWei || 0),
  };
}

/** Seller marks the order dispatched with a tracking number, starting the safety window. */
export function buildDispatchShippingCall(params) {
  return {
    contract: "marketplace",
    functionName: "dispatchShipping",
    args: [
      BigInt(params.tokenId || 0),
      String(params.trackingNumber || ""),
    ],
  };
}

/** Buyer (any time) or seller (after safety window) releases escrow to the seller. CRYPTO escrows only. */
export function buildReleaseShippingEscrowCall(params) {
  return {
    contract: "marketplace",
    functionName: "releaseShippingEscrow",
    args: [BigInt(params.tokenId || 0)],
  };
}

/**
 * Fiat release-on-arrival: transfers only the NFT to the buyer. Use this for
 * orders paid in USD via Stripe (ShippingEscrow.amountLocked == 0). The crypto
 * releaseShippingEscrow would revert on these because it tries to pay out ETH
 * the contract does not hold.
 */
export function buildReleaseFiatShippingEscrowCall(params) {
  return {
    contract: "marketplace",
    functionName: "releaseFiatShippingEscrow",
    args: [BigInt(params.tokenId || 0)],
  };
}

/** Buyer opens a dispute before the safety window elapses. */
export function buildDisputeShippingCall(params) {
  return {
    contract: "marketplace",
    functionName: "disputeShipping",
    args: [BigInt(params.tokenId || 0)],
  };
}

/** Curator resolves a dispute: refundBuyer=true refunds the buyer, false releases to the seller. */
export function buildResolveShippingDisputeCall(params) {
  return {
    contract: "marketplace",
    functionName: "resolveShippingDispute",
    args: [
      BigInt(params.tokenId || 0),
      Boolean(params.refundBuyer),
    ],
  };
}

// ERC-721 approve (needed before listing)
export function buildApproveCall(params) {
  return {
    contract: "manager",
    functionName: "approve",
    args: [
      MARKETPLACE_ADDRESS,
      BigInt(params.tokenId || 0),
    ],
  };
}
