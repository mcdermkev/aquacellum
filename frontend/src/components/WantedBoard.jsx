import React, { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured, getCurrentWallet } from "../services/supabaseClient";

/**
 * WantedBoard — "Looking For" section in the marketplace.
 * 
 * Users post species they want to buy. Creates engagement even when inventory
 * is low (common in early beta with small user base) and surfaces demand signals
 * to sellers.
 * 
 * Props:
 *   casualModeActive — display mode toggle
 *   walletAccount — connected wallet address
 */
export function WantedBoard({ casualModeActive = false, walletAccount }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [speciesName, setSpeciesName] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [notes, setNotes] = useState("");

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
      }
    } catch (_e) {
      // Graceful fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!speciesName.trim() || !walletAccount) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("wanted_listings")
        .insert({
          wallet_address: walletAccount.toLowerCase(),
          species_name: speciesName.trim(),
          max_price_eth: maxPrice.trim() || null,
          notes: notes.trim() || null,
        });

      if (!error) {
        setSpeciesName("");
        setMaxPrice("");
        setNotes("");
        setShowForm(false);
        await fetchListings();
      }
    } catch (_e) {
      // Handle silently
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

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading wanted listings...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#fff" }}>
            {casualModeActive ? "Looking For" : "Wanted Specimens"}
          </h3>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {casualModeActive
              ? "Post what you're looking for — sellers in your area will see it."
              : "Demand board. Post acquisition requirements for the local network."}
          </p>
        </div>
        {walletAccount && (
          <button
            onClick={() => setShowForm(!showForm)}
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
          <input
            type="text"
            value={speciesName}
            onChange={(e) => setSpeciesName(e.target.value)}
            placeholder={casualModeActive ? "Species name (e.g. Neon Tetra, Cherry Shrimp)" : "Target species / strain"}
            required
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
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <input
              type="text"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Max budget (optional, e.g. $25)"
              style={{
                flex: "1",
                minWidth: "140px",
                padding: "0.6rem 0.85rem",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "0.8rem",
                outline: "none",
              }}
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={casualModeActive ? "Notes (e.g. breeding pair, juvenile)" : "Requirements / notes"}
              style={{
                flex: "2",
                minWidth: "180px",
                padding: "0.6rem 0.85rem",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "0.8rem",
                outline: "none",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !speciesName.trim()}
            className="btn-primary"
            style={{ alignSelf: "flex-end", fontSize: "0.8rem", padding: "0.5rem 1.25rem" }}
          >
            {submitting ? "Posting..." : "Post"}
          </button>
        </form>
      )}

      {/* Listings */}
      {listings.length === 0 ? (
        <div
          className="glass-card"
          style={{
            padding: "2.5rem",
            textAlign: "center",
            border: "1px dashed rgba(255,255,255,0.1)",
          }}
        >
          <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>🔍</span>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {casualModeActive
              ? "No one is looking for anything yet. Be the first to post what you need!"
              : "No active acquisition requests. Post a want to signal demand."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {listings.map((item) => {
            const isOwn = walletAccount && item.wallet_address === walletAccount.toLowerCase();
            const posterName = item.profiles?.display_name || item.wallet_address.slice(0, 8) + "...";

            return (
              <div
                key={item.id}
                className="glass-card"
                style={{
                  padding: "1rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  border: isOwn
                    ? "1px solid rgba(56, 189, 248, 0.2)"
                    : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: item.profiles?.avatar_url
                    ? `url(${item.profiles.avatar_url}) center/cover`
                    : "linear-gradient(135deg, #667eea, #764ba2)",
                  flexShrink: 0,
                  border: "1.5px solid rgba(255,255,255,0.1)",
                }} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <strong style={{ color: "#fff", fontSize: "0.9rem" }}>
                      {item.species_name}
                    </strong>
                    {item.max_price_eth && (
                      <span style={{
                        fontSize: "0.68rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "12px",
                        background: "rgba(34, 197, 94, 0.1)",
                        border: "1px solid rgba(34, 197, 94, 0.25)",
                        color: "#34d399",
                      }}>
                        Budget: {item.max_price_eth}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    {posterName} · {new Date(item.created_at).toLocaleDateString()}
                    {item.notes && (
                      <span style={{ color: "var(--text-secondary)", marginLeft: "0.5rem" }}>
                        — {item.notes}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {isOwn && (
                  <button
                    onClick={() => handleFulfill(item.id)}
                    title="Mark as found"
                    aria-label="Mark as found"
                    style={{
                      background: "rgba(34, 197, 94, 0.1)",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                      borderRadius: "6px",
                      color: "#34d399",
                      fontSize: "0.72rem",
                      padding: "0.35rem 0.65rem",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ✓ Found
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
