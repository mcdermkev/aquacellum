/**
 * SpeciesInsights.jsx
 * 
 * Micro-content system for species pages.
 * Users can post short tips (280 chars), categorized and upvotable.
 * Displayed on species detail pages in the catalog.
 */

import React, { useState, useEffect } from "react";
import { ProfileCard } from "./ProfileCard";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";

const CATEGORIES = [
  { id: "care_tip", label: "💡 Care Tip", color: "#38bdf8" },
  { id: "warning", label: "⚠️ Warning", color: "#f87171" },
  { id: "breeding_note", label: "🥚 Breeding", color: "#34d399" },
  { id: "compatibility", label: "🤝 Compatibility", color: "#a855f7" },
  { id: "behavior", label: "👁️ Behavior", color: "#fbbf24" },
];

function getCategoryInfo(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}

function timeAgo(dateString) {
  const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateString).toLocaleDateString();
}

/**
 * Single insight card with upvote/downvote.
 */
function InsightCard({ insight, onVote }) {
  const walletAddress = getCurrentWallet();
  const cat = getCategoryInfo(insight.category);
  const netVotes = (insight.upvotes || 0) - (insight.downvotes || 0);

  return (
    <div
      style={{
        padding: "0.75rem",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        display: "flex",
        gap: "0.6rem",
      }}
    >
      {/* Vote column */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem", minWidth: "28px" }}>
        <button
          onClick={() => onVote(insight.id, "up")}
          disabled={!walletAddress}
          style={{
            background: "none",
            border: "none",
            cursor: walletAddress ? "pointer" : "default",
            fontSize: "0.8rem",
            padding: "0.1rem",
            opacity: walletAddress ? 1 : 0.4,
            transition: "transform 0.1s ease",
          }}
          title="Helpful"
          aria-label="Upvote"
        >
          ▲
        </button>
        <span style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          color: netVotes > 0 ? "var(--accent-green)" : netVotes < 0 ? "var(--accent-red)" : "var(--text-muted)",
        }}>
          {netVotes}
        </span>
        <button
          onClick={() => onVote(insight.id, "down")}
          disabled={!walletAddress}
          style={{
            background: "none",
            border: "none",
            cursor: walletAddress ? "pointer" : "default",
            fontSize: "0.8rem",
            padding: "0.1rem",
            opacity: walletAddress ? 1 : 0.4,
          }}
          title="Not helpful"
          aria-label="Downvote"
        >
          ▼
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem", flexWrap: "wrap" }}>
          <span style={{
            padding: "0.1rem 0.4rem",
            borderRadius: "50px",
            background: `${cat.color}15`,
            border: `1px solid ${cat.color}30`,
            fontSize: "0.6rem",
            color: cat.color,
            fontWeight: 600,
          }}>
            {cat.label}
          </span>
          <ProfileCard
            walletAddress={insight.author_wallet}
            displayName={insight.profiles?.display_name}
            avatarUrl={insight.profiles?.avatar_url}
            companionTier={insight.profiles?.companion_tier}
            size="small"
            showTier={false}
          />
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
            {timeAgo(insight.created_at)}
          </span>
        </div>
        <p style={{
          margin: 0,
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          lineHeight: "1.5",
          wordBreak: "break-word",
        }}>
          {insight.body}
        </p>
      </div>
    </div>
  );
}

/**
 * Insight composer (inline form).
 */
function InsightComposer({ specCode, onSubmit }) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("care_tip");
  const [submitting, setSubmitting] = useState(false);
  const walletAddress = getCurrentWallet();

  if (!walletAddress) {
    return (
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem" }}>
        Connect your wallet to share insights
      </p>
    );
  }

  const handleSubmit = async () => {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    await onSubmit({ body: body.trim(), category });
    setBody("");
    setCategory("care_tip");
    setSubmitting(false);
  };

  return (
    <div style={{
      padding: "0.75rem",
      borderRadius: "10px",
      background: "rgba(56, 189, 248, 0.03)",
      border: "1px solid rgba(56, 189, 248, 0.1)",
      display: "flex",
      flexDirection: "column",
      gap: "0.6rem",
    }}>
      {/* Category selector */}
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            style={{
              padding: "0.2rem 0.45rem",
              borderRadius: "50px",
              border: category === cat.id
                ? `1px solid ${cat.color}`
                : "1px solid rgba(255, 255, 255, 0.08)",
              background: category === cat.id ? `${cat.color}15` : "transparent",
              color: category === cat.id ? cat.color : "var(--text-muted)",
              fontSize: "0.6rem",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Text input */}
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end" }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 280))}
          placeholder="Share a quick tip about this species..."
          rows={2}
          style={{
            flex: 1,
            padding: "0.5rem 0.65rem",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.03)",
            color: "#fff",
            fontSize: "0.8rem",
            lineHeight: "1.5",
            fontFamily: "inherit",
            outline: "none",
            resize: "none",
            minHeight: "50px",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.08)"; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && body.trim()) { e.preventDefault(); handleSubmit(); } }}
        />
        <button
          onClick={handleSubmit}
          disabled={!body.trim() || submitting}
          style={{
            padding: "0.45rem 0.7rem",
            borderRadius: "8px",
            border: "none",
            background: body.trim() ? "linear-gradient(135deg, #0ea5e9, #0369a1)" : "rgba(255,255,255,0.05)",
            color: body.trim() ? "#fff" : "var(--text-muted)",
            fontSize: "0.7rem",
            fontWeight: 600,
            cursor: body.trim() ? "pointer" : "default",
          }}
        >
          {submitting ? "..." : "Post"}
        </button>
      </div>
      <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", textAlign: "right" }}>
        {body.length}/280
      </span>
    </div>
  );
}

/**
 * Main Species Insights panel.
 * Shows existing insights + composer for a specific species.
 */
export function SpeciesInsights({ specCode, speciesName, casualModeActive = false }) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch insights for this species
  useEffect(() => {
    if (!specCode || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    supabase
      .from("species_insights")
      .select(`
        *,
        profiles:author_wallet (
          wallet_address,
          display_name,
          avatar_url,
          companion_tier
        )
      `)
      .eq("spec_code", specCode)
      .order("upvotes", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (data) setInsights(data);
        setLoading(false);
      });
  }, [specCode]);

  const handleSubmitInsight = async ({ body, category }) => {
    const walletAddress = getCurrentWallet();
    if (!walletAddress || !isSupabaseConfigured()) return;

    const { data, error } = await supabase
      .from("species_insights")
      .insert({
        author_wallet: walletAddress,
        spec_code: specCode,
        category,
        body,
      })
      .select(`
        *,
        profiles:author_wallet (
          wallet_address,
          display_name,
          avatar_url,
          companion_tier
        )
      `)
      .single();

    if (data) {
      setInsights((prev) => [data, ...prev]);
    }
  };

  const handleVote = async (insightId, direction) => {
    if (!isSupabaseConfigured()) return;

    // Optimistic update
    setInsights((prev) =>
      prev.map((ins) => {
        if (ins.id !== insightId) return ins;
        return {
          ...ins,
          upvotes: direction === "up" ? (ins.upvotes || 0) + 1 : ins.upvotes,
          downvotes: direction === "down" ? (ins.downvotes || 0) + 1 : ins.downvotes,
        };
      })
    );

    // Persist
    const field = direction === "up" ? "upvotes" : "downvotes";
    const insight = insights.find((i) => i.id === insightId);
    if (insight) {
      await supabase
        .from("species_insights")
        .update({ [field]: (insight[field] || 0) + 1 })
        .eq("id", insightId);
    }
  };

  if (!isSupabaseConfigured()) {
    return (
      <div style={{ padding: "1rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Species Insights available once social features are configured.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
          {casualModeActive ? "Community Tips" : "Species Insights"}
        </span>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {insights.length} {insights.length === 1 ? "insight" : "insights"}
        </span>
      </div>

      {/* Composer */}
      <InsightComposer specCode={specCode} onSubmit={handleSubmitInsight} />

      {/* Loading */}
      {loading && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
          Loading insights...
        </p>
      )}

      {/* Insight list */}
      {!loading && insights.length === 0 && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "1rem" }}>
          {casualModeActive
            ? "No tips yet — be the first to share what you know about this species!"
            : "No insights recorded. Submit the first observation."
          }
        </p>
      )}

      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} onVote={handleVote} />
      ))}
    </div>
  );
}
