import { db } from "../db";
import { tankTypeLabel } from "../utils/tankUtils";

const MAX_SAFE = 9007199254740991;
const CHUNK_ROWS = 250;
const SECTION_ORDER = Object.freeze(["aliases", "specimens", "tanks"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ShowcaseDatasetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ShowcaseDatasetError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ShowcaseDatasetError(code, message);
}

export function normalizeShowcaseWallet(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("wallet_invalid", "A valid authenticated wallet is required.");
  }
  return value.toLowerCase();
}

function canonicalLocalId(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_SAFE || String(number) !== String(value)) {
    fail("local_id_invalid", "A selected tank has an unsupported local identifier.");
  }
  return String(number);
}

function uuid() {
  const value = crypto.randomUUID().toLowerCase();
  if (!UUID_RE.test(value)) fail("uuid_unavailable", "Secure UUID generation is unavailable.");
  return value;
}

function wholeSecondUtc() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("unicode_invalid", "The dataset contains invalid Unicode text.");
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("unicode_invalid", "The dataset contains invalid Unicode text.");
    }
  }
  return value;
}

function normalizeText(value, max, required = false) {
  if (value === null || value === undefined) {
    if (required) fail("tank_invalid", "A selected tank is missing its name.");
    return null;
  }
  if (typeof value !== "string") fail("tank_invalid", "A selected tank contains unsupported text.");
  const raw = assertUnicodeScalarString(value);
  const text = assertUnicodeScalarString(raw.normalize("NFC").trim());
  if ((required && !text) || [...text].length > max) fail("tank_invalid", "A selected tank contains invalid text.");
  return text || null;
}

function decimalString(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number >= 1000000000) return null;
  const text = number.toFixed(3).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
  return /^[1-9][0-9]{0,8}(?:\.[0-9]{0,2}[1-9])?$/.test(text) ? text : null;
}

function dateString(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function jcsCanonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value) || Math.abs(value) > MAX_SAFE) fail("jcs_number_invalid", "Canonical JSON only permits safe integers.");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(assertUnicodeScalarString(value));
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(assertUnicodeScalarString(key))}:${jcsCanonicalize(value[key])}`).join(",")}}`;
  }
  fail("jcs_value_invalid", "The dataset contains a value outside the canonical JSON domain.");
}

export async function sha256Canonical(value) {
  const bytes = new TextEncoder().encode(jcsCanonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function rejectShowcaseBackupEvidence(value) {
  if (value?.schema_version === 2 || value?.schemaVersion === 2) {
    fail("legacy_backup_rejected", "Schema-v2 backup files are not showcase identity evidence.");
  }
  if (value != null) fail("external_evidence_rejected", "Showcase identity must be built from current owner-scoped raw tanks.");
}

export async function readOwnerShowcaseTanks(ownerAddress) {
  const owner = normalizeShowcaseWallet(ownerAddress);
  const rows = await db.tanks.toArray();
  return rows
    .filter((row) => row?.active !== false && typeof row.ownerAddress === "string" && row.ownerAddress.toLowerCase() === owner)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export async function readSelectedShowcaseTanks(ownerAddress, selectedTankIds) {
  const owner = normalizeShowcaseWallet(ownerAddress);
  if (!Array.isArray(selectedTankIds) || selectedTankIds.length === 0) fail("selection_required", "Select tanks explicitly.");
  const localIds = [...new Set(selectedTankIds.map(canonicalLocalId))].sort((a, b) => Number(a) - Number(b));
  if (localIds.length !== selectedTankIds.length) fail("selection_invalid", "The tank selection contains duplicates.");
  const rows = await db.tanks.bulkGet(localIds.map(Number));
  if (rows.length !== localIds.length || rows.some((row) => !row)) fail("tank_missing", "A selected local tank no longer exists.");
  for (const row of rows) {
    if (row.active === false || normalizeShowcaseWallet(row.ownerAddress) !== owner) {
      fail("tank_not_owned", "Only active raw tanks owned by the authenticated wallet may be selected.");
    }
  }
  return rows;
}

function sameIds(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function getShowcaseDatasetState(ownerAddress) {
  return db.showcaseDatasetState.get(normalizeShowcaseWallet(ownerAddress));
}

export async function prepareShowcaseDatasetV3({ ownerAddress, selectedTankIds, serverHasExistingDataset = false, evidence = null }) {
  rejectShowcaseBackupEvidence(evidence);
  const owner = normalizeShowcaseWallet(ownerAddress);
  const tanks = await readSelectedShowcaseTanks(owner, selectedTankIds);
  const ids = tanks.map((tank) => canonicalLocalId(tank.id)).sort((a, b) => Number(a) - Number(b));

  const state = await db.transaction("rw", [db.showcaseDatasetState, db.showcaseEntityMappings], async () => {
    let current = await db.showcaseDatasetState.get(owner);
    if (!current && serverHasExistingDataset) {
      fail("durable_mapping_missing", "The server already has a showcase dataset, but this browser has no durable identity mapping. Stop and recover the original browser data.");
    }
    if (current?.selectedTankIds && !sameIds(current.selectedTankIds, ids)) {
      fail("dataset_selection_locked", "This browser already has a persisted showcase dataset with a different confirmed selection.");
    }
    const creating = !current;
    if (!current) {
      current = {
        ownerAddress: owner,
        datasetId: uuid(),
        importOperationId: uuid(),
        candidateOperationId: uuid(),
        selectedTankIds: ids,
        exportedAt: wholeSecondUtc(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        enrollmentRequest: null,
        startRequest: null,
        chunkRequests: null,
        finalizeRequest: null,
        candidateRequest: null,
      };
      current.enrollmentRequest = {
        datasetId: current.datasetId,
        enrollmentVersion: 1,
        initialManifestSha256: null,
      };
      await db.showcaseDatasetState.add(current);
    }
    for (const localId of ids) {
      const key = [owner, "tank", localId];
      const existing = await db.showcaseEntityMappings.get(key);
      if (!existing && !creating) {
        fail("durable_mapping_missing", "A persisted showcase entity mapping is missing. Stop and recover the original browser data.");
      }
      if (!existing) {
        await db.showcaseEntityMappings.add({
          ownerAddress: owner,
          entityKind: "tank",
          localId,
          entityKey: uuid(),
          createdAt: Date.now(),
        });
      }
    }
    return current;
  });
  return { state, tanks };
}

async function rowWithDigest(row) {
  return { ...row, rowSha256: await sha256Canonical(row) };
}

async function buildRows(owner, state) {
  const tanks = await readSelectedShowcaseTanks(owner, state.selectedTankIds);
  const mappings = await db.showcaseEntityMappings
    .where("ownerAddress").equals(owner)
    .and((row) => row.entityKind === "tank" && state.selectedTankIds.includes(row.localId))
    .toArray();
  const byLocalId = new Map(mappings.map((row) => [row.localId, row.entityKey]));
  if (byLocalId.size !== state.selectedTankIds.length) fail("durable_mapping_missing", "A persisted tank identity mapping is missing.");

  const tankRows = [];
  const aliases = [];
  for (const tank of tanks) {
    const localId = canonicalLocalId(tank.id);
    const entityKey = byLocalId.get(localId);
    tankRows.push(await rowWithDigest({
      entityKey,
      sourceRevision: 0,
      internalName: normalizeText(tank.name, 255, true),
      volumeLiters: decimalString(tank.volumeLiters),
      tankType: normalizeText(tankTypeLabel(tank.tankType), 64),
      establishedAt: dateString(tank.creationTimestamp),
      isActive: true,
    }));
    aliases.push(await rowWithDigest({ entityKind: "tank", entityKey, aliasKind: "local_tank", value: localId }));
  }
  tankRows.sort((a, b) => a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0);
  aliases.sort((a, b) => {
    const ak = `${a.entityKind}\u001f${a.aliasKind}\u001f${a.value}`;
    const bk = `${b.entityKind}\u001f${b.aliasKind}\u001f${b.value}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  return { aliases, specimens: [], tanks: tankRows };
}

async function chunksFor(identity) {
  const chunks = [];
  for (const section of SECTION_ORDER) {
    const rows = identity[section];
    for (let index = 0; index < rows.length; index += CHUNK_ROWS) {
      const payload = rows.slice(index, index + CHUNK_ROWS);
      const canonicalBytes = new TextEncoder().encode(jcsCanonicalize(payload)).byteLength;
      if (canonicalBytes > 1048576) fail("chunk_too_large", "A canonical dataset chunk exceeds the server limit.");
      chunks.push({ section, chunkIndex: index / CHUNK_ROWS, rowCount: payload.length, chunkSha256: await sha256Canonical(payload), rows: payload });
    }
  }
  return chunks;
}

export async function bindShowcaseDatasetEnrollment(ownerAddress, enrollment) {
  const owner = normalizeShowcaseWallet(ownerAddress);
  const state = await db.showcaseDatasetState.get(owner);
  if (!state) fail("durable_mapping_missing", "The durable showcase dataset state is missing.");
  if (enrollment?.datasetId !== state.datasetId || typeof enrollment?.enrollmentReference !== "string") {
    fail("enrollment_mismatch", "The server enrollment does not match this browser dataset.");
  }
  if (state.enrollmentReference && state.enrollmentReference !== enrollment.enrollmentReference) {
    fail("enrollment_mismatch", "The persisted enrollment binding changed unexpectedly.");
  }
  // Safe retry: once the exact package/start body is durable, never rebuild it from mutable raw rows.
  if (state.startRequest) return state;

  const identity = await buildRows(owner, state);
  const sections = [];
  for (const name of SECTION_ORDER) sections.push({ name, count: identity[name].length, sha256: await sha256Canonical(identity[name]) });
  const manifest = {
    manifestVersion: 1,
    schemaVersion: 3,
    datasetId: state.datasetId,
    enrollmentReference: enrollment.enrollmentReference,
    exportedAt: state.exportedAt,
    sections,
  };
  const identityPackage = {
    identityPackageVersion: 1,
    schemaVersion: 3,
    datasetId: state.datasetId,
    enrollmentReference: enrollment.enrollmentReference,
    exportedAt: state.exportedAt,
    manifest,
    identity,
  };
  const manifestSha256 = await sha256Canonical(manifest);
  const identityPackageSha256 = await sha256Canonical(identityPackage);
  const chunks = await chunksFor(identity);
  const startRequest = {
    operationId: state.importOperationId,
    sourceSchemaVersion: 3,
    sourceDatasetId: state.datasetId,
    enrollmentReference: enrollment.enrollmentReference,
    declaredBackupSha256: identityPackageSha256,
    manifestSha256,
    manifest,
  };
  const next = {
    ...state,
    enrollmentReference: enrollment.enrollmentReference,
    enrollmentStatus: enrollment.status,
    manifest,
    manifestSha256,
    identityPackage,
    identityPackageSha256,
    preparedChunks: chunks,
    startRequest,
    updatedAt: Date.now(),
  };
  await db.showcaseDatasetState.put(next);
  return next;
}

export async function bindShowcaseDatasetImport(ownerAddress, importResult) {
  const owner = normalizeShowcaseWallet(ownerAddress);
  const state = await db.showcaseDatasetState.get(owner);
  if (!state?.startRequest) fail("dataset_not_prepared", "The dataset package has not been prepared.");
  if (state.importId && state.importId !== importResult?.importId) fail("import_mismatch", "The persisted import binding changed unexpectedly.");
  if (!importResult?.importId || !Number.isSafeInteger(importResult.revision)) fail("import_invalid", "The server import response is invalid.");
  // Safe retry: reuse the exact persisted chunk/finalize/candidate bodies after binding.
  if (state.importId && state.chunkRequests && state.finalizeRequest && state.candidateRequest) return state;
  if (!Array.isArray(state.preparedChunks)) fail("dataset_not_prepared", "The persisted import requests are incomplete.");
  const chunkRequests = state.preparedChunks.map((chunk) => ({ importId: importResult.importId, ...chunk }));
  const finalizeRequest = {
    importId: importResult.importId,
    expectedRevision: importResult.revision,
    manifest: state.manifest,
    identityPackageSha256: state.identityPackageSha256,
  };
  const rowRefs = [];
  for (const chunk of state.preparedChunks) {
    if (chunk.section !== "tanks") continue;
    for (let rowIndex = 0; rowIndex < chunk.rows.length; rowIndex++) rowRefs.push({ section: "tanks", chunkIndex: chunk.chunkIndex, rowIndex });
  }
  const candidateRequest = {
    operationId: state.candidateOperationId,
    importId: importResult.importId,
    rowRefs,
  };
  const next = {
    ...state,
    importId: importResult.importId,
    importRevision: importResult.revision,
    chunkRequests,
    finalizeRequest,
    candidateRequest,
    updatedAt: Date.now(),
  };
  delete next.preparedChunks;
  await db.showcaseDatasetState.put(next);
  return next;
}

export async function recordShowcaseDatasetResult(ownerAddress, patch) {
  const owner = normalizeShowcaseWallet(ownerAddress);
  const state = await db.showcaseDatasetState.get(owner);
  if (!state) fail("durable_mapping_missing", "The durable showcase dataset state is missing.");
  const next = { ...state, ...patch, ownerAddress: owner, updatedAt: Date.now() };
  await db.showcaseDatasetState.put(next);
  return next;
}

export function typedTankId(entityKey) {
  if (!UUID_RE.test(entityKey)) fail("entity_key_invalid", "The canonical tank identity is invalid.");
  return `tank_${entityKey}`;
}
