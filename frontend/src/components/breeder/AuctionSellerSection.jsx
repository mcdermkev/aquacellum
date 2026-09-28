/**
 * AuctionSellerSection — Breeder Terminal → Auctions (docs/AUCTIONS_SPEC.md §2).
 *
 * List a lot (fish from a batch listing, or a freeform lot for plants, gear,
 * anything not in inventory) and manage your lots. The server validates
 * everything again, requires finished payouts, and moves the fish out of the
 * listing's stock while the lot runs (they come back if it doesn't sell).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, SpinnerGap, Warning, CheckCircle } from "@phosphor-icons/react";
import { supabase } from "../../services/supabaseClient";
import { normalizeBoothLines } from "../../services/boothInventory";
import { cancelLot, centsToDollars, createLot, dollarsToCents, lotPath, myAuctions } from "../../services/auctionsApi";
import { toLocalInputValue } from "./BoothEvents";
import { announce } from "../../utils/a11y";

const TAP = "44px";
const inputStyle = {
  minHeight: TAP, width: "100%", padding: "0 0.75rem", borderRadius: "10px",
  border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: "1rem",
};

/** Default end: 3 days out at 8 pm local. */
export function defaultLotEnd(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 3);
  d.setHours(20, 0, 0, 0);
  return d;
}

const SELLING_STATUS = {
  live: "Live",
  pending_approval: "Waiting for approval",
  ended: "Ended, charging the winner",
  charging: "Charging the winner",
  payment_failed: "Winner's card declined (they have 24h to fix it)",
  paid: "Paid, waiting for pickup",
  handed_off: "Picked up, paid out",
  unsold: "Didn't sell (stock returned)",
  forfeited: "Winner didn't pay (stock returned)",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export function AuctionSellerSection({ walletAccount, sellerStatus, onStartOnboarding, onboardingBusy }) {
  const queryClient = useQueryClient();
  const payoutsReady = !!sellerStatus?.onboardingComplete;

  const listingsQuery = useQuery({
    queryKey: ["auctionSeller", "listings", walletAccount ? String(walletAccount).toLowerCase() : null],
    enabled: !!walletAccount,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aquadex_listings")
        .select("id, common_name, price, is_batch, is_active, quantity_total, quantity_remaining, data")
        .eq("seller_address", String(walletAccount).toLowerCase())
        .eq("is_batch", true)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return normalizeBoothLines(data || []).filter((l) => (l.quantityRemaining ?? 0) > 0);
    },
  });
  const mineQuery = useQuery({
    queryKey: ["auctions", "mine"],
    enabled: !!walletAccount,
    queryFn: async () => {
      const r = await myAuctions();
      if (!r.success) throw new Error(r.error || "Could not load your lots.");
      return r;
    },
    refetchInterval: 30_000,
  });

  const [form, setForm] = useState(() => ({
    source: "batch_listing",
    listingId: "",
    quantity: "1",
    title: "",
    description: "",
    photo: "",
    startingBid: "",
    reserve: "",
    endsAt: toLocalInputValue(defaultLotEnd()),
    pickupLocation: "",
    pickupNotes: "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const listings = useMemo(() => listingsQuery.data || [], [listingsQuery.data]);
  const chosen = listings.find((l) => l.id === form.listingId) || null;

  // Picking a listing fills in the title and photo (both still editable).
  useEffect(() => {
    if (!chosen) return;
    setForm((f) => ({
      ...f,
      title: f.title || chosen.commonName,
      photo: f.photo || chosen.photoUrl || "",
      quantity: String(Math.min(Number(f.quantity) || 1, chosen.quantityRemaining || 1)),
    }));
  }, [chosen]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setCreated(null);
    const startingBidCents = dollarsToCents(form.startingBid);
    if (startingBidCents == null || startingBidCents < 100) { setError("Starting bid must be at least $1."); return; }
    const reserveCents = form.reserve.trim() ? dollarsToCents(form.reserve) : null;
    if (form.reserve.trim() && reserveCents == null) { setError("Enter the reserve as a dollar amount, or leave it blank."); return; }
    const ends = new Date(form.endsAt);
    if (Number.isNaN(ends.getTime())) { setError("Pick when bidding ends."); return; }

    setBusy(true);
    const r = await createLot({
      source: form.source,
      listingId: form.source === "batch_listing" ? form.listingId : null,
      quantity: form.source === "batch_listing" ? Number(form.quantity) || 1 : 1,
      title: form.title,
      description: form.description,
      photos: form.photo.trim() ? [form.photo.trim()] : [],
      startingBidCents,
      reserveCents,
      endsAt: ends.toISOString(),
      pickupLocation: form.pickupLocation,
      pickupNotes: form.pickupNotes,
    });
    setBusy(false);
    if (!r.success) { setError(r.error || "Couldn't list the lot."); return; }
    setCreated(r.lotId);
    announce("Lot listed.");
    setForm((f) => ({ ...f, title: "", description: "", photo: "", startingBid: "", reserve: "", listingId: "", quantity: "1" }));
    queryClient.invalidateQueries({ queryKey: ["auctions"] });
    queryClient.invalidateQueries({ queryKey: ["auctionSeller"] });
  };

  const cancel = async (lotId) => {
    if (cancelling !== lotId) { setCancelling(lotId); return; }
    setCancelling(null);
    const r = await cancelLot(lotId);
    if (!r.success) setError(r.error || "Couldn't cancel the lot.");
    queryClient.invalidateQueries({ queryKey: ["auctions"] });
    queryClient.invalidateQueries({ queryKey: ["auctionSeller"] });
  };

  const selling = mineQuery.data?.selling || [];
  const label = (text, node, hint) => (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", color: "#fff", fontSize: "0.95rem" }}>
      {text}
      {node}
      {hint && <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{hint}</span>}
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="glass-card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <h3 style={{ color: "#fff", margin: 0, display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <Gavel size={22} weight="duotone" color="#7dd3fc" aria-hidden="true" /> New auction lot
        </h3>
        <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: "0.95rem", lineHeight: 1.5 }}>
          Anyone can see your lot at aquacellum.com/auctions. The winner is charged automatically when bidding ends,
          and you&apos;re paid when they pick up.
        </p>

        {!payoutsReady ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <p style={{ color: "#fbbf24", margin: 0 }}>Set up payouts first. Winners are charged automatically, so the money needs somewhere to go.</p>
            <button type="button" className="btn-primary" onClick={onStartOnboarding} disabled={onboardingBusy} style={{ minHeight: TAP, alignSelf: "flex-start" }}>
              {onboardingBusy ? "Opening Stripe…" : "Set up payouts"}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.9rem" }} noValidate>
            <fieldset style={{ gridColumn: "1 / -1", border: "none", padding: 0, margin: 0, display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <legend style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "0.4rem" }}>What are you auctioning?</legend>
              {[["batch_listing", "Fish from a listing"], ["freeform", "Something else (plants, gear…)"]].map(([value, text]) => (
                <label key={value} className={form.source === value ? "btn-primary" : "btn-secondary"} style={{ minHeight: TAP, display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0 0.9rem", cursor: "pointer" }}>
                  <input type="radio" name="lot-source" value={value} checked={form.source === value} onChange={set("source")} />
                  {text}
                </label>
              ))}
            </fieldset>

            {form.source === "batch_listing" && (
              <>
                {label("Listing", (
                  <select value={form.listingId} onChange={set("listingId")} required style={{ ...inputStyle, background: "rgba(15,23,42,0.9)" }}>
                    <option value="">Choose a listing…</option>
                    {listings.map((l) => <option key={l.id} value={l.id}>{l.commonName} ({l.quantityRemaining} in stock)</option>)}
                  </select>
                ), listingsQuery.isSuccess && listings.length === 0 ? "No batch listings with stock." : "These fish come out of stock while the lot runs.")}
                {label("How many fish", (
                  <input type="number" min={1} max={chosen?.quantityRemaining || 1000} value={form.quantity} onChange={set("quantity")} style={inputStyle} />
                ))}
              </>
            )}

            {label("Title", <input value={form.title} onChange={set("title")} maxLength={120} required style={inputStyle} />)}
            {label("Photo link (optional)", <input value={form.photo} onChange={set("photo")} placeholder="https://…" style={inputStyle} />, "Filled in from the listing when it has one.")}
            <div style={{ gridColumn: "1 / -1" }}>
              {label("Description (optional)", (
                <textarea value={form.description} onChange={set("description")} maxLength={4000} rows={3} style={{ ...inputStyle, padding: "0.6rem 0.75rem", minHeight: "88px" }} />
              ))}
            </div>
            {label("Starting bid ($)", <input inputMode="decimal" value={form.startingBid} onChange={set("startingBid")} placeholder="10" required style={inputStyle} />)}
            {label("Reserve ($, optional)", <input inputMode="decimal" value={form.reserve} onChange={set("reserve")} placeholder="Leave blank for none" style={inputStyle} />, "The lowest price you'll accept. Bidders only see whether it's met.")}
            {label("Bidding ends", <input type="datetime-local" value={form.endsAt} onChange={set("endsAt")} required style={inputStyle} />, "Between 1 hour and 14 days from now.")}
            {label("Pickup location", <input value={form.pickupLocation} onChange={set("pickupLocation")} maxLength={200} required placeholder="City, or the club meeting" style={inputStyle} />)}
            <div style={{ gridColumn: "1 / -1" }}>
              {label("Pickup notes (optional)", <input value={form.pickupNotes} onChange={set("pickupNotes")} maxLength={1000} placeholder="e.g. Saturday 10am–2pm, bring a bucket" style={inputStyle} />)}
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button type="submit" className="btn-primary" disabled={busy} style={{ minHeight: "52px", padding: "0 1.5rem", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                {busy ? <SpinnerGap size={20} className="spin" /> : null} List lot
              </button>
              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>4% fee on the winning bid (2% in event mode). The winner pays the card fee.</span>
            </div>
          </form>
        )}

        {error && <p role="alert" style={{ color: "#fca5a5", margin: 0, display: "inline-flex", gap: "0.4rem", alignItems: "center" }}><Warning size={18} /> {error}</p>}
        {created && (
          <p role="status" style={{ color: "#86efac", margin: 0, display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <CheckCircle size={18} weight="fill" /> Listed. <a href={lotPath(created)} style={{ color: "#7dd3fc" }}>View the lot</a>
          </p>
        )}
      </div>

      <div className="glass-card" style={{ padding: "1.25rem" }}>
        <h3 style={{ color: "#fff", margin: "0 0 0.75rem 0" }}>Your lots</h3>
        {mineQuery.isLoading ? <p style={{ color: "var(--text-muted)" }}>Loading…</p> : selling.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>No lots yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {selling.map((l) => (
              <li key={l.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--glass-border)", paddingBottom: "0.6rem" }}>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <a href={lotPath(l.id)} style={{ color: "#fff", fontWeight: 700 }}>{l.title}</a>
                  <p style={{ color: "var(--text-secondary)", margin: "0.2rem 0 0 0", fontSize: "0.9rem" }}>
                    {SELLING_STATUS[l.status] || l.status}
                    {" · "}
                    {l.hammerCents ? `Sold for ${centsToDollars(l.hammerCents)}` : l.highBidCents ? `High bid ${centsToDollars(l.highBidCents)} (${l.bidCount} bids)` : `Starts at ${centsToDollars(l.startingBidCents)}`}
                    {l.reserveCents ? ` · reserve ${centsToDollars(l.reserveCents)}` : ""}
                  </p>
                </div>
                {l.status === "live" && l.bidCount === 0 && (
                  <button type="button" className="btn-secondary" onClick={() => cancel(l.id)} style={{ minHeight: TAP, color: cancelling === l.id ? "#fca5a5" : undefined }}>
                    {cancelling === l.id ? "Tap again to cancel" : "Cancel"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.75rem 0 0 0" }}>
          When a winner picks up, confirm it in Orders → Confirm a pickup, the same as a booth card sale.
        </p>
      </div>
    </div>
  );
}
