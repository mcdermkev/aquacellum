import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const SHOWCASE_SOURCE_BUCKET = "showcase-media-source-v1";
export const SHOWCASE_DERIVATIVE_BUCKET = "showcase-media-derivatives-v1";
export const SHOWCASE_VIDEO_SOURCE_BUCKET = "showcase-video-source-v1";
export const SHOWCASE_UPLOAD_TTL_SECONDS = 300;
export const SHOWCASE_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const SHOWCASE_DERIVATIVE_MAX_BYTES = 4 * 1024 * 1024;
export const SHOWCASE_VIDEO_SOURCE_MAX_BYTES = 250 * 1024 * 1024;

let cachedClient = null;
let cachedFingerprint = null;

function readStorageConfig() {
  const endpoint = String(process.env.SHOWCASE_STORAGE_S3_ENDPOINT || "").trim();
  const region = String(process.env.SHOWCASE_STORAGE_S3_REGION || "").trim();
  const accessKeyId = String(process.env.SHOWCASE_STORAGE_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.SHOWCASE_STORAGE_S3_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) return null;
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null;
  }
  return { endpoint: parsed.toString().replace(/\/$/, ""), region, accessKeyId, secretAccessKey };
}

export function isShowcaseMediaStorageConfigured() {
  return process.env.SHOWCASE_MEDIA_ENABLED === "true" && readStorageConfig() !== null;
}

export function isShowcaseVideoStorageConfigured() {
  return process.env.SHOWCASE_VIDEO_ENABLED === "true" && readStorageConfig() !== null;
}

function storageClient() {
  const cfg = readStorageConfig();
  if (!cfg) {
    const error = new Error("showcase_media_storage_unavailable");
    error.code = "SHOWCASE_MEDIA_STORAGE_UNAVAILABLE";
    throw error;
  }
  const fingerprint = `${cfg.endpoint}\n${cfg.region}\n${cfg.accessKeyId}`;
  if (!cachedClient || cachedFingerprint !== fingerprint) {
    cachedClient = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    cachedFingerprint = fingerprint;
  }
  return cachedClient;
}

function exactSourceKey(value) {
  return typeof value === "string"
    && value.length <= 512
    && /^owners\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}\/source\.(?:jpg|jpeg|png|webp)$/.test(value);
}

export async function createShowcaseSourceUploadTarget({ objectKey, contentType }) {
  if (!exactSourceKey(objectKey)
      || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    const error = new Error("showcase_media_upload_binding_invalid");
    error.code = "SHOWCASE_MEDIA_UPLOAD_BINDING_INVALID";
    throw error;
  }
  const command = new PutObjectCommand({
    Bucket: SHOWCASE_SOURCE_BUCKET,
    Key: objectKey,
    ContentType: contentType,
    IfNoneMatch: "*",
  });
  const uploadUrl = await getSignedUrl(storageClient(), command, {
    expiresIn: SHOWCASE_UPLOAD_TTL_SECONDS,
  });
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== "https:") throw new Error("showcase_media_presign_invalid");
  return {
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": contentType, "If-None-Match": "*" },
    expiresIn: SHOWCASE_UPLOAD_TTL_SECONDS,
  };
}

export async function headShowcaseSourceObject(objectKey) {
  if (!exactSourceKey(objectKey)) {
    const error = new Error("showcase_media_upload_binding_invalid");
    error.code = "SHOWCASE_MEDIA_UPLOAD_BINDING_INVALID";
    throw error;
  }
  const result = await storageClient().send(new HeadObjectCommand({
    Bucket: SHOWCASE_SOURCE_BUCKET,
    Key: objectKey,
  }));
  const byteSize = Number(result.ContentLength);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > SHOWCASE_SOURCE_MAX_BYTES) {
    const error = new Error("showcase_media_source_size_invalid");
    error.code = "SHOWCASE_MEDIA_SOURCE_SIZE_INVALID";
    throw error;
  }
  return { byteSize };
}

const CANONICAL_UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const VIDEO_SOURCE_KEY_RE = new RegExp(
  `^owners/${CANONICAL_UUID_SOURCE}/rooms/${CANONICAL_UUID_SOURCE}/videos/${CANONICAL_UUID_SOURCE}/source\\.mp4$`
);

function exactVideoSourceKey(value) {
  return typeof value === "string" && value.length <= 512 && VIDEO_SOURCE_KEY_RE.test(value);
}

export async function createShowcaseVideoSourceUploadTarget({ objectKey }) {
  if (!exactVideoSourceKey(objectKey)) {
    const error = new Error("showcase_video_upload_binding_invalid");
    error.code = "SHOWCASE_VIDEO_UPLOAD_BINDING_INVALID";
    throw error;
  }
  const command = new PutObjectCommand({
    Bucket: SHOWCASE_VIDEO_SOURCE_BUCKET,
    Key: objectKey,
    ContentType: "video/mp4",
    CacheControl: "no-store",
    IfNoneMatch: "*",
  });
  const uploadUrl = await getSignedUrl(storageClient(), command, {
    expiresIn: SHOWCASE_UPLOAD_TTL_SECONDS,
  });
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== "https:") throw new Error("showcase_video_presign_invalid");
  return {
    uploadUrl,
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "If-None-Match": "*",
    },
    expiresIn: SHOWCASE_UPLOAD_TTL_SECONDS,
    maxBytes: SHOWCASE_VIDEO_SOURCE_MAX_BYTES,
  };
}

export async function headShowcaseVideoSourceObject(objectKey) {
  if (!exactVideoSourceKey(objectKey)) {
    const error = new Error("showcase_video_upload_binding_invalid");
    error.code = "SHOWCASE_VIDEO_UPLOAD_BINDING_INVALID";
    throw error;
  }
  const result = await storageClient().send(new HeadObjectCommand({
    Bucket: SHOWCASE_VIDEO_SOURCE_BUCKET,
    Key: objectKey,
  }));
  const byteSize = Number(result.ContentLength);
  const contentType = String(result.ContentType || "").toLowerCase();
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > SHOWCASE_VIDEO_SOURCE_MAX_BYTES) {
    const error = new Error("showcase_video_source_size_invalid");
    error.code = "SHOWCASE_VIDEO_SOURCE_SIZE_INVALID";
    throw error;
  }
  if (contentType !== "video/mp4") {
    const error = new Error("showcase_video_source_type_invalid");
    error.code = "SHOWCASE_VIDEO_SOURCE_TYPE_INVALID";
    throw error;
  }
  return { byteSize, contentType };
}
