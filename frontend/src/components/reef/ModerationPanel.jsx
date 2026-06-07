/**
 * ModerationPanel.jsx
 * 
 * Admin moderation panel for curators (Hadal-tier users).
 * Shows flagged content queue with actions: dismiss, hide, warn, mute, ban.
 * Includes escalation history and Poseidon-generated case summaries.
 */

import { useState, useEffect } from "react";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import { ProfileCard } from "./ProfileCard";

const ACTION_LABELS = {
  dismiss: { label: "Dismiss", icon: "✓", color: "#10b981" },
  hide: { label: "Hide Content", icon: "🙈", color: "#f59e0b" },
  warn: { label: "Warn User", icon: "⚠️", color: "#f59e0b" },
  mute_24h: { label: "Mute 24h", icon: "🔇", color: "#ef4444" },
  mute_7d: { label: "Mute 7 days", icon: "🔇", color: "#ef4444" },
  ban: { label: "Ban", icon: "🚫", color: "#dc2626" },
};

function FlaggedItemCard({ item, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(null);

  const handleAction = async (action) => {
    setActionInProgress(action);
    await onAction(item.id, action, item);
    setActionInProgress(null);
  };

  return (
    <article
      className="mod-panel__item"
      style={{
        padding: "1rem",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.02)",
        border: `1px solid ${item.severity === "high" ? "rgba(248, 113, 113, 0.2)" : "rgba(255, 255, 255, 0.06)"}`,
        marginBottom: "0.75rem",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div>
          <span style={{
            fontSize: "0.6rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "0.15rem 0.5rem",
            borderRadius: "4px",
            background: item.severity === "high"
              ? "rgba(248, 113, 113, 0.15)"
              : item.severity === "medium"
                ? "rgba(251, 191, 36, 0.15)"
                : "rgba(255, 255, 255, 0.05)",
            color: item.severity === "high"
              ? "var(--accent-red)"
              : item.severity === "medium"
                ? "var(--accent-amber)"
                : "var(--text-muted)",
          }}>
            {item.flag_reason || "Flagged"}
          </span>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", color: "var(--text-muted)" }}>
            {new Date(item.created_at).toLocaleDateString()}
          </span>
        </div>
        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
          #{item.id?.slice(0, 8)}
        </span>
      </div>

      {/* Flagged content preview */}
      <div style={{
        padding: "0.75rem",
        borderRadius: "8px",
        background: "rgba(0, 0, 0, 0.2)",
        marginBottom: "0.75rem",
        fontSize: "0.8rem",
        color: "var(--text-secondary)",
        lineHeight: 1.5,
      }}>
        {item.content_preview || item.content_body || "No preview available"}
      </div>

      {/* Author info */}
      {item.reported_profile && (
        <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>By:</span>
          <ProfileCard profile={item.reported_profile} compact />
          {item.prior_warnings > 0 && (
            <span style={{
              fontSize: "0.6rem",
              padding: "0.1rem 0.4rem",
              borderRadius: "4px",
              background: "rgba(248, 113, 113, 0.1)",
              color: "var(--accent-red)",
            }}>
              {item.prior_warnings} prior warning{item.prior_warnings > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Poseidon summary */}
      {item.ai_summary && (
        <div style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "8px",
          background: "rgba(99, 102, 241, 0.06)",
          border: "1px solid rgba(99, 102, 241, 0.1)",
          marginBottom: "0.75rem",
          fontSize: "0.7rem",
          color: "var(--text-secondary)",
        }}>
          <span style={{ marginRight: "0.3rem" }}>🐙</span>
          {item.ai_summary}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {Object.entries(ACTION_LABELS).map(([key, { label, icon, color }]) => (
          <button
            key={key}
            onClick={() => handleAction(key)}
            disabled={!!actionInProgress}
            style={{
              padding: "0.3rem 0.6rem",
              borderRadius: "6px",
              border: `1px solid ${color}33`,
              background: actionInProgress === key ? `${color}22` : "transparent",
              color: color,
              fontSize: "0.65rem",
              cursor: actionInProgress ? "wait" : "pointer",
              opacity: actionInProgress && actionInProgress !== key ? 0.5 : 1,
              transition: "all 0.15s ease",
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Expand for history */}
      {item.escalation_history?.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: "0.5rem",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "0.65rem",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {expanded ? "▾ Hide history" : "▸ View history"} ({item.escalation_history.length})
        </button>
      )}

      {expanded && item.escalation_history && (
        <div style={{ marginTop: "0.5rem", paddingLeft: "0.75rem", borderLeft: "2px solid rgba(255,255,255,0.06)" }}>
          {item.escalation_history.map((entry, i) => (
            <div key={i} style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
              <span>{new Date(entry.date).toLocaleDateString()}</span>
              {" — "}
              <span style={{ color: "var(--text-secondary)" }}>{entry.action}</span>
              {entry.note && <span> — {entry.note}</span>}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function ModerationPanel({ onBack }) {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending"); // pending | resolved | all
  const [stats, setStats] = useState({ pending: 0, resolved: 0 });

  useEffect(() => {
    loadFlags();
  }, [filter]);

  async function loadFlags() {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    setLoading(true);

    let query = supabase
      .from("moderation_flags")
      .select(`
        *,
        reported_profile:reported_wallet (
          wallet_address, display_name, avatar_url, companion_tier
        )
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (filter === "pending") {
      query = query.eq("status", "pending");
    } else if (filter === "resolved") {
      query = query.neq("status", "pending");
    }

    const { data, error } = await query;

    if (!error) {
      setFlags(data || []);
    }

    // Get counts
    const { count: pendingCount } = await supabase
      .from("moderation_flags")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: resolvedCount } = await supabase
      .from("moderation_flags")
      .select("*", { count: "exact", head: true })
      .neq("status", "pending");

    setStats({ pending: pendingCount || 0, resolved: resolvedCount || 0 });
    setLoading(false);
  }

  async function handleAction(flagId, action, item) {
    if (!isSupabaseConfigured()) return;

    const wallet = getCurrentWallet();

    // Update the flag status
    const { error } = await supabase
      .from("moderation_flags")
      .update({
        status: action === "dismiss" ? "dismissed" : "actioned",
        resolved_by: wallet,
        resolved_at: new Date().toISOString(),
        resolution_action: action,
      })
      .eq("id", flagId);

    if (error) {
      console.error("[Moderation] Action failed:", error);
      return;
    }

    // Apply the action
    if (action === "hide" && item.content_id) {
      await supabase
        .from("currents")
        .update({ visibility: "hidden" })
        .eq("id", item.content_id);
    }

    if ((action === "mute_24h" || action === "mute_7d") && item.reported_wallet) {
      const muteUntil = new Date();
      muteUntil.setHours(muteUntil.getHours() + (action === "mute_24h" ? 24 : 168));

      await supabase
        .from("profiles")
        .update({ muted_until: muteUntil.toISOString() })
        .eq("wallet_address", item.reported_wallet);
    }

    if (action === "ban" && item.reported_wallet) {
      await supabase
        .from("profiles")
        .update({ is_banned: true, banned_at: new Date().toISOString() })
        .eq("wallet_address", item.reported_wallet);
    }

    // Refresh the list
    loadFlags();
  }

  return (
    <section style={{ maxWidth: "800px", margin: "0 auto" }} aria-label="Moderation Panel">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <button
            onClick={onBack}
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer", padding: 0, marginBottom: "0.25rem" }}
          >
            ← Back
          </button>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#fff" }}>🛡️ Moderation Queue</h2>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{
            fontSize: "0.7rem",
            padding: "0.25rem 0.6rem",
            borderRadius: "6px",
            background: stats.pending > 0 ? "rgba(248, 113, 113, 0.1)" : "rgba(52, 211, 153, 0.1)",
            color: stats.pending > 0 ? "var(--accent-red)" : "var(--accent-green)",
            fontWeight: 600,
          }}>
            {stats.pending} pending
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: "flex",
        gap: "0.25rem",
        marginBottom: "1rem",
        padding: "0.25rem",
        borderRadius: "8px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}>
        {[
          { key: "pending", label: `Pending (${stats.pending})` },
          { key: "resolved", label: `Resolved (${stats.resolved})` },
          { key: "all", label: "All" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              flex: 1,
              padding: "0.4rem",
              borderRadius: "6px",
              border: "none",
              background: filter === tab.key ? "rgba(56, 189, 248, 0.12)" : "transparent",
              color: filter === tab.key ? "#fff" : "var(--text-muted)",
              fontSize: "0.7rem",
              fontWeight: filter === tab.key ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
          Loading flagged content...
        </div>
      ) : flags.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "3rem",
          borderRadius: "12px",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
        }}>
          <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>✅</p>
          <p style={{ fontSize: "0.9rem", color: "#fff", fontWeight: 600, margin: 0 }}>
            Queue is clear
          </p>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
            No {filter === "pending" ? "pending" : ""} items to review.
          </p>
        </div>
      ) : (
        <div>
          {flags.map((item) => (
            <FlaggedItemCard key={item.id} item={item} onAction={handleAction} />
          ))}
        </div>
      )}
    </section>
  );
}

export default ModerationPanel;
