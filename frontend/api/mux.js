/**
 * mux.js — Consolidated Vercel Serverless Function
 *
 * Combines the Mux Direct Upload endpoint and the Mux webhook handler into a
 * single function to stay within Vercel Hobby plan's 12 serverless function
 * limit. Shared Mux/Supabase helpers live in ./_lib/mux.js.
 *
 * Routing:
 *   POST /api/mux?action=upload   → create a Mux Direct Upload URL (client)
 *   POST /api/mux (no action)     → Mux webhook events (configure this URL in
 *                                    the Mux dashboard as the webhook target)
 *
 * Upload body:    { walletAddress: string }
 * Upload returns: { uploadUrl: string|null, uploadId: string|null, error?: string }
 */

import { handleCorsPreFlight } from "./_lib/cors.js";
import {
  createDirectUpload,
  getSupabaseConfig,
  verifyMuxSignature,
  parsePassthrough,
  supabasePatch,
} from "./_lib/mux.js";

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD HANDLER (previously /api/video-upload)
// ═══════════════════════════════════════════════════════════════════════════════

async function handleUpload(req, res) {
  if (handleCorsPreFlight(req, res, { methods: "POST, OPTIONS" })) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { walletAddress } = req.body || {};
  if (!walletAddress) {
    return res.status(400).json({ uploadUrl: null, uploadId: null, error: "walletAddress is required" });
  }

  try {
    const { uploadUrl, uploadId } = await createDirectUpload({
      walletAddress,
      corsOrigin: process.env.FRONTEND_ORIGIN,
    });
    return res.status(200).json({ uploadUrl, uploadId, error: null });
  } catch (err) {
    // Preserve the prior contract: surface the error in the body with a 200 so
    // the client can degrade gracefully rather than throwing on a non-2xx.
    console.error("[Mux Upload] Error:", err);
    return res.status(200).json({ uploadUrl: null, uploadId: null, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER (previously /api/mux-webhook)
// ═══════════════════════════════════════════════════════════════════════════════

async function handleWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  verifyMuxSignature(req, process.env.MUX_WEBHOOK_SECRET);

  const event = req.body;
  const eventType = event?.type;
  const eventData = event?.data;

  if (!eventType || !eventData) {
    return res.status(400).json({ error: "Invalid event payload" });
  }

  console.log(`[Mux Webhook] Received: ${eventType}`);

  const supa = getSupabaseConfig();
  if (!supa) {
    console.warn("[Mux Webhook] Supabase not configured, skipping DB update");
    return res.status(200).json({ received: true });
  }
  const { url, key } = supa;

  try {
    switch (eventType) {
      case "video.upload.asset_created": {
        // Upload received, asset creation started — store the asset id for
        // correlation against the row that referenced this upload id.
        const assetId = eventData.asset_id;
        const uploadId = eventData.id;
        console.log(`[Mux Webhook] Upload ${uploadId} → asset ${assetId} created`);
        await supabasePatch({
          url, key, table: "currents",
          matchColumn: "video_upload_id",
          matchValue: uploadId,
          updates: { video_asset_id: assetId, video_status: "processing" },
        });
        break;
      }

      case "video.asset.ready": {
        const asset = eventData;
        const playbackId = asset.playback_ids?.[0]?.id;
        const duration = asset.duration;
        if (!playbackId) {
          console.warn("[Mux Webhook] Asset ready but no playback ID");
          break;
        }
        const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.webp?time=2`;
        console.log(`[Mux Webhook] Asset ready: playbackId=${playbackId}, duration=${duration}s`);
        await supabasePatch({
          url, key, table: "currents",
          matchColumn: "video_asset_id",
          matchValue: asset.id,
          updates: {
            video_playback_id: playbackId,
            video_thumbnail_url: thumbnailUrl,
            video_duration_seconds: Math.round(duration || 0),
            video_status: "ready",
          },
        });
        break;
      }

      case "video.asset.errored": {
        const asset = eventData;
        const errorMessage = asset.errors?.messages?.[0] || "Unknown encoding error";
        console.error(`[Mux Webhook] Asset errored: ${asset.id} — ${errorMessage}`);
        await supabasePatch({
          url, key, table: "currents",
          matchColumn: "video_asset_id",
          matchValue: asset.id,
          updates: { video_status: "error" },
        });
        break;
      }

      // ── Live Stream Events (Tank Cams / Tide Streams) ──

      case "video.live_stream.active": {
        const streamId = eventData.id;
        console.log(`[Mux Webhook] Live stream active: ${streamId}`);
        await supabasePatch({
          url, key, table: "tank_cams",
          matchColumn: "mux_live_stream_id", matchValue: streamId,
          updates: { status: "active", last_active_at: new Date().toISOString() },
        });
        await supabasePatch({
          url, key, table: "tide_streams",
          matchColumn: "mux_live_stream_id", matchValue: streamId,
          updates: { status: "live" },
        });
        break;
      }

      case "video.live_stream.idle": {
        const streamId = eventData.id;
        console.log(`[Mux Webhook] Live stream idle: ${streamId}`);
        await supabasePatch({
          url, key, table: "tank_cams",
          matchColumn: "mux_live_stream_id", matchValue: streamId,
          updates: { status: "idle" },
        });
        await supabasePatch({
          url, key, table: "tide_streams",
          matchColumn: "mux_live_stream_id", matchValue: streamId,
          updates: { status: "ended" },
        });
        break;
      }

      case "video.live_stream.disconnected": {
        const streamId = eventData.id;
        console.warn(`[Mux Webhook] Live stream disconnected: ${streamId}`);
        await supabasePatch({
          url, key, table: "tank_cams",
          matchColumn: "mux_live_stream_id", matchValue: streamId,
          updates: { status: "disconnected" },
        });
        await supabasePatch({
          url, key, table: "tide_streams",
          matchColumn: "mux_live_stream_id", matchValue: streamId,
          updates: { status: "disconnected" },
        });
        break;
      }

      case "video.asset.live_stream_completed": {
        const asset = eventData;
        const playbackId = asset.playback_ids?.[0]?.id;
        const passthrough = parsePassthrough(asset.passthrough);
        const tideId = passthrough?.tideId;
        if (playbackId && tideId) {
          console.log(`[Mux Webhook] Live recording ready for tide ${tideId}: ${playbackId}`);
          await supabasePatch({
            url, key, table: "tide_streams",
            matchColumn: "tide_id", matchValue: tideId,
            updates: { recording_playback_id: playbackId },
          });
        }
        break;
      }

      default:
        console.log(`[Mux Webhook] Unhandled event: ${eventType}`);
    }
  } catch (err) {
    console.error("[Mux Webhook] Processing error:", err);
    // Still return 200 to prevent Mux from retrying.
  }

  return res.status(200).json({ received: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const action = req.query.action || "webhook";

  switch (action) {
    case "upload":
      return handleUpload(req, res);
    case "webhook":
      return handleWebhook(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}. Use ?action=upload or the default webhook.` });
  }
}
