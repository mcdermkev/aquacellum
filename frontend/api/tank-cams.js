/**
 * Vercel serverless function: /api/tank-cams
 * 
 * Lists active Tank Cams for the discovery feed.
 * Returns cams sorted by viewer count, includes owner profile info.
 * 
 * GET /api/tank-cams
 * Query params: ?status=active&limit=20
 * Returns: { data: [...], error? }
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ data: [], error: "Not configured" });
  }

  const status = req.query?.status || "active";
  const limit = Math.min(parseInt(req.query?.limit) || 20, 50);

  try {
    // Fetch tank cams with owner profile joined
    const url = new URL(`${SUPABASE_URL}/rest/v1/tank_cams`);
    url.searchParams.set("status", `eq.${status}`);
    url.searchParams.set("visibility", "eq.public");
    url.searchParams.set("select", "*, profiles:owner_wallet(wallet_address,display_name,avatar_url,companion_tier)");
    url.searchParams.set("order", "viewer_count.desc,last_active_at.desc");
    url.searchParams.set("limit", limit.toString());

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Tank Cams] Supabase query error:", errText);
      return res.status(200).json({ data: [], error: "Query failed" });
    }

    const data = await response.json();

    // Strip stream_key from response (it's a secret)
    const sanitized = (data || []).map(({ stream_key, ...cam }) => cam);

    return res.status(200).json({ data: sanitized, error: null });
  } catch (err) {
    console.error("[Tank Cams] Error:", err);
    return res.status(200).json({ data: [], error: err.message });
  }
}
