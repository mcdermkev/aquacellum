/**
 * SwapSheet.jsx
 * 
 * Pre-event "I'm bringing..." board for Expo Tides.
 * - Attendees list species they plan to bring
 * - Other attendees can flag interest on species
 * - Becomes read-only once Tide goes live
 */

import { useMemo } from "react";
import { useSwapSheet, useUpdateBringing, useMyRsvp } from "../../hooks/useTides";
import { useSpeciesSearch } from "../../hooks/useSpeciesSearch";

function SpeciesSearchInput({ onSelect, excludeList = [] }) {
  const { results, setSearchTerm, searchTerm } = useSpeciesSearch();

  const filteredResults = useMemo(
    () => (results || []).filter((s) => !excludeList.includes(s.specCode)),
    [results, excludeList]
  );

  return (
    <div className="swap-sheet__search">
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search species to add…"
        className="swap-sheet__search-input"
        aria-label="Search species"
      />
      {searchTerm.length >= 2 && filteredResults.length > 0 && (
        <ul className="swap-sheet__search-results" role="listbox">
          {filteredResults.slice(0, 6).map((species) => (
            <li
              key={species.specCode}
              role="option"
              className="swap-sheet__search-item"
              onClick={() => {
                onSelect(species);
                setSearchTerm("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSelect(species);
                  setSearchTerm("");
                }
              }}
              tabIndex={0}
            >
              <strong>{species.commonName}</strong>
              <span className="text-muted"> — {species.scientificName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SwapSheet({ tideId, isLive = false }) {
  const { data: swapData = [], isLoading } = useSwapSheet(tideId);
  const { data: myRsvp } = useMyRsvp(tideId);
  const updateBringing = useUpdateBringing(tideId);

  // Flatten all species from swap sheet for the combined view
  const allSpecies = useMemo(() => {
    const speciesMap = new Map();

    swapData.forEach((attendee) => {
      (attendee.bringing_species || []).forEach((species) => {
        const key = species.specCode || species.commonName;
        if (!speciesMap.has(key)) {
          speciesMap.set(key, {
            ...species,
            bringers: [],
          });
        }
        speciesMap.get(key).bringers.push({
          wallet: attendee.wallet_address,
          name: attendee.profile?.display_name,
        });
      });
    });

    return Array.from(speciesMap.values()).sort((a, b) => b.bringers.length - a.bringers.length);
  }, [swapData]);

  // My bringing list (from swap data or RSVP)
  const myBringing = useMemo(() => {
    const myEntry = swapData.find(
      (s) => s.wallet_address === myRsvp?.wallet_address
    );
    return myEntry?.bringing_species || [];
  }, [swapData, myRsvp]);

  const handleAddSpecies = (species) => {
    const updated = [
      ...myBringing,
      {
        specCode: species.specCode,
        commonName: species.commonName,
        scientificName: species.scientificName,
      },
    ];
    updateBringing.mutate(updated);
  };

  const handleRemoveSpecies = (specCode) => {
    const updated = myBringing.filter((s) => s.specCode !== specCode);
    updateBringing.mutate(updated);
  };

  return (
    <section className="swap-sheet" aria-label="Swap Sheet — I'm Bringing">
      <header className="swap-sheet__header">
        <h3>🐟 Swap Sheet</h3>
        <p className="text-muted">
          {isLive
            ? "The tide is live — swap sheet is now read-only."
            : "Tell others what species you're bringing to trade or show."}
        </p>
      </header>

      {/* My Bringing Section (editable pre-event) */}
      {!isLive && myRsvp && (
        <div className="swap-sheet__my-bringing">
          <h4>I'm Bringing:</h4>
          {myBringing.length === 0 ? (
            <p className="text-muted">Nothing listed yet. Add species below!</p>
          ) : (
            <ul className="swap-sheet__my-list">
              {myBringing.map((species) => (
                <li key={species.specCode} className="swap-sheet__my-item">
                  <span>
                    {species.commonName}
                    {species.scientificName && (
                      <em className="text-muted"> ({species.scientificName})</em>
                    )}
                  </span>
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={() => handleRemoveSpecies(species.specCode)}
                    aria-label={`Remove ${species.commonName}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SpeciesSearchInput
            onSelect={handleAddSpecies}
            excludeList={myBringing.map((s) => s.specCode)}
          />
        </div>
      )}

      {/* All Species Board */}
      <div className="swap-sheet__board">
        <h4>What's Being Brought ({allSpecies.length} species)</h4>
        {isLoading ? (
          <p className="text-muted">Loading swap sheet…</p>
        ) : allSpecies.length === 0 ? (
          <p className="text-muted">No one has listed species yet. Be the first!</p>
        ) : (
          <div className="swap-sheet__grid">
            {allSpecies.map((species) => (
              <div
                key={species.specCode || species.commonName}
                className="swap-sheet__species-card"
              >
                <div className="swap-sheet__species-name">
                  <strong>{species.commonName}</strong>
                  {species.scientificName && (
                    <span className="text-muted text-sm"> {species.scientificName}</span>
                  )}
                </div>
                <div className="swap-sheet__bringers">
                  {species.bringers.map((b, i) => (
                    <span key={i} className="swap-sheet__bringer-chip">
                      {b.name || b.wallet?.slice(0, 6)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default SwapSheet;
