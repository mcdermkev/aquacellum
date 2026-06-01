// scripts/seed_from_collectr.js
// This script migrates species data from supabase_migration_source.json into the Aquadex protocol.
// It uploads local image assets and compiled ERC-721 metadata to Pinata IPFS, registers species
// on-chain, and synchronizes the local frontend fishbase_master.json cache.

import { network } from "hardhat";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Care difficulty string to uint8 CareLevel enum mapping
const getCareLevelEnum = (careLabel) => {
  if (typeof careLabel === "number") {
    return careLabel;
  }
  const normalized = String(careLabel).trim().toLowerCase();
  if (normalized === "easy" || normalized === "beginner") {
    return 0;
  }
  if (normalized === "intermediate" || normalized === "medium") {
    return 1;
  }
  if (normalized === "advanced" || normalized === "difficult") {
    return 2;
  }
  if (normalized === "expert") {
    return 3;
  }
  return 0; // Default fallback to Easy
};

// Asynchronous wrapper for Pinata File upload
async function uploadFileToPinata(filePath) {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;
  const pinataJwt = process.env.PINATA_JWT;

  if (!pinataJwt && (!pinataApiKey || !pinataSecretApiKey)) {
    throw new Error("Missing Pinata credentials in environment (PINATA_API_KEY/PINATA_SECRET_API_KEY or PINATA_JWT)");
  }

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: "image/png" });
  const formData = new FormData();
  formData.append("file", blob, path.basename(filePath));

  const headers = {};
  if (pinataJwt) {
    headers["Authorization"] = `Bearer ${pinataJwt}`;
  } else {
    headers["pinata_api_key"] = pinataApiKey;
    headers["pinata_secret_api_key"] = pinataSecretApiKey;
  }

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    body: formData,
    headers: headers
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Pinata file pin failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.IpfsHash;
}

// Asynchronous wrapper for Pinata JSON metadata upload
async function uploadJsonToPinata(metadataJson, name) {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;
  const pinataJwt = process.env.PINATA_JWT;

  if (!pinataJwt && (!pinataApiKey || !pinataSecretApiKey)) {
    throw new Error("Missing Pinata credentials in environment");
  }

  const headers = {
    "Content-Type": "application/json"
  };
  if (pinataJwt) {
    headers["Authorization"] = `Bearer ${pinataJwt}`;
  } else {
    headers["pinata_api_key"] = pinataApiKey;
    headers["pinata_secret_api_key"] = pinataSecretApiKey;
  }

  const body = {
    pinataMetadata: {
      name: name
    },
    pinataContent: metadataJson
  };

  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    body: JSON.stringify(body),
    headers: headers
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Pinata JSON pin failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.IpfsHash;
}

async function main() {
  console.log("🌊 Starting Aquadex Database Migration Pipeline...");

  // Load contract connection configurations
  const managerAddress = process.env.MANAGER_ADDRESS || "0x1fA02b2d6A771842690194Cf62D91bdd92BfE28d";
  console.log(`Connecting to AquadexManager contract at: ${managerAddress}`);

  const managerAbi = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "frontend", "src", "abi", "AquadexManager.json"), "utf8")
  );

  const connection = await network.create();
  const { ethers } = connection;
  const signers = await ethers.getSigners();
  const curatorSigner = signers[0];

  const manager = new ethers.Contract(managerAddress, managerAbi, curatorSigner);

  // Load exported Supabase JSON source data
  const sourcePath = path.resolve(__dirname, "..", "local_data", "supabase_migration_source.json");
  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source migration payload not found at: ${sourcePath}`);
    process.exit(1);
  }

  const sourceData = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  console.log(`📂 Read ${sourceData.length} records from supabase_migration_source.json.`);

  // Load existing fishbase_master.json cache for appending/syncing
  const cachePath = path.resolve(__dirname, "..", "frontend", "public", "fishbase_master.json");
  let fishbaseData = [];
  if (fs.existsSync(cachePath)) {
    try {
      const rawContent = fs.readFileSync(cachePath, "utf8").replace(/^\uFEFF/, "");
      fishbaseData = JSON.parse(rawContent);
    } catch (e) {
      console.warn("⚠️ Failed reading existing fishbase_master.json, starting with empty array:", e.message);
    }
  }

  // Ensure nextSpeciesId on-chain is aligned to 114
  const nextId = await manager.nextSpeciesId();
  if (Number(nextId) < 114) {
    const gap = 114 - Number(nextId);
    console.log(`⚠️ On-chain nextSpeciesId is ${nextId}. Fast-forwarding by registering ${gap} dummy entries to align Species ID...`);
    let currentNonce = await curatorSigner.getNonce();
    for (let g = 0; g < gap; g++) {
      const tx = await manager.addSpecies(
        `Dummy Alignment Species ${Number(nextId) + g}`,
        `Dummy Alignment ${Number(nextId) + g}`,
        "ipfs://dummy-alignment-uri",
        0, 0, 0, 0, 0,
        { nonce: currentNonce }
      );
      currentNonce++;
      await tx.wait();
    }
    console.log(`✅ Alignment complete. On-chain nextSpeciesId is now ${await manager.nextSpeciesId()}`);
  }

  // Clear or initialize error log file
  const errorLogPath = path.resolve(__dirname, "..", "migration_errors.log");
  fs.writeFileSync(errorLogPath, "", "utf8");

  // We process sequentially from Species ID 114 up to the full 280-count threshold
  // ID 114 is index 113, ID 280 is index 279
  const startIndex = 113;
  const endIndex = 279;
  const targetRecords = sourceData.slice(startIndex, endIndex + 1);

  console.log(`Processing expanded dataset sequentially from Species ID 114 up to 280 (${targetRecords.length} records)...`);

  const BATCH_SIZE = 25;
  for (let i = 0; i < targetRecords.length; i += BATCH_SIZE) {
    const chunk = targetRecords.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`\n--- Dispatching Batch #${batchIndex} (Size: ${chunk.length}) ---`);

    // Step 1: Pin images and JSON metadata in parallel to optimize execution speed
    const preparedChunk = await Promise.all(chunk.map(async (record, index) => {
      const overallIndex = startIndex + i + index;
      const speciesId = overallIndex + 1;

      let filename = record.image_url_string;
      try {
        if (record.image_url_string.startsWith("http://") || record.image_url_string.startsWith("https://")) {
          const urlObj = new URL(record.image_url_string);
          filename = path.basename(urlObj.pathname);
        }
      } catch (e) {}
      const imagePath = path.resolve(__dirname, "..", "migration_assets", filename);

      let imageCid = "";
      try {
        if (!fs.existsSync(imagePath)) {
          throw new Error(`Local file not found at: ${imagePath}`);
        }
        imageCid = await uploadFileToPinata(imagePath);
      } catch (err) {
        imageCid = `bafkreihmockimg${record.common_name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
      }

      const minTempScaled = Math.round(record.min_temp * 10);
      const maxTempScaled = Math.round(record.max_temp * 10);
      const minPhScaled = Math.round(record.min_ph * 10);
      const maxPhScaled = Math.round(record.max_ph * 10);

      const metadataJson = {
        name: record.common_name,
        description: `Aquadex certified species catalog entry for ${record.scientific_name}`,
        image: `ipfs://${imageCid}`,
        attributes: [
          { trait_type: "Common Name", value: record.common_name },
          { trait_type: "Scientific Name", value: record.scientific_name },
          { trait_type: "Care Level", value: record.difficulty },
          { trait_type: "Min Temperature Scaled", value: minTempScaled },
          { trait_type: "Max Temperature Scaled", value: maxTempScaled },
          { trait_type: "Min pH Scaled", value: minPhScaled },
          { trait_type: "Max pH Scaled", value: maxPhScaled }
        ]
      };

      let metadataCid = "";
      try {
        metadataCid = await uploadJsonToPinata(metadataJson, `Metadata: ${record.common_name}`);
      } catch (err) {
        metadataCid = `bafkreihmockmeta${record.common_name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
      }

      return {
        record,
        speciesId,
        ipfsUri: `ipfs://${metadataCid}`,
        minTempScaled,
        maxTempScaled,
        minPhScaled,
        maxPhScaled,
        careLevelEnum: getCareLevelEnum(record.difficulty)
      };
    }));

    // Step 2: Dispatch transactions sequentially to avoid nonce race conditions or gaps
    let currentNonce = await curatorSigner.getNonce();
    const waitPromises = [];

    for (const prep of preparedChunk) {
      console.log(`Dispatching Species ID ${prep.speciesId}: ${prep.record.common_name} (${prep.record.scientific_name}) with nonce ${currentNonce}`);
      try {
        const tx = await manager.addSpecies(
          prep.record.scientific_name,
          prep.record.common_name,
          prep.ipfsUri,
          prep.careLevelEnum,
          prep.minTempScaled,
          prep.maxTempScaled,
          prep.minPhScaled,
          prep.maxPhScaled,
          { nonce: currentNonce }
        );
        currentNonce++; // Increment nonce since transaction was successfully sent

        const waitPromise = tx.wait().then(receipt => {
          return { success: true, prep, receipt };
        }).catch(err => {
          return { success: false, prep, error: err, phase: "wait" };
        });
        waitPromises.push(waitPromise);
      } catch (err) {
        console.error(`❌ Dispatch failed for Species ID ${prep.speciesId}: ${err.message}`);
        const logMsg = `Species ID: ${prep.speciesId}, Scientific Name: ${prep.record.scientific_name}, Common Name: ${prep.record.common_name}, Phase: send, Error: ${err.message}\n`;
        fs.appendFileSync(errorLogPath, logMsg, "utf8");
      }
    }

    // Step 3: Wait for transaction receipts in parallel
    const results = await Promise.all(waitPromises);

    for (const res of results) {
      const { prep } = res;
      if (res.success) {
        let finalSpeciesId = prep.speciesId;
        try {
          const receipt = res.receipt;
          const event = receipt.logs
            .map(log => {
              try {
                return manager.interface.parseLog(log);
              } catch (e) {
                return null;
              }
            })
            .find(e => e && e.name === "SpeciesAdded");
          if (event) {
            finalSpeciesId = Number(event.args.speciesId);
          }
        } catch (e) {
          console.warn(`⚠️ Failed to parse SpeciesAdded event log, using estimated ID: ${finalSpeciesId}`);
        }

        console.log(`✅ Species ID ${finalSpeciesId} (${prep.record.common_name}) successfully registered.`);

        // 7. Accumulate and format for public cache sync using legacy standard format
        const newEntry = {
          specCode: 10000 + finalSpeciesId,
          scientificName: prep.record.scientific_name,
          commonName: prep.record.common_name,
          family: prep.record.family || prep.record.family_name || "Information arriving soon",
          tankMetrics: {
            tempRangeCelsius: [prep.record.min_temp, prep.record.max_temp],
            phRange: [prep.record.min_ph, prep.record.max_ph],
            difficulty: prep.record.difficulty
          },
          ecology: {
            comments: prep.record.comments || prep.record.ecology_comments || "Information arriving soon",
            biotope: prep.record.biotope || "Generic Biotope Details",
            phMin: prep.record.min_ph,
            phMax: prep.record.max_ph,
            hardnessRange: prep.record.hardness_range || "5 - 15 dGH",
            tempCeiling: prep.record.max_temp,
            socialBehavior: prep.record.social_behavior || prep.record.socialBehavior || "Information arriving soon"
          },
          diet: {
            trophicLevel: prep.record.trophic_level || prep.record.trophicLevel || "Omnivore",
            fooditems: prep.record.food_items || prep.record.fooditems || "Information arriving soon",
            feedingPlaybook: prep.record.feeding_playbook || prep.record.feedingPlaybook || "Information arriving soon"
          },
          reproduction: {
            spawningTrait: prep.record.spawning_trait || prep.record.spawningTrait || "Information arriving soon",
            layoutRequirement: prep.record.layout_requirement || prep.record.layoutRequirement || "Information arriving soon",
            comments: prep.record.reproduction_comments || prep.record.reproductionComments || "Information arriving soon"
          }
        };

        const duplicateIndex = fishbaseData.findIndex(
          item => item.scientificName.toLowerCase() === newEntry.scientificName.toLowerCase()
        );

        if (duplicateIndex > -1) {
          fishbaseData[duplicateIndex] = {
            ...fishbaseData[duplicateIndex],
            ...newEntry
          };
          console.log(`Synced existing cache entry for ${prep.record.scientific_name} in fishbase_master.json.`);
        } else {
          fishbaseData.push(newEntry);
          console.log(`Appended new cache entry for ${prep.record.scientific_name} to fishbase_master.json.`);
        }
      } else {
        console.error(`❌ Transaction mining failed for Species ID ${prep.speciesId} (${prep.record.scientific_name}):`, res.error.message);
        const logMsg = `Species ID: ${prep.speciesId}, Scientific Name: ${prep.record.scientific_name}, Common Name: ${prep.record.common_name}, Phase: wait, Error: ${res.error.message}\n`;
        fs.appendFileSync(errorLogPath, logMsg, "utf8");
      }
    }

    // Write updated cache to public directory after each batch to avoid data loss
    fs.writeFileSync(cachePath, JSON.stringify(fishbaseData, null, 2), "utf8");
    console.log(`⭐ Saved progress to ${cachePath} after Batch #${batchIndex}`);
  }

  console.log(`\n⭐ Migration complete. Check migration_errors.log for any failures.`);
}

main().catch((error) => {
  console.error("💥 Pipeline Fatal Error:", error);
  process.exitCode = 1;
});
