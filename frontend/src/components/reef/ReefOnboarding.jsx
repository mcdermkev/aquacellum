/**
 * ReefOnboarding.jsx
 * 
 * First-visit onboarding overlay for the Social tab.
 * Explains the main features in plain language with one dismissable card.
 * Only shows once (persisted via localStorage).
 */

import React, { useState, useEffect } from "react";

const STORAGE_KEY = "aquadex_reef_onboarding_seen";

const FEATURES = [
  {
    icon: "📸",
    title: "Posts",
    themedTitle: "Currents",
    description: "Share tank updates, photos, and water parameters with the community.",
    themedDescription: "Publish status Currents from your containment units to the collective feed.",
  },
  {
    icon: "👥",
    title: "Groups",
    themedTitle: "Schools",
    description: "Join communities based on species, region, or interests. Chat, compete in challenges, and learn together.",
    themedDescription: "Enroll in Schools — faction clusters organized by species, zone, or protocol focus.",
  },
  {
    icon: "📅",
    title: "Events",
    themedTitle: "Tides",
    description: "Attend virtual meetups, local expos, auctions, and breeding challenges.",
    themedDescription: "Ride the Tides — scheduled operations from virtual syncs to regional expos.",
  },
  {
    icon: "🤝",
    title: "Friends",
    themedTitle: "Tankmates",
    description: "Follow other fishkeepers, send messages, and build your network.",
    themedDescription: "Link Tankmates — forge node connections to populate your feed matrix.",
  },
  {
    icon: "⭐",
    title: "Reputation",
    themedTitle: "Depth Score",
    description: "Earn XP by participating. Level up to unlock features like hosting events and mentoring.",
    themedDescription: "Increase your Depth Score to ascend tiers and unlock operator privileges.",
  },
];

export function ReefOnboarding({ casualModeActive = false, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    onDismiss?.();
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(10px)",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleDismiss(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          maxHeight: "85vh",
          overflowY: "auto",
          padding: "2rem",
          borderRadius: "20px",
          background: "rgba(15, 23, 42, 0.98)",
          border: "1px solid rgba(56, 189, 248, 0.15)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <span style={{ fontSize: "2.5rem" }}>🪸</span>
          <h2
            id="onboarding-title"
            style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.3rem", fontWeight: 700, color: "#fff" }}
          >
            {casualModeActive ? "Welcome to the Social Hub!" : "Welcome to The Reef"}
          </h2>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {casualModeActive
              ? "This is where you connect with fellow fishkeepers. Here's what you can do:"
              : "Your social command center. Here's the lay of the land:"
            }
          </p>
        </div>

        {/* Feature cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.75rem" }}>
          {FEATURES.map((feature, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "12px",
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <span style={{ fontSize: "1.3rem", flexShrink: 0, marginTop: "0.1rem" }}>{feature.icon}</span>
              <div>
                <h4 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "#fff" }}>
                  {casualModeActive ? feature.title : feature.themedTitle}
                  {!casualModeActive && (
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: "0.4rem", fontWeight: 400 }}>
                      ({feature.title})
                    </span>
                  )}
                </h4>
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.7rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  {casualModeActive ? feature.description : feature.themedDescription}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* XP note */}
        <div style={{
          padding: "0.75rem 1rem",
          borderRadius: "10px",
          background: "rgba(251, 191, 36, 0.05)",
          border: "1px solid rgba(251, 191, 36, 0.12)",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
        }}>
          <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>💡</span>
          <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
            {casualModeActive
              ? "Some features unlock as you level up. Post updates, join groups, and help others to earn XP faster!"
              : "Advanced privileges unlock at higher Depth Tiers. Engage with the network to ascend."
            }
          </p>
        </div>

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            borderRadius: "10px",
            border: "none",
            background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
            color: "#fff",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            boxShadow: "0 4px 16px rgba(14, 165, 233, 0.3)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          {casualModeActive ? "Let's go!" : "Enter The Reef"}
        </button>
      </div>
    </div>
  );
}
