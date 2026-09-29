import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { db } from "../db";
import { awardXp } from "../utils/xp";
import { syncListingToCloud } from "../services/cloudSync";
import { attachPedigreeToListing } from "../services/listingPedigree";
import { DEFAULT_STANDARD_FEE_PERCENT } from "../services/feePolicy";
import { uploadSpecimenPhoto } from "../services/photoUpload";
import { compressImage } from "../utils/imageCompression";
import {
  FRAG_MOUNTS,
  FRAG_MOUNT_LABELS,
  FRAG_ORIGINS,
  FRAG_ORIGIN_LABELS,
  FRAG_SIZE_UNITS,
  FRAG_SIZE_UNIT_LABELS,
  GROWN_UNDER_MAX,
  buildFragListing,
  coralCareFromSpecies,
  fragCareFromSpecies,
  isFraggableSpecies,
  validateFragForm,
} from "../services/fragListing";

/**
 * FragListingModal — list coral frags for sale.
 *
 * A frag listing is a quantity listing on the same rails as a fry batch
 * (BatchListingWizard): `isBatch`, `batch-<id>` route, live stock, per-unit
 * price. What differs lives in `frag` (size, mount, WYSIWYG, origin, grown
 * under, mother colony photo) — see services/fragListing.js.
 *
 * Frags have no spawn event, so there is no pedigree to seal; the listing
 * records that absence explicitly via attachPedigreeToListing(listing, null).
 *
 * Photos are uploaded to hosted storage before the listing is saved, so only an
 * https URL is ever published (never base64 in the listing blob).
 *
 * Props: isOpen, onClose, walletAccount, onSuccess
 */

const inputStyle = {
  width: "100%",
  padding: "0.65rem",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border)",
  color: "#fff",
  borderRadius: "6px",
  outline: "none",
};
const labelStyle = { display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" };
const hintStyle = { fontSize: "0.65rem", color: "var(--text-muted)", margin: "0.35rem 0 0", lineHeight: 1.45 };

const CORAL_GROUP_ORDER = ["SPS", "LPS", "soft", "zoanthid", "mushroom", "anemone"];
const CORAL_GROUP_LABELS = {
  SPS: "SPS (small-polyp stony)",
  LPS: "LPS (large-polyp stony)",
  soft: "Soft corals",
  zoanthid: "Zoanthids & palythoa",
  mushroom: "Mushrooms",
  anemone: "Anemones",
};

const EMPTY_FORM = {
  speciesCode: "",
  priceUsd: "",
  quantity: "1",
  sizeValue: "",
  sizeUnit: "polyps",
  mount: "plug",
  wysiwyg: false,
  origin: "aquacultured",
  grownUnder: "",
  isShipping: true,
  doaGuarantee: true,
  description: "",
};

function ToggleTile({ pressed, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`delivery-tile ${pressed ? "active" : ""}`}
      style={{ color: "#fff", font: "inherit" }}
    >
      {children}
    </button>
  );
}

function PhotoPicker({ id, label, hint, preview, onPick, onClear, disabled }) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {preview ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <img src={preview} alt={`${label} preview`} style={{ width: "5rem", height: "5rem", objectFit: "cover", borderRadius: "6px" }} />
          <button type="button" className="btn-secondary" onClick={onClear} disabled={disabled} style={{ fontSize: "0.72rem" }}>
            Remove
          </button>
        </div>
      ) : (
        <input
          id={id}
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPick(file);
          }}
          style={{ ...inputStyle, padding: "0.45rem", fontSize: "0.75rem" }}
        />
      )}
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  );
}

export function FragListingModal({ isOpen, onClose, walletAccount, onSuccess }) {
  const [corals, setCorals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [care, setCare] = useState({});
  const [photo, setPhoto] = useState(null); // base64 preview of this frag
  const [motherPhoto, setMotherPhoto] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Reset on close so a reopened form never carries the last listing's values.
  useEffect(() => {
    if (!isOpen) {
      setForm(EMPTY_FORM);
      setCare({});
      setPhoto(null);
      setMotherPhoto(null);
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // The catalog is the same bundled reference the care prefill uses.
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/fishbase_master.json?v=2");
        const data = res.ok ? await res.json() : [];
        const list = (Array.isArray(data) ? data : []).filter(isFraggableSpecies);
        list.sort((a, b) => (a.commonName || "").localeCompare(b.commonName || ""));
        if (active) setCorals(list);
      } catch (e) {
        console.warn("[FragListing] Could not load the coral catalog:", e?.message);
        if (active) setCorals([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const species = useMemo(
    () => corals.find((c) => String(c.specCode) === String(form.speciesCode)) || null,
    [corals, form.speciesCode]
  );
  const reefCare = coralCareFromSpecies(species);

  const groupedCorals = useMemo(() => {
    const groups = new Map();
    for (const c of corals) {
      const key = c.marine?.coralType || "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const order = [...CORAL_GROUP_ORDER, ...[...groups.keys()].filter((k) => !CORAL_GROUP_ORDER.includes(k))];
    return order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)]);
  }, [corals]);

  const handleSpecies = (code) => {
    set("speciesCode", code);
    const record = corals.find((c) => String(c.specCode) === String(code));
    // Care prefill from the catalog; the seller can still edit before listing.
    setCare(fragCareFromSpecies(record) || {});
  };

  const handleWysiwyg = (on) => {
    setForm((f) => ({ ...f, wysiwyg: on, quantity: on ? "1" : f.quantity }));
  };

  const pickPhoto = (setter) => async (file) => {
    try {
      setter(await compressImage(file, 1200, 1200, 0.8));
    } catch (e) {
      setError("That image couldn't be read. Try a JPEG or PNG.");
    }
  };

  const fragInput = {
    sizeValue: form.sizeValue,
    sizeUnit: form.sizeUnit,
    mount: form.mount,
    wysiwyg: form.wysiwyg,
    origin: form.origin,
    grownUnder: form.grownUnder,
  };

  const handleSubmit = async () => {
    if (!walletAccount) {
      setError("Sign in to list frags.");
      return;
    }
    const invalid = validateFragForm({
      species,
      priceUsd: form.priceUsd,
      quantity: Number(form.quantity),
      frag: fragInput,
    });
    if (invalid) {
      setError(invalid);
      return;
    }
    if (form.wysiwyg && !photo) {
      setError("A WYSIWYG listing needs a photo of the exact frag.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const now = Date.now();

      // Upload first: the listing only ever carries hosted https URLs. A failed
      // upload stops the listing rather than silently dropping a photo the
      // seller chose (a WYSIWYG frag without its photo is a different offer).
      let photoUrl = null;
      let motherPhotoUrl = null;
      if (photo) {
        const up = await uploadSpecimenPhoto(photo, walletAccount, `frag-${now}`);
        if (!up.success) throw new Error(`Photo upload failed: ${up.error || "try again"}. Remove it to list without a photo.`);
        photoUrl = up.url;
      }
      if (motherPhoto) {
        const up = await uploadSpecimenPhoto(motherPhoto, walletAccount, `frag-${now}-mother`);
        if (!up.success) throw new Error(`Mother colony photo upload failed: ${up.error || "try again"}. Remove it to list without one.`);
        motherPhotoUrl = up.url;
      }

      const listing = buildFragListing({
        species,
        frag: { ...fragInput, motherPhotoUrl },
        priceUsd: form.priceUsd,
        quantity: Number(form.quantity),
        seller: walletAccount,
        isShipping: form.isShipping,
        doaGuarantee: form.doaGuarantee,
        description: form.description,
        photoUrl,
        care,
        now,
      });

      // No spawn, so no pedigree: record the absence explicitly.
      const saved = attachPedigreeToListing(listing, null);

      await db.localListings.put(saved);
      try { await db.listings.put(saved); } catch (e) { /* non-critical */ }
      syncListingToCloud(saved).catch(() => {});

      awardXp("LIST_DIRECTORY");

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Frag listing creation failed:", err);
      setError(err.message || "Failed to create the frag listing.");
    } finally {
      setSubmitting(false);
    }
  };

  const price = parseFloat(form.priceUsd) || 0;
  const qty = parseInt(form.quantity, 10) || 0;
  const gross = price * qty;
  const fee = gross * (DEFAULT_STANDARD_FEE_PERCENT / 100);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="List coral frags for sale"
      className="sliding-drawer-content"
      fullScreenMobile={true}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute", top: "1.5rem", right: "1.5rem",
          background: "none", border: "none", color: "var(--text-muted)",
          fontSize: "1.75rem", cursor: "pointer", zIndex: 10,
        }}
      >
        &times;
      </button>

      <h3 style={{ fontSize: "1.5rem", color: "#fff", marginTop: "1rem" }}>List Coral Frags</h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Sell frags cut from your colonies. Buyers pick a quantity; stock counts down as they sell.
      </p>

      {error && (
        <div role="alert" style={{
          padding: "0.75rem", backgroundColor: "rgba(248, 113, 113, 0.08)",
          border: "1px solid rgba(248, 113, 113, 0.2)", color: "var(--accent-red)",
          borderRadius: "6px", fontSize: "0.8rem", marginBottom: "1rem",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {/* Species */}
        <div>
          <label htmlFor="frag-species" style={labelStyle}>Coral</label>
          <select
            id="frag-species"
            value={form.speciesCode}
            onChange={(e) => handleSpecies(e.target.value)}
            disabled={loading}
            style={inputStyle}
          >
            <option value="">{loading ? "Loading corals…" : "Choose a coral"}</option>
            {groupedCorals.map(([group, list]) => (
              <optgroup key={group} label={CORAL_GROUP_LABELS[group] || group}>
                {list.map((c) => (
                  <option key={c.specCode} value={c.specCode}>
                    {c.commonName} ({c.scientificName})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!loading && corals.length === 0 && (
            <p style={hintStyle}>The coral catalog didn't load. Check your connection and reopen this form.</p>
          )}
          {reefCare && (
            <p style={{ ...hintStyle, color: "#34d399" }}>
              From the catalog: {[
                reefCare.light && `${reefCare.light} light`,
                reefCare.flow && `${reefCare.flow} flow`,
                reefCare.placement && `${reefCare.placement} placement`,
              ].filter(Boolean).join(" · ")}. Buyers see this on the listing.
            </p>
          )}
        </div>

        {/* Price + quantity */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label htmlFor="frag-price" style={labelStyle}>Price per frag ($)</label>
            <input
              id="frag-price"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              value={form.priceUsd}
              onChange={(e) => set("priceUsd", e.target.value)}
              placeholder="e.g. 25.00"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="frag-qty" style={labelStyle}>Frags available</label>
            <input
              id="frag-qty"
              type="number"
              min="1"
              max="500"
              step="1"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              disabled={form.wysiwyg}
              aria-describedby={form.wysiwyg ? "frag-qty-hint" : undefined}
              style={inputStyle}
            />
            {form.wysiwyg && <p id="frag-qty-hint" style={hintStyle}>WYSIWYG is one exact frag.</p>}
          </div>
        </div>

        {/* Size */}
        <div>
          <span id="frag-size-label" style={labelStyle}>Frag size</span>
          <div style={{ display: "flex", gap: "0.5rem" }} role="group" aria-labelledby="frag-size-label">
            <input
              type="number"
              min="0"
              step={form.sizeUnit === "cm" || form.sizeUnit === "in" ? "0.5" : "1"}
              value={form.sizeValue}
              onChange={(e) => set("sizeValue", e.target.value)}
              placeholder={form.sizeUnit === "polyps" ? "e.g. 5" : form.sizeUnit === "heads" ? "e.g. 2" : "e.g. 1.5"}
              aria-label="Size amount"
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={form.sizeUnit}
              onChange={(e) => set("sizeUnit", e.target.value)}
              aria-label="Size unit"
              style={{ ...inputStyle, width: "auto" }}
            >
              {FRAG_SIZE_UNITS.map((u) => (
                <option key={u} value={u}>{FRAG_SIZE_UNIT_LABELS[u]}</option>
              ))}
            </select>
          </div>
          <p style={hintStyle}>Polyps for zoas and palys, heads for torches and hammers, length for SPS and softies.</p>
        </div>

        {/* Mount + origin */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label htmlFor="frag-mount" style={labelStyle}>Mounted on</label>
            <select id="frag-mount" value={form.mount} onChange={(e) => set("mount", e.target.value)} style={inputStyle}>
              {FRAG_MOUNTS.map((m) => (
                <option key={m} value={m}>{FRAG_MOUNT_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="frag-origin" style={labelStyle}>Origin</label>
            <select id="frag-origin" value={form.origin} onChange={(e) => set("origin", e.target.value)} style={inputStyle}>
              {FRAG_ORIGINS.map((o) => (
                <option key={o} value={o}>{FRAG_ORIGIN_LABELS[o]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* WYSIWYG */}
        <div>
          <span id="frag-wysiwyg-label" style={labelStyle}>Listing photo shows</span>
          <div className="delivery-tile-group" role="group" aria-labelledby="frag-wysiwyg-label">
            <ToggleTile pressed={!form.wysiwyg} onClick={() => handleWysiwyg(false)}>
              <span className="delivery-tile-icon" aria-hidden="true">🪸</span>
              <span className="delivery-tile-label">Representative frag</span>
            </ToggleTile>
            <ToggleTile pressed={form.wysiwyg} onClick={() => handleWysiwyg(true)}>
              <span className="delivery-tile-icon" aria-hidden="true">📸</span>
              <span className="delivery-tile-label">WYSIWYG (this exact frag)</span>
            </ToggleTile>
          </div>
        </div>

        {/* Photos */}
        <PhotoPicker
          id="frag-photo"
          label={form.wysiwyg ? "Photo of this frag (required)" : "Frag photo"}
          hint="Shoot under white or blue-white light if you can, so buyers see true color."
          preview={photo}
          onPick={pickPhoto(setPhoto)}
          onClear={() => setPhoto(null)}
          disabled={submitting}
        />
        <PhotoPicker
          id="frag-mother-photo"
          label="Mother colony photo (optional)"
          hint="Shows buyers what the frag grows into."
          preview={motherPhoto}
          onPick={pickPhoto(setMotherPhoto)}
          onClear={() => setMotherPhoto(null)}
          disabled={submitting}
        />

        {/* Grown under */}
        <div>
          <label htmlFor="frag-grown-under" style={labelStyle}>Grown under (optional)</label>
          <input
            id="frag-grown-under"
            type="text"
            maxLength={GROWN_UNDER_MAX}
            value={form.grownUnder}
            onChange={(e) => set("grownUnder", e.target.value)}
            placeholder="e.g. Radion XR30, ~250 PAR"
            style={inputStyle}
          />
          <p style={hintStyle}>Helps buyers acclimate it. Shown to signed-in buyers.</p>
        </div>

        {/* Delivery */}
        <div>
          <span id="frag-delivery-label" style={labelStyle}>Delivery method</span>
          <div className="delivery-tile-group" role="group" aria-labelledby="frag-delivery-label">
            <ToggleTile pressed={!form.isShipping} onClick={() => set("isShipping", false)}>
              <span className="delivery-tile-icon" aria-hidden="true">📍</span>
              <span className="delivery-tile-label">Local pickup only</span>
            </ToggleTile>
            <ToggleTile pressed={form.isShipping} onClick={() => set("isShipping", true)}>
              <span className="delivery-tile-icon" aria-hidden="true">🚚</span>
              <span className="delivery-tile-label">Shipping available</span>
            </ToggleTile>
          </div>
          {form.isShipping && (
            <p style={hintStyle}>
              Shipping is quoted live at checkout from the buyer's address. Frags pack one per bag.
            </p>
          )}
        </div>

        {/* DOA */}
        <div>
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.doaGuarantee}
              onChange={(e) => set("doaGuarantee", e.target.checked)}
            />
            Offer a DOA guarantee
          </label>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="frag-description" style={labelStyle}>Seller notes</label>
          <textarea
            id="frag-description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="e.g. Healed over and encrusting on the plug. Dipped before shipping."
            rows={3}
            maxLength={500}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
          />
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", float: "right" }}>{form.description.length}/500</span>
        </div>

        {gross > 0 && (
          <div className="receipt-ledger">
            <div className="receipt-row">
              <span>{qty} × ${price.toFixed(2)}:</span>
              <span className="receipt-val-usd">${gross.toFixed(2)}</span>
            </div>
            <div className="receipt-row">
              <span>Card fee ({DEFAULT_STANDARD_FEE_PERCENT}%, cash sales 0%):</span>
              <span className="receipt-val-usd" style={{ color: "var(--accent-red)" }}>-${fee.toFixed(2)}</span>
            </div>
            <div className="receipt-row total">
              <span>Est. net if all sell by card:</span>
              <span className="receipt-val-usd">${(gross - fee).toFixed(2)}</span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary-pro"
            disabled={submitting || loading}
            style={{ flex: 2, justifyContent: "center" }}
          >
            {submitting ? "Listing frags…" : "List Frags"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
