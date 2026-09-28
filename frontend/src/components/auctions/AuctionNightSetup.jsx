/**
 * AuctionNightSetup — lots (paste a list from a spreadsheet) and bidder
 * numbers for a club auction night.
 */

import { useMemo, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { addBidder, addLots, removeLot } from "../../services/auctionNightApi";
import { parseLotImport } from "../../services/auctionNightImport";
import { centsToDollars } from "../../services/auctionsApi";
import { lotChip } from "./AuctionNightClerk";
import { Note } from "./AuctionNightUi";

const SAMPLE = "Blue velvet shrimp x10\t$10\tSteve\t20\nJava fern on driftwood\t$5\tAnn\nApistogramma cacatuoides pair\t$20\tMike\t10";

export function LotsPanel({ data, refresh }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const parsed = useMemo(() => parseLotImport(text), [text]);
  const lots = useMemo(() => [...data.lots].sort((a, b) => (a.lot_number || 0) - (b.lot_number || 0)), [data.lots]);
  const nextNumber = (lots[lots.length - 1]?.lot_number || 0) + 1;

  const submit = async () => {
    setBusy(true); setMsg(null);
    const r = await addLots(data.auction.id, parsed.lots);
    setBusy(false);
    await refresh();
    if (!r.success) {
      const added = r.added?.length || 0;
      return setMsg({ tone: "err", text: `${added ? `Added ${added}, then stopped: ` : ""}${r.error}` });
    }
    setText("");
    setMsg({ tone: "ok", text: `Added ${r.added.length} lot${r.added.length === 1 ? "" : "s"}.` });
  };

  const remove = async (lot) => {
    if (!window.confirm(`Remove lot ${lot.lot_number}, "${lot.title}"?`)) return;
    setBusy(true);
    const r = await removeLot(lot.id);
    setBusy(false);
    if (!r.success) setMsg({ tone: "err", text: r.error });
    await refresh();
  };

  return (
    <div className="an-grid an-grid-2">
      <div className="an-card an-stack">
        <h2 className="an-h">Lots ({lots.length})</h2>
        {lots.length === 0 && <p className="an-soft">No lots yet. Paste your list on the right.</p>}
        <div className="an-scroll">
          <table className="an-table">
            <thead><tr><th>#</th><th>Lot</th><th>From</th><th className="num">Opens</th><th className="num">Club</th><th /></tr></thead>
            <tbody>
              {lots.map((l) => {
                const chip = lotChip(l);
                const removable = (l.status === "awaiting_live" || l.status === "live") && !l.bid_count;
                return (
                  <tr key={l.id}>
                    <td><b>{l.lot_number}</b></td>
                    <td>{l.title} <span className={`an-chip ${chip.cls}`} style={{ marginLeft: 6 }}>{chip.text}</span></td>
                    <td className="an-soft">{l.consignor_name || "Club"}</td>
                    <td className="num">{centsToDollars(l.starting_bid_cents)}</td>
                    <td className="num">{l.club_split_percent || 0}%</td>
                    <td className="num">
                      {removable && (
                        <button type="button" className="an-btn an-btn-sm an-btn-ghost" onClick={() => remove(l)} disabled={busy} aria-label={`Remove lot ${l.lot_number}`}>
                          <Trash size={16} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="an-card an-stack">
        <h2 className="an-h"><Plus size={18} weight="bold" aria-hidden="true" /> Add lots</h2>
        <p className="an-soft an-small">
          One lot per line. Copy the columns straight from a spreadsheet, or type them with <b>|</b> between:
          title, opening bid, who brought it, club %. Only the title is needed. New lots start at #{nextNumber}.
        </p>
        <label className="an-field"><span className="an-label">Lot list</span>
          <textarea className="an-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} spellCheck={false} />
        </label>
        {text.trim() && (
          <div className="an-small">
            <b>{parsed.lots.length}</b> lot{parsed.lots.length === 1 ? "" : "s"} ready
            {parsed.lots.length > 0 && ` · ${parsed.lots.slice(0, 3).map((l) => `${l.title} (${centsToDollars(l.startingBidCents)})`).join(", ")}${parsed.lots.length > 3 ? "…" : ""}`}
          </div>
        )}
        {parsed.errors.length > 0 && <Note tone="err">{parsed.errors.slice(0, 5).map((e) => <div key={e}>{e}</div>)}</Note>}
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        <button type="button" className="an-btn an-btn-primary" onClick={submit} disabled={busy || parsed.lots.length === 0 || parsed.errors.length > 0}>
          {busy ? "Adding…" : `Add ${parsed.lots.length || ""} lot${parsed.lots.length === 1 ? "" : "s"}`}
        </button>
        <p className="an-small an-muted">Club % is the club&apos;s share of that lot. Blank uses the auction default ({data.auction.defaultSplitPercent || 0}%).</p>
      </div>
    </div>
  );
}

export function BiddersPanel({ data, refresh }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", number: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [filter, setFilter] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const wins = useMemo(() => {
    const m = new Map();
    for (const l of data.lots) if (l.sold_to_bidder_id) m.set(l.sold_to_bidder_id, (m.get(l.sold_to_bidder_id) || 0) + 1);
    return m;
  }, [data.lots]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await addBidder(data.auction.id, { name: f.name, phone: f.phone, email: f.email, number: f.number || null });
    setBusy(false);
    if (!r.success) return setMsg({ tone: "err", text: r.error });
    setMsg({ tone: "ok", text: `${f.name.trim()} is bidder #${r.number}.`, big: r.number });
    setF({ name: "", phone: "", email: "", number: "" });
    await refresh();
  };

  const q = filter.trim().toLowerCase();
  const list = data.bidders.filter((b) => !q || String(b.bidder_number) === q || b.name.toLowerCase().includes(q));

  return (
    <div className="an-grid an-grid-2">
      <div className="an-card an-stack">
        <div className="an-row" style={{ justifyContent: "space-between" }}>
          <h2 className="an-h" style={{ margin: 0 }}>Bidders ({data.bidders.length})</h2>
          <input className="an-input" style={{ maxWidth: 220 }} placeholder="Find by # or name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a bidder" />
        </div>
        {data.bidders.length === 0 && <p className="an-soft">Nobody yet. Give each person a number as they come in.</p>}
        <div className="an-scroll">
          <table className="an-table">
            <thead><tr><th>#</th><th>Name</th><th>Contact</th><th className="num">Won</th></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td><b style={{ fontSize: "1.1rem" }}>{b.bidder_number}</b></td>
                  <td>{b.name}{b.hasCard && <span className="an-chip an-chip-paid" style={{ marginLeft: 6 }}>Card on file</span>}</td>
                  <td className="an-soft an-small">{[b.phone, b.email].filter(Boolean).join(" · ")}</td>
                  <td className="num">{wins.get(b.id) || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="an-card an-stack" onSubmit={submit}>
        <h2 className="an-h"><Plus size={18} weight="bold" aria-hidden="true" /> New bidder</h2>
        <label className="an-field"><span className="an-label">Name</span>
          <input className="an-input" required maxLength={80} value={f.name} onChange={set("name")} autoComplete="off" />
        </label>
        <div className="an-grid an-grid-halves">
          <label className="an-field"><span className="an-label">Phone (optional)</span>
            <input className="an-input" type="tel" maxLength={40} value={f.phone} onChange={set("phone")} autoComplete="off" />
          </label>
          <label className="an-field"><span className="an-label">Email (optional)</span>
            <input className="an-input" type="email" maxLength={200} value={f.email} onChange={set("email")} autoComplete="off" />
          </label>
        </div>
        <label className="an-field"><span className="an-label">Number (blank = next free)</span>
          <input className="an-input" inputMode="numeric" value={f.number} onChange={(e) => setF((p) => ({ ...p, number: e.target.value.replace(/\D/g, "").slice(0, 4) }))} />
        </label>
        {msg && (
          <Note tone={msg.tone}>
            {msg.big && <div style={{ fontSize: "2.5rem", fontWeight: 900, lineHeight: 1 }}>#{msg.big}</div>}
            {msg.text}
          </Note>
        )}
        <button type="submit" className="an-btn an-btn-primary" disabled={busy || !f.name.trim()}>{busy ? "Adding…" : "Give them a number"}</button>
        <p className="an-small an-muted">Email gets their card receipt if they pay by card.</p>
      </form>
    </div>
  );
}
