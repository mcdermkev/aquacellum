/**
 * seed-species-catalog.js
 * Seeds the AquadexManager contract with species from fishbase_master.json
 * 
 * Usage: npx hardhat run scripts/seed-species-catalog.js --network baseSepolia
 * 
 * Environment variables:
 *   BATCH_SIZE  — Max species to seed per run (0 or unset = all remaining)
 *   TX_DELAY    — Delay between transactions in ms (default: 2000)
 *   MAX_RETRIES — Retry attempts per failed tx (default: 3)
 */

import "dotenv/config";
import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map difficulty strings to CareLevel enum values
const CARE_LEVEL_MAP = {
  "Beginner": 0,
  "Intermediate": 1,
  "Advanced": 2,
  "Expert": 3,
};

const TX_DELAY = parseInt(process.env.TX_DELAY || "2000", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);

async function sendWithRetry(fn, label, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const tx = await fn();
      const receipt = await tx.wait();
      return receipt;
    } catch (err) {
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) throw err;

      const isRateLimit = err.message?.includes("429") || err.message?.includes("rate");
      const delay = isRateLimit ? 5000 * attempt : 3000 * attempt;
      console.log(`    ⚠️  Attempt ${attempt}/${retries} failed: ${err.message?.slice(0, 80)}`);
      console.log(`    ⏳  Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function main() {
  const connection = await network.connect();
  const { ethers } = connection;

  const signers = await ethers.getSigners();
  const curator = signers[0];
  console.log(`Curator wallet: ${curator.address}`);

  const balance = await ethers.provider.getBalance(curator.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Load deployed address
  const deployedAddresses = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "deployed-addresses-sepolia.json"), "utf8")
  );
  const managerAddress = deployedAddresses.contracts.AquadexManager;
  console.log(`AquadexManager: ${managerAddress}`);

  // Load ABI from the Hardhat artifacts (properly formatted JSON)
  const artifactPath = path.resolve(__dirname, "..", "artifacts", "contracts", "AquadexManager.sol", "AquadexManager.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const managerAbi = artifact.abi;
  const manager = new ethers.Contract(managerAddress, managerAbi, curator);

  // Check current species count
  const currentNextId = await manager.nextSpeciesId();
  console.log(`Current nextSpeciesId: ${currentNextId} (${Number(currentNextId) - 1} species already seeded)\n`);

  // Load species data
  const speciesData = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "public", "fishbase_master.json"), "utf8")
  );

  // Skip already-seeded species
  const alreadySeeded = Number(currentNextId) - 1;
  // BATCH_SIZE env var controls how many to seed per run (0 or unset = all remaining)
  const batchSize = parseInt(process.env.BATCH_SIZE || "0", 10);
  const toSeed = batchSize > 0
    ? speciesData.slice(alreadySeeded, alreadySeeded + batchSize)
    : speciesData.slice(alreadySeeded);

  if (toSeed.length === 0) {
    console.log("✅ All 283 species are already seeded on-chain!");
    return;
  }

  console.log(`=============================================================`);
  console.log(`  Aquadex Species Catalog — Bulk Seeding`);
  console.log(`=============================================================`);
  console.log(`  Total species in catalog : ${speciesData.length}`);
  console.log(`  Already seeded on-chain  : ${alreadySeeded}`);
  console.log(`  To seed this run         : ${toSeed.length}`);
  console.log(`  TX delay                 : ${TX_DELAY}ms`);
  console.log(`  Max retries per TX       : ${MAX_RETRIES}`);
  console.log(`=============================================================\n`);

  let successCount = 0;
  let failCount = 0;
  const failedSpecies = [];
  const startTime = Date.now();

  for (let i = 0; i < toSeed.length; i++) {
    const sp = toSeed[i];

    // Map difficulty to care level enum
    const difficulty = sp.tankMetrics?.difficulty || "Intermediate";
    const careLevel = CARE_LEVEL_MAP[difficulty] !== undefined ? CARE_LEVEL_MAP[difficulty] : 1;

    // Temperature: scale by 10x (e.g., 20°C → 200)
    const minTemp = sp.tankMetrics?.tempRangeCelsius?.[0] || 22;
    const maxTemp = sp.tankMetrics?.tempRangeCelsius?.[1] || 28;
    const minTempX10 = Math.round(minTemp * 10);
    const maxTempX10 = Math.round(maxTemp * 10);

    // pH: scale by 10x (e.g., 7.0 → 70)
    const minPh = sp.ecology?.phMin || sp.tankMetrics?.phRange?.[0] || 6.5;
    const maxPh = sp.ecology?.phMax || sp.tankMetrics?.phRange?.[1] || 7.5;
    const minPhX10 = Math.round(minPh * 10);
    const maxPhX10 = Math.round(maxPh * 10);

    // Use photo URL as canonical URI (IPFS pinning can be done later)
    const ipfsUri = sp.masterPhotoUrl || "";

    const globalIndex = alreadySeeded + i + 1;
    console.log(`[${globalIndex}/${speciesData.length}] ${sp.commonName} (${sp.scientificName})`);
    console.log(`  Care: ${difficulty}(${careLevel}) | Temp: ${minTemp}-${maxTemp}°C | pH: ${minPh}-${maxPh}`);

    try {
      const receipt = await sendWithRetry(() =>
        manager.addSpecies(
          sp.scientificName,
          sp.commonName,
          ipfsUri,
          careLevel,
          minTempX10,
          maxTempX10,
          minPhX10,
          maxPhX10
        ),
        sp.scientificName
      );

      console.log(`  ✅ TX: ${receipt.hash}`);
      successCount++;

      // Progress update every 25 species
      if (successCount % 25 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (successCount / (elapsed / 60)).toFixed(1);
        console.log(`\n  📊 Progress: ${successCount}/${toSeed.length} seeded | ${elapsed}s elapsed | ~${rate} species/min\n`);
      }
    } catch (err) {
      console.error(`  ❌ FAILED after ${MAX_RETRIES} attempts: ${err.message?.slice(0, 120)}`);
      failCount++;
      failedSpecies.push({ index: globalIndex, scientificName: sp.scientificName, error: err.message?.slice(0, 200) });
    }

    // Delay between transactions to avoid rate limiting
    if (i < toSeed.length - 1) {
      await new Promise(r => setTimeout(r, TX_DELAY));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log(`\n=============================================================`);
  console.log(`  Seeding Complete!`);
  console.log(`=============================================================`);
  console.log(`  ✅ Success : ${successCount}`);
  console.log(`  ❌ Failed  : ${failCount}`);
  console.log(`  ⏱️  Time    : ${totalTime}s`);
  console.log(`=============================================================`);

  // Verify final count
  const finalNextId = await manager.nextSpeciesId();
  console.log(`\n  Final nextSpeciesId: ${finalNextId} (${Number(finalNextId) - 1} total species on-chain)`);

  // Log failed species for retry
  if (failedSpecies.length > 0) {
    console.log(`\n  ⚠️  Failed species (re-run script to retry):`);
    failedSpecies.forEach(f => console.log(`    - [${f.index}] ${f.scientificName}: ${f.error}`));

    // Save failed list for reference
    fs.writeFileSync(
      path.resolve(__dirname, "..", "seed-failures.json"),
      JSON.stringify(failedSpecies, null, 2)
    );
    console.log(`\n  📄 Failed species saved → seed-failures.json`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
