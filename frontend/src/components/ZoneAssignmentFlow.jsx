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
 *
 * Styled by the `st-zone*` classes in settings/SettingsDaylight.css (imported
 * here so the flow renders the same wherever it is mounted). The Skip buttons
 * only render when a caller passes `onSkip`; Settings does not.
 */

import React, { useState, useCallback } from "react";
import { CheckCircle, Clock, Lock, MapPin, MapTrifold, WarningCircle } from "@phosphor-icons/react";
import "./settings/SettingsDaylight.css";
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
    <div className="st-zone">

      {/* ─── INTRO ──────────────────────────────────────────────────────── */}
      {step === STEP.INTRO && (
        <>
          <div className="st-zone-hero">
            <span className="st-zone-icon" aria-hidden="true">
              <MapPin size={24} />
            </span>
            <div>
              <h4 className="st-zone-title">
                {isTransfer ? "Move to a new zone" : "Join your regional zone"}
              </h4>
              <p className="st-zone-text">
                {isTransfer
                  ? "Move to a new regional zone based on your current location. You can only transfer once every 90 days."
                  : "Compete with nearby keepers on your regional leaderboard. Your approximate location sets your zone. We never store your exact location."
                }
              </p>
            </div>
          </div>

          {/* Privacy note */}
          <div className="st-callout">
            <Lock size={20} aria-hidden="true" />
            <p>
              <strong>Privacy:</strong> We only use your city-level location to assign a zone (15–30 mile radius). Your exact coordinates are never stored or shared.
            </p>
          </div>

          {/* Actions */}
          <div className="st-zone-actions">
            <button type="button" className="st-btn st-btn--primary" onClick={handleEnableLocation}>
              <MapPin size={18} aria-hidden="true" />
              Use my location
            </button>

            {onSkip && (
              <button type="button" className="st-btn" onClick={onSkip}>
                Skip for now
              </button>
            )}
          </div>
        </>
      )}

      {/* ─── DETECTING ──────────────────────────────────────────────────── */}
      {step === STEP.DETECTING && (
        <div className="st-zone-busy" role="status">
          <span className="st-spinner" aria-hidden="true" />
          <p>Finding your zone…</p>
        </div>
      )}

      {/* ─── CONFIRM ────────────────────────────────────────────────────── */}
      {step === STEP.CONFIRM && zoneData && (
        <>
          <h4 className="st-zone-title" style={{ marginBottom: "0.6rem" }}>Your zone</h4>

          {/* Zone card */}
          <div className="st-zone-card">
            <span className="st-zone-icon st-zone-icon--amber" aria-hidden="true">
              <MapTrifold size={24} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="st-zone-name">{zoneData.displayName}</div>
              <div className="st-zone-meta">
                {/* Radius honours Settings → Units & Formatting. This line is
                    what gives `aquadex_distance_unit` its first reachable
                    reader — it previously hardcoded "mi" while the only other
                    consumer, LocalBreederMap, is retired and never imported. */}
                {zoneData.zoneHash.slice(0, 10)}… · {formatDistance(zoneData.radiusMiles, distanceUnit, { precision: 0 })} radius · {zoneData.populationTier}
              </div>
            </div>
          </div>

          <p className="st-zone-text">
            You'll be ranked with other {casualModeActive ? "keepers" : "breeders"} in this zone on the regional leaderboard.
          </p>

          {/* Actions */}
          <div className="st-zone-actions">
            <button type="button" className="st-btn st-btn--primary" onClick={handleConfirmZone}>
              Confirm zone
            </button>
            <button type="button" className="st-btn" onClick={handleRetry}>
              Try again
            </button>
          </div>
        </>
      )}

      {/* ─── ASSIGNING ──────────────────────────────────────────────────── */}
      {step === STEP.ASSIGNING && (
        <div className="st-zone-busy" role="status">
          <span className="st-spinner" aria-hidden="true" />
          <p>Joining your zone…</p>
        </div>
      )}

      {/* ─── SUCCESS ────────────────────────────────────────────────────── */}
      {step === STEP.SUCCESS && zoneData && (
        <>
          <div className="st-zone-hero">
            <span className="st-zone-icon" aria-hidden="true">
              <CheckCircle size={24} />
            </span>
            <div>
              <h4 className="st-zone-title">You joined {zoneData.displayName}</h4>
              <p className="st-zone-text">
                You're on the regional leaderboard. Earn {casualModeActive ? "points" : "XP"} to move up.
              </p>
            </div>
          </div>

          {isTransfer && (
            <p className="st-status" style={{ color: "var(--text-secondary)" }}>
              <Clock size={18} aria-hidden="true" />
              <span>You can move zones again in 90 days.</span>
            </p>
          )}
        </>
      )}

      {/* ─── ERROR ──────────────────────────────────────────────────────── */}
      {step === STEP.ERROR && (
        <>
          <div className="st-zone-hero">
            <span className="st-zone-icon st-zone-icon--danger" aria-hidden="true">
              <WarningCircle size={24} />
            </span>
            <div>
              <h4 className="st-zone-title">Couldn't join a zone</h4>
              <p className="st-zone-error">{error}</p>
            </div>
          </div>

          <div className="st-zone-actions">
            <button type="button" className="st-btn st-btn--primary" onClick={handleRetry}>
              Try again
            </button>
            {onSkip && (
              <button type="button" className="st-btn" onClick={onSkip}>
                Skip
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ZoneAssignmentFlow;