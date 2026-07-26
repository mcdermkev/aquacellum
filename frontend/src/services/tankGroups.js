import { db } from "../db";

/**
 * tankGroups — user-defined location groups for the Logbook location filter.
 *
 * Replaces the hardcoded ["Main Room", "Garage Rack", "Outdoor Ponds"] chip
 * list with groups the keeper names themselves.
 *
 * MODEL
 * -----
 * A group is just a name. Membership lives on the tank record's existing
 * `facility` field — the top-level segment of the facility › room › rack
 * breadcrumb — so assignment writes to the field that already carried this
 * meaning (and already rides along to the relayer/chain), rather than
 * introducing a parallel source of truth that could disagree with it.
 *
 * `facility` is the ONLY field consulted for membership. The previous filter
 * matched `facility || room || rack`, which meant one tank could satisfy three
 * different chips at once and every chip count was potentially inflated. Room
 * and rack stay what they are: sub-location detail inside a group.
 *
 * The `tankGroups` Dexie table (v25) exists only to remember groups that
 * currently hold zero tanks. Everything else is derived from the tanks
 * themselves, so groups can never drift out of sync with reality.
 */

/** Sentinel for the "show everything" chip. Not a real group name. */
export const ALL_GROUPS = "All";
/** Sentinel for tanks with no group assigned. Not a real group name. */
export const UNASSIGNED = "__unassigned__";
/** Keeps chip labels readable and DB keys sane. */
export const MAX_GROUP_NAME_LENGTH = 40;

/** Collapse whitespace, trim, and clamp length. Returns "" for empty input. */
export function normalizeGroupName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME_LENGTH);
}

/** The group a tank belongs to, or "" when it hasn't been assigned one. */
export function tankGroupName(tank) {
  return normalizeGroupName(tank?.facility);
}

/**
 * Does this tank belong in the chip for `group`?
 * Handles both sentinels. Name comparison is case-insensitive so "Fish room"
 * and "Fish Room" are the same group, matching the duplicate guard on create.
 */
export function tankInGroup(tank, group) {
  if (!group || group === ALL_GROUPS) return true;
  const actual = tankGroupName(tank);
  if (group === UNASSIGNED) return actual === "";
  return actual.toLowerCase() === normalizeGroupName(group).toLowerCase();
}

/** Tanks belonging to `group`. */
export function filterTanksByGroup(tanks, group) {
  if (!group || group === ALL_GROUPS) return tanks || [];
  return (tanks || []).filter((t) => tankInGroup(t, group));
}

/** Count of tanks with no group — drives whether the "Unassigned" chip shows. */
export function countUnassigned(tanks) {
  return (tanks || []).filter((t) => tankGroupName(t) === "").length;
}

/**
 * Wallet may be absent (Privy-only / pre-connect), so fall back to a stable
 * local key. Lowercased because wallet casing varies between providers.
 */
function ownerKey(walletAccount) {
  return String(walletAccount || "local").toLowerCase();
}

/** Persisted (hand-created) groups for this owner, in display order. */
export async function loadCustomGroups(walletAccount) {
  try {
    const rows = await db.tankGroups.where("ownerAddress").equals(ownerKey(walletAccount)).toArray();
    return rows.sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    );
  } catch (e) {
    console.warn("[tankGroups] failed to load custom groups:", e?.message);
    return [];
  }
}

/**
 * The chip list: hand-created groups first (in the order they were made), then
 * any group names discovered on tanks but never explicitly created — e.g.
 * legacy records, or tanks registered before this feature existed. Duplicates
 * are collapsed case-insensitively, keeping the persisted spelling.
 */
export function mergeGroups(customRows, tanks) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const clean = normalizeGroupName(name);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  (customRows || []).forEach((r) => push(r?.name));
  (tanks || [])
    .map(tankGroupName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .forEach(push);
  return out;
}

/**
 * Create a group. Idempotent on name (case-insensitive).
 * Throws with a user-facing message on empty or duplicate names.
 */
export async function createGroup(walletAccount, name, existingGroups = []) {
  const clean = normalizeGroupName(name);
  if (!clean) throw new Error("Give the group a name first.");
  if (clean === ALL_GROUPS) throw new Error(`"${ALL_GROUPS}" is reserved — pick another name.`);
  const dupe = (existingGroups || []).some((g) => normalizeGroupName(g).toLowerCase() === clean.toLowerCase());
  if (dupe) throw new Error(`You already have a group called "${clean}".`);

  const owner = ownerKey(walletAccount);
  const existing = await loadCustomGroups(walletAccount);
  const sortOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0) + 1;
  await db.tankGroups.put({ ownerAddress: owner, name: clean, createdAt: Date.now(), sortOrder });
  return clean;
}

/**
 * Write a tank's group assignment.
 *
 * On-chain-only tanks aren't in Dexie, so `update` matches nothing. In that
 * case the merged tank object is written through as a local record, which is
 * what makes the assignment durable (useUserTanks dedupes local over chain).
 * Pass `""` to un-assign.
 */
export async function assignTankToGroup(tank, group) {
  if (!tank || tank.id == null) throw new Error("Unknown tank.");
  const clean = group === UNASSIGNED ? "" : normalizeGroupName(group);
  const patch = { facility: clean };
  const updated = await db.tanks.update(Number(tank.id), patch);
  if (!updated) {
    await db.tanks.put({ ...tank, ...patch });
  }
  return clean;
}

/**
 * Rename a group everywhere: the persisted row (created if the group was only
 * ever derived from tanks) and every tank currently assigned to it.
 * Returns the number of tanks re-pointed.
 */
export async function renameGroup(walletAccount, oldName, newName, tanks = [], existingGroups = []) {
  const from = normalizeGroupName(oldName);
  const to = normalizeGroupName(newName);
  if (!to) throw new Error("Give the group a name first.");
  if (to === ALL_GROUPS) throw new Error(`"${ALL_GROUPS}" is reserved — pick another name.`);
  if (!from) throw new Error("Unknown group.");
  if (from === to) return 0;

  const clashes = (existingGroups || []).some(
    (g) =>
      normalizeGroupName(g).toLowerCase() === to.toLowerCase() &&
      normalizeGroupName(g).toLowerCase() !== from.toLowerCase()
  );
  if (clashes) throw new Error(`You already have a group called "${to}".`);

  const owner = ownerKey(walletAccount);
  const previous = await db.tankGroups.get([owner, from]).catch(() => null);
  await db.tankGroups.put({
    ownerAddress: owner,
    name: to,
    createdAt: previous?.createdAt ?? Date.now(),
    sortOrder: previous?.sortOrder ?? Date.now(),
  });
  if (previous) await db.tankGroups.delete([owner, from]);

  const members = (tanks || []).filter((t) => tankInGroup(t, from));
  for (const t of members) {
    await assignTankToGroup(t, to);
  }
  return members.length;
}

/**
 * Delete a group. Tanks are never deleted — they're un-assigned and fall into
 * the "Unassigned" chip, so a mis-click can't lose a unit.
 * Returns the number of tanks un-assigned.
 */
export async function deleteGroup(walletAccount, name, tanks = []) {
  const clean = normalizeGroupName(name);
  if (!clean) throw new Error("Unknown group.");
  const owner = ownerKey(walletAccount);
  await db.tankGroups.delete([owner, clean]).catch(() => {});

  const members = (tanks || []).filter((t) => tankInGroup(t, clean));
  for (const t of members) {
    await assignTankToGroup(t, "");
  }
  return members.length;
}
