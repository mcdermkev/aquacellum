/**
 * BoothHelpers — the seller adds helpers to their booth by showing a QR.
 *
 * Flow: tap "Show helper code" → a one-time QR appears → the helper scans it
 * with their phone camera and signs in → their name appears here and the code
 * is gone (single use). "Add another helper" makes a new one.
 *
 * Helpers can ring up cash sales and start card sales. They cannot change
 * counts, confirm card pickups (that releases money), publish tanks, or manage
 * helpers — the server enforces that; this panel only explains it.
 *
 * Seller-only. Rendered from BoothInventory when the booth is the seller's own.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { UsersThree, X, SpinnerGap, CheckCircle, Warning } from "@phosphor-icons/react";
import { createHelperInvite, listHelpers, removeHelper } from "../../services/boothApi";
import { shortWallet } from "../../services/boothInventory";

const TAP_MIN = "48px";
const POLL_MS = 3000;

function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * "3 cash sales · $45.00 in the last 24 hours". null when the server couldn't
 * load totals, so we show nothing rather than a misleading zero.
 */
export function formatHelperSales(cashSales, windowHours = 24) {
  if (!cashSales) return null;
  const { count = 0, totalCents = 0 } = cashSales;
  const span = `in the last ${windowHours} hours`;
  if (!count) return `No cash sales ${span}`;
  const dollars = (totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `${count} cash ${count === 1 ? "sale" : "sales"} · ${dollars} ${span}`;
}

export function BoothHelpers({ onClose }) {
  const [helpers, setHelpers] = useState([]);
  const [salesWindowHours, setSalesWindowHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [invite, setInvite] = useState(null); // { qr, expiresAt, knownBefore:Set }
  const [creating, setCreating] = useState(false);
  const [joined, setJoined] = useState(null); // { name, wallet }
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [now, setNow] = useState(Date.now());
  const closeRef = useRef(null);

  const refresh = useCallback(async () => {
    const r = await listHelpers();
    if (r.success) {
      setHelpers(r.helpers || []);
      if (Number.isFinite(r.salesWindowHours)) setSalesWindowHours(r.salesWindowHours);
      setError(null);
    } else if (!r.offline) {
      setError(r.error || "Could not load helpers.");
    }
    setLoading(false);
    return r;
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    refresh();
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh, onClose]);

  // While a code is showing: tick the countdown and watch for the helper to join.
  useEffect(() => {
    if (!invite) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const r = await refresh();
      if (!r.success) return;
      const fresh = (r.helpers || []).find((h) => !invite.knownBefore.has(h.wallet));
      if (fresh) {
        setJoined({ name: fresh.name, wallet: fresh.wallet });
        setInvite(null); // single use — the code is spent
      }
    }, POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [invite, refresh]);

  const expired = invite && new Date(invite.expiresAt).getTime() <= now;

  const showCode = async () => {
    setCreating(true);
    setError(null);
    setJoined(null);
    const r = await createHelperInvite();
    if (!r.success) {
      setError(r.offline ? "Showing a helper code needs a connection." : r.error || "Could not make a code.");
      setCreating(false);
      return;
    }
    try {
      const qr = await QRCode.toDataURL(r.joinUrl, { width: 280, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
      setInvite({ qr, expiresAt: r.expiresAt, knownBefore: new Set(helpers.map((h) => h.wallet)) });
      setNow(Date.now());
    } catch {
      setError("Could not draw the code.");
    }
    setCreating(false);
  };

  const remove = async (wallet) => {
    if (confirmRemove !== wallet) { setConfirmRemove(wallet); return; }
    setConfirmRemove(null);
    const r = await removeHelper(wallet);
    if (!r.success) { setError(r.error || "Could not remove the helper."); return; }
    refresh();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booth-helpers-title"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2,6,23,0.72)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className="glass-card"
        style={{ width: "100%", maxWidth: "520px", maxHeight: "92vh", overflowY: "auto", padding: "1.25rem", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column", gap: "1rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <UsersThree size={26} weight="duotone" color="#7dd3fc" />
          <h3 id="booth-helpers-title" style={{ color: "#fff", fontSize: "1.15rem", margin: 0, flex: 1 }}>Booth helpers</h3>
          <button ref={closeRef} type="button" className="btn-secondary" onClick={onClose} aria-label="Close" style={{ minWidth: TAP_MIN, minHeight: TAP_MIN }}>
            <X size={20} weight="bold" />
          </button>
        </div>

        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", margin: 0, lineHeight: 1.5 }}>
          Helpers can ring up sales for your booth from their own phone. Only you can change counts,
          confirm card pickups, or publish tanks.
        </p>

        {joined && (
          <div role="status" style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "#86efac", fontSize: "1rem", fontWeight: 600 }}>
            <CheckCircle size={22} weight="fill" /> {joined.name || shortWallet(joined.wallet)} joined your booth.
          </div>
        )}

        {invite && !expired ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem" }}>
            <img src={invite.qr} alt="Helper code. Have your helper scan this with their phone camera." width={260} height={260} style={{ borderRadius: "12px", background: "#fff", padding: "6px" }} />
            <p style={{ color: "#fff", fontSize: "1rem", fontWeight: 600, margin: 0, textAlign: "center" }}>
              Have your helper scan this with their phone camera.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }} aria-live="polite">
              Works once · expires in {formatCountdown(new Date(invite.expiresAt).getTime() - now)}
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={showCode}
            disabled={creating}
            style={{ minHeight: "56px", fontSize: "1.05rem", fontWeight: 700, borderRadius: "12px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
          >
            {creating ? <SpinnerGap size={20} className="spin" /> : null}
            {expired ? "Code expired — show a new one" : joined || helpers.length ? "Add another helper" : "Show helper code"}
          </button>
        )}

        {error && (
          <div role="alert" style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "#fca5a5", fontSize: "0.95rem" }}>
            <Warning size={20} weight="duotone" /> {error}
          </div>
        )}

        <div>
          <h4 style={{ color: "#fff", fontSize: "0.95rem", margin: "0 0 0.5rem 0" }}>Current helpers</h4>
          {loading ? (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Loading…</p>
          ) : helpers.length === 0 ? (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>No helpers yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {helpers.map((h) => {
                const salesLine = formatHelperSales(h.cashSales, salesWindowHours);
                return (
                <li key={h.wallet} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ flex: 1, minWidth: 0, color: "#fff", fontSize: "0.95rem" }}>
                    {h.name || "Helper"}{" "}
                    <span style={{ color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8rem" }}>{shortWallet(h.wallet)}</span>
                    {salesLine && (
                      <span style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.15rem" }}>
                        {salesLine}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => remove(h.wallet)}
                    aria-label={`Remove helper ${h.name || shortWallet(h.wallet)}`}
                    style={{ minHeight: TAP_MIN, padding: "0 0.9rem", color: confirmRemove === h.wallet ? "#fca5a5" : undefined }}
                  >
                    {confirmRemove === h.wallet ? "Tap again to remove" : "Remove"}
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
