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
    return { tanks: 0, specimens: 0, logs: 0 };
  }

  const addr = walletAddress.toLowerCase();
  let tanks = 0, specimens = 0, logs = 0;

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

  } catch (e) {
    console.warn("[CloudSync] Pull failed:", e.message);
  }

  if (tanks || specimens || logs) {
    console.info(`[CloudSync] Pulled from cloud — tanks: ${tanks}, specimens: ${specimens}, logs: ${logs}`);
  }

  return { tanks, specimens, logs };
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
    const [localTanks, localSpecimens] = await Promise.all([
      db.tanks.where("ownerAddress").equals(walletAddress).toArray(),
      db.specimens.where("ownerAddress").equals(walletAddress).toArray(),
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
