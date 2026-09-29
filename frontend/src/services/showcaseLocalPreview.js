import { db } from "../db";
import { normalizeShowcaseWallet, readSelectedShowcaseTanks } from "./showcaseDatasetV3";

const MAX_TANK_COUNT = 100; // matches the server room tank ceiling

function activeRealSpecimen(row) {
  const id = Number(row?.id);
  return Number.isSafeInteger(id) && id > 0
    && Number(row?.status ?? 0) === 0
    && row?.archived !== true
    && row?.isBatchPlaceholder !== true;
}

function specimenForDisplay(row) {
  return {
    ...row,
    id: Number(row.id),
    speciesId: Number(row.speciesId || 0),
    status: 0,
  };
}

/**
 * Build an owner-only, read-only showcase preview from the same Dexie rows shown in My Aquariums.
 * This never creates showcase UUIDs, mutates durable identity state, queries chain data, or calls a
 * server API. Local tank/specimen IDs remain private React/display keys only.
 */
export async function readLocalShowcasePreview({ ownerAddress, selectedTankIds }) {
  const owner = normalizeShowcaseWallet(ownerAddress);
  if (!Array.isArray(selectedTankIds) || selectedTankIds.length < 1 || selectedTankIds.length > MAX_TANK_COUNT) {
    throw new Error("Select at least one tank before opening the private preview.");
  }
  const uniqueIds = new Set(selectedTankIds.map((value) => String(value)));
  if (uniqueIds.size !== selectedTankIds.length) {
    throw new Error("The private preview requires distinct tanks.");
  }

  const tanks = await readSelectedShowcaseTanks(owner, selectedTankIds);
  const selected = new Set(tanks.map((tank) => String(tank.id)));
  const standalone = (await db.specimens.toArray()).filter((row) => {
    if (!activeRealSpecimen(row)) return false;
    if (typeof row.ownerAddress !== "string" || row.ownerAddress.toLowerCase() !== owner) return false;
    return selected.has(String(row.currentTankId));
  });

  const standaloneByTank = new Map();
  for (const specimen of standalone) {
    const tankId = String(specimen.currentTankId);
    if (!standaloneByTank.has(tankId)) standaloneByTank.set(tankId, []);
    standaloneByTank.get(tankId).push(specimen);
  }

  return {
    title: "GG Steve Rice Fish NJ",
    description: "Steve's Medaka fish room. Private device preview.",
    tanks: tanks.map((tank) => {
      const specimens = new Map();
      for (const specimen of Array.isArray(tank.specimens) ? tank.specimens : []) {
        if (!activeRealSpecimen(specimen)) continue;
        if (typeof specimen.ownerAddress === "string" && specimen.ownerAddress
            && specimen.ownerAddress.toLowerCase() !== owner) continue;
        if (specimen.currentTankId != null && String(specimen.currentTankId) !== String(tank.id)) continue;
        specimens.set(Number(specimen.id), specimenForDisplay(specimen));
      }
      for (const specimen of standaloneByTank.get(String(tank.id)) || []) {
        specimens.set(Number(specimen.id), specimenForDisplay(specimen));
      }
      return {
        ...tank,
        specimens: [...specimens.values()].sort((left, right) => Number(left.id) - Number(right.id)),
      };
    }),
  };
}
