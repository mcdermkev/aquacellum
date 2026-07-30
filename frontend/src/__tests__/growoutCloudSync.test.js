/**
 * Grow-out checkpoint cloud mirror (docs/BREEDER_STATE_MODEL.md §9.2).
 *
 * `spawnGrowout` was the one load-bearing breeder table with no Supabase mirror,
 * so every fry count, cull, loss, survival rate, and every Achievements stat was
 * device-local and lost on a cache clear. These tests pin the row shape and the
 * two properties that make the mirror safe:
 *
 *   - the device-scoped Dexie `++id` is never used as a cloud identity
 *   - base64 photos never enter the payload
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

const spawnRows = new Map();
const upserts = [];

vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from(table) {
      return {
        upsert(payload, options) {
          upserts.push({ table, payload, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));

vi.mock("../db", () => ({
  db: {
    spawns: { get: async (id) => spawnRows.get(Number(id)) || spawnRows.get(id) || undefined },
    spawnGrowout: { toArray: async () => [] },
    tanks: {}, specimens: {}, actionLogs: {}, userProfile: {}, breederCompanion: {},
  },
}));

const { syncGrowoutCheckpointToCloud, syncGrowoutCheckpointsToCloud } = await import(
  "../services/cloudSync"
);

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SPAWN_ID = 1731000123456;

beforeEach(() => {
  upserts.length = 0;
  spawnRows.clear();
  spawnRows.set(SPAWN_ID, { spawnId: SPAWN_ID, ownerAddress: OWNER });
});

function checkpoint(overrides = {}) {
  return {
    id: 7, // device-scoped Dexie ++id
    spawnId: SPAWN_ID,
    timestamp: 1731000200,
    type: "fry_count",
    count: 42,
    note: "First count",
    ...overrides,
  };
}

describe("syncGrowoutCheckpointToCloud", () => {
  it("writes to aquadex_spawn_growout keyed on the natural tuple, not the local id", async () => {
    await syncGrowoutCheckpointToCloud(checkpoint());
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe("aquadex_spawn_growout");
    expect(upserts[0].options.onConflict).toBe(
      "owner_address,spawn_id,event_timestamp,type"
    );
  });

  it("never sends the device-scoped Dexie id, at the top level or inside data", async () => {
    await syncGrowoutCheckpointToCloud(checkpoint({ id: 7 }));
    const row = upserts[0].payload;
    expect(row.id).toBeUndefined();
    expect(JSON.parse(row.data).id).toBeUndefined();
  });

  it("resolves the owner from the parent spawn and lowercases it", async () => {
    spawnRows.set(SPAWN_ID, { spawnId: SPAWN_ID, ownerAddress: OWNER.toUpperCase() });
    await syncGrowoutCheckpointToCloud(checkpoint());
    expect(upserts[0].payload.owner_address).toBe(OWNER);
  });

  it("accepts an explicit owner and skips the spawn lookup", async () => {
    spawnRows.clear(); // no spawn row at all
    await syncGrowoutCheckpointToCloud(checkpoint(), OWNER);
    expect(upserts[0].payload.owner_address).toBe(OWNER);
  });

  it("keeps an unattributable checkpoint local rather than pushing an orphan row", async () => {
    spawnRows.clear();
    await syncGrowoutCheckpointToCloud(checkpoint());
    expect(upserts).toHaveLength(0);
  });

  it("strips the base64 photo but records that one existed", async () => {
    const dataUrl = "data:image/jpeg;base64," + "A".repeat(5000);
    await syncGrowoutCheckpointToCloud(checkpoint({ photo: dataUrl }));
    const row = upserts[0].payload;
    expect(row.has_photo).toBe(true);
    expect(JSON.stringify(row)).not.toContain("base64");
    expect(JSON.parse(row.data).photo).toBeUndefined();
  });

  it("reports has_photo false when there was no photo", async () => {
    await syncGrowoutCheckpointToCloud(checkpoint());
    expect(upserts[0].payload.has_photo).toBe(false);
  });

  it("carries the fields the funnel math needs as real columns", async () => {
    await syncGrowoutCheckpointToCloud(checkpoint({ type: "loss", count: 3 }));
    const row = upserts[0].payload;
    expect(row.spawn_id).toBe(String(SPAWN_ID));
    expect(row.event_timestamp).toBe(1731000200);
    expect(row.type).toBe("loss");
    expect(row.count).toBe(3);
    expect(row.note).toBe("First count");
  });

  it("mirrors Poseidon narration rows too", async () => {
    await syncGrowoutCheckpointToCloud(
      checkpoint({ type: "narration", count: 0, note: "The fry are thriving." })
    );
    expect(upserts[0].payload.type).toBe("narration");
  });

  it("does nothing when handed no checkpoint", async () => {
    await syncGrowoutCheckpointToCloud(null);
    expect(upserts).toHaveLength(0);
  });
});

describe("syncGrowoutCheckpointsToCloud (batch)", () => {
  it("upserts every checkpoint in one call", async () => {
    await syncGrowoutCheckpointsToCloud(
      [checkpoint({ id: 1 }), checkpoint({ id: 2, timestamp: 1731000300 })],
      OWNER
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toHaveLength(2);
    expect(upserts[0].payload.every((r) => r.owner_address === OWNER)).toBe(true);
  });

  it("skips unattributable rows instead of failing the whole batch", async () => {
    const orphan = checkpoint({ spawnId: 999, timestamp: 1731000400 });
    await syncGrowoutCheckpointsToCloud([checkpoint(), orphan]);
    expect(upserts[0].payload).toHaveLength(1);
  });

  it("is a no-op for an empty or missing batch", async () => {
    await syncGrowoutCheckpointsToCloud([]);
    await syncGrowoutCheckpointsToCloud(null);
    expect(upserts).toHaveLength(0);
  });
});

describe("cloudSync + migration wiring", () => {
  const CLOUD_SYNC = readFileSync(
    fileURLToPath(new URL("../services/cloudSync.js", import.meta.url)),
    "utf8"
  );
  const MIGRATION = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260729_spawn_growout_sync.sql", import.meta.url)),
    "utf8"
  );

  it("pulls grow-out checkpoints and reports the count", () => {
    expect(CLOUD_SYNC).toContain('.from("aquadex_spawn_growout")');
    expect(CLOUD_SYNC).toContain("growout++");
    expect(CLOUD_SYNC).toContain("return { tanks, specimens, logs, spawns, growout }");
  });

  it("dedups the pull on the natural key rather than reusing the cloud row id", () => {
    expect(CLOUD_SYNC).toContain("const { id: _ignored, ...withoutId } = checkpoint");
  });

  it("backfills pre-existing local checkpoints so history isn't stranded", () => {
    expect(CLOUD_SYNC).toContain("Batch grow-out push failed");
  });

  it("has a migration whose unique index matches the client's onConflict tuple", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS aquadex_spawn_growout");
    expect(MIGRATION).toMatch(
      /UNIQUE INDEX[^;]*aquadex_spawn_growout\(owner_address, spawn_id, event_timestamp, type\)/
    );
  });

  it("enables RLS and scopes every policy to the caller's wallet", () => {
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("aquadex_caller_wallet()");
    for (const op of ["FOR SELECT", "FOR INSERT", "FOR UPDATE"]) {
      expect(MIGRATION).toContain(op);
    }
  });

  it("grants no client DELETE (grow-out history is append-only)", () => {
    expect(MIGRATION).not.toContain("FOR DELETE");
  });

  it("covers every grow-out checkpoint type the app writes", () => {
    // GROWOUT_TYPES in SpawnGrowoutTracker.jsx, plus spawnNarration's 'narration'.
    const tracker = readFileSync(
      fileURLToPath(new URL("../components/SpawnGrowoutTracker.jsx", import.meta.url)),
      "utf8"
    );
    const declared = [...tracker.matchAll(/^\s{2}(\w+):\s*\{ emoji:/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const type of [...declared, "narration"]) {
      expect(MIGRATION).toContain(`'${type}'`);
    }
  });
});
