import "fake-indexeddb/auto";
import Dexie from "dexie";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256HexOfCanonical } from "../../api/_lib/showcaseManifest.js";
import { validateAction } from "../../api/_lib/showcaseValidation.js";
import { db } from "../db";
import {
  bindShowcaseDatasetEnrollment,
  getShowcaseDatasetState,
  jcsCanonicalize,
  prepareShowcaseDatasetV3,
  sha256Canonical,
} from "../services/showcaseDatasetV3";
import {
  bootstrapShowcaseOwner,
  previewShowcaseMedia,
  readShowcaseRoom,
  setSessionTokenGetter,
} from "../services/showcaseOwnerApi";

const OWNER = "0x41e562ee88825ad8d79b48311a30742ac276c9eb";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const TANK_A = "tank_22222222-2222-4222-8222-222222222222";
const TANK_B = "tank_33333333-3333-4333-8333-333333333333";

beforeEach(async () => {
  setSessionTokenGetter(null);
  vi.restoreAllMocks();
  db.close();
  await Dexie.delete("AquadexDB");
});

afterEach(async () => {
  setSessionTokenGetter(null);
  vi.unstubAllGlobals();
  db.close();
  await Dexie.delete("AquadexDB");
});

describe("Phase A restricted JCS parity", () => {
  it("produces the same canonical bytes and SHA-256 as the server helper", async () => {
    const vector = {
      b: 2,
      a: 1,
      nested: { z: true, y: ["medaka", 7, null] },
    };
    expect(jcsCanonicalize(vector)).toBe('{"a":1,"b":2,"nested":{"y":["medaka",7,null],"z":true}}');
    expect(await sha256Canonical(vector)).toBe(sha256HexOfCanonical(vector));
  });

  it("fails closed for fractional numbers and invalid Unicode in values or keys", () => {
    expect(() => jcsCanonicalize({ value: 1.5 })).toThrow();
    expect(() => jcsCanonicalize({ value: "\ud800" })).toThrow();
    expect(() => jcsCanonicalize({ ["\ud800"]: 1 })).toThrow();
  });
});

describe("Phase A durable owner identity", () => {
  it("keeps v26 owner mappings stable and builds exactly seven schema-v3 tanks", async () => {
    await db.open();
    expect(db.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      "showcaseDatasetState",
      "showcaseEntityMappings",
    ]));

    const ids = Array.from({ length: 7 }, (_, index) => index + 1);
    await db.tanks.bulkAdd(ids.map((id) => ({
      id,
      ownerAddress: OWNER,
      name: `Steve Tank ${id}`,
      active: true,
      tankType: 0,
      volumeLiters: 75,
      creationTimestamp: 1_700_000_000 + id,
    })));
    await db.tanks.add({
      id: 99,
      ownerAddress: "0x2222222222222222222222222222222222222222",
      name: "Other owner tank",
      active: true,
    });

    const first = await prepareShowcaseDatasetV3({ ownerAddress: OWNER.toUpperCase().replace("0X", "0x"), selectedTankIds: ids });
    const firstMappings = await db.showcaseEntityMappings.where("ownerAddress").equals(OWNER).toArray();
    expect(firstMappings).toHaveLength(7);
    expect(new Set(firstMappings.map((row) => row.entityKey)).size).toBe(7);

    const packaged = await bindShowcaseDatasetEnrollment(OWNER, {
      datasetId: first.state.datasetId,
      enrollmentReference: "enroll:v1:steve-test",
      status: "enrolled",
    });
    expect(packaged.identityPackage.schemaVersion).toBe(3);
    expect(packaged.identityPackage.identity.tanks).toHaveLength(7);
    expect(packaged.identityPackage.identity.aliases).toHaveLength(7);
    expect(packaged.identityPackage.identity.specimens).toEqual([]);

    await prepareShowcaseDatasetV3({ ownerAddress: OWNER, selectedTankIds: ids });
    const secondMappings = await db.showcaseEntityMappings.where("ownerAddress").equals(OWNER).toArray();
    expect(secondMappings).toEqual(firstMappings);
    expect((await getShowcaseDatasetState(OWNER)).datasetId).toBe(first.state.datasetId);
  });

  it("rejects a different selection after durable identity has been created", async () => {
    await db.open();
    await db.tanks.bulkAdd([1, 2].map((id) => ({ id, ownerAddress: OWNER, name: `Tank ${id}`, active: true })));
    await prepareShowcaseDatasetV3({ ownerAddress: OWNER, selectedTankIds: [1] });
    await expect(prepareShowcaseDatasetV3({ ownerAddress: OWNER, selectedTankIds: [2] }))
      .rejects.toMatchObject({ code: "dataset_selection_locked" });
  });
});

describe("Phase A authenticated owner transport", () => {
  it("gets a fresh token for each request and keeps the action in the query", async () => {
    let tokenCalls = 0;
    setSessionTokenGetter(async () => `fresh-${++tokenCalls}`);
    const fetchMock = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, action: "bootstrap", data: {} }),
      url,
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await bootstrapShowcaseOwner();
    await bootstrapShowcaseOwner();

    expect(tokenCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain("/showcase-owner?action=bootstrap");
      expect(JSON.parse(init.body)).toEqual({});
      expect(init.headers.Authorization).toMatch(/^Bearer fresh-[12]$/);
    }
  });

  it("paginates room placements and availability to a stable revision", async () => {
    setSessionTokenGetter(async () => "fresh-token");
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const firstPage = body.placementCursor === null && body.availableCursor === null;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          action: "room-read",
          data: {
            room: { roomId: ROOM_ID, revision: 4, visibility: "private" },
            blockers: [],
            placements: firstPage
              ? [{ tankId: TANK_A, revision: 1, visibility: "public" }]
              : [{ tankId: TANK_B, revision: 1, visibility: "public" }],
            settings: [],
            available: firstPage
              ? [{ kind: "tank", entityId: TANK_A, eligible: true }]
              : [{ kind: "tank", entityId: TANK_B, eligible: true }],
            placementNextCursor: firstPage ? "placement-cursor" : null,
            settingNextCursor: null,
            availableNextCursor: firstPage ? "available-cursor" : null,
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await readShowcaseRoom();
    expect(result.data.placements.map((row) => row.tankId)).toEqual([TANK_A, TANK_B]);
    expect(result.data.available.map((row) => row.entityId)).toEqual([TANK_A, TANK_B]);
    expect(result.data.placementNextCursor).toBeNull();
    expect(result.data.availableNextCursor).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Phase A atomic publication contract", () => {
  const route = readFileSync(fileURLToPath(new URL("../../api/showcase-owner.js", import.meta.url)), "utf8");
  const builder = readFileSync(fileURLToPath(new URL("../components/breeder/ShowcaseOwnerBuilder.jsx", import.meta.url)), "utf8");
  const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260908173000_showcase_atomic_owner_publication.sql", import.meta.url)), "utf8");
  const placements = Array.from({ length: 7 }, (_, index) => ({
    tankId: `tank_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    revision: index,
  }));
  const publicationBody = (overrides = {}) => ({
    roomId: ROOM_ID,
    expectedRevision: 4,
    visibility: "public",
    expectedPlacements: placements,
    approvedPreview: { schemaVersion: 1, room: { tanks: [] } },
    ...overrides,
  });

  it("accepts any distinct non-empty revision-bound set within the room ceiling and rejects empty, duplicate, or oversized sets", () => {
    // The owner publishes the exact set they confirmed (1..100). A full seven,
    // a smaller real set (e.g. three tanks), and a single tank are all valid.
    expect(validateAction("publication-set", publicationBody()).ok).toBe(true);
    expect(validateAction("publication-set", publicationBody({ expectedPlacements: placements.slice(0, 3) })).ok).toBe(true);
    expect(validateAction("publication-set", publicationBody({ expectedPlacements: placements.slice(0, 1) })).ok).toBe(true);
    // Empty is still rejected for a non-private publication.
    expect(validateAction("publication-set", publicationBody({ expectedPlacements: [] })).ok).toBe(false);
    // Duplicate tankIds remain rejected regardless of count.
    expect(validateAction("publication-set", publicationBody({ expectedPlacements: [...placements.slice(0, 6), placements[0]] })).ok).toBe(false);
    // Over the 100-tank room ceiling is rejected.
    const oversized = Array.from({ length: 101 }, (_, index) => ({
      tankId: `tank_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revision: index,
    }));
    expect(validateAction("publication-set", publicationBody({ expectedPlacements: oversized })).ok).toBe(false);
    expect(validateAction("publication-set", publicationBody({ approvedPreview: null })).ok).toBe(false);
    expect(validateAction("publication-preview", { roomId: ROOM_ID, targetVisibility: "public" }).ok).toBe(true);
    expect(validateAction("publication-preview", { roomId: ROOM_ID }).ok).toBe(false);
  });

  it("keeps private rollback independent of approval evidence", () => {
    const result = validateAction("publication-set", publicationBody({
      visibility: "private", expectedPlacements: [], approvedPreview: null,
    }));
    expect(result).toMatchObject({ ok: true, value: { visibility: "private", expectedPlacements: [], approvedPreview: null } });
    expect(route).toMatch(/v\.visibility === "private"[\s\S]*showcase_set_owner_room_visibility/);
    expect(route).toMatch(/ownerMayPublish[\s\S]*showcase_set_owner_room_visibility_v2/);
  });

  it("moves target-preview equality, placement revisions, eligibility, and visibility into one serialized SQL transaction", () => {
    const publicationLock = migration.indexOf("showcase_acquire_publication_owner_lock");
    const identityLock = migration.indexOf("showcase-identity-owner:");
    const preview = migration.indexOf("current_preview := public.showcase_render_room_projection");
    const update = migration.indexOf("UPDATE public.showcase_rooms");
    expect(publicationLock).toBeGreaterThan(0);
    expect(identityLock).toBeGreaterThan(publicationLock);
    expect(preview).toBeGreaterThan(identityLock);
    expect(update).toBeGreaterThan(preview);
    expect(migration).toContain("jsonb_typeof(p_expected_placements) IS DISTINCT FROM 'array'");
    expect(migration).toMatch(/IS DISTINCT FROM 'array'[\s\S]*END IF;[\s\S]*jsonb_array_length/);
    expect(migration).toContain("e.revision = rt.revision");
    expect(migration).toContain("actual_count <> 7 OR matched_count <> 7");
    expect(migration).toContain("identity_state = 'verified'");
    expect(migration).toContain("commerce_listing_key IS NULL");
    expect(migration).toContain("proposed_room.visibility := p_visibility");
    expect(migration).toContain("current_preview IS DISTINCT FROM p_approved_preview");
    expect(migration).toContain("published_preview IS DISTINCT FROM p_approved_preview");
    expect(route).toContain("showcase_owner_publication_preview_v2");
  });

  it("client fails closed on finalize conflicts and binds the approved preview to seven placement revisions", () => {
    expect(builder).toContain("identityMutationBlocked");
    expect(builder).toContain("storedFinalize");
    expect(builder).toContain("expectedPlacements = freshPlacements");
    expect(builder).toContain("approvedPreview = freshPreview.data");
    expect(builder).toContain("publicationPlacementsReady");
    expect(builder).toMatch(/handlePreview[\s\S]*identityMutationBlocked/);
    expect(builder).toMatch(/handleVisibility[\s\S]*identityMutationBlocked/);
  });
});

describe("owner-authenticated processed-image preview", () => {
  const route = readFileSync(fileURLToPath(new URL("../../api/showcase-owner.js", import.meta.url)), "utf8");
  const builder = readFileSync(fileURLToPath(new URL("../components/breeder/ShowcaseOwnerBuilder.jsx", import.meta.url)), "utf8");
  const migration = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260908180000_showcase_owner_media_preview.sql", import.meta.url)), "utf8");

  it("gets a fresh token for every private blob request and never permits caching", async () => {
    let tokenCalls = 0;
    setSessionTokenGetter(async () => `preview-${++tokenCalls}`);
    const bytes = new Blob(["webp"], { type: "image/webp" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/webp" : name.toLowerCase() === "content-length" ? "4" : null },
      blob: async () => bytes,
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await previewShowcaseMedia({ roomId: ROOM_ID, assetId: ROOM_ID })).toBe(bytes);
    expect(await previewShowcaseMedia({ roomId: ROOM_ID, assetId: ROOM_ID })).toBe(bytes);
    expect(tokenCalls).toBe(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain("showcase-owner?action=media-preview");
      expect(init.cache).toBe("no-store");
      expect(init.credentials).toBe("same-origin");
      expect(init.headers.Authorization).toMatch(/^Bearer preview-[12]$/);
      expect(JSON.parse(init.body)).toEqual({ roomId: ROOM_ID, assetId: ROOM_ID, variant: "hero" });
    }
  });

  it("binds preview to a private owner room, finalized intent, approved asset, and exact derivative", () => {
    expect(migration).toContain("r.id = p_room_id AND r.owner_id = p_owner_id AND r.visibility = 'private'");
    expect(migration).toContain("ui.asset_id = p_asset_id AND ui.state = 'finalized'");
    expect(migration).toContain("a.purpose = 'room_hero' AND a.state = 'approved'");
    expect(migration).toContain("a.metadata_stripped IS TRUE");
    expect(migration).toContain("v.object_key = 'owners/' || p_owner_id::text");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.showcase_authorize_owner_media_preview");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.showcase_authorize_owner_media_preview");
  });

  it("streams only the reviewed binary action and keeps browser preview URLs ephemeral", () => {
    expect(route).toContain('rpcData("showcase_authorize_owner_media_preview"');
    expect(route).toContain('action === "media-preview" && Buffer.isBuffer(result.bytes)');
    expect(route).toContain('res.setHeader("Content-Type", result.contentType)');
    expect(builder).toContain("URL.createObjectURL(blob)");
    expect(builder).toContain("URL.revokeObjectURL(mediaPreviewUrlRef.current)");
    expect(builder).toContain("writePendingHeroHandle(normalizedAccount");
    expect(builder).toContain("readPendingHeroHandle(normalizedAccount)");
    expect(builder).toContain("readShowcaseMediaStatus(pendingHero.assetId)");
    expect(builder).toContain('mediaStatus?.state !== "approved"');
    expect(builder).toContain("Steve approves this exact processed image, alt text, and focal point");
  });
});