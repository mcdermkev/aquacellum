import React, { useEffect, useState } from "react";
import { listParcelPresets, saveParcelPreset, deleteParcelPreset } from "../../services/parcelPresets";
import { normalizeParcelPreset, PACKING_DEFAULTS } from "../../services/packingEngine";

/**
 * ParcelPresetEditor — seller-controlled shipping-box capacity presets
 * (Task 9 Increment 2 §2.4). Mounted alongside ShipFromSetup in the
 * Breeder Terminal's Shipping section.
 *
 * REVIEW GATE (Opus, per docs/TASK_09_INC2_LISTING_FLOW_SPEC.md): every
 * preset shown here is passed straight through
 * `packingEngine.normalizeParcelPreset` for the capacity preview, and the
 * server-side write path (stripe.js `?action=parcel-presets`) writes the
 * SAME capacity columns that engine reads. This is the "preset feeds the
 * packing engine" change the spec calls out for review — nothing here
 * re-derives capacity math; it only edits the seller's config and previews
 * the existing engine's output on it.
 *
 * Props: { walletAccount }
 */

const EMPTY_FORM = {
  label: "",
  usableWeightOz: String(PACKING_DEFAULTS.usableWeightOz),
  maxBags: String(PACKING_DEFAULTS.maxBags),
  usableVolumeIn3: String(PACKING_DEFAULTS.usableVolumeIn3),
  thermalPackSpaceIn3: String(PACKING_DEFAULTS.thermalPackSpaceIn3),
  maxLivestock: String(PACKING_DEFAULTS.maxLivestock),
  isDefault: false,
};

export function ParcelPresetEditor({ walletAccount }) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null = not editing; "new" = creating
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await listParcelPresets();
      setPresets(res.success ? res.presets || [] : []);
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

  const startEdit = (preset) => {
    setForm({
      label: preset.label || "",
      usableWeightOz: String(preset.usableWeightOz ?? PACKING_DEFAULTS.usableWeightOz),
      maxBags: String(preset.maxBags ?? PACKING_DEFAULTS.maxBags),
      usableVolumeIn3: String(preset.usableVolumeIn3 ?? PACKING_DEFAULTS.usableVolumeIn3),
      thermalPackSpaceIn3: String(preset.thermalPackSpaceIn3 ?? PACKING_DEFAULTS.thermalPackSpaceIn3),
      maxLivestock: String(preset.maxLivestock ?? PACKING_DEFAULTS.maxLivestock),
      isDefault: !!preset.isDefault,
    });
    setEditingId(preset.id);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const set = (key) => (e) => {
    const value = key === "isDefault" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const canSave = form.label.trim().length > 0
    && [form.usableWeightOz, form.maxBags, form.usableVolumeIn3, form.thermalPackSpaceIn3, form.maxLivestock]
      .every((v) => Number(v) > 0);

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        label: form.label.trim(),
        usableWeightOz: Number(form.usableWeightOz),
        maxBags: Number(form.maxBags),
        usableVolumeIn3: Number(form.usableVolumeIn3),
        thermalPackSpaceIn3: Number(form.thermalPackSpaceIn3),
        maxLivestock: Number(form.maxLivestock),
        isDefault: !!form.isDefault,
      };
      if (editingId && editingId !== "new") payload.id = editingId;
      const res = await saveParcelPreset(payload);
      if (!res.success) {
        setError(res.error || "Could not save this preset.");
        return;
      }
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
      const res = await deleteParcelPreset(id);
      if (!res.success) {
        setError(res.error || "Could not delete this preset.");
        return;
      }
      await refresh();
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  };

  // The live capacity preview — the exact object the packing engine will use
  // for any listing assigned to this preset. Composed, not re-derived.
  const previewFor = (raw) => normalizeParcelPreset({
    label: raw.label,
    usable_weight_oz: Number(raw.usableWeightOz),
    max_bags: Number(raw.maxBags),
    usable_volume_in3: Number(raw.usableVolumeIn3),
    thermal_pack_space_in3: Number(raw.thermalPackSpaceIn3),
    max_livestock: Number(raw.maxLivestock),
  });

  return (
    <div className="sf-setup__field" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "1rem" }}>
      <label className="sf-setup__label">📦 Parcel presets</label>
      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 0.75rem 0", lineHeight: 1.5 }}>
        Your reusable insulated-box configurations. Each listing's packing profile is checked against one of
        these so you can see exactly how many bags and fish a box fits before you ship.
      </p>

      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {presets.length === 0 && editingId !== "new" && (
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              No presets yet — new listings use a sensible default box until you add one.
            </div>
          )}

          {presets.map((preset) => (
            <PresetRow
              key={preset.id}
              preset={preset}
              preview={previewFor(preset)}
              isEditing={editingId === preset.id}
              onEdit={() => startEdit(preset)}
              onDelete={() => handleDelete(preset.id)}
            >
              {editingId === preset.id && (
                <PresetForm
                  form={form}
                  set={set}
                  onSave={handleSave}
                  onCancel={cancelEdit}
                  saving={saving}
                  canSave={canSave}
                  preview={previewFor(form)}
                />
              )}
            </PresetRow>
          ))}

          {editingId === "new" ? (
            <div style={presetCard}>
              <PresetForm
                form={form}
                set={set}
                onSave={handleSave}
                onCancel={cancelEdit}
                saving={saving}
                canSave={canSave}
                preview={previewFor(form)}
              />
            </div>
          ) : (
            <button type="button" onClick={startCreate} style={addBtn}>
              + Add a parcel preset
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--accent-red, #f87171)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function PresetRow({ preset, preview, isEditing, onEdit, onDelete, children }) {
  if (isEditing) return <div style={presetCard}>{children}</div>;

  return (
    <div style={{ ...presetCard, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{preset.label}</strong>
          {preset.isDefault && (
            <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem", borderRadius: "8px", background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee" }}>
              Default
            </span>
          )}
        </div>
        <CapacityPreview preview={preview} />
      </div>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button type="button" onClick={onEdit} style={linkBtn}>Edit</button>
        <button type="button" onClick={onDelete} style={{ ...linkBtn, color: "var(--accent-red, #f87171)" }}>Delete</button>
      </div>
    </div>
  );
}

/**
 * Friendly capacity read-out. Text-conveyed (not color/icon-only) so it's
 * accessible without relying on the teal→cyan meter styling alone.
 */
function CapacityPreview({ preview }) {
  return (
    <p style={{ margin: "0.25rem 0 0", fontSize: "0.7rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
      This box fits ~{preview.maxBags} bag{preview.maxBags === 1 ? "" : "s"} · ~{preview.maxLivestock} fish ·
      {" "}{preview.usableWeightOz}oz · {preview.usableVolumeIn3}in³
    </p>
  );
}

function PresetForm({ form, set, onSave, onCancel, saving, canSave, preview }) {
  return (
    <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <input
        style={input}
        placeholder="Label (e.g. Medium insulated box)"
        value={form.label}
        onChange={set("label")}
        maxLength={60}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <NumberField label="Usable weight (oz)" value={form.usableWeightOz} onChange={set("usableWeightOz")} />
        <NumberField label="Max bags" value={form.maxBags} onChange={set("maxBags")} />
        <NumberField label="Usable volume (in³)" value={form.usableVolumeIn3} onChange={set("usableVolumeIn3")} />
        <NumberField label="Thermal-pack space (in³)" value={form.thermalPackSpaceIn3} onChange={set("thermalPackSpaceIn3")} />
        <NumberField label="Max livestock" value={form.maxLivestock} onChange={set("maxLivestock")} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
        <input type="checkbox" checked={!!form.isDefault} onChange={set("isDefault")} style={{ width: "14px", height: "14px" }} />
        Use as my default preset
      </label>

      <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))" }}>
        <CapacityPreview preview={preview} />
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={!canSave || saving} style={{ ...saveBtn, opacity: (!canSave || saving) ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save preset"}
        </button>
        <button type="button" onClick={onCancel} style={linkBtn}>Cancel</button>
      </div>
    </form>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>{label}</span>
      <input type="number" min="0" step="any" style={input} value={value} onChange={onChange} />
    </div>
  );
}

const presetCard = { padding: "0.65rem 0.75rem", borderRadius: "8px", background: "rgba(255,255,255,0.015)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))" };
const input = { background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))", borderRadius: "6px", padding: "0.5rem 0.6rem", color: "#fff", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" };
const saveBtn = { display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, background: "var(--accent-green, #34d399)", color: "#04231a", border: "none", borderRadius: "8px", cursor: "pointer", minHeight: "40px" };
const linkBtn = { background: "none", border: "none", color: "var(--accent-blue, #60a5fa)", fontSize: "0.75rem", cursor: "pointer", textDecoration: "underline", minHeight: "32px" };
const addBtn = { alignSelf: "flex-start", padding: "0.5rem 0.9rem", minHeight: "44px", fontSize: "0.8rem", fontWeight: 600, background: "rgba(255,255,255,0.03)", border: "1px dashed var(--glass-border, rgba(255,255,255,0.12))", borderRadius: "8px", color: "var(--text-secondary)", cursor: "pointer" };
