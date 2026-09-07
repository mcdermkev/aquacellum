import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SOURCE_BUCKET = "showcase-media-source-v1";
const DERIVATIVE_BUCKET = "showcase-media-derivatives-v1";
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;
const DERIVATIVE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_DIMENSION = 8192;
const LEASE_SECONDS = 600;
const IDLE_MS = 2000;
const SWEEP_MS = 60_000;

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
const workerId = randomUUID();
let stopping = false;
let lastSweep = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function permanent(code) {
  const error = new Error(code);
  error.code = code;
  error.permanent = true;
  return error;
}
function closedErrorCode(error) {
  const value = typeof error?.code === "string" ? error.code.toUpperCase() : "WORKER_FAILURE";
  const normalized = value.replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
  return /^[A-Z]/.test(normalized) ? normalized : `E_${normalized}`.slice(0, 64);
}
async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const wrapped = new Error("worker_rpc_failed");
    wrapped.code = String(error.code || "RPC_FAILED");
    throw wrapped;
  }
  return data;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertStrictPng(bytes) {
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return false;
  let offset = 8;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw permanent("PNG_CHUNK_TRUNCATED");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length || end < offset) throw permanent("PNG_CHUNK_LENGTH_INVALID");
    const typeStart = offset + 4;
    const type = bytes.subarray(typeStart, typeStart + 4).toString("ascii");
    const expectedCrc = bytes.readUInt32BE(end - 4);
    const actualCrc = crc32(bytes.subarray(typeStart, end - 4));
    if (actualCrc !== expectedCrc) throw permanent("PNG_CHUNK_CRC_INVALID");
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) throw permanent("PNG_IHDR_INVALID");
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) throw permanent("PNG_TRAILING_OR_INVALID_IEND");
      return true;
    }
    offset = end;
    chunkIndex += 1;
  }
  throw permanent("PNG_IEND_MISSING");
}

function assertStrictJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let inScan = false;
  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      if (offset >= bytes.length) throw permanent("JPEG_EOI_MISSING");
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) throw permanent("JPEG_MARKER_TRUNCATED");
      const marker = bytes[offset];
      if (marker === 0x00) { offset += 1; continue; }
      if (marker >= 0xd0 && marker <= 0xd7) { offset += 1; continue; }
      if (marker === 0xd9) {
        if (offset + 1 !== bytes.length) throw permanent("JPEG_TRAILING_BYTES");
        return true;
      }
      offset = markerStart;
      inScan = false;
      continue;
    }

    if (bytes[offset] !== 0xff) throw permanent("JPEG_MARKER_EXPECTED");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw permanent("JPEG_MARKER_TRUNCATED");
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length) throw permanent("JPEG_TRAILING_BYTES");
      return true;
    }
    if (marker === 0xd8 || marker === 0x00) throw permanent("JPEG_MARKER_INVALID");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (bytes.length - offset < 2) throw permanent("JPEG_SEGMENT_TRUNCATED");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw permanent("JPEG_SEGMENT_LENGTH_INVALID");
    offset += length;
    if (marker === 0xda) inScan = true;
  }
  throw permanent("JPEG_EOI_MISSING");
}

function detectStrictContainer(bytes) {
  if (bytes.length > SOURCE_MAX_BYTES || bytes.length < 12) throw permanent("SOURCE_SIZE_INVALID");
  if (assertStrictJpeg(bytes)) return "jpeg";
  if (assertStrictPng(bytes)) return "png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw permanent("WEBP_LENGTH_INVALID");
    return "webp";
  }
  throw permanent("FORMAT_UNSUPPORTED");
}

function assertDecodedMetadata(metadata, expectedFormat) {
  if (metadata.format !== expectedFormat) throw permanent("FORMAT_MISMATCH");
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1
      || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_PIXELS) {
    throw permanent("DECODED_DIMENSIONS_INVALID");
  }
  if ((metadata.pages || 1) !== 1 || metadata.pageHeight) throw permanent("ANIMATION_REJECTED");
}

function assertCleanDerivative(bytes, metadata, bounds) {
  if (bytes.length < 1 || bytes.length > DERIVATIVE_MAX_BYTES) throw permanent("DERIVATIVE_SIZE_INVALID");
  if (detectStrictContainer(bytes) !== "webp" || metadata.format !== "webp") {
    throw permanent("DERIVATIVE_FORMAT_INVALID");
  }
  if ((metadata.pages || 1) !== 1 || metadata.pageHeight
      || metadata.width > bounds.width || metadata.height > bounds.height) {
    throw permanent("DERIVATIVE_DIMENSIONS_INVALID");
  }
  for (const field of ["exif", "icc", "iptc", "xmp", "tifftagPhotoshop", "comments"]) {
    if (metadata[field] != null) throw permanent("DERIVATIVE_METADATA_PRESENT");
  }
}

async function makeDerivative(source, variant, width, height, quality) {
  const { data, info } = await sharp(source, {
    failOn: "error",
    limitInputPixels: MAX_PIXELS,
    animated: false,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  const metadata = await sharp(data, { failOn: "error", animated: false }).metadata();
  assertCleanDerivative(data, metadata, { width, height });
  return { bytes: data, width: info.width, height: info.height, checksumHex: sha256(data) };
}

async function download(bucket, objectKey) {
  const { data, error } = await supabase.storage.from(bucket).download(objectKey);
  if (error || !data) {
    const failure = new Error("storage_download_failed");
    failure.code = "STORAGE_DOWNLOAD_FAILED";
    throw failure;
  }
  return Buffer.from(await data.arrayBuffer());
}

function splitObjectKey(objectKey) {
  const slash = objectKey.lastIndexOf("/");
  if (slash < 1) throw permanent("OBJECT_KEY_INVALID");
  return { folder: objectKey.slice(0, slash), name: objectKey.slice(slash + 1) };
}

async function objectExists(bucket, objectKey) {
  const { folder, name } = splitObjectKey(objectKey);
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 2, search: name });
  if (error) {
    const failure = new Error("storage_list_failed");
    failure.code = "STORAGE_LIST_FAILED";
    throw failure;
  }
  return (data || []).some((item) => item.name === name);
}

async function uploadImmutable(objectKey, bytes, checksumHex) {
  const { error } = await supabase.storage.from(DERIVATIVE_BUCKET).upload(objectKey, bytes, {
    contentType: "image/webp",
    cacheControl: "0",
    upsert: false,
  });
  if (!error) return;
  // A retry may find the exact immutable output from the prior leased attempt. Accept it only when
  // the bytes are identical; a conflicting object is permanent and is never overwritten.
  if (await objectExists(DERIVATIVE_BUCKET, objectKey)) {
    const existing = await download(DERIVATIVE_BUCKET, objectKey);
    if (existing.length === bytes.length && sha256(existing) === checksumHex) return;
    throw permanent("IMMUTABLE_DERIVATIVE_CONFLICT");
  }
  const failure = new Error("storage_upload_failed");
  failure.code = "STORAGE_UPLOAD_FAILED";
  throw failure;
}

export async function renderSource(source) {
  const container = detectStrictContainer(source);
  let metadata;
  try {
    metadata = await sharp(source, {
      failOn: "error", limitInputPixels: MAX_PIXELS, animated: true, sequentialRead: true,
    }).metadata();
  } catch {
    throw permanent("SOURCE_DECODE_FAILED");
  }
  assertDecodedMetadata(metadata, container);

  let hero;
  let thumb;
  try {
    hero = await makeDerivative(source, "hero", 2400, 1600, 82);
    thumb = await makeDerivative(source, "thumb", 640, 640, 80);
  } catch (error) {
    if (error?.permanent) throw error;
    // A Sharp decode/transform/encode failure is deterministic for these bytes and must reject now
    // rather than retain a hostile source.
    throw permanent("SOURCE_PIXEL_DECODE_FAILED");
  }
  return { container, metadata, hero, thumb };
}

async function processSource(job) {
  if (job.assetState !== "processing") throw permanent("ASSET_NOT_PROCESSING");
  const source = await download(SOURCE_BUCKET, job.sourceObjectKey);
  if (source.length !== Number(job.sourceByteSize) || source.length > SOURCE_MAX_BYTES) {
    throw permanent("SOURCE_SIZE_CHANGED");
  }
  const { container, metadata, hero, thumb } = await renderSource(source);

  const plans = new Map((job.versions || []).map((item) => [item.variant, item]));
  if (!plans.has("hero") || !plans.has("thumb") || plans.size !== 2) {
    throw permanent("PROCESS_PLAN_INVALID");
  }
  const rendered = { hero, thumb };
  const versions = [];
  for (const variant of ["hero", "thumb"]) {
    const plan = plans.get(variant);
    const output = rendered[variant];
    await uploadImmutable(plan.objectKey, output.bytes, output.checksumHex);
    versions.push({
      versionId: plan.versionId,
      variant,
      objectKey: plan.objectKey,
      mime: "image/webp",
      width: output.width,
      height: output.height,
      byteSize: output.bytes.length,
      checksumHex: output.checksumHex,
    });
  }
  await rpc("showcase_complete_media_processing", {
    p_job_id: job.jobId,
    p_worker_id: workerId,
    p_decoded_mime: `image/${container}`,
    p_width: metadata.width,
    p_height: metadata.height,
    p_source_byte_size: source.length,
    p_source_checksum_hex: sha256(source),
    p_metadata_verified: true,
    p_versions: versions,
  });
}

async function deleteObjects(job) {
  const bucket = job.kind === "delete_source" ? SOURCE_BUCKET : DERIVATIVE_BUCKET;
  const keys = job.kind === "delete_source"
    ? [job.sourceObjectKey]
    : (job.versions || []).map((item) => item.objectKey);
  if (keys.length > 0) {
    const { error } = await supabase.storage.from(bucket).remove(keys);
    if (error) {
      const failure = new Error("storage_delete_failed");
      failure.code = "STORAGE_DELETE_FAILED";
      throw failure;
    }
    for (const key of keys) {
      if (await objectExists(bucket, key)) {
        const failure = new Error("storage_delete_unverified");
        failure.code = "STORAGE_DELETE_UNVERIFIED";
        throw failure;
      }
    }
  }
  await rpc("showcase_complete_media_deletion", {
    p_job_id: job.jobId,
    p_worker_id: workerId,
  });
}

async function handleJob(job) {
  try {
    if (job.kind === "process_source") await processSource(job);
    else if (job.kind === "delete_source" || job.kind === "delete_derivatives") await deleteObjects(job);
    else throw permanent("JOB_KIND_INVALID");
    console.log(JSON.stringify({ event: "media_job_complete", jobId: job.jobId, kind: job.kind }));
  } catch (error) {
    const code = closedErrorCode(error);
    try {
      await rpc("showcase_fail_media_job", {
        p_job_id: job.jobId,
        p_worker_id: workerId,
        p_error_code: code,
        p_permanent: error?.permanent === true && job.kind === "process_source",
      });
    } catch (reportError) {
      console.error(JSON.stringify({ event: "media_job_report_failed", jobId: job.jobId,
        code: closedErrorCode(reportError) }));
      return;
    }
    console.error(JSON.stringify({ event: "media_job_failed", jobId: job.jobId,
      kind: job.kind, code, permanent: error?.permanent === true }));
  }
}

async function sweepIfDue() {
  if (Date.now() - lastSweep < SWEEP_MS) return;
  const result = await rpc("showcase_sweep_media_maintenance", { p_limit: 100 });
  lastSweep = Date.now();
  if (Number(result?.overdueJobs || 0) > 0) {
    console.error(JSON.stringify({ event: "media_jobs_overdue", count: result.overdueJobs }));
  }
}

async function main() {
  if (!supabase) throw new Error("worker_configuration_missing");
  console.log(JSON.stringify({ event: "media_worker_started", workerId }));
  while (!stopping) {
    try {
      await sweepIfDue();
      const job = await rpc("showcase_claim_media_job", {
        p_worker_id: workerId,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (job) await handleJob(job);
      else await sleep(IDLE_MS);
    } catch (error) {
      console.error(JSON.stringify({ event: "media_worker_loop_error", code: closedErrorCode(error) }));
      await sleep(5000);
    }
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { stopping = true; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
