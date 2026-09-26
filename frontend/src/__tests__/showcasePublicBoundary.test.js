import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  createShowcaseMediaHandler,
  createShowcaseRoomHandler,
} from "../../api/_lib/showcasePublicHandlers.js";
import {
  canonicalProductPath,
  heroProxyPath,
  matchingShowcasePath,
  matchingStorePath,
  roomSlugFromPath,
  safePublicImageUrl,
} from "../services/showcasePublic.js";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function expectNoStore(res) {
  expect(res.headers).toMatchObject(NO_STORE_HEADERS);
}

function roomHandler(rpc) {
  return createShowcaseRoomHandler({
    supabase: { rpc },
    setCorsHeaders: vi.fn(),
    logger: { error: vi.fn() },
  });
}

async function call(handler, { method = "GET", query = {} } = {}) {
  const res = mockRes();
  await handler({ method, query, headers: {} }, res);
  return res;
}

describe("anonymous showcase room handler", () => {
  it.each([
    ["OPTIONS", {}, 204, undefined],
    ["POST", { room: "steve" }, 405, { error: "method_not_allowed" }],
    ["GET", {}, 400, { error: "invalid_request" }],
  ])("keeps %s response non-cacheable", async (method, query, status, body) => {
    const rpc = vi.fn();
    const res = await call(roomHandler(rpc), { method, query });
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual(body);
    expectNoStore(res);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns one identical non-enumerating 404 for every null projection", async () => {
    for (const hiddenState of ["missing", "private", "identity-conflict"]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: null, hiddenState });
      const res = await call(roomHandler(rpc), { query: { room: "GGSteveRiceFishNJ", tank: "Tub-One" } });
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "not_found" });
      expectNoStore(res);
      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith("showcase_public_room", {
        normalized_room_slug: "ggstevericefishnj",
        normalized_tank_slug: "tub-one",
      });
    }
  });

  it("returns only the RPC projection and keeps success non-cacheable", async () => {
    const projection = { schemaVersion: 1, room: { slug: "steve", tanks: [] } };
    const rpc = vi.fn().mockResolvedValue({ data: projection, error: null });
    const res = await call(roomHandler(rpc), { query: { room: "steve" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(projection);
    expectNoStore(res);
    expect(rpc).toHaveBeenCalledWith("showcase_public_room", {
      normalized_room_slug: "steve",
      normalized_tank_slug: null,
    });
  });

  it("fails closed on RPC failure without leaking upstream errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "secret" } });
    const res = await call(roomHandler(rpc), { query: { room: "steve" } });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expectNoStore(res);
  });
});

function mediaHandler({ rpc, download }) {
  return createShowcaseMediaHandler({
    supabase: {
      rpc,
      storage: { from: vi.fn(() => ({ download })) },
    },
    setCorsHeaders: vi.fn(),
    logger: { error: vi.fn() },
  });
}

function mediaAuthorization(bytes, overrides = {}) {
  return {
    bucket: "showcase-media-derivatives-v1",
    objectKey: `owners/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/assets/${ASSET_ID}/versions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/hero.webp`,
    mime: "image/webp",
    byteSize: bytes.length,
    checksumHex: createHash("sha256").update(bytes).digest("hex"),
    ...overrides,
  };
}

describe("revocable showcase media proxy", () => {
  it("rejects malformed asset IDs before authorization and never caches the response", async () => {
    const rpc = vi.fn();
    const download = vi.fn();
    const res = await call(mediaHandler({ rpc, download }), {
      query: { asset: "not-a-uuid", variant: "hero" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expectNoStore(res);
    expect(rpc).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("reauthorizes every request and removes bytes immediately after revoke/private rollback", async () => {
    const bytes = Buffer.from("verified-webp-bytes");
    const authorization = mediaAuthorization(bytes);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: authorization, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const download = vi.fn().mockResolvedValue({ data: new Blob([bytes]), error: null });
    const handler = mediaHandler({ rpc, download });
    const request = { query: { asset: ASSET_ID, variant: "hero" } };

    const published = await call(handler, request);
    expect(published.statusCode).toBe(200);
    expect(Buffer.from(published.body)).toEqual(bytes);
    expect(published.headers["content-type"]).toBe("image/webp");
    expectNoStore(published);

    const revoked = await call(handler, request);
    expect(revoked.statusCode).toBe(404);
    expect(revoked.body).toEqual({ error: "not_found" });
    expectNoStore(revoked);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledOnce();
  });

  it.each([
    ["bucket", { bucket: "public-bucket" }, 500],
    ["mime", { mime: "text/html" }, 500],
    ["size", { byteSize: 999 }, 404],
    ["checksum", { checksumHex: "0".repeat(64) }, 404],
  ])("fails closed on %s mismatch", async (_name, overrides, status) => {
    const bytes = Buffer.from("verified-webp-bytes");
    const rpc = vi.fn().mockResolvedValue({ data: mediaAuthorization(bytes, overrides), error: null });
    const download = vi.fn().mockResolvedValue({ data: new Blob([bytes]), error: null });
    const res = await call(mediaHandler({ rpc, download }), {
      query: { asset: ASSET_ID, variant: "hero" },
    });
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error: status === 500 ? "internal_error" : "not_found" });
    expectNoStore(res);
  });
});

function text(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function sqlCode(source) {
  return source.replace(/^\s*--.*$/gm, "").replace(/\s--.*$/gm, "");
}

const SHOWCASE_HTML = text("../../showcase.html");
const STORE_HTML = text("../../store.html");
const MARKETPLACE_HTML = text("../../marketplace.html");
const LAUNCH_MANIFEST = JSON.parse(text("../../ops/STEVE_SHOWCASE_STORE_LAUNCH_MANIFEST.json"));
const VERCEL = JSON.parse(text("../../vercel.json"));
const VITE = text("../../vite.config.js");
const SERVICE_WORKER = text("../sw.js");
const COMMERCE_SQL = sqlCode(text("../../../supabase/migrations/20260830130000_showcase_r14_commerce_seam.sql"));
const PHOTO_SQL = sqlCode(text("../../../supabase/migrations/20260830150000_showcase_commerce_photo.sql"));
const MEDIA_SQL = sqlCode(text("../../../supabase/migrations/20260830160000_showcase_media_pipeline.sql"));
const MIGRATION_ORDER = JSON.parse(text("../../../supabase/migration-order.json")).order;

describe("public page and routing trust boundaries", () => {
  it("renders projected copy through text nodes and never HTML injection sinks", () => {
    expect(SHOWCASE_HTML).toContain("node.textContent = String(text)");
    expect(SHOWCASE_HTML).toContain("description.textContent = room.description");
    expect(SHOWCASE_HTML).not.toMatch(/\.innerHTML\s*=/);
  });

  it("constructs heroes only through the local authorization proxy", () => {
    expect(heroProxyPath(ASSET_ID)).toBe(`/api/showcase-media/${ASSET_ID}/hero`);
    expect(heroProxyPath("not-a-uuid")).toBe("");
    // Hero is either a curated same-origin/HTTPS image (guarded by safePublicImageUrl)
    // or the authorization proxy for an assetId. Never a raw bucket/object/signed URL.
    expect(SHOWCASE_HTML).toContain("heroProxyPath(hero?.assetId)");
    expect(SHOWCASE_HTML).toContain("safePublicImageUrl(hero?.image, window.location.origin)");
    expect(SHOWCASE_HTML).not.toMatch(/hero\.(?:bucket|objectKey|signedUrl|url)/);
  });

  it("drops unsafe image URLs and accepts same-origin or HTTPS images only", () => {
    const origin = "https://aquacellum.com";
    expect(safePublicImageUrl("/morphs/steve/shinkai.jpg", origin)).toBe(
      "https://aquacellum.com/morphs/steve/shinkai.jpg"
    );
    expect(safePublicImageUrl("https://cdn.example/fish.jpg", origin)).toBe("https://cdn.example/fish.jpg");
    for (const unsafe of ["http://cdn.example/fish.jpg", "javascript:alert(1)", "data:text/html,x", "http://[::1"] ) {
      expect(safePublicImageUrl(unsafe, origin)).toBe("");
    }
    expect(SHOWCASE_HTML).toContain("safePublicImageUrl(tank.photo || tank.commerce?.photoUrl, window.location.origin)");
  });

  it("creates CTAs only for canonical positive listing product paths", () => {
    expect(canonicalProductPath("/app/products/single-1")).toBe("/app/products/single-1");
    expect(canonicalProductPath("/app/products/batch-90210")).toBe("/app/products/batch-90210");
    for (const unsafe of [
      "/app/products/single-0", "/app/products/batch--1", "/app/products/single-1/checkout",
      "https://evil.example/app/products/single-1", "javascript:alert(1)", null,
    ]) {
      expect(canonicalProductPath(unsafe)).toBe("");
    }
    expect(SHOWCASE_HTML).toContain("const buyPath = canonicalProductPath(commerce.buyPath)");
  });

  it("requires exact returned slugs before adding either cross-link", () => {
    const store = { breeder: { slug: "steve" } };
    const room = { room: { slug: "steve" } };
    expect(matchingStorePath(store, "steve")).toBe("/store/steve");
    expect(matchingStorePath(store, "other")).toBe("");
    expect(matchingShowcasePath(room, "steve")).toBe("/showcase/steve");
    expect(matchingShowcasePath(room, "other")).toBe("");
    expect(SHOWCASE_HTML).toContain("matchingStorePath(payload, roomSlug)");
    expect(STORE_HTML).toContain("matchingShowcasePath(payload, slug)");
  });

  it("accepts exactly one decoded showcase slug path segment", () => {
    expect(roomSlugFromPath("/showcase/steve")).toBe("steve");
    expect(roomSlugFromPath("/showcase/steve%20rice/")).toBe("steve rice");
    expect(roomSlugFromPath("/showcase/steve/private")).toBeNull();
    expect(roomSlugFromPath("/store/steve")).toBeNull();
  });

  it("keeps local and production route wiring aligned", () => {
    expect(VERCEL.rewrites).toContainEqual({ source: "/showcase/:path*", destination: "/showcase.html" });
    expect(VERCEL.rewrites).toContainEqual({
      source: "/api/showcase-media/:assetId/:variant",
      destination: "/api/storefront-detail?action=showcase-media&asset=:assetId&variant=:variant",
    });
    expect(VITE).toContain("req.url.startsWith('/showcase/')");
    expect(VITE).toContain("showcase: resolve(__dirname, 'showcase.html')");
  });

  it("forces revocable showcase media network-only before generic image caching", () => {
    const mediaRule = SERVICE_WORKER.indexOf('url.pathname.startsWith("/api/showcase-media/")');
    const imageRule = SERVICE_WORKER.indexOf('request.destination === "image"');
    expect(mediaRule).toBeGreaterThan(-1);
    expect(imageRule).toBeGreaterThan(mediaRule);
    expect(SERVICE_WORKER.slice(mediaRule, imageRule)).toContain("new NetworkOnly()");
  });
});

describe("Steve launch data stays fail-closed", () => {
  it("keeps marketplace discovery generic instead of fabricating Steve inventory", () => {
    expect(MARKETPLACE_HTML).toContain("/api/storefront-detail?action=discover&limit=12");
    expect(MARKETPLACE_HTML).toContain("is_active=eq.true");
    expect(MARKETPLACE_HTML).not.toContain("ggstevericefishnj");
    expect(MARKETPLACE_HTML).not.toContain("0x41e562ee88825ad8d79b48311a30742ac276c9eb");
  });

  it("records media candidates without marking product or publication readiness", () => {
    expect(LAUNCH_MANIFEST.status).toBe("awaiting-authenticated-owner-checkpoint");
    expect(LAUNCH_MANIFEST.offerings).toHaveLength(7);
    for (const offer of LAUNCH_MANIFEST.offerings) {
      expect(offer.productPhoto).toBeNull();
      expect(offer.listingKey).toBeNull();
      expect(offer.availablePackCount).toBeNull();
      expect(offer.readyToPublish).toBe(false);
    }
    expect(LAUNCH_MANIFEST.mediaInventory).toMatchObject({
      jpegCount: 62,
      mp4Count: 17,
      confirmedReferenceAssetsAreProductPhotos: false,
    });
    expect(LAUNCH_MANIFEST.mediaInventory.videoPublicationStatus).toContain("deferred");
    expect(LAUNCH_MANIFEST.showcase.hero.sourceFile).toBeNull();
    expect(LAUNCH_MANIFEST.showcase.hero.publicationPermissionConfirmed).toBe(false);
  });

  it("leaves every authenticated publication gate false", () => {
    expect(Object.values(LAUNCH_MANIFEST.publicationChecklist)).toEqual(
      Array(Object.keys(LAUNCH_MANIFEST.publicationChecklist).length).fill(false)
    );
    expect(LAUNCH_MANIFEST.store.walletOwnershipConfirmed).toBe(false);
    expect(LAUNCH_MANIFEST.store.payoutReadinessConfirmed).toBe(false);
    expect(LAUNCH_MANIFEST.showcase.existingLifetimeRoomChecked).toBe(false);
  });
});

describe("commerce ownership, revocation, and migration-chain contracts", () => {
  it("requires a private owner room and placement CAS before linking commerce", () => {
    expect(COMMERCE_SQL).toMatch(/WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE/);
    expect(COMMERCE_SQL).toContain("room_vis <> 'private'");
    expect(COMMERCE_SQL).toMatch(/room_id = p_room_id AND tank_key = p_tank_key AND owner_id = p_owner_id[\s\S]*revision = p_expected_revision/);
  });

  it("enforces active listing plus non-revoked verified owner wallet at write and read time", () => {
    expect((COMMERCE_SQL.match(/l\.is_active = true/g) || [])).toHaveLength(2);
    expect((COMMERCE_SQL.match(/w\.owner_id = p_owner_id/g) || [])).toHaveLength(2);
    expect((COMMERCE_SQL.match(/w\.revoked_at IS NULL/g) || [])).toHaveLength(2);
    expect((COMMERCE_SQL.match(/w\.normalized_wallet_address = lower\(l\.seller_address\)/g) || [])).toHaveLength(2);
    expect(COMMERCE_SQL).toContain("SHOWCASE_COMMERCE_LISTING_UNAVAILABLE");
  });

  it("keeps the resolver internal and exposes only the owner setter to service_role", () => {
    expect(COMMERCE_SQL).toMatch(/REVOKE ALL ON FUNCTION public\.showcase_resolve_tank_commerce[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
    expect(COMMERCE_SQL).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.showcase_resolve_tank_commerce/);
    expect(COMMERCE_SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.showcase_set_room_tank_commerce[\s\S]*TO service_role/);
  });

  it("allows only bounded HTTP(S) listing photos and canonical server-built buy paths", () => {
    expect(PHOTO_SQL).toContain("char_length(data_obj->>'photoUrl') BETWEEN 8 AND 2048");
    expect(PHOTO_SQL).toContain("~* '^https?://'");
    expect(PHOTO_SQL).toContain("!~ '[[:space:]]'");
    expect(PHOTO_SQL).toContain("'buyPath', '/app/products/' || p_listing_key");
  });

  it("authorizes hero bytes only while attachment and room are published", () => {
    expect(MEDIA_SQL).toContain("ma.state = 'published'");
    expect(MEDIA_SQL).toContain("r.visibility IN ('unlisted','public')");
    expect(MEDIA_SQL).toContain("CREATE FUNCTION public.showcase_revoke_media_asset");
    expect(MEDIA_SQL).toMatch(/SET state = 'revoked', revoked_at = clock_timestamp\(\)/);
  });

  it("applies commerce, photo projection, then media wrapper in fresh-install order", () => {
    const commerce = MIGRATION_ORDER.indexOf("supabase/migrations/20260830130000_showcase_r14_commerce_seam.sql");
    const photo = MIGRATION_ORDER.indexOf("supabase/migrations/20260830150000_showcase_commerce_photo.sql");
    const media = MIGRATION_ORDER.indexOf("supabase/migrations/20260830160000_showcase_media_pipeline.sql");
    expect(commerce).toBeGreaterThan(-1);
    expect(photo).toBeGreaterThan(commerce);
    expect(media).toBeGreaterThan(photo);
    expect(MEDIA_SQL).toContain("RENAME TO showcase_public_room_without_media_r1");
    expect(MEDIA_SQL).toContain("showcase_public_room_without_media_r1(normalized_room_slug, normalized_tank_slug)");
  });
});
