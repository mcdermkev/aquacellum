/**
 * Vercel serverless function: /api/tank-cam-setup
 * 
 * Creates or deletes a Mux Live Stream for a user's Tank Cam.
 * 
 * POST /api/tank-cam-setup
 * Body: { walletAddress, tankId, tankName }
 * Returns: { camId, rtmpUrl, streamKey, playbackId, error? }
 * 
 * DELETE /api/tank-cam-setup
 * Body: { walletAddress, camId }
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

  // ── CREATE a new Tank Cam ──
  if (req.method === "POST") {
    const { walletAddress, tankId, tankName } = req.body || {};

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    try {
      // Create a Mux Live Stream
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
          // Reduced latency for Tank Cams
          latency_mode: "low",
          // Don't record by default (save storage costs)
          recording: false,
          // Passthrough for webhook correlation
          passthrough: JSON.stringify({ walletAddress, tankId, tankName }),
        }),
      });

      if (!muxResponse.ok) {
        const errBody = await muxResponse.text();
        console.error("[Tank Cam] Mux create live stream error:", muxResponse.status, errBody);
        return res.status(200).json({ error: `Mux API error (${muxResponse.status})` });
      }

      const muxData = await muxResponse.json();
      const stream = muxData.data;

      const rtmpUrl = "rtmp://global-live.mux.com/app";
      const streamKey = stream.stream_key;
      const playbackId = stream.playback_ids?.[0]?.id;
      const liveStreamId = stream.id;

      // Store in Supabase
      if (SUPABASE_URL && SUPABASE_KEY) {
        const insertBody = JSON.stringify({
          owner_wallet: walletAddress,
          tank_id: tankId || null,
          tank_name: tankName || null,
          mux_live_stream_id: liveStreamId,
          mux_playback_id: playbackId,
          stream_key: streamKey,
          status: "idle",
          visibility: "public",
        });

        const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/tank_cams`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "return=representation",
          },
          body: insertBody,
        });

        if (!supaRes.ok) {
          const errText = await supaRes.text();
          console.error("[Tank Cam] Supabase insert error:", errText);
        }

        const [insertedRow] = await supaRes.json().catch(() => [{}]);

        return res.status(200).json({
          camId: insertedRow?.id || liveStreamId,
          rtmpUrl,
          streamKey,
          playbackId,
          liveStreamId,
          error: null,
        });
      }

      return res.status(200).json({
        camId: liveStreamId,
        rtmpUrl,
        streamKey,
        playbackId,
        liveStreamId,
        error: null,
      });
    } catch (err) {
      console.error("[Tank Cam] Error:", err);
      return res.status(200).json({ error: err.message });
    }
  }

  // ── DELETE a Tank Cam ──
  if (req.method === "DELETE") {
    const { walletAddress, camId, liveStreamId } = req.body || {};

    if (!walletAddress || (!camId && !liveStreamId)) {
      return res.status(400).json({ error: "walletAddress and camId/liveStreamId required" });
    }

    try {
      // Get the Mux live stream ID from Supabase if we only have camId
      let muxStreamId = liveStreamId;

      if (!muxStreamId && SUPABASE_URL && SUPABASE_KEY) {
        const lookupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/tank_cams?id=eq.${camId}&owner_wallet=eq.${walletAddress}&select=mux_live_stream_id`,
          {
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
        const [row] = await lookupRes.json().catch(() => []);
        muxStreamId = row?.mux_live_stream_id;
      }

      // Delete from Mux
      if (muxStreamId) {
        await fetch(`https://api.mux.com/video/v1/live-streams/${muxStreamId}`, {
          method: "DELETE",
          headers: { Authorization: `Basic ${credentials}` },
        });
      }

      // Delete from Supabase
      if (SUPABASE_URL && SUPABASE_KEY && camId) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/tank_cams?id=eq.${camId}&owner_wallet=eq.${walletAddress}`,
          {
            method: "DELETE",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
      }

      return res.status(200).json({ success: true, error: null });
    } catch (err) {
      console.error("[Tank Cam] Delete error:", err);
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
