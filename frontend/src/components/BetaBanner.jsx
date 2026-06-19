import React, { useState } from "react";

const DISMISS_KEY = "aquadex_beta_banner_dismissed";

/**
 * BetaBanner — Persistent but dismissible notice for beta testers.
 * Explains testnet status, data expectations, and experimental features.
 */
export function BetaBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISS_KEY) === "true";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <div style={styles.banner} role="status" aria-label="Beta notice">
      <div style={styles.content}>
        <div style={styles.badge}>BETA</div>
        <p style={styles.text}>
          Welcome to the Aquadex closed beta! This runs on{" "}
          <strong>Base Sepolia testnet</strong> — no real money or crypto is involved.
          Data may be reset during development. Report bugs or feedback directly to the team.
        </p>
      </div>
      <button
        onClick={handleDismiss}
        style={styles.closeBtn}
        aria-label="Dismiss beta notice"
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

const styles = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "0.75rem 1.25rem",
    marginBottom: "1rem",
    borderRadius: "10px",
    background: "linear-gradient(135deg, rgba(14, 165, 233, 0.08) 0%, rgba(56, 189, 248, 0.04) 100%)",
    border: "1px solid rgba(56, 189, 248, 0.2)",
    backdropFilter: "blur(8px)",
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flex: 1,
    minWidth: 0,
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
};
