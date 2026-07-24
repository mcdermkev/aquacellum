import { useEffect, useRef, useState } from "react";
import { fetchPickupForOrder, proposePickupTime } from "../../services/pickupCoordinationApi";
import { resolveAvailableSlots, arrangementStatusView } from "../../services/pickupCoordination";
import { getOrCreateConversation } from "../../services/messagesApi";
import { announce, prefersReducedMotion } from "../../utils/a11y";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

/**
 * PickupPanel.jsx (Task 25, buyer surface)
 *
 * Rendered for PREPAID_PICKUP orders in CheckoutSummary / My Orders. Reveals
 * the real (post-purchase) pickup pin + address, the seller's availability
 * windows, a propose-a-time control, the confirmed time, a "Message seller"
 * button, and access to the existing handshake QR/PIN for the meet. Degrades
 * to address-text + an "Open in Maps" link when Mapbox is unavailable.
 *
 * This component composes ONLY existing verified services:
 *   - fetchPickupForOrder / proposePickupTime (pickupCoordinationApi.js) —
 *     the order-scoped reveal + scheduling endpoints
 *   - resolveAvailableSlots / arrangementStatusView (pickupCoordination.js) —
 *     the pure scheduling core, not re-implemented here
 *   - getOrCreateConversation + the `aquadex_open_conversation` event
 *     (messagesApi.js) — the existing live messaging channel, no new one
 *   - onOpenHandoff (prop, supplied by the caller) — opens the caller's
 *     existing handshake QR/PIN surface; this component never re-implements
 *     the handshake itself, per spec §4.
 *
 * Props: { orderRef, sellerWallet, onOpenHandoff, casualModeActive }
 */
export function PickupPanel({ orderRef, sellerWallet, onOpenHandoff, casualModeActive = true }) {
  const casual = casualModeActive !== false;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [location, setLocation] = useState(null);
  const [arrangement, setArrangement] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [proposing, setProposing] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);

  const load = async () => {
    if (!orderRef) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPickupForOrder(orderRef);
      if (!res.success) {
        setError(res.error || (casual ? "Could not load pickup details." : "Could not load pickup details."));
        return;
      }
      setLocation(res.location || null);
      setArrangement(res.arrangement || null);
    } catch (err) {
      setError(err.message || "Could not load pickup details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderRef]);

  const slots = location ? resolveAvailableSlots(location, {}) : [];
  const statusView = arrangementStatusView(arrangement || { status: "none" }, { casual });

  const handlePropose = async () => {
    if (!selectedSlot) return;
    setProposing(true);
    setError(null);
    try {
      const res = await proposePickupTime({ orderRef, pickupLocationId: location?.id, proposedTime: selectedSlot });
      if (!res.success) {
        setError(res.error || "Could not propose this time.");
        return;
      }
      setArrangement(res.arrangement);
      announce(casual ? "Pickup time sent to the seller." : "Pickup time proposed.");
    } catch (err) {
      setError(err.message || "Could not propose this time.");
    } finally {
      setProposing(false);
    }
  };

  const handleMessageSeller = async () => {
    if (!sellerWallet) return;
    setConversationBusy(true);
    try {
      const { data } = await getOrCreateConversation(sellerWallet);
      if (data?.id) {
        window.dispatchEvent(new CustomEvent("aquadex_open_conversation", {
          detail: { conversationId: data.id, targetWallet: sellerWallet },
        }));
      }
    } finally {
      setConversationBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={panelStyle}>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Loading pickup details…</span>
      </div>
    );
  }

  if (error && !location) {
    return (
      <div style={panelStyle}>
        <span style={{ fontSize: "0.78rem", color: "var(--accent-red, #f87171)" }} role="alert">{error}</span>
      </div>
    );
  }

  if (!location) {
    return (
      <div style={panelStyle}>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          {casual ? "The seller hasn't set up a pickup spot yet." : "No pickup spot configured yet."}
        </span>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <h4 style={{ margin: 0, fontSize: "0.9rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.4rem" }}>
        📍 {location.label}
      </h4>

      {/* Safety line — non-dismissible, per spec §4. */}
      <div style={safetyBanner}>
        {casual
          ? "Meet in a public place and take a look at the fish before you complete the handoff."
          : "Meet in a public location. Inspect livestock before completing the handoff."}
      </div>

      <PickupMap lat={location.lat} lng={location.lng} addressText={location.addressText} />

      {location.addressText && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{location.addressText}</span>
          {location.lat != null && location.lng != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              style={openInMapsLink}
            >
              Open in Maps ↗
            </a>
          )}
        </div>
      )}

      {location.notes && (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>{location.notes}</p>
      )}

      {/* Status + confirmed time */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <span style={{ fontSize: "0.78rem", color: "#fff", fontWeight: 600 }}>{statusView.label}</span>
        {arrangement?.confirmedTime && (
          <span style={{ fontSize: "0.75rem", color: "var(--accent-green, #34d399)" }}>
            {new Date(arrangement.confirmedTime).toLocaleString()}
          </span>
        )}
        {arrangement?.proposedTime && !arrangement?.confirmedTime && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {casual ? "You proposed: " : "Proposed: "}{new Date(arrangement.proposedTime).toLocaleString()}
          </span>
        )}
      </div>

      {/* Propose-a-time control — only offered while nothing is confirmed yet. */}
      {arrangement?.status !== "confirmed" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label htmlFor="pickup-slot-select" style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
            {casual ? "Pick a time that works for you" : "Select an available window"}
          </label>
          {slots.length === 0 ? (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {casual ? "The seller hasn't added any available times yet." : "No availability windows configured."}
            </span>
          ) : (
            <>
              <select id="pickup-slot-select" value={selectedSlot} onChange={(e) => setSelectedSlot(e.target.value)} style={selectStyle}>
                <option value="">{casual ? "Choose a time…" : "Select a time"}</option>
                {slots.map((slot) => (
                  <option key={slot.startISO} value={slot.startISO}>
                    {new Date(slot.startISO).toLocaleString()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                disabled={!selectedSlot || proposing}
                onClick={handlePropose}
                style={{ alignSelf: "flex-start", padding: "0.5rem 0.9rem", fontSize: "0.8rem" }}
              >
                {proposing ? "Sending…" : (casual ? "Send this time to the seller" : "Propose this time")}
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <span style={{ fontSize: "0.75rem", color: "var(--accent-red, #f87171)" }} role="alert">{error}</span>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn-secondary" onClick={handleMessageSeller} disabled={conversationBusy} style={{ fontSize: "0.78rem", padding: "0.45rem 0.8rem" }}>
          {conversationBusy ? "Opening…" : "Message seller"}
        </button>
        {typeof onOpenHandoff === "function" && (
          <button type="button" className="btn-primary" onClick={onOpenHandoff} style={{ fontSize: "0.78rem", padding: "0.45rem 0.8rem" }}>
            {casual ? "Get my pickup PIN/QR" : "Open handoff code"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Embedded map (mirrors TideMap.jsx's load/init pattern) ────────────────

function PickupMap({ lat, lng, addressText }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!MAPBOX_TOKEN || lat == null || lng == null) return;
    if (window.mapboxgl) {
      initMap();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css";
    document.head.appendChild(link);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  function initMap() {
    if (!mapContainer.current || !window.mapboxgl || mapRef.current) return;
    window.mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new window.mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [lng, lat],
      zoom: 14,
      interactive: !prefersReducedMotion(),
    });
    mapRef.current = map;
    map.on("load", () => {
      const el = document.createElement("div");
      el.textContent = "📍";
      el.style.fontSize = "1.5rem";
      new window.mapboxgl.Marker(el).setLngLat([lng, lat]).addTo(map);
    });
  }

  if (!MAPBOX_TOKEN || lat == null || lng == null) {
    // Graceful degrade: address-text + Open-in-Maps link cover this case
    // already (rendered by the parent); this component just renders nothing
    // extra so the layout doesn't show an empty map box.
    return null;
  }

  return <div ref={mapContainer} style={{ height: "200px", borderRadius: "8px", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))" }} aria-label={addressText ? `Map showing ${addressText}` : "Pickup location map"} />;
}

const panelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "0.6rem",
  padding: "0.9rem 1rem",
  borderRadius: "10px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.12))",
};

const safetyBanner = {
  padding: "0.5rem 0.65rem",
  borderRadius: "6px",
  background: "rgba(251,191,36,0.06)",
  border: "1px solid rgba(251,191,36,0.25)",
  fontSize: "0.72rem",
  color: "var(--text-secondary, #cbd5e1)",
};

const openInMapsLink = { fontSize: "0.72rem", color: "var(--accent-blue, #60a5fa)", textDecoration: "none" };

const selectStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.12))",
  borderRadius: "6px",
  padding: "0.45rem 0.6rem",
  color: "#fff",
  fontSize: "0.78rem",
};

export default PickupPanel;
