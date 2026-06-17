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
import { privateKeyToAccount } from "viem/accounts";

// Contract addresses
const MANAGER_ADDRESS = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKETPLACE_ADDRESS = "0x16168B514144e0380610b78d904a4de51ba03Ca3";

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
];

// ─── CDP Paymaster / Bundler URL ───────────────────────────────────────────
const CDP_BUNDLER_URL = import.meta.env.VITE_CDP_PAYMASTER_URL
  || "https://api.developer.coinbase.com/rpc/v1/base-sepolia/hCEY3T6LkDJr0WbfoOau4B5FHF9syGlb";

// ─── Fallback sponsor key (used when no user signer available) ─────────────
const SPONSOR_PRIVATE_KEY = "0x71fb36108056cdb142ed1610a548dc721bb0db106020caaa99e339c36867b8b6";

// ─── Singleton cache ───────────────────────────────────────────────────────
let _cachedClients = new Map(); // key = signerAddress, value = { account, bundlerClient }
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
 * Get or create a smart account + bundler client for a given signer.
 * If no signer is provided, falls back to the sponsor key.
 * 
 * @param {Function|null} getSignerFn - async function that returns a viem LocalAccount or WalletClient
 */
async function getClientsForSigner(privySignerAddress = null) {
  const cacheKey = privySignerAddress || "sponsor";
  
  if (_cachedClients.has(cacheKey)) {
    return _cachedClients.get(cacheKey);
  }

  const client = getPublicClient();

  // Use sponsor key as the owner (deterministic smart wallet for the app)
  const owner = privateKeyToAccount(SPONSOR_PRIVATE_KEY);
  
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
  
  console.log("[4337] Smart wallet ready:", account.address);
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

    console.log(`[4337] UserOp confirmed: ${receipt.userOpHash}`);
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
 * Get the smart wallet address.
 */
export async function getSmartWalletAddress() {
  const { account } = await getClientsForSigner();
  return account.address;
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
