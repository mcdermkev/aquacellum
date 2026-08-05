import React, { useEffect, useState } from "react";
import { announce } from "../../utils/a11y";
import { useAuth } from "../../contexts/AuthContext";
import {
  MAX_VACATION_DAYS,
  getMyVacation,
  isSellerPaused,
  setMyVacation,
  validateVacationUntil,
  vacationDaysRemaining,
} from "../../services/sellerVacation";

/**
 * VacationModeControl — Settings → Seller Hub → pause my store.
 *
 * ⚠️ THIS CONTROL IS ONLY SAFE BECAUSE THE ENFORCEMENT EXISTS. A "pause my store"
 * switch that writes an unhonoured flag is the most dangerous dead control in this
 * app: the breeder believes the store is closed while orders for live animals keep
 * arriving. `services/cartRevalidation.js` consumes `pausedSellers` and marks a
 * paused seller's cart items unavailable, excluding them from totals and checkout.
 * If that wiring is ever removed, remove this control with it.
 *
 * It takes a RETURN DATE rather than being a toggle, because `vacation_until`
 * auto-resumes. A boolean has to be switched back manually and fails silently when
 * forgotten — the store stays shut and the breeder finds out from missing sales.
 * A date cannot forget, and it lets buyers see "back on the 20th" instead of a bare
 * "unavailable", which is the difference between waiting and shopping elsewhere.
 */
export function VacationModeControl({ casualModeActive }) {
  const { account } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [dateInput, setDateInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!account) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getMyVacation(account)
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const paused = isSellerPaused(profile);
  const daysLeft = vacationDaysRemaining(profile);

  // Default the picker to a week out — the common case, and it means the
  // primary action is one click rather than a date-entry chore.
  const defaultDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const handlePause = async () => {
    setError(null);
    // End of the chosen day, not midnight at its start — "away until the 20th"
    // colloquially includes the 20th, and pausing until 00:00 would reopen the
    // store a full day early.
    const raw = dateInput || defaultDate;
    const endOfDay = new Date(`${raw}T23:59:59`);
    const check = validateVacationUntil(endOfDay);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setBusy(true);
    const { ok, error: saveError, data } = await setMyVacation(account, check.iso);
    setBusy(false);

    if (!ok) {
      setError(saveError);
      return;
    }
    setProfile(data);
    announce("Store paused. New orders are blocked until you return.");
  };

  const handleResume = async () => {
    setError(null);
    setBusy(true);
    const { ok, error: saveError, data } = await setMyVacation(account, null);
    setBusy(false);

    if (!ok) {
      setError(saveError);
      return;
    }
    setProfile(data);
    announce("Store reopened. You are accepting orders again.");
  };

  if (loading) {
    return <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Checking your store status…</p>;
  }

  if (!account) {
    return (
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Connect your wallet to manage your store status.
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        {casualModeActive
          ? "Going away, or dealing with a heat wave or a sick tank? Pause your store and buyers can't place new orders until you're back. Orders you already have are unaffected."
          : "Pauses inbound orders at checkout. Existing orders and their fulfillment obligations are unaffected. Auto-resumes on the return date."}
      </p>

      {paused ? (
        <div
          style={{
            padding: "0.85rem 1rem",
            borderRadius: 10,
            background: "rgba(251, 191, 36, 0.06)",
            border: "1px solid rgba(251, 191, 36, 0.25)",
          }}
        >
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--accent-amber)", fontWeight: 600 }}>
            🌴 Your store is paused
          </p>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Buyers can browse your listings but cannot check out. You reopen
            automatically on{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {new Date(profile.vacation_until).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </strong>{" "}
            ({daysLeft} {daysLeft === 1 ? "day" : "days"} away).
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={handleResume}
            disabled={busy}
            style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", minHeight: 40 }}
          >
            {busy ? "Reopening…" : "Reopen now"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.75rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Back on</span>
            <input
              type="date"
              value={dateInput || defaultDate}
              min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              max={new Date(Date.now() + MAX_VACATION_DAYS * 24 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 10)}
              onChange={(e) => setDateInput(e.target.value)}
              style={{
                padding: "0.5rem 0.65rem",
                minHeight: 40,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(0,0,0,0.25)",
                color: "var(--text-primary)",
                fontSize: "0.8rem",
              }}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={handlePause}
            disabled={busy}
            style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", minHeight: 40 }}
          >
            {busy ? "Pausing…" : "Pause my store"}
          </button>
        </div>
      )}

      {error && (
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.72rem", color: "var(--accent-red)", lineHeight: 1.4 }}>
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}

export default VacationModeControl;
