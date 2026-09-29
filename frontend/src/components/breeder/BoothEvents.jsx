/**
 * BoothEvents — "I'm at an event" for the seller, and the live event report.
 *
 * Turning an event on gives every card sale the reduced event fee until it ends
 * (the server decides the rate from the seller; nothing here touches money).
 * While it's on, the report shows what sold in person (booth cash, the booth's
 * Card button, tank QR labels) vs online during the event, per fish, refreshed
 * every 30 seconds while this panel is open. Past events keep their reports.
 *
 * Seller-only. Rendered from BoothInventory when the booth is the seller's own.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, X, SpinnerGap, Warning, Storefront, Globe } from "@phosphor-icons/react";
import { endEvent, fetchEventReport, listEvents, startEvent } from "../../services/boothApi";
import { formatPriceCents } from "../../services/catalogQuery";

const TAP_MIN = "48px";
const REPORT_POLL_MS = 30_000;

/** `YYYY-MM-DDTHH:mm` in local time, for <input type="datetime-local">. */
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Default end: tonight at 11:59 pm, or tomorrow night if that's under an hour away. */
export function defaultEventEnd(now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 0, 0);
  if (end.getTime() - now.getTime() < 60 * 60 * 1000) end.setDate(end.getDate() + 1);
  return end;
}

function formatWhen(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function money(cents) {
  return formatPriceCents(Number(cents) || 0);
}

function SideCell({ bucket }) {
  if (!bucket || !bucket.quantity) return <td style={cellStyle}>—</td>;
  return (
    <td style={cellStyle}>
      <strong style={{ color: "var(--text-primary)" }}>{bucket.quantity}</strong>
      <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}> · {money(bucket.cents)}</span>
    </td>
  );
}

const cellStyle = { padding: "0.5rem 0.4rem", borderBottom: "1px solid var(--glass-border)", fontSize: "0.95rem", verticalAlign: "top" };
const headStyle = { ...cellStyle, color: "var(--text-secondary)", fontWeight: 600, textAlign: "left", fontSize: "0.85rem" };

export function EventReportTable({ report }) {
  const lines = report?.lines || [];
  const totals = report?.totals || { inPerson: {}, online: {} };
  if (!lines.length) {
    return <p style={{ color: "var(--text-muted)", margin: 0 }}>No sales yet during this event.</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <caption style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "0.85rem", paddingBottom: "0.4rem" }}>
          Fish sold during the event: quantity and what they sold for.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={headStyle}>Fish</th>
            <th scope="col" style={headStyle}>In person</th>
            <th scope="col" style={headStyle}>Online</th>
            <th scope="col" style={headStyle}>Left</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.listingId || "other"}>
              <th scope="row" style={{ ...cellStyle, color: "var(--text-primary)", textAlign: "left", fontWeight: 600 }}>{line.name}</th>
              <SideCell bucket={line.inPerson} />
              <SideCell bucket={line.online} />
              <td style={{ ...cellStyle, color: "var(--text-secondary)" }}>{line.remaining == null ? "—" : line.remaining}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" style={{ ...cellStyle, color: "var(--text-primary)", textAlign: "left" }}>Total</th>
            <SideCell bucket={totals.inPerson} />
            <SideCell bucket={totals.online} />
            <td style={cellStyle} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function BoothEvents({ onClose, onChange }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [events, setEvents] = useState([]);
  const [feePercent, setFeePercent] = useState(2);
  const [viewingId, setViewingId] = useState(null);
  const [report, setReport] = useState(null);
  const [reportAt, setReportAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [form, setForm] = useState(() => ({ name: "", location: "", endsAt: toLocalInputValue(defaultEventEnd()) }));
  const closeRef = useRef(null);

  const load = useCallback(async () => {
    const r = await listEvents();
    if (r.success) {
      setCurrent(r.current || null);
      setEvents(r.events || []);
      if (Number.isFinite(r.eventFeePercent)) setFeePercent(r.eventFeePercent);
      setViewingId((prev) => prev || r.current?.id || null);
      setError(null);
    } else {
      setError(r.offline ? "Events need a connection." : r.error || "Could not load your events.");
    }
    setLoading(false);
    return r;
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    load();
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  // The report for whichever event is selected; live (polled) while it's running.
  const viewing = events.find((e) => e.id === viewingId) || null;
  useEffect(() => {
    if (!viewingId) { setReport(null); return undefined; }
    let cancelled = false;
    const pull = async () => {
      const r = await fetchEventReport(viewingId);
      if (cancelled) return;
      if (r.success) {
        setReport(r.report);
        setReportAt(r.generatedAt);
      } else if (!r.offline) {
        setError(r.error || "Could not load the report.");
      }
    };
    pull();
    const live = viewing?.active;
    const timer = live ? setInterval(pull, REPORT_POLL_MS) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [viewingId, viewing?.active]);

  const start = async (e) => {
    e.preventDefault();
    const ends = new Date(form.endsAt);
    if (Number.isNaN(ends.getTime())) { setError("Pick when the event ends."); return; }
    setBusy(true);
    setError(null);
    const r = await startEvent({ name: form.name, location: form.location, endsAt: ends.toISOString() });
    setBusy(false);
    if (!r.success) { setError(r.offline ? "Starting an event needs a connection." : r.error || "Could not start the event."); return; }
    setViewingId(r.event?.id || null);
    await load();
    onChange?.();
  };

  const end = async () => {
    if (!confirmEnd) { setConfirmEnd(true); return; }
    setConfirmEnd(false);
    setBusy(true);
    const r = await endEvent();
    setBusy(false);
    if (!r.success) { setError(r.error || "Could not end the event."); return; }
    await load();
    onChange?.();
  };

  const inputStyle = { minHeight: TAP_MIN, width: "100%", padding: "0 0.75rem", borderRadius: "10px", border: "1px solid var(--glass-border)", background: "#fff", color: "var(--text-primary)", fontSize: "1rem" };
  const past = events.filter((e) => !e.active);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booth-events-title"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(11,37,48,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="glass-card" style={{ width: "100%", maxWidth: "620px", maxHeight: "92vh", overflowY: "auto", padding: "1.25rem", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <CalendarCheck size={26} weight="duotone" color="var(--accent-blue)" />
          <h3 id="booth-events-title" style={{ color: "var(--text-primary)", fontSize: "1.15rem", margin: 0, flex: 1 }}>Events</h3>
          <button ref={closeRef} type="button" className="btn-secondary" onClick={onClose} aria-label="Close" style={{ minWidth: TAP_MIN, minHeight: TAP_MIN }}>
            <X size={20} weight="bold" />
          </button>
        </div>

        {loading ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>Loading…</p>
        ) : current ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <p style={{ color: "var(--accent-green)", fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
              At {current.name}{current.location ? ` · ${current.location}` : ""}
            </p>
            <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: "0.95rem" }}>
              Card sales are {feePercent}% while this is on, until {formatWhen(current.endsAt)}.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={end}
              disabled={busy}
              style={{ minHeight: TAP_MIN, alignSelf: "flex-start", padding: "0 1rem", color: confirmEnd ? "var(--accent-red)" : undefined }}
            >
              {confirmEnd ? "Tap again to end the event" : "End event"}
            </button>
          </div>
        ) : (
          <form onSubmit={start} style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }} noValidate>
            <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: "0.95rem", lineHeight: 1.5 }}>
              At a show? Turn this on and your card sales are {feePercent}% until it ends. You&apos;ll also see what sells
              at your booth vs online.
            </p>
            <label style={{ color: "var(--text-primary)", fontSize: "0.95rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              Event name
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={80} required placeholder="Aquashella" style={inputStyle} />
            </label>
            <label style={{ color: "var(--text-primary)", fontSize: "0.95rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              Where (optional)
              <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} maxLength={120} placeholder="City, venue" style={inputStyle} />
            </label>
            <label style={{ color: "var(--text-primary)", fontSize: "0.95rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              Ends
              <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} required style={inputStyle} />
            </label>
            <button type="submit" className="btn-primary" disabled={busy || !form.name.trim()} style={{ minHeight: "56px", fontSize: "1.05rem", fontWeight: 700, borderRadius: "12px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
              {busy ? <SpinnerGap size={20} className="spin" /> : null}
              Start event
            </button>
          </form>
        )}

        {error && (
          <div role="alert" style={{ display: "flex", gap: "0.5rem", alignItems: "center", color: "var(--accent-red)", fontSize: "0.95rem" }}>
            <Warning size={20} weight="duotone" /> {error}
          </div>
        )}

        {viewing && (
          <section aria-labelledby="booth-event-report-title" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <h4 id="booth-event-report-title" style={{ color: "var(--text-primary)", fontSize: "1rem", margin: 0 }}>
              {viewing.active ? "Live: " : ""}{viewing.name}
            </h4>
            {report && (
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", color: "var(--text-primary)" }}>
                  <Storefront size={18} weight="duotone" /> In person: {report.totals.inPerson.quantity} · {money(report.totals.inPerson.cents)}
                </span>
                <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", color: "var(--text-primary)" }}>
                  <Globe size={18} weight="duotone" /> Online: {report.totals.online.quantity} · {money(report.totals.online.cents)}
                </span>
              </div>
            )}
            {report ? <EventReportTable report={report} /> : <p style={{ color: "var(--text-muted)", margin: 0 }}>Loading the report…</p>}
            {reportAt && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }} aria-live="polite">
                Updated {new Date(reportAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                {viewing.active ? " · refreshes every 30 seconds" : ""}
              </p>
            )}
          </section>
        )}

        {past.length > 0 && (
          <div>
            <h4 style={{ color: "var(--text-primary)", fontSize: "0.95rem", margin: "0 0 0.5rem 0" }}>Past events</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {past.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={viewingId === e.id ? "btn-primary" : "btn-secondary"}
                  aria-pressed={viewingId === e.id}
                  onClick={() => setViewingId(e.id)}
                  style={{ minHeight: TAP_MIN, padding: "0 0.8rem", fontSize: "0.9rem" }}
                >
                  {e.name} · {new Date(e.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
