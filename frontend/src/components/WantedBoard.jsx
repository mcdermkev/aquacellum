import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";
import { notifyWantedMatch } from "../services/marketplaceNotifications";
import { getOrCreateConversation, sendMessage } from "../services/messagesApi";
import { useSpeciesSearch } from "../hooks/useSpeciesSearch";
import { LazyImage } from "./LazyImage";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { db } from "../db";

/**
 * WantedBoard — "Looking For" section in the marketplace.
 *
 * Buyers post species they want. Sellers/breeders who have a match can respond
 * directly (opens a DM), matches against the viewer's own inventory are badged,
 * and repeated demand for the same species is aggregated into a "trending" view.
 *
 * Props:
 *   casualModeActive — display mode toggle
 *   walletAccount — connected wallet address
 */

// Normalize a species string for grouping/matching (strip "fry batch", casing, punctuation).
function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/ fry batch$/i, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function timeAgo(dateString) {
  if (!dateString) return "";
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateString).toLocaleDateString();
}

// Format a free-text budget: prefix "$" when it looks like a bare number.
function formatBudget(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return `$${trimmed}`;
  return trimmed;
}

export function WantedBoard({ casualModeActive = false, walletAccount }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Form state — species is now a validated catalog selection, not free text.
  const [selectedSpecies, setSelectedSpecies] = useState(null);
  const [maxPrice, setMaxPrice] = useState("");
  const [notes, setNotes] = useState("");

  // Browse controls
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "demand"
  const [speciesFilter, setSpeciesFilter] = useState(null); // normalized name or null

  // Respond flow: which listing's composer is open + per-listing status
  const [respondingId, setRespondingId] = useState(null);
  const [respondText, setRespondText] = useState("");
  const [respondStatus, setRespondStatus] = useState({}); // id -> idle|sending|sent|error

  // Viewer's own inventory species (for match surfacing)
  const [mySpeciesNames, setMySpeciesNames] = useState(() => new Set());

  // Species catalog (also powers the autocomplete picker)
  const {
    results: speciesResults,
    searchTerm: speciesQuery,
    setSearchTerm: setSpeciesQuery,
    globalData: speciesCatalog,
  } = useSpeciesSearch();

  // Build a lookup from the catalog: normalized name / specCode -> image + type.
  const catalogIndex = useMemo(() => {
    const byName = new Map();
    const byCode = new Map();
    (speciesCatalog || []).forEach((s) => {
      const entry = {
        photo: s.masterPhotoUrl || "",
        specCode: s.specCode ?? s.speciesId,
        isPlant: s.type === "plant" || Number(s.specCode) >= 9000,
      };
      if (s.commonName) byName.set(normalizeName(s.commonName), entry);
      if (s.scientificName) byName.set(normalizeName(s.scientificName), entry);
      if (entry.specCode != null) byCode.set(Number(entry.specCode), entry);
    });
    return { byName, byCode };
  }, [speciesCatalog]);

  const resolveArt = useCallback(
    (item) => {
      if (item.species_id != null && catalogIndex.byCode.has(Number(item.species_id))) {
        return catalogIndex.byCode.get(Number(item.species_id));
      }
      return catalogIndex.byName.get(normalizeName(item.species_name)) || null;
    },
    [catalogIndex]
  );

  const fetchListings = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("wanted_listings")
        .select("*, profiles(display_name, avatar_url)")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setListings(data);
        checkWantedMatches(data).catch(() => {});
      }
    } catch (_e) {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  }, [walletAccount]);

  // Load the viewer's own listings so we can badge matches in the UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!walletAccount) {
        setMySpeciesNames(new Set());
        return;
      }
      try {
        const mine = await db.localListings
          .where("seller")
          .equals(walletAccount.toLowerCase())
          .toArray();
        if (!cancelled) {
          setMySpeciesNames(new Set(mine.map((l) => normalizeName(l.commonName))));
        }
      } catch {
        // Non-critical
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAccount]);

  // Fire local notifications for wants that match the viewer's inventory.
  const checkWantedMatches = async (wantedPosts) => {
    if (!walletAccount) return;
    try {
      const userListings = await db.localListings
        .where("seller")
        .equals(walletAccount.toLowerCase())
        .toArray();
      if (userListings.length === 0) return;

      const userSpeciesNames = new Set(userListings.map((l) => normalizeName(l.commonName)));
      const lastChecked = localStorage.getItem("aquadex_wanted_match_last_check") || "1970-01-01";

      for (const wanted of wantedPosts) {
        if (!wanted.species_name) continue;
        if (wanted.wallet_address?.toLowerCase() === walletAccount.toLowerCase()) continue;
        if (wanted.created_at <= lastChecked) continue;

        const wantedName = normalizeName(wanted.species_name);
        for (const specName of userSpeciesNames) {
          if (!specName) continue;
          if (wantedName.includes(specName) || specName.includes(wantedName)) {
            notifyWantedMatch({
              recipientWallet: walletAccount,
              speciesName: wanted.species_name,
              buyerName: wanted.profiles?.display_name || "A buyer",
              maxBudget: wanted.max_price_eth ? parseFloat(wanted.max_price_eth) * 1000 : null,
              wantedId: wanted.id,
            });
            break;
          }
        }
      }

      localStorage.setItem("aquadex_wanted_match_last_check", new Date().toISOString());
    } catch (_e) {
      // Non-critical
    }
  };

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!walletAccount) {
      setFormError("Connect a wallet to post a want.");
      return;
    }
    if (!selectedSpecies) {
      setFormError("Pick a species from the list so buyers and sellers can match it.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("wanted_listings").insert({
        wallet_address: walletAccount.toLowerCase(),
        species_name: selectedSpecies.commonName || selectedSpecies.scientificName,
        species_id: selectedSpecies.specCode ?? selectedSpecies.speciesId ?? null,
        max_price_eth: maxPrice.trim() || null,
        notes: notes.trim() || null,
      });

      if (error) {
        setFormError("Could not post right now. Try again.");
      } else {
        setSelectedSpecies(null);
        setSpeciesQuery("");
        setMaxPrice("");
        setNotes("");
        setShowForm(false);
        await fetchListings();
      }
    } catch (_e) {
      setFormError("Could not post right now. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFulfill = async (id) => {
    await supabase
      .from("wanted_listings")
      .update({ is_active: false, fulfilled_at: new Date().toISOString() })
      .eq("id", id);
    await fetchListings();
  };

  // Open the inline responder with a sensible prefilled message.
  const openResponder = (item) => {
    setRespondingId(item.id);
    setRespondText(
      `Hi! I saw your Wanted post for ${item.species_name} — I have some available. Happy to work out details.`
    );
  };

  // Send the response: create/reuse a conversation, then send the message.
  const handleRespond = async (item) => {
    if (!respondText.trim()) return;
    setRespondStatus((s) => ({ ...s, [item.id]: "sending" }));
    try {
      const { data: convo, error } = await getOrCreateConversation(item.wallet_address);
      if (error || !convo) {
        setRespondStatus((s) => ({ ...s, [item.id]: "error" }));
        return;
      }
      const { error: msgErr } = await sendMessage(convo.id, respondText.trim());
      if (msgErr) {
        setRespondStatus((s) => ({ ...s, [item.id]: "error" }));
        return;
      }
      setRespondStatus((s) => ({ ...s, [item.id]: "sent" }));
      setRespondingId(null);
      setRespondText("");
    } catch (_e) {
      setRespondStatus((s) => ({ ...s, [item.id]: "error" }));
    }
  };

  // Demand aggregation: how many active wants share each species.
  const demandCounts = useMemo(() => {
    const counts = new Map();
    listings.forEach((l) => {
      const key = normalizeName(l.species_name);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [listings]);

  // Top species by demand (only those wanted by more than one post).
  const trending = useMemo(() => {
    const seen = new Map();
    listings.forEach((l) => {
      const key = normalizeName(l.species_name);
      if (!key) return;
      if (!seen.has(key)) seen.set(key, { key, label: l.species_name, count: demandCounts.get(key) });
    });
    return Array.from(seen.values())
      .filter((s) => s.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [listings, demandCounts]);

  // Final display list: filter -> sort.
  const displayListings = useMemo(() => {
    let rows = listings;
    if (speciesFilter) {
      rows = rows.filter((l) => normalizeName(l.species_name) === speciesFilter);
    }
    if (sortMode === "demand") {
      rows = [...rows].sort((a, b) => {
        const da = demandCounts.get(normalizeName(a.species_name)) || 0;
        const db_ = demandCounts.get(normalizeName(b.species_name)) || 0;
        if (db_ !== da) return db_ - da;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    }
    return rows;
  }, [listings, speciesFilter, sortMode, demandCounts]);

  const inputStyle = {
    width: "100%",
    padding: "0.6rem 0.85rem",
    background: "rgba(0,0,0,0.3)",
    border: "1px solid var(--glass-border)",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "0.85rem",
    outline: "none",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading wanted listings...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#fff" }}>
            {casualModeActive ? "Looking For" : "Wanted Specimens"}
          </h3>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {casualModeActive
              ? "Post what you're after — anyone who has it can message you directly."
              : "Demand board. Post acquisition targets; matching keepers can respond in-thread."}
          </p>
        </div>
        {walletAccount && (
          <button
            onClick={() => {
              setShowForm(!showForm);
              setFormError("");
            }}
            className="btn-primary"
            style={{ fontSize: "0.8rem", padding: "0.5rem 1rem" }}
          >
            {showForm ? "Cancel" : casualModeActive ? "+ I'm Looking For..." : "+ Post Want"}
          </button>
        )}
      </div>

      {/* Post Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="glass-card"
          style={{
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            border: "1px solid rgba(56, 189, 248, 0.15)",
          }}
        >
          <SpeciesPicker
            selected={selectedSpecies}
            onSelect={(s) => {
              setSelectedSpecies(s);
              setFormError("");
            }}
            onClear={() => setSelectedSpecies(null)}
            results={speciesResults}
            searchTerm={speciesQuery}
            setSearchTerm={setSpeciesQuery}
            casualModeActive={casualModeActive}
          />

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <input
              type="text"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Max budget (optional, e.g. $25)"
              style={{ ...inputStyle, flex: "1", minWidth: "140px", fontSize: "0.8rem" }}
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={casualModeActive ? "Notes (e.g. breeding pair, juvenile)" : "Strain / variant / requirements"}
              style={{ ...inputStyle, flex: "2", minWidth: "180px", fontSize: "0.8rem" }}
            />
          </div>

          {formError && (
            <p style={{ margin: 0, fontSize: "0.72rem", color: "#f87171" }}>{formError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedSpecies}
            className="btn-primary"
            style={{ alignSelf: "flex-end", fontSize: "0.8rem", padding: "0.5rem 1.25rem", opacity: !selectedSpecies ? 0.5 : 1 }}
          >
            {submitting ? "Posting..." : "Post"}
          </button>
        </form>
      )}

      {/* Trending / demand strip */}
      {trending.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>
            🔥 Most requested:
          </span>
          {trending.map((t) => {
            const active = speciesFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setSpeciesFilter(active ? null : t.key)}
                style={{
                  fontSize: "0.72rem",
                  padding: "0.25rem 0.6rem",
                  borderRadius: "50px",
                  cursor: "pointer",
                  background: active ? "rgba(56, 189, 248, 0.18)" : "rgba(255,255,255,0.04)",
                  border: active ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid rgba(255,255,255,0.08)",
                  color: active ? "#38bdf8" : "var(--text-secondary)",
                }}
              >
                {t.label} <span style={{ opacity: 0.7 }}>×{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Sort + filter controls */}
      {listings.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            {[
              { id: "recent", label: "Recent" },
              { id: "demand", label: "Most wanted" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSortMode(opt.id)}
                style={{
                  fontSize: "0.72rem",
                  padding: "0.3rem 0.7rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  background: sortMode === opt.id ? "rgba(56, 189, 248, 0.12)" : "transparent",
                  border: sortMode === opt.id ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(255,255,255,0.08)",
                  color: sortMode === opt.id ? "#38bdf8" : "var(--text-muted)",
                  fontWeight: sortMode === opt.id ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {speciesFilter && (
            <button
              onClick={() => setSpeciesFilter(null)}
              style={{ fontSize: "0.68rem", background: "none", border: "none", color: "#38bdf8", cursor: "pointer" }}
            >
              Clear filter ✕
            </button>
          )}
        </div>
      )}

      {/* Listings */}
      {displayListings.length === 0 ? (
        <div
          className="glass-card"
          style={{ padding: "2.5rem", textAlign: "center", border: "1px dashed rgba(255,255,255,0.1)" }}
        >
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>🔍</span>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {speciesFilter
              ? "No active wants for that species."
              : casualModeActive
              ? "No one is looking for anything yet. Be the first to post what you need!"
              : "No active acquisition requests. Post a want to signal demand."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
          {displayListings.map((item) => {
            const isOwn = walletAccount && item.wallet_address === walletAccount.toLowerCase();
            const posterName = item.profiles?.display_name || item.wallet_address.slice(0, 8) + "...";
            const normalized = normalizeName(item.species_name);
            const count = demandCounts.get(normalized) || 1;
            const matchesMe = !isOwn && mySpeciesNames.has(normalized);
            const art = resolveArt(item);
            const budget = formatBudget(item.max_price_eth);
            const status = respondStatus[item.id];
            const isResponding = respondingId === item.id;

            return (
              <div
                key={item.id}
                className="glass-card"
                style={{
                  padding: "0.85rem 1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: isResponding ? "0.7rem" : 0,
                  border: matchesMe
                    ? "1px solid rgba(34, 197, 94, 0.35)"
                    : isOwn
                    ? "1px solid rgba(56, 189, 248, 0.2)"
                    : "1px solid rgba(255,255,255,0.06)",
                  background: matchesMe ? "rgba(34, 197, 94, 0.04)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                  {/* Species thumbnail */}
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "10px",
                      overflow: "hidden",
                      flexShrink: 0,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <LazyImage
                      src={art?.photo || ""}
                      alt={item.species_name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      fallbackSvg={
                        art?.isPlant ? (
                          <PlantSilhouetteSVG specCode={art?.specCode || item.species_id || 9001} style={{ width: "28px", height: "28px" }} />
                        ) : (
                          <FishSilhouetteSVG specimenId={art?.specCode || item.species_id || 0} style={{ width: "32px", height: "32px" }} />
                        )
                      }
                    />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <strong style={{ color: "#fff", fontSize: "0.92rem" }}>{item.species_name}</strong>
                      {budget && (
                        <span style={chipStyle("rgba(34, 197, 94, 0.1)", "rgba(34, 197, 94, 0.25)", "#34d399")}>
                          {budget}
                        </span>
                      )}
                      {count > 1 && (
                        <span style={chipStyle("rgba(251, 146, 60, 0.1)", "rgba(251, 146, 60, 0.25)", "#fb923c")}>
                          {count} looking
                        </span>
                      )}
                      {matchesMe && (
                        <span style={chipStyle("rgba(34, 197, 94, 0.15)", "rgba(34, 197, 94, 0.4)", "#4ade80")}>
                          ✓ You list this
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {posterName} · {timeAgo(item.created_at)}
                      {item.notes && (
                        <span style={{ color: "var(--text-secondary)", marginLeft: "0.5rem" }}>— {item.notes}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                    {isOwn ? (
                      <button
                        onClick={() => handleFulfill(item.id)}
                        title="Mark as found"
                        aria-label="Mark as found"
                        style={actionBtn("rgba(34, 197, 94, 0.1)", "rgba(34, 197, 94, 0.3)", "#34d399")}
                      >
                        ✓ Found
                      </button>
                    ) : walletAccount && status === "sent" ? (
                      <span style={{ fontSize: "0.72rem", color: "#4ade80", whiteSpace: "nowrap" }}>✓ Message sent</span>
                    ) : walletAccount && !isResponding ? (
                      <button
                        onClick={() => openResponder(item)}
                        style={actionBtn(
                          matchesMe ? "rgba(34, 197, 94, 0.15)" : "rgba(56, 189, 248, 0.08)",
                          matchesMe ? "rgba(34, 197, 94, 0.4)" : "rgba(56, 189, 248, 0.25)",
                          matchesMe ? "#4ade80" : "#38bdf8"
                        )}
                      >
                        💬 I have this
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Inline responder */}
                {isResponding && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <textarea
                      value={respondText}
                      onChange={(e) => setRespondText(e.target.value)}
                      rows={2}
                      style={{ ...inputStyle, fontSize: "0.8rem", resize: "vertical", minHeight: "52px" }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", alignItems: "center" }}>
                      {status === "error" && (
                        <span style={{ fontSize: "0.68rem", color: "#f87171", marginRight: "auto" }}>
                          Couldn't send — try again.
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setRespondingId(null);
                          setRespondText("");
                        }}
                        style={actionBtn("transparent", "rgba(255,255,255,0.12)", "var(--text-muted)")}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRespond(item)}
                        disabled={status === "sending" || !respondText.trim()}
                        className="btn-primary"
                        style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem", opacity: status === "sending" ? 0.6 : 1 }}
                      >
                        {status === "sending" ? "Sending..." : "Send message"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Chip style helper
function chipStyle(bg, border, color) {
  return {
    fontSize: "0.66rem",
    padding: "0.12rem 0.5rem",
    borderRadius: "12px",
    background: bg,
    border: `1px solid ${border}`,
    color,
    whiteSpace: "nowrap",
  };
}

// Small action-button style helper
function actionBtn(bg, border, color) {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: "6px",
    color,
    fontSize: "0.72rem",
    padding: "0.4rem 0.7rem",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

/**
 * SpeciesPicker — validated species selection backed by the fishbase catalog.
 * Prevents junk entries (e.g. "Turkey bacon") and captures species_id + artwork.
 */
function SpeciesPicker({ selected, onSelect, onClear, results, searchTerm, setSearchTerm, casualModeActive }) {
  const [focused, setFocused] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (selected) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.55rem 0.85rem",
          background: "rgba(56, 189, 248, 0.08)",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          borderRadius: "8px",
        }}
      >
        <span style={{ fontSize: "0.85rem", color: "#fff" }}>
          <strong>{selected.commonName || selected.scientificName}</strong>
          {selected.scientificName && selected.commonName && (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic", marginLeft: "0.4rem", fontSize: "0.75rem" }}>
              {selected.scientificName}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClear}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
          aria-label="Change species"
        >
          Change ✕
        </button>
      </div>
    );
  }

  const showResults = focused && searchTerm.trim().length >= 2 && (results || []).length > 0;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={casualModeActive ? "Search a species (e.g. Neon Tetra)" : "Search target species / strain"}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "0.6rem 0.85rem",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid var(--glass-border)",
          borderRadius: "8px",
          color: "#fff",
          fontSize: "0.85rem",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {showResults && (
        <ul
          role="listbox"
          style={{
            listStyle: "none",
            margin: "0.3rem 0 0",
            padding: "0.25rem",
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: "240px",
            overflowY: "auto",
            background: "rgba(15, 23, 42, 0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          }}
        >
          {results.slice(0, 8).map((species) => (
            <li
              key={species.specCode ?? species.speciesId ?? species.scientificName}
              role="option"
              tabIndex={0}
              onClick={() => {
                onSelect(species);
                setFocused(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSelect(species);
                  setFocused(false);
                }
              }}
              style={{ padding: "0.5rem 0.6rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(56, 189, 248, 0.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <strong>{species.commonName}</strong>
              {species.scientificName && (
                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}> — {species.scientificName}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
