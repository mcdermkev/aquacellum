/**
 * zoneHash.js
 * 
 * Adaptive density-based zone assignment utility.
 * 
 * Per GAMIFICATION_SPEC.md section 4.1:
 *   - Zones are ~15–30 mile radius buckets
 *   - Dense metro areas get smaller zones (more competition per bucket)
 *   - Rural areas get larger zones (always a meaningful pool of competitors)
 *   - Zone assignment happens at account creation or first location grant
 *   - Users can request a zone transfer once per 90 days
 * 
 * This utility generates a deterministic zone_hash from coordinates using
 * a geohash-like grid approach with adaptive cell sizes.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Population Density Grid (pre-defined metro regions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known dense metro areas with smaller zone radius.
 * Each entry defines a metro center and its approximate population-based radius.
 * If a user falls within a metro's catchment, they get finer-grained zones.
 * 
 * This is a simplified approach — in production, this would be backed by
 * census data or a population density tile service.
 */
const METRO_REGIONS = [
  // North America
  { name: "New York Metro", lat: 40.7128, lng: -74.0060, radiusMiles: 12, populationTier: "dense" },
  { name: "Los Angeles", lat: 34.0522, lng: -118.2437, radiusMiles: 15, populationTier: "dense" },
  { name: "Chicago", lat: 41.8781, lng: -87.6298, radiusMiles: 14, populationTier: "dense" },
  { name: "Houston", lat: 29.7604, lng: -95.3698, radiusMiles: 18, populationTier: "dense" },
  { name: "Phoenix", lat: 33.4484, lng: -112.0740, radiusMiles: 18, populationTier: "medium" },
  { name: "San Francisco Bay", lat: 37.7749, lng: -122.4194, radiusMiles: 12, populationTier: "dense" },
  { name: "Dallas-Fort Worth", lat: 32.7767, lng: -96.7970, radiusMiles: 18, populationTier: "dense" },
  { name: "Miami", lat: 25.7617, lng: -80.1918, radiusMiles: 14, populationTier: "dense" },
  { name: "Atlanta", lat: 33.7490, lng: -84.3880, radiusMiles: 16, populationTier: "dense" },
  { name: "Seattle", lat: 47.6062, lng: -122.3321, radiusMiles: 14, populationTier: "dense" },
  { name: "Denver", lat: 39.7392, lng: -104.9903, radiusMiles: 16, populationTier: "medium" },
  { name: "Austin", lat: 30.2672, lng: -97.7431, radiusMiles: 16, populationTier: "medium" },
  { name: "Portland", lat: 45.5152, lng: -122.6784, radiusMiles: 14, populationTier: "medium" },
  { name: "San Diego", lat: 32.7157, lng: -117.1611, radiusMiles: 15, populationTier: "medium" },
  { name: "Minneapolis", lat: 44.9778, lng: -93.2650, radiusMiles: 16, populationTier: "medium" },
  { name: "Tampa", lat: 27.9506, lng: -82.4572, radiusMiles: 16, populationTier: "medium" },
  { name: "Boston", lat: 42.3601, lng: -71.0589, radiusMiles: 12, populationTier: "dense" },
  { name: "Washington DC", lat: 38.9072, lng: -77.0369, radiusMiles: 14, populationTier: "dense" },
  { name: "Philadelphia", lat: 39.9526, lng: -75.1652, radiusMiles: 14, populationTier: "dense" },

  // Europe
  { name: "London", lat: 51.5074, lng: -0.1278, radiusMiles: 12, populationTier: "dense" },
  { name: "Berlin", lat: 52.5200, lng: 13.4050, radiusMiles: 14, populationTier: "dense" },
  { name: "Paris", lat: 48.8566, lng: 2.3522, radiusMiles: 12, populationTier: "dense" },
  { name: "Amsterdam", lat: 52.3676, lng: 4.9041, radiusMiles: 12, populationTier: "dense" },

  // Asia-Pacific
  { name: "Tokyo", lat: 35.6762, lng: 139.6503, radiusMiles: 10, populationTier: "dense" },
  { name: "Sydney", lat: -33.8688, lng: 151.2093, radiusMiles: 15, populationTier: "dense" },
  { name: "Singapore", lat: 1.3521, lng: 103.8198, radiusMiles: 10, populationTier: "dense" },
  { name: "Melbourne", lat: -37.8136, lng: 144.9631, radiusMiles: 15, populationTier: "dense" },
];

// Default zone radius for areas not near any known metro
const DEFAULT_ZONE_RADIUS_MILES = 25;
const DEFAULT_POPULATION_TIER = "sparse";

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the distance between two coordinates in miles.
 * Uses the Haversine formula.
 */
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Find the nearest metro region to given coordinates.
 * Returns the metro if within its catchment radius * 1.5 (buffer), or null.
 */
function findNearestMetro(lat, lng) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const metro of METRO_REGIONS) {
    const dist = haversineDistanceMiles(lat, lng, metro.lat, metro.lng);
    // Check if within the metro's influence area (radius * 2 for catchment)
    if (dist < metro.radiusMiles * 2 && dist < nearestDist) {
      nearest = metro;
      nearestDist = dist;
    }
  }

  return nearest;
}

/**
 * Calculate the adaptive zone grid cell size based on location.
 * Returns { radiusMiles, populationTier, metroName }.
 */
export function getZoneParams(lat, lng) {
  const metro = findNearestMetro(lat, lng);

  if (metro) {
    return {
      radiusMiles: metro.radiusMiles,
      populationTier: metro.populationTier,
      metroName: metro.name,
    };
  }

  return {
    radiusMiles: DEFAULT_ZONE_RADIUS_MILES,
    populationTier: DEFAULT_POPULATION_TIER,
    metroName: null,
  };
}

/**
 * Generate a deterministic zone_hash from coordinates.
 * 
 * The hash is derived by snapping the coordinates to a grid cell
 * whose size is determined by the adaptive zone radius.
 * This ensures all users in the same geographic bucket get the same hash.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {{ zoneHash: string, displayName: string, centerLat: number, centerLng: number, radiusMiles: number, populationTier: string }}
 */
export function calculateZoneHash(lat, lng) {
  const params = getZoneParams(lat, lng);
  const { radiusMiles, populationTier, metroName } = params;

  // Convert radius to degrees (approximate)
  // 1 degree latitude ≈ 69 miles
  // 1 degree longitude ≈ 69 * cos(lat) miles
  const latCellSize = radiusMiles / 69;
  const lngCellSize = radiusMiles / (69 * Math.cos(toRad(lat)));

  // Snap to grid cell center
  const cellLat = Math.floor(lat / latCellSize) * latCellSize + latCellSize / 2;
  const cellLng = Math.floor(lng / lngCellSize) * lngCellSize + lngCellSize / 2;

  // Generate deterministic hash from cell center
  // Using a simple but consistent hashing of the cell coordinates
  const hashInput = `${cellLat.toFixed(4)}:${cellLng.toFixed(4)}:${radiusMiles}`;
  const hash = deterministicHash(hashInput);
  const zoneHash = `0x${hash}`;

  // Generate display name
  const displayName = metroName
    ? `${metroName} · Zone ${hash.slice(0, 4).toUpperCase()}`
    : `Zone ${hash.slice(0, 4).toUpperCase()} · ${getCardinalRegion(lat, lng)}`;

  return {
    zoneHash,
    displayName,
    centerLat: Number(cellLat.toFixed(4)),
    centerLng: Number(cellLng.toFixed(4)),
    radiusMiles,
    populationTier,
  };
}

/**
 * Generate a deterministic hex hash from a string.
 * Uses a simple but consistent hash algorithm (DJB2 variant).
 */
function deterministicHash(str) {
  let hash1 = 5381;
  let hash2 = 52711;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 33) ^ char;
  }

  // Combine into 8-character hex
  const combined = Math.abs(hash1 * 4096 + hash2);
  return combined.toString(16).padStart(8, "0").slice(0, 8);
}

/**
 * Get a cardinal/geographic region description for display names in rural areas.
 */
function getCardinalRegion(lat, lng) {
  // Very rough US-centric region names (expandable)
  if (lat > 45) return "Northern Region";
  if (lat > 37 && lng < -100) return "Mountain West";
  if (lat > 37 && lng > -100) return "Midwest";
  if (lat > 30 && lng < -100) return "Southwest";
  if (lat > 30 && lng > -85) return "Southeast";
  if (lat > 30) return "Southern Plains";
  if (lat > 24) return "Gulf Coast";
  // International fallback
  if (lat > 50) return "Northern Europe";
  if (lat > 35 && lng > 0) return "Mediterranean";
  if (lat < -20) return "Southern Hemisphere";
  return "Region";
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser Geolocation Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request the user's current position via the browser Geolocation API.
 * Returns a promise that resolves with { lat, lng } or rejects with an error.
 * 
 * @param {object} opts
 * @param {boolean} opts.highAccuracy - Request high accuracy (default false for zone assignment)
 * @param {number} opts.timeoutMs - Timeout in ms (default 10000)
 * @returns {Promise<{lat: number, lng: number}>}
 */
export function requestGeolocation({ highAccuracy = false, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error("Location permission denied. Enable location in your browser settings to join a zone."));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error("Location information is unavailable. Try again later."));
            break;
          case error.TIMEOUT:
            reject(new Error("Location request timed out. Try again."));
            break;
          default:
            reject(new Error("An unknown error occurred getting your location."));
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: timeoutMs,
        maximumAge: 5 * 60 * 1000, // Accept cached position up to 5 min old
      }
    );
  });
}

/**
 * Full flow: request location → calculate zone → return zone data.
 * Convenience wrapper for the ZoneAssignmentFlow component.
 * 
 * @returns {Promise<{zoneHash, displayName, centerLat, centerLng, radiusMiles, populationTier}>}
 */
export async function detectUserZone() {
  const { lat, lng } = await requestGeolocation();
  return calculateZoneHash(lat, lng);
}
