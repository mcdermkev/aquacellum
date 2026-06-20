import React, { useState } from "react";

const DISMISS_KEY = "aquadex_beta_banner_dismissed";
const SEEN_COUNT_KEY = "aquadex_beta_banner_seen_count";

/**
 * BetaBanner — Persistent but dismissible notice for beta testers.
 * Explains testnet status, data expectations, known limitations,
 * and experimental features.
 *
 * Auto-expands the "Known Limitations" section for the first 3 sessions,
 * then collapses by default to reduce visual noise.
 */
export function BetaBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISS_KEY) === "true";
  });

  const [expanded, setExpanded] = useState(() => {
    const count = parseInt(localStorage.getItem(SEEN_COUNT_KEY) || "0", 10);
    // Auto-expand for the first 3 sessions
    return count < 3;
  });

  // Track session views
  useState(() => {
    const count = parseInt(localStorage.getItem(SEEN_COUNT_KEY) || "0", 10);
    localStorage.setItem(SEEN_COUNT_KEY, String(count + 1));
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <div style={styles.banner} role="status" aria-label="Beta notice">
      <div style={styles.content}>
        <div style={styles.topRow}>
          <div style={styles.badge}>BETA</div>
          <p style={styles.text}>
            You're part of the Aquacellum closed beta — thank you for helping us build this!
            Everything runs on <strong>Base Sepolia testnet</strong> (no real money involved).
            Tap the <strong>Feedback</strong> button anytime to report issues or share ideas.
          </p>
          <button
            onClick={handleDismiss}
            style={styles.closeBtn}
            aria-label="Dismiss beta notice"
            title="Dismiss"
          >
            &times;
          </button>
        </div>

        {/* Expandable Known Limitations */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={styles.expandToggle}
          aria-expanded={expanded}
          aria-controls="beta-limitations"
        >
          <span style={styles.expandIcon}>{expanded ? "▾" : "▸"}</span>
          Known Beta Limitations
        </button>

        {expanded && (
          <ul id="beta-limitations" style={styles.limitationsList}>
            <li style={{...styles.limitationItem, marginBottom: "0.4rem", fontSize: "0.72rem", color: "#64748b", fontStyle: "italic" }}>
              What this means for you: everything works, but these are the rough edges we're still smoothing out.
            </li>
            <li style={styles.limitationItem}>
              <span style={styles.limitationIcon}>🔐</span>
              <span>
                <strong>Tank data isn't fully private yet.</strong> We're building the auth bridge now — for this beta, 
                don't store anything sensitive in tank notes or profiles.
              </span>
            </li>
            <li style={styles.limitationItem}>
              <span style={styles.limitationIcon}>🏆</span>
              <span>
                <strong>XP & leaderboards are for fun right now.</strong> They're stored locally and can be edited 
                in DevTools. We'll verify all scores server-side before issuing any real rewards.
              </span>
            </li>
            <li style={styles.limitationItem}>
              <span style={styles.limitationIcon}>⛽</span>
              <span>
                <strong>On-chain writes share a single sponsor wallet.</strong> You never pay gas, but transactions 
                might be slow during peak usage. If one fails, just retry in a couple minutes.
              </span>
            </li>
            <li style={styles.limitationItem}>
              <span style={styles.limitationIcon}>🔄</span>
              <span>
                <strong>We may need to reset data between updates.</strong> Use Settings → Export to back up regularly.
                We'll always give advance notice before any planned reset.
              </span>
            </li>
            <li style={styles.limitationItem}>
              <span style={styles.limitationIcon}>🤖</span>
              <span>
                <strong>Poseidon is smart but not perfect.</strong> AI advice is grounded in our species database, 
                but always cross-reference with your own experience for sensitive species.
              </span>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

const styles = {
  banner: {
    display: "flex",
    flexDirection: "column",
    gap: "0",
    padding: "0.75rem 1.25rem",
    marginBottom: "1rem",
    borderRadius: "10px",
    background: "linear-gradient(135deg, rgba(14, 165, 233, 0.08) 0%, rgba(56, 189, 248, 0.04) 100%)",
    border: "1px solid rgba(56, 189, 248, 0.2)",
    backdropFilter: "blur(8px)",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  badge: {
    flexShrink: 0,
    fontSize: "0.65rem",
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "#0f172a",
    backgroundColor: "#38bdf8",
    padding: "0.2rem 0.5rem",
    borderRadius: "4px",
  },
  text: {
    margin: 0,
    fontSize: "0.82rem",
    color: "#94a3b8",
    lineHeight: 1.5,
    flex: 1,
  },
  closeBtn: {
    flexShrink: 0,
    background: "none",
    border: "none",
    color: "#64748b",
    fontSize: "1.25rem",
    cursor: "pointer",
    padding: "0.25rem 0.5rem",
    borderRadius: "4px",
    lineHeight: 1,
  },
  expandToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    background: "none",
    border: "none",
    color: "#38bdf8",
    fontSize: "0.75rem",
    fontWeight: 500,
    cursor: "pointer",
    padding: "0.25rem 0",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  expandIcon: {
    fontSize: "0.7rem",
    lineHeight: 1,
  },
  limitationsList: {
    listStyle: "none",
    margin: "0.25rem 0 0 0",
    padding: "0.5rem 0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    borderTop: "1px solid rgba(56, 189, 248, 0.1)",
    paddingTop: "0.6rem",
  },
  limitationItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    fontSize: "0.78rem",
    color: "#94a3b8",
    lineHeight: 1.4,
  },
  limitationIcon: {
    flexShrink: 0,
    fontSize: "0.85rem",
    marginTop: "0.05rem",
  },
};
