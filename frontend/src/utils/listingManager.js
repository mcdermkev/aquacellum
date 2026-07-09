import { Contract } from "ethers";
import managerAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";

/**
 * Helper to fetch and filter active specimen and batch listings for a specific speciesId.
 * Verifies activity using the active status flags from Listings and BatchListings mappings.
 */
export async function fetchListingsByBreed(speciesId, contractAddress, marketplaceAddress, provider) {
  if (!contractAddress || !marketplaceAddress || !provider) {
    return [];
  }

  const managerContract = new Contract(contractAddress, managerAbi, provider);
  const marketContract = new Contract(marketplaceAddress, marketplaceAbi, provider);

  const results = [];

  // 1. Fetch Active Individual Specimen Listings
  try {
    const totalSpecimens = Number(await managerContract.totalSpecimensMinted());
    for (let i = 1; i <= totalSpecimens; i++) {
      try {
        const listing = await marketContract.listings(i);
        // Verify listing activity flag in Listings mapping
        if (listing.active) {
          const spec = await managerContract.specimens(i);
          if (!speciesId || Number(spec.speciesId) === Number(speciesId)) {
            const species = await managerContract.speciesCatalog(Number(spec.speciesId));
            
            let hash = 0;
            const sellerAddr = listing.seller;
            for (let j = 0; j < sellerAddr.length; j++) {
              hash = sellerAddr.charCodeAt(j) + ((hash << 5) - hash);
            }
            const latOffset = ((hash & 0xFF) / 255 - 0.5) * 0.08;
            const lngOffset = (((hash >> 8) & 0xFF) / 255 - 0.5) * 0.08;
            const fuzzedLocation = {
              lat: 37.7749 + latOffset,
              lng: -122.4194 + lngOffset
            };
            const zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");

            // v2 stores on-chain price as USD *cents* (Web2-masked marketplace),
            // NOT wei. Interpret it as cents so display + Stripe checkout match
            // the local/cloud listing shape (priceCentsUSD is what checkout uses).
            const priceCents = Number(listing.price.toString());
            const shipCents = Number(listing.shippingFee.toString());
            const priceDisplayUsd = (priceCents / 100).toFixed(2);
            const shipDisplayUsd = (shipCents / 100).toFixed(2);

            results.push({
              id: i, // tokenId for single listings
              tokenId: i,
              seller: listing.seller,
              price: priceDisplayUsd,
              priceUsd: priceDisplayUsd,
              priceCentsUSD: priceCents,
              rawPrice: priceDisplayUsd,
              shippingFee: shipDisplayUsd,
              shippingFeeCents: shipCents,
              isShipping: listing.isShipping,
              speciesId: Number(spec.speciesId),
              commonName: species.commonName,
              scientificName: species.scientificName,
              sireId: Number(spec.sireId),
              damId: Number(spec.damId),
              ipfsMetadataUri: spec.ipfsMetadataUri,
              birthTimestamp: Number(spec.birthTimestamp),
              careLevel: Number(species.careLevel),
              minTemp: Number(species.minTempCelsiusX10) / 10,
              maxTemp: Number(species.maxTempCelsiusX10) / 10,
              minPh: Number(species.minPhX10) / 10,
              maxPh: Number(species.maxPhX10) / 10,
              isBatch: false,
              fuzzedLocation,
              zoneHash
            });
          }
        }
      } catch (err) {
        console.warn(`Error reading specimen listing for token ID ${i}:`, err);
      }
    }
  } catch (err) {
    console.error("Error fetching specimen listings:", err);
  }

  // 2. Fetch Active Batch Listings
  try {
    let listingId = 1;
    while (true) {
      try {
        const batch = await marketContract.batchListings(listingId);
        // Stop checking if we hit empty records (unseeded sequential IDs)
        if (batch.seller === "0x0000000000000000000000000000000000000000") {
          break;
        }

        // Verify listing activity flag in BatchListings mapping
        if (batch.isActive) {
          const spawn = await managerContract.spawnLogs(Number(batch.spawnId));
          const batchSpeciesId = Number(spawn.speciesId);

          if (!speciesId || batchSpeciesId === Number(speciesId)) {
            const species = await managerContract.speciesCatalog(batchSpeciesId);

            let hash = 0;
            const sellerAddr = batch.seller;
            for (let j = 0; j < sellerAddr.length; j++) {
              hash = sellerAddr.charCodeAt(j) + ((hash << 5) - hash);
            }
            const latOffset = ((hash & 0xFF) / 255 - 0.5) * 0.08;
            const lngOffset = (((hash >> 8) & 0xFF) / 255 - 0.5) * 0.08;
            const fuzzedLocation = {
              lat: 37.7749 + latOffset,
              lng: -122.4194 + lngOffset
            };
            const zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");

            // v2 stores pricePerFish as USD *cents*, not wei (see note above).
            const perFishCents = Number(batch.pricePerFish.toString());
            const perFishDisplayUsd = (perFishCents / 100).toFixed(2);

            results.push({
              id: listingId, // listingId for batch listings
              listingId: listingId,
              spawnId: Number(batch.spawnId),
              quantity: Number(batch.quantity),
              price: perFishDisplayUsd, // display price per fish (USD)
              priceUsd: perFishDisplayUsd,
              priceCentsUSD: perFishCents,
              pricePerFishCents: perFishCents,
              rawPrice: perFishDisplayUsd,
              seller: batch.seller,
              isActive: batch.isActive,
              speciesId: batchSpeciesId,
              commonName: `${species.commonName} Fry Batch`,
              scientificName: species.scientificName,
              careLevel: Number(species.careLevel),
              minTemp: Number(species.minTempCelsiusX10) / 10,
              maxTemp: Number(species.maxTempCelsiusX10) / 10,
              minPh: Number(species.minPhX10) / 10,
              maxPh: Number(species.maxPhX10) / 10,
              isBatch: true,
              isShipping: false, // batch purchases support pickup/shipping in checkout
              shippingFee: "0",
              fuzzedLocation,
              zoneHash
            });
          }
        }
        listingId++;
      } catch (err) {
        console.warn(`Error reading batch listing for ID ${listingId}:`, err);
        break; // Out of bounds error
      }
    }
  } catch (err) {
    console.error("Error fetching batch listings:", err);
  }

  return results;
}
