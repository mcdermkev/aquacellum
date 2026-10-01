import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { useAuth } from "../contexts/AuthContext";
import "./WhatsNewModal.css";

/**
 * WhatsNewModal: a short list of recent changes, shown once per version.
 *
 * Shows only to signed-in people. A first-time visitor who hasn't signed in
 * came to look around, not to read a changelog, so nothing covers the page for
 * them. The seen flag is written on close, so the list appears once per
 * version per browser, after sign-in.
 *
 * Entries are taken from the real change history (git log), in plain words.
 */

// Bump this when there is a meaningful set of changes to announce. Exported so
// Settings > App & Support can show the running version (docs/SETTINGS_SPEC.md
// §6 #12) without a second copy of the string.
export const CURRENT_VERSION = "0.11.0";
const VERSION_KEY = "aquadex_last_seen_version";

// Most recent first. Keep it to what people will notice, 5 to 7 items.
const RELEASE = {
  date: "September 30, 2026",
  items: [
    "Meet Echo, your fish guide, powered by Poseidon. Tap her in the corner of any screen to chat.",
    "Ask whether fish can live together and Echo shows a card with the shared temperature and pH, tank size and temperament from the species catalog.",
    "Plan a tank with Echo: pick a size and water type, add fish, and see how the group fits as you go.",
    "Send Echo a photo of a fish for her best guesses, each with a match percentage.",
    "Echo mentions changes between your last two water tests, like a nitrate rise, and you can ask her why.",
    "Ask by voice and have answers read aloud, in browsers that support it.",
    "Opening your profile no longer pops up a MetaMask request.",
  ],
};

export function WhatsNewModal() {
  const [isOpen, setIsOpen] = useState(false);
  const { account } = useAuth();

  useEffect(() => {
    if (!account) {
      setIsOpen(false);
      return;
    }
    let lastSeen = null;
    try {
      lastSeen = localStorage.getItem(VERSION_KEY);
    } catch {
      return;
    }
    if (lastSeen === CURRENT_VERSION) return;
    // Small delay so it doesn't flash on top of sign-in or onboarding.
    const timer = setTimeout(() => setIsOpen(true), 1500);
    return () => clearTimeout(timer);
  }, [account]);

  const handleClose = () => {
    try {
      localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
    } catch {
      // Private mode: it just shows again next visit.
    }
    setIsOpen(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} ariaLabel="What's new in Aquacellum" className="whatsnew-card" fullScreenMobile={false}>
      <div className="whatsnew">
        <div className="whatsnew-head">
          <div>
            <p className="whatsnew-kicker">What&apos;s new</p>
            <h3 className="whatsnew-title">Recent changes to Aquacellum</h3>
          </div>
          <span className="whatsnew-version">v{CURRENT_VERSION}</span>
        </div>
        <p className="whatsnew-date">{RELEASE.date}</p>
        <ul className="whatsnew-list">
          {RELEASE.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button type="button" onClick={handleClose} className="whatsnew-close">
          Got it
        </button>
      </div>
    </Modal>
  );
}
