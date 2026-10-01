/**
 * Public club pages: /clubs (clubs.html) and /clubs/<slug> (club.html).
 *
 * Source-level guards over the static pages (the project's convention for
 * plain <script> HTML), plus behaviour tests of the shared helper
 * public/js/clubs-public.js, which is a UMD file and so can be require()d.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const CLUBS = read("clubs.html");
const CLUB = read("club.html");
const HELPER = read("public/js/clubs-public.js");
const NAV = read("public/js/nav.js");
const FOOTER = read("public/js/footer.js");
const SPECIES = read("species.html");
const VITE = read("vite.config.js");
const VERCEL = JSON.parse(read("vercel.json"));
// Evaluated through its real global-assignment path, as the pages run it (same
// approach as the catalog-aliases.js parity test).
const fakeRoot = {};
// eslint-disable-next-line no-new-func
new Function("module", "window", "globalThis", HELPER)({ exports: {} }, fakeRoot, fakeRoot);
const Clubs = fakeRoot.AquadexClubs;

const SOURCES = { "clubs.html": CLUBS, "club.html": CLUB, "clubs-public.js": HELPER };

describe("data access", () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    it(`${name} never uses select=*`, () => {
      expect(src).not.toMatch(/select=\*/);
    });
    it(`${name} never selects founder_wallet`, () => {
      expect(src).not.toMatch(/select=[^"'`&]*founder_wallet/);
      expect(src).not.toMatch(/founder_wallet\s*[,"'`]/);
    });
    it(`${name} does not read the raw listings table`, () => {
      expect(src).not.toMatch(/rest\/v1\/aquadex_listings(?!_public)/);
    });
  }

  it("names every column it reads", () => {
    expect(Clubs.CLUB_COLUMNS.split(",")).toEqual(expect.arrayContaining(["id", "name", "slug", "description", "banner_url", "tracked_species", "member_count", "created_at", "is_official", "is_invite_only"]));
    expect(Clubs.CLUB_COLUMNS).not.toContain("founder_wallet");
    expect(Clubs.TIDE_COLUMNS).toBe("id,title,tide_type,start_time,end_time,status,host_school_id,settings");
    expect(HELPER).toContain('"schools?select=" + CLUB_COLUMNS');
    expect(HELPER).toContain('"tides?select=" + TIDE_COLUMNS');
  });

  it("club.html reads listings through the shared public-listings helper, loaded first", () => {
    const src = CLUB.replace(/<!--[\s\S]*?-->/g, "");
    const tag = src.indexOf('<script src="/js/public-listings.js">');
    expect(tag).toBeGreaterThan(-1);
    expect(src.search(/AquadexPublicListings\s*\./)).toBeGreaterThan(tag);
    expect(CLUB).toContain("select=${Clubs.LISTING_COLUMNS}");
  });

  it("filters events to the club by host_school_id", () => {
    expect(HELPER).toContain("&host_school_id=eq.");
  });
});

describe("escaping user-written text", () => {
  it("escapes HTML metacharacters", () => {
    expect(Clubs.escapeHtml(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    expect(Clubs.escapeHtml(null)).toBe("");
  });

  it("clubs.html escapes names, descriptions and species names", () => {
    expect(CLUBS).toContain("const escapeHtml = Clubs.escapeHtml;");
    expect(CLUBS).toContain('escapeHtml(club.name || "Club")');
    expect(CLUBS).toContain("escapeHtml(desc)");
    expect(CLUBS).toContain("escapeHtml(sp.name)");
  });

  it("club.html escapes names, descriptions, event titles and listing text", () => {
    expect(CLUB).toContain("const escapeHtml = Clubs.escapeHtml;");
    expect(CLUB).toContain('escapeHtml(club.name || "Club")');
    expect(CLUB).toContain("escapeHtml(desc)");
    expect(CLUB).toContain('escapeHtml(t.title || "Club event")');
    expect(CLUB).toContain("escapeHtml(l.commonName)");
    expect(CLUB).toContain("escapeHtml(l.sellerName)");
  });

  it("only allows https or same-origin image URLs", () => {
    expect(Clubs.safeImageUrl("javascript:alert(1)", "https://aquacellum.com")).toBe("");
    expect(Clubs.safeImageUrl("http://evil.example/x.png", "https://aquacellum.com")).toBe("");
    expect(Clubs.safeImageUrl("https://cdn.example/x.png", "https://aquacellum.com")).toBe("https://cdn.example/x.png");
    expect(Clubs.safeImageUrl("/species-images/a.png", "https://aquacellum.com")).toBe("https://aquacellum.com/species-images/a.png");
  });
});

describe("slug handling", () => {
  it("accepts lowercase letters, digits and hyphens only", () => {
    expect(Clubs.isValidSlug("betta-keepers")).toBe(true);
    expect(Clubs.isValidSlug("northeast-breeders-")).toBe(true); // real slug in production
    expect(Clubs.isValidSlug("Betta")).toBe(false);
    expect(Clubs.isValidSlug("a;drop")).toBe(false);
    expect(Clubs.isValidSlug("a&or=(x)")).toBe(false);
    expect(Clubs.isValidSlug("---")).toBe(false);
    expect(Clubs.isValidSlug("")).toBe(false);
    expect(Clubs.isValidSlug("a".repeat(81))).toBe(false);
  });

  it("reads the slug from /clubs/<slug> or ?slug=", () => {
    expect(Clubs.slugFromLocation({ pathname: "/clubs/betta-keepers", search: "" })).toBe("betta-keepers");
    expect(Clubs.slugFromLocation({ pathname: "/club.html", search: "?slug=goldfish-society" })).toBe("goldfish-society");
    expect(Clubs.slugFromLocation({ pathname: "/clubs/%E0%A4%A", search: "" })).toBe("");
  });

  it("does not query an invalid slug", async () => {
    await expect(Clubs.fetchClubBySlug("bad slug;")).resolves.toBeNull();
    await expect(Clubs.fetchClubEvents("not-a-uuid")).resolves.toEqual([]);
  });

  it("club.html validates before it fetches", () => {
    const check = CLUB.indexOf("if (!Clubs.isValidSlug(state.slug))");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(CLUB.indexOf("Clubs.fetchClubBySlug(state.slug), Clubs.loadSpeciesIndex()"));
  });
});

describe("deep links into the app", () => {
  it("join and event links go to The Reef", () => {
    expect(Clubs.joinUrl("betta-keepers")).toBe("/app/reef?club=betta-keepers");
    expect(Clubs.eventUrl("11111111-1111-4111-8111-111111111111")).toBe("/app/reef?event=11111111-1111-4111-8111-111111111111");
    expect(HELPER).toContain('"/app/reef?club="');
    expect(HELPER).toContain('"/app/reef?event="');
    expect(CLUB).toContain("Clubs.joinUrl(club.slug)");
    expect(CLUB).toContain("Clubs.eventUrl(t.id)");
  });

  it("the directory offers Start a club in the app", () => {
    expect(CLUBS).toContain('href="/app/reef?tab=clubs"');
  });

  it("invite-only clubs say so on the join button", () => {
    expect(CLUB).toMatch(/club\.is_invite_only\s*\n?\s*\?[^:]*>Invite only<\/a>/);
  });
});

describe("club logic", () => {
  it("sorts official clubs first, then by member count", () => {
    const sorted = Clubs.sortClubs([
      { name: "B", is_official: false, member_count: 9 },
      { name: "A", is_official: true, member_count: 1 },
      { name: "C", is_official: true, member_count: 4 },
    ]);
    expect(sorted.map((c) => c.name)).toEqual(["C", "A", "B"]);
  });

  it("splits events into upcoming and past", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const { upcoming, past } = Clubs.splitEvents([
      { id: "a", start_time: "2026-10-05T12:00:00Z", status: "upcoming" },
      { id: "b", start_time: "2026-10-06T12:00:00Z", status: "ended" },
      { id: "c", start_time: "2026-09-30T11:00:00Z", end_time: "2026-09-30T13:00:00Z", status: "live" },
      { id: "d", start_time: "2026-09-01T12:00:00Z", end_time: "2026-09-01T13:00:00Z", status: "upcoming" },
      { id: "e", start_time: "2026-10-09T12:00:00Z", status: "cancelled" },
    ], now);
    expect(upcoming.map((t) => t.id)).toEqual(["c", "a"]);
    expect(upcoming[0]._live).toBe(true);
    expect(past.map((t) => t.id).sort()).toEqual(["b", "d", "e"]);
  });

  it("matches listings by exact scientific name or tracked catalog code", () => {
    const match = { names: new Set(["betta splendens"]), codes: new Set([4768]) };
    expect(Clubs.listingMatches({ scientificName: "Betta Splendens" }, match)).toBe(true);
    expect(Clubs.listingMatches({ scientificName: "Betta", specCode: 4768 }, match)).toBe(true);
    expect(Clubs.listingMatches({ scientificName: "Betta imbellis" }, match)).toBe(false);
  });

  it("formats the founded date and the live label", () => {
    expect(Clubs.formatMonthYear("2026-07-11 19:49:03.621964+00")).toBe("July 2026");
    expect(Clubs.formatMonthYear("2026-07-11T19:49:03.621964+00:00")).toBe("July 2026");
    expect(Clubs.formatMonthYear("2026-07-11")).toBe("July 2026");
    expect(Clubs.formatMonthYear("not a date")).toBe("");
    expect(Clubs.updatedLabel(5000)).toBe("Updated just now");
    expect(Clubs.updatedLabel(3 * 60000)).toBe("Updated 3 min ago");
  });

  it("refreshes every 60 seconds only while the tab is visible", () => {
    expect(CLUB).toContain("const REFRESH_MS = 60000;");
    expect(CLUB).toContain('document.visibilityState === "visible"');
    expect(CLUB).toContain('addEventListener("visibilitychange"');
    expect(CLUB).toContain("stopTimer()");
  });

  it("shows member counts, never member lists", () => {
    expect(HELPER).not.toMatch(/school_members|members\?select/);
    expect(CLUB).not.toMatch(/school_members|members\?select/);
  });
});

describe("routing and site chrome", () => {
  it("both pages are Vite inputs", () => {
    expect(VITE).toContain("resolve(__dirname, 'clubs.html')");
    expect(VITE).toContain("resolve(__dirname, 'club.html')");
  });

  it("vercel.json routes /clubs and /clubs/:slug", () => {
    const rewrites = VERCEL.rewrites || [];
    expect(rewrites).toContainEqual({ source: "/clubs", destination: "/clubs.html" });
    expect(rewrites).toContainEqual({ source: "/clubs/:slug", destination: "/club.html" });
  });

  it("nav lists Clubs between The Reef and Ask Echo", () => {
    const reef = NAV.indexOf("{ href: '/app/reef', label: 'The Reef' }");
    const clubs = NAV.indexOf("{ href: '/clubs', label: 'Clubs' }");
    // Echo's page (Echo, powered by Poseidon) still lives at /poseidon.html.
    const poseidon = NAV.indexOf("{ href: '/poseidon.html', label: 'Ask Echo' }");
    expect(reef).toBeGreaterThan(-1);
    expect(clubs).toBeGreaterThan(reef);
    expect(poseidon).toBeGreaterThan(clubs);
  });

  it("footer Community column links /clubs", () => {
    const community = FOOTER.slice(FOOTER.indexOf(">Community<"), FOOTER.indexOf(">Resources<"));
    expect(community).toContain('<a href="/clubs">Clubs</a>');
  });

  it("species pages link each club to its public page", () => {
    expect(SPECIES).toContain("`/clubs/${slug}`");
    expect(SPECIES).not.toMatch(/const link = '\/app\/reef';/);
  });
});
