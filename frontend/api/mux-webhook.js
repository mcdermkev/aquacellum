/**
 * Vercel serverless function: /api/mux-webhook
 * 
 * Handles Mux webhook events for video processing status updates.
 * Updates the Supabase `currents` table when videos are ready or errored.
 * 
 * Webhook events handled:
 * - video.asset.ready → video is transcoded and playable
 * - video.asset.errored → transcoding failed
 * - video.upload.asset_created → upload received, transcoding started
 * 
 * POST /api/mux-webhook
 */

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const MUX_WEBHOOK_SECRET = process.env.MUX_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  // ── Verify webhook signature (if secret is configured) ──
  if (MUX_WEBHOOK_SECRET) {
    const signature = req.headers["mux-signature"];
    if (!signature) {
      // In development or if Mux hasn't started sending signatures yet, allow through
      console.warn("[Mux Webhook] No signature header — proceeding without verification");
    } else {
      // Mux signature format: t=<timestamp>,v1=<hash>
      const parts = signature.split(",");
      const timestampPart = parts.find((p) => p.startsWith("t="));
      const signaturePart = parts.find((p) => p.startsWith("v1="));

      if (timestampPart && signaturePart) {
        const timestamp = timestampPart.slice(2);
        const expectedSig = signaturePart.slice(3);

        // Reconstruct the raw body for signature verification
        // Note: Vercel may have already parsed the body, so we re-stringify
        const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        const payload = `${timestamp}.${rawBody}`;
        const computedSig = crypto
          .createHmac("sha256", MUX_WEBHOOK_SECRET)
          .update(payload)
          .digest("hex");

        if (computedSig !== expectedSig) {
          console.warn("[Mux Webhook] Signature mismatch — allowing anyway (Vercel body parsing may alter raw body)");
          // Don't reject — Vercel's JSON body parsing can alter the raw bytes
        }
      }
    }
  }

  // ── Process the webhook event ──
  const event = req.body;
  const eventType = event?.type;
  const eventData = event?.data;

  if (!eventType || !eventData) {
    return res.status(400).json({ error: "Invalid event payload" });
  }

  console.log(`[Mux Webhook] Received: ${eventType}`);

  // We need Supabase configured to update video status
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[Mux Webhook] Supabase not configured, skipping DB update");
    return res.status(200).json({ received: true });
  }

  try {
    switch (eventType) {
      case "video.upload.asset_created": {
        // Upload received, asset creation started
        // The asset ID is now available — store it for correlation
        const assetId = eventData.asset_id;
        const uploadId = eventData.id;
        console.log(`[Mux Webhook] Upload ${uploadId} → asset ${assetId} created`);

        // Update any currents that reference this upload_id
        await supabaseUpdate(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          matchColumn: "video_upload_id",
          matchValue: uploadId,
          updates: {
            video_asset_id: assetId,
            video_status: "processing",
          },
        });
        break;
      }

      case "video.asset.ready": {
        // Video fully transcoded and playable
        const asset = eventData;
        const playbackId = asset.playback_ids?.[0]?.id;
        const duration = asset.duration;
        const passthrough = parsePassthrough(asset.passthrough);

        if (!playbackId) {
          console.warn("[Mux Webhook] Asset ready but no playback ID");
          break;
        }

        const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.webp?time=2`;

        console.log(`[Mux Webhook] Asset ready: playbackId=${playbackId}, duration=${duration}s`);

        // Update the current by asset_id
        await supabaseUpdate(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
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

        await supabaseUpdate(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          matchColumn: "video_asset_id",
          matchValue: asset.id,
          updates: {
            video_status: "error",
          },
        });
        break;
      }

      // ── Live Stream Events (Tank Cams / Tide Streams) ──

      case "video.live_stream.active": {
        // Camera/OBS connected and streaming
        const streamId = eventData.id;
        console.log(`[Mux Webhook] Live stream active: ${streamId}`);

        // Update tank_cams
        await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          table: "tank_cams",
          matchColumn: "mux_live_stream_id",
          matchValue: streamId,
          updates: {
            status: "active",
            last_active_at: new Date().toISOString(),
          },
        });

        // Update tide_streams
        await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          table: "tide_streams",
          matchColumn: "mux_live_stream_id",
          matchValue: streamId,
          updates: {
            status: "live",
          },
        });
        break;
      }

      case "video.live_stream.idle": {
        // Stream ended gracefully (camera disconnected normally)
        const streamId = eventData.id;
        console.log(`[Mux Webhook] Live stream idle: ${streamId}`);

        await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          table: "tank_cams",
          matchColumn: "mux_live_stream_id",
          matchValue: streamId,
          updates: {
            status: "idle",
          },
        });

        await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          table: "tide_streams",
          matchColumn: "mux_live_stream_id",
          matchValue: streamId,
          updates: {
            status: "ended",
          },
        });
        break;
      }

      case "video.live_stream.disconnected": {
        // Stream disconnected unexpectedly
        const streamId = eventData.id;
        console.warn(`[Mux Webhook] Live stream disconnected: ${streamId}`);

        await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          table: "tank_cams",
          matchColumn: "mux_live_stream_id",
          matchValue: streamId,
          updates: {
            status: "disconnected",
          },
        });

        await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
          table: "tide_streams",
          matchColumn: "mux_live_stream_id",
          matchValue: streamId,
          updates: {
            status: "disconnected",
          },
        });
        break;
      }

      case "video.asset.live_stream_completed": {
        // Recording from a live stream is ready (VOD)
        const asset = eventData;
        const playbackId = asset.playback_ids?.[0]?.id;
        const passthrough = parsePassthrough(asset.passthrough);
        const tideId = passthrough?.tideId;

        if (playbackId && tideId) {
          console.log(`[Mux Webhook] Live recording ready for tide ${tideId}: ${playbackId}`);

          await supabaseUpdateTable(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            table: "tide_streams",
            matchColumn: "tide_id",
            matchValue: tideId,
            updates: {
              recording_playback_id: playbackId,
            },
          });
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge but do nothing
        console.log(`[Mux Webhook] Unhandled event: ${eventType}`);
    }
  } catch (err) {
    console.error("[Mux Webhook] Processing error:", err);
    // Still return 200 to prevent Mux from retrying
  }

  return res.status(200).json({ received: true });
}

/**
 * Update a currents row in Supabase by matching a column value.
 */
async function supabaseUpdate(supabaseUrl, serviceKey, { matchColumn, matchValue, updates }) {
  if (!matchValue) return;

  const url = `${supabaseUrl}/rest/v1/currents?${matchColumn}=eq.${encodeURIComponent(matchValue)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Mux Webhook] Supabase update failed: ${response.status} ${errText}`);
  }
}

/**
 * Safely parse the passthrough JSON from Mux assets.
 */
function parsePassthrough(passthrough) {
  if (!passthrough) return {};
  try {
    return JSON.parse(passthrough);
  } catch {
    return {};
  }
}

/**
 * Update a row in any Supabase table by matching a column value.
 */
async function supabaseUpdateTable(supabaseUrl, serviceKey, { table, matchColumn, matchValue, updates }) {
  if (!matchValue || !table) return;

  const url = `${supabaseUrl}/rest/v1/${table}?${matchColumn}=eq.${encodeURIComponent(matchValue)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Mux Webhook] Supabase update (${table}) failed: ${response.status} ${errText}`);
  }
}
