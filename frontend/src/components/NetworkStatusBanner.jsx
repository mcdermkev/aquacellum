import React, { useState, useEffect, useRef } from "react";

/**
 * NetworkStatusBanner — Shows a persistent banner when offline
 * and a brief "back online" toast when connectivity resumes.
 */
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
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Back online</span>
        </div>
      )}
    </>
  );
}
