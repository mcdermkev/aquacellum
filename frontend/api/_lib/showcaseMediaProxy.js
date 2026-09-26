import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { setCorsHeaders } from "./cors.js";

const SHOWCASE_MEDIA_ASSET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHOWCASE_MEDIA_VARIANTS = new Set(["hero", "thumb"]);
const SHOWCASE_MEDIA_MAX_BYTES = 4 * 1024 * 1024;

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || "",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function setShowcaseMediaHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export async function handleShowcaseMedia(req, res) {
  setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
  setShowcaseMediaHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const assetId = typeof req.query.asset === "string" ? req.query.asset : "";
  const variant = typeof req.query.variant === "string" ? req.query.variant : "";
  if (!SHOWCASE_MEDIA_ASSET_RE.test(assetId) || !SHOWCASE_MEDIA_VARIANTS.has(variant)) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const { data: authorization, error: authError } = await supabase.rpc(
      "showcase_authorize_media_read",
      { p_asset_id: assetId, p_variant: variant }
    );
    if (authError) {
      console.error("[storefront/showcase-media] authorization", authError.code || "error");
      return res.status(500).json({ error: "internal_error" });
    }
    if (!authorization) return res.status(404).json({ error: "not_found" });

    const expectedSize = Number(authorization.byteSize);
    const expectedMime = authorization.mime;
    if (authorization.bucket !== "showcase-media-derivatives-v1"
        || expectedMime !== "image/webp"
        || !Number.isSafeInteger(expectedSize) || expectedSize < 1
        || expectedSize > SHOWCASE_MEDIA_MAX_BYTES
        || typeof authorization.objectKey !== "string"
        || !/^[0-9a-f]{64}$/.test(authorization.checksumHex || "")) {
      return res.status(500).json({ error: "internal_error" });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(authorization.bucket)
      .download(authorization.objectKey);
    if (downloadError || !blob) return res.status(404).json({ error: "not_found" });
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.length !== expectedSize || bytes.length > SHOWCASE_MEDIA_MAX_BYTES) {
      return res.status(404).json({ error: "not_found" });
    }
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== authorization.checksumHex) {
      return res.status(404).json({ error: "not_found" });
    }

    res.setHeader("Content-Type", expectedMime);
    res.setHeader("Content-Length", String(bytes.length));
    return res.status(200).send(bytes);
  } catch (error) {
    console.error("[storefront/showcase-media] error", error?.code || "error");
    return res.status(500).json({ error: "internal_error" });
  }
}
