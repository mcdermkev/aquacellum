/**
 * AuctionNightRoom — the public room screen for a club auction night
 * (docs/AUCTIONS_SPEC.md §9). Put it on the projector, or open it on a phone.
 * Polls the public auction-room view; shows no names, reserves, or contacts.
 *
 * ?paid=<n> is where a bidder lands after paying at the desk on their phone.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Gavel } from "@phosphor-icons/react";
import { getRoom } from "../../services/auctionNightApi";
import { centsToDollars } from "../../services/auctionsApi";
import "./auctionNight.css";

const POLL_MS = 2000;

function Bubbles() {
  const bubbles = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      size: 8 + ((i * 7) % 18),
      duration: 14 + ((i * 5) % 16),
      delay: -((i * 3) % 20),
    })),
    [],
  );
  return (
    <div className="an-bubbles" aria-hidden="true">
      {bubbles.map((b, i) => (
        <i key={i} style={{ left: b.left, width: b.size, height: b.size, animationDuration: `${b.duration}s`, animationDelay: `${b.delay}s` }} />
      ))}
    </div>
  );
}

export function AuctionNightRoom({ auctionId, paidNumber = null }) {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      const r = await getRoom(auctionId);
      if (!alive) return;
      if (r.success) { setRoom(r.room); setError(null); }
      else if (!r.offline) setError(r.error);
      // Slow down in a background tab; the projector stays at full speed.
      timer = setTimeout(tick, document.hidden ? POLL_MS * 5 : POLL_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [auctionId]);

  if (paidNumber) {
    return (
      <div className="an">
        <div className="an-room">
          <Bubbles />
          <div className="an-room-main">
            <div>
              <CheckCircle size={96} weight="duotone" color="#4ade80" aria-hidden="true" />
              <h1 className="an-room-title" style={{ fontSize: "clamp(2rem, 8vw, 3.5rem)" }}>You&apos;re paid, bidder #{paidNumber}</h1>
              <p className="an-room-price">Show this screen at the desk to collect your fish.</p>
              {room && <p className="an-soft" style={{ marginTop: "1rem" }}>{room.clubName} · {room.title}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const lot = room?.lot;
  const done = room && room.lotsLeft === 0 && (!lot || lot.state !== "selling");

  return (
    <div className="an">
      <main className="an-room">
        <Bubbles />
        <header className="an-room-head">
          <div className="an-brand">
            <span className="an-brand-mark"><Gavel size={22} weight="bold" aria-hidden="true" /></span>
            <div>
              <div className="an-title">{room?.clubName || "Auction night"}</div>
              <div className="an-sub">{room?.title || "Loading…"}</div>
            </div>
          </div>
        </header>

        <section className="an-room-main" aria-live="polite" aria-atomic="true">
          {error && !room && <p className="an-room-price">{error}</p>}
          {!error && !room && <p className="an-room-price">Loading…</p>}
          {room && !lot && !done && (
            <div>
              <div className="an-room-lotnum">Starting soon</div>
              <h1 className="an-room-title">{room.lotCount} lot{room.lotCount === 1 ? "" : "s"} tonight</h1>
              <p className="an-room-price">Grab a bidder number at the desk.</p>
            </div>
          )}
          {done && (
            <div>
              <div className="an-room-lotnum">That&apos;s a wrap</div>
              <h1 className="an-room-title">Thanks for bidding</h1>
              <p className="an-room-price">Settle up at the desk to take your fish home.</p>
            </div>
          )}
          {lot && !done && (
            <div key={lot.id}>
              <div className="an-room-lotnum">Lot {lot.number}</div>
              {lot.photo && <img className="an-room-photo" src={lot.photo} alt="" />}
              <h1 className="an-room-title">{lot.title}</h1>
              {lot.state === "selling" && (
                <p className="an-room-price">
                  {lot.onlineBidCents
                    ? <>Online bid <b>{centsToDollars(lot.onlineBidCents)}</b> · beat it in the room</>
                    : <>Opening at <b>{centsToDollars(lot.startingBidCents)}</b></>}
                </p>
              )}
              {lot.state === "sold" && (
                <div className="an-room-sold">
                  Sold{lot.soldToNumber ? ` to #${lot.soldToNumber}` : " online"} · {centsToDollars(lot.soldForCents)}
                </div>
              )}
              {lot.state === "passed" && <div className="an-room-passed">Passed</div>}
            </div>
          )}
        </section>

        {room && (
          <footer className="an-room-foot">
            <span>{room.lotsLeft} of {room.lotCount} lots left</span>
            {room.buyerPremiumPercent > 0 && <span>+{room.buyerPremiumPercent}% buyer&apos;s premium</span>}
            <span>aquacellum.com</span>
          </footer>
        )}
      </main>
    </div>
  );
}

export default AuctionNightRoom;
