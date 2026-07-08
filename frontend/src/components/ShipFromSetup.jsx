import React, { useEffect, useState } from "react";
import { getSellerShipFrom, saveSellerShipFrom } from "../services/shipping";

/**
 * ShipFromSetup — seller's PRIVATE pickup/origin address.
 *
 * This is the address ShipEngine rates shipments from and buys labels from. It
 * is never shown to buyers or the public (the storefront's public location stays
 * fuzzed). Sellers set it once; every buyer-paid rate quote and in-app label
 * purchase uses it automatically.
 *
 * Props: { walletAccount }
 */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const EMPTY = {
  name: "", phone: "", companyName: "",
  addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "",
  residential: "unknown",
};

export function ShipFromSetup({ walletAccount }) {
  const [form, setForm] = useState(EMPTY);
  const [configured, setConfigured] = useState(false);
  const [validated, setValidated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!walletAccount) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getSellerShipFrom(walletAccount);
        if (cancelled) return;
        if (res.configured && res.shipFrom) {
          const s = res.shipFrom;
          setForm({
            name: s.name || "", phone: s.phone || "", companyName: s.companyName || "",
            addressLine1: s.addressLine1 || "", addressLine2: s.addressLine2 || "",
            city: s.city || "", state: s.state || "", postalCode: s.postalCode || "",
            residential: s.residential || "unknown",
          });
          setConfigured(true);
          setValidated(!!s.isValidated);
        }
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canSave = form.name && form.addressLine1 && form.city && form.state && form.postalCode;

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!canSave || !walletAccount) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await saveSellerShipFrom({ walletAddress: walletAccount, ...form });
      if (!res.success) {
        setResult({ ok: false, message: res.error || "Could not save address." });
      } else {
        setConfigured(true);
        const status = res.validation?.status;
        setValidated(status === "verified");
        setResult({
          ok: true,
          message: status === "verified"
            ? "Saved and verified — you're ready to ship."
            : "Saved. We couldn't fully verify this address; double-check it so rates and labels work.",
        });
        setExpanded(false);
      }
    } catch (err) {
      setResult({ ok: false, message: err.message || "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  const showForm = expanded || (!configured && !loading);

  return (
    <div className="sf-setup__field" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "0.5rem" }}>
      <label className="sf-setup__label">📦 Ship-from address</label>
      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 0.75rem 0", lineHeight: 1.5 }}>
        Where you ship from. Used to quote real, distance-based rates to each buyer and to buy labels in-app.
        This stays private — buyers never see it.
      </p>

      {loading ? (
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Loading…</div>
      ) : configured && !showForm ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", color: validated ? "var(--accent-green, #34d399)" : "var(--accent-amber, #fbbf24)" }}>
            {validated ? "✓ Ship-from set & verified" : "⚠ Ship-from set (unverified)"} — {form.city}, {form.state} {form.postalCode}
          </span>
          <button type="button" onClick={() => setExpanded(true)} style={linkBtn}>Edit</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Name / business" value={form.name} onChange={set("name")} />
          <input style={input} placeholder="Company (optional)" value={form.companyName} onChange={set("companyName")} />
          <input style={input} placeholder="Phone (optional)" value={form.phone} onChange={set("phone")} />
          <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Street address" value={form.addressLine1} onChange={set("addressLine1")} />
          <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Suite / unit (optional)" value={form.addressLine2} onChange={set("addressLine2")} />
          <input style={input} placeholder="City" value={form.city} onChange={set("city")} />
          <select style={input} value={form.state} onChange={set("state")}>
            <option value="">State</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input style={input} placeholder="ZIP" value={form.postalCode} onChange={set("postalCode")} />
          <select style={input} value={form.residential} onChange={set("residential")}>
            <option value="unknown">Address type</option>
            <option value="yes">Residential</option>
            <option value="no">Business</option>
          </select>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button type="button" onClick={handleSave} disabled={!canSave || saving} style={{ ...saveBtn, opacity: (!canSave || saving) ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save ship-from address"}
            </button>
            {configured && <button type="button" onClick={() => setExpanded(false)} style={linkBtn}>Cancel</button>}
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: result.ok ? "var(--accent-green, #34d399)" : "var(--accent-red, #f87171)" }}>
          {result.message}
        </div>
      )}
    </div>
  );
}

const input = { background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border, rgba(255,255,255,0.12))", borderRadius: "6px", padding: "0.5rem 0.6rem", color: "#fff", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" };
const saveBtn = { display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 1rem", fontSize: "0.85rem", fontWeight: 600, background: "var(--accent-green, #34d399)", color: "#04231a", border: "none", borderRadius: "8px", cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "var(--accent-blue, #60a5fa)", fontSize: "0.8rem", cursor: "pointer", textDecoration: "underline" };
