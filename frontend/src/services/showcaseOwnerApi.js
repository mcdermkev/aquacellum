const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const DEFAULT_TIMEOUT_MS = 15000;
const SHOWCASE_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
const SHOWCASE_DERIVATIVE_MAX_BYTES = 4 * 1024 * 1024;
const SHOWCASE_VIDEO_MAX_BYTES = 250 * 1024 * 1024;

let sessionTokenGetter = null;

export class ShowcaseOwnerApiError extends Error {
  constructor({ action, code, status = 0, message }) {
    super(message || "The showcase request could not be completed.");
    this.name = "ShowcaseOwnerApiError";
    this.action = action || null;
    this.code = code || "request_failed";
    this.status = status;
  }
}

export function setSessionTokenGetter(getter) {
  sessionTokenGetter = typeof getter === "function" ? getter : null;
}

function apiError(action, code, status, message) {
  return new ShowcaseOwnerApiError({ action, code, status, message });
}

function composeAbortSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

async function freshSessionToken(action, abort, callerSignal) {
  if (!sessionTokenGetter) {
    throw apiError(action, "authentication_required", 401, "Sign in with Privy to manage this showcase.");
  }
  try {
    const token = await Promise.race([
      sessionTokenGetter(),
      new Promise((_, reject) => abort.signal.addEventListener(
        "abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }
      )),
    ]);
    if (!token) throw new Error("missing_token");
    return token;
  } catch {
    if (abort.didTimeOut()) throw apiError(action, "request_timeout", 0, "The showcase request timed out. Refresh before retrying.");
    if (callerSignal?.aborted) throw apiError(action, "request_aborted", 0, "The showcase request was cancelled.");
    throw apiError(action, "authentication_required", 401, "A fresh Privy session is required.");
  }
}

function transportError(action, error, abort, callerSignal) {
  if (error instanceof ShowcaseOwnerApiError) return error;
  if (abort.didTimeOut()) return apiError(action, "request_timeout", 0, "The showcase request timed out. Refresh before retrying.");
  if (callerSignal?.aborted) return apiError(action, "request_aborted", 0, "The showcase request was cancelled.");
  return apiError(action, "network_error", 0, "The showcase service could not be reached. Refresh state before retrying.");
}

export async function requestShowcaseOwner(action, body, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const abort = composeAbortSignal(signal, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const token = await freshSessionToken(action, abort, signal);
    const response = await fetch(`${API_BASE}/showcase-owner?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    const envelope = await response.json().catch(() => null);
    if (!envelope || typeof envelope !== "object" || envelope.action !== action || typeof envelope.ok !== "boolean") {
      throw apiError(action, "invalid_response", response.status, "The showcase service returned an invalid response.");
    }
    if (!response.ok || envelope.ok !== true) {
      throw apiError(
        action,
        typeof envelope.code === "string" ? envelope.code : "request_failed",
        response.status,
        typeof envelope.error === "string" ? envelope.error : "The showcase request was rejected."
      );
    }
    return { ok: true, action, status: response.status, data: envelope.data ?? {} };
  } catch (error) {
    throw transportError(action, error, abort, signal);
  } finally {
    abort.cleanup();
  }
}

export async function previewShowcaseMedia(
  { roomId, assetId, variant = "hero" },
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const action = "media-preview";
  const abort = composeAbortSignal(signal, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const token = await freshSessionToken(action, abort, signal);
    const response = await fetch(`${API_BASE}/showcase-owner?action=${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ roomId, assetId, variant }),
      signal: abort.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      const envelope = await response.json().catch(() => null);
      throw apiError(
        action,
        typeof envelope?.code === "string" ? envelope.code : "request_failed",
        response.status,
        typeof envelope?.error === "string" ? envelope.error : "The private image preview was rejected."
      );
    }
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const contentLength = Number(response.headers.get("content-length"));
    if (contentType !== "image/webp" || !Number.isSafeInteger(contentLength)
        || contentLength < 1 || contentLength > SHOWCASE_DERIVATIVE_MAX_BYTES) {
      throw apiError(action, "invalid_response", response.status, "The showcase service returned an invalid image preview.");
    }
    const blob = await response.blob();
    if (blob.size !== contentLength || blob.size > SHOWCASE_DERIVATIVE_MAX_BYTES) {
      throw apiError(action, "invalid_response", response.status, "The showcase service returned an invalid image preview.");
    }
    return blob;
  } catch (error) {
    throw transportError(action, error, abort, signal);
  } finally {
    abort.cleanup();
  }
}

export async function uploadShowcaseHeroSource(
  { file, upload },
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const action = "media-source-upload";
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > SHOWCASE_SOURCE_MAX_BYTES) {
    throw apiError(action, "invalid_field", 0, "Choose a JPEG, PNG, or WebP image no larger than 8 MiB.");
  }
  let target;
  try {
    target = new URL(upload?.uploadUrl || "");
  } catch {
    throw apiError(action, "invalid_response", 0, "The private upload target is invalid.");
  }
  const headers = upload?.headers;
  if (target.protocol !== "https:" || upload?.method !== "PUT" || !headers
      || !["image/jpeg", "image/png", "image/webp"].includes(headers["Content-Type"])
      || headers["If-None-Match"] !== "*"
      || (file.type && file.type !== headers["Content-Type"])) {
    throw apiError(action, "invalid_response", 0, "The private upload target is invalid.");
  }

  const abort = composeAbortSignal(signal, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(target.toString(), {
      method: "PUT",
      headers: { "Content-Type": headers["Content-Type"], "If-None-Match": "*" },
      body: file,
      signal: abort.signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      throw apiError(action, "media_upload_incomplete", response.status, "The private image upload did not complete. Do not retry it automatically.");
    }
  } catch (error) {
    throw transportError(action, error, abort, signal);
  } finally {
    abort.cleanup();
  }
}

export async function uploadShowcaseVideoSource(
  { file, upload },
  { signal, timeoutMs = 10 * 60 * 1000 } = {}
) {
  const action = "video-source-upload";
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > SHOWCASE_VIDEO_MAX_BYTES
      || file.type !== "video/mp4") {
    throw apiError(action, "invalid_field", 0, "Choose one MP4 video no larger than 250 MiB.");
  }
  let target;
  try {
    target = new URL(upload?.uploadUrl || "");
  } catch {
    throw apiError(action, "invalid_response", 0, "The private video upload target is invalid.");
  }
  const headers = upload?.headers;
  if (target.protocol !== "https:" || upload?.method !== "PUT" || !headers
      || headers["Content-Type"] !== "video/mp4" || headers["Cache-Control"] !== "no-store"
      || headers["If-None-Match"] !== "*" || Number(upload.maxBytes) !== SHOWCASE_VIDEO_MAX_BYTES) {
    throw apiError(action, "invalid_response", 0, "The private video upload target is invalid.");
  }
  const abort = composeAbortSignal(signal, Math.max(1000, Number(timeoutMs) || 10 * 60 * 1000));
  try {
    const response = await fetch(target.toString(), {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
        "If-None-Match": "*",
      },
      body: file,
      signal: abort.signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      throw apiError(action, "video_upload_incomplete", response.status,
        "The private video upload did not complete. Check status before taking another action.");
    }
  } catch (error) {
    throw transportError(action, error, abort, signal);
  } finally {
    abort.cleanup();
  }
}

export const bootstrapShowcaseOwner = (options) => requestShowcaseOwner("bootstrap", {}, options);
export const readShowcaseIdentityState = (body = {}, options) => requestShowcaseOwner("identity-state", {
  entityCursor: body.entityCursor ?? null,
  entityLimit: body.entityLimit ?? 100,
  conflictCursor: body.conflictCursor ?? null,
  conflictLimit: body.conflictLimit ?? 50,
}, options);
export const linkShowcaseWalletClaim = (chainId, options) => requestShowcaseOwner("wallet-claim-link", { chainId }, options);
export const issueShowcaseWalletNonce = ({ wallet, chainId }, options) => requestShowcaseOwner("wallet-nonce-issue", { wallet, chainId }, options);
export const consumeShowcaseWalletProof = (body, options) => requestShowcaseOwner("wallet-proof-consume", {
  nonceId: body.nonceId, nonce: body.nonce, wallet: body.wallet, chainId: body.chainId,
  issuedAt: body.issuedAt, expirationTime: body.expirationTime, signature: body.signature,
}, options);
export const enrollShowcaseDataset = (body, options) => requestShowcaseOwner("dataset-enroll", {
  datasetId: body.datasetId, enrollmentVersion: body.enrollmentVersion,
  initialManifestSha256: body.initialManifestSha256,
}, options);
export const startShowcaseDatasetImport = (body, options) => requestShowcaseOwner("dataset-import-start", {
  operationId: body.operationId, sourceSchemaVersion: body.sourceSchemaVersion,
  sourceDatasetId: body.sourceDatasetId, enrollmentReference: body.enrollmentReference,
  declaredBackupSha256: body.declaredBackupSha256, manifestSha256: body.manifestSha256,
  manifest: body.manifest,
}, options);
export const uploadShowcaseDatasetChunk = (body, options) => requestShowcaseOwner("dataset-import-chunk", {
  importId: body.importId, section: body.section, chunkIndex: body.chunkIndex,
  rowCount: body.rowCount, chunkSha256: body.chunkSha256, rows: body.rows,
}, options);
export const finalizeShowcaseDatasetImport = (body, options) => requestShowcaseOwner("dataset-import-finalize", {
  importId: body.importId, expectedRevision: body.expectedRevision,
  manifest: body.manifest, identityPackageSha256: body.identityPackageSha256,
}, options);
export const stageShowcaseIdentityCandidates = (body, options) => requestShowcaseOwner("identity-candidate-stage", {
  operationId: body.operationId, importId: body.importId, rowRefs: body.rowRefs,
}, options);
const readShowcaseRoomPage = (body = {}, options) => requestShowcaseOwner("room-read", {
  placementCursor: body.placementCursor ?? null, placementLimit: body.placementLimit ?? 100,
  settingCursor: body.settingCursor ?? null, settingLimit: body.settingLimit ?? 100,
  availableCursor: body.availableCursor ?? null, availableLimit: body.availableLimit ?? 100,
}, options);

function appendUniqueBy(target, rows, keyOf) {
  const seen = new Set(target.map(keyOf));
  for (const row of rows || []) {
    const key = keyOf(row);
    if (!seen.has(key)) {
      seen.add(key);
      target.push(row);
    }
  }
}

// A publication decision must never be based on the first page only. Read placement,
// setting, and availability cursors to exhaustion while requiring one stable room revision.
export async function readShowcaseRoom(body = {}, options) {
  const first = await readShowcaseRoomPage(body, options);
  const data = {
    ...first.data,
    placements: [...(first.data.placements || [])],
    settings: [...(first.data.settings || [])],
    available: [...(first.data.available || [])],
  };
  const roomId = data.room?.roomId ?? null;
  const roomRevision = data.room?.revision ?? null;
  let placementCursor = data.placementNextCursor;
  let settingCursor = data.settingNextCursor;
  let availableCursor = data.availableNextCursor;
  let pages = 0;

  while ((placementCursor || settingCursor || availableCursor) && pages < 100) {
    const needPlacements = !!placementCursor;
    const needSettings = !!settingCursor;
    const needAvailable = !!availableCursor;
    const next = await readShowcaseRoomPage({
      placementCursor: needPlacements ? placementCursor : null,
      placementLimit: needPlacements ? 100 : 1,
      settingCursor: needSettings ? settingCursor : null,
      settingLimit: needSettings ? 100 : 1,
      availableCursor: needAvailable ? availableCursor : null,
      availableLimit: needAvailable ? 100 : 1,
    }, options);
    if ((next.data.room?.roomId ?? null) !== roomId || (next.data.room?.revision ?? null) !== roomRevision) {
      throw apiError("room-read", "revision_conflict", 409, "The room changed while it was being read. Refresh before continuing.");
    }
    if (needPlacements) {
      appendUniqueBy(data.placements, next.data.placements, (row) => `${row.tankId}:${row.revision}`);
      placementCursor = next.data.placementNextCursor;
    }
    if (needSettings) {
      appendUniqueBy(data.settings, next.data.settings, (row) => `${row.specimenId}:${row.revision}`);
      settingCursor = next.data.settingNextCursor;
    }
    if (needAvailable) {
      appendUniqueBy(data.available, next.data.available, (row) => `${row.kind}:${row.entityId}`);
      availableCursor = next.data.availableNextCursor;
    }
    pages += 1;
  }

  if (placementCursor || settingCursor || availableCursor) {
    throw apiError("room-read", "pagination_incomplete", 409, "The complete room state could not be read safely.");
  }
  data.placementNextCursor = null;
  data.settingNextCursor = null;
  data.availableNextCursor = null;
  return { ...first, data };
}
export const createShowcaseRoom = (body, options) => requestShowcaseOwner("room-create", {
  slug: body.slug, title: body.title, description: body.description, schematic: body.schematic,
}, options);
export const updateShowcaseRoom = (body, options) => requestShowcaseOwner("room-update", {
  roomId: body.roomId, expectedRevision: body.expectedRevision, slug: body.slug,
  title: body.title, description: body.description, schematic: body.schematic,
}, options);
export const putShowcasePlacement = (body, options) => requestShowcaseOwner("placement-put", {
  roomId: body.roomId, tankId: body.tankId, expectedRevision: body.expectedRevision,
  slug: body.slug, visibility: body.visibility, label: body.label, caption: body.caption,
  facts: body.facts, placement: body.placement,
}, options);
export const previewShowcasePublication = (roomId, targetVisibility = "public", options) => requestShowcaseOwner("publication-preview", {
  roomId, targetVisibility,
}, options);
export const setShowcasePublication = (body, options) => requestShowcaseOwner("publication-set", {
  roomId: body.roomId, expectedRevision: body.expectedRevision, visibility: body.visibility,
  expectedPlacements: body.expectedPlacements ?? [], approvedPreview: body.approvedPreview ?? null,
}, options);
export const stageShowcaseHero = (body, options) => requestShowcaseOwner("media-hero-stage", {
  roomId: body.roomId, fileExtension: body.fileExtension,
}, options);
export const finalizeShowcaseHero = (body, options) => requestShowcaseOwner("media-hero-finalize", {
  assetId: body.assetId, uploadIntentId: body.uploadIntentId,
}, options);
export const readShowcaseMediaStatus = (assetId, options) => requestShowcaseOwner("media-status", { assetId }, options);
export const publishShowcaseHero = (body, options) => requestShowcaseOwner("media-hero-publish", {
  roomId: body.roomId, assetId: body.assetId, altText: body.altText,
  focalX: body.focalX, focalY: body.focalY,
}, options);
export const revokeShowcaseMedia = (body, options) => requestShowcaseOwner("media-revoke", {
  assetId: body.assetId, expectedRevision: body.expectedRevision,
}, options);

export const stageShowcaseVideo = (body, options) => requestShowcaseOwner("video-stage", {
  roomId: body.roomId, operationId: body.operationId,
}, options);
export const finalizeShowcaseVideo = (body, options) => requestShowcaseOwner("video-finalize", {
  roomId: body.roomId, videoId: body.videoId, uploadIntentId: body.uploadIntentId,
}, options);
export const readShowcaseVideos = (roomId, options) => requestShowcaseOwner("video-list", { roomId }, options);
export const putShowcaseVideo = (body, options) => requestShowcaseOwner("video-put", {
  roomId: body.roomId, videoId: body.videoId, expectedRevision: body.expectedRevision,
  title: body.title, caption: body.caption, altText: body.altText,
  displayOrder: body.displayOrder, visibility: body.visibility,
}, options);
export const revokeShowcaseVideo = (body, options) => requestShowcaseOwner("video-revoke", {
  roomId: body.roomId, videoId: body.videoId, expectedRevision: body.expectedRevision,
}, options);
export const getShowcaseVideoPlayback = (body, options) => requestShowcaseOwner("video-playback-token", {
  roomId: body.roomId, videoId: body.videoId,
}, options);
