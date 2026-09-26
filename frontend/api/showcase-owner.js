// Fish Room R1.3B — the single authenticated owner API (Vercel function #12).
//
// POST /api/showcase-owner?action=<exact-lowercase-kebab-case> with a Bearer Privy token. Every
// response (including errors) is a bounded {ok, action, ...} envelope with a closed code and the
// frozen no-store/security headers. Owner authority is ALWAYS the server-resolved owner_id from the
// verified Privy subject; the body never carries owner/subject/entity authority. All database access
// is through the 25 allowlisted SECURITY DEFINER RPCs — no base table is ever touched here.

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";

import { ACTIONS, validateAction, parseStrictJson } from "./_lib/showcaseValidation.js";
import {
  encodeUuidCursor, decodeUuidCursor, encodeAvailableCursor, decodeAvailableCursor,
} from "./_lib/showcaseIds.js";
import {
  startRequestSha256, candidateStageRequestSha256, sha256HexToByteaLiteral,
} from "./_lib/showcaseManifest.js";
import { parseLegacyQr, LEGACY_QR_V1_ORIGIN } from "./_lib/showcaseQr.js";
import {
  getShowcaseConfig, verifyShowcaseSession, resolveOwnerId, normalizeWallet,
  buildWalletLinkMessage, recoverEip191Signer, ownerMayPublish,
} from "./_lib/showcaseAuth.js";
import {
  createShowcaseSourceUploadTarget,
  headShowcaseSourceObject,
  isShowcaseMediaStorageConfigured,
} from "./_lib/showcaseMediaStorage.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || "",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Disable Vercel's body parser so the raw bytes can be UTF-8-validated and parsed with the strict
// parser that rejects duplicate object members and unpaired surrogates (freeze sections 7.1/10.1).
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 1048576; // 1 MiB route-wide cap

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject({ tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const CONTENT_TYPE_RE = /^application\/json(\s*;\s*charset=utf-8)?$/i;

const ERROR_MESSAGES = {
  invalid_action: "Unknown or malformed action.",
  invalid_request: "The request body is invalid.",
  invalid_field: "A request field is invalid.",
  unknown_field: "The request contains an unknown field.",
  invalid_entity_id: "A typed entity ID is invalid.",
  authentication_required: "Authentication is required.",
  token_expired: "The session expired. Please sign in again.",
  token_invalid: "The session token is invalid.",
  not_found: "Not found.",
  method_not_allowed: "Method not allowed.",
  revision_conflict: "The record changed. Refresh and try again.",
  state_conflict: "The operation conflicts with the current state.",
  operation_mismatch: "This operation was already submitted with different inputs.",
  identity_conflict: "An identity conflict prevents this change.",
  wallet_unavailable: "The wallet is unavailable.",
  alias_unavailable: "The identifier is unavailable.",
  payload_too_large: "The request or response is too large.",
  unsupported_media_type: "Content-Type must be application/json.",
  wallet_proof_invalid_or_expired: "The wallet proof is invalid or expired.",
  evidence_rejected: "The submitted evidence was rejected.",
  manifest_invalid: "The manifest or identity package failed validation.",
  publication_invalid: "The publication request is invalid.",
  qr_not_resolved: "The code could not be resolved.",
  publication_not_authorized: "Publishing isn't enabled for this account yet.",
  commerce_listing_unavailable: "That listing can't be linked to this tank.",
  media_unavailable: "Room media is not enabled in this environment.",
  media_quota_exceeded: "The Room media quota has been reached.",
  media_upload_incomplete: "The private upload is missing or incomplete.",
  media_upload_expired: "The private upload target expired.",
  media_not_ready: "The image is not ready to publish.",
  rate_limited: "Too many requests.",
  internal_error: "An unexpected error occurred.",
  authentication_unavailable: "Authentication service unavailable.",
  service_unavailable: "Service temporarily unavailable.",
  authority_unavailable: "Authority service unavailable.",
  retry_later: "The service is busy. Try again shortly.",
};

// ── Response plumbing ───────────────────────────────────────────────────────

function setResponseHeaders(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Vary", "Origin, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  const { appOrigin } = getShowcaseConfig();
  const origin = req.headers.origin;
  // CORS is not authorization: reflect only the exact configured app origin (or exact loopback dev).
  if (origin && appOrigin && origin === appOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

function sendOk(res, action, data, status = 200) {
  res.status(status).json({ ok: true, action, data: data === undefined ? {} : data });
}
function sendErr(res, action, status, code, details) {
  const body = { ok: false, action, code, error: ERROR_MESSAGES[code] || ERROR_MESSAGES.internal_error };
  if (details) body.details = details;
  res.status(status).json(body);
}

const VALIDATION_STATUS = {
  invalid_action: 400, invalid_request: 400, invalid_field: 400,
  unknown_field: 400, invalid_entity_id: 400,
};

// Map a Supabase/PostgreSQL RPC error to a closed {status, code}. Never leaks error.message.
function mapDbError(error) {
  const sqlstate = error?.code || "";
  const token = typeof error?.message === "string" ? error.message : "";
  const has = (s) => token.includes(s);

  if (sqlstate === "40001") return { status: 503, code: "retry_later" };
  if (has("SHOWCASE_OPERATION_MISMATCH")) return { status: 409, code: "operation_mismatch" };
  if (has("SHOWCASE_REVISION_CONFLICT") || has("SHOWCASE_ROOM_CAS_CONFLICT")) return { status: 409, code: "revision_conflict" };
  if (has("SHOWCASE_WALLET_PROOF_INVALID_OR_EXPIRED")) return { status: 422, code: "wallet_proof_invalid_or_expired" };
  if (has("SHOWCASE_WALLET_UNAVAILABLE") || has("SHOWCASE_WALLET_REVOKED")) return { status: 409, code: "wallet_unavailable" };
  if (has("SHOWCASE_ALIAS_UNAVAILABLE")) return { status: 409, code: "alias_unavailable" };
  if (has("SHOWCASE_COMMERCE_LISTING_UNAVAILABLE")) return { status: 409, code: "commerce_listing_unavailable" };
  if (has("SHOWCASE_MEDIA_QUOTA_EXCEEDED")) return { status: 409, code: "media_quota_exceeded" };
  if (has("SHOWCASE_MEDIA_UPLOAD_EXPIRED")) return { status: 409, code: "media_upload_expired" };
  if (has("SHOWCASE_MEDIA_PUBLICATION_INVALID") || has("SHOWCASE_MEDIA_VARIANTS_INCOMPLETE")) {
    return { status: 409, code: "media_not_ready" };
  }
  if (has("SHOWCASE_CANDIDATE_ENTITY_EVIDENCE_CONFLICT") || has("SHOWCASE_CANDIDATE_ENTITY_UNAVAILABLE")) {
    return { status: 422, code: "evidence_rejected" };
  }
  if (has("MANIFEST") || has("SECTION_CHECKSUM") || has("ROW_CHECKSUM") || has("CHUNK_CHECKSUM")
      || has("IDENTITY_PACKAGE") || has("IDENTITY_REFERENCE") || has("IDENTITY_ROW")
      || has("TANK_ROW") || has("SPECIMEN_ROW") || has("ALIAS_ROW") || has("CHUNK_COVERAGE")
      || has("EMPTY_SECTION")) {
    return { status: 422, code: "manifest_invalid" };
  }
  if (has("SHOWCASE_PLACEMENT_LABEL_REQUIRED") || has("SHOWCASE_PUBLICATION_PREVIEW_INVALID")) {
    return { status: 422, code: "publication_invalid" };
  }
  if (has("SHOWCASE_NOT_FOUND") || sqlstate === "P0002") return { status: 404, code: "not_found" };
  if (has("SHOWCASE_PUBLICATION_RETRY_REQUIRED")) return { status: 503, code: "retry_later" };
  if (has("DTO_TOO_LARGE")) return { status: 413, code: "payload_too_large" };
  if (sqlstate === "22023") return { status: 400, code: "invalid_request" };
  if (sqlstate === "23514") return { status: 422, code: "evidence_rejected" };
  if (sqlstate === "23505" || sqlstate === "55000") return { status: 409, code: "state_conflict" };
  return { status: 500, code: "internal_error" };
}

// Retry the whole RPC on serialization failure (40001) with bounded jitter, then surface retry_later.
async function callRpc(fn, args) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await supabase.rpc(fn, args);
    if (result.error && result.error.code === "40001" && attempt < 2) {
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 40)));
      continue;
    }
    return result;
  }
  return { data: null, error: { code: "40001", message: "serialization_failure" } };
}

function b64urlNoPad(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Action handlers ─────────────────────────────────────────────────────────
// Each returns { status?, data } on success or { status, code } on a mapped failure.

async function rpcData(fn, args) {
  const { data, error } = await callRpc(fn, args);
  if (error) return { fail: mapDbError(error) };
  return { data };
}

const HANDLERS = {
  async bootstrap(ctx) {
    const cfg = getShowcaseConfig();
    const idState = await rpcData("showcase_owner_identity_state", { p_owner_id: ctx.ownerId, p_entity_limit: 1, p_conflict_limit: 50 });
    if (idState.fail) return idState.fail;
    const room = await rpcData("showcase_owner_room", { p_owner_id: ctx.ownerId });
    if (room.fail) return room.fail;
    const datasets = idState.data.datasets || [];
    const conflicts = idState.data.conflicts || [];
    const roomJson = room.data.room;
    return { status: 200, data: {
      schemaVersion: 1,
      capabilities: {
        walletProof: !!(cfg.appOrigin && cfg.chainId && cfg.privyAppId),
        datasetEnrollment: true, publication: true, legacyQr: true,
        media: isShowcaseMediaStorageConfigured(), commerce: false,
      },
      room: { exists: !!roomJson, revision: roomJson ? roomJson.revision : null },
      datasets: {
        active: datasets.filter((d) => d.active).length,
        staged: datasets.filter((d) => d.status === "staged").length,
      },
      identity: { openConflicts: conflicts.filter((c) => c.status === "open").length },
    } };
  },

  async "identity-state"(ctx, v) {
    const afterEntity = v.entityCursor === null ? null : decodeUuidCursor(v.entityCursor);
    const afterConflict = v.conflictCursor === null ? null : decodeUuidCursor(v.conflictCursor);
    if ((v.entityCursor !== null && !afterEntity) || (v.conflictCursor !== null && !afterConflict)) {
      return { status: 400, code: "invalid_field" };
    }
    const r = await rpcData("showcase_owner_identity_state", {
      p_owner_id: ctx.ownerId, p_after_entity_key: afterEntity, p_entity_limit: v.entityLimit,
      p_after_conflict_id: afterConflict, p_conflict_limit: v.conflictLimit,
    });
    if (r.fail) return r.fail;
    const d = { ...r.data };
    d.entityNextCursor = d.entityNextKey ? encodeUuidCursor(d.entityNextKey) : null;
    d.conflictNextCursor = d.conflictNextKey ? encodeUuidCursor(d.conflictNextKey) : null;
    delete d.entityNextKey; delete d.conflictNextKey;
    return { status: 200, data: d };
  },

  async "identity-conflict-candidates"(ctx, v) {
    const after = v.candidateCursor === null ? null : decodeUuidCursor(v.candidateCursor);
    if (v.candidateCursor !== null && !after) return { status: 400, code: "invalid_field" };
    const r = await rpcData("showcase_owner_identity_conflict_candidates", {
      p_owner_id: ctx.ownerId, p_conflict_id: v.conflictId,
      p_after_candidate_entity_key: after, p_candidate_limit: v.candidateLimit,
    });
    if (r.fail) return r.fail;
    const d = { ...r.data };
    d.nextCursor = d.nextKey ? encodeUuidCursor(d.nextKey) : null;
    delete d.nextKey;
    return { status: 200, data: d };
  },

  async "wallet-claim-link"(ctx, v) {
    const cfg = getShowcaseConfig();
    if (!cfg.appOrigin || !cfg.chainId || !cfg.privyAppId) return { status: 503, code: "service_unavailable" };
    if (v.chainId !== cfg.chainId) return { status: 400, code: "invalid_field" };
    if (!ctx.walletAddress) return { status: 409, code: "wallet_unavailable" };
    const wallet = normalizeWallet(ctx.walletAddress);
    if (!wallet) return { status: 409, code: "wallet_unavailable" };
    const evidenceSha = createHash("sha256")
      .update(`${cfg.privyAppId}\n${ctx.subject}\n${wallet.normalized}\n${cfg.chainId}`, "utf8").digest("hex");
    const r = await rpcData("showcase_link_owner_wallet", {
      p_owner_id: ctx.ownerId, p_chain_id: cfg.chainId,
      p_normalized_wallet_address: wallet.normalized, p_display_wallet_address: wallet.display,
      p_evidence_kind: "privy_token_claim", p_evidence_reference: "privy-token-claim:v1:" + evidenceSha,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: { walletId: r.data, chainId: cfg.chainId, normalizedAddress: wallet.normalized, displayAddress: wallet.display } };
  },

  async "wallet-nonce-issue"(ctx, v) {
    const cfg = getShowcaseConfig();
    if (!cfg.appOrigin || !cfg.chainId || !cfg.privyAppId) return { status: 503, code: "service_unavailable" };
    if (v.chainId !== cfg.chainId) return { status: 400, code: "invalid_field" };
    const wallet = normalizeWallet(v.wallet);
    if (!wallet) return { status: 400, code: "invalid_field" };
    const rawNonce = b64urlNoPad(randomBytes(32));
    const nonceHash = createHash("sha256").update(rawNonce, "utf8").digest("hex");
    const r = await rpcData("showcase_issue_wallet_link_nonce", {
      p_owner_id: ctx.ownerId, p_chain_id: cfg.chainId, p_normalized_wallet_address: wallet.normalized,
      p_purpose: "link_showcase_wallet", p_app_origin: cfg.appOrigin, p_privy_app_id: cfg.privyAppId,
      p_nonce_hash: sha256HexToByteaLiteral(nonceHash),
    });
    if (r.fail) return r.fail;
    const message = buildWalletLinkMessage({
      appOrigin: cfg.appOrigin, privyAppId: cfg.privyAppId, subject: ctx.subject,
      normalizedWallet: wallet.normalized, chainId: cfg.chainId, nonce: rawNonce,
      issuedAt: r.data.issuedAt, expirationTime: r.data.expirationTime,
    });
    return { status: 200, data: {
      nonceId: r.data.nonceId, nonce: rawNonce, wallet: wallet.normalized, displayAddress: wallet.display,
      chainId: cfg.chainId, issuedAt: r.data.issuedAt, expirationTime: r.data.expirationTime, message,
    } };
  },

  async "wallet-proof-consume"(ctx, v) {
    const cfg = getShowcaseConfig();
    if (!cfg.appOrigin || !cfg.chainId || !cfg.privyAppId) return { status: 503, code: "service_unavailable" };
    if (v.chainId !== cfg.chainId) return { status: 422, code: "wallet_proof_invalid_or_expired" };
    const wallet = normalizeWallet(v.wallet);
    if (!wallet) return { status: 422, code: "wallet_proof_invalid_or_expired" };
    const message = buildWalletLinkMessage({
      appOrigin: cfg.appOrigin, privyAppId: cfg.privyAppId, subject: ctx.subject,
      normalizedWallet: wallet.normalized, chainId: cfg.chainId, nonce: v.nonce,
      issuedAt: v.issuedAt, expirationTime: v.expirationTime,
    });
    const signer = recoverEip191Signer(message, v.signature);
    if (!signer || signer !== wallet.normalized) return { status: 422, code: "wallet_proof_invalid_or_expired" };
    const nonceHash = createHash("sha256").update(v.nonce, "utf8").digest("hex");
    const r = await rpcData("showcase_consume_wallet_link_nonce", {
      p_owner_id: ctx.ownerId, p_nonce_id: v.nonceId, p_nonce_hash: sha256HexToByteaLiteral(nonceHash),
      p_chain_id: cfg.chainId, p_normalized_wallet_address: wallet.normalized,
      p_display_wallet_address: wallet.display, p_purpose: "link_showcase_wallet",
      p_app_origin: cfg.appOrigin, p_privy_app_id: cfg.privyAppId,
      p_issued_at: v.issuedAt, p_expires_at: v.expirationTime,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "dataset-enroll"(ctx, v) {
    const r = await rpcData("showcase_enroll_dataset", {
      p_owner_id: ctx.ownerId, p_dataset_id: v.datasetId, p_enrollment_version: v.enrollmentVersion,
      p_initial_manifest_checksum: v.initialManifestSha256 ? sha256HexToByteaLiteral(v.initialManifestSha256) : null,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "dataset-import-start"(ctx, v) {
    let startChecksum;
    try {
      startChecksum = startRequestSha256({
        operationId: v.operationId, sourceSchemaVersion: v.sourceSchemaVersion,
        sourceDatasetId: v.sourceDatasetId, enrollmentReference: v.enrollmentReference,
        declaredBackupSha256: v.declaredBackupSha256, manifestSha256: v.manifestSha256, manifest: v.manifest,
      });
    } catch {
      // A manifest value outside the RFC 8785 safe-integer/string domain is a malformed request.
      return { status: 400, code: "invalid_request" };
    }
    const r = await rpcData("showcase_start_dataset_import", {
      p_owner_id: ctx.ownerId, p_operation_id: v.operationId,
      p_start_request_checksum: sha256HexToByteaLiteral(startChecksum),
      p_source_dataset_id: v.sourceDatasetId, p_enrollment_reference: v.enrollmentReference,
      p_source_schema_version: v.sourceSchemaVersion,
      p_backup_checksum: sha256HexToByteaLiteral(v.declaredBackupSha256),
      p_manifest_checksum: v.manifestSha256 ? sha256HexToByteaLiteral(v.manifestSha256) : null,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "dataset-import-chunk"(ctx, v) {
    const r = await rpcData("showcase_stage_dataset_import_chunk", {
      p_owner_id: ctx.ownerId, p_import_id: v.importId, p_section: v.section,
      p_chunk_index: v.chunkIndex, p_row_count: v.rowCount,
      p_chunk_checksum: sha256HexToByteaLiteral(v.chunkSha256), p_payload: v.rows,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "dataset-import-finalize"(ctx, v) {
    const r = await rpcData("showcase_finalize_dataset_import", {
      p_owner_id: ctx.ownerId, p_import_id: v.importId, p_expected_revision: v.expectedRevision,
      p_manifest: v.manifest,
      p_identity_package_checksum: v.identityPackageSha256 ? sha256HexToByteaLiteral(v.identityPackageSha256) : null,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "identity-candidate-stage"(ctx, v) {
    const requestChecksum = candidateStageRequestSha256({ operationId: v.operationId, importId: v.importId, rowRefs: v.rowRefs });
    const r = await rpcData("showcase_stage_identity_candidates", {
      p_owner_id: ctx.ownerId, p_operation_id: v.operationId,
      p_request_checksum: sha256HexToByteaLiteral(requestChecksum),
      p_import_id: v.importId, p_candidate_refs: v.rowRefs,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "identity-adjudicate"(ctx, v) {
    const r = await rpcData("showcase_resolve_identity_conflict", {
      p_owner_id: ctx.ownerId, p_conflict_id: v.conflictId,
      p_chosen_entity_key: v.chosen ? v.chosen.uuid : null, p_reason: v.reason,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "publication-preview"(ctx, v) {
    const r = await rpcData("showcase_owner_publication_preview", { p_owner_id: ctx.ownerId, p_room_id: v.roomId });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "room-read"(ctx, v) {
    const afterPlacement = v.placementCursor === null ? null : decodeUuidCursor(v.placementCursor);
    const afterSetting = v.settingCursor === null ? null : decodeUuidCursor(v.settingCursor);
    const afterAvailable = v.availableCursor === null ? null : decodeAvailableCursor(v.availableCursor);
    if ((v.placementCursor !== null && !afterPlacement) || (v.settingCursor !== null && !afterSetting)
        || (v.availableCursor !== null && !afterAvailable)) {
      return { status: 400, code: "invalid_field" };
    }
    const r = await rpcData("showcase_owner_room", {
      p_owner_id: ctx.ownerId,
      p_after_placement_key: afterPlacement, p_placement_limit: v.placementLimit,
      p_after_setting_key: afterSetting, p_setting_limit: v.settingLimit,
      p_after_available_kind: afterAvailable ? afterAvailable.kind : null,
      p_after_available_key: afterAvailable ? afterAvailable.uuid : null,
      p_available_limit: v.availableLimit,
    });
    if (r.fail) return r.fail;
    const d = { ...r.data };
    d.placementNextCursor = d.placementNextCursor ? encodeUuidCursor(d.placementNextCursor) : null;
    d.settingNextCursor = d.settingNextCursor ? encodeUuidCursor(d.settingNextCursor) : null;
    d.availableNextCursor = d.availableNextCursor
      ? encodeAvailableCursor(d.availableNextCursor.kind, d.availableNextCursor.key) : null;
    return { status: 200, data: d };
  },

  async "room-create"(ctx, v) {
    // Irreversible one-lifetime owner mutation: never pass this RPC through the shared
    // serialization retry wrapper. A 40001 is surfaced as retry_later for read-only inspection.
    const { data, error } = await supabase.rpc("showcase_create_owner_room", {
      p_owner_id: ctx.ownerId, p_slug: v.slug, p_title: v.title,
      p_description: v.description, p_schematic_data: v.schematic,
    });
    if (error) return mapDbError(error);
    return { status: 201, data };
  },

  async "room-update"(ctx, v) {
    const r = await rpcData("showcase_update_owner_room", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_expected_revision: v.expectedRevision,
      p_slug: v.slug, p_title: v.title, p_description: v.description, p_schematic_data: v.schematic,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "room-reset"(ctx, v) {
    const r = await rpcData("showcase_reset_owner_room", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_expected_revision: v.expectedRevision,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "media-hero-stage"(ctx, v) {
    if (!isShowcaseMediaStorageConfigured()) return { status: 503, code: "media_unavailable" };
    const staged = await rpcData("showcase_stage_room_hero", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_extension: v.fileExtension,
    });
    if (staged.fail) return staged.fail;
    const d = staged.data;
    try {
      const target = await createShowcaseSourceUploadTarget({
        objectKey: d.sourceObjectKey, contentType: d.contentType,
      });
      return { status: 201, data: {
        assetId: d.assetId,
        uploadIntentId: d.uploadIntentId,
        upload: target,
        expiresAt: d.expiresAt,
      } };
    } catch (error) {
      // No upload target was returned, so this reservation can be released without an object-delete
      // proof. The cancellation RPC remains owner-bound even though it is an internal compensation.
      await callRpc("showcase_cancel_room_hero_stage", {
        p_owner_id: ctx.ownerId, p_asset_id: d.assetId, p_upload_intent_id: d.uploadIntentId,
      });
      console.error("[showcase-owner] media presign", error?.code || "error");
      return { status: 503, code: "media_unavailable" };
    }
  },

  async "media-hero-finalize"(ctx, v) {
    if (!isShowcaseMediaStorageConfigured()) return { status: 503, code: "media_unavailable" };
    const binding = await rpcData("showcase_owner_media_upload_binding", {
      p_owner_id: ctx.ownerId, p_asset_id: v.assetId, p_upload_intent_id: v.uploadIntentId,
    });
    if (binding.fail) return binding.fail;
    if (!binding.data) return { status: 404, code: "not_found" };
    let object;
    try {
      object = await headShowcaseSourceObject(binding.data.sourceObjectKey);
    } catch (error) {
      console.error("[showcase-owner] media head", error?.code || "error");
      if (error?.code === "SHOWCASE_MEDIA_SOURCE_SIZE_INVALID") {
        return { status: 413, code: "payload_too_large" };
      }
      return { status: 409, code: "media_upload_incomplete" };
    }
    const finalized = await rpcData("showcase_finalize_room_hero_upload", {
      p_owner_id: ctx.ownerId, p_asset_id: v.assetId,
      p_upload_intent_id: v.uploadIntentId, p_source_byte_size: object.byteSize,
    });
    if (finalized.fail) return finalized.fail;
    return { status: 202, data: finalized.data };
  },

  async "media-status"(ctx, v) {
    const r = await rpcData("showcase_owner_media_status", {
      p_owner_id: ctx.ownerId, p_asset_id: v.assetId,
    });
    if (r.fail) return r.fail;
    if (!r.data) return { status: 404, code: "not_found" };
    return { status: 200, data: r.data };
  },

  async "media-hero-publish"(ctx, v) {
    if (!isShowcaseMediaStorageConfigured()) return { status: 503, code: "media_unavailable" };
    if (!ownerMayPublish({ subject: ctx.subject, walletAddress: ctx.walletAddress })) {
      return { status: 403, code: "publication_not_authorized" };
    }
    const r = await rpcData("showcase_publish_room_hero", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_asset_id: v.assetId,
      p_alt_text: v.altText, p_focal_x: v.focalX, p_focal_y: v.focalY,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "media-revoke"(ctx, v) {
    const r = await rpcData("showcase_revoke_media_asset", {
      p_owner_id: ctx.ownerId, p_asset_id: v.assetId,
      p_expected_revision: v.expectedRevision,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "publication-set"(ctx, v) {
    // Curated rollout gate ("Steve first"): flipping a Room to a non-private visibility is
    // default-closed and limited to allowlisted owners (see ownerMayPublish). Taking a Room
    // private is never gated, so an owner can always unpublish.
    if (v.visibility !== "private"
        && !ownerMayPublish({ subject: ctx.subject, walletAddress: ctx.walletAddress })) {
      return { status: 403, code: "publication_not_authorized" };
    }
    const r = await rpcData("showcase_set_owner_room_visibility", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_expected_revision: v.expectedRevision, p_visibility: v.visibility,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "placement-put"(ctx, v) {
    const r = await rpcData("showcase_put_room_tank", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_tank_key: v.tankUuid,
      p_expected_revision: v.expectedRevision, p_payload: v.payload,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "placement-remove"(ctx, v) {
    const r = await rpcData("showcase_remove_room_tank", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_tank_key: v.tankUuid, p_expected_revision: v.expectedRevision,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "specimen-settings-put"(ctx, v) {
    const r = await rpcData("showcase_put_specimen_settings", {
      p_owner_id: ctx.ownerId, p_specimen_key: v.specimenUuid,
      p_expected_revision: v.expectedRevision, p_payload: v.payload,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "commerce-set"(ctx, v) {
    // Link/clear a tank's buyable pack. The RPC enforces the seller-ownership invariant (the linked
    // listing's seller must be an active verified wallet of this owner) and the room-private + CAS rules.
    const r = await rpcData("showcase_set_room_tank_commerce", {
      p_owner_id: ctx.ownerId, p_room_id: v.roomId, p_tank_key: v.tankUuid,
      p_expected_revision: v.expectedRevision, p_listing_key: v.listingKey,
    });
    if (r.fail) return r.fail;
    return { status: 200, data: r.data };
  },

  async "qr-resolve"(ctx, v) {
    const parsed = parseLegacyQr(v.mode, v.payload, [LEGACY_QR_V1_ORIGIN]);
    if (!parsed) return { status: 200, data: { resolved: false, recovery: true } };
    const { data, error } = await callRpc("showcase_resolve_owner_legacy_qr", { p_owner_id: ctx.ownerId, p_legacy_value: parsed.value });
    if (error) return { status: 200, data: { resolved: false, recovery: true } };
    if (!data || !data.resolved) return { status: 200, data: { resolved: false, recovery: true } };
    return { status: 200, data: { resolved: true, tankId: data.tankId, ownerPath: "/app/room/tanks/" + data.tankId } };
  },

  async "qr-bind"(ctx, v) {
    const parsed = parseLegacyQr(v.mode, v.payload, [LEGACY_QR_V1_ORIGIN]);
    if (!parsed) return { status: 200, data: { resolved: false, recovery: true } };
    const { data, error } = await callRpc("showcase_bind_owner_legacy_qr", {
      p_owner_id: ctx.ownerId, p_dataset_id: v.datasetId, p_legacy_value: parsed.value,
    });
    if (error) {
      // Any fail-closed bind (not resolved, alias race, revoked, ambiguous) is non-enumerating.
      if (error.code === "22023") return { status: 200, data: { resolved: false, recovery: true } };
      return { status: 200, data: { resolved: false, recovery: true } };
    }
    if (!data || !data.resolved) return { status: 200, data: { resolved: false, recovery: true } };
    return { status: 200, data: { resolved: true, tankId: data.tankId,
      ownerPath: "/app/room/tanks/" + data.tankId } };
  },
};

// ── Entry point ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setResponseHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const rawAction = req.query ? req.query.action : undefined;
  const action = typeof rawAction === "string" && ACTIONS.includes(rawAction) ? rawAction : null;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendErr(res, action, 405, "method_not_allowed");
  }

  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !CONTENT_TYPE_RE.test(contentType.trim())) {
    return sendErr(res, action, 415, "unsupported_media_type");
  }

  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return sendErr(res, action, 413, "payload_too_large");
  }

  if (!action) {
    return sendErr(res, null, 400, "invalid_action");
  }

  // Read the raw body (Content-Length is untrusted/optional so the raw bytes are remeasured),
  // require valid UTF-8, then parse strictly (rejecting duplicate members and unpaired surrogates).
  let raw;
  try {
    raw = await readRawBody(req, MAX_BODY_BYTES);
  } catch (e) {
    if (e && e.tooLarge) return sendErr(res, action, 413, "payload_too_large");
    return sendErr(res, action, 400, "invalid_request");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return sendErr(res, action, 400, "invalid_request");
  }
  let body;
  try {
    body = parseStrictJson(text);
  } catch {
    return sendErr(res, action, 400, "invalid_request");
  }

  const validation = validateAction(action, body);
  if (!validation.ok) {
    // details is intentionally omitted: the freeze forbids leaking object key names; the closed
    // `code` is the only field-level signal the client receives.
    const status = VALIDATION_STATUS[validation.code] || 400;
    return sendErr(res, action, status, validation.code);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return sendErr(res, action, 503, "service_unavailable");
  }

  try {
    const session = await verifyShowcaseSession(req);
    if (!session.ok) {
      if (session.status === 401) res.setHeader("WWW-Authenticate", "Bearer");
      return sendErr(res, action, session.status, session.code);
    }
    const owner = await resolveOwnerId(supabase, session.subject);
    if (!owner.ok) {
      const mapped = mapDbError(owner.error);
      return sendErr(res, action, mapped.status, mapped.code);
    }

    const ctx = { ownerId: owner.ownerId, subject: session.subject, walletAddress: session.walletAddress };
    const result = await HANDLERS[action](ctx, validation.value);
    // Failure results carry a closed `code` (+ status); success results carry `data` (+ status).
    if (result.code) return sendErr(res, action, result.status || 500, result.code);
    return sendOk(res, action, result.data, result.status || 200);
  } catch (err) {
    // Logs carry only route/action and a safe code — never SQL/upstream messages, tokens, or payloads.
    console.error("[showcase-owner]", action, err?.code || "error");
    return sendErr(res, action, 500, "internal_error");
  }
}
