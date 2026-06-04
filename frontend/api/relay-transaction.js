/**
 * relay-transaction.js — Vercel Serverless Function
 * 
 * Relayer for beta: signs and submits on-chain transactions using
 * a single funded wallet (the deployer key). Beta testers never see
 * MetaMask or pay gas — this endpoint handles all on-chain writes.
 * 
 * Environment variables (set in Vercel dashboard):
 *   RELAYER_PRIVATE_KEY — your MetaMask deployer private key
 *   RPC_URL — Base Sepolia RPC endpoint
 *   MANAGER_ADDRESS — AquadexManager contract address
 */

import { ethers } from "ethers";

const MANAGER_ABI = [
  "function registerTank(string name, uint8 tankType, uint32 volumeLiters, uint8 containment, uint256 parentUnitId, string facility, string room, string rack) returns (uint256)",
  "event TankRegisteredExtended(uint256 indexed tankId, address indexed owner, string name, uint8 tankType, uint32 volumeLiters, uint8 containment, uint256 parentUnitId)",
];

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, params } = req.body;

  if (!action || !params) {
    return res.status(400).json({ error: "Missing action or params" });
  }

  const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
  const MANAGER_ADDRESS = process.env.MANAGER_ADDRESS || "0x351ca8f34D94F29F6f865Afa419A636324473DeF";

  if (!PRIVATE_KEY) {
    return res.status(500).json({ error: "Relayer not configured" });
  }

  try {
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(MANAGER_ADDRESS, MANAGER_ABI, wallet);

    let txResult;

    switch (action) {
      case "registerTank": {
        const { name, tankType, volumeLiters, containment, parentUnitId, facility, room, rack } = params;

        const tx = await contract.registerTank(
          name || "My Tank",
          tankType || 0,
          volumeLiters || 75,
          containment || 0,
          parentUnitId || 0,
          facility || "Main Room",
          room || "",
          rack || ""
        );

        const receipt = await tx.wait();

        // Parse tank ID from event
        let tankId = null;
        try {
          const event = receipt.logs
            .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
            .find((parsed) => parsed && parsed.name === "TankRegisteredExtended");
          if (event) {
            tankId = Number(event.args.tankId);
          }
        } catch (err) {
          console.warn("Could not parse tank event:", err);
        }

        txResult = { txHash: receipt.transactionHash, tankId };
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(200).json({ success: true, ...txResult });
  } catch (err) {
    console.error("Relay transaction failed:", err);
    return res.status(500).json({
      error: "Transaction failed",
      message: err.reason || err.message,
    });
  }
}
