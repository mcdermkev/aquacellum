/**
 * AuctionNightClerk — the clerk's screen for a club auction night.
 *
 * One lot at a time: type the paddle number and the price, tap SOLD (or sell to
 * the online bid, or pass), then Next. The room screen shows whatever lot is
 * current here, so it shows "Sold to #7" until the clerk moves on. Any call can
 * be undone until money has moved for it; the database enforces that.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowRight, Gavel } from "@phosphor-icons/react";
import { addBidder, recordResult, setCurrentLot, undoResult } from "../../services/auctionNightApi";
import { centsToDollars, dollarsToCents } from "../../services/auctionsApi";
import { Note } from "./AuctionNightUi";

const OPEN = new Set(["awaiting_live", "live"]);
const SOLD = new Set(["sold_live", "handed_off", "ended", "charging", "paid", "payment_failed"]);

export function lotChip(l) {
  if (OPEN.has(l.status)) return { cls: "an-chip-up", text: l.status === "live" ? "Online" : "Up" };
  if (l.status === "handed_off" || l.status === "paid") return { cls: "an-chip-paid", text: "Paid" };
  if (l.status === "ended" || l.status === "charging" || l.status === "payment_failed") return { cls: "an-chip-online", text: "Online win" };
  if (l.status === "sold_live") return { cls: "an-chip-sold", text: "Sold" };
  if (l.status === "unsold") return { cls: "an-chip-passed", text: "Passed" };
  return { cls: "", text: l.status };
}

function Rail({ lots, currentId, onPick, busy }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current?.querySelector('[aria-current="true"]');
    if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentId]);
  return (
    <div className="an-rail" ref={ref} aria-label="All lots">
      {lots.map((l) => {
        const chip = lotChip(l);
        const cls = SOLD.has(l.status) ? "is-sold" : l.status === "unsold" ? "is-passed" : "";
        return (
          <button key={l.id} type="button" className={`an-railitem ${cls}`} aria-current={l.id === currentId} disabled={busy}
            onClick={() => onPick(l)} aria-label={`Lot ${l.lot_number}: ${l.title}, ${chip.text}`}>
            <b>{l.lot_number}</b><span>{chip.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ClerkPanel({ data, refresh, goTo }) {
  const lots = useMemo(() => [...data.lots].sort((a, b) => (a.lot_number || 0) - (b.lot_number || 0)), [data.lots]);
  const byNumber = useMemo(() => new Map(data.bidders.map((b) => [b.bidder_number, b])), [data.bidders]);
  const current = lots.find((l) => l.id === data.auction.currentLotId) || null;
  const [paddle, setPaddle] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [toast, setToast] = useState(null);
  const [walkIn, setWalkIn] = useState("");
  const paddleRef = useRef(null);
  const nextRef = useRef(null);

  const open = current && OPEN.has(current.status);
  const nextLot = useMemo(() => {
    const from = current?.lot_number || 0;
    return lots.find((l) => OPEN.has(l.status) && l.lot_number > from) || lots.find((l) => OPEN.has(l.status) && l.id !== current?.id) || null;
  }, [lots, current]);

  // New lot → clear the inputs and put the cursor in the paddle box.
  useEffect(() => {
    setPaddle(""); setPrice(""); setErr(null); setWalkIn("");
    if (open) paddleRef.current?.focus();
    else nextRef.current?.focus();
  }, [current?.id, open]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (fn) => {
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (!r.success) setErr(r.error);
    await refresh();
    return r;
  };

  const pick = (lot) => run(() => setCurrentLot(lot.id));

  const number = paddle === "" ? null : Number(paddle);
  const bidder = number ? byNumber.get(number) : null;
  const cents = dollarsToCents(price);
  const onlineBid = current?.high_bid_cents || null;
  const beatsOnline = !onlineBid || (cents != null && cents > onlineBid);
  const meetsReserve = !current?.reserve_cents || (cents != null && cents >= current.reserve_cents);
  const canSell = open && bidder && cents != null && cents >= 100 && beatsOnline && meetsReserve && !busy;

  const sell = async (e) => {
    e?.preventDefault();
    if (!canSell) return;
    const lot = current;
    const r = await run(() => recordResult(lot.id, "sold", { bidderNumber: number, hammerCents: cents }));
    if (r.success) setToast({ lotId: lot.id, text: `Lot ${lot.lot_number} sold to #${number} for ${centsToDollars(cents)}` });
  };
  const sellOnline = async () => {
    const lot = current;
    const r = await run(() => recordResult(lot.id, "online"));
    if (r.success) setToast({ lotId: lot.id, text: `Lot ${lot.lot_number} sold to the online bidder for ${centsToDollars(lot.high_bid_cents)}` });
  };
  const pass = async () => {
    const lot = current;
    const r = await run(() => recordResult(lot.id, "passed"));
    if (r.success) setToast({ lotId: lot.id, text: `Lot ${lot.lot_number} passed` });
  };
  const undo = async (lotId) => {
    const r = await run(() => undoResult(lotId));
    if (r.success) { setToast(null); if (lotId !== current?.id) await run(() => setCurrentLot(lotId)); }
  };
  const addWalkIn = async () => {
    const r = await run(() => addBidder(data.auction.id, { name: walkIn, number }));
    if (r.success) setWalkIn("");
  };

  const recent = useMemo(
    () => lots.filter((l) => l.closed_at && (SOLD.has(l.status) || l.status === "unsold"))
      .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at)).slice(0, 6),
    [lots],
  );

  if (lots.length === 0) {
    return (
      <div className="an-card an-stack" style={{ maxWidth: 560 }}>
        <h2 className="an-h">No lots yet</h2>
        <p className="an-soft">Paste your lot list first, then register bidder numbers as people arrive.</p>
        <button type="button" className="an-btn an-btn-primary" onClick={() => goTo("lots")}>Add lots</button>
      </div>
    );
  }

  return (
    <div className="an-stack">
      <Rail lots={lots} currentId={current?.id} onPick={pick} busy={busy} />
      <div className="an-grid an-grid-2">
        <div className="an-card an-lotcard an-stack">
          {!current && (
            <>
              <h2 className="an-h">Ready when you are</h2>
              <p className="an-soft">{lots.filter((l) => OPEN.has(l.status)).length} lots to sell, {data.bidders.length} bidders registered.</p>
              {nextLot && (
                <button ref={nextRef} type="button" className="an-btn an-btn-primary an-btn-xl" onClick={() => pick(nextLot)} disabled={busy}>
                  <Gavel size={26} weight="bold" aria-hidden="true" /> Start with lot {nextLot.lot_number}
                </button>
              )}
            </>
          )}
          {current && (
            <>
              <div className="an-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="an-lotnum" aria-label={`Lot ${current.lot_number}`}>#{current.lot_number}</div>
                <span className={`an-chip ${lotChip(current).cls}`}>{lotChip(current).text}</span>
              </div>
              <div>
                <h2 className="an-lottitle">{current.title}</h2>
                <div className="an-facts">
                  {current.consignor_name && <span>From <b>{current.consignor_name}</b></span>}
                  <span>Opens <b>{centsToDollars(current.starting_bid_cents)}</b></span>
                  {onlineBid && <span>Online bid <b>{centsToDollars(onlineBid)}</b></span>}
                  {current.reserve_cents && <span>Reserve <b>{centsToDollars(current.reserve_cents)}</b></span>}
                  <span>Club keeps <b>{current.club_split_percent || 0}%</b></span>
                </div>
              </div>

              {open ? (
                <form className="an-stack" onSubmit={sell}>
                  <div className="an-clerk-inputs">
                    <label className="an-field"><span className="an-label">Paddle #</span>
                      <input ref={paddleRef} className="an-input an-input-big" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                        value={paddle} onChange={(e) => setPaddle(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-describedby="an-whois" />
                    </label>
                    <label className="an-field"><span className="an-label">Price $</span>
                      <input className="an-input an-input-big" inputMode="decimal" autoComplete="off"
                        value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))} />
                    </label>
                  </div>
                  <div id="an-whois" className={`an-whois ${bidder ? "an-whois-ok" : number ? "an-whois-bad" : "an-muted"}`} aria-live="polite">
                    {bidder ? `#${number} · ${bidder.name}` : number ? `No bidder #${number} yet` : "Type the paddle number"}
                    {cents != null && onlineBid && !beatsOnline && <div className="an-whois-bad">Must beat the online bid of {centsToDollars(onlineBid)}</div>}
                    {cents != null && beatsOnline && !meetsReserve && <div className="an-whois-bad">Below the reserve of {centsToDollars(current.reserve_cents)}</div>}
                  </div>
                  {number && !bidder && (
                    <div className="an-row">
                      <input className="an-input" style={{ flex: 1, minWidth: 160 }} placeholder={`Name for #${number}`} value={walkIn} maxLength={80}
                        onChange={(e) => setWalkIn(e.target.value)} aria-label={`Name for bidder ${number}`} />
                      <button type="button" className="an-btn" onClick={addWalkIn} disabled={busy || !walkIn.trim()}>Register #{number}</button>
                    </div>
                  )}
                  <div className="an-clerk-actions">
                    <button type="submit" className="an-btn an-btn-gold an-btn-xl" disabled={!canSell}>
                      <Gavel size={28} weight="bold" aria-hidden="true" /> Sold
                    </button>
                    <button type="button" className="an-btn an-btn-xl" onClick={pass} disabled={busy}>Pass</button>
                  </div>
                  {onlineBid && (
                    <button type="button" className="an-btn" onClick={sellOnline} disabled={busy}>
                      No room bids: sell to the online bidder for {centsToDollars(onlineBid)}
                    </button>
                  )}
                </form>
              ) : (
                <div className="an-stack">
                  <Note tone={current.status === "unsold" ? "info" : "ok"}>
                    {current.status === "unsold" && "Passed. Nobody bought this lot."}
                    {current.status === "sold_live" && `Sold to #${data.bidders.find((b) => b.id === current.sold_to_bidder_id)?.bidder_number ?? "?"} for ${centsToDollars(current.hammer_cents)}. They pay at the desk.`}
                    {(current.status === "ended" || current.status === "charging" || current.status === "payment_failed") && `Sold to the online bidder for ${centsToDollars(current.hammer_cents)}. Their saved card is charged automatically.`}
                    {(current.status === "handed_off" || current.status === "paid") && `Paid: ${centsToDollars(current.hammer_cents)}.`}
                  </Note>
                  {nextLot ? (
                    <button ref={nextRef} type="button" className="an-btn an-btn-primary an-btn-xl" onClick={() => pick(nextLot)} disabled={busy}>
                      Next: lot {nextLot.lot_number} <ArrowRight size={24} weight="bold" aria-hidden="true" />
                    </button>
                  ) : (
                    <Note tone="ok">That was the last lot. Send everyone to the desk.</Note>
                  )}
                  {(current.status === "sold_live" && !current.desk_payment_id) || current.status === "unsold" || current.status === "ended" ? (
                    <button type="button" className="an-btn an-btn-ghost" onClick={() => undo(current.id)} disabled={busy}>
                      <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" /> Undo and put it back up
                    </button>
                  ) : null}
                </div>
              )}
              {err && <Note tone="err">{err}</Note>}
            </>
          )}
        </div>

        <div className="an-card an-stack">
          <h2 className="an-h">Just called</h2>
          {recent.length === 0 && <p className="an-soft">Results show up here.</p>}
          {recent.map((l) => {
            const chip = lotChip(l);
            const num = data.bidders.find((b) => b.id === l.sold_to_bidder_id)?.bidder_number;
            const undoable = (l.status === "sold_live" && !l.desk_payment_id) || l.status === "unsold" || l.status === "ended";
            return (
              <div key={l.id} className="an-row" style={{ justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <b>#{l.lot_number}</b> <span className="an-soft">{l.title}</span>
                  <div className="an-small an-muted">{SOLD.has(l.status) ? `${num ? `#${num}` : "Online"} · ${centsToDollars(l.hammer_cents)}` : "Passed"}</div>
                </div>
                <div className="an-row">
                  <span className={`an-chip ${chip.cls}`}>{chip.text}</span>
                  {undoable && (
                    <button type="button" className="an-btn an-btn-sm an-btn-ghost" onClick={() => undo(l.id)} disabled={busy} aria-label={`Undo lot ${l.lot_number}`}>
                      <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {toast && (
        <div className="an-toast" role="status">
          <span style={{ flex: 1 }}>{toast.text}</span>
          <button type="button" className="an-btn an-btn-sm" onClick={() => undo(toast.lotId)} disabled={busy}>
            <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
