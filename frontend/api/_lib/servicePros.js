/**
 * servicePros.js — tank maintenance for clients (docs/SERVICE_PROS_SPEC.md).
 *
 * A pro keeps clients → sites → tanks and logs service visits. A client can be
 * given a read-only history link. No money path.
 *
 * Authorization (Tier A):
 *   - Every pro endpoint takes the wallet from the verified session and filters
 *     every read and write by pro_wallet. Ids from the request are only ever
 *     looked up together with that wallet.
 *   - The database backs this up: composite foreign keys make a child row's
 *     pro_wallet match its parent's (20260930_service_pros.sql).
 *   - The public history reads by share token only, returns 404 for unknown,
 *     disabled or archived, and projects through `publicHistory`, which never
 *     includes private notes, access notes, contact details or wallets.
 *
 * Pure helpers (validation, projection, due dates) are exported for tests; the
 * handlers come from `createServiceProHandlers(deps)`.
 */

export const SERVICE_TASKS = Object.freeze([
  "water_change", "glass_clean", "gravel_vac", "filter_clean", "algae_scrub",
  "plant_trim", "top_off", "dose", "feed", "equipment_check", "livestock_check", "other",
]);
export const SERVICE_TANK_KINDS = Object.freeze(["freshwater", "planted", "brackish", "saltwater", "reef", "pond", "other"]);

/** Allowed readings and their plausible ranges. Temperature carries its unit. */
export const READING_RULES = Object.freeze({
  ph: [0, 14],
  ammonia: [0, 20],
  nitrite: [0, 20],
  nitrate: [0, 500],
  phosphate: [0, 50],
  gh: [0, 60],
  kh: [0, 60],
  salinity: [1.0, 1.04],
});
const TEMP_RANGE = { F: [32, 110], C: [0, 45] };

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUE_SOON_MS = 2 * 86400000;
const MAX_BACKDATE_MS = 366 * 86400000;
const MAX_CLIENT_VISITS = 300;
const MAX_HISTORY_VISITS = 200;

export function isUuid(v) {
  return UUID_RE.test(String(v || ""));
}

function text(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function need(v, max, label) {
  const s = text(v, max);
  return s ? { ok: s } : { error: `${label} is required.` };
}

/** { value } or { error } */
export function cleanClientInput(b = {}) {
  const name = need(b.name, 120, "Client name");
  if (name.error) return { error: name.error };
  const email = text(b.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email doesn't look right." };
  return {
    value: {
      name: name.ok,
      contact_name: text(b.contactName, 120),
      phone: text(b.phone, 40),
      email: email ? email.toLowerCase() : null,
      notes: text(b.notes, 2000),
    },
  };
}

export function cleanSiteInput(b = {}) {
  const name = need(b.name, 120, "Site name");
  if (name.error) return { error: name.error };
  return { value: { name: name.ok, address: text(b.address, 300), access_notes: text(b.accessNotes, 1000) } };
}

export function cleanTankInput(b = {}) {
  const name = need(b.name, 120, "Tank name");
  if (name.error) return { error: name.error };
  const kind = SERVICE_TANK_KINDS.includes(b.kind) ? b.kind : "freshwater";
  let volume = null;
  if (b.volumeLiters != null && b.volumeLiters !== "") {
    volume = Math.round(Number(b.volumeLiters) * 10) / 10;
    if (!(volume > 0 && volume <= 100000)) return { error: "Enter the volume in liters, or leave it blank." };
  }
  let every = null;
  if (b.visitEveryDays != null && b.visitEveryDays !== "") {
    every = Math.round(Number(b.visitEveryDays));
    if (!(every >= 1 && every <= 365)) return { error: "Visit every 1 to 365 days, or leave it blank." };
  }
  return {
    value: {
      name: name.ok, kind, volume_liters: volume,
      livestock: text(b.livestock, 2000), equipment: text(b.equipment, 2000), visit_every_days: every,
    },
  };
}

/** Readings: only known keys, only numbers in range. Unknown keys are dropped. */
export function cleanReadings(r = {}) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { value: {} };
  const out = {};
  for (const [key, [min, max]] of Object.entries(READING_RULES)) {
    if (r[key] == null || r[key] === "") continue;
    const n = Number(r[key]);
    if (!Number.isFinite(n) || n < min || n > max) return { error: `${key} should be between ${min} and ${max}.` };
    out[key] = n;
  }
  if (r.temp != null && r.temp !== "") {
    const unit = r.tempUnit === "C" ? "C" : "F";
    const n = Number(r.temp);
    const [min, max] = TEMP_RANGE[unit];
    if (!Number.isFinite(n) || n < min || n > max) return { error: `Temperature should be between ${min} and ${max} °${unit}.` };
    out.temp = n;
    out.tempUnit = unit;
  }
  return { value: out };
}

export function cleanVisitInput(b = {}, now = Date.now()) {
  const at = b.visitedAt ? Date.parse(String(b.visitedAt)) : now;
  if (!Number.isFinite(at)) return { error: "Pick when the visit happened." };
  if (at > now + 3600000) return { error: "A visit can't be in the future." };
  if (at < now - MAX_BACKDATE_MS) return { error: "Visits can be back-dated up to a year." };
  const tasks = [...new Set((Array.isArray(b.tasks) ? b.tasks : []).filter((t) => SERVICE_TASKS.includes(t)))];
  let pct = null;
  if (b.waterChangePercent != null && b.waterChangePercent !== "") {
    pct = Math.round(Number(b.waterChangePercent));
    if (!(pct >= 1 && pct <= 100)) return { error: "Water change should be 1 to 100%." };
    if (!tasks.includes("water_change")) tasks.push("water_change");
  }
  const readings = cleanReadings(b.readings);
  if (readings.error) return { error: readings.error };
  const clientNote = text(b.clientNote, 2000);
  const privateNote = text(b.privateNote, 2000);
  if (!tasks.length && !Object.keys(readings.value).length && !clientNote && !privateNote) {
    return { error: "Add at least one task, reading or note." };
  }
  return {
    value: {
      visited_at: new Date(at).toISOString(), tasks, water_change_percent: pct,
      readings: readings.value, client_note: clientNote, private_note: privateNote,
    },
  };
}

/** When a tank is next due, and how urgent that is. */
export function tankDue(tank, now = Date.now()) {
  const every = Number(tank?.visit_every_days) || 0;
  if (!every) return { status: "unscheduled", dueAt: null };
  const last = tank.last_visit_at ? Date.parse(tank.last_visit_at) : NaN;
  if (!Number.isFinite(last)) return { status: "overdue", dueAt: null, neverVisited: true };
  const dueAt = last + every * 86400000;
  const status = dueAt <= now ? "overdue" : dueAt - now <= DUE_SOON_MS ? "due_soon" : "ok";
  return { status, dueAt: new Date(dueAt).toISOString() };
}

/**
 * The client's read-only view. Built field by field from an allow-list, so a
 * column added later is never exposed by accident.
 */
export function publicHistory({ client, sites = [], tanks = [], visits = [], proName = null }) {
  const liveSites = sites.filter((s) => !s.archived_at);
  const siteIds = new Set(liveSites.map((s) => s.id));
  const liveTanks = tanks.filter((t) => !t.archived_at && siteIds.has(t.site_id));
  const tankIds = new Set(liveTanks.map((t) => t.id));
  return {
    client: { name: client.name },
    pro: { name: proName || null },
    sites: liveSites.map((s) => ({ id: s.id, name: s.name })),
    tanks: liveTanks.map((t) => ({
      id: t.id, siteId: t.site_id, name: t.name, kind: t.kind,
      volumeLiters: t.volume_liters == null ? null : Number(t.volume_liters),
      livestock: t.livestock || null,
      lastVisitAt: t.last_visit_at || null,
      nextDueAt: tankDue(t).dueAt,
    })),
    visits: visits
      .filter((v) => tankIds.has(v.tank_id))
      .slice(0, MAX_HISTORY_VISITS)
      .map((v) => ({
        id: v.id, tankId: v.tank_id, visitedAt: v.visited_at,
        tasks: Array.isArray(v.tasks) ? v.tasks : [],
        waterChangePercent: v.water_change_percent ?? null,
        readings: v.readings && typeof v.readings === "object" ? v.readings : {},
        note: v.client_note || null,
      })),
  };
}

// ─── Handlers ──────────────────────────────────────────────────────────────

const CLIENT_COLUMNS = "id, name, contact_name, phone, email, notes, share_token, share_enabled, archived_at, created_at, updated_at";
const SITE_COLUMNS = "id, client_id, name, address, access_notes, archived_at, created_at";
const TANK_COLUMNS = "id, site_id, client_id, name, kind, volume_liters, livestock, equipment, visit_every_days, last_visit_at, archived_at, created_at";
const VISIT_COLUMNS = "id, tank_id, client_id, visited_at, logged_by, tasks, water_change_percent, readings, client_note, private_note, created_at";

/**
 * @param {object} deps
 * @param {import('@supabase/supabase-js').SupabaseClient} deps.supabase - service role
 * @param {(req, res) => Promise<string|null>} deps.requireWalletFromSession
 * @param {(req, res, methods:string) => boolean} deps.preamble - CORS, no-store, method check
 * @param {(req) => object} deps.parseJsonBody
 * @param {(wallets:string[]) => Promise<Record<string,string>>} deps.displayNames
 * @param {(req, res, opts) => void} deps.setCorsHeaders
 * @param {() => string} deps.newShareToken - 32-char base64url
 * @param {string} [deps.appUrl]
 */
export function createServiceProHandlers(deps) {
  const { supabase, requireWalletFromSession, preamble, parseJsonBody, displayNames, setCorsHeaders, newShareToken } = deps;
  const appUrl = deps.appUrl || "https://aquacellum.com";
  const shareUrl = (c) => (c?.share_token && c.share_enabled ? `${appUrl}/app/service/view/${c.share_token}` : null);
  const fail = (res, status, error, code) => res.status(status).json({ error, ...(code ? { code } : {}) });
  const dbFail = (res, where, error) => {
    console.error(`[service-pros] ${where}:`, error?.message || error);
    return fail(res, 500, "Something went wrong. Try again.");
  };

  async function start(req, res, methods) {
    if (!preamble(req, res, methods)) return null;
    return requireWalletFromSession(req, res);
  }

  /** GET — my clients, and every tank that's due. */
  async function home(req, res) {
    const wallet = await start(req, res, "GET");
    if (!wallet) return;
    const [clientsR, tanksR] = await Promise.all([
      supabase.from("service_clients").select("id, name, contact_name, share_enabled, archived_at").eq("pro_wallet", wallet).order("name"),
      supabase.from("service_tanks").select("id, client_id, site_id, name, kind, visit_every_days, last_visit_at")
        .eq("pro_wallet", wallet).is("archived_at", null),
    ]);
    if (clientsR.error || tanksR.error) return dbFail(res, "home", clientsR.error || tanksR.error);
    const now = Date.now();
    const clients = (clientsR.data || []).map((c) => {
      const mine = (tanksR.data || []).filter((t) => t.client_id === c.id);
      const due = mine.map((t) => tankDue(t, now).status);
      return {
        id: c.id, name: c.name, contactName: c.contact_name, archived: !!c.archived_at, shared: c.share_enabled,
        tanks: mine.length, overdue: due.filter((s) => s === "overdue").length, dueSoon: due.filter((s) => s === "due_soon").length,
      };
    });
    const names = new Map(clients.map((c) => [c.id, c.name]));
    const archived = new Set(clients.filter((c) => c.archived).map((c) => c.id));
    const due = (tanksR.data || [])
      .filter((t) => !archived.has(t.client_id))
      .map((t) => ({ id: t.id, clientId: t.client_id, clientName: names.get(t.client_id) || "", name: t.name, lastVisitAt: t.last_visit_at, ...tankDue(t, now) }))
      .filter((t) => t.status === "overdue" || t.status === "due_soon")
      .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
    return res.status(200).json({ ok: true, clients, due });
  }

  /** GET ?id= — one client with its sites, tanks and recent visits. */
  async function client(req, res) {
    const wallet = await start(req, res, "GET");
    if (!wallet) return;
    const id = String(req.query?.id || "");
    if (!isUuid(id)) return fail(res, 400, "Invalid client.");
    const { data: c, error } = await supabase.from("service_clients").select(CLIENT_COLUMNS).eq("id", id).eq("pro_wallet", wallet).maybeSingle();
    if (error) return dbFail(res, "client", error);
    if (!c) return fail(res, 404, "Client not found.", "NOT_FOUND");
    const [sitesR, tanksR, visitsR] = await Promise.all([
      supabase.from("service_sites").select(SITE_COLUMNS).eq("client_id", id).eq("pro_wallet", wallet).order("created_at"),
      supabase.from("service_tanks").select(TANK_COLUMNS).eq("client_id", id).eq("pro_wallet", wallet).order("created_at"),
      supabase.from("service_visits").select(VISIT_COLUMNS).eq("client_id", id).eq("pro_wallet", wallet)
        .order("visited_at", { ascending: false }).limit(MAX_CLIENT_VISITS),
    ]);
    if (sitesR.error || tanksR.error || visitsR.error) return dbFail(res, "client detail", sitesR.error || tanksR.error || visitsR.error);
    const now = Date.now();
    // The raw token goes out only inside shareUrl, and only while sharing is on.
    const clientFields = { ...c };
    delete clientFields.share_token;
    return res.status(200).json({
      ok: true,
      client: { ...clientFields, shareUrl: shareUrl(c) },
      sites: sitesR.data || [],
      tanks: (tanksR.data || []).map((t) => ({ ...t, due: tankDue(t, now) })),
      visits: visitsR.data || [],
    });
  }

  /** POST { id?, name, contactName, phone, email, notes, siteName?, address? } */
  async function clientSave(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    const input = cleanClientInput(b);
    if (input.error) return fail(res, 400, input.error, "INVALID");
    if (b.id != null) {
      if (!isUuid(b.id)) return fail(res, 400, "Invalid client.");
      const { data, error } = await supabase.from("service_clients")
        .update({ ...input.value, updated_at: new Date().toISOString() })
        .eq("id", b.id).eq("pro_wallet", wallet).select("id").maybeSingle();
      if (error) return dbFail(res, "client update", error);
      if (!data) return fail(res, 404, "Client not found.", "NOT_FOUND");
      return res.status(200).json({ ok: true, clientId: data.id });
    }
    const site = cleanSiteInput({ name: text(b.siteName, 120) || "Main site", address: b.address });
    if (site.error) return fail(res, 400, site.error, "INVALID");
    const { data: created, error } = await supabase.from("service_clients")
      .insert({ ...input.value, pro_wallet: wallet }).select("id").single();
    if (error) return dbFail(res, "client insert", error);
    const { error: siteErr } = await supabase.from("service_sites")
      .insert({ ...site.value, client_id: created.id, pro_wallet: wallet });
    if (siteErr) {
      // No half-made client: take it back out.
      await supabase.from("service_clients").delete().eq("id", created.id).eq("pro_wallet", wallet);
      return dbFail(res, "first site insert", siteErr);
    }
    return res.status(200).json({ ok: true, clientId: created.id });
  }

  /** POST { id, archived } — archiving also turns the client's link off. */
  async function clientArchive(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    if (!isUuid(b.id)) return fail(res, 400, "Invalid client.");
    const archived = b.archived !== false;
    const { data, error } = await supabase.from("service_clients")
      .update({ archived_at: archived ? new Date().toISOString() : null, ...(archived ? { share_enabled: false } : {}), updated_at: new Date().toISOString() })
      .eq("id", b.id).eq("pro_wallet", wallet).select("id").maybeSingle();
    if (error) return dbFail(res, "client archive", error);
    if (!data) return fail(res, 404, "Client not found.", "NOT_FOUND");
    return res.status(200).json({ ok: true });
  }

  /** POST { id?, clientId, name, address, accessNotes, archived? } */
  async function siteSave(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    const input = cleanSiteInput(b);
    if (input.error) return fail(res, 400, input.error, "INVALID");
    if (b.id != null) {
      if (!isUuid(b.id)) return fail(res, 400, "Invalid site.");
      const patch = { ...input.value, ...(typeof b.archived === "boolean" ? { archived_at: b.archived ? new Date().toISOString() : null } : {}) };
      const { data, error } = await supabase.from("service_sites").update(patch).eq("id", b.id).eq("pro_wallet", wallet).select("id").maybeSingle();
      if (error) return dbFail(res, "site update", error);
      if (!data) return fail(res, 404, "Site not found.", "NOT_FOUND");
      return res.status(200).json({ ok: true, siteId: data.id });
    }
    if (!isUuid(b.clientId)) return fail(res, 400, "Invalid client.");
    const { data, error } = await supabase.from("service_sites")
      .insert({ ...input.value, client_id: b.clientId, pro_wallet: wallet }).select("id").single();
    // 23503: the (client, pro) pair doesn't exist, i.e. not this pro's client.
    if (error?.code === "23503") return fail(res, 404, "Client not found.", "NOT_FOUND");
    if (error) return dbFail(res, "site insert", error);
    return res.status(200).json({ ok: true, siteId: data.id });
  }

  /** POST { id?, siteId, name, kind, volumeLiters, livestock, equipment, visitEveryDays, archived? } */
  async function tankSave(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    const input = cleanTankInput(b);
    if (input.error) return fail(res, 400, input.error, "INVALID");
    const stamp = new Date().toISOString();
    if (b.id != null) {
      if (!isUuid(b.id)) return fail(res, 400, "Invalid tank.");
      const patch = { ...input.value, updated_at: stamp, ...(typeof b.archived === "boolean" ? { archived_at: b.archived ? stamp : null } : {}) };
      const { data, error } = await supabase.from("service_tanks").update(patch).eq("id", b.id).eq("pro_wallet", wallet).select("id").maybeSingle();
      if (error) return dbFail(res, "tank update", error);
      if (!data) return fail(res, 404, "Tank not found.", "NOT_FOUND");
      return res.status(200).json({ ok: true, tankId: data.id });
    }
    if (!isUuid(b.siteId)) return fail(res, 400, "Pick a site.");
    const { data: site, error: siteErr } = await supabase.from("service_sites").select("id, client_id")
      .eq("id", b.siteId).eq("pro_wallet", wallet).maybeSingle();
    if (siteErr) return dbFail(res, "tank site lookup", siteErr);
    if (!site) return fail(res, 404, "Site not found.", "NOT_FOUND");
    const { data, error } = await supabase.from("service_tanks")
      .insert({ ...input.value, site_id: site.id, client_id: site.client_id, pro_wallet: wallet }).select("id").single();
    if (error) return dbFail(res, "tank insert", error);
    return res.status(200).json({ ok: true, tankId: data.id });
  }

  /** POST { tankId, visitedAt, tasks, waterChangePercent, readings, clientNote, privateNote } */
  async function visitAdd(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    if (!isUuid(b.tankId)) return fail(res, 400, "Invalid tank.");
    const input = cleanVisitInput(b);
    if (input.error) return fail(res, 400, input.error, "INVALID");
    const { data: tank, error: tankErr } = await supabase.from("service_tanks").select("id, client_id, archived_at")
      .eq("id", b.tankId).eq("pro_wallet", wallet).maybeSingle();
    if (tankErr) return dbFail(res, "visit tank lookup", tankErr);
    if (!tank || tank.archived_at) return fail(res, 404, "Tank not found.", "NOT_FOUND");
    const { data, error } = await supabase.from("service_visits")
      .insert({ ...input.value, tank_id: tank.id, client_id: tank.client_id, pro_wallet: wallet, logged_by: wallet })
      .select("id").single();
    if (error) return dbFail(res, "visit insert", error);
    return res.status(200).json({ ok: true, visitId: data.id });
  }

  /** POST { id } — a mistaken entry. */
  async function visitDelete(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    if (!isUuid(b.id)) return fail(res, 400, "Invalid visit.");
    const { data, error } = await supabase.from("service_visits").delete().eq("id", b.id).eq("pro_wallet", wallet).select("id");
    if (error) return dbFail(res, "visit delete", error);
    if (!data?.length) return fail(res, 404, "Visit not found.", "NOT_FOUND");
    return res.status(200).json({ ok: true });
  }

  /** POST { clientId, enabled, rotate? } — turn the client's link on or off, or replace it. */
  async function share(req, res) {
    const wallet = await start(req, res, "POST");
    if (!wallet) return;
    const b = parseJsonBody(req);
    if (!isUuid(b.clientId)) return fail(res, 400, "Invalid client.");
    const { data: c, error } = await supabase.from("service_clients").select("id, share_token, archived_at")
      .eq("id", b.clientId).eq("pro_wallet", wallet).maybeSingle();
    if (error) return dbFail(res, "share lookup", error);
    if (!c) return fail(res, 404, "Client not found.", "NOT_FOUND");
    const enabled = b.enabled === true;
    if (enabled && c.archived_at) return fail(res, 409, "Restore this client before sharing.", "ARCHIVED");
    const token = enabled && (!c.share_token || b.rotate === true) ? newShareToken() : c.share_token;
    const { data: updated, error: upErr } = await supabase.from("service_clients")
      .update({ share_enabled: enabled, share_token: token, updated_at: new Date().toISOString() })
      .eq("id", c.id).eq("pro_wallet", wallet).select("share_token, share_enabled").single();
    if (upErr) return dbFail(res, "share update", upErr);
    return res.status(200).json({ ok: true, shareUrl: shareUrl(updated) });
  }

  /** GET ?t= — public, read-only history for the client. */
  async function history(req, res) {
    setCorsHeaders(req, res, { methods: "GET, OPTIONS" });
    // A client's record; never cached by a shared cache, so turning the link off
    // takes effect straight away. Not for search engines.
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") return fail(res, 405, "method_not_allowed");
    const token = String(req.query?.t || "");
    if (!SHARE_TOKEN_RE.test(token)) return fail(res, 404, "not_found");
    const { data: c, error } = await supabase.from("service_clients")
      .select("id, pro_wallet, name, share_enabled, archived_at").eq("share_token", token).maybeSingle();
    if (error) return dbFail(res, "history lookup", error);
    // Unknown, turned off and archived all look the same.
    if (!c || c.share_enabled !== true || c.archived_at) return fail(res, 404, "not_found");
    const [sitesR, tanksR, visitsR, names] = await Promise.all([
      supabase.from("service_sites").select("id, name, archived_at").eq("client_id", c.id).eq("pro_wallet", c.pro_wallet).order("created_at"),
      supabase.from("service_tanks").select("id, site_id, name, kind, volume_liters, livestock, visit_every_days, last_visit_at, archived_at")
        .eq("client_id", c.id).eq("pro_wallet", c.pro_wallet).order("created_at"),
      supabase.from("service_visits").select("id, tank_id, visited_at, tasks, water_change_percent, readings, client_note")
        .eq("client_id", c.id).eq("pro_wallet", c.pro_wallet).order("visited_at", { ascending: false }).limit(MAX_HISTORY_VISITS),
      displayNames([c.pro_wallet]),
    ]);
    if (sitesR.error || tanksR.error || visitsR.error) return dbFail(res, "history detail", sitesR.error || tanksR.error || visitsR.error);
    return res.status(200).json({
      ok: true,
      ...publicHistory({ client: c, sites: sitesR.data || [], tanks: tanksR.data || [], visits: visitsR.data || [], proName: names[c.pro_wallet] || null }),
    });
  }

  return { home, client, clientSave, clientArchive, siteSave, tankSave, visitAdd, visitDelete, share, history };
}
