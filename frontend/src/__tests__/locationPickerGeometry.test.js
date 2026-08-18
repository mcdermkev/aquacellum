/**
 * The radius circle drawn on the Expo location picker.
 *
 * Only the geometry is tested: this project's vitest runs in a `node` environment
 * with no jsdom, and a Mapbox GL canvas is not testable there anyway. The geometry
 * is also the part that can be silently wrong — a circle that looks plausible but
 * covers the wrong area, while being the thing that tells a host who is allowed to
 * check in to their event.
 */
import { describe, it, expect } from "vitest";
import { buildRadiusCircle } from "../components/LocationPicker";

/** Great-circle distance in km, independent of the implementation under test. */
function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

describe("buildRadiusCircle", () => {
  it("produces a closed GeoJSON polygon", () => {
    const f = buildRadiusCircle(45.5, -122.6, 1);
    expect(f.type).toBe("Feature");
    expect(f.geometry.type).toBe("Polygon");

    const ring = f.geometry.coordinates[0];
    // A polygon ring must close, or Mapbox renders nothing.
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBe(65);
  });

  it("puts every vertex at the requested distance from the centre", () => {
    const centre = [-122.6, 45.5];
    const km = 2;
    const ring = buildRadiusCircle(45.5, -122.6, km).geometry.coordinates[0];

    for (const point of ring) {
      // Within 1% — the polygon is an equirectangular approximation, not a
      // geodesic, so exact equality is not the bar. Being wrong by a factor of
      // cos(latitude) is.
      expect(haversineKm(centre, point)).toBeCloseTo(km, 1);
    }
  });

  it("stays accurate at high latitude, where the longitude correction matters", () => {
    // At 60°N a degree of longitude is about half its equatorial length. Dropping
    // the cos() term would draw this circle roughly twice as wide as asked.
    const centre = [15, 60];
    const km = 5;
    const ring = buildRadiusCircle(60, 15, km).geometry.coordinates[0];

    const distances = ring.map((p) => haversineKm(centre, p));
    const widest = Math.max(...distances);
    const narrowest = Math.min(...distances);

    expect(widest).toBeLessThan(km * 1.05);
    expect(narrowest).toBeGreaterThan(km * 0.95);
  });

  it("is symmetric east-west and north-south", () => {
    const ring = buildRadiusCircle(0, 0, 10, 4).geometry.coordinates[0];
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);

    expect(Math.max(...lngs)).toBeCloseTo(-Math.min(...lngs), 6);
    expect(Math.max(...lats)).toBeCloseTo(-Math.min(...lats), 6);
  });

  it("scales linearly with the radius", () => {
    const small = buildRadiusCircle(45, -122, 1).geometry.coordinates[0];
    const large = buildRadiusCircle(45, -122, 4).geometry.coordinates[0];

    const spread = (ring) => Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]));
    expect(spread(large) / spread(small)).toBeCloseTo(4, 5);
  });

  it("handles a sub-kilometre radius, which is the common case for a meetup", () => {
    const centre = [-122.6, 45.5];
    const ring = buildRadiusCircle(45.5, -122.6, 0.1).geometry.coordinates[0];
    for (const point of ring) {
      expect(haversineKm(centre, point)).toBeCloseTo(0.1, 2);
    }
  });
});
