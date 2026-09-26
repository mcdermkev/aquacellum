/**
 * Consolidated Mux upload + webhook route. Showcase videos never use the browser upload action:
 * their private source is validated by the media worker before a signed-policy Mux upload exists.
 */
import { createClient } from "@supabase/supabase-js";
import { handleCorsPreFlight } from "./_lib/cors.js";
import {
  createDirectUpload,
  getSupabaseConfig,
  parsePassthrough,
  supabasePatch,
  verifyMuxSignature,
} from "./_lib/mux.js";
import {
  canonicalMuxReadyFields,
  getMuxAsset,
  parseShowcaseMuxPassthrough,
  sha256Hex,
} from "./_lib/showcaseMux.js";
import {
  isPrivyConfigurationFailure,
  verifyPrivyToken,
} from "./_lib/verifyPrivyToken.js";

export const config = { api: { bodyParser: false } };

const MAX_UPLOAD_BODY_BYTES = 4096;
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      total += chunk.length;
      if (total > maxBytes) {
        failed = true;
        reject(Object.assign(new Error("body_too_large"), { code: "BODY_TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on("error", (error) => { if (!failed) reject(error); });
  });
}

function parseJsonBytes(raw) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  return JSON.parse(text);
}

async function handleUpload(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let raw;
  try {
    raw = await readRawBody(req, MAX_UPLOAD_BODY_BYTES);
    const body = raw.length === 0 ? {} : parseJsonBytes(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_body");
  } catch (error) {
    return res.status(error?.code === "BODY_TOO_LARGE" ? 413 : 400)
      .json({ uploadUrl: null, uploadId: null, error: "Invalid request" });
  }

  const auth = await verifyPrivyToken(req);
  if (!auth.verified) {
    const status = isPrivyConfigurationFailure(auth) ? 503 : 401;
    return res.status(status).json({ uploadUrl: null, uploadId: null,
      error: status === 503 ? "Authentication service unavailable" : "Authentication required" });
  }
  if (!WALLET_RE.test(auth.walletAddress || "")) {
    return res.status(409).json({ uploadUrl: null, uploadId: null, error: "Wallet unavailable" });
  }

  try {
    const { uploadUrl, uploadId } = await createDirectUpload({
      walletAddress: auth.walletAddress.toLowerCase(),
      corsOrigin: process.env.FRONTEND_ORIGIN,
    });
    return res.status(200).json({ uploadUrl, uploadId, error: null });
  } catch (error) {
    console.error("[Mux Upload] Error:", error?.code || "error");
    return res.status(200).json({ uploadUrl: null, uploadId: null, error: "Video upload unavailable" });
  }
}

function sameShowcaseMetadata(left, right) {
  return !!left && !!right && left.videoId === right.videoId
    && left.correlation === right.correlation && left.codec === right.codec;
}

async function showcaseEventArguments(eventType, eventData) {
  const eventMetadata = parseShowcaseMuxPassthrough(eventType, eventData);
  if (!eventMetadata) return {
    metadata: null, uploadId: null, assetId: null, playbackId: null,
    duration: null, width: null, height: null, codec: null, playbackPolicy: null,
  };

  if (eventType === "video.upload.asset_created") {
    return {
      metadata: eventMetadata,
      uploadId: typeof eventData.id === "string" ? eventData.id : null,
      assetId: typeof eventData.asset_id === "string" ? eventData.asset_id : null,
      playbackId: null, duration: null, width: null, height: null,
      codec: eventMetadata.codec, playbackPolicy: null,
    };
  }

  if (eventType === "video.asset.ready") {
    const canonicalAsset = await getMuxAsset(String(eventData.id || ""));
    const canonicalMetadata = parseShowcaseMuxPassthrough(eventType, canonicalAsset);
    if (!sameShowcaseMetadata(eventMetadata, canonicalMetadata)) {
      throw Object.assign(new Error("showcase_mux_metadata_conflict"), { code: "SHOWCASE_MUX_METADATA_CONFLICT" });
    }
    const fields = canonicalMuxReadyFields(canonicalAsset, canonicalMetadata);
    if (!fields) throw Object.assign(new Error("showcase_mux_asset_invalid"), { code: "SHOWCASE_MUX_ASSET_INVALID" });
    return { metadata: canonicalMetadata, ...fields };
  }

  return {
    metadata: eventMetadata,
    uploadId: typeof eventData.upload_id === "string" ? eventData.upload_id : null,
    assetId: typeof eventData.id === "string" ? eventData.id : null,
    playbackId: null, duration: null, width: null, height: null,
    codec: eventMetadata.codec, playbackPolicy: null,
  };
}

async function applyShowcaseEvent(supabase, event, raw) {
  const fields = await showcaseEventArguments(event.type, event.data);
  const { data, error } = await supabase.rpc("showcase_apply_mux_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_raw_sha256_hex: sha256Hex(raw),
    p_video_id: fields.metadata?.videoId || null,
    p_correlation: fields.metadata?.correlation || null,
    p_mux_upload_id: fields.uploadId,
    p_mux_asset_id: fields.assetId,
    p_mux_playback_id: fields.playbackId,
    p_duration: fields.duration,
    p_width: fields.width,
    p_height: fields.height,
    p_video_codec: fields.codec,
    p_playback_policy: fields.playbackPolicy,
  });
  if (error) throw Object.assign(new Error("showcase_mux_rpc_failed"), { code: error.code || "RPC_FAILED" });
  return data;
}

async function applyGenericEvent({ eventType, eventData, url, key }) {
  switch (eventType) {
    case "video.upload.asset_created":
      await supabasePatch({
        url, key, table: "currents", matchColumn: "video_upload_id", matchValue: eventData.id,
        updates: { video_asset_id: eventData.asset_id, video_status: "processing" },
      });
      break;
    case "video.asset.ready": {
      const playbackId = eventData.playback_ids?.find((item) => item?.policy === "public")?.id;
      if (!playbackId) break;
      await supabasePatch({
        url, key, table: "currents", matchColumn: "video_asset_id", matchValue: eventData.id,
        updates: {
          video_playback_id: playbackId,
          video_thumbnail_url: `https://image.mux.com/${playbackId}/thumbnail.webp?time=2`,
          video_duration_seconds: Math.round(eventData.duration || 0), video_status: "ready",
        },
      });
      break;
    }
    case "video.asset.errored":
      await supabasePatch({
        url, key, table: "currents", matchColumn: "video_asset_id", matchValue: eventData.id,
        updates: { video_status: "error" },
      });
      break;
    case "video.live_stream.active":
      await Promise.all([
        supabasePatch({ url, key, table: "tank_cams", matchColumn: "mux_live_stream_id", matchValue: eventData.id,
          updates: { status: "active", last_active_at: new Date().toISOString() } }),
        supabasePatch({ url, key, table: "tide_streams", matchColumn: "mux_live_stream_id", matchValue: eventData.id,
          updates: { status: "live" } }),
      ]);
      break;
    case "video.live_stream.idle":
      await Promise.all([
        supabasePatch({ url, key, table: "tank_cams", matchColumn: "mux_live_stream_id", matchValue: eventData.id,
          updates: { status: "idle" } }),
        supabasePatch({ url, key, table: "tide_streams", matchColumn: "mux_live_stream_id", matchValue: eventData.id,
          updates: { status: "ended" } }),
      ]);
      break;
    case "video.live_stream.disconnected":
      await Promise.all([
        supabasePatch({ url, key, table: "tank_cams", matchColumn: "mux_live_stream_id", matchValue: eventData.id,
          updates: { status: "disconnected" } }),
        supabasePatch({ url, key, table: "tide_streams", matchColumn: "mux_live_stream_id", matchValue: eventData.id,
          updates: { status: "disconnected" } }),
      ]);
      break;
    case "video.asset.live_stream_completed": {
      const playbackId = eventData.playback_ids?.find((item) => item?.policy === "public")?.id;
      const tideId = parsePassthrough(eventData.passthrough)?.tideId;
      if (playbackId && tideId) {
        await supabasePatch({ url, key, table: "tide_streams", matchColumn: "tide_id", matchValue: tideId,
          updates: { recording_playback_id: playbackId } });
      }
      break;
    }
    default:
      break;
  }
}

async function handleWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  let raw;
  try {
    raw = await readRawBody(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    return res.status(error?.code === "BODY_TOO_LARGE" ? 413 : 400).json({ error: "invalid_request" });
  }
  const verification = verifyMuxSignature({
    rawBody: raw,
    signatureHeader: req.headers["mux-signature"],
    secret: process.env.MUX_WEBHOOK_SECRET,
  });
  if (!verification.ok) return res.status(401).json({ error: "invalid_signature" });

  let event;
  try {
    event = parseJsonBytes(raw);
  } catch {
    return res.status(400).json({ error: "invalid_payload" });
  }
  if (!event || typeof event !== "object" || Array.isArray(event)
      || typeof event.id !== "string" || event.id.length < 1 || event.id.length > 200
      || typeof event.type !== "string" || !event.data || typeof event.data !== "object") {
    return res.status(400).json({ error: "invalid_payload" });
  }

  const config = getSupabaseConfig();
  if (!config) return res.status(503).json({ error: "service_unavailable" });
  const supabase = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const result = await applyShowcaseEvent(supabase, event, raw);
    if (result?.result === "conflict") return res.status(409).json({ error: "event_conflict" });
    await applyGenericEvent({ eventType: event.type, eventData: event.data, ...config });
    return res.status(200).json({ received: true, duplicate: result?.result === "duplicate" });
  } catch (error) {
    console.error("[Mux Webhook] Processing error:", error?.code || "error");
    return res.status(500).json({ error: "processing_failed" });
  }
}

export default async function handler(req, res) {
  const action = req.query.action || "webhook";
  if (action === "upload") return handleUpload(req, res);
  if (action === "webhook") return handleWebhook(req, res);
  return res.status(400).json({ error: "Unknown action" });
}
