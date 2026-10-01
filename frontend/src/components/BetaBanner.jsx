import React, { useState } from "react";

const DISMISS_KEY = "aquadex_beta_banner_dismissed";

/**
 * BetaBanner — a one-line strip above the top bar for beta testers: test mode,
 * how to report issues, and a "Known limitations" disclosure. Dismissible.
 *
 * It used to be a card inside the page that auto-expanded its limitations list
 * for the first three sessions, which pushed the whole app down on every early
 * visit. Now it is a strip the width of the page (the same place a site notice
 * sits on the public pages), and the list opens only when asked for.
 */
export function BetaBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "true"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "true"); } catch { /* private mode */ }
    setDismissed(true);
  };

  return (
    <div className="beta-strip" role="region" aria-label="Beta notice">
      <div className="beta-strip-row">
        <span className="beta-strip-badge">BETA</span>
        <p className="beta-strip-text">
          <span className="beta-strip-long">
            You're in the Aquacellum closed beta. Everything runs in <strong>test mode</strong>, no real money.
            Use the <strong>Feedback</strong> button to report issues.
          </span>
          {/* Phones: the same facts, short enough for one line. */}
          <span className="beta-strip-short"><strong>Test mode</strong>, no real money</span>
        </p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="beta-strip-toggle"
          aria-expanded={expanded}
          aria-controls="beta-limitations"
        >
          <span className="beta-strip-long">Known limitations</span>
          <span className="beta-strip-short">Limitations</span>
          <span aria-hidden="true" className="beta-strip-caret">{expanded ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="beta-strip-close"
          aria-label="Dismiss beta notice"
          title="Dismiss"
        >
          &times;
        </button>
      </div>

      <ul id="beta-limitations" className="beta-strip-list" hidden={!expanded}>
        <li className="beta-strip-lead">
          What this means for you: everything works, but these are the rough edges we're still smoothing out.
        </li>
        <li>
          <span aria-hidden="true">🔐</span>
          <span>
            <strong>Tank data isn't fully private yet.</strong> We're building the auth bridge now. For this beta,
            don't store anything sensitive in tank notes or profiles.
          </span>
        </li>
        <li>
          <span aria-hidden="true">🏆</span>
          <span>
            <strong>XP and leaderboards are for fun right now.</strong> They're stored locally and can be edited
            in DevTools. We'll verify all scores server-side before issuing any real rewards.
          </span>
        </li>
        <li>
          <span aria-hidden="true">⛽</span>
          <span>
            <strong>Background sync may be slow during peak hours.</strong> Everything saves instantly on your device,
            but syncing to our servers might take a moment during busy periods. If something seems stuck, retry.
          </span>
        </li>
        <li>
          <span aria-hidden="true">🔄</span>
          <span>
            <strong>We may need to reset data between updates.</strong> Use Settings → Export to back up regularly.
            We'll always give advance notice before any planned reset.
          </span>
        </li>
        <li>
          <span aria-hidden="true">🤖</span>
          <span>
            <strong>Echo is smart but not perfect.</strong> Her answers are grounded in our species database,
            but always cross-reference with your own experience for sensitive species.
          </span>
        </li>
      </ul>
    </div>
  );
}
