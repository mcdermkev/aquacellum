/**
 * clubs-public.js — shared read path and helpers for the public club pages
 * (/clubs -> clubs.html, /clubs/<slug> -> club.html).
 *
 * Plain <script> global (`window.AquadexClubs`) like public-listings.js and
 * catalog-aliases.js, so the static pages can load it without a bundler and
 * src/__tests__/publicClubPages.test.js can require() it.
 *
 * Reads Supabase REST with the public anon key, the same way species.html
 * does. Every select names its columns. founder_wallet is never selected:
 * these pages show a club, not the people in it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node / vitest
  }
  root.AquadexClubs = api; // browser global
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var SB_URL = "https://yahsdztnvsykzecjatsl.supabase.co";
  var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaHNkenRudnN5a3plY2phdHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTQwMDgsImV4cCI6MjA5NjA3MDAwOH0.3anqDFU9hUjZg2AFWJlXSBbwSM-knNrmb-uQ_Baq98I";

  /** Columns the public pages read from `schools`. Not the founder's wallet, not settings. */
  var CLUB_COLUMNS = "id,name,slug,description,banner_url,school_type,is_invite_only,tracked_species,member_count,created_at,is_official";
  /** Columns read from `tides` (club events). */
  var TIDE_COLUMNS = "id,title,tide_type,start_time,end_time,status,host_school_id,settings";
  /** Columns read from the display-safe listings view. */
  var LISTING_COLUMNS = "id,seller_address,common_name,price,is_batch,created_at,seller_display_name,quantity_remaining,data";

  var SLUG_RE = /^[a-z0-9-]{1,80}$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Club names, descriptions and event titles are user-written. Escape before inserting as HTML. */
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** A club slug is lowercase letters, digits and hyphens. Anything else is not queried. */
  function isValidSlug(slug) {
    return typeof slug === "string" && SLUG_RE.test(slug) && /[a-z0-9]/.test(slug);
  }

  function isUuid(id) {
    return typeof id === "string" && UUID_RE.test(id);
  }

  /**
   * The slug from /clubs/<slug> (production rewrite) or ?slug= (club.html in
   * dev). Returns "" when missing; the caller validates with isValidSlug.
   */
  function slugFromLocation(loc) {
    var pathname = (loc && loc.pathname) || "";
    var search = (loc && loc.search) || "";
    var raw = "";
    var m = pathname.match(/^\/clubs\/([^/]+)\/?$/);
    if (m) {
      raw = m[1];
    } else {
      var params = new URLSearchParams(search);
      raw = params.get("slug") || "";
    }
    try { raw = decodeURIComponent(raw); } catch (e) { return ""; }
    return raw.trim().toLowerCase();
  }

  function clubUrl(slug) { return "/clubs/" + encodeURIComponent(slug); }
  /** Opens the club inside The Reef in the app. */
  function joinUrl(slug) { return "/app/reef?club=" + encodeURIComponent(slug); }
  /** Opens an event inside The Reef in the app. */
  function eventUrl(id) { return "/app/reef?event=" + encodeURIComponent(id); }
  var START_CLUB_URL = "/app/reef?tab=clubs";

  /** https URLs or same-origin paths only; anything else is dropped. */
  function safeImageUrl(value, origin) {
    if (!value || typeof value !== "string") return "";
    try {
      var base = origin || (typeof window !== "undefined" ? window.location.origin : "https://aquacellum.com");
      var url = new URL(value, base);
      if (url.protocol === "https:" || url.origin === base) return url.href;
    } catch (e) { /* not a URL */ }
    return "";
  }

  /** Up to two initials for the gradient banner. */
  function initials(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "C";
    var out = words.slice(0, 2).map(function (w) { return w.charAt(0); }).join("");
    return out.toUpperCase();
  }

  /** A stable hue offset per club so the fallback banners are not all identical. */
  function bannerHue(slug) {
    var s = String(slug || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 166 + (h % 18); // stays in the teal range
  }

  function memberLabel(n) {
    var count = Math.max(0, Number(n) || 0);
    return count + (count === 1 ? " member" : " members");
  }

  var TYPE_LABELS = { species: "Species club", regional: "Regional", breeding: "Breeding", club: "Club" };
  function typeLabel(type) {
    return TYPE_LABELS[type] || "";
  }

  /** "July 2026" from created_at. Empty when the date is missing or bad. */
  /** Postgres timestamps: accepts "2026-07-11 19:49:03+00" as well as ISO. */
  function parseTimestamp(value) {
    if (!value) return null;
    var s = String(value).trim().replace(" ", "T").replace(/(T[\d:.]+[+-]\d{2})$/, "$1:00");
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatMonthYear(iso) {
    var d = parseTimestamp(iso);
    if (!d) return "";
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  /** tracked_species entries as { specCode, commonName, scientificName }. */
  function trackedSpecies(club) {
    var list = club && Array.isArray(club.tracked_species) ? club.tracked_species : [];
    var out = [];
    list.forEach(function (t) {
      if (t && typeof t === "object") {
        var code = Number(t.specCode);
        out.push({
          specCode: Number.isInteger(code) && code > 0 ? code : null,
          commonName: String(t.commonName || "").trim(),
          scientificName: String(t.scientificName || "").trim(),
        });
      } else if (typeof t === "string" && t.trim()) {
        out.push({ specCode: null, commonName: "", scientificName: t.trim() });
      }
    });
    return out;
  }

  /** Official clubs first, then most members, then name. */
  function sortClubs(clubs) {
    return (clubs || []).slice().sort(function (a, b) {
      var off = (b.is_official ? 1 : 0) - (a.is_official ? 1 : 0);
      if (off) return off;
      var mem = (Number(b.member_count) || 0) - (Number(a.member_count) || 0);
      if (mem) return mem;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function toTime(iso) {
    var d = parseTimestamp(iso);
    return d ? d.getTime() : NaN;
  }

  /**
   * Upcoming: start_time >= now and status not ended or cancelled, plus any
   * event that has started, has not reached its end_time and is not ended
   * (shown as happening now). Everything else is past, newest first.
   */
  function splitEvents(tides, now) {
    var t0 = typeof now === "number" ? now : Date.now();
    var upcoming = [];
    var past = [];
    (tides || []).forEach(function (tide) {
      if (!tide) return;
      var start = toTime(tide.start_time);
      var end = toTime(tide.end_time);
      var closed = tide.status === "ended" || tide.status === "cancelled";
      if (!closed && start >= t0) {
        upcoming.push(tide);
      } else if (!closed && start < t0 && (tide.status === "live" || end > t0)) {
        upcoming.push(Object.assign({}, tide, { _live: true }));
      } else {
        past.push(tide);
      }
    });
    upcoming.sort(function (a, b) { return toTime(a.start_time) - toTime(b.start_time); });
    past.sort(function (a, b) { return toTime(b.start_time) - toTime(a.start_time); });
    return { upcoming: upcoming, past: past };
  }

  /**
   * Does a listing belong to one of the club's species? Exact scientific name
   * (case-insensitive) or a catalog specCode the club tracks, including old
   * codes a record replaced. `species_id` on listings is not a catalog code.
   */
  function listingMatches(listing, match) {
    if (!listing || !match) return false;
    var sci = String(listing.scientificName || "").trim().toLowerCase();
    if (sci && match.names && match.names.has(sci)) return true;
    var code = Number(listing.specCode);
    return Number.isInteger(code) && code > 0 && !!match.codes && match.codes.has(code);
  }

  /** "Updated just now" / "Updated 3 min ago". */
  function updatedLabel(sinceMs) {
    var mins = Math.floor(Math.max(0, sinceMs) / 60000);
    if (mins < 1) return "Updated just now";
    if (mins < 60) return "Updated " + mins + " min ago";
    var hours = Math.floor(mins / 60);
    return "Updated " + hours + (hours === 1 ? " hour ago" : " hours ago");
  }

  function headers() {
    return { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
  }

  /** GET a PostgREST path (no leading slash). Throws on HTTP errors. */
  function restGet(path) {
    return fetch(SB_URL + "/rest/v1/" + path, { headers: headers() }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function fetchClubs() {
    return restGet("schools?select=" + CLUB_COLUMNS + "&order=member_count.desc&limit=500").then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    });
  }

  /** One club by slug, or null. Refuses to query an invalid slug. */
  function fetchClubBySlug(slug) {
    if (!isValidSlug(slug)) return Promise.resolve(null);
    return restGet("schools?select=" + CLUB_COLUMNS + "&slug=eq." + encodeURIComponent(slug) + "&limit=1").then(function (rows) {
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    });
  }

  /** Every event the club hosts (split with splitEvents). */
  function fetchClubEvents(clubId) {
    if (!isUuid(clubId)) return Promise.resolve([]);
    return restGet("tides?select=" + TIDE_COLUMNS + "&host_school_id=eq." + clubId + "&order=start_time.desc&limit=100").then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    });
  }

  var indexPromise = null;
  /** /species-index.json (de-duplicated): n common, s scientific, u slug, p photo, d difficulty, g min gallons. */
  function loadSpeciesIndex() {
    if (!indexPromise) {
      indexPromise = fetch("/species-index.json")
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (rows) { return Array.isArray(rows) ? rows : []; })
        .catch(function () { return []; });
    }
    return indexPromise;
  }

  function indexByScientificName(index) {
    var map = new Map();
    (index || []).forEach(function (row) {
      if (row && row.s) map.set(String(row.s).toLowerCase(), row);
    });
    return map;
  }

  return {
    SB_URL: SB_URL,
    SB_KEY: SB_KEY,
    CLUB_COLUMNS: CLUB_COLUMNS,
    TIDE_COLUMNS: TIDE_COLUMNS,
    LISTING_COLUMNS: LISTING_COLUMNS,
    START_CLUB_URL: START_CLUB_URL,
    escapeHtml: escapeHtml,
    isValidSlug: isValidSlug,
    isUuid: isUuid,
    slugFromLocation: slugFromLocation,
    clubUrl: clubUrl,
    joinUrl: joinUrl,
    eventUrl: eventUrl,
    safeImageUrl: safeImageUrl,
    initials: initials,
    bannerHue: bannerHue,
    memberLabel: memberLabel,
    typeLabel: typeLabel,
    parseTimestamp: parseTimestamp,
    formatMonthYear: formatMonthYear,
    trackedSpecies: trackedSpecies,
    sortClubs: sortClubs,
    splitEvents: splitEvents,
    listingMatches: listingMatches,
    updatedLabel: updatedLabel,
    headers: headers,
    fetchClubs: fetchClubs,
    fetchClubBySlug: fetchClubBySlug,
    fetchClubEvents: fetchClubEvents,
    loadSpeciesIndex: loadSpeciesIndex,
    indexByScientificName: indexByScientificName,
  };
});
