/**
 * ZoneAssignmentFlow.jsx
 * 
 * Location permission UX for zone assignment.
 * Used during onboarding (first-time) and in Settings (zone transfer).
 * 
 * Flow:
 *   1. Explain why location is needed (privacy-friendly copy)
 *   2. Request geolocation permission
 *   3. Calculate zone from coordinates
 *   4. Show assigned zone with map-like preview
 *   5. Confirm and persist to Supabase
 * 
 * Props:
 *   - onComplete({zoneHash, displayName}) - Called after successful assignment
 *   - onSkip() - Called if user declines location
 *   - isTransfer {boolean} - True if this is a zone transfer (shows cooldown info)
 *   - casualModeActive {boolean} - Label styling
 */

import React, { useState, useCallback } from "react";
import { detectUserZone, calculateZoneHash } from "../utils/zoneHash";
import { assignUserToZone, registerZone } from "../services/zoneLeaderboardApi";
import { useAssignZone } from "../hooks/useZoneLeaderboard";
import { useUnitPrefs } from "../hooks/useUnitPrefs";
import { formatDistance } from "../utils/units";

// ─────────────────────────────────────────────────────────────────────────────
// States
// ─────────────────────────────────────────────────────────────────────────────

const STEP = {
  INTRO: "intro",
  DETECTING: "detecting",
  CONFIRM: "confirm",
  ASSIGNING: "assigning",
  SUCCESS: "success",
  ERROR: "error",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ZoneAssignmentFlow({
  onComplete,
  onSkip,
  isTransfer = false,
  casualModeActive = true,
}) {
  const { distanceUnit } = useUnitPrefs();
  const [step, setStep] = useState(STEP.INTRO);
  const [zoneData, setZoneData] = useState(null);
  const [error, setError] = useState(null);

  const assignZoneMutation = useAssignZone();

  // ─── Step 1 → 2: Request location ──────────────────────────────────────
  const handleEnableLocation = useCallback(async () => {
    setStep(STEP.DETECTING);
    setError(null);

    try {
      const zone = await detectUserZone();
      setZoneData(zone);
      setStep(STEP.CONFIRM);
    } catch (err) {
      setError(err.message || "Failed to detect location.");
      setStep(STEP.ERROR);
    }
  }, []);

  // ─── Step 3 → 4: Confirm and assign ────────────────────────────────────
  const handleConfirmZone = useCallback(async () => {
    if (!zoneData) return;

    setStep(STEP.ASSIGNING);

    try {
      // Register the zone if it doesn't exist yet
      await registerZone({
        zone_hash: zoneData.zoneHash,
        display_name: zoneData.displayName,
        center_lat: zoneData.centerLat,
        center_lng: zoneData.centerLng,
        radius_miles: zoneData.radiusMiles,
        population_tier: zoneData.populationTier,
      });

      // Assign user to zone
      const result = await assignUserToZone(zoneData.zoneHash);

      if (result.error) {
        setError(result.error);
        setStep(STEP.ERROR);
        return;
      }

      setStep(STEP.SUCCESS);

      // Notify parent
      if (onComplete) {
        onComplete({
          zoneHash: zoneData.zoneHash,
          displayName: zoneData.displayName,
        });
      }
    } catch (err) {
      setError(err.message || "Failed to assign zone.");
      setStep(STEP.ERROR);
    }
  }, [zoneData, onComplete]);

  // ─── Retry from error ──────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setError(null);
    setStep(STEP.INTRO);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      padding: "1.5rem",
      borderRadius: "16px",
      background: "rgba(7, 5, 15, 0.8)",
      border: "1px solid rgba(139, 92, 246, 0.12)",
      backdropFilter: "blur(12px)",
      maxWidth: "420px",
      margin: "0 auto",
    }}>

      {/* ─── INTRO ──────────────────────────────────────────────────────── */}
      {step === STEP.INTRO && (
        <>
          <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
            <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.5rem" }}>📍</span>
            <h3 style={{
              margin: "0 0 0.4rem",
              fontSize: "1.1rem",
              fontWeight: "800",
              color: "#fff",
              fontFamily: "'Outfit', sans-serif",
            }}>
              {isTransfer ? "Transfer Your Zone" : "Join Your Regional Zone"}
            </h3>
            <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.6", margin: 0 }}>
              {isTransfer
                ? "Move to a new regional zone based on your current location. You can only transfer once every 90 days."
                : "Compete with nearby keepers on your regional leaderboard. Your approximate location determines your zone — we never store precise coordinates."
              }
            </p>
          </div>

          {/* Privacy note */}
          <div style={{
            padding: "0.6rem 0.8rem",
            borderRadius: "8px",
            background: "rgba(56, 189, 248, 0.04)",
            border: "1px solid rgba(56, 189, 248, 0.1)",
            marginBottom: "1.25rem",
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            lineHeight: "1.5",
          }}>
            🔒 <strong style={{ color: "var(--text-secondary)" }}>Privacy:</strong> We only use your city-level location to assign a zone (15–30 mile radius). Your exact coordinates are never stored or shared.
          </div>

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <button
              onClick={handleEnableLocation}
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                borderRadius: "10px",
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(56, 189, 248, 0.15))",
                border: "1px solid rgba(139, 92, 246, 0.3)",
                color: "#fff",
                fontSize: "0.85rem",
                fontWeight: "700",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              📍 Enable Location
            </button>

            {onSkip && (
              <button
                onClick={onSkip}
                style={{
                  width: "100%",
                  padding: "0.6rem 1rem",
                  borderRadius: "10px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--text-muted)",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                Skip for now
              </button>
            )}
          </div>
        </>
      )}

      {/* ─── DETECTING ──────────────────────────────────────────────────── */}
      {step === STEP.DETECTING && (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: "3px solid rgba(139, 92, 246, 0.3)",
            borderTopColor: "#a855f7",
            margin: "0 auto 1rem",
            animation: "spin 1s linear infinite",
          }} />
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
            Detecting your zone...
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ─── CONFIRM ────────────────────────────────────────────────────── */}
      {step === STEP.CONFIRM && zoneData && (
        <>
          <div style={{ textAlign: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "1.8rem", display: "block", marginBottom: "0.4rem" }}>🏆</span>
            <h3 style={{ margin: "0 0 0.3rem", fontSize: "1rem", fontWeight: "800", color: "#fff" }}>
              Zone Found!
            </h3>
          </div>

          {/* Zone card */}
          <div style={{
            padding: "1rem",
            borderRadius: "12px",
            background: "rgba(251, 191, 36, 0.04)",
            border: "1px solid rgba(251, 191, 36, 0.15)",
            marginBottom: "1rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
              <div style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "rgba(251, 191, 36, 0.1)",
                border: "1px solid rgba(251, 191, 36, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.1rem",
              }}>
                🗺️
              </div>
              <div>
                <div style={{ fontSize: "0.88rem", fontWeight: "700", color: "#fff" }}>
                  {zoneData.displayName}
                </div>
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                  {/* Radius honours Settings → Units & Formatting. This line is
                      what gives `aquadex_distance_unit` its first reachable
                      reader — it previously hardcoded "mi" while the only other
                      consumer, LocalBreederMap, is retired and never imported. */}
                  {zoneData.zoneHash.slice(0, 10)}... · {formatDistance(zoneData.radiusMiles, distanceUnit, { precision: 0 })} radius · {zoneData.populationTier}
                </div>
              </div>
            </div>

            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: "1.5" }}>
              You'll compete against other {casualModeActive ? "keepers" : "operators"} in this zone for the regional leaderboard. Only one God-Tier champion per zone.
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleRetry}
              style={{
                flex: 1,
                padding: "0.65rem",
                borderRadius: "8px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-muted)",
                fontSize: "0.78rem",
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
            <button
              onClick={handleConfirmZone}
              style={{
                flex: 2,
                padding: "0.65rem",
                borderRadius: "8px",
                background: "linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(139, 92, 246, 0.12))",
                border: "1px solid rgba(251, 191, 36, 0.25)",
                color: "#fff",
                fontSize: "0.82rem",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              Confirm Zone
            </button>
          </div>
        </>
      )}

      {/* ─── ASSIGNING ──────────────────────────────────────────────────── */}
      {step === STEP.ASSIGNING && (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: "3px solid rgba(251, 191, 36, 0.3)",
            borderTopColor: "#fbbf24",
            margin: "0 auto 1rem",
            animation: "spin 1s linear infinite",
          }} />
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
            Joining your zone...
          </p>
        </div>
      )}

      {/* ─── SUCCESS ────────────────────────────────────────────────────── */}
      {step === STEP.SUCCESS && zoneData && (
        <div style={{ textAlign: "center", padding: "1rem 0" }}>
          <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "0.6rem" }}>🎉</span>
          <h3 style={{ margin: "0 0 0.4rem", fontSize: "1.05rem", fontWeight: "800", color: "#fff" }}>
            Welcome to {zoneData.displayName}!
          </h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: "0 0 1rem" }}>
            You're now competing on the regional leaderboard. Earn {casualModeActive ? "Loyalty Points" : "XP"} to climb the ranks and claim God-Tier champion status.
          </p>

          {isTransfer && (
            <div style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              background: "rgba(251, 191, 36, 0.05)",
              border: "1px solid rgba(251, 191, 36, 0.12)",
              fontSize: "0.65rem",
              color: "var(--text-muted)",
              marginBottom: "0.75rem",
            }}>
              ⏱ Next zone transfer available in 90 days
            </div>
          )}
        </div>
      )}

      {/* ─── ERROR ──────────────────────────────────────────────────────── */}
      {step === STEP.ERROR && (
        <>
          <div style={{ textAlign: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "1.8rem", display: "block", marginBottom: "0.4rem" }}>⚠️</span>
            <h3 style={{ margin: "0 0 0.3rem", fontSize: "1rem", fontWeight: "700", color: "#fff" }}>
              Zone Assignment Failed
            </h3>
            <p style={{ fontSize: "0.78rem", color: "var(--accent-red, #f87171)", lineHeight: "1.5", margin: 0 }}>
              {error}
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            {onSkip && (
              <button
                onClick={onSkip}
                style={{
                  flex: 1,
                  padding: "0.65rem",
                  borderRadius: "8px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "var(--text-muted)",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                Skip
              </button>
            )}
            <button
              onClick={handleRetry}
              style={{
                flex: 2,
                padding: "0.65rem",
                borderRadius: "8px",
                background: "rgba(56, 189, 248, 0.1)",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                color: "#fff",
                fontSize: "0.82rem",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ZoneAssignmentFlow;
