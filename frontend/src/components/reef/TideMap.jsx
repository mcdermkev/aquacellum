/**
 * TideMap.jsx
 * 
 * Mapbox GL JS integration for Expo Tides.
 * - GPS bounds overlay showing active Tide zone
 * - Fuzzed attendee pins (using zoneHash, not exact GPS)
 * - "Check In" button when user is within zone bounds
 * - Check-in awards +100 XP burst
 */

import { useEffect, useRef, useState, useCallback } from "react";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * Calculate distance between two GPS points (Haversine formula).
 * Returns distance in kilometers.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function TideMap({ tideId, gpsBounds, attendees = [], isLive, onCheckIn }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [isInZone, setIsInZone] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);

  // Load Mapbox GL JS dynamically
  useEffect(() => {
    if (!MAPBOX_TOKEN) return;
    if (window.mapboxgl) {
      initMap();
      return;
    }

    // Load CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css";
    document.head.appendChild(link);

    // Load JS
    const script = document.createElement("script");
    script.src = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js";
    script.onload = () => initMap();
    document.head.appendChild(script);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const initMap = useCallback(() => {
    if (!mapContainer.current || !window.mapboxgl || mapRef.current) return;

    window.mapboxgl.accessToken = MAPBOX_TOKEN;

    const center = gpsBounds
      ? [gpsBounds.lng, gpsBounds.lat]
      : [-122.4194, 37.7749]; // Default: SF

    const map = new window.mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: 13,
    });

    mapRef.current = map;

    map.on("load", () => {
      setMapLoaded(true);

      // Draw tide zone circle
      if (gpsBounds?.lat && gpsBounds?.lng && gpsBounds?.radius_km) {
        addZoneCircle(map, gpsBounds);
      }

      // Add fuzzed attendee markers
      addAttendeeMarkers(map, attendees, gpsBounds);
    });
  }, [gpsBounds, attendees]);

  // Add zone circle overlay
  function addZoneCircle(map, bounds) {
    const radiusInMeters = bounds.radius_km * 1000;
    const steps = 64;
    const coords = [];

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const dx = radiusInMeters * Math.cos(angle);
      const dy = radiusInMeters * Math.sin(angle);
      const lat = bounds.lat + (dy / 111320);
      const lng = bounds.lng + (dx / (111320 * Math.cos((bounds.lat * Math.PI) / 180)));
      coords.push([lng, lat]);
    }
    coords.push(coords[0]); // close the ring

    if (map.getSource("tide-zone")) return;

    map.addSource("tide-zone", {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
      },
    });

    map.addLayer({
      id: "tide-zone-fill",
      type: "fill",
      source: "tide-zone",
      paint: {
        "fill-color": "#10b981",
        "fill-opacity": 0.15,
      },
    });

    map.addLayer({
      id: "tide-zone-border",
      type: "line",
      source: "tide-zone",
      paint: {
        "line-color": "#10b981",
        "line-width": 2,
        "line-dasharray": [3, 2],
      },
    });
  }

  // Add fuzzed attendee markers
  function addAttendeeMarkers(map, attendees, bounds) {
    if (!bounds) return;

    attendees
      .filter((a) => a.rsvp_status === "checked_in")
      .forEach((attendee, i) => {
        // Fuzz position within zone (random offset from center)
        const fuzzLat = bounds.lat + (Math.random() - 0.5) * bounds.radius_km * 0.015;
        const fuzzLng = bounds.lng + (Math.random() - 0.5) * bounds.radius_km * 0.015;

        const el = document.createElement("div");
        el.className = "tide-map__marker";
        el.textContent = "🐟";
        el.title = attendee.profile?.display_name || attendee.wallet_address?.slice(0, 8);

        new window.mapboxgl.Marker(el)
          .setLngLat([fuzzLng, fuzzLat])
          .addTo(map);
      });
  }

  // Get user location for check-in
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation not supported by your browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setLocationError(null);

        // Check if user is within zone bounds
        if (gpsBounds?.lat && gpsBounds?.lng && gpsBounds?.radius_km) {
          const distance = haversineDistance(loc.lat, loc.lng, gpsBounds.lat, gpsBounds.lng);
          setIsInZone(distance <= gpsBounds.radius_km);
        }

        // Add user marker to map
        if (mapRef.current && window.mapboxgl) {
          const el = document.createElement("div");
          el.className = "tide-map__marker tide-map__marker--user";
          el.textContent = "📍";

          new window.mapboxgl.Marker(el)
            .setLngLat([loc.lng, loc.lat])
            .addTo(mapRef.current);
        }
      },
      (err) => {
        setLocationError(
          err.code === 1
            ? "Location permission denied. Enable it in browser settings."
            : "Could not determine your location."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleCheckIn = async () => {
    setCheckingIn(true);
    if (onCheckIn) await onCheckIn();
    setCheckingIn(false);
  };

  if (!MAPBOX_TOKEN) {
    return (
      <div className="tide-map tide-map--no-token">
        <p className="text-muted">Map unavailable — Mapbox token not configured.</p>
      </div>
    );
  }

  return (
    <section className="tide-map" aria-label="Tide Event Map">
      {/* Map container */}
      <div
        ref={mapContainer}
        className="tide-map__container"
        style={{ height: 400, borderRadius: "0.75rem" }}
        aria-label="Interactive event map"
      />

      {/* Check-in controls (only for live expo tides) */}
      {isLive && (
        <div className="tide-map__checkin">
          {!userLocation ? (
            <button className="btn btn--secondary" onClick={requestLocation}>
              📍 Share Location to Check In
            </button>
          ) : isInZone ? (
            <button
              className="btn btn--primary btn--lg"
              onClick={handleCheckIn}
              disabled={checkingIn}
            >
              {checkingIn ? "Checking in…" : "📍 Check In (+100 XP)"}
            </button>
          ) : (
            <p className="tide-map__out-of-zone">
              📍 You're outside the tide zone. Get closer to check in!
            </p>
          )}
          {locationError && (
            <p className="tide-map__error" role="alert">{locationError}</p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="tide-map__legend" aria-label="Map legend">
        <span><span className="legend-dot legend-dot--zone" /> Tide Zone</span>
        <span><span className="legend-dot legend-dot--attendee" /> Checked-in Breeders</span>
        {userLocation && <span><span className="legend-dot legend-dot--user" /> You</span>}
      </div>
    </section>
  );
}

export default TideMap;
