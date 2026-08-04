import React, { useEffect, useState } from "react";
import { SettingsSubsectionLabel as SubsectionLabel } from "./SettingsSubsectionLabel";

/**
 * InstallAppPanel — permanent "Install App" option with platform-appropriate
 * install instructions. On iOS (which never fires `beforeinstallprompt`), this is
 * the reliable way to find Add to Home Screen without relying on the dismissable
 * PwaManager banner.
 *
 * Lives in its own file because the iOS instruction block is long enough that
 * keeping it inline pushed `AppSupportSection.jsx` to 315 lines, over AC-1's
 * 300-line ceiling. Behaviour is unchanged from the version that shipped inside
 * that section.
 */
export function InstallAppPanel({ casualModeActive }) {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream;

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);

  useEffect(() => {
    if (isStandalone) {
      setInstalled(true);
      return;
    }
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      await installEvent.userChoice;
    } catch {
      /* dismissed */
    }
    setInstallEvent(null);
  };

  return (
    <div>
      <SubsectionLabel>{casualModeActive ? "Install App" : "Install Progressive Web App"}</SubsectionLabel>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1rem" }}>
        {installed
          ? casualModeActive
            ? "Aquadex is already installed on this device. You're getting the full app experience!"
            : "PWA is installed and running in standalone display mode."
          : casualModeActive
            ? "Install Aquadex to your home screen for a full-screen, app-like experience with faster loading and offline access."
            : "Install the PWA for standalone display mode, offline shell caching, and native-like navigation without browser chrome."}
      </p>

      {!installed && (
        <>
          {installEvent && (
            <button
              className="btn-primary"
              onClick={handleInstall}
              style={{ padding: "0.75rem 1.5rem", fontSize: "0.875rem", minHeight: "44px" }}
            >
              Install Aquadex
            </button>
          )}

          {isIos && !installEvent && (
            <div>
              <button
                className="btn-primary"
                onClick={() => setShowIosSteps((v) => !v)}
                style={{ padding: "0.75rem 1.5rem", fontSize: "0.875rem", minHeight: "44px" }}
              >
                {showIosSteps ? "Hide Instructions" : "How to Install"}
              </button>

              {showIosSteps && (
                <div
                  style={{
                    marginTop: "1.25rem",
                    padding: "1.25rem",
                    background: "rgba(56, 189, 248, 0.04)",
                    border: "1px solid rgba(56, 189, 248, 0.15)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", fontWeight: "600", marginBottom: "1rem" }}>
                    Follow these steps in Safari:
                  </p>
                  <ol
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                      lineHeight: "2",
                      paddingLeft: "1.25rem",
                      margin: 0,
                    }}
                  >
                    <li>
                      Tap the <strong style={{ color: "var(--accent-blue)" }}>Share</strong> button{" "}
                      <span style={{ fontSize: "1rem" }}>&#x2B06;&#xFE0F;</span> (the square with an arrow at the bottom of Safari)
                    </li>
                    <li>
                      Scroll down and tap <strong style={{ color: "var(--accent-blue)" }}>Add to Home Screen</strong>
                    </li>
                    <li>
                      Tap <strong style={{ color: "var(--accent-blue)" }}>Add</strong> in the top-right corner
                    </li>
                  </ol>
                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "0.6rem 0.85rem",
                      background: "rgba(251, 191, 36, 0.06)",
                      border: "1px solid rgba(251, 191, 36, 0.2)",
                      borderRadius: "6px",
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "flex-start",
                    }}
                  >
                    <span style={{ fontSize: "0.8rem" }}>💡</span>
                    <span style={{ fontSize: "0.72rem", color: "rgba(251, 191, 36, 0.9)", lineHeight: "1.4" }}>
                      This must be done in Safari. Other browsers on iPhone (Chrome, Firefox) don't support installing PWAs.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isIos && !installEvent && (
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
              {casualModeActive
                ? "Your browser will show an install option in the address bar, or try visiting this page in Chrome or Edge."
                : "The install prompt will appear when browser installability criteria are met. Ensure you're using a Chromium-based browser with a valid service worker."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default InstallAppPanel;
