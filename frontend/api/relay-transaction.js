/**
 * relay-transaction.js — Vercel Serverless Function
 * 
 * Sponsor wallet relay: signs and submits ALL on-chain transactions using
 * a single funded wallet (the deployer key). Beta testers never see
 * MetaMask or pay gas — this endpoint handles all on-chain writes.
 * 
 * The sponsor wallet acts as custodian for all on-chain state during beta.
 * Real user ownership is tracked locally (Dexie) and in Supabase cloud.
 * 
 * Environment variables (set in Vercel dashboard):
 *   RELAYER_PRIVATE_KEY — deployer/sponsor private key (funded with ETH)
 *   RPC_URL — Base Sepolia RPC endpoint
 *   MANAGER_ADDRESS — AquadexManager contract address
 */

import { ethers } from "ethers";

const MANAGER_ABI = [
  // Tank Registration
  "function registerTank(string name, uint8 tankType, uint32 volumeLiters, uint8 containment, uint256 parentUnitId, string facility, string room, string rack) returns (uint256)",
  "event TankRegisteredExtended(uint256 indexed tankId, address indexed owner, string name, uint8 tankType, uint32 volumeLiters, uint8 containment, uint256 parentUnitId)",
  // Specimen Minting
  "function mintSpecimen(uint256 speciesId, uint256 birthTimestamp, address breeder, uint256 currentTankId, uint256 sireId, uint256 damId, string ipfsMetadataUri) returns (uint256)",
  "event SpecimenRegistered(uint256 indexed tokenId, uint256 indexed speciesId, address indexed owner, string ipfsMetadataUri)",
  // Water Parameters
  "function logWaterParameters(uint256 tankId, int16 tempCelsiusX10, uint8 phX10, uint16 salinitySgX10000, uint16 ammoniaPpmX100, uint16 nitritePpmX100, uint16 nitratePpmX100, string notes)",
  // Specimen Movement
  "function moveSpecimenToTank(uint256 specimenId, uint256 newTankId)",
  // Spawning
  "function initiateSpawn(uint256 sireId, uint256 damId, uint256 tankId, string ipfsLogUri) returns (uint256)",
  "event SpawnLogged(uint256 indexed spawnId, uint256 indexed speciesId, address breeder, uint256 eggCount, uint256 eventTimestamp)",
  // Spawn Event Logging
  "function logSpawnEvent(uint256 speciesId, uint256 eggCount, string notesHash) returns (uint256)",
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

        let tankId = null;
        try {
          const event = receipt.logs
            .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
            .find((parsed) => parsed && parsed.name === "TankRegisteredExtended");
          if (event) tankId = Number(event.args.tankId);
        } catch (err) {}

        txResult = { txHash: receipt.transactionHash, tankId };
        break;
      }

      case "mintSpecimen": {
        const { speciesId, birthTimestamp, breeder, currentTankId, sireId, damId, ipfsMetadataUri } = params;
        const tx = await contract.mintSpecimen(
          speciesId || 0,
          birthTimestamp || Math.floor(Date.now() / 1000),
          breeder || wallet.address,
          currentTankId || 0,
          sireId || 0,
          damId || 0,
          ipfsMetadataUri || ""
        );
        const receipt = await tx.wait();

        let tokenId = null;
        try {
          const event = receipt.logs
            .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
            .find((parsed) => parsed && parsed.name === "SpecimenRegistered");
          if (event) tokenId = Number(event.args.tokenId);
        } catch (err) {}

        txResult = { txHash: receipt.transactionHash, tokenId };
        break;
      }

      case "logWaterParameters": {
        const { tankId, tempCelsiusX10, phX10, salinitySgX10000, ammoniaPpmX100, nitritePpmX100, nitratePpmX100, notes } = params;
        const tx = await contract.logWaterParameters(
          tankId || 0,
          tempCelsiusX10 || 0,
          phX10 || 0,
          salinitySgX10000 || 0,
          ammoniaPpmX100 || 0,
          nitritePpmX100 || 0,
          nitratePpmX100 || 0,
          notes || ""
        );
        const receipt = await tx.wait();
        txResult = { txHash: receipt.transactionHash };
        break;
      }

      case "moveSpecimen": {
        const { specimenId, targetTankId } = params;
        const tx = await contract.moveSpecimenToTank(
          specimenId || 0,
          targetTankId || 0
        );
        const receipt = await tx.wait();
        txResult = { txHash: receipt.transactionHash };
        break;
      }

      case "initiateSpawn": {
        const { sireId, damId, tankId, ipfsLogUri } = params;
        const tx = await contract.initiateSpawn(
          sireId || 0,
          damId || 0,
          tankId || 0,
          ipfsLogUri || ""
        );
        const receipt = await tx.wait();

        let spawnId = null;
        try {
          const event = receipt.logs
            .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
            .find((parsed) => parsed && parsed.name === "SpawnLogged");
          if (event) spawnId = Number(event.args.spawnId);
        } catch (err) {}

        txResult = { txHash: receipt.transactionHash, spawnId };
        break;
      }

      case "logSpawnEvent": {
        const { speciesId, eggCount, notesHash } = params;
        const tx = await contract.logSpawnEvent(
          speciesId || 0,
          eggCount || 0,
          notesHash || ""
        );
        const receipt = await tx.wait();
        txResult = { txHash: receipt.transactionHash };
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(200).json({ success: true, ...txResult });
  } catch (err) {
    console.error(`Relay transaction failed [${action}]:`, err);
    return res.status(500).json({
      success: false,
      error: "Transaction failed",
      message: err.reason || err.message,
    });
  }
}
