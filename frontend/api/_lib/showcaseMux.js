import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";

const MUX_API_BASE = "https://api.mux.com";
const MUX_STREAM_BASE = "https://stream.mux.com";
const MAX_WEBHOOK_AGE_SECONDS = 300;
const MAX_PLAYBACK_TTL_SECONDS = 60;
const MUX_ID_RE = /^[-_A-Za-z0-9]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function muxCredentials() {
  const tokenId = String(process.env.MUX_TOKEN_ID || "").trim();
  const tokenSecret = String(process.env.MUX_TOKEN_SECRET || "").trim();
  if (!tokenId || !tokenSecret) return null;
  return Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");
}

function normalizePrivateKey(value) {
  const raw = String(value || "").trim().replace(/\\n/g, "\n");
  if (!raw) return "";
  if (raw.startsWith("-----BEGIN PRIVATE KEY-----")) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    return decoded.startsWith("-----BEGIN PRIVATE KEY-----") ? decoded : "";
  } catch {
    return "";
  }
}

export function isShowcaseMuxConfigured() {
  return process.env.SHOWCASE_VIDEO_ENABLED === "true" && muxCredentials() !== null;
}

export function isShowcaseMuxSigningConfigured() {
  const keyId = String(process.env.MUX_SIGNING_KEY_ID || "").trim();
  const privateKey = normalizePrivateKey(process.env.MUX_SIGNING_PRIVATE_KEY);
  return isShowcaseMuxConfigured() && MUX_ID_RE.test(keyId) && !!privateKey;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyMuxWebhookSignature({ rawBody, signatureHeader, secret, nowSeconds }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || typeof secret !== "string" || !secret) {
    return { ok: false, code: "MUX_WEBHOOK_CONFIGURATION_INVALID" };
  }
  if (typeof signatureHeader !== "string" || signatureHeader.length > 2048) {
    return { ok: false, code: "MUX_SIGNATURE_MISSING" };
  }
  let timestamp = null;
  const signatures = [];
  for (const rawPart of signatureHeader.split(",")) {
    const part = rawPart.trim();
    if (part.startsWith("t=")) {
      const candidate = part.slice(2);
      if (!/^[1-9][0-9]{0,12}$/.test(candidate)) return { ok: false, code: "MUX_SIGNATURE_MALFORMED" };
      if (timestamp !== null && timestamp !== candidate) return { ok: false, code: "MUX_SIGNATURE_MALFORMED" };
      timestamp = candidate;
    } else if (part.startsWith("v1=")) {
      const candidate = part.slice(3).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(candidate)) return { ok: false, code: "MUX_SIGNATURE_MALFORMED" };
      signatures.push(candidate);
    }
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, code: "MUX_SIGNATURE_MALFORMED" };
  const now = Number.isSafeInteger(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(signedAt) || Math.abs(now - signedAt) > MAX_WEBHOOK_AGE_SECONDS) {
    return { ok: false, code: "MUX_SIGNATURE_EXPIRED" };
  }
  const expected = createHmac("sha256", secret)
    .update(Buffer.from(`${timestamp}.`, "utf8"))
    .update(rawBody)
    .digest();
  const valid = signatures.some((candidate) => {
    const supplied = Buffer.from(candidate, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  return valid ? { ok: true, timestamp: signedAt } : { ok: false, code: "MUX_SIGNATURE_INVALID" };
}

function parseJsonObject(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseShowcaseMuxPassthrough(eventType, eventData) {
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) return null;
  const raw = eventType === "video.upload.asset_created"
    ? (eventData.new_asset_settings?.passthrough ?? eventData.passthrough)
    : eventData.passthrough;
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const keys = Object.keys(parsed).sort();
  const expected = ["codec", "correlation", "schema", "videoId"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  if (parsed.schema !== "showcase-video-v1" || !UUID_RE.test(parsed.videoId)
      || !HEX64_RE.test(parsed.correlation) || !["h264", "hevc"].includes(parsed.codec)) return null;
  return { videoId: parsed.videoId, correlation: parsed.correlation, codec: parsed.codec };
}

async function muxRequest(path, options = {}) {
  const credentials = muxCredentials();
  if (!credentials) {
    const error = new Error("mux_not_configured");
    error.code = "MUX_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(`${MUX_API_BASE}${path}`, {
    ...options,
    headers: { Accept: "application/json", Authorization: `Basic ${credentials}`, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const error = new Error("mux_api_error");
    error.code = "MUX_API_ERROR";
    error.status = response.status;
    throw error;
  }
  const body = await response.json();
  if (!body?.data || typeof body.data !== "object") {
    const error = new Error("mux_response_invalid");
    error.code = "MUX_RESPONSE_INVALID";
    throw error;
  }
  return body.data;
}

export async function getMuxAsset(assetId) {
  if (!MUX_ID_RE.test(assetId || "")) {
    const error = new Error("mux_asset_id_invalid");
    error.code = "MUX_ASSET_ID_INVALID";
    throw error;
  }
  return muxRequest(`/video/v1/assets/${encodeURIComponent(assetId)}`);
}

export function canonicalMuxReadyFields(asset, expectedMetadata) {
  if (!asset || typeof asset !== "object" || asset.status !== "ready" || asset.id == null) return null;
  const tracks = Array.isArray(asset.tracks) ? asset.tracks.filter((track) => track?.type === "video") : [];
  if (tracks.length !== 1) return null;
  const track = tracks[0];
  const width = Number(track.max_width ?? track.width);
  const height = Number(track.max_height ?? track.height);
  const duration = Number(asset.duration ?? track.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60
      || !Number.isInteger(width) || width < 16 || width > 3840
      || !Number.isInteger(height) || height < 16 || height > 2160) return null;
  const signedIds = Array.isArray(asset.playback_ids)
    ? asset.playback_ids.filter((item) => item?.policy === "signed" && MUX_ID_RE.test(item?.id || ""))
    : [];
  if (signedIds.length !== 1 || !["h264", "hevc"].includes(expectedMetadata?.codec)) return null;
  return {
    assetId: String(asset.id),
    uploadId: typeof asset.upload_id === "string" ? asset.upload_id : null,
    playbackId: signedIds[0].id,
    playbackPolicy: "signed",
    duration,
    width,
    height,
    codec: expectedMetadata.codec,
  };
}

let signingKeyCache = null;
let signingKeyFingerprint = "";
async function signingKey() {
  const pem = normalizePrivateKey(process.env.MUX_SIGNING_PRIVATE_KEY);
  const fingerprint = sha256Hex(Buffer.from(pem, "utf8"));
  if (!pem) throw Object.assign(new Error("mux_signing_not_configured"), { code: "MUX_SIGNING_NOT_CONFIGURED" });
  if (!signingKeyCache || signingKeyFingerprint !== fingerprint) {
    signingKeyCache = await importPKCS8(pem, "RS256");
    signingKeyFingerprint = fingerprint;
  }
  return signingKeyCache;
}

export async function createSignedMuxPlayback({ playbackId, ttlSeconds = MAX_PLAYBACK_TTL_SECONDS, nowSeconds }) {
  const keyId = String(process.env.MUX_SIGNING_KEY_ID || "").trim();
  if (!isShowcaseMuxSigningConfigured() || !MUX_ID_RE.test(playbackId || "")) {
    const error = new Error("mux_signing_not_configured");
    error.code = "MUX_SIGNING_NOT_CONFIGURED";
    throw error;
  }
  const ttl = Math.min(MAX_PLAYBACK_TTL_SECONDS, Number(ttlSeconds));
  if (!Number.isInteger(ttl) || ttl < 1) throw new TypeError("invalid_playback_ttl");
  const issuedAt = Number.isSafeInteger(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttl;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: keyId })
    .setSubject(playbackId)
    .setAudience("v")
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(await signingKey());
  return {
    playbackUrl: `${MUX_STREAM_BASE}/${encodeURIComponent(playbackId)}.m3u8?token=${encodeURIComponent(token)}`,
    issuedAt,
    expiresAt,
  };
}
