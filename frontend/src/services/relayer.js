/**
 * relayer.js
 * 
 * During beta, tanks and specimens are stored locally in Dexie.js (offline-first).
 * On-chain registration is deferred until the user "publishes" their data.
 * This avoids the ownership mismatch (relayer wallet vs user wallet) and
 * prevents MetaMask from popping up for routine actions.
 */

import { db } from "../db";

/**
 * Register a tank locally in Dexie (beta mode — no on-chain write).
 * Returns a generated tank ID and stores it in the local database.
 */
export async function relayRegisterTank({
  name = "My Tank",
  tankType = 0,
  volumeLiters = 75,
  containment = 0,
  parentUnitId = 0,
  facility = "Main Room",
  room = "",
  rack = "",
  ownerAddress = "",
} = {}) {
  try {
    // Generate a local tank ID (timestamp-based, unique enough for beta)
    const tankId = Date.now();

    const tank = {
      id: tankId,
      ownerAddress,
      name,
      tankType,
      volumeLiters,
      creationTimestamp: Math.floor(Date.now() / 1000),
      active: true,
      containment,
      parentUnitId,
      facility,
      room,
      rack,
      logs: [],
      latestLog: null,
      specimens: [],
    };

    // Store in Dexie
    await db.tanks.put(tank);

    return { success: true, tankId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local tank registration failed:", err);
    return { success: false, error: err.message || "Failed to save tank" };
  }
}

/**
 * Mint a specimen locally in Dexie (beta mode — no on-chain write).
 * Adds the specimen to the target tank's specimens array and to the
 * standalone specimens table for direct queries.
 */
export async function relayMintSpecimen({
  speciesId,
  birthTimestamp = 0,
  breeder = "",
  currentTankId = 0,
  sireId = 0,
  damId = 0,
  ipfsMetadataUri = "",
  ownerAddress = "",
  commonName = "",
  scientificName = "",
} = {}) {
  try {
    const specimenId = Date.now();

    const specimen = {
      id: specimenId,
      speciesId: Number(speciesId),
      birthTimestamp,
      breeder,
      currentTankId: Number(currentTankId),
      sireId: Number(sireId),
      damId: Number(damId),
      ipfsMetadataUri,
      ownerAddress,
      commonName,
      scientificName,
      status: 0, // Active
      createdAt: Math.floor(Date.now() / 1000),
    };

    // Store in standalone specimens table
    await db.specimens.put(specimen);

    // Also embed in the tank's specimens array if a tank is specified
    if (currentTankId && Number(currentTankId) !== 0) {
      const tank = await db.tanks.get(Number(currentTankId));
      if (tank) {
        const specimens = tank.specimens || [];
        specimens.push({
          id: specimenId,
          speciesId: Number(speciesId),
          commonName,
          scientificName,
          status: 0,
        });
        await db.tanks.update(Number(currentTankId), { specimens });
      }
    }

    return { success: true, specimenId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen mint failed:", err);
    return { success: false, error: err.message || "Failed to save specimen" };
  }
}

/**
 * Move a specimen between tanks locally in Dexie (beta mode — no on-chain write).
 * Removes the specimen from the source tank's array and adds it to the target.
 */
export async function relayMoveSpecimen({
  specimenId,
  targetTankId,
} = {}) {
  try {
    specimenId = Number(specimenId);
    targetTankId = Number(targetTankId);

    // Update the specimen record
    const specimen = await db.specimens.get(specimenId);
    if (!specimen) {
      return { success: false, error: "Specimen not found" };
    }

    const sourceTankId = specimen.currentTankId;

    // Remove from source tank's specimens array
    if (sourceTankId && sourceTankId !== 0) {
      const sourceTank = await db.tanks.get(sourceTankId);
      if (sourceTank) {
        const filtered = (sourceTank.specimens || []).filter(s => s.id !== specimenId);
        await db.tanks.update(sourceTankId, { specimens: filtered });
      }
    }

    // Add to target tank's specimens array
    if (targetTankId !== 0) {
      const targetTank = await db.tanks.get(targetTankId);
      if (targetTank) {
        const specimens = targetTank.specimens || [];
        specimens.push({
          id: specimenId,
          speciesId: specimen.speciesId,
          commonName: specimen.commonName,
          scientificName: specimen.scientificName,
          status: specimen.status,
        });
        await db.tanks.update(targetTankId, { specimens });
      }
    }

    // Update specimen's currentTankId
    await db.specimens.update(specimenId, { currentTankId: targetTankId });

    return { success: true, specimenId, targetTankId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen move failed:", err);
    return { success: false, error: err.message || "Failed to move specimen" };
  }
}

/**
 * Log water parameters locally in Dexie (beta mode — no on-chain write).
 * Appends the log to the tank's logs array and updates latestLog.
 */
export async function relayLogWaterParameters({
  tankId,
  tempCelsiusX10,
  phX10,
  salinitySgX10000,
  ammoniaPpmX100,
  nitritePpmX100,
  nitratePpmX100,
  notes = "",
} = {}) {
  try {
    tankId = Number(tankId);

    const tank = await db.tanks.get(tankId);
    if (!tank) {
      return { success: false, error: "Tank not found" };
    }

    const log = {
      timestamp: Math.floor(Date.now() / 1000),
      tempCelsiusX10,
      phX10,
      salinitySgX10000,
      ammoniaPpmX100,
      nitritePpmX100,
      nitratePpmX100,
      notes,
    };

    const logs = tank.logs || [];
    logs.push(log);

    await db.tanks.update(tankId, { logs, latestLog: log });

    return { success: true, tankId, logIndex: logs.length - 1, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local water parameter log failed:", err);
    return { success: false, error: err.message || "Failed to log parameters" };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// MARKETPLACE — Local-first (beta). No MetaMask, no gas.
// All listing/purchase/escrow state lives in Dexie until on-chain publish.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Returns the user's locally-created beta listings, merged-ready for the
 * marketplace board reads. Safe to call even if the table is empty.
 */
export async function getLocalListings(speciesId = null) {
  try {
    let rows = await db.localListings.toArray();
    if (speciesId) {
      rows = rows.filter((l) => Number(l.speciesId) === Number(speciesId));
    }
    return rows;
  } catch (err) {
    console.warn("[Relayer] getLocalListings failed:", err);
    return [];
  }
}

/**
 * Create a single specimen listing locally (beta).
 * Mirrors the object shape produced by listingManager.fetchListingsByBreed.
 */
export async function relayCreateListing({
  tokenId,
  priceEth,
  shippingFeeEth = "0",
  isShipping = false,
  seller = "",
  speciesId = 0,
  commonName = "Specimen",
  scientificName = "Unknown",
  sireId = 0,
  damId = 0,
  ipfsMetadataUri = "",
  careLevel = 0,
  minTemp = 0,
  maxTemp = 0,
  minPh = 0,
  maxPh = 0,
} = {}) {
  try {
    const listing = {
      id: Number(tokenId),
      tokenId: Number(tokenId),
      seller,
      price: String(priceEth),
      rawPrice: String(priceEth),
      shippingFee: String(shippingFeeEth),
      isShipping: !!isShipping,
      speciesId: Number(speciesId),
      commonName,
      scientificName,
      sireId: Number(sireId),
      damId: Number(damId),
      ipfsMetadataUri,
      careLevel: Number(careLevel),
      minTemp: Number(minTemp),
      maxTemp: Number(maxTemp),
      minPh: Number(minPh),
      maxPh: Number(maxPh),
      isBatch: false,
      active: true,
      fuzzedLocation: { lat: 37.7749, lng: -122.4194 },
      zoneHash: "0x00000000",
      createdAt: Math.floor(Date.now() / 1000),
    };

    await db.localListings.put(listing);
    // Also write to the listings cache so it shows immediately
    try { await db.listings.put(listing); } catch (e) {}

    return { success: true, tokenId: Number(tokenId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Local listing creation failed:", err);
    return { success: false, error: err.message || "Failed to create listing" };
  }
}

/**
 * Cancel (remove) a single specimen listing locally.
 */
export async function relayCancelListing(tokenId) {
  try {
    await db.localListings.delete(Number(tokenId));
    try { await db.listings.delete(Number(tokenId)); } catch (e) {}
    return { success: true, tokenId: Number(tokenId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Local listing cancel failed:", err);
    return { success: false, error: err.message || "Failed to cancel listing" };
  }
}

/**
 * Cancel (remove) a batch listing locally.
 */
export async function relayCancelBatchListing(listingId) {
  try {
    const rows = await db.localListings.where("listingId").equals(Number(listingId)).toArray();
    for (const r of rows) {
      await db.localListings.delete(r.id);
      try { await db.listings.delete(r.id); } catch (e) {}
    }
    return { success: true, listingId: Number(listingId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Local batch listing cancel failed:", err);
    return { success: false, error: err.message || "Failed to cancel batch listing" };
  }
}

/**
 * Purchase a single specimen locally. Removes the listing and records a
 * shipping order (if shipping) or completes a direct sale.
 */
export async function relayPurchaseSpecimen({
  tokenId,
  buyer = "",
  seller = "",
  priceEth = "0",
  shippingFeeEth = "0",
  isShipping = false,
  commonName = "Specimen",
} = {}) {
  try {
    tokenId = Number(tokenId);

    // Remove the listing locally
    await db.localListings.delete(tokenId);
    try { await db.listings.delete(tokenId); } catch (e) {}

    // Transfer specimen ownership locally if it exists
    const specimen = await db.specimens.get(tokenId);
    if (specimen && buyer) {
      await db.specimens.update(tokenId, { ownerAddress: buyer });
    }

    // Record a shipping escrow order so the Orders view can track it
    const order = {
      orderType: "shipping",
      tokenId,
      buyer,
      seller,
      price: String(priceEth),
      shippingFee: String(shippingFeeEth),
      amountLocked: String(Number(priceEth) + Number(shippingFeeEth)),
      trackingNumber: "",
      dispatchTimestamp: 0,
      status: 0, // 0 = locked / awaiting dispatch
      commonName,
      createdAt: Math.floor(Date.now() / 1000),
    };
    await db.marketOrders.put(order);

    return { success: true, tokenId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local specimen purchase failed:", err);
    return { success: false, error: err.message || "Failed to purchase specimen" };
  }
}

/**
 * Purchase multiple specimens locally (consolidated checkout).
 */
export async function relayPurchaseMultiple({ tokenIds = [], buyer = "", listings = [] } = {}) {
  try {
    for (const tid of tokenIds) {
      const item = listings.find((l) => Number(l.tokenId) === Number(tid)) || {};
      await relayPurchaseSpecimen({
        tokenId: tid,
        buyer,
        seller: item.seller || "",
        priceEth: item.price || "0",
        shippingFeeEth: item.shippingFee || "0",
        isShipping: item.isShipping || false,
        commonName: item.commonName || "Specimen",
      });
    }
    return { success: true, count: tokenIds.length, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local consolidated purchase failed:", err);
    return { success: false, error: err.message || "Failed to purchase specimens" };
  }
}

/**
 * Purchase a batch (juveniles) locally. Decrements listing quantity and
 * records a batch escrow order. Returns a generated purchaseId.
 */
export async function relayPurchaseBatch({
  listingId,
  quantity,
  buyer = "",
  seller = "",
  pricePerFishEth = "0",
  commonName = "Juvenile Fry Batch",
  fulfillmentType = 0,
} = {}) {
  try {
    listingId = Number(listingId);
    quantity = Number(quantity);

    // Decrement quantity on the local batch listing
    const rows = await db.localListings.where("listingId").equals(listingId).toArray();
    for (const r of rows) {
      const newQty = Number(r.quantity || 0) - quantity;
      if (newQty <= 0) {
        await db.localListings.delete(r.id);
        try { await db.listings.delete(r.id); } catch (e) {}
      } else {
        await db.localListings.update(r.id, { quantity: newQty });
        try { await db.listings.update(r.id, { quantity: newQty }); } catch (e) {}
      }
    }

    const purchaseId = Date.now();
    const order = {
      orderType: "batch",
      purchaseId,
      listingId,
      buyer,
      seller,
      quantity,
      amountLocked: String(Number(pricePerFishEth) * quantity),
      state: 0, // 0 = pending
      fulfillmentType: Number(fulfillmentType),
      commonName,
      createdAt: Math.floor(Date.now() / 1000),
    };
    await db.marketOrders.put(order);

    return { success: true, purchaseId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local batch purchase failed:", err);
    return { success: false, error: err.message || "Failed to purchase batch" };
  }
}

/**
 * Load the user's local orders (as buyer or seller), shaped for CheckoutSummary.
 */
export async function relayGetOrders(walletAccount = "") {
  const acct = (walletAccount || "").toLowerCase();
  const shippingEscrows = [];
  const purchases = [];
  try {
    const orders = await db.marketOrders.toArray();
    for (const o of orders) {
      const isBuyer = (o.buyer || "").toLowerCase() === acct;
      const isSeller = (o.seller || "").toLowerCase() === acct;
      if (!isBuyer && !isSeller) continue;
      const role = isBuyer ? "Buyer" : "Seller";
      if (o.orderType === "shipping") {
        shippingEscrows.push({ ...o, role });
      } else if (o.orderType === "batch") {
        purchases.push({ ...o, role });
      }
    }
  } catch (err) {
    console.warn("[Relayer] relayGetOrders failed:", err);
  }
  return { shippingEscrows, purchases };
}

/**
 * Update a shipping order's status locally (dispatch / release / dispute / resolve).
 */
export async function relayUpdateShippingOrder(tokenId, changes = {}) {
  try {
    const order = await db.marketOrders.where({ orderType: "shipping", tokenId: Number(tokenId) }).first();
    if (!order) return { success: false, error: "Order not found" };
    await db.marketOrders.update(order.key, changes);
    return { success: true, tokenId: Number(tokenId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Shipping order update failed:", err);
    return { success: false, error: err.message || "Failed to update order" };
  }
}

/**
 * Update a batch order's state locally (release / refund).
 */
export async function relayUpdateBatchOrder(purchaseId, changes = {}) {
  try {
    const order = await db.marketOrders.where({ orderType: "batch", purchaseId: Number(purchaseId) }).first();
    if (!order) return { success: false, error: "Order not found" };
    await db.marketOrders.update(order.key, changes);
    return { success: true, purchaseId: Number(purchaseId), txHash: null };
  } catch (err) {
    console.error("[Relayer] Batch order update failed:", err);
    return { success: false, error: err.message || "Failed to update order" };
  }
}

/**
 * Settle an in-person / cash handshake locally. Removes the pending handshake
 * pre-image and marks the related order complete.
 */
export async function relaySettleHandshake({ purchaseId, tokenIds = [] } = {}) {
  try {
    if (purchaseId != null) {
      const order = await db.marketOrders.where({ orderType: "batch", purchaseId: Number(purchaseId) }).first();
      if (order) await db.marketOrders.update(order.key, { state: 1 });
      try { await db.pendingHandshakes.delete(Number(purchaseId)); } catch (e) {}
    }
    for (const tid of tokenIds) {
      const order = await db.marketOrders.where({ orderType: "shipping", tokenId: Number(tid) }).first();
      if (order) await db.marketOrders.update(order.key, { status: 2 });
    }
    return { success: true, txHash: null };
  } catch (err) {
    console.error("[Relayer] Handshake settle failed:", err);
    return { success: false, error: err.message || "Failed to settle handshake" };
  }
}

/**
 * Register a spawn locally and mint its offspring as local specimens.
 * Returns the generated spawnId and the list of offspring specimen IDs.
 */
export async function relaySpawn({
  sireId,
  damId,
  tankId = 0,
  speciesId,
  offspringCount = 0,
  ownerAddress = "",
  commonName = "Specimen",
  scientificName = "Unknown",
  ipfsMetadataUri = "",
  metadata = null,
} = {}) {
  try {
    const spawnId = Date.now();

    const spawn = {
      spawnId,
      sireId: Number(sireId),
      damId: Number(damId),
      tankId: Number(tankId),
      speciesId: Number(speciesId),
      status: 1, // Fry
      offspringIds: [],
      ownerAddress,
      timestamp: Math.floor(Date.now() / 1000),
      metadata,
    };
    await db.spawns.put(spawn);

    const offspringIds = [];
    for (let i = 0; i < Number(offspringCount); i++) {
      const res = await relayMintSpecimen({
        speciesId,
        birthTimestamp: Math.floor(Date.now() / 1000),
        breeder: ownerAddress,
        currentTankId: tankId,
        sireId,
        damId,
        ipfsMetadataUri,
        ownerAddress,
        commonName,
        scientificName,
      });
      if (res.success) offspringIds.push(res.specimenId);
    }

    await db.spawns.update(spawnId, { offspringIds });

    return { success: true, spawnId, offspringIds, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local spawn failed:", err);
    return { success: false, error: err.message || "Failed to register spawn" };
  }
}

/**
 * Approve / register a species locally (curator action) — writes to the
 * species catalog cache so it appears in selectors without an on-chain tx.
 */
export async function relayAddSpecies({
  scientificName,
  commonName,
  ipfsUri = "",
  careLevel = 0,
  minTemp = 0,
  maxTemp = 0,
  minPh = 0,
  maxPh = 0,
  contractAddress = "",
} = {}) {
  try {
    const speciesId = Date.now();
    const record = {
      speciesId,
      scientificName,
      commonName,
      contractAddress,
      ipfsUri,
      careLevel: Number(careLevel),
      minTempCelsiusX10: Math.round(Number(minTemp) * 10),
      maxTempCelsiusX10: Math.round(Number(maxTemp) * 10),
      minPhX10: Math.round(Number(minPh) * 10),
      maxPhX10: Math.round(Number(maxPh) * 10),
      active: true,
      cachedAt: Math.floor(Date.now() / 1000),
    };
    await db.speciesManifest.put(record);
    return { success: true, speciesId, txHash: null };
  } catch (err) {
    console.error("[Relayer] Local species add failed:", err);
    return { success: false, error: err.message || "Failed to add species" };
  }
}
