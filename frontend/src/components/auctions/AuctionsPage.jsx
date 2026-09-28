/**
 * AuctionsPage — public auctions (docs/AUCTIONS_SPEC.md §1).
 *
 *   /app/auctions          browse live (or ended) lots, no sign-in needed
 *   /app/auctions/<lotId>  one lot: photos, pickup, bid history, bid form
 *   /app/auctions/mine     my bids, wins (pay / pickup code) — signed in
 *
 * The server decides everything that matters (minimum bid, anti-sniping, who
 * wins, what's charged). This page shows it and sends bids. Countdowns use the
 * server clock so they agree with the close job.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Clock, MapPin, SpinnerGap, Warning, CheckCircle, CreditCard, ImageSquare } from "@phosphor-icons/react";
import {
  centsToDollars,
  clockOffsetMs,
  dollarsToCents,
  formatTimeLeft,
  getLot,
  listLots,
  lotPath,
  myAuctions,
  payNow,
  placeBid,
  startAddCard,
} from "../../services/auctionsApi";
import { announce } from "../../utils/a11y";

const TAP = "44px";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function LotPhoto({ src, alt, height = 180 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div aria-hidden="true" style={{ height, borderRadius: "12px", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        <ImageSquare size={36} weight="duotone" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: "100%", height, objectFit: "cover", borderRadius: "12px", display: "block" }}
    />
  );
}

function statusLine(lot, msLeft) {
  if (lot.status === "live") return { text: formatTimeLeft(msLeft), tone: msLeft < 5 * 60 * 1000 ? "#fbbf24" : "#7dd3fc" };
  if (lot.status === "upcoming") return { text: "Starts soon", tone: "var(--text-secondary)" };
  if (lot.status === "sold") return { text: `Sold for ${centsToDollars(lot.soldForCents)}`, tone: "#86efac" };
  if (lot.status === "closed") return { text: "Bidding closed", tone: "var(--text-secondary)" };
  return { text: "Not sold", tone: "var(--text-muted)" };
}

// ─── Header / tabs ─────────────────────────────────────────────────────────

function AuctionTabs({ view, statusFilter, onNavigate, signedIn }) {
  const tab = (label, active, onClick) => (
    <button
      type="button"
      className={active ? "btn-primary" : "btn-secondary"}
      aria-pressed={active}
      onClick={onClick}
      style={{ minHeight: TAP, padding: "0 1rem", fontWeight: 600 }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {tab("Live lots", view === "auctions" && statusFilter === "live", () => onNavigate("/app/auctions"))}
      {tab("Ended", view === "auctions" && statusFilter === "ended", () => onNavigate("/app/auctions?status=ended"))}
      {signedIn && tab("My bids & wins", view === "auctions-mine", () => onNavigate("/app/auctions/mine"))}
    </div>
  );
}

// ─── Browse ────────────────────────────────────────────────────────────────

function LotCard({ lot, offset, now, onOpen }) {
  const msLeft = Date.parse(lot.endsAt) - (now + offset);
  const s = statusLine(lot, msLeft);
  const current = lot.highBidCents ?? lot.startingBidCents;
  return (
    <li style={{ listStyle: "none" }}>
      <a
        href={lotPath(lot.id)}
        onClick={(e) => { e.preventDefault(); onOpen(lot.id); }}
        className="glass-card"
        style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0.9rem", textDecoration: "none", color: "inherit", height: "100%" }}
      >
        <LotPhoto src={lot.photos[0]} alt={lot.title} />
        <span style={{ color: "#fff", fontWeight: 700, fontSize: "1rem", lineHeight: 1.3 }}>{lot.title}</span>
        <span style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline" }}>
          <span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", display: "block" }}>
              {lot.bidCount ? `${lot.bidCount} ${lot.bidCount === 1 ? "bid" : "bids"}` : "Starting bid"}
            </span>
            <strong style={{ color: "#fff", fontSize: "1.15rem" }}>{centsToDollars(current)}</strong>
          </span>
          <span style={{ color: s.tone, fontWeight: 600, fontSize: "0.9rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <Clock size={16} weight="duotone" aria-hidden="true" /> {s.text}
          </span>
        </span>
        {lot.pickupLocation && (
          <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <MapPin size={16} weight="duotone" aria-hidden="true" /> Pickup: {lot.pickupLocation}
          </span>
        )}
        {lot.club && <span style={{ color: "#c4b5fd", fontSize: "0.8rem" }}>{lot.club.name}</span>}
      </a>
    </li>
  );
}

function AuctionBrowse({ statusFilter, onNavigate }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("ending");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useQuery({
    queryKey: ["auctions", "list", statusFilter, sort, debouncedQ],
    queryFn: async () => {
      const r = await listLots({ status: statusFilter, sort, q: debouncedQ, limit: 60 });
      if (!r.success) throw new Error(r.error || "Could not load auctions.");
      return r;
    },
    refetchInterval: statusFilter === "live" ? 15_000 : false,
    staleTime: 5_000,
  });
  const now = useNow(1000);
  const offset = useMemo(() => clockOffsetMs(query.data?.serverTime), [query.data?.serverTime]);
  const lots = query.data?.lots || [];

  return (
    <section aria-labelledby="auctions-browse-title" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 id="auctions-browse-title" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {statusFilter === "live" ? "Live lots" : "Ended lots"}
      </h2>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "0.25rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
          Search lots
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Medaka, plants, a breeder…"
            style={{ minHeight: TAP, padding: "0 0.75rem", borderRadius: "10px", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: "1rem" }}
          />
        </label>
        {statusFilter === "live" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              style={{ minHeight: TAP, padding: "0 0.6rem", borderRadius: "10px", border: "1px solid var(--glass-border)", background: "rgba(15,23,42,0.9)", color: "#fff", fontSize: "1rem" }}
            >
              <option value="ending">Ending soon</option>
              <option value="new">Newly listed</option>
              <option value="nobids">No bids yet</option>
            </select>
          </label>
        )}
      </div>

      {query.isLoading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading lots…</p>
      ) : query.isError ? (
        <p role="alert" style={{ color: "#fca5a5" }}>{query.error.message}</p>
      ) : lots.length === 0 ? (
        <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
          <Gavel size={36} weight="duotone" color="#7dd3fc" aria-hidden="true" />
          <p style={{ color: "var(--text-secondary)", margin: "0.5rem 0 0 0" }}>
            {statusFilter === "live" ? "No live lots right now. Check back soon." : "No ended lots yet."}
          </p>
        </div>
      ) : (
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem", padding: 0, margin: 0 }}>
          {lots.map((lot) => (
            <LotCard key={lot.id} lot={lot} offset={offset} now={now} onOpen={(id) => onNavigate(lotPath(id))} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Lot detail + bidding ──────────────────────────────────────────────────

function BidPanel({ lot, viewer, signedIn, onRequireSignIn, onBid }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [addingCard, setAddingCard] = useState(false);
  const minDollars = (lot.minNextBidCents / 100).toFixed(2);

  useEffect(() => { setAmount(minDollars); }, [minDollars]);

  const disclosure = (
    <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0, lineHeight: 1.5 }}>
      If you win, your card is charged your bid plus a card processing fee (about 3%).
      {lot.pickupLocation ? ` Pickup at ${lot.pickupLocation}.` : ""} The seller is paid only after you pick up.
    </p>
  );

  if (!signedIn) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {disclosure}
        <button type="button" className="btn-primary" onClick={onRequireSignIn} style={{ minHeight: "52px", fontWeight: 700 }}>
          Sign in to bid
        </button>
      </div>
    );
  }
  if (viewer?.isSeller) {
    return <p style={{ color: "var(--text-secondary)", margin: 0 }}>This is your lot. Manage it in Breeder Terminal → Auctions.</p>;
  }
  if (viewer && !viewer.hasCard) {
    const addCard = async () => {
      setAddingCard(true);
      setError(null);
      const r = await startAddCard(lotPath(lot.id));
      if (r.success && r.checkoutUrl) { window.location.href = r.checkoutUrl; return; }
      if (r.success && r.alreadySaved) { await queryClient.invalidateQueries({ queryKey: ["auctions", "lot", lot.id] }); setAddingCard(false); return; }
      setError(r.error || "Couldn't open the card page.");
      setAddingCard(false);
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <p style={{ color: "#fff", fontWeight: 600, margin: 0 }}>Add a card to bid.</p>
        {disclosure}
        <button type="button" className="btn-primary" onClick={addCard} disabled={addingCard} style={{ minHeight: "52px", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
          {addingCard ? <SpinnerGap size={20} className="spin" /> : <CreditCard size={20} weight="duotone" />} Add a card
        </button>
        {error && <p role="alert" style={{ color: "#fca5a5", margin: 0 }}>{error}</p>}
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    const cents = dollarsToCents(amount);
    if (cents == null) { setError("Enter a dollar amount, like 12 or 12.50."); return; }
    if (cents < lot.minNextBidCents) { setError(`The minimum bid is ${centsToDollars(lot.minNextBidCents)}.`); return; }
    setBusy(true);
    setError(null);
    const r = await placeBid(lot.id, cents);
    setBusy(false);
    if (!r.success) {
      setError(r.error || "Your bid didn't go through.");
      await queryClient.invalidateQueries({ queryKey: ["auctions", "lot", lot.id] });
      return;
    }
    announce(`Bid placed: ${centsToDollars(cents)}. You have the high bid.${r.extended ? " Bidding was extended by 2 minutes." : ""}`);
    onBid?.();
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }} noValidate>
      {viewer?.isHighBidder && (
        <p role="status" style={{ color: "#86efac", fontWeight: 700, margin: 0, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <CheckCircle size={20} weight="fill" /> You have the high bid.
        </p>
      )}
      <label htmlFor="bid-amount" style={{ color: "#fff", fontWeight: 600 }}>
        Your bid (minimum {centsToDollars(lot.minNextBidCents)})
      </label>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <span aria-hidden="true" style={{ color: "var(--text-secondary)", alignSelf: "center", fontSize: "1.2rem" }}>$</span>
        <input
          id="bid-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy || viewer?.isHighBidder}
          aria-describedby="bid-disclosure"
          style={{ flex: 1, minHeight: "52px", padding: "0 0.75rem", borderRadius: "10px", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: "1.2rem" }}
        />
        <button type="submit" className="btn-primary" disabled={busy || viewer?.isHighBidder} style={{ minHeight: "52px", padding: "0 1.25rem", fontWeight: 700 }}>
          {busy ? <SpinnerGap size={20} className="spin" /> : "Place bid"}
        </button>
      </div>
      <div id="bid-disclosure">{disclosure}</div>
      {error && <p role="alert" style={{ color: "#fca5a5", margin: 0, display: "inline-flex", gap: "0.4rem", alignItems: "center" }}><Warning size={18} /> {error}</p>}
    </form>
  );
}

function AuctionLotDetail({ lotId, signedIn, onRequireSignIn, onNavigate }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["auctions", "lot", lotId, signedIn],
    queryFn: async () => {
      const r = await getLot(lotId);
      if (!r.success) throw Object.assign(new Error(r.error || "Could not load the lot."), { status: r.status });
      return r;
    },
    refetchInterval: (q) => (q.state.data?.lot?.status === "live" ? 4_000 : false),
    staleTime: 2_000,
  });
  const now = useNow(1000);
  const offset = useMemo(() => clockOffsetMs(query.data?.serverTime), [query.data?.serverTime]);
  const [cardNotice] = useState(() => new URLSearchParams(window.location.search).get("card_saved"));

  if (query.isLoading) return <p style={{ color: "var(--text-muted)" }}>Loading the lot…</p>;
  if (query.isError) {
    return (
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
        <p role="alert" style={{ color: "#fca5a5" }}>{query.error.status === 404 ? "That lot doesn't exist or was withdrawn." : query.error.message}</p>
        <button type="button" className="btn-secondary" onClick={() => onNavigate("/app/auctions")} style={{ minHeight: TAP }}>Back to auctions</button>
      </div>
    );
  }

  const { lot, bids, viewer } = query.data;
  const msLeft = Date.parse(lot.endsAt) - (now + offset);
  const s = statusLine(lot, msLeft);
  const live = lot.status === "live" && msLeft > 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["auctions", "lot", lotId] });

  return (
    <article aria-labelledby="lot-title" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <LotPhoto src={lot.photos[0]} alt={lot.title} height={320} />
        {lot.photos.length > 1 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem" }}>
            {lot.photos.slice(1, 5).map((p, i) => <LotPhoto key={p} src={p} alt={`${lot.title}, photo ${i + 2}`} height={80} />)}
          </div>
        )}
        {lot.description && <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>{lot.description}</p>}
      </div>

      <div className="glass-card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div>
          <h2 id="lot-title" style={{ color: "#fff", fontSize: "1.4rem", margin: 0 }}>{lot.title}</h2>
          <p style={{ color: "var(--text-muted)", margin: "0.3rem 0 0 0", fontSize: "0.9rem" }}>
            {lot.club ? `${lot.club.name} · ` : ""}Sold by {lot.seller.name || "a breeder"}
            {lot.source === "batch_listing" && lot.quantity > 1 ? ` · ${lot.quantity} fish` : ""}
          </p>
        </div>

        {cardNotice === "1" && <p role="status" style={{ color: "#86efac", margin: 0 }}>Card saved. You can bid now.</p>}
        {cardNotice === "0" && <p role="status" style={{ color: "var(--text-secondary)", margin: 0 }}>No card was saved.</p>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "block" }}>
              {lot.bidCount ? `Current bid · ${lot.bidCount} ${lot.bidCount === 1 ? "bid" : "bids"}` : "Starting bid"}
            </span>
            <strong style={{ color: "#fff", fontSize: "2rem" }}>{centsToDollars(lot.highBidCents ?? lot.startingBidCents)}</strong>
            {lot.hasReserve && (
              <span style={{ display: "block", color: lot.reserveMet ? "#86efac" : "#fbbf24", fontSize: "0.85rem" }}>
                {lot.reserveMet ? "Reserve met" : "Reserve not met yet"}
              </span>
            )}
          </div>
          <div aria-live="off">
            <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "block" }}>{live ? "Time left" : "Status"}</span>
            <strong style={{ color: s.tone, fontSize: "1.4rem" }}>{s.text}</strong>
            {live && <span style={{ display: "block", color: "var(--text-muted)", fontSize: "0.8rem" }}>A late bid adds 2 minutes.</span>}
          </div>
        </div>

        {lot.pickupLocation && (
          <p style={{ color: "var(--text-secondary)", margin: 0, display: "inline-flex", alignItems: "flex-start", gap: "0.35rem" }}>
            <MapPin size={18} weight="duotone" aria-hidden="true" /> <span>Pickup: {lot.pickupLocation}{lot.pickupNotes ? ` — ${lot.pickupNotes}` : ""}</span>
          </p>
        )}

        {live ? (
          <BidPanel lot={lot} viewer={viewer} signedIn={signedIn} onRequireSignIn={onRequireSignIn} onBid={refresh} />
        ) : viewer?.isWinner ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <p style={{ color: "#86efac", fontWeight: 700, margin: 0 }}>You won this lot.</p>
            <button type="button" className="btn-primary" onClick={() => onNavigate("/app/auctions/mine")} style={{ minHeight: TAP }}>
              See payment and pickup
            </button>
          </div>
        ) : null}

        {bids.length > 0 && (
          <div>
            <h3 style={{ color: "#fff", fontSize: "1rem", margin: "0 0 0.4rem 0" }}>Bid history</h3>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.3rem", maxHeight: "240px", overflowY: "auto" }}>
              {bids.map((b, i) => (
                <li key={`${b.at}-${i}`} style={{ display: "flex", justifyContent: "space-between", color: i === 0 ? "#fff" : "var(--text-secondary)", fontSize: "0.9rem" }}>
                  <span>{b.bidder}</span>
                  <span>{centsToDollars(b.amountCents)}</span>
                  <time dateTime={b.at} style={{ color: "var(--text-muted)" }}>
                    {new Date(b.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── My bids & wins ────────────────────────────────────────────────────────

function wonState(item) {
  switch (item.status) {
    case "paid": return { text: "Paid. Show your pickup code when you collect.", tone: "#86efac" };
    case "handed_off": return { text: "Picked up. Enjoy your fish.", tone: "#86efac" };
    case "payment_failed": return { text: item.lastChargeError || "Your card was declined.", tone: "#fca5a5" };
    case "ended":
    case "charging": return { text: "Charging your card…", tone: "#7dd3fc" };
    case "forfeited": return { text: "Not paid in time. The lot went back to the seller.", tone: "var(--text-muted)" };
    case "refunded": return { text: "Refunded.", tone: "var(--text-muted)" };
    default: return { text: item.status, tone: "var(--text-secondary)" };
  }
}

function MyAuctions({ onNavigate }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const query = useQuery({
    queryKey: ["auctions", "mine"],
    queryFn: async () => {
      const r = await myAuctions();
      if (!r.success) throw new Error(r.error || "Could not load your auctions.");
      return r;
    },
    refetchInterval: 20_000,
  });

  const pay = async (lotId) => {
    setBusyId(lotId);
    setMessage(null);
    const r = await payNow(lotId);
    setBusyId(null);
    setMessage(r.success ? { ok: true, text: `Paid ${centsToDollars(r.amountCents)}. Check your email for the pickup code.` } : { ok: false, text: r.error || "The payment didn't go through." });
    queryClient.invalidateQueries({ queryKey: ["auctions", "mine"] });
  };
  const updateCard = async () => {
    const r = await startAddCard("/app/auctions/mine");
    if (r.success && r.checkoutUrl) window.location.href = r.checkoutUrl;
    else setMessage({ ok: false, text: r.error || "Couldn't open the card page." });
  };

  if (query.isLoading) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  if (query.isError) return <p role="alert" style={{ color: "#fca5a5" }}>{query.error.message}</p>;

  const { bidding = [], selling = [] } = query.data;
  const live = bidding.filter((b) => b.status === "live");
  const won = bidding.filter((b) => b.won);
  const lost = bidding.filter((b) => b.status !== "live" && !b.won);

  const row = (item, children) => (
    <li key={item.id} className="glass-card" style={{ listStyle: "none", padding: "0.9rem", display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 64, flexShrink: 0 }}><LotPhoto src={item.photo} alt="" height={64} /></div>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <a href={lotPath(item.id)} onClick={(e) => { e.preventDefault(); onNavigate(lotPath(item.id)); }} style={{ color: "#fff", fontWeight: 700 }}>{item.title}</a>
        {children}
      </div>
    </li>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {message && <p role={message.ok ? "status" : "alert"} style={{ color: message.ok ? "#86efac" : "#fca5a5", margin: 0 }}>{message.text}</p>}

      <section aria-labelledby="mine-won">
        <h2 id="mine-won" style={{ color: "#fff", fontSize: "1.1rem" }}>Won</h2>
        {won.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Nothing won yet.</p> : (
          <ul style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: 0, margin: 0 }}>
            {won.map((item) => {
              const st = wonState(item);
              return row(item, (
                <>
                  <p style={{ color: st.tone, margin: "0.25rem 0" }}>{st.text}</p>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {item.orderUrl && (item.status === "paid") && (
                      <a className="btn-primary" href={item.orderUrl} style={{ minHeight: TAP, display: "inline-flex", alignItems: "center", padding: "0 1rem", textDecoration: "none" }}>
                        Pickup code
                      </a>
                    )}
                    {item.status === "payment_failed" && (
                      <>
                        <button type="button" className="btn-primary" onClick={() => pay(item.id)} disabled={busyId === item.id} style={{ minHeight: TAP }}>
                          {busyId === item.id ? "Paying…" : `Pay now (${centsToDollars(item.amountDueCents)} + fee)`}
                        </button>
                        <button type="button" className="btn-secondary" onClick={updateCard} style={{ minHeight: TAP }}>Update card</button>
                      </>
                    )}
                  </div>
                  {item.status === "payment_failed" && item.paymentDeadline && (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.3rem 0 0 0" }}>
                      Pay by {new Date(item.paymentDeadline).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} or the lot goes back to the seller.
                    </p>
                  )}
                </>
              ));
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="mine-live">
        <h2 id="mine-live" style={{ color: "#fff", fontSize: "1.1rem" }}>Bidding now</h2>
        {live.length === 0 ? <p style={{ color: "var(--text-muted)" }}>No live bids.</p> : (
          <ul style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: 0, margin: 0 }}>
            {live.map((item) => row(item, (
              <p style={{ color: item.winning ? "#86efac" : "#fbbf24", margin: "0.25rem 0 0 0" }}>
                {item.winning ? `You're winning at ${centsToDollars(item.highBidCents)}` : `Outbid. High bid ${centsToDollars(item.highBidCents)} (yours ${centsToDollars(item.myTopBidCents)})`}
              </p>
            )))}
          </ul>
        )}
      </section>

      {lost.length > 0 && (
        <section aria-labelledby="mine-lost">
          <h2 id="mine-lost" style={{ color: "#fff", fontSize: "1.1rem" }}>Ended</h2>
          <ul style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: 0, margin: 0 }}>
            {lost.map((item) => row(item, <p style={{ color: "var(--text-muted)", margin: "0.25rem 0 0 0" }}>You didn&apos;t win this one.</p>))}
          </ul>
        </section>
      )}

      {selling.length > 0 && (
        <p style={{ color: "var(--text-secondary)" }}>
          You&apos;re selling {selling.length} {selling.length === 1 ? "lot" : "lots"}. Manage them in Breeder Terminal → Auctions.
        </p>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function AuctionsPage({ view = "auctions", lotId = null, signedIn = false, onNavigate, onRequireSignIn }) {
  const statusFilter = new URLSearchParams(window.location.search).get("status") === "ended" ? "ended" : "live";
  const go = (path) => onNavigate?.(path);

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", justifyContent: "space-between" }}>
        <h1 style={{ color: "#fff", fontSize: "1.6rem", margin: 0, display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <Gavel size={28} weight="duotone" color="#7dd3fc" aria-hidden="true" /> Auctions
        </h1>
        <AuctionTabs view={view} statusFilter={statusFilter} onNavigate={go} signedIn={signedIn} />
      </header>

      {view === "auction-lot" && lotId ? (
        <>
          <button type="button" className="btn-secondary" onClick={() => go("/app/auctions")} style={{ alignSelf: "flex-start", minHeight: TAP }}>
            ← All lots
          </button>
          <AuctionLotDetail lotId={lotId} signedIn={signedIn} onRequireSignIn={onRequireSignIn} onNavigate={go} />
        </>
      ) : view === "auctions-mine" ? (
        <MyAuctions onNavigate={go} />
      ) : (
        <AuctionBrowse statusFilter={statusFilter} onNavigate={go} />
      )}
    </div>
  );
}
