/**
 * AuctionNightDesk — the checkout desk and the end-of-night report.
 *
 * Desk: find a paddle number, see what they won, take cash, or take a card
 * (a Stripe Checkout QR the bidder pays on their own phone, or their saved
 * card). The server works out every total; this page never sends an amount.
 */

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle, CreditCard, DownloadSimple, Money, Printer, QrCode } from "@phosphor-icons/react";
import { deskCancel, deskCard, deskCash } from "../../services/auctionNightApi";
import { cardPaymentIssues } from "../../services/auctionNightPayments";
import { centsToDollars } from "../../services/auctionsApi";
import { Note } from "./AuctionNightUi";

function QrImage({ url }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    // Rendered locally: the checkout link never goes to a third-party QR service.
    QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then((d) => { if (alive) setSrc(d); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [url]);
  return src ? <span className="an-qr"><img src={src} width={280} height={280} alt="Scan to pay on your phone" /></span> : null;
}

export function DeskPanel({ data, refresh }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [qr, setQr] = useState(null); // { bidderId, url, totalCents }

  const owing = useMemo(() => {
    const m = new Map();
    for (const l of data.lots) {
      if (!l.sold_to_bidder_id || l.status !== "sold_live") continue;
      m.set(l.sold_to_bidder_id, (m.get(l.sold_to_bidder_id) || 0) + (l.hammer_cents || 0));
    }
    return m;
  }, [data.lots]);

  const bidders = useMemo(() => [...data.bidders].sort((a, b) => a.bidder_number - b.bidder_number), [data.bidders]);
  const selected = bidders.find((b) => b.id === selectedId) || null;
  const theirLots = selected ? data.lots.filter((l) => l.sold_to_bidder_id === selected.id) : [];
  const owed = selected ? owing.get(selected.id) || 0 : 0;
  const pending = selected ? data.payments.find((p) => p.bidder_id === selected.id && p.status === "pending") : null;
  const lastPaid = selected ? data.payments.find((p) => p.bidder_id === selected.id && p.status === "paid") : null;

  // A QR payment that just settled (seen on the next poll) clears the QR.
  useEffect(() => {
    if (qr && selected && qr.bidderId === selected.id && !pending && owed === 0) {
      setQr(null);
      setMsg({ tone: "ok", text: `Bidder #${selected.bidder_number} paid by card. Hand over their fish.` });
    }
  }, [qr, selected, pending, owed]);

  const pickNumber = (e) => {
    e.preventDefault();
    const b = bidders.find((x) => String(x.bidder_number) === search.trim());
    if (b) { setSelectedId(b.id); setMsg(null); setQr(null); setSearch(""); }
    else setMsg({ tone: "err", text: `No bidder #${search.trim()}.` });
  };

  const run = async (fn, ok) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    await refresh();
    if (!r.success) { setMsg({ tone: "err", text: r.error }); return r; }
    if (ok) setMsg({ tone: "ok", text: ok(r) });
    return r;
  };

  const cash = async () => {
    if (!window.confirm(`Take ${centsToDollars(owed)} cash from #${selected.bidder_number}?`)) return;
    if (pending) {
      const c = await run(() => deskCancel(selected.id));
      if (!c.success) return;
      setQr(null);
    }
    await run(() => deskCash(selected.id), () => `${centsToDollars(owed)} cash from #${selected.bidder_number}. Hand over their fish.`);
  };
  const qrPay = async () => {
    const r = await run(() => deskCard(selected.id, "checkout"));
    if (r.success && r.checkoutUrl) setQr({ bidderId: selected.id, url: r.checkoutUrl, totalCents: r.totalCents });
  };
  const savedCard = async () => {
    await run(() => deskCard(selected.id, "saved"), (r) => `Charged ${centsToDollars(r.totalCents)} to #${selected.bidder_number}'s card. Hand over their fish.`);
  };
  const cancel = async () => {
    const r = await run(() => deskCancel(selected.id), () => "Card payment cancelled.");
    if (r.success) setQr(null);
  };

  const cardFee = data.cardFeePercent;

  return (
    <div className="an-grid an-grid-2">
      <div className="an-card an-stack">
        <form className="an-row" onSubmit={pickNumber}>
          <input className="an-input an-input-big" style={{ flex: 1, minWidth: 140 }} inputMode="numeric" placeholder="Paddle #" aria-label="Paddle number"
            value={search} onChange={(e) => setSearch(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          <button type="submit" className="an-btn an-btn-primary an-btn-xl" disabled={!search}>Open</button>
        </form>

        {!selected && <p className="an-soft">Type a paddle number, or pick someone who still owes.</p>}
        {selected && (
          <div className="an-stack">
            <div className="an-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="an-lotnum" style={{ fontSize: "3rem" }}>#{selected.bidder_number}</div>
                <div className="an-lottitle" style={{ fontSize: "1.3rem" }}>{selected.name}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="an-label">Owes</div>
                <div className="an-total">{centsToDollars(owed)}</div>
              </div>
            </div>
            <table className="an-table">
              <tbody>
                {theirLots.map((l) => (
                  <tr key={l.id}>
                    <td><b>#{l.lot_number}</b></td>
                    <td>{l.title}</td>
                    <td className="num">{centsToDollars(l.hammer_cents)}</td>
                    <td className="num">
                      {l.status === "handed_off"
                        ? <span className="an-chip an-chip-paid">Paid {l.payment_method}</span>
                        : l.desk_payment_id ? <span className="an-chip an-chip-online">Card pending</span> : <span className="an-chip an-chip-sold">Due</span>}
                    </td>
                  </tr>
                ))}
                {theirLots.length === 0 && <tr><td className="an-soft">No wins yet.</td></tr>}
              </tbody>
            </table>

            {owed > 0 && !qr && (
              <div className="an-stack">
                <button type="button" className="an-btn an-btn-gold an-btn-xl" onClick={cash} disabled={busy}>
                  <Money size={26} weight="bold" aria-hidden="true" /> Cash {centsToDollars(owed)}
                </button>
                {data.cardPaymentsReady ? (
                  <div className="an-grid an-grid-halves">
                    <button type="button" className="an-btn an-btn-primary" onClick={qrPay} disabled={busy}>
                      <QrCode size={20} weight="bold" aria-hidden="true" /> Card on their phone
                    </button>
                    <button type="button" className="an-btn" onClick={savedCard} disabled={busy || !selected.hasCard}
                      title={selected.hasCard ? "" : "No saved card for this bidder"}>
                      <CreditCard size={20} weight="bold" aria-hidden="true" /> Saved card
                    </button>
                  </div>
                ) : (
                  <Note tone="info">Cash only tonight: the club&apos;s payout account isn&apos;t set up for cards yet.</Note>
                )}
                {data.cardPaymentsReady && <p className="an-small an-muted">Card adds the processing fee for the bidder. The club&apos;s card rate is {cardFee}%; cash has no fee.</p>}
                {pending && (
                  <Note tone="info">
                    A card payment is open for this bidder.{" "}
                    <button type="button" className="an-btn an-btn-sm" onClick={cancel} disabled={busy}>Cancel it</button>
                  </Note>
                )}
              </div>
            )}

            {qr && qr.bidderId === selected.id && (
              <div className="an-stack" style={{ alignItems: "center", textAlign: "center" }}>
                <QrImage url={qr.url} />
                <div className="an-total">{centsToDollars(qr.totalCents)}</div>
                <p className="an-soft">Scan with the phone camera and pay. This updates by itself when they&apos;re done. The code expires in 30 minutes.</p>
                <div className="an-row" style={{ justifyContent: "center" }}>
                  <a className="an-btn an-btn-sm" href={qr.url} target="_blank" rel="noreferrer">Open the payment page</a>
                  <button type="button" className="an-btn an-btn-sm an-btn-danger" onClick={cancel} disabled={busy}>Cancel</button>
                </div>
              </div>
            )}

            {owed === 0 && theirLots.length > 0 && (
              <Note tone="ok"><CheckCircle size={18} weight="bold" aria-hidden="true" /> All paid{lastPaid ? ` (${lastPaid.method === "cash" ? "cash" : "card"})` : ""}.</Note>
            )}
          </div>
        )}
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </div>

      <div className="an-card an-stack">
        <h2 className="an-h">Still to pay</h2>
        {owing.size === 0 && <p className="an-soft">Everyone&apos;s settled.</p>}
        {bidders.filter((b) => owing.has(b.id)).map((b) => (
          <button key={b.id} type="button" className="an-btn" style={{ justifyContent: "space-between" }} aria-pressed={b.id === selectedId}
            onClick={() => { setSelectedId(b.id); setMsg(null); setQr(null); }}>
            <span><b>#{b.bidder_number}</b> {b.name}</span>
            <span>{centsToDollars(owing.get(b.id))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ReportPanel({ data }) {
  const { rows, totals } = data.report;
  const $ = (c) => centsToDollars(c);
  const issues = cardPaymentIssues(data.payments, data.bidders);

  const download = () => {
    const lines = [["Brought by", "Lots sold", "Sold", "Club keeps", "Card fees", "Owed to them", "Still unpaid"]];
    for (const r of rows) lines.push([r.consignor, r.lots, $(r.soldCents), $(r.clubCents), $(r.feeCents), $(r.owedCents), $(r.unpaidCents)]);
    lines.push(["Total", totals.lotsSold, $(totals.soldCents), $(totals.clubCents), $(totals.feeCents), $(totals.owedCents), $(totals.unpaidCents)]);
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.auction.title.replace(/[^\w-]+/g, "-")}-report.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="an-stack">
      <div className="an-stats">
        <div className="an-stat"><b>{$(totals.soldCents)}</b><span>{totals.lotsSold} lots sold</span></div>
        <div className="an-stat"><b>{$(totals.cashCents)}</b><span>Cash taken</span></div>
        <div className="an-stat"><b>{$(totals.cardCents)}</b><span>Card taken</span></div>
        <div className="an-stat"><b>{$(totals.clubCents)}</b><span>Club keeps</span></div>
        <div className="an-stat"><b>{$(totals.unpaidCents)}</b><span>Not paid yet</span></div>
      </div>
      {issues.length > 0 && (
        <div className="an-stack">
          {issues.map((i) => <Note key={i.id} tone={i.tone}>{i.text}</Note>)}
        </div>
      )}
      <div className="an-card an-stack">
        <div className="an-row" style={{ justifyContent: "space-between" }}>
          <h2 className="an-h" style={{ margin: 0 }}>What the club owes each consignor</h2>
          <div className="an-row an-noprint">
            <button type="button" className="an-btn an-btn-sm" onClick={download}><DownloadSimple size={16} weight="bold" aria-hidden="true" /> CSV</button>
            <button type="button" className="an-btn an-btn-sm" onClick={() => window.print()}><Printer size={16} weight="bold" aria-hidden="true" /> Print</button>
          </div>
        </div>
        <div className="an-scroll">
          <table className="an-table">
            <thead><tr><th>Brought by</th><th className="num">Lots</th><th className="num">Sold</th><th className="num">Club keeps</th><th className="num">Card fees</th><th className="num">Owed</th><th className="num">Unpaid</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.consignor}>
                  <td>{r.consignor}</td><td className="num">{r.lots}</td><td className="num">{$(r.soldCents)}</td><td className="num">{$(r.clubCents)}</td>
                  <td className="num">{$(r.feeCents)}</td><td className="num"><b>{$(r.owedCents)}</b></td><td className="num">{r.unpaidCents ? $(r.unpaidCents) : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="an-soft">Nothing sold yet.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr>
                <td>Total</td><td className="num">{totals.lotsSold}</td><td className="num">{$(totals.soldCents)}</td><td className="num">{$(totals.clubCents)}</td>
                <td className="num">{$(totals.feeCents)}</td><td className="num">{$(totals.owedCents)}</td><td className="num">{$(totals.unpaidCents)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
        <p className="an-small an-muted">
          Card money goes to the club&apos;s payout account; pay consignors from this list. Cash has no fee. The club&apos;s cut is taken after the card fee.
          Online wins are charged to the winner&apos;s saved card and paid out when they collect.
        </p>
      </div>
    </div>
  );
}
