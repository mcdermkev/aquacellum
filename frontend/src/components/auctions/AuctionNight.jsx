/**
 * AuctionNight — club auction night, full screen (docs/AUCTIONS_SPEC.md §9).
 *
 *   /app/auction-night              my clubs and auctions; start a club or an auction
 *   /app/auction-night/<id>         organizer console: Clerk, Lots, Bidders, Desk, Report
 *   /app/auction-night/<id>/room    public room screen (projector / phones)
 *
 * Rendered outside the app shell (App.jsx) so it fills a laptop or a phone.
 * The server decides everything that matters: who's an organizer, what a bidder
 * owes, what the card fee is. This page shows it and sends the clerk's calls.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowSquareOut, CashRegister, ChartBar, Gavel, ListNumbers, MonitorPlay, Plus, SignIn, SpinnerGap, UsersThree,
} from "@phosphor-icons/react";
import { Note } from "./AuctionNightUi";
import { useAuth } from "../../contexts/AuthContext";
import {
  createClub, createClubAuction, getNightConsole, getNightHome, nightConsolePath, nightHomePath, nightRoomPath,
} from "../../services/auctionNightApi";
import { MAX_BUYER_PREMIUM_PERCENT } from "../../services/auctionNightPayments";
import { AuctionNightRoom } from "./AuctionNightRoom";
import { ClerkPanel } from "./AuctionNightClerk";
import { BiddersPanel, LotsPanel } from "./AuctionNightSetup";
import { DeskPanel, ReportPanel } from "./AuctionNightDesk";
import "./auctionNight.css";

function Brand({ title, sub }) {
  return (
    <div className="an-brand">
      <span className="an-brand-mark"><Gavel size={22} weight="bold" aria-hidden="true" /></span>
      <div>
        <h1 className="an-title">{title}</h1>
        {sub && <div className="an-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Loading({ label = "Loading…" }) {
  return (
    <div className="an-row an-soft" style={{ padding: "2rem 0", justifyContent: "center" }} role="status">
      <SpinnerGap size={22} className="spin" aria-hidden="true" /> {label}
    </div>
  );
}

function SignInGate({ onSignIn, ready }) {
  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top"><Brand title="Auction night" sub="Run your club's auction from a laptop or phone." /></div>
      <div className="an-card an-stack" style={{ maxWidth: 520 }}>
        <h2 className="an-h">Sign in to run an auction</h2>
        <p className="an-soft">Only club organizers can open the console. The room screen doesn&apos;t need a sign-in.</p>
        <button type="button" className="an-btn an-btn-primary" onClick={onSignIn} disabled={!ready}>
          <SignIn size={20} weight="bold" aria-hidden="true" /> Sign in
        </button>
      </div>
    </div></div>
  );
}

// ─── Home: my clubs and auctions ───────────────────────────────────────────

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NewAuctionForm({ clubs, onCreated }) {
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  nextWeek.setHours(19, 0, 0, 0);
  const [f, setF] = useState({
    clubId: clubs[0]?.id || "", title: "", format: "live", eventAt: toLocalInput(nextWeek), onlineEndsAt: "",
    pickupLocation: "", defaultSplitPercent: "20", buyerPremiumPercent: "0", processingPaidBy: "bidder",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await createClubAuction({
      clubId: f.clubId, title: f.title, format: f.format,
      eventAt: new Date(f.eventAt).toISOString(),
      onlineEndsAt: f.format === "hybrid" && f.onlineEndsAt ? new Date(f.onlineEndsAt).toISOString() : null,
      pickupLocation: f.pickupLocation, defaultSplitPercent: Number(f.defaultSplitPercent) || 0,
      buyerPremiumPercent: Number(f.buyerPremiumPercent) || 0,
      clubPaysProcessing: f.processingPaidBy === "club",
    });
    setBusy(false);
    if (!r.success) return setErr(r.error);
    onCreated(r.auctionId);
  };

  return (
    <form className="an-card an-stack" onSubmit={submit}>
      <h2 className="an-h"><Plus size={18} weight="bold" aria-hidden="true" /> New auction</h2>
      {clubs.length > 1 && (
        <label className="an-field"><span className="an-label">Club</span>
          <select className="an-select" value={f.clubId} onChange={set("clubId")}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label className="an-field"><span className="an-label">Name</span>
        <input className="an-input" required maxLength={120} value={f.title} onChange={set("title")} placeholder="October auction night" />
      </label>
      <div className="an-grid an-grid-halves">
        <label className="an-field"><span className="an-label">Date and time</span>
          <input className="an-input" type="datetime-local" required value={f.eventAt} onChange={set("eventAt")} />
        </label>
        <label className="an-field"><span className="an-label">Format</span>
          <select className="an-select" value={f.format} onChange={set("format")}>
            <option value="live">In the room</option>
            <option value="hybrid">Online first, finish in the room</option>
          </select>
        </label>
      </div>
      {f.format === "hybrid" && (
        <label className="an-field"><span className="an-label">Online bidding ends</span>
          <input className="an-input" type="datetime-local" required value={f.onlineEndsAt} onChange={set("onlineEndsAt")} />
          <span className="an-small an-muted">At least an hour from now, and before the meeting starts.</span>
        </label>
      )}
      <div className="an-grid an-grid-halves">
        <label className="an-field"><span className="an-label">Where</span>
          <input className="an-input" maxLength={200} value={f.pickupLocation} onChange={set("pickupLocation")} placeholder="Club meeting hall" />
        </label>
        <label className="an-field"><span className="an-label">Club keeps (default %)</span>
          <input className="an-input" type="number" min="0" max="100" inputMode="numeric" value={f.defaultSplitPercent} onChange={set("defaultSplitPercent")} />
        </label>
      </div>
      <div className="an-grid an-grid-halves">
        <label className="an-field"><span className="an-label">Buyer&apos;s premium (%)</span>
          <input className="an-input" type="number" min="0" max={MAX_BUYER_PREMIUM_PERCENT} inputMode="numeric" value={f.buyerPremiumPercent} onChange={set("buyerPremiumPercent")} />
          <span className="an-small an-muted">Added to every winning bid. The club keeps all of it.</span>
        </label>
        <label className="an-field"><span className="an-label">Card processing is paid by</span>
          <select className="an-select" value={f.processingPaidBy} onChange={set("processingPaidBy")}>
            <option value="bidder">The bidder (added to card payments)</option>
            <option value="club">The club (taken from the payout)</option>
          </select>
          <span className="an-small an-muted">About 3% of each card payment. Cash has none.</span>
        </label>
      </div>
      <p className="an-small an-muted">These can&apos;t be changed after the auction is created, so bidders always know the terms.</p>
      {err && <Note tone="err">{err}</Note>}
      <button type="submit" className="an-btn an-btn-primary" disabled={busy || !f.clubId || !f.title.trim()}>
        {busy ? "Creating…" : "Create auction"}
      </button>
    </form>
  );
}

function NewClubForm({ onCreated, first }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await createClub(name);
    setBusy(false);
    if (!r.success) return setErr(r.error);
    setName("");
    onCreated();
  };
  return (
    <form className="an-card an-stack" onSubmit={submit}>
      <h2 className="an-h"><UsersThree size={18} weight="bold" aria-hidden="true" /> {first ? "Start with your club" : "Add a club"}</h2>
      {first && <p className="an-soft">You&apos;ll be its organizer. Add other organizers later as club elders.</p>}
      <label className="an-field"><span className="an-label">Club name</span>
        <input className="an-input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Garden State Aquarium Society" />
      </label>
      {err && <Note tone="err">{err}</Note>}
      <button type="submit" className="an-btn an-btn-primary" disabled={busy || name.trim().length < 2}>{busy ? "Creating…" : "Create club"}</button>
    </form>
  );
}

function NightHome({ onNavigate, enabled }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auction-night-home"], queryFn: getNightHome, enabled });
  const refresh = () => qc.invalidateQueries({ queryKey: ["auction-night-home"] });
  const data = q.data?.success ? q.data : null;

  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top">
        <Brand title="Auction night" sub="Lots, bidder numbers, the clerk, and the checkout desk in one place." />
        <span className="an-spacer" />
        <a className="an-btn an-btn-ghost an-btn-sm" href="/app/auctions">Back to Aquacellum</a>
      </div>
      {(!enabled || q.isLoading) && <Loading />}
      {q.data && !q.data.success && <Note tone="err">{q.data.error}</Note>}
      {data && (
        <div className="an-grid an-grid-2">
          <div className="an-stack">
            <div className="an-card">
              <h2 className="an-h">Your auctions</h2>
              {data.auctions.length === 0 && <p className="an-soft">No auctions yet. Create one to start adding lots.</p>}
              <div className="an-stack">
                {data.auctions.map((a) => {
                  const club = data.clubs.find((c) => c.id === a.clubId);
                  return (
                    <button key={a.id} type="button" className="an-btn" style={{ justifyContent: "space-between", minHeight: 64, textAlign: "left" }} onClick={() => onNavigate(nightConsolePath(a.id))}>
                      <span>
                        <span style={{ display: "block" }}>{a.title}</span>
                        <span className="an-small an-soft">{club?.name} · {a.eventAt ? new Date(a.eventAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
                      </span>
                      <span className={`an-chip ${a.status === "live" ? "an-chip-up" : ""}`}>{a.status === "live" ? (a.format === "hybrid" ? "Hybrid" : "Live") : a.status}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {data.clubs.length > 0 && <NewAuctionForm clubs={data.clubs} onCreated={(id) => { refresh(); onNavigate(nightConsolePath(id)); }} />}
          </div>
          <div className="an-stack">
            {data.clubs.length > 0 && (
              <div className="an-card">
                <h2 className="an-h">Your clubs</h2>
                <ul className="an-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {data.clubs.map((c) => <li key={c.id}>{c.name}</li>)}
                </ul>
              </div>
            )}
            <NewClubForm first={data.clubs.length === 0} onCreated={refresh} />
            <Note tone="info">
              {data.payoutsReady
                ? "Card payments at the desk go to your payout account. Cash is always fine."
                : "Cash only for now. To take cards at the desk, set up payouts in Breeder Tools → Store first."}
            </Note>
          </div>
        </div>
      )}
    </div></div>
  );
}

// ─── Console ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "clerk", label: "Clerk", Icon: Gavel },
  { id: "lots", label: "Lots", Icon: ListNumbers },
  { id: "bidders", label: "Bidders", Icon: UsersThree },
  { id: "desk", label: "Desk", Icon: CashRegister },
  { id: "report", label: "Report", Icon: ChartBar },
];

function NightConsole({ auctionId, onNavigate, enabled }) {
  const qc = useQueryClient();
  const key = ["auction-night", auctionId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => getNightConsole(auctionId),
    enabled,
    // Several devices work one night (clerk laptop, desk phone); keep them in step.
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });
  const data = q.data?.success ? q.data : null;
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && window.location.hash.replace("#", "")) || "clerk");
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const choose = (id) => {
    setTab(id);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${id}`);
  };

  const counts = data ? {
    lots: data.lots.length,
    bidders: data.bidders.length,
    desk: new Set(data.lots.filter((l) => l.status === "sold_live" && !l.desk_payment_id).map((l) => l.sold_to_bidder_id)).size,
  } : {};

  return (
    <div className="an"><div className="an-wrap">
      <div className="an-top an-noprint">
        <button type="button" className="an-btn an-btn-ghost an-btn-sm" onClick={() => onNavigate(nightHomePath())} aria-label="All auctions">
          <ArrowLeft size={18} weight="bold" aria-hidden="true" />
        </button>
        <Brand title={data?.auction.title || "Auction night"} sub={data ? `${data.club?.name || ""} · ${new Date(data.auction.eventAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""} />
        <span className="an-spacer" />
        <a className="an-btn an-btn-sm" href={nightRoomPath(auctionId)} target="_blank" rel="noreferrer">
          <MonitorPlay size={18} weight="bold" aria-hidden="true" /> Room screen <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
      </div>

      {(!enabled || q.isLoading) && <Loading />}
      {q.data && !q.data.success && <Note tone="err">{q.data.error}</Note>}
      {data && (
        <>
          <div className="an-tabs an-noprint" role="tablist" aria-label="Auction night">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} type="button" role="tab" id={`an-tab-${id}`} aria-controls={`an-panel-${id}`} aria-selected={tab === id} className="an-tab" onClick={() => choose(id)}>
                <Icon size={18} weight="bold" aria-hidden="true" /> {label}
                {counts[id] ? <span className="an-tab-count">{counts[id]}</span> : null}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`an-panel-${tab}`} aria-labelledby={`an-tab-${tab}`}>
            {tab === "clerk" && <ClerkPanel data={data} refresh={refresh} goTo={choose} />}
            {tab === "lots" && <LotsPanel data={data} refresh={refresh} />}
            {tab === "bidders" && <BiddersPanel data={data} refresh={refresh} />}
            {tab === "desk" && <DeskPanel data={data} refresh={refresh} />}
            {tab === "report" && <ReportPanel data={data} />}
          </div>
        </>
      )}
    </div></div>
  );
}

// ─── Entry ─────────────────────────────────────────────────────────────────

export function AuctionNight({ view, auctionId = null, paidNumber = null, onNavigate }) {
  const { account, authenticated, ready, connectPrivy, sessionBridgeReady } = useAuth();
  if (view === "auction-night-room") return <AuctionNightRoom auctionId={auctionId} paidNumber={paidNumber} />;
  if (!account || !authenticated) return <SignInGate onSignIn={connectPrivy} ready={ready} />;
  if (view === "auction-night-console") return <NightConsole auctionId={auctionId} onNavigate={onNavigate} enabled={!!sessionBridgeReady} />;
  return <NightHome onNavigate={onNavigate} enabled={!!sessionBridgeReady} />;
}

export default AuctionNight;
