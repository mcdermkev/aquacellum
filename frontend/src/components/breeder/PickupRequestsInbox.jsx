/**
 * PickupRequestsInbox.jsx — the seller's inbox of guest "reserve for local
 * pickup" leads (P3, Tier B). Mounted as the "Pickup Requests" section in
 * BreederTerminal.
 *
 * These leads come from casual buyers on a public showcase/listing who submitted
 * the no-account pickup form. There is NO payment and NO on-chain action here —
 * each row is a contact lead the seller follows up on to arrange a local, in-person
 * handoff. Read-only: the list is fetched from the seller-authenticated
 * `pickup-inquiries` action, which returns only this seller's own rows.
 *
 * Props: { walletAccount, casualModeActive }
 */
import { useEffect, useState } from "react";
import { ChatCircleDots, SpinnerGap, EnvelopeSimple, Phone, ArrowClockwise } from "@phosphor-icons/react";
import { listPickupInquiries, setPickupInquiryStatus } from "../../services/pickupCoordinationApi";
import { announce } from "../../utils/a11y";

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function contactHref(kind, value) {
  if (kind === "email") return `mailto:${value}`;
  if (kind === "phone") return `tel:${value.replace(/[^+0-9]/g, "")}`;
  return null;
}

export function PickupRequestsInbox({ walletAccount, casualModeActive = false }) {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const changeStatus = async (id, status) => {
    setBusyId(id);
    const res = await setPickupInquiryStatus(id, status);
    if (res.success) {
      setInquiries((list) => list.map((q) => (q.id === id ? { ...q, status: res.status || status } : q)));
      announce(`Marked ${status}`);
    }
    setBusyId(null);
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const res = await listPickupInquiries();
    if (res.success) {
      setInquiries(res.inquiries || []);
    } else {
      setError(res.error || "Could not load pickup requests.");
      setInquiries([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    refresh();
  }, [walletAccount]);

  return (
    <div className="sf-merch">
      <div className="sf-setup__header" style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <ChatCircleDots weight="duotone" size={26} style={{ color: "var(--teal-400, #2dd4bf)" }} />
        <div style={{ flex: 1 }}>
          <h2 className="sf-setup__title">Pickup Requests</h2>
          <p className="sf-setup__subtitle">
            {casualModeActive
              ? "People who asked to reserve fish for local pickup"
              : "Guest leads from your public showcase — no account, local pickup"}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh pickup requests"
          disabled={loading}
          style={iconBtnStyle}
        >
          <ArrowClockwise size={15} weight="bold" />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "1.5rem", color: "var(--text-secondary)" }}>
          <SpinnerGap size={20} className="sf-setup__spinner" /> Loading pickup requests…
        </div>
      ) : error ? (
        <p style={{ color: "var(--accent-red, #f87171)", fontSize: "0.82rem" }}>{error}</p>
      ) : inquiries.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
          No pickup requests yet. When someone reserves a pack from your public showcase, it shows up here.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {inquiries.map((q) => {
            const href = contactHref(q.contact_kind, q.contact_value);
            const ContactIcon = q.contact_kind === "phone" ? Phone : EnvelopeSimple;
            return (
              <li key={q.id} className="glass-card" style={{ padding: "0.85rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: "#fff" }}>{q.guest_name}</strong>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      Pack <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{q.listing_key}</span>
                      {q.room_slug ? ` · from /showcase/${q.room_slug}` : ""}
                      {" · "}{formatWhen(q.created_at)}
                    </div>
                  </div>
                  {q.status && q.status !== "new" && (
                    <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "capitalize" }}>{q.status}</span>
                  )}
                </div>

                <div style={{ marginTop: "0.55rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <ContactIcon size={15} weight="duotone" style={{ color: "var(--teal-300, #5eead4)", flexShrink: 0 }} />
                  {href ? (
                    <a href={href} style={{ fontSize: "0.82rem", color: "var(--teal-300, #5eead4)", wordBreak: "break-all" }}>
                      {q.contact_value}
                    </a>
                  ) : (
                    <span style={{ fontSize: "0.82rem", color: "var(--text-primary, #fff)" }}>{q.contact_value}</span>
                  )}
                </div>

                {q.message && (
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                    “{q.message}”
                  </p>
                )}

                <div style={{ marginTop: "0.65rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  {q.status !== "contacted" && (
                    <button type="button" style={actionBtnStyle} disabled={busyId === q.id}
                      onClick={() => changeStatus(q.id, "contacted")}>Mark contacted</button>
                  )}
                  {q.status !== "closed" && (
                    <button type="button" style={actionBtnStyle} disabled={busyId === q.id}
                      onClick={() => changeStatus(q.id, "closed")}>Close</button>
                  )}
                  {q.status && q.status !== "new" && (
                    <button type="button" style={actionBtnStyle} disabled={busyId === q.id}
                      onClick={() => changeStatus(q.id, "new")}>Reopen</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const iconBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "36px",
  height: "36px",
  minWidth: "36px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
  color: "var(--text-secondary)",
  cursor: "pointer",
  flexShrink: 0,
};

const actionBtnStyle = {
  padding: "0.4rem 0.75rem",
  minHeight: "34px",
  fontSize: "0.74rem",
  fontWeight: 600,
  borderRadius: "8px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
