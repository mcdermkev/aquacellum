import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Secondary automation function to update an existing species entry on-chain.
 */
async function updateSpeciesEntry(
  manager,
  speciesId,
  scientificName,
  commonName,
  canonicalIpfsUri,
  careLevel,
  minTempX10,
  maxTempX10,
  minPhX10,
  maxPhX10,
  active = true
) {
  console.log(`Updating Species ID ${speciesId}: ${scientificName} (${commonName})`);
  console.log(`- careLevel: ${careLevel}, temp: [${minTempX10}, ${maxTempX10}], ph: [${minPhX10}, ${maxPhX10}], active: ${active}`);

  try {
    const tx = await manager.updateSpecies(
      speciesId,
      scientificName,
      commonName,
      canonicalIpfsUri,
      careLevel,
      minTempX10,
      maxTempX10,
      minPhX10,
      maxPhX10,
      active
    );
    await tx.wait();
    console.log(`- Successfully updated ID ${speciesId} in contract catalog.`);
    return true;
  } catch (error) {
    console.error(`- Failed to update species ID ${speciesId}:`, error);
    return false;
  }
}

async function main() {
  const managerAddress = process.env.MANAGER_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const managerAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "abi", "AquadexManager.json"), "utf8")
  );

  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();
  const curator = signers[0];

  console.log(`Connecting to AquadexManager at ${managerAddress} using curator ${curator.address}`);
  const manager = new ethers.Contract(managerAddress, managerAbi, curator);

  // Load the species catalog JSON
  const jsonPath = path.resolve(__dirname, "..", "frontend", "public", "fishbase_master.json");
  console.log(`Reading species from ${jsonPath}...`);
  const rawData = fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "");
  const speciesList = JSON.parse(rawData);
  console.log(`Found ${speciesList.length} species entries in JSON file.`);

  // Retrieve existing species from the contract catalog
  const nextId = await manager.nextSpeciesId();
  const existingSpeciesMap = new Map();
  
  for (let i = 1; i < Number(nextId); i++) {
    const speciesObj = await manager.speciesCatalog(i);
    if (speciesObj.scientificName) {
      existingSpeciesMap.set(speciesObj.scientificName.toLowerCase().trim(), {
        speciesId: i,
        scientificName: speciesObj.scientificName,
        commonName: speciesObj.commonName,
        canonicalIpfsUri: speciesObj.canonicalIpfsUri,
        careLevel: Number(speciesObj.careLevel),
        minTempCelsiusX10: Number(speciesObj.minTempCelsiusX10),
        maxTempCelsiusX10: Number(speciesObj.maxTempCelsiusX10),
        minPhX10: Number(speciesObj.minPhX10),
        maxPhX10: Number(speciesObj.maxPhX10),
        active: speciesObj.active
      });
    }
  }
  console.log(`Retrieved ${existingSpeciesMap.size} existing species from contract catalog.`);

  const canonicalIpfsUri = "ipfs://bafkreiavfny7scee4mxyvc4pgoqicts4tzaq3f7fepprixftea6vj4lllu";

  for (let i = 0; i < speciesList.length; i++) {
    const entry = speciesList[i];
    const scientificName = (entry.scientificName || "").trim();
    const commonName = (entry.commonName || "").trim();

    if (!scientificName) {
      console.log(`Skipping index ${i}: scientificName is empty.`);
      continue;
    }

    let careLevel, minTempX10, maxTempX10, minPhX10, maxPhX10;

    // Process/map careLevel and metrics exactly as before
    if (entry.solidityMetrics) {
      careLevel = entry.solidityMetrics.careLevel;
      minTempX10 = entry.solidityMetrics.minTempX10;
      maxTempX10 = entry.solidityMetrics.maxTempX10;
      minPhX10 = entry.solidityMetrics.minPhX10;
      maxPhX10 = entry.solidityMetrics.maxPhX10;
    } else {
      const difficulty = (entry.tankMetrics?.difficulty || "beginner").toLowerCase();
      const careLevelMap = {
        easy: 0,
        beginner: 0,
        medium: 1,
        intermediate: 1,
        difficult: 2,
        advanced: 2,
        expert: 3,
      };
      careLevel = careLevelMap[difficulty] ?? 0;

      const tempMin = entry.tankMetrics?.tempRangeCelsius?.[0] ?? 22.0;
      const tempMax = entry.tankMetrics?.tempRangeCelsius?.[1] ?? 28.0;
      const phMin = entry.tankMetrics?.phRange?.[0] ?? 6.5;
      const phMax = entry.tankMetrics?.phRange?.[1] ?? 7.5;

      minTempX10 = Math.round(tempMin * 10);
      maxTempX10 = Math.round(tempMax * 10);
      minPhX10 = Math.round(phMin * 10);
      maxPhX10 = Math.round(phMax * 10);
    }

    const key = scientificName.toLowerCase();
    if (existingSpeciesMap.has(key)) {
      const existing = existingSpeciesMap.get(key);
      const needsUpdate =
        existing.commonName !== commonName ||
        existing.canonicalIpfsUri !== canonicalIpfsUri ||
        existing.careLevel !== careLevel ||
        existing.minTempCelsiusX10 !== minTempX10 ||
        existing.maxTempCelsiusX10 !== maxTempX10 ||
        existing.minPhX10 !== minPhX10 ||
        existing.maxPhX10 !== maxPhX10;

      if (needsUpdate) {
        console.log(`Update detected for "${scientificName}":`);
        if (existing.commonName !== commonName) console.log(`  - Common Name: "${existing.commonName}" -> "${commonName}"`);
        if (existing.canonicalIpfsUri !== canonicalIpfsUri) console.log(`  - IPFS URI: "${existing.canonicalIpfsUri}" -> "${canonicalIpfsUri}"`);
        if (existing.careLevel !== careLevel) console.log(`  - Care Level: ${existing.careLevel} -> ${careLevel}`);
        if (existing.minTempCelsiusX10 !== minTempX10 || existing.maxTempCelsiusX10 !== maxTempX10) {
          console.log(`  - Temp: [${existing.minTempCelsiusX10}, ${existing.maxTempCelsiusX10}] -> [${minTempX10}, ${maxTempX10}]`);
        }
        if (existing.minPhX10 !== minPhX10 || existing.maxPhX10 !== maxPhX10) {
          console.log(`  - pH: [${existing.minPhX10}, ${existing.maxPhX10}] -> [${minPhX10}, ${maxPhX10}]`);
        }

        await updateSpeciesEntry(
          manager,
          existing.speciesId,
          scientificName,
          commonName,
          canonicalIpfsUri,
          careLevel,
          minTempX10,
          maxTempX10,
          minPhX10,
          maxPhX10,
          true
        );
        
        // Update local map to reflect the new state
        existingSpeciesMap.set(key, {
          ...existing,
          commonName,
          canonicalIpfsUri,
          careLevel,
          minTempCelsiusX10: minTempX10,
          maxTempCelsiusX10: maxTempX10,
          minPhX10,
          maxPhX10
        });
      } else {
        console.log(`Species already exists and is up to date: ${scientificName} (${commonName})`);
      }
      continue;
    }

    // Add new species
    console.log(`Adding Species: ${scientificName} (${commonName})`);
    console.log(`- careLevel: ${careLevel}, temp: [${minTempX10}, ${maxTempX10}], ph: [${minPhX10}, ${maxPhX10}]`);

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
      console.log(`- Successfully added ${scientificName} to contract catalog.`);
      
      existingSpeciesMap.set(key, {
        speciesId: Number(nextId),
        scientificName,
        commonName,
        canonicalIpfsUri,
        careLevel,
        minTempCelsiusX10: minTempX10,
        maxTempCelsiusX10: maxTempX10,
        minPhX10,
        maxPhX10,
        active: true
      });
    } catch (error) {
      console.error(`- Failed to add species ${scientificName}:`, error);
    }
  }

  console.log("Database curation sequence finished.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
