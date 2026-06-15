/**
 * Vercel serverless function: /api/video-upload
 * 
 * Creates a Mux Direct Upload URL for client-side video upload.
 * The client PUTs the video file directly to Mux (no server relay needed).
 * 
 * POST /api/video-upload
 * Body: { walletAddress: string }
 * Returns: { uploadUrl: string, uploadId: string, error?: string }
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { walletAddress } = req.body || {};

  if (!walletAddress) {
    return res.status(400).json({ uploadUrl: null, uploadId: null, error: "walletAddress is required" });
  }

  const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
  const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;

  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
    return res.status(200).json({
      uploadUrl: null,
      uploadId: null,
      error: "Video upload not configured (Mux credentials missing)",
    });
  }

  try {
    // Create a Mux Direct Upload via their REST API
    // This avoids needing the @mux/mux-node SDK as a dependency in serverless
    const credentials = Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString("base64");

    const corsOrigin = process.env.FRONTEND_ORIGIN || "https://aquadex.io";

    const muxResponse = await fetch("https://api.mux.com/video/v1/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        new_asset_settings: {
          playback_policy: ["public"],
          encoding_tier: "baseline",
          // Store wallet address as passthrough for webhook correlation
          passthrough: JSON.stringify({ walletAddress }),
        },
        cors_origin: corsOrigin,
        // 10 minute timeout for slow connections
        timeout: 600,
      }),
    });

    if (!muxResponse.ok) {
      const errBody = await muxResponse.text();
      console.error("[Video Upload] Mux API error:", muxResponse.status, errBody);
      return res.status(200).json({
        uploadUrl: null,
        uploadId: null,
        error: `Mux upload creation failed (${muxResponse.status})`,
      });
    }

    const muxData = await muxResponse.json();
    const upload = muxData.data;

    return res.status(200).json({
      uploadUrl: upload.url,
      uploadId: upload.id,
      error: null,
    });
  } catch (err) {
    console.error("[Video Upload] Error:", err);
    return res.status(200).json({
      uploadUrl: null,
      uploadId: null,
      error: err.message,
    });
  }
}
