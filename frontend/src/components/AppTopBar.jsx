import React, { useEffect, useId, useRef, useState } from "react";
import { AquacellumLockup } from "./AquacellumMark";
import { ModeSegmentedControl } from "./ModeSegmentedControl";

/**
 * AppTopBar — the app's top bar, drawn to match the public site nav
 * (public/js/nav.js + .nav in public/css/shared.css): same 64px white
 * translucent strip, same logo lockup going home to "/", same type. The app's
 * own controls (Casual/Pro, sync, cart, account) sit on the right.
 *
 * Public destinations are plain <a href> on purpose: they are separate pages,
 * and a full navigation is what lets the browser cross-fade between them.
 */

// Same labels and order as NAV_LINKS / SECONDARY_LINKS in public/js/nav.js.
// The app's own destinations (Auctions, The Reef, ...) are its tabs, so only
// the public pages are listed here.
export const SITE_LINKS = [
  { href: "/database.html", label: "Database" },
  { href: "/marketplace.html", label: "Marketplace" },
];
export const SITE_MENU_LINKS = [
  { href: "/", label: "Home" },
  ...SITE_LINKS,
  { href: "/poseidon.html", label: "Poseidon AI" },
  { href: "/breeds.html", label: "Breed Gallery" },
  { href: "/breeders.html", label: "Find Breeders" },
  { href: "/compare.html", label: "Compare Species" },
  { href: "/leaderboard.html", label: "Leaderboard" },
  { href: "/how-it-works.html", label: "How It Works" },
];

export function AppTopBar({ casualModeActive, onToggleMode, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef(null);
  const menuId = `app-site-menu-${useId().replace(/:/g, "")}`;

  // Escape closes the menu and hands focus back to the button that opened it.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className={`app-topbar ${casualModeActive ? "app-topbar--casual" : "app-topbar--pro"}`}>
      <div className="app-topbar-inner">
        <AquacellumLockup sub={casualModeActive ? "Aquarium Log" : "Breeder Protocol"} />

        <nav className="app-topbar-links" aria-label="Site">
          {SITE_LINKS.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
        </nav>

        <div className="app-topbar-actions">
          <div className="app-topbar-mode">
            <ModeSegmentedControl compact casualModeActive={casualModeActive} onToggle={onToggleMode} />
          </div>
          {children}
          <button
            ref={toggleRef}
            type="button"
            className="app-topbar-menu-toggle"
            aria-label={menuOpen ? "Close site menu" : "Open site menu"}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </div>

      <div id={menuId} className="app-topbar-menu" hidden={!menuOpen}>
        {/* On phones the mode toggle lives here, full size, so the bar keeps
            room for the logo, cart and account. */}
        <div className="app-topbar-menu-mode">
          <span className="app-topbar-menu-label" aria-hidden="true">Mode</span>
          <ModeSegmentedControl
            casualModeActive={casualModeActive}
            onToggle={(v) => { onToggleMode(v); setMenuOpen(false); }}
          />
        </div>
        <nav aria-label="Site menu">
          {SITE_MENU_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default AppTopBar;
