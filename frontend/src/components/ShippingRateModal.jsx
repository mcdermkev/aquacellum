import React, { useState, useEffect, useRef } from "react";
import { getShippingRates, describeRate, formatUSD } from "../services/shipping";

/**
 * ShippingRateModal — buyer-paid live shipping at checkout.
 *
 * Collects the buyer's destination address, fetches live expedited rates from
 * the seller's origin (ShipEngine), shows heat-pack / ship-window advice for
 * live fish, and hands the selected rate back to the parent to start Stripe
 * Checkout. There is no single "marketplace address" — each order is rated
 * seller→buyer, so distance-based pricing just works.
 *
 * Props:
 *   isOpen        boolean
 *   onClose       () => void
 *   listing       { seller, tokenId, commonName, priceCentsUSD, ... }
 *   onProceed     ({ rate, shipTo }) => void   // parent starts checkout
 */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

export function ShippingRateModal({ isOpen, onClose, listing, onProceed }) {
  const [form, setForm] = useState({
    name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", residential: "yes",
  });
  const [rates, setRates] = useState([]);
  const [advice, setAdvice] = useState(null);
  const [handlingFeeCents, setHandlingFeeCents] = useState(0);
  const [selectedRateId, setSelectedRateId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quoted, setQuoted] = useState(false);
  const dialogRef = useRef(null);

  // Task 21D a11y fix: this modal predated the shared accessible Modal
  // component and had no dialog semantics — Escape-to-close and initial
  // focus into the dialog, matching Modal.jsx's own behavior (kept local
  // rather than migrating to <Modal> to avoid restructuring this
  // form-heavy layout in a hardening pass).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => dialogRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const canQuote = form.addressLine1 && form.city && form.state && form.postalCode;
  const selectedRate = rates.find((r) => r.rateId === selectedRateId) || rates[0] || null;

  const handleQuote = async () => {
    setLoading(true);
    setError(null);
    setRates([]);
    setAdvice(null);
    setSelectedRateId(null);
    try {
      const shipTo = {
        name: form.name || undefined,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || undefined,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        countryCode: "US",
        residential: form.residential,
      };
      const res = await getShippingRates({ sellerWallet: listing.seller, shipTo });
      if (!res.success) {
        if (res.code === "SELLER_NO_SHIP_FROM") {
          setError("This seller hasn't finished setting up shipping yet. Try local pickup or contact the seller.");
        } else {
          setError(res.error || "Could not fetch shipping rates.");
        }
        return;
      }
      if (!res.rates || res.rates.length === 0) {
        setError(res.message || "No expedited shipping options available for this route.");
        return;
      }
      setRates(res.rates);
      setAdvice(res.advice || null);
      setHandlingFeeCents(res.handlingFeeCents || 0);
      setSelectedRateId(res.rates[0].rateId);
      setQuoted(true);
    } catch (err) {
      setError(err.message || "Network error fetching rates.");
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (!selectedRate) return;
    const shipTo = {
      name: form.name || undefined,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2 || undefined,
      city: form.city,
      state: form.state,
      postalCode: form.postalCode,
      countryCode: "US",
      residential: form.residential,
    };
    onProceed({ rate: selectedRate, shipTo });
  };

  const priceUSD = formatUSD(listing.priceCentsUSD || 0);

  return (
    <div style={overlay} onClick={onClose} aria-hidden="true">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Shipping options for ${listing.commonName || "live specimen"}`}
        tabIndex={-1}
        style={modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: "#fff" }}>🚚 Shipping — {listing.commonName || "Live specimen"}</h3>
          <button onClick={onClose} style={closeBtn} aria-label="Close shipping options">✕</button>
        </div>

        <p style={{ color: "var(--text-muted, #9fb3c8)", fontSize: "0.85rem", marginTop: 0 }}>
          Item {priceUSD}. Shipping is quoted live from the seller to your address, so you only pay the real
          distance-based cost. Live fish ship expedited only.
        </p>

        {/* Address form */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Full name" value={form.name} onChange={set("name")} />
          <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Street address" value={form.addressLine1} onChange={set("addressLine1")} />
          <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Apt / unit (optional)" value={form.addressLine2} onChange={set("addressLine2")} />
          <input style={input} placeholder="City" value={form.city} onChange={set("city")} />
          <select style={input} value={form.state} onChange={set("state")}>
            <option value="">State</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={input} placeholder="ZIP code" value={form.postalCode} onChange={set("postalCode")} />
          <select style={input} value={form.residential} onChange={set("residential")}>
            <option value="yes">Residential</option>
            <option value="no">Business</option>
          </select>
        </div>

        <button onClick={handleQuote} disabled={!canQuote || loading} style={{ ...primaryBtn, marginTop: 12, opacity: (!canQuote || loading) ? 0.5 : 1 }}>
          {loading ? "Getting rates…" : quoted ? "Refresh rates" : "Get shipping rates"}
        </button>

        {error && <div style={errorBox}>{error}</div>}

        {/* Rate options */}
        {rates.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 6 }}>Choose a service</div>
            {rates.map((r) => (
              <label key={r.rateId} style={{ ...rateRow, borderColor: r.rateId === selectedRateId ? "#34d399" : "rgba(255,255,255,0.1)" }}>
                <input type="radio" name="rate" checked={r.rateId === selectedRateId} onChange={() => setSelectedRateId(r.rateId)} />
                <span style={{ flex: 1 }}>{describeRate(r)}</span>
                {r.estimatedDeliveryDate && (
                  <span style={{ color: "var(--text-muted, #9fb3c8)", fontSize: "0.75rem" }}>
                    ~{new Date(r.estimatedDeliveryDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </label>
            ))}

            {/* Live-fish advice */}
            {advice && (
              <div style={adviceBox}>
                {advice.window && (
                  <div style={{ color: advice.window.canShipToday ? "#34d399" : "#fbbf24" }}>
                    ⏱ {advice.window.reason}
                  </div>
                )}
                {advice.thermal && advice.thermal.recommend !== "none" && (
                  <div style={{ color: "#93c5fd", marginTop: 4 }}>
                    {advice.thermal.recommend === "heat" ? "🔥" : "❄️"} {advice.thermal.reason}
                  </div>
                )}
              </div>
            )}

            <button onClick={handleContinue} disabled={!selectedRate} style={{ ...primaryBtn, marginTop: 12, background: "#34d399" }}>
              Continue to payment — {selectedRate ? formatUSD((listing.priceCentsUSD || 0) + selectedRate.amountCents) : priceUSD}
            </button>
            <p style={{ color: "var(--text-muted, #9fb3c8)", fontSize: "0.72rem", textAlign: "center", marginTop: 6 }}>
              Item + shipping{handlingFeeCents > 0 ? " & handling" : ""}. Funds are held in escrow until you confirm live arrival.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── inline styles (kept local to avoid touching global CSS) ────────────────
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const modal = { background: "#0f1b2a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 20, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" };
const input = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "9px 11px", color: "#fff", fontSize: "0.85rem", width: "100%", boxSizing: "border-box" };
const primaryBtn = { width: "100%", padding: "11px", borderRadius: 10, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem" };
const closeBtn = { background: "none", border: "none", color: "#9fb3c8", fontSize: "1.1rem", cursor: "pointer" };
const errorBox = { marginTop: 10, padding: "9px 11px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, color: "#fca5a5", fontSize: "0.82rem" };
const rateRow = { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, marginBottom: 6, color: "#fff", fontSize: "0.85rem", cursor: "pointer" };
const adviceBox = { marginTop: 10, padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 10, fontSize: "0.8rem" };
