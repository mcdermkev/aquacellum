/**
 * Service pros (docs/SERVICE_PROS_SPEC.md): input validation, due dates, the
 * client's public projection, and the authorization properties of the
 * handlers (every query scoped to the session wallet; the public history
 * never reads or returns private fields).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  cleanClientInput, cleanReadings, cleanSiteInput, cleanTankInput, cleanVisitInput, createServiceProHandlers,
  publicHistory, SERVICE_TASKS, tankDue,
} from "../../api/_lib/servicePros.js";
import { resolveCommerceRoute } from "../services/commerceRoute.js";
import { readingsSummary, TASK_LABELS, volumeLabel } from "../services/serviceProApi.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const SQL = read("../../supabase/migrations/20260930_service_pros.sql");
const PRO = "0x" + "a".repeat(40);
const OTHER = "0x" + "b".repeat(40);
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const TANK_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "A".repeat(32);
const NOW = Date.parse("2026-09-30T12:00:00Z");

// ─── A chainable fake of the supabase query builder that records every call ───
function fakeSupabase(respond) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, ops: [] };
      calls.push(q);
      const b = new Proxy({}, {
        get(_, prop) {
          if (prop === "then") {
            const r = respond(q);
            return (ok, bad) => Promise.resolve(r).then(ok, bad);
          }
          return (...args) => { q.ops.push([prop, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const op = (q, name) => q.ops.filter((o) => o[0] === name);
const scopedTo = (q, wallet) => op(q, "eq").some(([, col, v]) => col === "pro_wallet" && v === wallet);

function fakeRes() {
  const r = { statusCode: null, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

function handlers(supabase, wallet = PRO) {
  return createServiceProHandlers({
    supabase,
    requireWalletFromSession: async () => wallet,
    preamble: () => true,
    parseJsonBody: (req) => req.body || {},
    displayNames: async () => ({ [PRO]: "Reef Pros LLC" }),
    setCorsHeaders: () => {},
    newShareToken: () => "N".repeat(32),
  });
}

describe("input validation", () => {
  it("clients need a name; a bad email is refused", () => {
    expect(cleanClientInput({}).error).toMatch(/name/i);
    expect(cleanClientInput({ name: "Harbor Dental", email: "nope" }).error).toMatch(/email/i);
    expect(cleanClientInput({ name: " Harbor Dental ", email: "Front@Harbor.com" }).value).toMatchObject({ name: "Harbor Dental", email: "front@harbor.com" });
    expect(cleanSiteInput({ name: "" }).error).toBeTruthy();
  });
  it("tanks: kind falls back, volume and schedule are bounded", () => {
    expect(cleanTankInput({ name: "Lobby", kind: "lava" }).value.kind).toBe("freshwater");
    expect(cleanTankInput({ name: "Lobby", volumeLiters: -3 }).error).toBeTruthy();
    expect(cleanTankInput({ name: "Lobby", visitEveryDays: 400 }).error).toBeTruthy();
    expect(cleanTankInput({ name: "Lobby", volumeLiters: "283.9", visitEveryDays: "14" }).value).toMatchObject({ volume_liters: 283.9, visit_every_days: 14 });
  });
  it("readings keep known keys in range, with the temperature's unit", () => {
    expect(cleanReadings({ ph: "7.2", nitrate: 10, bogus: 5 }).value).toEqual({ ph: 7.2, nitrate: 10 });
    expect(cleanReadings({ ph: 15 }).error).toMatch(/ph/);
    expect(cleanReadings({ temp: 78 }).value).toEqual({ temp: 78, tempUnit: "F" });
    expect(cleanReadings({ temp: 78, tempUnit: "C" }).error).toMatch(/°C/);
    expect(cleanReadings({ temp: 25.5, tempUnit: "C" }).value).toEqual({ temp: 25.5, tempUnit: "C" });
    expect(cleanReadings("x").value).toEqual({});
  });
  it("visits: not in the future, not over a year back, and not empty", () => {
    expect(cleanVisitInput({ tasks: ["feed"], visitedAt: new Date(NOW + 2 * 3600000).toISOString() }, NOW).error).toMatch(/future/);
    expect(cleanVisitInput({ tasks: ["feed"], visitedAt: new Date(NOW - 400 * 86400000).toISOString() }, NOW).error).toMatch(/year/);
    expect(cleanVisitInput({ tasks: ["made_up"] }, NOW).error).toMatch(/at least one/);
    const v = cleanVisitInput({ tasks: ["glass_clean", "glass_clean", "hack"], waterChangePercent: 25, privateNote: " code 1234 " }, NOW).value;
    expect(v.tasks).toEqual(["glass_clean", "water_change"]);
    expect(v.water_change_percent).toBe(25);
    expect(v.private_note).toBe("code 1234");
  });
  it("every task has a label, and the migration allows exactly these tasks", () => {
    for (const t of SERVICE_TASKS) {
      expect(TASK_LABELS[t]).toBeTruthy();
      expect(SQL).toContain(`'${t}'`);
    }
    expect(Object.keys(TASK_LABELS).sort()).toEqual([...SERVICE_TASKS].sort());
  });
});

describe("due dates", () => {
  const day = 86400000;
  it("unscheduled, never visited, overdue, due soon, ok", () => {
    expect(tankDue({}, NOW).status).toBe("unscheduled");
    expect(tankDue({ visit_every_days: 7 }, NOW)).toMatchObject({ status: "overdue", neverVisited: true });
    expect(tankDue({ visit_every_days: 7, last_visit_at: new Date(NOW - 8 * day).toISOString() }, NOW).status).toBe("overdue");
    expect(tankDue({ visit_every_days: 7, last_visit_at: new Date(NOW - 6 * day).toISOString() }, NOW).status).toBe("due_soon");
    expect(tankDue({ visit_every_days: 14, last_visit_at: new Date(NOW - 1 * day).toISOString() }, NOW).status).toBe("ok");
  });
});

describe("the client's public projection", () => {
  const client = { id: CLIENT_ID, name: "Harbor Dental", pro_wallet: PRO, phone: "555-0100", email: "front@harbor.com", notes: "PRIVATE-CLIENT-NOTE", share_token: TOKEN };
  const sites = [
    { id: SITE_ID, name: "Main", address: "1 Harbor Way", access_notes: "GATE-CODE-4321" },
    { id: "44444444-4444-4444-8444-444444444444", name: "Old", archived_at: "2026-01-01T00:00:00Z" },
  ];
  const tanks = [
    { id: TANK_ID, site_id: SITE_ID, name: "Lobby", kind: "reef", volume_liters: "283.9", livestock: "Clownfish", equipment: "PRIVATE-EQUIPMENT", visit_every_days: 7, last_visit_at: "2026-09-25T10:00:00Z" },
    { id: "55555555-5555-4555-8555-555555555555", site_id: SITE_ID, name: "Gone", archived_at: "2026-01-01T00:00:00Z" },
  ];
  const visits = [
    { id: "v1", tank_id: TANK_ID, visited_at: "2026-09-25T10:00:00Z", tasks: ["water_change"], water_change_percent: 20, readings: { ph: 8.2 }, client_note: "Looking great", private_note: "PRIVATE-VISIT-NOTE", logged_by: PRO },
    { id: "v2", tank_id: "55555555-5555-4555-8555-555555555555", visited_at: "2026-01-01T00:00:00Z", tasks: ["feed"], client_note: "ARCHIVED-TANK-VISIT" },
  ];
  const out = publicHistory({ client, sites, tanks, visits, proName: "Reef Pros LLC" });
  const json = JSON.stringify(out);

  it("never includes private notes, access notes, contact details, equipment, tokens or wallets", () => {
    for (const secret of ["PRIVATE-VISIT-NOTE", "GATE-CODE-4321", "555-0100", "front@harbor.com", "PRIVATE-CLIENT-NOTE", "PRIVATE-EQUIPMENT", TOKEN, PRO, "1 Harbor Way"]) {
      expect(json).not.toContain(secret);
    }
  });
  it("shows the live tanks, their visits and the client-facing notes", () => {
    expect(out.client).toEqual({ name: "Harbor Dental" });
    expect(out.pro).toEqual({ name: "Reef Pros LLC" });
    expect(out.sites.map((s) => s.name)).toEqual(["Main"]);
    expect(out.tanks).toHaveLength(1);
    expect(out.tanks[0]).toMatchObject({ name: "Lobby", volumeLiters: 283.9, livestock: "Clownfish", nextDueAt: "2026-10-02T10:00:00.000Z" });
    expect(out.visits).toEqual([{ id: "v1", tankId: TANK_ID, visitedAt: "2026-09-25T10:00:00Z", tasks: ["water_change"], waterChangePercent: 20, readings: { ph: 8.2 }, note: "Looking great" }]);
    expect(json).not.toContain("ARCHIVED-TANK-VISIT");
  });
});

describe("handlers: every pro read and write is scoped to the session wallet", () => {
  it("client detail scopes all four tables and hides the raw token", async () => {
    const sb = fakeSupabase((q) => (q.table === "service_clients"
      ? { data: { id: CLIENT_ID, name: "Harbor", share_token: TOKEN, share_enabled: true } }
      : { data: [] }));
    const res = fakeRes();
    await handlers(sb).client({ query: { id: CLIENT_ID } }, res);
    expect(res.statusCode).toBe(200);
    expect(sb.calls.map((c) => c.table).sort()).toEqual(["service_clients", "service_sites", "service_tanks", "service_visits"]);
    for (const q of sb.calls) expect(scopedTo(q, PRO), q.table).toBe(true);
    expect(res.body.client).not.toHaveProperty("share_token");
    expect(res.body.client.shareUrl).toBe(`https://aquacellum.com/app/service/view/${TOKEN}`);
  });

  it("someone else's client is a 404", async () => {
    const sb = fakeSupabase(() => ({ data: null }));
    const res = fakeRes();
    await handlers(sb, OTHER).client({ query: { id: CLIENT_ID } }, res);
    expect(res.statusCode).toBe(404);
    expect(scopedTo(sb.calls[0], OTHER)).toBe(true);
  });

  it("a visit is logged by the session wallet on a tank looked up with that wallet", async () => {
    const sb = fakeSupabase((q) => (q.table === "service_tanks" ? { data: { id: TANK_ID, client_id: CLIENT_ID } } : { data: { id: "v9" } }));
    const res = fakeRes();
    await handlers(sb).visitAdd({ body: { tankId: TANK_ID, tasks: ["feed"], logged_by: OTHER, pro_wallet: OTHER, client_id: "x" } }, res);
    expect(res.statusCode).toBe(200);
    const [lookup, insert] = sb.calls;
    expect(scopedTo(lookup, PRO)).toBe(true);
    const row = op(insert, "insert")[0][1];
    expect(row).toMatchObject({ tank_id: TANK_ID, client_id: CLIENT_ID, pro_wallet: PRO, logged_by: PRO });
  });

  it("an archived tank takes no new visits", async () => {
    const sb = fakeSupabase(() => ({ data: { id: TANK_ID, client_id: CLIENT_ID, archived_at: "2026-01-01" } }));
    const res = fakeRes();
    await handlers(sb).visitAdd({ body: { tankId: TANK_ID, tasks: ["feed"] } }, res);
    expect(res.statusCode).toBe(404);
    expect(sb.calls).toHaveLength(1);
  });

  it("a new tank takes its client from the pro's own site, never from the request", async () => {
    const sb = fakeSupabase((q) => (q.table === "service_sites" ? { data: { id: SITE_ID, client_id: CLIENT_ID } } : { data: { id: TANK_ID } }));
    const res = fakeRes();
    await handlers(sb).tankSave({ body: { siteId: SITE_ID, clientId: "99999999-9999-4999-8999-999999999999", name: "Lobby" } }, res);
    expect(res.statusCode).toBe(200);
    expect(scopedTo(sb.calls[0], PRO)).toBe(true);
    expect(op(sb.calls[1], "insert")[0][1]).toMatchObject({ site_id: SITE_ID, client_id: CLIENT_ID, pro_wallet: PRO });
  });

  it("a site under someone else's client fails on the database's ownership key", async () => {
    const sb = fakeSupabase(() => ({ data: null, error: { code: "23503", message: "fk" } }));
    const res = fakeRes();
    await handlers(sb).siteSave({ body: { clientId: CLIENT_ID, name: "Annex" } }, res);
    expect(res.statusCode).toBe(404);
    expect(op(sb.calls[0], "insert")[0][1]).toMatchObject({ client_id: CLIENT_ID, pro_wallet: PRO });
  });

  it("updates and deletes are scoped by id and wallet", async () => {
    for (const [fn, body] of [
      ["clientSave", { id: CLIENT_ID, name: "Harbor" }],
      ["clientArchive", { id: CLIENT_ID }],
      ["siteSave", { id: SITE_ID, name: "Main" }],
      ["tankSave", { id: TANK_ID, name: "Lobby" }],
      ["visitDelete", { id: TANK_ID }],
    ]) {
      const sb = fakeSupabase(() => ({ data: fn === "visitDelete" ? [{ id: TANK_ID }] : { id: body.id } }));
      const res = fakeRes();
      await handlers(sb)[fn]({ body }, res);
      expect(res.statusCode, fn).toBe(200);
      expect(scopedTo(sb.calls[0], PRO), fn).toBe(true);
      expect(op(sb.calls[0], "eq").some(([, c, v]) => c === "id" && v === body.id), fn).toBe(true);
    }
  });

  it("archiving a client turns its link off", async () => {
    const sb = fakeSupabase(() => ({ data: { id: CLIENT_ID } }));
    await handlers(sb).clientArchive({ body: { id: CLIENT_ID } }, fakeRes());
    expect(op(sb.calls[0], "update")[0][1]).toMatchObject({ share_enabled: false });
  });

  it("sharing makes a token once, keeps it, and replaces it only when asked", async () => {
    const run = async (existing, body) => {
      const sb = fakeSupabase((q) => (op(q, "update").length ? { data: { share_token: op(q, "update")[0][1].share_token, share_enabled: op(q, "update")[0][1].share_enabled } } : { data: { id: CLIENT_ID, share_token: existing } }));
      const res = fakeRes();
      await handlers(sb).share({ body: { clientId: CLIENT_ID, ...body } }, res);
      return res.body.shareUrl;
    };
    expect(await run(null, { enabled: true })).toMatch(/\/view\/N{32}$/);
    expect(await run(TOKEN, { enabled: true })).toMatch(new RegExp(`/view/${TOKEN}$`));
    expect(await run(TOKEN, { enabled: true, rotate: true })).toMatch(/\/view\/N{32}$/);
    expect(await run(TOKEN, { enabled: false })).toBeNull();
  });
});

describe("handlers: the public history", () => {
  const history = async (clientRow) => {
    const sb = fakeSupabase((q) => (q.table === "service_clients" ? { data: clientRow } : { data: [] }));
    const res = fakeRes();
    await handlers(sb).history({ method: "GET", query: { t: TOKEN } }, res);
    return { res, sb };
  };
  it("unknown, turned off and archived are the same 404", async () => {
    expect((await history(null)).res.statusCode).toBe(404);
    expect((await history({ id: CLIENT_ID, pro_wallet: PRO, name: "H", share_enabled: false })).res.statusCode).toBe(404);
    expect((await history({ id: CLIENT_ID, pro_wallet: PRO, name: "H", share_enabled: true, archived_at: "2026-01-01" })).res.statusCode).toBe(404);
  });
  it("a malformed token never reaches the database", async () => {
    const sb = fakeSupabase(() => ({ data: null }));
    const res = fakeRes();
    await handlers(sb).history({ method: "GET", query: { t: "short" } }, res);
    expect(res.statusCode).toBe(404);
    expect(sb.calls).toHaveLength(0);
  });
  it("reads by token, never selects private columns, and isn't cached or indexed", async () => {
    const { res, sb } = await history({ id: CLIENT_ID, pro_wallet: PRO, name: "Harbor", share_enabled: true });
    expect(res.statusCode).toBe(200);
    expect(op(sb.calls[0], "eq")).toContainEqual(["eq", "share_token", TOKEN]);
    const selected = sb.calls.map((q) => op(q, "select")[0]?.[1] || "").join(" ");
    for (const col of ["private_note", "access_notes", "phone", "email", "notes", "equipment", "share_token"]) {
      expect(selected).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
    for (const q of sb.calls.slice(1)) expect(scopedTo(q, PRO), q.table).toBe(true);
    expect(res.headers["Cache-Control"]).toMatch(/no-store/);
    expect(res.headers["X-Robots-Tag"]).toMatch(/noindex/);
    expect(res.body.pro).toEqual({ name: "Reef Pros LLC" });
  });
});

describe("the migration", () => {
  it("links every child to its parent by (id, client, pro) so ownership can't be mixed", () => {
    expect(SQL).toMatch(/foreign key \(client_id, pro_wallet\) references public\.service_clients \(id, pro_wallet\)/);
    expect(SQL).toMatch(/foreign key \(site_id, client_id, pro_wallet\) references public\.service_sites \(id, client_id, pro_wallet\)/);
    expect(SQL).toMatch(/foreign key \(tank_id, client_id, pro_wallet\) references public\.service_tanks \(id, client_id, pro_wallet\)/);
  });
  it("is server-only, and keeps last_visit_at in step with visits", () => {
    expect(SQL).toMatch(/revoke all on public\.service_clients, public\.service_sites, public\.service_tanks, public\.service_visits from anon, authenticated;/);
    expect(SQL).toMatch(/after insert or update of visited_at or delete on public\.service_visits/);
    expect(read("../../../supabase/migration-order.json")).toContain("frontend/supabase/migrations/20260930_service_pros.sql");
  });
  it("routes every action through the handlers", () => {
    const api = read("../../api/storefront-detail.js");
    for (const [action, fn] of [["service-home", "home"], ["service-client", "client"], ["service-client-save", "clientSave"], ["service-client-archive", "clientArchive"],
      ["service-site-save", "siteSave"], ["service-tank-save", "tankSave"], ["service-visit-add", "visitAdd"], ["service-visit-delete", "visitDelete"],
      ["service-share", "share"], ["service-history", "history"]]) {
      expect(api).toMatch(new RegExp(`case "${action}":\\s*return servicePro\\.${fn}\\(req, res\\);`));
    }
    expect(api).toMatch(/newShareToken: \(\) => crypto\.randomBytes\(24\)\.toString\("base64url"\)/);
  });
});

describe("routes and display helpers", () => {
  it("home, client and history are full screen; anything else is not found", () => {
    expect(resolveCommerceRoute("/app/service")).toMatchObject({ kind: "service-home", fullScreen: true });
    expect(resolveCommerceRoute(`/app/service/${CLIENT_ID}`)).toMatchObject({ kind: "service-client", clientId: CLIENT_ID, fullScreen: true });
    expect(resolveCommerceRoute(`/app/service/view/${TOKEN}`)).toMatchObject({ kind: "service-history", shareToken: TOKEN, fullScreen: true });
    expect(resolveCommerceRoute("/app/service/view/short").kind).toBe("not-found");
    expect(resolveCommerceRoute(`/app/service/${CLIENT_ID}/x`).kind).toBe("not-found");
    expect(resolveCommerceRoute("/app/service/nope").kind).toBe("not-found");
  });
  it("App renders the service views outside the shell", () => {
    const app = read("../App.jsx");
    expect(app).toMatch(/commerceRoute\?\.fullScreen && String\(commerceRoute\.kind\)\.startsWith\("service-"\)/);
  });
  it("summaries read naturally", () => {
    expect(readingsSummary({ temp: 78, tempUnit: "F", ph: 7.2, nitrate: 10 })).toBe("Temp 78 °F · pH 7.2 · Nitrate 10");
    expect(volumeLabel(283.9)).toBe("75 gal (284 L)");
    expect(volumeLabel(null)).toBe("");
  });
});
