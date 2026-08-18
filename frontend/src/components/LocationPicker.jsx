/**
 * LocationPicker.jsx
 *
 * Pick a place on a map instead of typing coordinates.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Creating an Expo Tide asked for "Latitude" and "Longitude" as bare number
 * fields. Nobody organising a fishkeeping meetup knows the decimal coordinates of
 * the venue, so in practice the fields were skipped — both expos in production
 * were created with gps_bounds null, which is why the Map tab had nothing to
 * render. The requirement was reasonable; the input was not.
 *
 * Three things this does that raw number fields cannot:
 *
 *   1. SEARCH BY NAME. A host thinks "Portland Expo Center", not 45.5872,
 *      -122.6642. Geocoding is the difference between a field you fill in and one
 *      you abandon.
 *   2. SHOW THE RADIUS. For an expo the radius is a geofence — it decides who is
 *      allowed to check in — and it was a bare number in kilometres with nothing
 *      to compare it against. Drawing the circle makes "1 km" mean something, and
 *      makes an accidental 50 km obvious.
 *   3. CONFIRM THE PIN. A reverse-geocoded address under the map tells the host
 *      they picked the right car park, not one two towns over. A coordinate pair
 *      is unverifiable by eye.
 *
 * The Mapbox load/init approach (CDN script injection, dark-v11, VITE_MAPBOX_TOKEN)
 * follows TideMap.jsx and breeder/PickupSpotSetup.jsx. PickupSpotSetup's own
 * comment notes "there is no existing shared Mapbox wrapper component to reuse" —
 * this is that component. It is deliberately NOT retrofitted into PickupSpotSetup
 * in the same change: that flow works today and switching it deserves its own
 * verification rather than riding along with an unrelated feature.
 *
 * Degrades to manual latitude/longitude entry when no token is configured, so the
 * capability is never worse than what it replaced.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { prefersReducedMotion } from "../utils/a11y";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAPBOX_VERSION = "v3.3.0";

/** Continental-US view, used when there is nothing to centre on yet. */
const DEFAULT_CENTER = [-98.5, 39.8];
const DEFAULT_ZOOM = 3;
const PICKED_ZOOM = 14;

/**
 * A GeoJSON polygon approximating a circle of `km` around a point.
 *
 * Pure and exported so the geometry is testable — the map itself is not, and this
 * is the part that can be silently wrong. Drawn as real geography rather than a
 * fixed-pixel marker so the circle keeps meaning the same distance at every zoom
 * level; a pixel circle would imply a different real-world area as you zoom.
 *
 * The latitude correction matters. A degree of latitude is ~110.574 km everywhere,
 * but a degree of LONGITUDE shrinks towards the poles — about 111.32 km at the
 * equator and roughly half that at 60°. Omitting the cos() term draws a circle
 * that is far too wide in exactly the places this product has users, and since the
 * circle communicates who is allowed to check in, "looks about right" is not good
 * enough.
 *
 * @param {number} centreLat
 * @param {number} centreLng
 * @param {number} km
 * @param {number} [points] - polygon resolution
 */
export function buildRadiusCircle(centreLat, centreLng, km, points = 64) {
  const coords = [];
  const latDelta = km / 110.574;
  const lngDelta = km / (111.32 * Math.cos((centreLat * Math.PI) / 180));

  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * 2 * Math.PI;
    coords.push([centreLng + lngDelta * Math.cos(angle), centreLat + latDelta * Math.sin(angle)]);
  }

  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] } };
}

/**
 * @param {number|null} props.lat
 * @param {number|null} props.lng
 * @param {(lat: number|null, lng: number|null, meta?: {address?: string}) => void} props.onPick
 * @param {number} [props.radiusKm] - when set, draws the check-in geofence
 * @param {string} [props.height]
 * @param {string} [props.searchPlaceholder]
 */
export function LocationPicker({
  lat,
  lng,
  onPick,
  radiusKm = null,
  height = "260px",
  searchPlaceholder = "Search for a venue or address…",
}) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  // onPick often comes from an inline arrow, so a ref keeps the map's click
  // handler current without tearing the map down and rebuilding it on every
  // parent render.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [mapReady, setMapReady] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [resolvedAddress, setResolvedAddress] = useState(null);
  const [locating, setLocating] = useState(false);

  // ── Marker ────────────────────────────────────────────────────────────────
  const placeMarker = useCallback((placeLat, placeLng, { fly = true } = {}) => {
    if (!mapRef.current || !window.mapboxgl) return;

    if (markerRef.current) {
      markerRef.current.setLngLat([placeLng, placeLat]);
    } else {
      const el = document.createElement("div");
      el.textContent = "📍";
      el.style.fontSize = "1.6rem";
      el.style.cursor = "grab";

      // Draggable, because the first tap is rarely exact and re-tapping to nudge
      // a pin a few metres is fiddly on a phone.
      const marker = new window.mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([placeLng, placeLat])
        .addTo(mapRef.current);

      marker.on("dragend", () => {
        const { lat: dLat, lng: dLng } = marker.getLngLat();
        onPickRef.current(dLat, dLng);
      });

      markerRef.current = marker;
    }

    const target = { center: [placeLng, placeLat], zoom: Math.max(mapRef.current.getZoom(), PICKED_ZOOM) };
    if (fly && !prefersReducedMotion()) mapRef.current.flyTo(target);
    else mapRef.current.jumpTo(target);
  }, []);

  // ── The radius geofence ───────────────────────────────────────────────────
  const drawRadius = useCallback((centreLat, centreLng, km) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const geojson = buildRadiusCircle(centreLat, centreLng, km);

    if (map.getSource("picker-radius")) {
      map.getSource("picker-radius").setData(geojson);
      return;
    }

    map.addSource("picker-radius", { type: "geojson", data: geojson });
    map.addLayer({
      id: "picker-radius-fill",
      type: "fill",
      source: "picker-radius",
      paint: { "fill-color": "#38bdf8", "fill-opacity": 0.14 },
    });
    map.addLayer({
      id: "picker-radius-line",
      type: "line",
      source: "picker-radius",
      paint: { "line-color": "#38bdf8", "line-width": 1.5 },
    });
  }, []);

  // ── Load Mapbox from the CDN, matching TideMap / PickupSpotSetup ──────────
  useEffect(() => {
    if (!MAPBOX_TOKEN) return undefined;

    let cancelled = false;

    function initMap() {
      if (cancelled || !mapContainer.current || !window.mapboxgl || mapRef.current) return;
      window.mapboxgl.accessToken = MAPBOX_TOKEN;

      const hasPin = lat != null && lng != null;
      const map = new window.mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: hasPin ? [lng, lat] : DEFAULT_CENTER,
        zoom: hasPin ? PICKED_ZOOM : DEFAULT_ZOOM,
      });
      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;
        setMapReady(true);
        if (hasPin) placeMarker(lat, lng, { fly: false });
      });

      map.on("click", (e) => {
        onPickRef.current(e.lngLat.lat, e.lngLat.lng);
      });
    }

    if (window.mapboxgl) {
      initMap();
    } else {
      if (!document.querySelector('link[data-mapbox-css]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css`;
        link.setAttribute("data-mapbox-css", "true");
        document.head.appendChild(link);
      }

      // Reuse an in-flight script tag rather than injecting a second copy if two
      // pickers mount at once.
      const existing = document.querySelector("script[data-mapbox-gl]");
      if (existing) {
        existing.addEventListener("load", initMap);
      } else {
        const script = document.createElement("script");
        script.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
        script.setAttribute("data-mapbox-gl", "true");
        script.onload = initMap;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker and radius in step with values changed from outside (manual
  // entry, "use my location", or the radius slider).
  useEffect(() => {
    if (!mapReady || lat == null || lng == null) return;
    placeMarker(lat, lng, { fly: false });
    if (radiusKm) drawRadius(lat, lng, radiusKm);
  }, [mapReady, lat, lng, radiusKm, placeMarker, drawRadius]);

  // ── Reverse geocode, so the host can confirm the pin is the right place ───
  useEffect(() => {
    if (!MAPBOX_TOKEN || lat == null || lng == null) {
      setResolvedAddress(null);
      return undefined;
    }

    let cancelled = false;
    // Debounced: dragging a marker fires a lot of updates and each one is a
    // billable request.
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`
        );
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setResolvedAddress(body.features?.[0]?.place_name || null);
      } catch {
        /* a missing address label is cosmetic — the coordinates are what matter */
      }
    }, 600);

    return () => { cancelled = true; clearTimeout(t); };
  }, [lat, lng]);

  // ── Search by name ────────────────────────────────────────────────────────
  const runSearch = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?access_token=${MAPBOX_TOKEN}&limit=5&types=poi,address,place`
      );
      if (!res.ok) throw new Error(`Search failed (${res.status})`);

      const body = await res.json();
      const found = (body.features || []).map((f) => ({
        id: f.id,
        name: f.place_name,
        lat: f.center[1],
        lng: f.center[0],
      }));

      setResults(found);
      if (found.length === 0) setSearchError("Nothing found for that. Try a nearby address.");
    } catch (err) {
      setSearchError(err.message || "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const chooseResult = (r) => {
    setResults([]);
    setQuery(r.name);
    onPick(r.lat, r.lng, { address: r.name });
    if (mapReady) placeMarker(r.lat, r.lng, { fly: true });
  };

  const useMyLocation = () => {
    setSearchError(null);
    if (!navigator.geolocation) {
      setSearchError("This browser can't share a location.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onPick(pos.coords.latitude, pos.coords.longitude);
        if (mapReady) placeMarker(pos.coords.latitude, pos.coords.longitude, { fly: true });
        setLocating(false);
      },
      (err) => {
        setSearchError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — search for the venue instead."
            : "Couldn't get your location — search for the venue instead."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── No token: never worse than the number fields this replaced ────────────
  if (!MAPBOX_TOKEN) {
    return (
      <div className="location-picker location-picker--fallback">
        <p className="text-muted">
          Map unavailable. Enter coordinates directly — you can copy them from
          Google Maps by right-clicking the spot.
        </p>
        <div className="location-picker__coords">
          <label className="form-field">
            <span>Latitude</span>
            <input
              type="number"
              step="any"
              value={lat ?? ""}
              onChange={(e) => onPick(e.target.value === "" ? null : Number(e.target.value), lng ?? null)}
              placeholder="45.5231"
            />
          </label>
          <label className="form-field">
            <span>Longitude</span>
            <input
              type="number"
              step="any"
              value={lng ?? ""}
              onChange={(e) => onPick(lat ?? null, e.target.value === "" ? null : Number(e.target.value))}
              placeholder="-122.6765"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="location-picker">
      <form className="location-picker__search" onSubmit={runSearch} role="search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search for a venue or address"
          className="location-picker__search-input"
        />
        <button type="submit" className="btn btn--secondary btn--sm" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={useMyLocation} disabled={locating}>
          {locating ? "Locating…" : "📍 Use my location"}
        </button>
      </form>

      {results.length > 0 && (
        <ul className="location-picker__results" role="listbox" aria-label="Search results">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => chooseResult(r)}>
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {searchError && <p className="location-picker__error" role="alert">{searchError}</p>}

      <p className="location-picker__hint">
        {lat == null || lng == null
          ? "Search above, or tap the map to drop a pin."
          : "Tap elsewhere to move the pin, or drag it to fine-tune."}
      </p>

      <div
        ref={mapContainer}
        className="location-picker__map"
        style={{ height }}
        // The map is a supplementary way to set the same values the search sets,
        // and Mapbox canvases are not keyboard-operable, so it is hidden from
        // assistive tech rather than presented as an unusable control.
        aria-hidden="true"
      />

      {lat != null && lng != null && (
        <p className="location-picker__resolved">
          {resolvedAddress ? (
            <>📍 {resolvedAddress}</>
          ) : (
            <>📍 {lat.toFixed(5)}, {lng.toFixed(5)}</>
          )}
          {radiusKm ? (
            <span className="text-muted"> · {radiusKm} km check-in zone shown</span>
          ) : null}
        </p>
      )}
    </div>
  );
}

export default LocationPicker;
