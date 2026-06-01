// scripts/import-collectr.js
// This script imports the master species list from the locally generated JSON payload
// into the AquadexManager contract on a local Hardhat network.

import { network } from "hardhat";
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to map care difficulty string to CareLevel enum (uint8)
const careLevelMap = {
  beginner: 0, // Easy
  easy: 0,
  medium: 1,
  intermediate: 1,
  difficult: 2,
  advanced: 2,
  expert: 3,
};

async function main() {
  const managerAddress = process.env.MANAGER_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  
  if (managerAddress.includes("PLACEHOLDER")) {
    console.error("Please set MANAGER_ADDRESS in .env or replace the placeholder in the script.");
    process.exit(1);
  }

  const managerAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'abi', 'AquadexManager.json'), 'utf8')
  );
  
  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();
  const manager = new ethers.Contract(managerAddress, managerAbi, signers[0]);

  // Load the payload JSON
  const dataPath = path.resolve(__dirname, '..', 'local_data', 'aquadex_freshwater_payload.json');
  const MASTER_SPECIES_LIST = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const nextId = await manager.nextSpeciesId();
  const existingNames = new Set();
  for (let i = 1; i < Number(nextId); i++) {
    const species = await manager.speciesCatalog(i);
    if (species.active) {
      existingNames.add(species.scientificName.toLowerCase());
    }
  }

  console.log(`🚀 Loaded ${MASTER_SPECIES_LIST.length} records from Aquadex payload.`);
  console.log(`Importing species into AquadexManager at ${managerAddress}`);

  for (const species of MASTER_SPECIES_LIST) {
    const {
      scientificName,
      commonName,
      tankMetrics,
    } = species;

    if (existingNames.has(scientificName.toLowerCase())) {
      console.log(`- Skipping duplicate species: ${commonName} (${scientificName})`);
      continue;
    }

    const canonicalIpfsUri = "ipfs://placeholder";
    
    const difficulty = tankMetrics?.difficulty?.toLowerCase() || "beginner";
    const careLevel = careLevelMap[difficulty] ?? 0;
    
    const temp_min_c = tankMetrics?.tempRangeCelsius?.[0] ?? 22.0;
    const temp_max_c = tankMetrics?.tempRangeCelsius?.[1] ?? 28.0;
    const ph_min = tankMetrics?.phRange?.[0] ?? 6.5;
    const ph_max = tankMetrics?.phRange?.[1] ?? 7.5;

    const minTempX10 = Math.round(temp_min_c * 10);
    const maxTempX10 = Math.round(temp_max_c * 10);
    const minPhX10 = Math.round(ph_min * 10);
    const maxPhX10 = Math.round(ph_max * 10);

    try {
      const tx = await manager.addSpecies(
        scientificName,
        commonName,
        canonicalIpfsUri,
        careLevel,
        minTempX10,
        maxTempX10,
        minPhX10,
        maxPhX10
      );
      await tx.wait();
      console.log(`- Added ${commonName} (${scientificName})`);
    } catch (err) {
      console.error(`Failed to add ${commonName}:`, err);
    }
  }

  console.log('Import complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
