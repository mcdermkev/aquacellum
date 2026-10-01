import React, { useEffect, useState } from "react";
import { DownloadSimple, Export, Info } from "@phosphor-icons/react";
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
      <SubsectionLabel>{casualModeActive ? "Install App" : "Install the app (PWA)"}</SubsectionLabel>

      <p className="st-hint">
        {installed
          ? casualModeActive
            ? "Aquacellum is installed on this device."
            : "PWA is installed and running in standalone display mode."
          : casualModeActive
            ? "Add Aquacellum to your home screen. It opens full screen and loads faster."
            : "Install the PWA for standalone display and offline shell caching."}
      </p>

      {!installed && (
        <>
          {installEvent && (
            <button type="button" className="st-btn st-btn--primary" onClick={handleInstall}>
              <DownloadSimple size={18} aria-hidden="true" />
              Install Aquacellum
            </button>
          )}

          {isIos && !installEvent && (
            <div>
              <button
                type="button"
                className="st-btn st-btn--primary"
                onClick={() => setShowIosSteps((v) => !v)}
                aria-expanded={showIosSteps}
              >
                {showIosSteps ? "Hide steps" : "How to install"}
              </button>

              {showIosSteps && (
                <div className="st-well" style={{ marginTop: "0.9rem" }}>
                  <p className="st-label" style={{ margin: 0 }}>Follow these steps in Safari:</p>
                  <ol className="st-steps">
                    <li>
                      Tap the <strong>Share</strong> button{" "}
                      <Export size={18} aria-hidden="true" /> (the square with an arrow at the bottom of Safari)
                    </li>
                    <li>
                      Scroll down and tap <strong>Add to Home Screen</strong>
                    </li>
                    <li>
                      Tap <strong>Add</strong> in the top-right corner
                    </li>
                  </ol>
                  <div className="st-callout st-callout--amber" style={{ marginTop: "0.75rem" }}>
                    <Info size={20} aria-hidden="true" />
                    <p>Use Safari for this. Other iPhone browsers can't install web apps.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isIos && !installEvent && (
            <p className="st-empty">
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
