import {
  downloadAuthorizedShowcaseMedia,
} from "./showcaseMediaBytes.js";
import { decodeVideoId } from "./showcaseIds.js";
import { createSignedMuxPlayback, isShowcaseMuxSigningConfigured } from "./showcaseMux.js";
import { getCuratedEntry } from "./showcaseCurated.js";
import { readCuratedVisibility } from "./curatedVisibility.js";

const SHOWCASE_MEDIA_ASSET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHOWCASE_MEDIA_VARIANTS = new Set(["hero", "thumb"]);

export function setShowcasePublicHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function createShowcaseRoomHandler({ supabase, setCorsHeaders, logger = console }) {
  return async function handleShowcaseRoom(req, res) {
    setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
    setShowcasePublicHeaders(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, OPTIONS");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const rawRoom = typeof req.query.room === "string" ? req.query.room.trim() : "";
    if (!rawRoom) return res.status(400).json({ error: "invalid_request" });
    const room = rawRoom.toLowerCase();
    const rawTank = typeof req.query.tank === "string" ? req.query.tank.trim() : "";
    const tank = rawTank ? rawTank.toLowerCase() : null;

    // Simple curated (operator-managed) showcase lane. Only consulted for the
    // room-level view and only when curation is enabled; otherwise the original
    // wallet/identity-published RPC path below is used unchanged.
    if (!tank) {
      const entry = getCuratedEntry(room);
      if (entry) {
        let isPublic = entry.defaultPublic;
        const override = await readCuratedVisibility(supabase, room);
        if (override && typeof override.isPublic === "boolean") isPublic = override.isPublic;
        if (!isPublic) return res.status(404).json({ error: "not_found" });
        return res.status(200).json({ room: entry.room });
      }
    }

    try {
      const { data, error } = await supabase.rpc("showcase_public_room", {
        normalized_room_slug: room,
        normalized_tank_slug: tank,
      });
      if (error) {
        logger.error("[storefront/showcase-room] rpc error:", error.code || "error");
        return res.status(500).json({ error: "internal_error" });
      }
      if (data == null) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(data);
    } catch (error) {
      logger.error("[storefront/showcase-room] error", error?.code || "error");
      return res.status(500).json({ error: "internal_error" });
    }
  };
}

export function createShowcaseMediaHandler({ supabase, setCorsHeaders, logger = console }) {
  return async function handleShowcaseMedia(req, res) {
    setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
    setShowcasePublicHeaders(res);
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
        logger.error("[storefront/showcase-media] authorization", authError.code || "error");
        return res.status(500).json({ error: "internal_error" });
      }
      if (!authorization) return res.status(404).json({ error: "not_found" });

      const downloaded = await downloadAuthorizedShowcaseMedia({
        supabase, authorization, assetId, variant,
      });
      if (!downloaded.ok) {
        return res.status(downloaded.code === "internal_error" ? 500 : 404)
          .json({ error: downloaded.code });
      }

      res.setHeader("Content-Type", downloaded.mime);
      res.setHeader("Content-Length", String(downloaded.bytes.length));
      return res.status(200).send(downloaded.bytes);
    } catch (error) {
      logger.error("[storefront/showcase-media] error", error?.code || "error");
      return res.status(500).json({ error: "internal_error" });
    }
  };
}

export function createShowcaseVideoTokenHandler({ supabase, logger = console }) {
  return async function handleShowcaseVideoToken(req, res) {
    setShowcasePublicHeaders(res);
    res.setHeader("Vary", "Origin");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const fetchSite = typeof req.headers["sec-fetch-site"] === "string"
      ? req.headers["sec-fetch-site"].toLowerCase() : "";
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return res.status(404).json({ error: "not_found" });
    }
    const room = typeof req.query.room === "string" ? req.query.room.trim().toLowerCase() : "";
    const videoId = typeof req.query.video === "string" ? req.query.video : "";
    const videoUuid = decodeVideoId(videoId);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(room) || !videoUuid) {
      return res.status(404).json({ error: "not_found" });
    }
    if (!isShowcaseMuxSigningConfigured()) return res.status(503).json({ error: "service_unavailable" });
    try {
      const { data: authorization, error } = await supabase.rpc(
        "showcase_authorize_public_video_playback",
        { p_room_slug: room, p_asset_id: videoUuid }
      );
      if (error) {
        logger.error("[storefront/showcase-video-token] authorization", error.code || "error");
        return res.status(500).json({ error: "internal_error" });
      }
      if (!authorization?.muxPlaybackId) return res.status(404).json({ error: "not_found" });
      const playback = await createSignedMuxPlayback({
        playbackId: authorization.muxPlaybackId, ttlSeconds: 60,
      });
      return res.status(200).json({ videoId, ...playback });
    } catch (error) {
      logger.error("[storefront/showcase-video-token] error", error?.code || "error");
      return res.status(503).json({ error: "service_unavailable" });
    }
  };
}
