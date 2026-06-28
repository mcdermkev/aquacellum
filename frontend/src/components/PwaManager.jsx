/**
 * PwaManager.jsx
 *
 * Global, headless-ish PWA UI mounted once at the app root:
 *   1. Service-worker update prompt ("new version — reload").
 *   2. Install prompt:
 *        - Android/desktop: captures `beforeinstallprompt` and offers Install.
 *        - iOS Safari: shows an "Add to Home Screen" hint (iOS never fires the
 *          event), dismissible and remembered.
 *
 * Registration of the SW happens here via the vite-plugin-pwa virtual module,
 * so we control the update flow (registerType: 'prompt').
 */

import { useEffect, useState } from "react";
// eslint-disable-next-line import/no-unresolved
import { useRegisterSW } from "virtual:pwa-register/react";

const IOS_HINT_DISMISS_KEY = "aquadex_ios_install_hint_dismissed";

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream // exclude old IE on Windows Phone
  );
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

const cardStyle = {
  position: "fixed",
  bottom: "1.25rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 11000,
  display: "flex",
  alignItems: "center",
  gap: "0.85rem",
  padding: "0.85rem 1.1rem",
  background: "rgba(14, 20, 36, 0.96)",
  border: "1px solid rgba(56, 189, 248, 0.3)",
  borderRadius: "14px",
  boxShadow: "0 12px 40px rgba(0, 0, 0, 0.55)",
  backdropFilter: "blur(12px)",
  color: "#f8fafc",
  fontFamily: "'Plus Jakarta Sans', 'Outfit', sans-serif",
  fontSize: "0.85rem",
  maxWidth: "min(92vw, 460px)",
};

const primaryBtn = {
  background: "linear-gradient(135deg, #38bdf8, #6366f1)",
  border: "none",
  borderRadius: "8px",
  color: "#fff",
  padding: "0.45rem 0.9rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostBtn = {
  background: "none",
  border: "none",
  color: "#64748b",
  cursor: "pointer",
  fontSize: "1.1rem",
  lineHeight: 1,
  padding: "0 0.25rem",
};

export function PwaManager() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn("[PWA] Service worker registration failed:", error);
    },
  });

  const [installEvent, setInstallEvent] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);

  // Capture the Android/desktop install prompt.
  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("appinstalled", onInstalled);

    // iOS: no event ever fires, so decide whether to show the manual hint.
    if (isIosDevice() && !localStorage.getItem(IOS_HINT_DISMISS_KEY)) {
      setShowIosHint(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      await installEvent.userChoice;
    } catch {
      /* user dismissed */
    }
    setInstallEvent(null);
  };

  const dismissIosHint = () => {
    localStorage.setItem(IOS_HINT_DISMISS_KEY, "1");
    setShowIosHint(false);
  };

  // ── Update prompt takes priority over install prompts ─────────────────────
  if (needRefresh) {
    return (
      <div style={cardStyle} role="alert">
        <span style={{ fontSize: "1.1rem" }}>🔄</span>
        <span style={{ flex: 1 }}>A new version of Aquadex is ready.</span>
        <button
          style={primaryBtn}
          onClick={() => updateServiceWorker(true)}
        >
          Reload
        </button>
        <button
          style={ghostBtn}
          onClick={() => setNeedRefresh(false)}
          aria-label="Dismiss update notification"
        >
          ×
        </button>
      </div>
    );
  }

  if (installEvent) {
    return (
      <div style={cardStyle}>
        <span style={{ fontSize: "1.2rem" }}>🐠</span>
        <span style={{ flex: 1 }}>Install Aquadex for a full-screen, app-like experience.</span>
        <button style={primaryBtn} onClick={handleInstall}>
          Install
        </button>
        <button
          style={ghostBtn}
          onClick={() => setInstallEvent(null)}
          aria-label="Dismiss install prompt"
        >
          ×
        </button>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div style={cardStyle}>
        <span style={{ fontSize: "1.2rem" }}>📲</span>
        <span style={{ flex: 1 }}>
          Install Aquadex: tap the Share icon, then{" "}
          <strong>Add to Home Screen</strong>.
        </span>
        <button
          style={ghostBtn}
          onClick={dismissIosHint}
          aria-label="Dismiss install hint"
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}
