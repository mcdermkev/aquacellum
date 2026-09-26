// Fish Room R1.3B — exact request-body validation.
//
// Every action body is an exact JSON object: unknown keys, missing keys, wrong types, and
// out-of-bounds values reject with a closed code (invalid_request | invalid_field | unknown_field |
// invalid_entity_id). No SQL/upstream detail is ever produced here. Validators return either
// { ok: true, value } (normalized fields the route passes onward) or { ok: false, code, field? }.

import { isCanonicalUuid, decodeEntityId, decodeVideoId } from "./showcaseIds.js";
import { isSha256Hex } from "./showcaseManifest.js";

const HEX64_OR_NULL = (v) => v === null || isSha256Hex(v);
const CHAIN_ID = /^[1-9][0-9]{0,18}$/;
const NONCE_B64URL = /^[A-Za-z0-9_-]{43}$/;
const WALLET = /^0x[0-9A-Fa-f]{40}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CANONICAL_DECIMAL = /^[1-9][0-9]*$/;
const MAX_SAFE = 9007199254740991;

function isPlainObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function fail(code, field) {
  return field ? { ok: false, code, field } : { ok: false, code };
}
function ok(value) {
  return { ok: true, value: value || {} };
}
// Exact key-set match (order-independent). Rejects unknown or missing keys.
function keysExactly(obj, allowed) {
  if (!isPlainObject(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length !== allowed.length) return false;
  const set = new Set(allowed);
  for (const k of keys) if (!set.has(k)) return false;
  return true;
}
function isSafeUint(n, max) {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= (max === undefined ? MAX_SAFE : max);
}
function isBool(v) {
  return typeof v === "boolean";
}
function isStrLen(v, min, max) {
  return typeof v === "string" && v.length >= min && v.length <= max;
}
function isNullableStr(v, max) {
  return v === null || (typeof v === "string" && v.length >= 1 && v.length <= max);
}

// ── Auth-independent shared field checks ───────────────────────────────────

function chainIdOk(v) {
  return typeof v === "string" && CHAIN_ID.test(v);
}

// ── Per-action validators ──────────────────────────────────────────────────

const VALIDATORS = {
  bootstrap(body) {
    if (!keysExactly(body, [])) return fail("invalid_request");
    return ok({});
  },

  "identity-state"(body) {
    if (!keysExactly(body, ["entityCursor", "entityLimit", "conflictCursor", "conflictLimit"])) {
      return fail("invalid_request");
    }
    if (body.entityCursor !== null && typeof body.entityCursor !== "string") return fail("invalid_field", "entityCursor");
    if (body.conflictCursor !== null && typeof body.conflictCursor !== "string") return fail("invalid_field", "conflictCursor");
    if (!isSafeUint(body.entityLimit, 100) || body.entityLimit < 1) return fail("invalid_field", "entityLimit");
    if (!isSafeUint(body.conflictLimit, 50) || body.conflictLimit < 1) return fail("invalid_field", "conflictLimit");
    return ok({
      entityCursor: body.entityCursor, entityLimit: body.entityLimit,
      conflictCursor: body.conflictCursor, conflictLimit: body.conflictLimit,
    });
  },

  "identity-conflict-candidates"(body) {
    if (!keysExactly(body, ["conflictId", "candidateCursor", "candidateLimit"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.conflictId)) return fail("invalid_field", "conflictId");
    if (body.candidateCursor !== null && typeof body.candidateCursor !== "string") return fail("invalid_field", "candidateCursor");
    if (!isSafeUint(body.candidateLimit, 100) || body.candidateLimit < 1) return fail("invalid_field", "candidateLimit");
    return ok({ conflictId: body.conflictId, candidateCursor: body.candidateCursor, candidateLimit: body.candidateLimit });
  },

  "wallet-claim-link"(body) {
    if (!keysExactly(body, ["chainId"])) return fail("invalid_request");
    if (!chainIdOk(body.chainId)) return fail("invalid_field", "chainId");
    return ok({ chainId: body.chainId });
  },

  "wallet-nonce-issue"(body) {
    if (!keysExactly(body, ["wallet", "chainId"])) return fail("invalid_request");
    if (typeof body.wallet !== "string" || !WALLET.test(body.wallet)) return fail("invalid_field", "wallet");
    if (!chainIdOk(body.chainId)) return fail("invalid_field", "chainId");
    return ok({ wallet: body.wallet, chainId: body.chainId });
  },

  "wallet-proof-consume"(body) {
    if (!keysExactly(body, ["nonceId", "nonce", "wallet", "chainId", "issuedAt", "expirationTime", "signature"])) {
      return fail("invalid_request");
    }
    if (!isCanonicalUuid(body.nonceId)) return fail("invalid_field", "nonceId");
    if (typeof body.nonce !== "string" || !NONCE_B64URL.test(body.nonce)) return fail("invalid_field", "nonce");
    if (typeof body.wallet !== "string" || !WALLET.test(body.wallet)) return fail("invalid_field", "wallet");
    if (!chainIdOk(body.chainId)) return fail("invalid_field", "chainId");
    if (typeof body.issuedAt !== "string" || !RFC3339_UTC.test(body.issuedAt)) return fail("invalid_field", "issuedAt");
    if (typeof body.expirationTime !== "string" || !RFC3339_UTC.test(body.expirationTime)) return fail("invalid_field", "expirationTime");
    if (typeof body.signature !== "string" || !/^0x[0-9A-Fa-f]{130}$/.test(body.signature)) return fail("invalid_field", "signature");
    return ok({ ...body });
  },

  "dataset-enroll"(body) {
    if (!keysExactly(body, ["datasetId", "enrollmentVersion", "initialManifestSha256"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.datasetId)) return fail("invalid_field", "datasetId");
    if (!isSafeUint(body.enrollmentVersion) || body.enrollmentVersion < 1) return fail("invalid_field", "enrollmentVersion");
    if (!HEX64_OR_NULL(body.initialManifestSha256)) return fail("invalid_field", "initialManifestSha256");
    return ok({ ...body });
  },

  "dataset-import-start"(body) {
    if (!keysExactly(body, ["operationId", "sourceSchemaVersion", "sourceDatasetId", "enrollmentReference", "declaredBackupSha256", "manifestSha256", "manifest"])) {
      return fail("invalid_request");
    }
    if (!isCanonicalUuid(body.operationId)) return fail("invalid_field", "operationId");
    if (![1, 2, 3].includes(body.sourceSchemaVersion)) return fail("invalid_field", "sourceSchemaVersion");
    if (!isSha256Hex(body.declaredBackupSha256)) return fail("invalid_field", "declaredBackupSha256");
    if (!isPlainObject(body.manifest)) return fail("invalid_field", "manifest");
    if (body.sourceSchemaVersion === 3) {
      if (!isCanonicalUuid(body.sourceDatasetId)) return fail("invalid_field", "sourceDatasetId");
      if (!isStrLen(body.enrollmentReference, 1, 512)) return fail("invalid_field", "enrollmentReference");
      if (!isSha256Hex(body.manifestSha256)) return fail("invalid_field", "manifestSha256");
      if (Object.keys(body.manifest).length === 0) return fail("invalid_field", "manifest");
    } else {
      if (body.sourceDatasetId !== null) return fail("invalid_field", "sourceDatasetId");
      if (body.enrollmentReference !== null) return fail("invalid_field", "enrollmentReference");
      if (body.manifestSha256 !== null) return fail("invalid_field", "manifestSha256");
      if (Object.keys(body.manifest).length !== 0) return fail("invalid_field", "manifest");
    }
    return ok({ ...body });
  },

  "dataset-import-chunk"(body) {
    if (!keysExactly(body, ["importId", "section", "chunkIndex", "rowCount", "chunkSha256", "rows"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.importId)) return fail("invalid_field", "importId");
    if (!["tanks", "specimens", "aliases"].includes(body.section)) return fail("invalid_field", "section");
    if (!isSafeUint(body.chunkIndex, 19)) return fail("invalid_field", "chunkIndex");
    if (!isSafeUint(body.rowCount, 500)) return fail("invalid_field", "rowCount");
    if (!isSha256Hex(body.chunkSha256)) return fail("invalid_field", "chunkSha256");
    if (!Array.isArray(body.rows) || body.rows.length !== body.rowCount) return fail("invalid_field", "rows");
    return ok({ ...body });
  },

  "dataset-import-finalize"(body) {
    if (!keysExactly(body, ["importId", "expectedRevision", "manifest", "identityPackageSha256"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.importId)) return fail("invalid_field", "importId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (!isPlainObject(body.manifest)) return fail("invalid_field", "manifest");
    if (!HEX64_OR_NULL(body.identityPackageSha256)) return fail("invalid_field", "identityPackageSha256");
    return ok({ ...body });
  },

  "identity-candidate-stage"(body) {
    if (!keysExactly(body, ["operationId", "importId", "rowRefs"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.operationId)) return fail("invalid_field", "operationId");
    if (!isCanonicalUuid(body.importId)) return fail("invalid_field", "importId");
    if (!Array.isArray(body.rowRefs) || body.rowRefs.length < 1 || body.rowRefs.length > 500) return fail("invalid_field", "rowRefs");
    const seen = new Set();
    for (const ref of body.rowRefs) {
      if (!keysExactly(ref, ["section", "chunkIndex", "rowIndex"])) return fail("invalid_field", "rowRefs");
      if (!["tanks", "specimens"].includes(ref.section)) return fail("invalid_field", "rowRefs");
      if (!isSafeUint(ref.chunkIndex, 19)) return fail("invalid_field", "rowRefs");
      if (!isSafeUint(ref.rowIndex, 499)) return fail("invalid_field", "rowRefs");
      const key = ref.section + ":" + ref.chunkIndex + ":" + ref.rowIndex;
      if (seen.has(key)) return fail("invalid_field", "rowRefs");
      seen.add(key);
    }
    // Canonically sort by (section, chunkIndex, rowIndex) before checksum + SQL.
    const rowRefs = [...body.rowRefs].map((r) => ({ section: r.section, chunkIndex: r.chunkIndex, rowIndex: r.rowIndex }))
      .sort((a, b) => (a.section < b.section ? -1 : a.section > b.section ? 1
        : a.chunkIndex - b.chunkIndex || a.rowIndex - b.rowIndex));
    return ok({ operationId: body.operationId, importId: body.importId, rowRefs });
  },

  "identity-adjudicate"(body) {
    if (!keysExactly(body, ["conflictId", "chosenEntityId", "reason"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.conflictId)) return fail("invalid_field", "conflictId");
    let chosen = null;
    if (body.chosenEntityId !== null) {
      chosen = decodeEntityId(body.chosenEntityId);
      if (!chosen) return fail("invalid_entity_id", "chosenEntityId");
    }
    if (typeof body.reason !== "string" || body.reason.trim() !== body.reason || body.reason.length < 1 || body.reason.length > 1000) {
      return fail("invalid_field", "reason");
    }
    return ok({ conflictId: body.conflictId, chosen, reason: body.reason });
  },

  "publication-preview"(body) {
    if (!keysExactly(body, ["roomId", "targetVisibility"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!["unlisted", "public"].includes(body.targetVisibility)) return fail("invalid_field", "targetVisibility");
    return ok({ roomId: body.roomId, targetVisibility: body.targetVisibility });
  },

  "room-read"(body) {
    if (!keysExactly(body, ["placementCursor", "placementLimit", "settingCursor", "settingLimit", "availableCursor", "availableLimit"])) {
      return fail("invalid_request");
    }
    for (const c of ["placementCursor", "settingCursor", "availableCursor"]) {
      if (body[c] !== null && typeof body[c] !== "string") return fail("invalid_field", c);
    }
    for (const [l, max] of [["placementLimit", 100], ["settingLimit", 100], ["availableLimit", 100]]) {
      if (!isSafeUint(body[l], max) || body[l] < 1) return fail("invalid_field", l);
    }
    return ok({ ...body });
  },

  "room-create"(body) {
    if (!keysExactly(body, ["slug", "title", "description", "schematic"])) return fail("invalid_request");
    if (typeof body.slug !== "string") return fail("invalid_field", "slug");
    if (!isStrLen(body.title, 1, 80)) return fail("invalid_field", "title");
    if (body.description !== null && !isStrLen(body.description, 0, 1000)) return fail("invalid_field", "description");
    if (!isPlainObject(body.schematic)) return fail("invalid_field", "schematic");
    return ok({ ...body });
  },

  "room-update"(body) {
    if (!keysExactly(body, ["roomId", "expectedRevision", "slug", "title", "description", "schematic"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (typeof body.slug !== "string") return fail("invalid_field", "slug");
    if (!isStrLen(body.title, 1, 80)) return fail("invalid_field", "title");
    if (body.description !== null && !isStrLen(body.description, 0, 1000)) return fail("invalid_field", "description");
    if (!isPlainObject(body.schematic)) return fail("invalid_field", "schematic");
    return ok({ ...body });
  },

  "room-reset"(body) {
    if (!keysExactly(body, ["roomId", "expectedRevision"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    return ok({ ...body });
  },

  "placement-put"(body) {
    if (!keysExactly(body, ["roomId", "tankId", "expectedRevision", "slug", "visibility", "label", "caption", "facts", "placement"])) {
      return fail("invalid_request");
    }
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const tank = decodeEntityId(body.tankId);
    if (!tank || tank.kind !== "tank") return fail("invalid_entity_id", "tankId");
    if (body.expectedRevision !== null && !isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (typeof body.slug !== "string") return fail("invalid_field", "slug");
    if (!["private", "unlisted", "public"].includes(body.visibility)) return fail("invalid_field", "visibility");
    if (!isNullableStr(body.label, 80)) return fail("invalid_field", "label");
    if (!(body.caption === null || (typeof body.caption === "string" && body.caption.length <= 1000))) return fail("invalid_field", "caption");
    if (!keysExactly(body.facts, ["volume", "tankType", "publishedInhabitantCount"])) return fail("invalid_field", "facts");
    if (!isBool(body.facts.volume) || !isBool(body.facts.tankType) || !isBool(body.facts.publishedInhabitantCount)) return fail("invalid_field", "facts");
    const p = body.placement;
    if (!keysExactly(p, ["x", "y", "width", "height", "focalX", "focalY", "zoneId", "order"])) return fail("invalid_field", "placement");
    if (typeof p.x !== "number" || typeof p.y !== "number") return fail("invalid_field", "placement");
    for (const f of ["width", "height", "focalX", "focalY"]) if (!(p[f] === null || typeof p[f] === "number")) return fail("invalid_field", "placement");
    if (!(p.zoneId === null || typeof p.zoneId === "string")) return fail("invalid_field", "placement");
    if (!isSafeUint(p.order, 2147483647)) return fail("invalid_field", "placement");
    return ok({ roomId: body.roomId, tankUuid: tank.uuid, expectedRevision: body.expectedRevision, payload: {
      slug: body.slug, visibility: body.visibility, label: body.label, caption: body.caption, facts: body.facts, placement: p,
    } });
  },

  "placement-remove"(body) {
    if (!keysExactly(body, ["roomId", "tankId", "expectedRevision"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const tank = decodeEntityId(body.tankId);
    if (!tank || tank.kind !== "tank") return fail("invalid_entity_id", "tankId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    return ok({ roomId: body.roomId, tankUuid: tank.uuid, expectedRevision: body.expectedRevision });
  },

  "commerce-set"(body) {
    // Link (or clear, with listingKey: null) a tank's buyable pack. The listing key is a
    // marketplace key (single-<tokenId> | batch-<listingId>); the seller-ownership check is the
    // RPC's job. expectedRevision is required — commerce-set always targets an existing placement.
    if (!keysExactly(body, ["roomId", "tankId", "expectedRevision", "listingKey"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const tank = decodeEntityId(body.tankId);
    if (!tank || tank.kind !== "tank") return fail("invalid_entity_id", "tankId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (!(body.listingKey === null
        || (typeof body.listingKey === "string" && /^(single|batch)-[1-9][0-9]*$/.test(body.listingKey)))) {
      return fail("invalid_field", "listingKey");
    }
    return ok({ roomId: body.roomId, tankUuid: tank.uuid, expectedRevision: body.expectedRevision, listingKey: body.listingKey });
  },

  "specimen-settings-put"(body) {
    if (!keysExactly(body, ["specimenId", "expectedRevision", "visibility", "publicName", "story", "facts"])) return fail("invalid_request");
    const spec = decodeEntityId(body.specimenId);
    if (!spec || spec.kind !== "specimen") return fail("invalid_entity_id", "specimenId");
    if (body.expectedRevision !== null && !isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (!["private", "public"].includes(body.visibility)) return fail("invalid_field", "visibility");
    if (!isNullableStr(body.publicName, 80)) return fail("invalid_field", "publicName");
    if (!(body.story === null || (typeof body.story === "string" && body.story.length >= 1 && body.story.length <= 2000))) return fail("invalid_field", "story");
    if (!keysExactly(body.facts, ["species", "sex", "lifeStage"])) return fail("invalid_field", "facts");
    if (!isBool(body.facts.species) || !isBool(body.facts.sex) || !isBool(body.facts.lifeStage)) return fail("invalid_field", "facts");
    return ok({ specimenUuid: spec.uuid, expectedRevision: body.expectedRevision, payload: {
      visibility: body.visibility, publicName: body.publicName, story: body.story, facts: body.facts,
    } });
  },

  "media-hero-stage"(body) {
    if (!keysExactly(body, ["roomId", "fileExtension"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!["jpg", "jpeg", "png", "webp"].includes(body.fileExtension)) return fail("invalid_field", "fileExtension");
    return ok({ roomId: body.roomId, fileExtension: body.fileExtension });
  },

  "media-hero-finalize"(body) {
    if (!keysExactly(body, ["assetId", "uploadIntentId"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.assetId)) return fail("invalid_field", "assetId");
    if (!isCanonicalUuid(body.uploadIntentId)) return fail("invalid_field", "uploadIntentId");
    return ok({ assetId: body.assetId, uploadIntentId: body.uploadIntentId });
  },

  "media-status"(body) {
    if (!keysExactly(body, ["assetId"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.assetId)) return fail("invalid_field", "assetId");
    return ok({ assetId: body.assetId });
  },

  "media-preview"(body) {
    if (!keysExactly(body, ["roomId", "assetId", "variant"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!isCanonicalUuid(body.assetId)) return fail("invalid_field", "assetId");
    if (!["hero", "thumb"].includes(body.variant)) return fail("invalid_field", "variant");
    return ok({ roomId: body.roomId, assetId: body.assetId, variant: body.variant });
  },

  "media-hero-publish"(body) {
    if (!keysExactly(body, ["roomId", "assetId", "altText", "focalX", "focalY"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!isCanonicalUuid(body.assetId)) return fail("invalid_field", "assetId");
    if (!isStrLen(body.altText, 1, 500) || body.altText.trim() !== body.altText) return fail("invalid_field", "altText");
    if (typeof body.focalX !== "number" || !Number.isFinite(body.focalX) || body.focalX < 0 || body.focalX > 1) return fail("invalid_field", "focalX");
    if (typeof body.focalY !== "number" || !Number.isFinite(body.focalY) || body.focalY < 0 || body.focalY > 1) return fail("invalid_field", "focalY");
    return ok({ ...body });
  },

  "media-revoke"(body) {
    if (!keysExactly(body, ["assetId", "expectedRevision"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.assetId)) return fail("invalid_field", "assetId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    return ok({ ...body });
  },

  "video-stage"(body) {
    if (!keysExactly(body, ["roomId", "operationId"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!isCanonicalUuid(body.operationId)) return fail("invalid_field", "operationId");
    return ok({ ...body });
  },

  "video-finalize"(body) {
    if (!keysExactly(body, ["roomId", "videoId", "uploadIntentId"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const videoUuid = decodeVideoId(body.videoId);
    if (!videoUuid) return fail("invalid_entity_id", "videoId");
    if (!isCanonicalUuid(body.uploadIntentId)) return fail("invalid_field", "uploadIntentId");
    return ok({ roomId: body.roomId, videoUuid, uploadIntentId: body.uploadIntentId });
  },

  "video-list"(body) {
    if (!keysExactly(body, ["roomId"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    return ok({ roomId: body.roomId });
  },

  "video-put"(body) {
    if (!keysExactly(body, ["roomId", "videoId", "expectedRevision", "title", "caption", "altText", "displayOrder", "visibility"])) {
      return fail("invalid_request");
    }
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const videoUuid = decodeVideoId(body.videoId);
    if (!videoUuid) return fail("invalid_entity_id", "videoId");
    if (body.expectedRevision !== null && !isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (!isStrLen(body.title, 1, 120) || body.title.trim() !== body.title) return fail("invalid_field", "title");
    if (!(body.caption === null || (isStrLen(body.caption, 1, 1000) && body.caption.trim() === body.caption))) {
      return fail("invalid_field", "caption");
    }
    if (!isStrLen(body.altText, 1, 500) || body.altText.trim() !== body.altText) return fail("invalid_field", "altText");
    if (!isSafeUint(body.displayOrder, 19)) return fail("invalid_field", "displayOrder");
    if (!["private", "unlisted", "public"].includes(body.visibility)) return fail("invalid_field", "visibility");
    return ok({ ...body, videoUuid });
  },

  "video-revoke"(body) {
    if (!keysExactly(body, ["roomId", "videoId", "expectedRevision"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const videoUuid = decodeVideoId(body.videoId);
    if (!videoUuid) return fail("invalid_entity_id", "videoId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    return ok({ roomId: body.roomId, videoUuid, expectedRevision: body.expectedRevision });
  },

  "video-playback-token"(body) {
    if (!keysExactly(body, ["roomId", "videoId"])) return fail("invalid_request");
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    const videoUuid = decodeVideoId(body.videoId);
    if (!videoUuid) return fail("invalid_entity_id", "videoId");
    return ok({ roomId: body.roomId, videoUuid });
  },

  "publication-set"(body) {
    if (!keysExactly(body, ["roomId", "expectedRevision", "visibility", "expectedPlacements", "approvedPreview"])) {
      return fail("invalid_request");
    }
    if (!isCanonicalUuid(body.roomId)) return fail("invalid_field", "roomId");
    if (!isSafeUint(body.expectedRevision)) return fail("invalid_field", "expectedRevision");
    if (!["private", "unlisted", "public"].includes(body.visibility)) return fail("invalid_field", "visibility");
    if (body.visibility === "private") {
      if (!Array.isArray(body.expectedPlacements) || body.expectedPlacements.length !== 0 || body.approvedPreview !== null) {
        return fail("invalid_field", "expectedPlacements");
      }
      return ok({ ...body });
    }
    // The owner publishes the exact set of tanks they confirmed (1..100). The
    // atomic RPC still binds expected == matched == actual placements, so no
    // fixed count is required here; only the room tank ceiling and distinctness.
    if (!Array.isArray(body.expectedPlacements) || body.expectedPlacements.length < 1
        || body.expectedPlacements.length > 100 || !isPlainObject(body.approvedPreview)) {
      return fail("invalid_field", "expectedPlacements");
    }
    const seen = new Set();
    const expectedPlacements = [];
    for (const placement of body.expectedPlacements) {
      if (!keysExactly(placement, ["tankId", "revision"])) return fail("invalid_field", "expectedPlacements");
      const tank = decodeEntityId(placement.tankId);
      if (!tank || tank.kind !== "tank" || !isSafeUint(placement.revision) || seen.has(placement.tankId)) {
        return fail("invalid_field", "expectedPlacements");
      }
      seen.add(placement.tankId);
      expectedPlacements.push({ tankId: placement.tankId, revision: placement.revision });
    }
    expectedPlacements.sort((a, b) => a.tankId < b.tankId ? -1 : a.tankId > b.tankId ? 1 : 0);
    return ok({ ...body, expectedPlacements });
  },

  "qr-resolve"(body) {
    if (!keysExactly(body, ["mode", "payload"])) return fail("invalid_request");
    if (!["scan", "manual"].includes(body.mode)) return fail("invalid_field", "mode");
    if (typeof body.payload !== "string") return fail("invalid_field", "payload");
    return ok({ mode: body.mode, payload: body.payload });
  },

  "qr-bind"(body) {
    if (!keysExactly(body, ["mode", "payload", "datasetId"])) return fail("invalid_request");
    if (!["scan", "manual"].includes(body.mode)) return fail("invalid_field", "mode");
    if (typeof body.payload !== "string") return fail("invalid_field", "payload");
    if (!isCanonicalUuid(body.datasetId)) return fail("invalid_field", "datasetId");
    return ok({ mode: body.mode, payload: body.payload, datasetId: body.datasetId });
  },
};

// Strict JSON parse that rejects duplicate object member names and unpaired/ lone UTF-16 surrogates
// (freeze sections 7.1 and 10.1) — properties the platform JSON parser silently tolerates. Throws on
// any deviation; the route maps a throw to a 400. Operates on already UTF-8-validated text.
export function parseStrictJson(text) {
  let i = 0;
  const n = text.length;
  const bad = (msg) => { throw new Error(msg || "json_invalid"); };
  const ws = () => { while (i < n) { const c = text[i]; if (c === " " || c === "\t" || c === "\n" || c === "\r") i++; else break; } };

  function parseString() {
    i++; // opening quote
    let s = "";
    for (;;) {
      if (i >= n) bad();
      const c = text[i++];
      if (c === '"') return s;
      if (c === "\\") {
        const e = text[i++];
        if (e === '"') s += '"';
        else if (e === "\\") s += "\\";
        else if (e === "/") s += "/";
        else if (e === "b") s += "\b";
        else if (e === "f") s += "\f";
        else if (e === "n") s += "\n";
        else if (e === "r") s += "\r";
        else if (e === "t") s += "\t";
        else if (e === "u") {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) bad();
          i += 4;
          const code = parseInt(hex, 16);
          if (code >= 0xd800 && code <= 0xdbff) {
            if (text[i] === "\\" && text[i + 1] === "u") {
              const hex2 = text.slice(i + 2, i + 6);
              if (!/^[0-9a-fA-F]{4}$/.test(hex2)) bad();
              const code2 = parseInt(hex2, 16);
              if (code2 < 0xdc00 || code2 > 0xdfff) bad("json_unpaired_surrogate");
              i += 6;
              s += String.fromCharCode(code, code2);
            } else {
              bad("json_unpaired_surrogate");
            }
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            bad("json_unpaired_surrogate");
          } else {
            s += String.fromCharCode(code);
          }
        } else {
          bad();
        }
      } else if (c.charCodeAt(0) < 0x20) {
        bad(); // unescaped control character
      } else {
        s += c;
      }
    }
  }

  function parseNumber() {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") i++;
    else if (text[i] >= "1" && text[i] <= "9") { while (text[i] >= "0" && text[i] <= "9") i++; }
    else bad();
    if (text[i] === ".") { i++; if (!(text[i] >= "0" && text[i] <= "9")) bad(); while (text[i] >= "0" && text[i] <= "9") i++; }
    if (text[i] === "e" || text[i] === "E") { i++; if (text[i] === "+" || text[i] === "-") i++; if (!(text[i] >= "0" && text[i] <= "9")) bad(); while (text[i] >= "0" && text[i] <= "9") i++; }
    return Number(text.slice(start, i));
  }

  function parseValue() {
    ws();
    if (i >= n) bad();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    bad();
  }

  function parseObject() {
    i++; const obj = {}; const keys = new Set(); ws();
    if (text[i] === "}") { i++; return obj; }
    for (;;) {
      ws();
      if (text[i] !== '"') bad();
      const key = parseString();
      if (keys.has(key)) bad("json_duplicate_key");
      keys.add(key);
      ws();
      if (text[i] !== ":") bad(); i++;
      obj[key] = parseValue();
      ws();
      const ch = text[i];
      if (ch === ",") { i++; continue; }
      if (ch === "}") { i++; return obj; }
      bad();
    }
  }

  function parseArray() {
    i++; const arr = []; ws();
    if (text[i] === "]") { i++; return arr; }
    for (;;) {
      arr.push(parseValue()); ws();
      const ch = text[i];
      if (ch === ",") { i++; continue; }
      if (ch === "]") { i++; return arr; }
      bad();
    }
  }

  const value = parseValue();
  ws();
  if (i !== n) bad(); // trailing garbage
  return value;
}

export const ACTIONS = Object.freeze(Object.keys(VALIDATORS));

export function validateAction(action, body) {
  const validator = VALIDATORS[action];
  if (!validator) return fail("invalid_action");
  if (!isPlainObject(body)) return fail("invalid_request");
  return validator(body);
}

export { CANONICAL_DECIMAL, MAX_SAFE };
