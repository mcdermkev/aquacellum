/**
 * check-slug.js — Vercel Serverless Function
 *
 * GET /api/storefront/check-slug?slug={slug}
 *
 * Checks if a storefront slug is available. Used by the setup form
 * for real-time validation as the user types.
 *
 * Returns: { available: boolean, slug: string }
 */

import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders } from "../_lib/cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const slug = (req.query.slug || "").toLowerCase().trim();

  if (!slug) {
    return res.status(400).json({ error: "Missing slug parameter." });
  }

  try {
    const { data, error } = await supabase
      .from("breeder_profiles")
      .select("wallet_address")
      .eq("slug", slug)
      .single();

    // If no row found, slug is available
    const available = !data && (error?.code === "PGRST116" || !data);

    return res.status(200).json({ available, slug });
  } catch (err) {
    // On error, assume available (server will validate on submit)
    return res.status(200).json({ available: true, slug });
  }
}
