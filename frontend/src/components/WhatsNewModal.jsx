import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";

/**
 * WhatsNewModal — Shows recent changes when the app version bumps.
 * Triggered by comparing the current version against localStorage.
 * Displays a curated list of user-facing changes (not the full dev changelog).
 */

// Bump this when deploying meaningful beta updates.
// The modal will show once per version bump. Exported so Settings → App &
// Support can display the running version (docs/SETTINGS_SPEC.md §6 #12 —
// "version is never shown") without a second, driftable copy of the string.
export const CURRENT_VERSION = "0.9.1";
const VERSION_KEY = "aquadex_last_seen_version";

// User-facing changelog entries (most recent first).
// Keep this curated — only things beta testers care about.
const CHANGELOG_ENTRIES = [
  {
    version: "0.9.1",
    date: "June 20, 2026",
    title: "Beta Polish & Security Hardening",
    items: [
      "🛡️ API endpoints now restricted to aquacellum.com (security fix)",
      "⚡ Rate limiting added to protect the relayer wallet",
      "🐛 New Feedback button — report bugs directly from the app",
      "📋 Known Limitations section added to the beta banner",
      "☁️ Cloud sync now shows status with retry on failure",
      "🗑️ Reset Local Data button added in Settings (for stuck accounts)",
      "🤖 Poseidon now asks for confirmation before taking actions",
      "💬 Quick action chips below Poseidon chat (Log Feeding, Water Test...)",
      "🗺️ Location prompt deferred — no more surprise geolocation popup",
      "🥚 Echo egg now gently wobbles while waiting to hatch",
      "🧪 Water test form pre-fills with your last reading",
    ],
  },
  {
    version: "0.9.0",
    date: "June 19, 2026",
    title: "Stripe Payments & Marketplace v2",
    items: [
      "💳 Fiat purchases via Stripe Checkout (no crypto needed)",
      "🔗 New marketplace contract with fiat settlement support",
      "📦 Batch and shipping checkout flows",
      "🎥 Video uploads via Mux for tank content",
    ],
  },
];

export function WhatsNewModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const lastSeen = localStorage.getItem(VERSION_KEY);
    if (lastSeen !== CURRENT_VERSION) {
      // Small delay so it doesn't flash on top of onboarding
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    setIsOpen(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} ariaLabel="What's new in Aquacellum">
      <div style={styles.content}>
        <div style={styles.header}>
          <span style={styles.sparkle}>✨</span>
          <h3 style={styles.title}>What's New</h3>
          <span style={styles.versionBadge}>v{CURRENT_VERSION}</span>
        </div>

        <div style={styles.entries}>
          {CHANGELOG_ENTRIES.map((entry) => (
            <div key={entry.version} style={styles.entry}>
              <div style={styles.entryHeader}>
                <span style={styles.entryTitle}>{entry.title}</span>
                <span style={styles.entryDate}>{entry.date}</span>
              </div>
              <ul style={styles.itemList}>
                {entry.items.map((item, i) => (
                  <li key={i} style={styles.item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button onClick={handleClose} style={styles.closeBtn}>
          Got it, let's go!
        </button>
      </div>
    </Modal>
  );
}

const styles = {
  content: {
    padding: "1.5rem",
    minWidth: "min(400px, 85vw)",
    maxWidth: "460px",
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    marginBottom: "1.25rem",
  },
  sparkle: {
    fontSize: "1.3rem",
  },
  title: {
    margin: 0,
    fontSize: "1.15rem",
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 700,
    color: "#f8fafc",
    flex: 1,
  },
  versionBadge: {
    fontSize: "0.65rem",
    fontWeight: 600,
    padding: "0.2rem 0.5rem",
    borderRadius: "12px",
    background: "rgba(56, 189, 248, 0.12)",
    color: "#38bdf8",
    border: "1px solid rgba(56, 189, 248, 0.25)",
  },
  entries: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    marginBottom: "1.25rem",
    paddingRight: "0.25rem",
  },
  entry: {
    padding: "0.75rem",
    borderRadius: "8px",
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
  },
  entryHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.5rem",
  },
  entryTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#f8fafc",
  },
  entryDate: {
    fontSize: "0.65rem",
    color: "var(--text-muted)",
  },
  itemList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  item: {
    fontSize: "0.78rem",
    color: "#94a3b8",
    lineHeight: 1.4,
    paddingLeft: "0.25rem",
  },
  closeBtn: {
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
    color: "#fff",
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 500,
    fontSize: "0.9rem",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(2, 132, 199, 0.4)",
    transition: "all 0.3s ease",
    width: "100%",
  },
};
