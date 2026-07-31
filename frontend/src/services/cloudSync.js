/**
 * cloudSync.js
 *
 * Supabase cloud sync for tanks, specimens, and action logs.
 * Works in "anon" mode — no JWT bridge required. Data is scoped
 * by owner_address column, queried explicitly per user.
 *
 * Strategy:
 *   WRITE: after every local Dexie write, fire-and-forget upsert to Supabase.
 *   READ:  on login, pull all cloud rows for the wallet and merge into Dexie
 *          (cloud wins for rows the local device doesn't have; local wins for conflicts).
 *
 * All functions are safe to call even if Supabase is not configured —
 * they silently no-op so offline / unregistered users are unaffected.
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { resolveSpecimenPhoto } from "./tankMedia";

// ─── helpers ────────────────────────────────────────────────────────────────

function noop() {}

/**
 * Serialise a Dexie tank row for Supabase.
 * We store the full JSON blob in a `data` jsonb column so the schema
 * never needs to change as the tank object grows.
 */
function tankToRow(tank) {
  return {
    id: String(tank.id),
    owner_address: (tank.ownerAddress || "").toLowerCase(),
    name: tank.name || "",
    active: tank.active !== false,
    updated_at: new Date().toISOString(),
    data: JSON.stringify(tank),
  };
}

function specimenToRow(specimen) {
  return {
    id: String(specimen.id),
    owner_address: (specimen.ownerAddress || "").toLowerCase(),
    current_tank_id: String(specimen.currentTankId || 0),
    species_id: Number(specimen.speciesId || 0),
    status: Number(specimen.status || 0),
    updated_at: new Date().toISOString(),
    data: JSON.stringify(specimen),
  };
}

function actionLogToRow(log, ownerAddress) {
  return {
    local_id: String(log.id),
    owner_address: (ownerAddress || "").toLowerCase(),
    tank_id: String(log.tankId || ""),
    action_type: log.actionType || "",
    timestamp: Number(log.timestamp || 0),
    data: JSON.stringify(log),
  };
}

/**
 * Serialise a grow-out checkpoint for Supabase.
 *
 * Two shape notes that matter:
 *
 *  1. The local `id` is DROPPED. `spawnGrowout` uses Dexie's `++id`
 *     auto-increment, so ids are device-scoped — two devices both produce 1, 2,
 *     3… Rows are therefore keyed on the natural tuple
 *     (owner_address, spawn_id, event_timestamp, type), which is what the unique
 *     index and the pull-side dedup both use.
 *
 *  2. The base64 `photo` is STRIPPED. Checkpoint photos are full data URLs
 *     (hundreds of KB each) and an active breeder accumulates hundreds of
 *     checkpoints; pushing those through a jsonb column would bloat every row
 *     and every pull. `has_photo` records that one existed so the UI can say so.
 *     Photos stay device-local until the tankMedia/CDN pipeline covers them —
 *     see docs/BREEDER_STATE_MODEL.md §9.3.
 */
function growoutCheckpointToRow(checkpoint, ownerAddress) {
  const { photo, id: _localId, ...rest } = checkpoint;
  return {
    owner_address: (ownerAddress || "").toLowerCase(),
    spawn_id: String(checkpoint.spawnId),
    event_timestamp: Number(checkpoint.timestamp || 0),
    type: checkpoint.type || "note",
    count: Number(checkpoint.count || 0),
    note: checkpoint.note || null,
    has_photo: !!photo,
    updated_at: new Date().toISOString(),
    data: JSON.stringify(rest),
  };
}

/**
 * Grow-out checkpoints carry no owner of their own — they hang off a spawn.
 * Resolve the owning wallet from the spawn record so the row can be scoped.
 */
async function resolveSpawnOwner(spawnId) {
  try {
    const spawn = (await db.spawns.get(Number(spawnId))) || (await db.spawns.get(spawnId));
    const owner = (spawn?.ownerAddress || "").toLowerCase();
    return owner || null;
  } catch {
    return null;
  }
}

function spawnToRow(spawn) {
  return {
    spawn_id: String(spawn.spawnId),
    owner_address: (spawn.ownerAddress || "").toLowerCase(),
    species_id: Number(spawn.speciesId || 0),
    scientific_name: spawn.scientificName || "",
    common_name: spawn.commonName || "",
    tank_id: String(spawn.tankId || 0),
    offspring_count: Array.isArray(spawn.offspringIds) ? spawn.offspringIds.length : Number(spawn.offspringCount || 0),
    event_timestamp: Number(spawn.timestamp || 0),
    updated_at: new Date().toISOString(),
    data: JSON.stringify(spawn),
  };
}

// ─── WRITE operations (fire-and-forget) ─────────────────────────────────────

/**
 * Upsert a single tank to Supabase. Non-blocking.
 * @param {object} tank - Dexie tank object
 */
export async function syncTankToCloud(tank) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_tanks")
      .upsert(tankToRow(tank), { onConflict: "id" });
    if (error) console.warn("[CloudSync] Tank upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Tank upsert error:", e.message);
  }
}

/**
 * Upsert a single specimen to Supabase. Non-blocking.
 * @param {object} specimen - Dexie specimen object
 */
export async function syncSpecimenToCloud(specimen) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_specimens")
      .upsert(specimenToRow(specimen), { onConflict: "id" });
    if (error) console.warn("[CloudSync] Specimen upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Specimen upsert error:", e.message);
  }
}

/**
 * Upsert a single action log to Supabase. Non-blocking.
 * @param {object} log - Dexie actionLog object
 * @param {string} ownerAddress - wallet address of the owner
 */
export async function syncActionLogToCloud(log, ownerAddress) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_action_logs")
      .upsert(actionLogToRow(log, ownerAddress), { onConflict: "local_id" });
    if (error) console.warn("[CloudSync] ActionLog upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] ActionLog upsert error:", e.message);
  }
}

/**
 * Upsert a single spawn event to Supabase. Non-blocking.
 * This is what makes spawn activity ("N spawns logged this month for
 * Betta splendens") aggregable across users — without it, spawns only
 * ever exist in the breeder's own local Dexie table.
 * @param {object} spawn - Dexie spawn object (spawns table)
 */
export async function syncSpawnToCloud(spawn) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_spawns")
      .upsert(spawnToRow(spawn), { onConflict: "spawn_id" });
    if (error) console.warn("[CloudSync] Spawn upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Spawn upsert error:", e.message);
  }
}

/**
 * Upsert a single grow-out checkpoint to Supabase. Non-blocking.
 *
 * Without this, `spawnGrowout` was the one load-bearing breeder table with no
 * cloud mirror: every fry count, cull, loss, sale, survival rate, Poseidon
 * nudge, and every stat and badge on the Achievements tab is derived from it, so
 * all of it was device-local and lost on a cache clear or a device change.
 *
 * @param {object} checkpoint - Dexie spawnGrowout row
 * @param {string|null} [ownerAddress] - skips the spawn lookup when known
 */
export async function syncGrowoutCheckpointToCloud(checkpoint, ownerAddress = null) {
  if (!isSupabaseConfigured() || !checkpoint) return;
  try {
    const owner = (ownerAddress || (await resolveSpawnOwner(checkpoint.spawnId)) || "").toLowerCase();
    // An orphan checkpoint (no resolvable spawn) has nothing to scope it to.
    // Keep it local rather than pushing an unattributable row.
    if (!owner) return;
    const { error } = await supabase
      .from("aquadex_spawn_growout")
      .upsert(growoutCheckpointToRow(checkpoint, owner), {
        onConflict: "owner_address,spawn_id,event_timestamp,type",
      });
    if (error) console.warn("[CloudSync] Grow-out checkpoint upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Grow-out checkpoint upsert error:", e.message);
  }
}

/**
 * Upsert many grow-out checkpoints at once (batch logging). Non-blocking.
 * @param {Array<object>} checkpoints
 * @param {string|null} [ownerAddress]
 */
export async function syncGrowoutCheckpointsToCloud(checkpoints, ownerAddress = null) {
  if (!isSupabaseConfigured() || !Array.isArray(checkpoints) || checkpoints.length === 0) return;
  try {
    const rows = [];
    for (const checkpoint of checkpoints) {
      const owner = (ownerAddress || (await resolveSpawnOwner(checkpoint.spawnId)) || "").toLowerCase();
      if (!owner) continue;
      rows.push(growoutCheckpointToRow(checkpoint, owner));
    }
    if (rows.length === 0) return;
    const { error } = await supabase
      .from("aquadex_spawn_growout")
      .upsert(rows, { onConflict: "owner_address,spawn_id,event_timestamp,type" });
    if (error) console.warn("[CloudSync] Grow-out batch upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Grow-out batch upsert error:", e.message);
  }
}

/**
 * Mark a tank as deleted in Supabase (soft delete).
 * @param {string|number} tankId
 */
export async function deleteTankFromCloud(tankId) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_tanks")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", String(tankId));
    if (error) console.warn("[CloudSync] Tank delete failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Tank delete error:", e.message);
  }
}

// ─── READ / PULL (called once on login) ─────────────────────────────────────

import { db } from "../db";

/**
 * Pull all cloud data for a wallet and merge into local Dexie.
 * Called once per login. Safe to call multiple times (idempotent upserts).
 *
 * @param {string} walletAddress - authenticated user's wallet
 * @returns {Promise<{tanks: number, specimens: number, logs: number}>} counts of synced rows
 */
export async function pullCloudDataForWallet(walletAddress) {
  if (!isSupabaseConfigured() || !walletAddress) {
    return { tanks: 0, specimens: 0, logs: 0, spawns: 0, growout: 0 };
  }

  const addr = walletAddress.toLowerCase();
  let tanks = 0, specimens = 0, logs = 0, spawns = 0, growout = 0;

  try {
    // ── Tanks ──────────────────────────────────────────────
    const { data: cloudTanks, error: tErr } = await supabase
      .from("aquadex_tanks")
      .select("data")
      .eq("owner_address", addr)
      .eq("active", true);

    if (tErr) {
      console.warn("[CloudSync] Pull tanks failed:", tErr.message);
    } else if (cloudTanks && cloudTanks.length > 0) {
      for (const row of cloudTanks) {
        try {
          const tank = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          // Only write if not already in local Dexie (local wins on conflict)
          const existing = await db.tanks.get(tank.id);
          if (!existing) {
            await db.tanks.put(tank);
            tanks++;
          }
        } catch (parseErr) {
          console.warn("[CloudSync] Bad tank data row:", parseErr);
        }
      }
    }

    // ── Specimens ──────────────────────────────────────────
    const { data: cloudSpecimens, error: sErr } = await supabase
      .from("aquadex_specimens")
      .select("data")
      .eq("owner_address", addr);

    if (sErr) {
      console.warn("[CloudSync] Pull specimens failed:", sErr.message);
    } else if (cloudSpecimens && cloudSpecimens.length > 0) {
      for (const row of cloudSpecimens) {
        try {
          const specimen = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          const existing = await db.specimens.get(specimen.id);
          if (!existing) {
            await db.specimens.put(specimen);
            specimens++;
          }
        } catch (parseErr) {
          console.warn("[CloudSync] Bad specimen data row:", parseErr);
        }
      }
    }

    // ── Action Logs ────────────────────────────────────────
    const { data: cloudLogs, error: lErr } = await supabase
      .from("aquadex_action_logs")
      .select("data, local_id")
      .eq("owner_address", addr)
      .order("timestamp", { ascending: false })
      .limit(500); // cap to avoid massive pulls

    if (lErr) {
      console.warn("[CloudSync] Pull action logs failed:", lErr.message);
    } else if (cloudLogs && cloudLogs.length > 0) {
      for (const row of cloudLogs) {
        try {
          const log = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          const existing = log.id ? await db.actionLogs.get(Number(log.id)) : null;
          if (!existing) {
            // Strip the id so Dexie auto-assigns (++id), but only if it was auto-generated
            const { id: _ignored, ...logWithoutId } = log;
            await db.actionLogs.put({ id: Number(row.local_id) || undefined, ...logWithoutId });
            logs++;
          }
        } catch (parseErr) {
          console.warn("[CloudSync] Bad action log row:", parseErr);
        }
      }
    }

    // ── Spawns ─────────────────────────────────────────────
    const { data: cloudSpawns, error: spErr } = await supabase
      .from("aquadex_spawns")
      .select("data")
      .eq("owner_address", addr);

    if (spErr) {
      console.warn("[CloudSync] Pull spawns failed:", spErr.message);
    } else if (cloudSpawns && cloudSpawns.length > 0) {
      for (const row of cloudSpawns) {
        try {
          const spawn = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          const existing = await db.spawns.get(spawn.spawnId);
          if (!existing) {
            await db.spawns.put(spawn);
            spawns++;
          }
        } catch (parseErr) {
          console.warn("[CloudSync] Bad spawn data row:", parseErr);
        }
      }
    }

    // ── Grow-out checkpoints ───────────────────────────────
    // Pulled AFTER spawns so the spawn rows they hang off already exist locally.
    const { data: cloudGrowout, error: gErr } = await supabase
      .from("aquadex_spawn_growout")
      .select("data, spawn_id, event_timestamp, type")
      .eq("owner_address", addr);

    if (gErr) {
      console.warn("[CloudSync] Pull grow-out checkpoints failed:", gErr.message);
    } else if (cloudGrowout && cloudGrowout.length > 0) {
      for (const row of cloudGrowout) {
        try {
          const checkpoint = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          // Dedup on the natural key, NOT on id: `spawnGrowout` uses Dexie's
          // device-scoped `++id`, so a cloud row's original id is meaningless
          // here and reusing it would collide with unrelated local rows.
          const spawnId = Number(row.spawn_id);
          const eventTimestamp = Number(row.event_timestamp);
          const type = row.type || "note";
          const existing = await db.spawnGrowout
            .where("spawnId")
            .equals(spawnId)
            .filter((c) => Number(c.timestamp) === eventTimestamp && (c.type || "note") === type)
            .first();
          if (!existing) {
            const { id: _ignored, ...withoutId } = checkpoint;
            await db.spawnGrowout.add({ ...withoutId, spawnId, timestamp: eventTimestamp, type });
            growout++;
          }
        } catch (parseErr) {
          console.warn("[CloudSync] Bad grow-out checkpoint row:", parseErr);
        }
      }
    }

  } catch (e) {
    console.warn("[CloudSync] Pull failed:", e.message);
  }

  if (tanks || specimens || logs || spawns || growout) {
    console.info(`[CloudSync] Pulled from cloud — tanks: ${tanks}, specimens: ${specimens}, logs: ${logs}, spawns: ${spawns}, grow-out: ${growout}`);
  }

  // ── XP Profile (cross-device sync) ──────────────────────
  const xpRestored = await pullXpProfileFromCloud(walletAddress);
  if (xpRestored) {
    // Dispatch event so UI components re-render with updated XP
    window.dispatchEvent(new CustomEvent("aquadex_xp_added", {
      detail: { reason: "cloud_sync", actionLabel: "XP Restored from Cloud", totalXp: xpRestored },
    }));
  }

  return { tanks, specimens, logs, spawns, growout };
}

/**
 * Push ALL local Dexie data for a wallet up to Supabase.
 * Useful for the first-time sync from an existing device.
 *
 * @param {string} walletAddress
 */
export async function pushAllLocalDataToCloud(walletAddress) {
  if (!isSupabaseConfigured() || !walletAddress) return;
  const addr = walletAddress.toLowerCase();

  try {
    const [localTanks, localSpecimens, localSpawns] = await Promise.all([
      db.tanks.where("ownerAddress").equals(walletAddress).toArray(),
      db.specimens.where("ownerAddress").equals(walletAddress).toArray(),
      // `spawns` has no ownerAddress index (see db.js), so .where() would throw —
      // use .filter() which works on any field without requiring one.
      db.spawns.filter(s => (s.ownerAddress || "").toLowerCase() === addr).toArray(),
    ]);

    // Batch upsert tanks
    if (localTanks.length > 0) {
      const rows = localTanks.map(tankToRow);
      const { error } = await supabase.from("aquadex_tanks").upsert(rows, { onConflict: "id" });
      if (error) console.warn("[CloudSync] Batch tank push failed:", error.message);
      else console.info(`[CloudSync] Pushed ${localTanks.length} tanks to cloud.`);
    }

    // Batch upsert specimens
    if (localSpecimens.length > 0) {
      const rows = localSpecimens.map(specimenToRow);
      const { error } = await supabase.from("aquadex_specimens").upsert(rows, { onConflict: "id" });
      if (error) console.warn("[CloudSync] Batch specimen push failed:", error.message);
      else console.info(`[CloudSync] Pushed ${localSpecimens.length} specimens to cloud.`);
    }

    // Batch upsert spawns (backfills pre-existing local spawns predating cloud sync)
    if (localSpawns.length > 0) {
      const rows = localSpawns.map(spawnToRow);
      const { error } = await supabase.from("aquadex_spawns").upsert(rows, { onConflict: "spawn_id" });
      if (error) console.warn("[CloudSync] Batch spawn push failed:", error.message);
      else console.info(`[CloudSync] Pushed ${localSpawns.length} spawns to cloud.`);
    }

    // Batch upsert grow-out checkpoints. This is the backfill that rescues every
    // checkpoint logged before the mirror existed — without it, an existing
    // breeder's entire grow-out history stays stranded on one device.
    // Checkpoints carry no owner, so scope them by the user's own spawn ids.
    if (localSpawns.length > 0) {
      const mySpawnIds = new Set(localSpawns.map((s) => Number(s.spawnId)));
      const allCheckpoints = await db.spawnGrowout.toArray();
      const myCheckpoints = allCheckpoints.filter((cp) => mySpawnIds.has(Number(cp.spawnId)));
      if (myCheckpoints.length > 0) {
        const rows = myCheckpoints.map((cp) => growoutCheckpointToRow(cp, addr));
        const { error } = await supabase
          .from("aquadex_spawn_growout")
          .upsert(rows, { onConflict: "owner_address,spawn_id,event_timestamp,type" });
        if (error) console.warn("[CloudSync] Batch grow-out push failed:", error.message);
        else console.info(`[CloudSync] Pushed ${myCheckpoints.length} grow-out checkpoints to cloud.`);
      }
    }

    // Push action logs (up to 500 most recent per user)
    const actionLogs = await db.actionLogs.toArray();
    const userLogs = actionLogs.filter(l => {
      // action logs don't have ownerAddress, so we push all (server filters by owner)
      return true;
    }).slice(-500);

    if (userLogs.length > 0) {
      const rows = userLogs.map(l => actionLogToRow(l, addr));
      const { error } = await supabase.from("aquadex_action_logs").upsert(rows, { onConflict: "local_id" });
      if (error) console.warn("[CloudSync] Batch log push failed:", error.message);
    }

  } catch (e) {
    console.warn("[CloudSync] pushAllLocalDataToCloud failed:", e.message);
  }
}

// ─── XP PROFILE — Cross-device XP sync ──────────────────────────────────────

/**
 * Upsert the user's XP profile to Supabase for cross-device sync.
 * Uses "highest wins" — only writes if local totalXp >= cloud totalXp.
 * Fire-and-forget, non-blocking.
 *
 * Table: user_xp_profiles
 *   wallet_address text PRIMARY KEY
 *   total_xp integer NOT NULL DEFAULT 0
 *   current_tier text NOT NULL DEFAULT 'Shallow'
 *   streak_days integer DEFAULT 0
 *   last_active_date text
 *   monthly_xp integer DEFAULT 0
 *   updated_at timestamptz DEFAULT now()
 *
 * @param {string} walletAddress
 * @param {object} profile - { totalXp, currentTier, streakDays, lastActiveDate, monthlyXp }
 */
export async function syncXpProfileToCloud(walletAddress, profile) {
  if (!isSupabaseConfigured() || !walletAddress) return;
  try {
    const addr = walletAddress.toLowerCase();
    const { error } = await supabase
      .from("user_xp_profiles")
      .upsert({
        wallet_address: addr,
        total_xp: profile.totalXp || 0,
        current_tier: profile.currentTier || "Shallow",
        streak_days: profile.streakDays || 0,
        last_active_date: profile.lastActiveDate || null,
        monthly_xp: profile.monthlyXp || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: "wallet_address" });
    if (error) console.warn("[CloudSync] XP profile upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] XP profile upsert error:", e.message);
  }
}

/**
 * Pull the user's XP profile from Supabase and merge into local Dexie.
 * Uses "highest wins" merge — local XP is never decreased by cloud data.
 *
 * @param {string} walletAddress
 * @returns {Promise<boolean>} true if local was updated from cloud
 */
export async function pullXpProfileFromCloud(walletAddress) {
  if (!isSupabaseConfigured() || !walletAddress) return false;

  const addr = walletAddress.toLowerCase();

  try {
    const { data, error } = await supabase
      .from("user_xp_profiles")
      .select("total_xp, current_tier, streak_days, last_active_date, monthly_xp")
      .eq("wallet_address", addr)
      .maybeSingle();

    if (error || !data) {
      // No cloud profile yet — will be created on next XP award.
      // maybeSingle() returns null (not a 406) when the row doesn't exist.
      return false;
    }

    const cloudXp = data.total_xp || 0;

    // Get local profile from Dexie
    let localProfile = await db.userProfile.get(walletAddress);
    const localXp = localProfile ? (localProfile.totalXp || 0) : 0;

    // "Highest wins" merge
    if (cloudXp > localXp) {
      const { deriveTierFromXp } = await import("../db");

      const mergedProfile = {
        walletAddress,
        totalXp: cloudXp,
        currentTier: data.current_tier || deriveTierFromXp(cloudXp),
        streakDays: Math.max(data.streak_days || 0, localProfile?.streakDays || 0),
        lastActiveDate: data.last_active_date || localProfile?.lastActiveDate || null,
        monthlyXp: Math.max(data.monthly_xp || 0, localProfile?.monthlyXp || 0),
        zoneHash: localProfile?.zoneHash || "",
        rewardCredits: localProfile?.rewardCredits || 0,
        isCouncilMember: localProfile?.isCouncilMember || false,
        onboardingComplete: localProfile?.onboardingComplete || false,
      };

      await db.userProfile.put(mergedProfile);

      // Also update breederCompanion tier
      let companion = await db.breederCompanion.get(walletAddress);
      if (companion) {
        companion.currentTier = mergedProfile.currentTier;
        if (cloudXp >= 1500) companion.eggState = 2;
        else if (cloudXp >= 500) companion.eggState = 1;
        await db.breederCompanion.put(companion);
      }

      // Update localStorage XP for legacy components that read from there
      try {
        const lsProfile = {
          points: cloudXp,
          tier: mergedProfile.currentTier,
          level: cloudXp >= 10000 ? 5 : cloudXp >= 5000 ? 4 : cloudXp >= 2500 ? 3 : cloudXp >= 1500 ? 2 : 1,
          history: [],
        };
        localStorage.setItem("aquadex_xp_profile", JSON.stringify(lsProfile));
        localStorage.setItem("aquadex_xp", String(cloudXp));
        localStorage.setItem("aquadex_xp_points", String(cloudXp));
      } catch (e) { /* localStorage may be unavailable */ }

      // Sync restored tier to reef profile so the header badge is correct
      try {
        await supabase
          .from("profiles")
          .update({
            companion_tier: mergedProfile.currentTier,
            xp_total: cloudXp,
            updated_at: new Date().toISOString(),
          })
          .eq("wallet_address", addr);
      } catch (e) { /* non-critical — UI will still show correct value after refetch */ }

      console.info(`[CloudSync] XP restored from cloud: ${cloudXp} XP (local was ${localXp})`);
      return cloudXp;
    } else if (localXp > cloudXp) {
      // Local is ahead — push to cloud so other devices catch up
      syncXpProfileToCloud(walletAddress, {
        totalXp: localXp,
        currentTier: localProfile.currentTier,
        streakDays: localProfile.streakDays,
        lastActiveDate: localProfile.lastActiveDate,
        monthlyXp: localProfile.monthlyXp,
      }).catch(() => {});

      // Also sync to reef profile so the header badge is correct
      try {
        await supabase
          .from("profiles")
          .update({
            companion_tier: localProfile.currentTier,
            xp_total: localXp,
            updated_at: new Date().toISOString(),
          })
          .eq("wallet_address", addr);
      } catch (e) { /* non-critical */ }

      // Ensure localStorage reflects the correct local state
      try {
        const lsProfile = {
          points: localXp,
          tier: localProfile.currentTier,
          level: localXp >= 10000 ? 5 : localXp >= 5000 ? 4 : localXp >= 2500 ? 3 : localXp >= 1500 ? 2 : 1,
          history: [],
        };
        localStorage.setItem("aquadex_xp_profile", JSON.stringify(lsProfile));
        localStorage.setItem("aquadex_xp", String(localXp));
        localStorage.setItem("aquadex_xp_points", String(localXp));
      } catch (e) { /* localStorage may be unavailable */ }

      return localXp;
    }

    // cloudXp === localXp — no merge needed, but ensure localStorage is populated
    // (it may have been cleared on logout)
    if (localXp > 0) {
      const { deriveTierFromXp } = await import("../db");
      const tier = localProfile?.currentTier || deriveTierFromXp(localXp);
      try {
        const lsProfile = {
          points: localXp,
          tier,
          level: localXp >= 10000 ? 5 : localXp >= 5000 ? 4 : localXp >= 2500 ? 3 : localXp >= 1500 ? 2 : 1,
          history: [],
        };
        localStorage.setItem("aquadex_xp_profile", JSON.stringify(lsProfile));
        localStorage.setItem("aquadex_xp", String(localXp));
        localStorage.setItem("aquadex_xp_points", String(localXp));
      } catch (e) { /* localStorage may be unavailable */ }
      return localXp;
    }

    return false;
  } catch (e) {
    console.warn("[CloudSync] XP profile pull error:", e.message);
    return false;
  }
}

/**
 * Serialize a local listing object for the aquadex_listings Supabase table.
 */
async function listingToRow(listing) {
  // Attach the specimen photo to the listing data for cross-user visibility, resolved
  // through the one §9.3 precedence order (hosted → Dexie tankMedia → legacy
  // localStorage → none) instead of reading the raw localStorage key. Async because the
  // durable copy lives in Dexie; the only caller already awaits.
  //
  // Precedence pays off here: once a photo has a recorded bucket URL, that short URL is
  // what gets published rather than a base64 blob inflating every listing row. If no
  // copy resolves, `photoUrl` is left absent — never set to a placeholder.
  let enrichedListing = { ...listing };
  if (!listing.isBatch && listing.tokenId) {
    const { url } = await resolveSpecimenPhoto(listing.tokenId, { hostedUrl: listing.photoUrl || "" });
    if (url) {
      enrichedListing.photoUrl = url;
    }
  }

  return {
    id: String(listing.id || listing.tokenId || listing.listingId),
    seller_address: (listing.seller || "").toLowerCase(),
    species_id: Number(listing.speciesId || 0),
    common_name: listing.commonName || "",
    price: String(listing.price || "0"),
    is_batch: !!listing.isBatch,
    is_active: listing.active !== false,
    updated_at: new Date().toISOString(),
    data: JSON.stringify(enrichedListing),
  };
}

/**
 * Upsert a single listing to Supabase so other users can see it.
 * Fire-and-forget — non-blocking.
 * @param {object} listing - Dexie localListing object
 */
export async function syncListingToCloud(listing) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_listings")
      .upsert(await listingToRow(listing), { onConflict: "id" });
    if (error) console.warn("[CloudSync] Listing upsert failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Listing upsert error:", e.message);
  }
}

/**
 * Mark a listing as inactive in Supabase (on cancel/purchase).
 * @param {string|number} listingId
 */
export async function deactivateListingInCloud(listingId) {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase
      .from("aquadex_listings")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", String(listingId));
    if (error) console.warn("[CloudSync] Listing deactivate failed:", error.message);
  } catch (e) {
    console.warn("[CloudSync] Listing deactivate error:", e.message);
  }
}

/**
 * Pull ALL active listings from Supabase (all sellers).
 * This is what enables cross-user listing visibility — every user sees
 * all other users' listings, not just their own local ones.
 * 
 * @param {number|null} speciesId - optional filter by species
 * @returns {Promise<Array>} array of listing objects (same shape as Dexie localListings)
 */
/** Full-blob source. Readable by `authenticated` and `service_role` only, since
 *  supabase/migrations/20260729_aquadex_listings_rls_lockdown.sql. */
const LISTINGS_TABLE = "aquadex_listings";
/** Display-safe allowlisted projection, readable by anon. */
const LISTINGS_PUBLIC_VIEW = "aquadex_listings_public";

/** Log the fallback once per session rather than on every refetch. */
let _warnedListingsFallback = false;

export async function pullCloudListings(speciesId = null) {
  if (!isSupabaseConfigured()) return [];

  /** Same shape of query against either relation — the view carries is_active,
   *  species_id and created_at as real columns specifically so this works. */
  function buildQuery(relation) {
    let query = supabase
      .from(relation)
      .select("data")
      .eq("is_active", true);

    if (speciesId) {
      query = query.eq("species_id", Number(speciesId));
    }

    return query.order("created_at", { ascending: false }).limit(200);
  }

  function parseRows(rows) {
    return (rows || []).map(row => {
      try {
        return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  try {
    // Preferred path: the raw table, which carries the FULL blob the in-app
    // board needs (packing profile, DOA terms, care notes, description).
    const { data, error } = await buildQuery(LISTINGS_TABLE);
    if (error) {
      console.warn("[CloudSync] Pull listings failed:", error.message);
    }

    const parsed = error ? [] : parseRows(data);
    if (parsed.length > 0) return parsed;

    // Zero rows here is AMBIGUOUS, and that ambiguity is why this fallback
    // exists. Since the lockdown, an anon-role client gets back `[]` with NO
    // error — RLS simply filters every row — so "there are no listings" and
    // "this session never reached the `authenticated` role" are
    // indistinguishable at this call site. The JWT bridge
    // (/api/mint-session → setSession) is best-effort by design: on any failure
    // supabaseClient.js falls back to the anon role, and before the lockdown
    // that fallback was invisible because anon could read everything.
    //
    // Retrying against the view keeps the board populated in that degraded
    // state instead of rendering an empty "No Entries Found". Fallback rows
    // carry only the allowlisted display fields, so detail-level values may be
    // missing — acceptable, because it is strictly better than a blank board
    // and no money decision is made from these values (stripe.js re-validates
    // price server-side with the service key).
    const { data: viewData, error: viewError } = await buildQuery(LISTINGS_PUBLIC_VIEW);
    if (viewError) {
      console.warn("[CloudSync] Pull listings fallback failed:", viewError.message);
      return [];
    }

    const viewParsed = parseRows(viewData);
    if (viewParsed.length > 0 && !_warnedListingsFallback) {
      _warnedListingsFallback = true;
      console.warn(
        "[CloudSync] " + LISTINGS_TABLE + " returned no rows but " +
        LISTINGS_PUBLIC_VIEW + " returned " + viewParsed.length +
        ". This session is almost certainly on the anon role — the /api/mint-session " +
        "JWT bridge did not attach an authenticated session. Listings are showing " +
        "display-safe fields only."
      );
    }
    return viewParsed;
  } catch (e) {
    console.warn("[CloudSync] Pull listings error:", e.message);
    return [];
  }
}
