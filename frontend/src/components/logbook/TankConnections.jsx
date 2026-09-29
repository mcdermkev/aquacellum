import React from "react";
import { isSaltwaterTank, isReefTank } from "../../utils/tankUtils";
import { inhabitantKind, livingInhabitants, speciesCarePath, speciesPhotoFor } from "./inhabitants";
import "./TankConnections.css";

/**
 * TankConnections — "what can I do from this tank?" The tank is where a keeper
 * starts, so it links out to the rest of the product: log care, read each
 * species' care page, find fish that fit, sell from the tank, print its label,
 * and (breeders) publish a buyer page or feature it in the Fish Room.
 *
 * It only wires flows that already exist. Anything a mode or account can't use
 * is left out rather than shown as a dead button.
 *
 * Props:
 *   tank, fishbaseData, casualModeActive, walletAccount
 *   onLogTest(), onLogFeed(), onPrintLabel()
 *   onSellFish()     — show the fish list, where each fish has its Sell button
 *   onSellFrags()    — open the coral frag listing (reef tanks)
 *   onListBatch()    — open the fry batch listing (Pro)
 */
export function TankConnections({
  tank,
  fishbaseData = [],
  casualModeActive = false,
  walletAccount,
  onLogTest,
  onLogFeed,
  onPrintLabel,
  onSellFish,
  onSellFrags,
  onListBatch,
}) {
  if (!tank) return null;
  const casual = casualModeActive;
  const saltwater = isSaltwaterTank(tank);
  const reef = isReefTank(tank);

  // One entry per species, with the catalog photo and the public care page.
  const species = [];
  const seen = new Set();
  for (const s of livingInhabitants(tank)) {
    const path = speciesCarePath(s, fishbaseData);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    species.push({ path, name: s.commonName || s.scientificName, photo: speciesPhotoFor(s, fishbaseData), kind: inhabitantKind(s, fishbaseData) });
  }

  const goTab = (tab, section) => {
    window.dispatchEvent(new CustomEvent("aquadex:navigate-tab", { detail: { tab, section } }));
  };

  return (
    <section className="tconn" aria-labelledby={`tconn-title-${tank.id}`}>
      <h4 className="tconn-title" id={`tconn-title-${tank.id}`}>
        {casual ? "Do more with this tank" : "Tank actions"}
      </h4>

      <div className="tconn-grid">
        <button type="button" className="tconn-action" onClick={onLogTest}>
          <span className="tconn-icon" aria-hidden="true">🧪</span>
          <span className="tconn-text">
            <strong>{casual ? "Log a water test" : "Log water test"}</strong>
            <span>{saltwater ? (casual ? "Salinity, alkalinity and more" : "SG, dKH, Ca, Mg, NO₃, PO₄") : (casual ? "Ammonia, nitrite, nitrate, pH" : "NH₃, NO₂, NO₃, pH, GH/KH")}</span>
          </span>
        </button>
        <button type="button" className="tconn-action" onClick={onLogFeed}>
          <span className="tconn-icon" aria-hidden="true">🥣</span>
          <span className="tconn-text">
            <strong>{casual ? "Log a feeding" : "Log feeding"}</strong>
            <span>{casual ? "One tap, standard feed" : "Standard ration"}</span>
          </span>
        </button>
        <button type="button" className="tconn-action" onClick={() => goTab("gallery")}>
          <span className="tconn-icon" aria-hidden="true">🔍</span>
          <span className="tconn-text">
            <strong>{casual ? "Find fish that fit" : "Check species fit"}</strong>
            <span>
              {casual
                ? (reef ? "Fish, corals and inverts for this tank" : "Pick this tank in Fish Finder")
                : "Open Breed Gallery"}
            </span>
          </span>
        </button>
        <button type="button" className="tconn-action" onClick={onPrintLabel}>
          <span className="tconn-icon" aria-hidden="true">🏷️</span>
          <span className="tconn-text">
            <strong>{casual ? "Print a tank label" : "Print QR label"}</strong>
            <span>{casual ? "Scan it to open this tank in the app" : "PDF tag; scans to this tank in the app"}</span>
          </span>
        </button>
      </div>

      {species.length > 0 && (
        <div className="tconn-block">
          <span className="tconn-label">{casual ? "Care pages for what lives here" : "Species pages"}</span>
          <ul className="tconn-species">
            {species.slice(0, 8).map((s) => (
              <li key={s.path}>
                <a className="tconn-species-link" href={s.path}>
                  {s.photo
                    ? <img src={s.photo} alt="" loading="lazy" />
                    : <span className="tconn-species-icon" aria-hidden="true">{s.kind === "coral" ? "🪸" : s.kind === "invertebrate" ? "🦐" : "🐠"}</span>}
                  <span>{s.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {walletAccount ? (
        <div className="tconn-block">
          <span className="tconn-label">{casual ? "Sell from this tank" : "Sell"}</span>
          <div className="tconn-row">
            {livingInhabitants(tank).some((s) => inhabitantKind(s, fishbaseData) !== "coral") && (
              <button type="button" className="tconn-chip" onClick={onSellFish}>
                {casual ? "Sell a fish" : "List a specimen"}
              </button>
            )}
            {reef && onSellFrags && (
              <button type="button" className="tconn-chip" onClick={onSellFrags}>
                {casual ? "Sell coral frags" : "List coral frags"}
              </button>
            )}
            {!casual && onListBatch && (
              <button type="button" className="tconn-chip" onClick={onListBatch}>List a fry batch</button>
            )}
          </div>
        </div>
      ) : (
        <p className="tconn-note">Sign in to sell fish from this tank.</p>
      )}

      {!casual && walletAccount && (
        <div className="tconn-block">
          <span className="tconn-label">Share with buyers</span>
          <div className="tconn-row">
            <button type="button" className="tconn-chip" onClick={() => goTab("breeder-terminal", "booth")}>
              Public tank page (Booth)
            </button>
            <button type="button" className="tconn-chip" onClick={() => goTab("breeder-terminal", "showcase")}>
              Feature in your Fish Room
            </button>
          </div>
          <p className="tconn-note">
            Booth publishes a /t/ page with this tank's fish and prices for a printed QR sign. Fish Room publishing is invite-only during the beta.
          </p>
        </div>
      )}
    </section>
  );
}

export default TankConnections;
