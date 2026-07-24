import React, { useEffect, useRef, useState } from "react";
import {
  listPickupLocations,
  savePickupLocation,
  deletePickupLocation,
} from "../../services/pickupCoordinationApi";
import { validatePickupLocationDraft } from "../../services/pickupCoordination";
import { announce, prefersReducedMotion } from "../../utils/a11y";

/**
 * PickupSpotSetup — seller's PUBLIC pickup meet spots (Task 25).
 *
 * Mirrors ShipFromSetup's list/add/edit pattern, but these spots are the
 * OPPOSITE of a ship-from address: they are meant to be seen by a buyer
 * (post-purchase, on their own paid pickup order) rather than kept private.
 * Mounted in the Breeder Terminal's Shipping section, alongside ShipFromSetup
 * and ParcelPresetEditor.
 *
 * Pin picking reuses the TideMap.jsx Mapbox GL JS load/init pattern (CDN
 * script injection, dark-v11 style, VITE_MAPBOX_TOKEN) rather than an npm
 * dependency — there is no existing shared Mapbox wrapper component to
 * extract from (grep-confirmed) and this stays small enough not to need one.
 * Degrades to manual lat/lng + address-text fields when the token is absent.
 *
 * Props: { walletAccount }
 */

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const EMPTY_FORM = {
  label: "",
  lat: null,
  lng: null,
  addressText: "",
  notes: "",
  availability: [],
  active: true,
};

export function PickupSpotSetup({ walletAccount }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null = not editing; "new" = creating
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await listPickupLocations();
      setLocations(res.success ? res.locations || [] : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    refresh();
  }, [walletAccount]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId("new");
    setError(null);
  };

  const startEdit = (loc) => {
    setForm({
      label: loc.label || "",
      lat: loc.lat,
      lng: loc.lng,
      addressText: loc.addressText || "",
      notes: loc.notes || "",
      availability: loc.availability || [],
      active: loc.active !== false,
    });
    setEditingId(loc.id);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    const draft = {
      label: form.label.trim(),
      lat: form.lat,
      lng: form.lng,
      addressText: form.addressText.trim() || null,
      notes: form.notes.trim() || null,
      availability: form.availability,
      active: form.active,
    };
    const validation = validatePickupLocationDraft(draft);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = editingId && editingId !== "new" ? { id: editingId, ...draft } : draft;
      const res = await savePickupLocation(payload);
      if (!res.success) {
        setError(res.error || "Could not save this pickup spot.");
        return;
      }
      announce("Pickup spot saved.");
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      const res = await deletePickupLocation(id);
      if (!res.success) {
        setError(res.error || "Could not delete this pickup spot.");
        return;
      }
      announce("Pickup spot removed.");
      await refresh();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  };

  return (
    <div className="sf-setup__field" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "1rem" }}>
      <label className="sf-setup__label">📍 Pickup spots</label>
      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 0.75rem 0", lineHeight: 1.5 }}>
        Public meet spots for local pickup orders. The exact address and pin are shown to a buyer only after
        they've paid for a pickup order — this is separate from your private ship-from address above.
      </p>

      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {locations.length === 0 && editingId !== "new" && (
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              No pickup spots yet — add one so buyers can schedule a meet.
            </div>
          )}

          {locations.map((loc) => (
            <LocationRow
              key={loc.id}
              location={loc}
              isEditing={editingId === loc.id}
              onEdit={() => startEdit(loc)}
              onDelete={() => handleDelete(loc.id)}
            >
              {editingId === loc.id && (
                <LocationForm form={form} setForm={setForm} onSave={handleSave} onCancel={cancelEdit} saving={saving} />
              )}
            </LocationRow>
          ))}

          {editingId === "new" ? (
            <div style={spotCard}>
              <LocationForm form={form} setForm={setForm} onSave={handleSave} onCancel={cancelEdit} saving={saving} />
            </div>
          ) : (
            <button type="button" onClick={startCreate} style={addBtn}>
              + Add a pickup spot
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--accent-red, #f87171)" }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function LocationRow({ location, isEditing, onEdit, onDelete, children }) {
  if (isEditing) return <div style={spotCard}>{children}</div>;

  return (
    <div style={{ ...spotCard, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{location.label}</strong>
          {!location.active && (
            <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem", borderRadius: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "var(--text-muted)" }}>
              Inactive
            </span>
          )}
        </div>
        {location.addressText && (
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: "var(--text-secondary)" }}>{location.addressText}</p>
        )}
        <p style={{ margin: "0.15rem 0 0", fontSize: "0.68rem", color: "var(--text-muted)" }}>
          {(location.availability || []).length} availability window{(location.availability || []).length === 1 ? "" : "s"}
        </p>
      </div>
      <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
        <button type="button" onClick={onEdit} style={linkBtn}>Edit</button>
        <button type="button" onClick={onDelete} style={{ ...linkBtn, color: "var(--accent-red, #f87171)" }}>Delete</button>
      </div>
    </div>
  );
}

function LocationForm({ form, setForm, onSave, onCancel, saving }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const canSave = form.label.trim().length > 0;

  const addWindow = () => {
    setForm((f) => ({
      ...f,
      availability: [
        ...f.availability,
        { dow: 5, start: "17:00", end: "19:00", tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
      ],
    }));
  };

  const updateWindow = (idx, patch) => {
    setForm((f) => ({
      ...f,
      availability: f.availability.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    }));
  };

  const removeWindow = (idx) => {
    setForm((f) => ({ ...f, availability: f.availability.filter((_, i) => i !== idx) }));
  };

  return (
    <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <input style={input} placeholder="Label (e.g. Riverside Park lot)" value={form.label} onChange={set("label")} maxLength={80} />

      <MapPinPicker lat={form.lat} lng={form.lng} onPick={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />

      <input style={input} placeholder="Address (shown to the buyer post-purchase)" value={form.addressText} onChange={set("addressText")} maxLength={500} />
      <textarea style={{ ...input, minHeight: "60px", resize: "vertical" }} placeholder="Notes for the buyer (optional — e.g. 'meet by the fountain')" value={form.notes} onChange={set("notes")} maxLength={500} />

      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={!!form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} style={{ width: "14px", height: "14px" }} />
        Active (visible to buyers who purchase a pickup order)
      </label>

      <AvailabilityEditor
        windows={form.availability}
        onAdd={addWindow}
        onUpdate={updateWindow}
        onRemove={removeWindow}
      />

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={!canSave || saving} style={{ ...saveBtn, opacity: (!canSave || saving) ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save pickup spot"}
        </button>
        <button type="button" onClick={onCancel} style={linkBtn}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Availability window editor ──────────────────────────────────────────────

function AvailabilityEditor({ windows, onAdd, onUpdate, onRemove }) {
  return (
    <div style={{ padding: "0.6rem 0.7rem", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))" }}>
      <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 600, marginBottom: "0.5rem" }}>
        Availability windows
      </div>
      {windows.length === 0 && (
        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0 0 0.5rem" }}>
          No windows yet — buyers can't schedule a pickup until you add at least one.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {windows.map((w, idx) => (
          <AvailabilityWindowRow key={idx} window={w} onChange={(patch) => onUpdate(idx, patch)} onRemove={() => onRemove(idx)} />
        ))}
      </div>
      <button type="button" onClick={onAdd} style={{ ...linkBtn, marginTop: "0.5rem" }}>
        + Add a window
      </button>
    </div>
  );
}

function AvailabilityWindowRow({ window, onChange, onRemove }) {
  const isRecurring = window.dow != null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center", padding: "0.4rem", borderRadius: "6px", background: "rgba(255,255,255,0.015)" }}>
      <select
        style={{ ...smallInput, width: "auto" }}
        value={isRecurring ? "recurring" : "one-off"}
        onChange={(e) => {
          if (e.target.value === "recurring") onChange({ dow: 5, date: undefined });
          else onChange({ date: new Date().toISOString().slice(0, 10), dow: undefined });
        }}
      >
        <option value="recurring">Weekly</option>
        <option value="one-off">One-time</option>
      </select>

      {isRecurring ? (
        <select style={{ ...smallInput, width: "auto" }} value={window.dow} onChange={(e) => onChange({ dow: Number(e.target.value) })}>
          {DOW_LABELS.map((label, i) => (
            <option key={i} value={i}>{label}</option>
          ))}
        </select>
      ) : (
        <input type="date" style={{ ...smallInput, width: "auto" }} value={window.date || ""} onChange={(e) => onChange({ date: e.target.value })} />
      )}

      <input type="time" style={{ ...smallInput, width: "auto" }} value={window.start || ""} onChange={(e) => onChange({ start: e.target.value })} aria-label="Start time" />
      <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>to</span>
      <input type="time" style={{ ...smallInput, width: "auto" }} value={window.end || ""} onChange={(e) => onChange({ end: e.target.value })} aria-label="End time" />

      <input
        type="text"
        style={{ ...smallInput, width: "140px" }}
        value={window.tz || ""}
        onChange={(e) => onChange({ tz: e.target.value })}
        placeholder="IANA timezone"
        aria-label="Timezone"
      />

      <button type="button" onClick={onRemove} style={{ ...linkBtn, color: "var(--accent-red, #f87171)", marginLeft: "auto" }}>
        Remove
      </button>
    </div>
  );
}

// ─── Mapbox pin picker (mirrors TideMap.jsx's load/init pattern) ────────────

function MapPinPicker({ lat, lng, onPick }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!MAPBOX_TOKEN) return;
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
  }, []);

  function initMap() {
    if (!mapContainer.current || !window.mapboxgl || mapRef.current) return;
    window.mapboxgl.accessToken = MAPBOX_TOKEN;

    const center = lat != null && lng != null ? [lng, lat] : [-98.5, 39.8]; // continental-US default
    const map = new window.mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: lat != null && lng != null ? 13 : 3,
    });
    mapRef.current = map;

    map.on("load", () => {
      setMapReady(true);
      if (lat != null && lng != null) placeMarker(lat, lng);
    });

    map.on("click", (e) => {
      onPick(e.lngLat.lat, e.lngLat.lng);
      placeMarker(e.lngLat.lat, e.lngLat.lng, { fly: false });
    });
  }

  function placeMarker(placeLat, placeLng, { fly = true } = {}) {
    if (!mapRef.current || !window.mapboxgl) return;
    if (markerRef.current) markerRef.current.remove();
    const el = document.createElement("div");
    el.textContent = "📍";
    el.style.fontSize = "1.5rem";
    markerRef.current = new window.mapboxgl.Marker(el).setLngLat([placeLng, placeLat]).addTo(mapRef.current);
    if (fly && !prefersReducedMotion()) {
      mapRef.current.flyTo({ center: [placeLng, placeLat], zoom: 13 });
    } else {
      mapRef.current.jumpTo({ center: [placeLng, placeLat], zoom: 13 });
    }
  }

  // Keep the marker in sync if lat/lng change from outside (e.g. manual entry).
  useEffect(() => {
    if (mapReady && lat != null && lng != null) placeMarker(lat, lng, { fly: false });
  }, [mapReady, lat, lng]);

  if (!MAPBOX_TOKEN) {
    // Graceful degrade: manual lat/lng entry when no Mapbox token is configured.
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <NumberField label="Latitude" value={lat} onChange={(v) => onPick(v, lng ?? null)} />
        <NumberField label="Longitude" value={lng} onChange={(v) => onPick(lat ?? null, v)} />
        <p style={{ gridColumn: "1 / -1", fontSize: "0.68rem", color: "var(--text-muted)", margin: 0 }}>
          Map unavailable — enter coordinates manually, or leave blank and rely on the address text.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", margin: "0 0 0.35rem" }}>Tap the map to drop a pin</p>
      <div ref={mapContainer} style={{ height: "220px", borderRadius: "8px", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))" }} />
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>{label}</span>
      <input
        type="number"
        step="any"
        style={input}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </div>
  );
}

const spotCard = { padding: "0.65rem 0.75rem", borderRadius: "8px", background: "rgba(255,255,255,0.015)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))" };
const input = { background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))", borderRadius: "6px", padding: "0.5rem 0.6rem", color: "#fff", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" };
const smallInput = { background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))", borderRadius: "6px", padding: "0.35rem 0.5rem", color: "#fff", fontSize: "0.75rem", boxSizing: "border-box" };
const saveBtn = { display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, background: "var(--accent-green, #34d399)", color: "#04231a", border: "none", borderRadius: "8px", cursor: "pointer", minHeight: "40px" };
const linkBtn = { background: "none", border: "none", color: "var(--accent-blue, #60a5fa)", fontSize: "0.75rem", cursor: "pointer", textDecoration: "underline", minHeight: "32px" };
const addBtn = { alignSelf: "flex-start", padding: "0.5rem 0.9rem", minHeight: "44px", fontSize: "0.8rem", fontWeight: 600, background: "rgba(255,255,255,0.03)", border: "1px dashed var(--glass-border, rgba(255,255,255,0.12))", borderRadius: "8px", color: "var(--text-secondary)", cursor: "pointer" };
