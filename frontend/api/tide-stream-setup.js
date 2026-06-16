/**
 * Vercel serverless function: /api/tide-stream-setup
 * 
 * Creates or manages a Mux Live Stream for a Virtual Tide event.
 * Records the stream for post-event VOD playback.
 * 
 * POST /api/tide-stream-setup
 * Body: { walletAddress, tideId }
 * Returns: { streamId, rtmpUrl, streamKey, playbackId, error? }
 * 
 * DELETE /api/tide-stream-setup
 * Body: { walletAddress, tideId, streamId }
 * Returns: { success, error? }
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
  const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
    return res.status(200).json({ error: "Mux not configured" });
  }

  const credentials = Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString("base64");

  // ── CREATE a Tide Stream ──
  if (req.method === "POST") {
    const { walletAddress, tideId } = req.body || {};

    if (!walletAddress || !tideId) {
      return res.status(400).json({ error: "walletAddress and tideId required" });
    }

    try {
      // Create a Mux Live Stream with recording enabled (for VOD recap)
      const muxResponse = await fetch("https://api.mux.com/video/v1/live-streams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({
          playback_policy: ["public"],
          new_asset_settings: {
            playback_policy: ["public"],
          },
          latency_mode: "low",
          // Record the stream for post-event VOD
          recording: true,
          passthrough: JSON.stringify({ walletAddress, tideId }),
        }),
      });

      if (!muxResponse.ok) {
        const errBody = await muxResponse.text();
        console.error("[Tide Stream] Mux error:", muxResponse.status, errBody);
        return res.status(200).json({ error: `Mux API error (${muxResponse.status})` });
      }

      const muxData = await muxResponse.json();
      const stream = muxData.data;

      const rtmpUrl = "rtmp://global-live.mux.com/app";
      const streamKey = stream.stream_key;
      const playbackId = stream.playback_ids?.[0]?.id;
      const liveStreamId = stream.id;

      // Store in Supabase tide_streams table
      if (SUPABASE_URL && SUPABASE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/tide_streams`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            tide_id: tideId,
            host_wallet: walletAddress,
            mux_live_stream_id: liveStreamId,
            mux_playback_id: playbackId,
            stream_key: streamKey,
            status: "idle",
          }),
        });
      }

      return res.status(200).json({
        streamId: liveStreamId,
        rtmpUrl,
        streamKey,
        playbackId,
        error: null,
      });
    } catch (err) {
      console.error("[Tide Stream] Error:", err);
      return res.status(200).json({ error: err.message });
    }
  }

  // ── DELETE / End a Tide Stream ──
  if (req.method === "DELETE") {
    const { walletAddress, tideId, streamId } = req.body || {};

    if (!walletAddress || !tideId) {
      return res.status(400).json({ error: "walletAddress and tideId required" });
    }

    try {
      // Signal Mux to stop the stream (marks it complete)
      if (streamId) {
        await fetch(`https://api.mux.com/video/v1/live-streams/${streamId}/complete`, {
          method: "PUT",
          headers: { Authorization: `Basic ${credentials}` },
        });
      }

      // Update tide_streams status
      if (SUPABASE_URL && SUPABASE_KEY) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/tide_streams?tide_id=eq.${tideId}&host_wallet=eq.${walletAddress}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ status: "ended" }),
          }
        );
      }

      return res.status(200).json({ success: true, error: null });
    } catch (err) {
      console.error("[Tide Stream] End error:", err);
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
