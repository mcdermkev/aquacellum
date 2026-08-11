import React from "react";

/**
 * CasualBottomNav — fixed, thumb-first bottom tab bar for Casual mode on phones.
 *
 * Five destinations (My Aquariums, Fish Finder, The Reef, Store, Profile). It is
 * hidden on wider screens and in Pro mode via CSS (`.casual-bottom-nav` is
 * display:none until the mobile breakpoint); Pro keeps the top pill strip, which
 * its breeder workflow needs. Tabs that aren't one of the five (Orders, Settings,
 * Founders, Seller Hub, In-Transit) highlight Profile, which links to them.
 */
const TABS = [
  { id: "tanks", icon: "🐠", label: "Tanks" },
  { id: "gallery", icon: "🔍", label: "Find" },
  { id: "reef", icon: "🪸", label: "Reef" },
  { id: "directory", icon: "🛒", label: "Store" },
  { id: "profile", icon: "👤", label: "Profile" },
];

// Anything not a primary destination lives under Profile, so highlight it there.
const PRIMARY = new Set(["tanks", "gallery", "reef", "directory"]);

export function CasualBottomNav({ activeTab, onNavigate, reefBadge = false, incomingCount = 0 }) {
  const activeId = PRIMARY.has(activeTab) ? activeTab : "profile";

  return (
    <nav className="casual-bottom-nav" aria-label="Primary">
      {TABS.map((t) => {
        const isActive = t.id === activeId;
        const showReefDot = t.id === "reef" && reefBadge;
        const showProfileDot = t.id === "profile" && incomingCount > 0;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onNavigate && onNavigate(t.id)}
            className={`cbn-tab${isActive ? " cbn-tab--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            aria-label={t.label}
          >
            <span className="cbn-icon">
              {t.icon}
              {(showReefDot || showProfileDot) && <span className="cbn-dot" />}
            </span>
            <span className="cbn-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default CasualBottomNav;
