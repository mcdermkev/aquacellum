import React, { useState, useEffect, useRef } from "react";
import { WifiSlash, CheckCircle } from "@phosphor-icons/react";
export function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOffline = useRef(false);
  const toastTimeout = useRef(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Only show "back online" toast if we were previously offline
      if (wasOffline.current) {
        setShowReconnected(true);
        toastTimeout.current = setTimeout(() => {
          setShowReconnected(false);
        }, 4000);
      }
      wasOffline.current = false;
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOffline.current = true;
      setShowReconnected(false);
      if (toastTimeout.current) {
        clearTimeout(toastTimeout.current);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Track initial state
    if (!navigator.onLine) {
      wasOffline.current = true;
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (toastTimeout.current) {
        clearTimeout(toastTimeout.current);
      }
    };
  }, []);

  // Nothing to show
  if (isOnline && !showReconnected) return null;

  return (
    <>
      {/* Offline Banner — persistent, fixed at top */}
      {!isOnline && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            padding: "0.65rem 1rem",
            background: "linear-gradient(135deg, rgba(248, 113, 113, 0.95) 0%, rgba(220, 38, 38, 0.95) 100%)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            fontFamily: "'Outfit', sans-serif",
            fontSize: "0.82rem",
            fontWeight: 600,
            color: "#fff",
            boxShadow: "0 4px 20px rgba(220, 38, 38, 0.3)",
            animation: "slideDownBanner 0.3s ease-out",
          }}
        >
          <WifiSlash size={16} weight="bold" />
          <span>You're offline — some features may be unavailable</span>
        </div>
      )}

      {/* Reconnected Toast — slides in from top, auto-dismisses */}
      {showReconnected && isOnline && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: "1rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            padding: "0.6rem 1.25rem",
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.95) 0%, rgba(5, 150, 105, 0.95) 100%)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            borderRadius: "50px",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontFamily: "'Outfit', sans-serif",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "#fff",
            boxShadow: "0 4px 20px rgba(16, 185, 129, 0.3), 0 0 0 1px rgba(16, 185, 129, 0.2)",
            animation: "slideDownToast 0.35s ease-out, fadeOutToast 0.5s ease-in 3.5s forwards",
          }}
        >
          <CheckCircle size={14} weight="bold" />
          <span>Back online</span>
        </div>
      )}
    </>
  );
}
