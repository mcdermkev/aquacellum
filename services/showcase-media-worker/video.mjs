import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VIDEO_SOURCE_BUCKET = "showcase-video-source-v1";
const SOURCE_MAX_BYTES = 250 * 1024 * 1024;
const MOOV_MAX_BYTES = 16 * 1024 * 1024;
const MUX_API_BASE = "https://api.mux.com";

function permanent(code) {
  const error = new Error(code);
  error.code = code;
  error.permanent = true;
  return error;
}

function retryable(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readUint64(buffer, offset) {
  const value = buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw permanent("MP4_INTEGER_UNSAFE");
  return Number(value);
}

function parseBoxes(buffer, start, end) {
  const result = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) throw permanent("MP4_BOX_TRUNCATED");
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (!/^[\x20-\x7e]{4}$/.test(type)) throw permanent("MP4_BOX_TYPE_INVALID");
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) throw permanent("MP4_BOX_TRUNCATED");
      size = readUint64(buffer, offset + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end || offset + size <= offset) {
      throw permanent("MP4_BOX_SIZE_INVALID");
    }
    result.push({ type, start: offset, content: offset + headerSize, end: offset + size, size, headerSize });
    offset += size;
  }
  return result;
}

function children(buffer, parent) {
  return parseBoxes(buffer, parent.content, parent.end);
}

function child(buffer, parent, type) {
  return children(buffer, parent).find((box) => box.type === type) || null;
}

function movieDuration(buffer, mvhd) {
  if (!mvhd || mvhd.end - mvhd.content < 20) throw permanent("MP4_MVHD_INVALID");
  const version = buffer[mvhd.content];
  let timescale;
  let duration;
  if (version === 0) {
    timescale = buffer.readUInt32BE(mvhd.content + 12);
    duration = buffer.readUInt32BE(mvhd.content + 16);
  } else if (version === 1 && mvhd.end - mvhd.content >= 32) {
    timescale = buffer.readUInt32BE(mvhd.content + 20);
    duration = readUint64(buffer, mvhd.content + 24);
  } else {
    throw permanent("MP4_MVHD_VERSION_INVALID");
  }
  const seconds = duration / timescale;
  if (!timescale || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
    throw permanent("VIDEO_DURATION_INVALID");
  }
  return seconds;
}

function videoTrack(buffer, trak) {
  const mdia = child(buffer, trak, "mdia");
  const hdlr = mdia && child(buffer, mdia, "hdlr");
  if (!mdia || !hdlr || hdlr.end - hdlr.content < 12) throw permanent("MP4_TRACK_INVALID");
  if (buffer.subarray(hdlr.content + 8, hdlr.content + 12).toString("ascii") !== "vide") return null;
  const minf = child(buffer, mdia, "minf");
  const stbl = minf && child(buffer, minf, "stbl");
  const stsd = stbl && child(buffer, stbl, "stsd");
  if (!minf || !stbl || !stsd || stsd.end - stsd.content < 16) throw permanent("MP4_STSD_INVALID");
  const entryCount = buffer.readUInt32BE(stsd.content + 4);
  const entries = parseBoxes(buffer, stsd.content + 8, stsd.end);
  if (entryCount !== 1 || entries.length !== 1) throw permanent("VIDEO_SAMPLE_ENTRY_INVALID");
  const entry = entries[0];
  const codec = ({ avc1: "h264", avc3: "h264", hvc1: "hevc", hev1: "hevc" })[entry.type];
  if (!codec || entry.end - entry.content < 28) throw permanent("VIDEO_CODEC_UNSUPPORTED");
  const width = buffer.readUInt16BE(entry.content + 24);
  const height = buffer.readUInt16BE(entry.content + 26);
  if (width < 16 || width > 3840 || height < 16 || height > 2160) {
    throw permanent("VIDEO_DIMENSIONS_INVALID");
  }
  const tkhd = child(buffer, trak, "tkhd");
  if (!tkhd || tkhd.end - tkhd.content < 8) throw permanent("MP4_TKHD_INVALID");
  const trackWidth = buffer.readUInt32BE(tkhd.end - 8) / 65536;
  const trackHeight = buffer.readUInt32BE(tkhd.end - 4) / 65536;
  if ((trackWidth > 0 && Math.abs(trackWidth - width) > 1)
      || (trackHeight > 0 && Math.abs(trackHeight - height) > 1)) {
    throw permanent("VIDEO_DIMENSIONS_CONFLICT");
  }
  return { codec, width, height };
}

function inspectMoov(buffer) {
  const roots = parseBoxes(buffer, 0, buffer.length);
  if (roots.length !== 1 || roots[0].type !== "moov") throw permanent("MP4_MOOV_INVALID");
  const moovChildren = children(buffer, roots[0]);
  if (moovChildren.some((box) => box.type === "mvex")) throw permanent("FRAGMENTED_MP4_UNSUPPORTED");
  const duration = movieDuration(buffer, moovChildren.find((box) => box.type === "mvhd"));
  const tracks = moovChildren.filter((box) => box.type === "trak")
    .map((trak) => videoTrack(buffer, trak)).filter(Boolean);
  if (tracks.length !== 1) throw permanent("VIDEO_TRACK_COUNT_INVALID");
  return { ...tracks[0], duration };
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw permanent("MP4_FILE_TRUNCATED");
    offset += bytesRead;
  }
  return buffer;
}

async function fileBoxHeader(handle, position, fileSize) {
  const first = await readExactly(handle, 8, position);
  const size32 = first.readUInt32BE(0);
  const type = first.subarray(4, 8).toString("ascii");
  if (!/^[\x20-\x7e]{4}$/.test(type)) throw permanent("MP4_BOX_TYPE_INVALID");
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    size = readUint64(await readExactly(handle, 8, position + 8), 0);
    headerSize = 16;
  } else if (size32 === 0) {
    size = fileSize - position;
  }
  if (size < headerSize || position + size > fileSize || position + size <= position) {
    throw permanent("MP4_BOX_SIZE_INVALID");
  }
  return { type, position, size, headerSize };
}

export async function inspectMp4File(filePath, fileSize) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 24 || fileSize > SOURCE_MAX_BYTES) {
    throw permanent("SOURCE_SIZE_INVALID");
  }
  const handle = await open(filePath, "r");
  try {
    let position = 0;
    let ftyp = null;
    let moov = null;
    let mediaBytes = 0;
    while (position < fileSize) {
      const box = await fileBoxHeader(handle, position, fileSize);
      if (box.type === "ftyp") {
        if (position !== 0 || ftyp || box.size < 16 || box.size > 1024) throw permanent("MP4_FTYP_INVALID");
        ftyp = await readExactly(handle, box.size, position);
      } else if (box.type === "moov") {
        if (moov || box.size > MOOV_MAX_BYTES) throw permanent("MP4_MOOV_INVALID");
        moov = await readExactly(handle, box.size, position);
      } else if (box.type === "mdat") {
        mediaBytes += box.size - box.headerSize;
      } else if (!["free", "skip", "wide"].includes(box.type)) {
        throw permanent("MP4_TOP_LEVEL_BOX_UNSUPPORTED");
      }
      position += box.size;
    }
    if (!ftyp || !moov || mediaBytes < 1) throw permanent("MP4_ENVELOPE_INVALID");
    const brands = [];
    for (let offset = 8; offset + 4 <= ftyp.length; offset += 4) {
      brands.push(ftyp.subarray(offset, offset + 4).toString("ascii"));
    }
    if (!brands.some((brand) => ["isom", "iso2", "mp41", "mp42", "avc1", "hvc1"].includes(brand))) {
      throw permanent("MP4_BRAND_UNSUPPORTED");
    }
    return inspectMoov(moov);
  } finally {
    await handle.close();
  }
}

function muxAuthorization() {
  const id = String(process.env.MUX_TOKEN_ID || "").trim();
  const secret = String(process.env.MUX_TOKEN_SECRET || "").trim();
  if (!id || !secret) throw permanent("MUX_NOT_CONFIGURED");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function muxJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${MUX_API_BASE}${path}`, {
      ...options,
      headers: { Accept: "application/json", Authorization: muxAuthorization(), ...(options.headers || {}) },
    });
  } catch {
    throw permanent("MUX_REQUEST_AMBIGUOUS");
  }
  if (!response.ok) throw permanent(`MUX_HTTP_${response.status}`);
  const body = await response.json();
  if (!body?.data || typeof body.data !== "object") throw permanent("MUX_RESPONSE_INVALID");
  return body.data;
}

async function deleteMuxPath(path) {
  let response;
  try {
    response = await fetch(`${MUX_API_BASE}${path}`, {
      method: "DELETE", headers: { Accept: "application/json", Authorization: muxAuthorization() },
    });
  } catch {
    throw retryable("MUX_DELETE_FAILED");
  }
  if (!response.ok && response.status !== 404) throw retryable(`MUX_DELETE_${response.status}`);
}

async function muxUploadOrNull(uploadId) {
  try {
    return await muxJson(`/video/v1/uploads/${encodeURIComponent(uploadId)}`);
  } catch (error) {
    if (error?.code === "MUX_HTTP_404") return null;
    throw error;
  }
}

async function objectExists(supabase, bucket, objectKey) {
  const slash = objectKey.lastIndexOf("/");
  if (slash < 1) throw permanent("OBJECT_KEY_INVALID");
  const folder = objectKey.slice(0, slash);
  const name = objectKey.slice(slash + 1);
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 2, search: name });
  if (error) throw retryable("STORAGE_LIST_FAILED");
  return (data || []).some((item) => item.name === name);
}

async function downloadToTemp(supabase, job) {
  const { data, error } = await supabase.storage.from(VIDEO_SOURCE_BUCKET)
    .createSignedUrl(job.sourceObjectKey, 600);
  if (error || !data?.signedUrl) throw retryable("STORAGE_DOWNLOAD_FAILED");
  const response = await fetch(data.signedUrl, { headers: { Accept: "video/mp4" } });
  if (!response.ok || !response.body) throw retryable("STORAGE_DOWNLOAD_FAILED");
  const folder = await mkdtemp(join(tmpdir(), "showcase-video-"));
  const filePath = join(folder, "source.mp4");
  const handle = await open(filePath, "wx", 0o600);
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      byteSize += chunk.length;
      if (byteSize > SOURCE_MAX_BYTES) throw permanent("SOURCE_SIZE_INVALID");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (bytesWritten < 1) throw retryable("TEMP_WRITE_FAILED");
        offset += bytesWritten;
      }
    }
  } catch (failure) {
    await handle.close();
    await rm(folder, { recursive: true, force: true });
    throw failure;
  }
  await handle.close();
  if (byteSize !== Number(job.declaredSourceByteSize)) {
    await rm(folder, { recursive: true, force: true });
    throw permanent("SOURCE_SIZE_CHANGED");
  }
  return { folder, filePath, byteSize, checksumHex: hash.digest("hex") };
}

async function createDirectUpload(job, metadata) {
  const passthrough = JSON.stringify({
    codec: metadata.codec,
    correlation: job.correlationToken,
    schema: "showcase-video-v1",
    videoId: job.videoId,
  });
  const upload = await muxJson("/video/v1/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      new_asset_settings: { playback_policy: ["signed"], encoding_tier: "baseline", passthrough },
      timeout: 3600,
    }),
  });
  if (typeof upload.id !== "string" || typeof upload.url !== "string" || !upload.url.startsWith("https://")) {
    throw permanent("MUX_UPLOAD_RESPONSE_INVALID");
  }
  return { id: upload.id, url: upload.url };
}

async function uploadFile(upload, filePath, byteSize) {
  let response;
  try {
    response = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(byteSize) },
      body: createReadStream(filePath),
      duplex: "half",
    });
  } catch {
    const observed = await muxUploadOrNull(upload.id);
    if (observed?.asset_id) return;
    throw permanent("MUX_UPLOAD_AMBIGUOUS");
  }
  if (!response.ok) {
    const observed = await muxUploadOrNull(upload.id);
    if (observed?.asset_id) return;
    throw permanent(`MUX_UPLOAD_HTTP_${response.status}`);
  }
}

export function createShowcaseVideoProcessor({ supabase, rpc, workerId }) {
  async function ingest(job) {
    if (!['queued', 'processing'].includes(job.assetState)) throw permanent("ASSET_NOT_INGESTIBLE");
    const source = await downloadToTemp(supabase, job);
    let upload = null;
    let bound = false;
    try {
      const metadata = await inspectMp4File(source.filePath, source.byteSize);
      upload = await createDirectUpload(job, metadata);
      let binding;
      try {
        binding = await rpc("showcase_bind_video_mux_upload", {
          p_job_id: job.jobId,
          p_worker_id: workerId,
          p_source_byte_size: source.byteSize,
          p_source_checksum_hex: source.checksumHex,
          p_mux_upload_id: upload.id,
        });
        bound = true;
      } catch {
        await deleteMuxPath(`/video/v1/uploads/${encodeURIComponent(upload.id)}`).catch(() => {});
        throw permanent("MUX_BIND_AMBIGUOUS");
      }
      if (binding?.accepted !== true) {
        await deleteMuxPath(`/video/v1/uploads/${encodeURIComponent(upload.id)}`);
        await rpc("showcase_complete_video_ingest_submit", { p_job_id: job.jobId, p_worker_id: workerId });
        return;
      }
      await uploadFile(upload, source.filePath, source.byteSize);
      await rpc("showcase_complete_video_ingest_submit", { p_job_id: job.jobId, p_worker_id: workerId });
    } catch (failure) {
      if (upload && !bound) await deleteMuxPath(`/video/v1/uploads/${encodeURIComponent(upload.id)}`).catch(() => {});
      throw failure;
    } finally {
      await rm(source.folder, { recursive: true, force: true });
    }
  }

  async function remove(job) {
    if (job.kind === "delete_source") {
      const { error } = await supabase.storage.from(VIDEO_SOURCE_BUCKET).remove([job.sourceObjectKey]);
      if (error) throw retryable("STORAGE_DELETE_FAILED");
      if (await objectExists(supabase, VIDEO_SOURCE_BUCKET, job.sourceObjectKey)) {
        throw retryable("STORAGE_DELETE_UNVERIFIED");
      }
    } else {
      let assetId = job.muxAssetId || null;
      if (!assetId && job.muxUploadId) {
        const upload = await muxUploadOrNull(job.muxUploadId);
        assetId = typeof upload?.asset_id === "string" ? upload.asset_id : null;
      }
      if (assetId) await deleteMuxPath(`/video/v1/assets/${encodeURIComponent(assetId)}`);
      if (job.muxUploadId) await deleteMuxPath(`/video/v1/uploads/${encodeURIComponent(job.muxUploadId)}`);
    }
    await rpc("showcase_complete_video_deletion", { p_job_id: job.jobId, p_worker_id: workerId });
  }

  return {
    async process(job) {
      if (job.kind === "ingest_mux") return ingest(job);
      if (job.kind === "delete_source" || job.kind === "delete_mux_asset") return remove(job);
      throw permanent("JOB_KIND_INVALID");
    },
  };
}
