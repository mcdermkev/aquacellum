import React from "react";
import { AquacellumLockup } from "./AquacellumMark";

/**
 * AppFooter — the public site footer (public/js/footer.js), drawn in the app so
 * both sides end the same way. Same brand line, same three columns, same links.
 * Change both together.
 *
 * Hrefs are the same as footer.js. /app/* links route in-app via onNavigate.
 */
const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "/database.html", label: "Species Database" },
      { href: "/marketplace.html", label: "Marketplace" },
      { href: "/breeds.html", label: "Breed Gallery" },
      { href: "/compare.html", label: "Compare Species" },
      { href: "/breeders.html", label: "Find Breeders" },
      { href: "/poseidon.html", label: "Poseidon AI" },
      { href: "/app", label: "Open the App" },
    ],
  },
  {
    title: "Community",
    links: [
      { href: "/app/reef", label: "The Reef" },
      { href: "/app/auctions", label: "Auctions" },
      { href: "/app/auction-night", label: "Club auction night" },
      { href: "/leaderboard.html", label: "Leaderboard" },
      { href: "/about.html", label: "About Us" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/how-it-works.html", label: "How buying works" },
      { href: "/how-it-works.html#fees", label: "Fees" },
      { href: "/how-it-works.html#faq", label: "FAQ" },
      { href: "/developers.html", label: "Developer API" },
      { href: "/legal.html", label: "Legal" },
    ],
  },
];

export function AppFooter({ onNavigate, children }) {
  // In-app destinations stay in the SPA (no reload, state kept); public pages
  // are full navigations. Modified clicks (new tab etc.) are left alone.
  const handleClick = (e, href) => {
    if (!onNavigate || !href.startsWith("/app/")) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-grid">
          <div className="app-footer-brand">
            <AquacellumLockup sub="Living Registry" />
            <p className="app-footer-desc">
              The go-to place for everything fish: look up 500+ freshwater and saltwater
              species, buy from breeders, bid in auctions, and log your tanks.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} className="app-footer-col" aria-label={col.title}>
              <h2 className="app-footer-col-title">{col.title}</h2>
              {col.links.map((l) => (
                <a key={l.href + l.label} href={l.href} onClick={(e) => handleClick(e, l.href)}>{l.label}</a>
              ))}
            </nav>
          ))}
        </div>
        <div className="app-footer-bottom">
          <span className="app-footer-copy">&copy; {new Date().getFullYear()} Aquacellum Protocol. All rights reserved.</span>
          {children}
        </div>
      </div>
    </footer>
  );
}

export default AppFooter;
