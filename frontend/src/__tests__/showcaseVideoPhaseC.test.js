import { createHmac, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalMuxReadyFields,
  createSignedMuxPlayback,
  parseShowcaseMuxPassthrough,
  verifyMuxWebhookSignature,
} from "../../api/_lib/showcaseMux.js";
import { createShowcaseVideoTokenHandler } from "../../api/_lib/showcasePublicHandlers.js";
import { validateAction } from "../../api/_lib/showcaseValidation.js";

const VIDEO_ID = "video_11111111-1111-4111-8111-111111111111";
const VIDEO_UUID = VIDEO_ID.slice(6);
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function text(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function configureSigning() {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.SHOWCASE_VIDEO_ENABLED = "true";
  process.env.MUX_TOKEN_ID = "token-id";
  process.env.MUX_TOKEN_SECRET = "token-secret";
  process.env.MUX_SIGNING_KEY_ID = "signing-key-id";
  process.env.MUX_SIGNING_PRIVATE_KEY = privateKey;
}

describe("strict Mux webhook authentication", () => {
  it("authenticates exact raw bytes with constant-time-compatible hex and rejects a byte change", () => {
    const secret = "whsec-test";
    const raw = Buffer.from('{"id":"evt_1","value":"é"}', "utf8");
    const timestamp = 2_000_000_000;
    const signature = createHmac("sha256", secret).update(Buffer.from(`${timestamp}.`)).update(raw).digest("hex");
    expect(verifyMuxWebhookSignature({
      rawBody: raw, signatureHeader: `t=${timestamp},v1=${signature}`, secret, nowSeconds: timestamp,
    })).toMatchObject({ ok: true, timestamp });
    expect(verifyMuxWebhookSignature({
      rawBody: Buffer.from(raw.toString("utf8") + " "), signatureHeader: `t=${timestamp},v1=${signature}`,
      secret, nowSeconds: timestamp,
    })).toMatchObject({ ok: false, code: "MUX_SIGNATURE_INVALID" });
  });

  it.each([
    ["missing", undefined, 2_000_000_000, "MUX_SIGNATURE_MISSING"],
    ["malformed", "t=nope,v1=abcd", 2_000_000_000, "MUX_SIGNATURE_MALFORMED"],
    ["stale", `t=1999999699,v1=${"0".repeat(64)}`, 2_000_000_000, "MUX_SIGNATURE_EXPIRED"],
    ["future", `t=2000000301,v1=${"0".repeat(64)}`, 2_000_000_000, "MUX_SIGNATURE_EXPIRED"],
  ])("rejects %s signatures", (_name, signatureHeader, nowSeconds, code) => {
    expect(verifyMuxWebhookSignature({
      rawBody: Buffer.from("{}"), signatureHeader, secret: "secret", nowSeconds,
    })).toMatchObject({ ok: false, code });
  });
});

describe("signed-only playback", () => {
  it("issues RS256 video JWTs with an exp-iat ceiling of 60 seconds", async () => {
    configureSigning();
    const result = await createSignedMuxPlayback({ playbackId: "signed-playback", ttlSeconds: 60, nowSeconds: 1000 });
    const token = new URL(result.playbackUrl).searchParams.get("token");
    expect(new URL(result.playbackUrl).origin).toBe("https://stream.mux.com");
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "RS256", kid: "signing-key-id" });
    expect(decodeJwt(token)).toMatchObject({ sub: "signed-playback", aud: "v", iat: 1000, exp: 1060 });
    expect(result.expiresAt - result.issuedAt).toBeLessThanOrEqual(60);
  });

  it("accepts exactly one signed provider playback and rejects public policy", () => {
    const base = {
      id: "asset-1", status: "ready", duration: 12.5,
      tracks: [{ type: "video", max_width: 1920, max_height: 1080 }],
    };
    expect(canonicalMuxReadyFields({ ...base, playback_ids: [{ id: "playback-1", policy: "signed" }] }, { codec: "h264" }))
      .toMatchObject({ playbackId: "playback-1", playbackPolicy: "signed", width: 1920, height: 1080 });
    expect(canonicalMuxReadyFields({ ...base, playback_ids: [{ id: "playback-1", policy: "public" }] }, { codec: "h264" }))
      .toBeNull();
  });

  it("requires exact internal UUID, random correlation, codec, and schema passthrough", () => {
    const passthrough = JSON.stringify({
      codec: "h264", correlation: "a".repeat(64), schema: "showcase-video-v1", videoId: VIDEO_UUID,
    });
    expect(parseShowcaseMuxPassthrough("video.asset.ready", { passthrough })).toEqual({
      codec: "h264", correlation: "a".repeat(64), videoId: VIDEO_UUID,
    });
    expect(parseShowcaseMuxPassthrough("video.asset.ready", {
      passthrough: JSON.stringify({ codec: "h264", correlation: "a".repeat(64), schema: "showcase-video-v1",
        videoId: VIDEO_UUID, walletAddress: "spoof" }),
    })).toBeNull();
  });
});

describe("owner and public authorization shapes", () => {
  it("validates typed video IDs and rejects raw UUIDs, unknown fields, and invalid gallery order", () => {
    expect(validateAction("video-finalize", {
      roomId: VIDEO_UUID, videoId: VIDEO_ID, uploadIntentId: "22222222-2222-4222-8222-222222222222",
    }).ok).toBe(true);
    expect(validateAction("video-finalize", {
      roomId: VIDEO_UUID, videoId: VIDEO_UUID, uploadIntentId: "22222222-2222-4222-8222-222222222222",
    })).toMatchObject({ ok: false, code: "invalid_entity_id" });
    expect(validateAction("video-put", {
      roomId: VIDEO_UUID, videoId: VIDEO_ID, expectedRevision: null, title: "Clip", caption: null,
      altText: "Fish swimming.", displayOrder: 20, visibility: "public",
    })).toMatchObject({ ok: false, code: "invalid_field" });
  });

  it("reauthorizes a public token request and returns no provider identifier", async () => {
    configureSigning();
    const rpc = vi.fn().mockResolvedValue({ data: { muxPlaybackId: "provider-secret-id" }, error: null });
    const handler = createShowcaseVideoTokenHandler({ supabase: { rpc }, logger: { error: vi.fn() } });
    const res = response();
    await handler({
      method: "GET", headers: { "sec-fetch-site": "same-origin" },
      query: { room: "steve", video: VIDEO_ID },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.videoId).toBe(VIDEO_ID);
    expect(res.body).not.toHaveProperty("muxPlaybackId");
    expect(Object.keys(res.body).sort()).toEqual(["expiresAt", "issuedAt", "playbackUrl", "videoId"]);
    expect(new URL(res.body.playbackUrl).origin).toBe("https://stream.mux.com");
    expect(res.body.expiresAt - res.body.issuedAt).toBeLessThanOrEqual(60);
    expect(rpc).toHaveBeenCalledWith("showcase_authorize_public_video_playback", {
      p_room_slug: "steve", p_asset_id: VIDEO_UUID,
    });
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("denies cross-site token fetches before database authorization", async () => {
    const rpc = vi.fn();
    const handler = createShowcaseVideoTokenHandler({ supabase: { rpc } });
    const res = response();
    await handler({ method: "GET", headers: { "sec-fetch-site": "cross-site" },
      query: { room: "steve", video: VIDEO_ID } }, res);
    expect(res.statusCode).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Phase C static state-machine gates", () => {
  const sql = text("../../../supabase/migrations/20260908190000_showcase_room_video_gallery.sql");
  const muxRoute = text("../../api/mux.js");
  const worker = text("../../../services/showcase-media-worker/video.mjs");
  const showcaseHtml = text("../../showcase.html");
  const serviceWorker = text("../sw.js");
  const vercel = JSON.parse(text("../../vercel.json"));

  it("persists replay conflicts instead of raising them away and counts same-hash duplicates", () => {
    const apply = sql.slice(sql.indexOf("CREATE FUNCTION public.showcase_apply_mux_event"),
      sql.indexOf("CREATE FUNCTION public.showcase_sweep_video_maintenance"));
    expect(apply).toContain("duplicate_count=duplicate_count+1");
    expect(apply).toContain("RETURN jsonb_build_object('result','conflict'");
    expect(apply).not.toContain("RAISE EXCEPTION 'SHOWCASE_MUX_REPLAY_CONFLICT'");
    expect(apply.indexOf("showcase_acquire_publication_owner_lock(candidate_owner)"))
      .toBeLessThan(apply.indexOf("correlation_token=p_correlation FOR UPDATE"));
  });

  it("makes terminal states deny-first and rearms provider deletion without ready resurrection", () => {
    expect(sql).toContain("state IN ('errored','revoked','deleting','deleted','rejected')");
    expect(sql).toContain("'delete_mux_asset',true");
    expect(sql).toContain("WHERE id=asset_row.id AND state='processing'");
    expect(sql).toContain("SHOWCASE_VIDEO_IDENTITY_IMMUTABLE");
  });

  it("creates showcase provider uploads with signed policy and never replays an ambiguous PUT", () => {
    expect(worker).toContain('playback_policy: ["signed"]');
    expect(worker).not.toContain('playback_policy: ["public"]');
    expect(worker).toContain('throw permanent("MUX_UPLOAD_AMBIGUOUS")');
    expect(worker.match(/body: createReadStream\(filePath\)/g)).toHaveLength(1);
    expect(worker.indexOf('rpc("showcase_bind_video_mux_upload"')).toBeLessThan(worker.indexOf("await uploadFile("));
  });

  it("derives generic upload authority from Privy and verifies raw webhook bytes before parsing", () => {
    expect(muxRoute).toContain("verifyPrivyToken(req)");
    expect(muxRoute).not.toMatch(/const\s*\{\s*walletAddress\s*\}\s*=\s*req\.body/);
    expect(muxRoute.indexOf("verifyMuxSignature({")).toBeLessThan(muxRoute.indexOf("event = parseJsonBytes(raw)"));
    expect(muxRoute).toContain("bodyParser: false");
  });

  it("keeps the public DTO opaque and signed token traffic network-only under Mux CSP", () => {
    const gallery = sql.slice(sql.indexOf("CREATE FUNCTION public.showcase_room_video_gallery_json"),
      sql.indexOf("ALTER FUNCTION public.showcase_render_room_projection"));
    expect(gallery).not.toMatch(/mux_(?:upload|asset|playback)_id/);
    expect(showcaseHtml).toContain("showcase-video-token");
    expect(showcaseHtml).not.toMatch(/item\.(?:muxUploadId|muxAssetId|muxPlaybackId)/);
    expect(serviceWorker).toContain('url.searchParams.get("action") === "showcase-video-token"');
    const csp = vercel.headers[0].headers.find((header) => header.key === "Content-Security-Policy").value;
    expect(csp).toContain("https://stream.mux.com");
  });
});
