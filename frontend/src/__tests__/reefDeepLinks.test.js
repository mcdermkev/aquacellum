import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveReefRoute, reefRouteParams } from "../services/reefRoute.js";
import { splitEvents, isEventOver, clubInitials } from "../components/reef/reefEvents.js";
import { buildSpeciesLookup, findSpecies, trackedSpeciesLabel, speciesHref } from "../components/reef/reefSpecies.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("Reef deep links", () => {
  it("reads club, event and tab from the query string", () => {
    expect(resolveReefRoute("?club=betta-keepers")).toMatchObject({ club: "betta-keepers", tab: null, event: null });
    expect(resolveReefRoute("?event=3435F3EA-D8C5-46CE-B9F8-8D3E6321165B")).toMatchObject({
      event: "3435f3ea-d8c5-46ce-b9f8-8d3e6321165b",
    });
    for (const tab of ["feed", "explore", "clubs", "events"]) {
      expect(resolveReefRoute(`?tab=${tab}`).tab).toBe(tab);
    }
  });

  it("keeps the old tab words working", () => {
    expect(resolveReefRoute("?tab=groups").tab).toBe("clubs");
    expect(resolveReefRoute("?tab=tides").tab).toBe("events");
    expect(resolveReefRoute("?tab=Explore").tab).toBe("explore");
  });

  it("flags values that cannot be a real club or event", () => {
    const r = resolveReefRoute("?club=%3Cscript%3E&event=42");
    expect(r.club).toBeNull();
    expect(r.event).toBeNull();
    expect(r.badClub).toBe("<script>");
    expect(r.badEvent).toBe("42");
    expect(resolveReefRoute("?tab=nope").tab).toBeNull();
    expect(resolveReefRoute("").tab).toBeNull();
  });

  it("builds params that clear the keys not in use", () => {
    expect(reefRouteParams({ club: "betta-keepers" })).toEqual({ tab: null, club: "betta-keepers", event: null });
    expect(reefRouteParams({ tab: "bogus" })).toEqual({ tab: null, club: null, event: null });
  });

  it("App passes the parsed route to The Reef through the existing navigate helper", () => {
    const app = read("../App.jsx");
    expect(app).toMatch(/resolveReefRoute\(location\.search\)/);
    expect(app).toMatch(/navigateCommerce\("\/app\/reef"/);
  });
});

describe("Reef events", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const rows = [
    { id: "a", status: "upcoming", start_time: "2026-10-05T18:00:00Z", end_time: "2026-10-05T20:00:00Z" },
    { id: "b", status: "upcoming", start_time: "2026-08-21T19:46:00Z", end_time: "2026-08-22T01:30:00Z" },
    { id: "c", status: "ended", start_time: "2026-08-16T19:51:00Z", end_time: "2026-08-16T20:51:00Z" },
    { id: "d", status: "live", start_time: "2026-09-30T11:00:00Z", end_time: "2026-09-30T13:00:00Z" },
  ];

  it("files an event whose end has passed under past, whatever its status says", () => {
    expect(isEventOver(rows[1], now)).toBe(true);
    const { upcoming, past } = splitEvents(rows.slice(0, 2).concat(rows[3]), [rows[2], rows[1]], now);
    expect(upcoming.map((t) => t.id)).toEqual(["d", "a"]);
    expect(past.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("makes initials for a generated club header", () => {
    expect(clubInitials("Betta Keepers")).toBe("BK");
    expect(clubInitials("iyg")).toBe("IY");
    expect(clubInitials("")).toBe("?");
  });
});

describe("Reef species links", () => {
  const lookup = buildSpeciesLookup([
    { n: "Betta / Siamese Fighting Fish", s: "Betta splendens", u: "betta-splendens", p: "/species-images/betta.png" },
    { n: "Common Goldfish", s: "Carassius auratus", u: "carassius-auratus" },
  ]);

  it("matches club species by scientific name and post tags by common name", () => {
    expect(findSpecies(lookup, { scientificName: "Betta splendens", commonName: "x" })?.slug).toBe("betta-splendens");
    expect(findSpecies(lookup, { commonName: "common goldfish" })?.slug).toBe("carassius-auratus");
    expect(findSpecies(lookup, { commonName: "Unknown fish" })).toBeNull();
    expect(speciesHref("betta-splendens")).toBe("/species/betta-splendens");
  });

  it("reads tracked species in the stored camelCase shape", () => {
    expect(trackedSpeciesLabel({ commonName: "Oscar", scientificName: "Astronotus ocellatus" })).toEqual({
      commonName: "Oscar",
      scientificName: "Astronotus ocellatus",
    });
    expect(trackedSpeciesLabel("Guppy").commonName).toBe("Guppy");
  });
});
