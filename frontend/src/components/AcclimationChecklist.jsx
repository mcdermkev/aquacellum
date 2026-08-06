import React, { useState, useEffect, useRef } from "react";
import { Modal } from "./Modal";
import { db } from "../db";
import { awardXp } from "../utils/xp";

/**
 * AcclimationChecklist — Guided, timed acclimation flow for a newly arrived
 * specimen or batch: float (15 min) → drip (30 min) → net & release.
 *
 * Each timed step runs a live countdown. Progress is persisted to the
 * specimen/order record (non-indexed fields, no schema bump) so the timer keeps
 * running across close/reopen and even a page reload. Completing the flow awards
 * XP once.
 *
 * Props:
 *  - isOpen, onClose
 *  - item: specimen (specimens table) or batch order (marketOrders table)
 *  - itemType: "specimen" | "batch"
 *  - casualModeActive: boolean
 *  - onComplete: (result) => void
 */

const STEPS = [
  {
    key: "float",
    icon: "🌡️",
    durationSec: 15 * 60,
    casualTitle: "Float the bag",
    proTitle: "Temperature Equalization",
    casualDesc: "Float the sealed bag in your tank so the water slowly reaches the same temperature.",
    proDesc: "Float the sealed transport bag in the destination tank to equalize temperature before mixing any water.",
  },
  {
    key: "drip",
    icon: "💧",
    durationSec: 30 * 60,
    casualTitle: "Drip in tank water",
    proTitle: "Drip Acclimation",
    casualDesc: "Slowly drip tank water into the bag so your fish can adjust to the new water.",
    proDesc: "Drip destination water into the holding container (~2–4 drips/sec) to gradually match pH and hardness.",
  },
  {
    key: "release",
    icon: "🐟",
    durationSec: 0,
    casualTitle: "Net & release",
    proTitle: "Net & Release",
    casualDesc: "Gently net your fish into the tank — don't pour the bag water in.",
    proDesc: "Net specimens into the tank, discarding the transport water to avoid introducing contaminants.",
  },
];

const DONE_INDEX = STEPS.length;

function formatClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function AcclimationChecklist({
  isOpen,
  onClose,
  item,
  itemType = "specimen",
  casualModeActive = true,
  onComplete,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [stepStartedAt, setStepStartedAt] = useState(null); // unix sec
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const awardedRef = useRef(false);

  // Sync local state from the persisted item whenever the modal opens / item changes.
  useEffect(() => {
    if (!isOpen || !item) return;
    const idx = Number.isFinite(item.acclimationStepIndex) ? item.acclimationStepIndex : 0;
    setStepIndex(idx);
    setStepStartedAt(item.acclimationStepStartedAt || null);
    setNowSec(Math.floor(Date.now() / 1000));
    awardedRef.current = !!item.acclimationCompletedAt;
  }, [isOpen, item]);

  const currentStep = STEPS[stepIndex] || null;
  const isTimed = !!currentStep && currentStep.durationSec > 0;
  const running = isTimed && stepStartedAt != null;
  const elapsed = running ? nowSec - stepStartedAt : 0;
  const remaining = currentStep ? Math.max(0, currentStep.durationSec - elapsed) : 0;
  const timerDone = running && remaining <= 0;

  // Live 1s tick — only while a timed step is actively counting down.
  useEffect(() => {
    if (!isOpen || !running || timerDone) return;
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [isOpen, running, timerDone]);

  const persist = async (patch) => {
    try {
      if (itemType === "batch" && item?.key != null) {
        await db.marketOrders.update(item.key, patch);
      } else if (item?.id != null) {
        await db.specimens.update(Number(item.id), patch);
      }
    } catch (e) {
      console.warn("[Acclimation] Failed to persist progress:", e);
    }
  };

  const handleStart = async () => {
    const now = Math.floor(Date.now() / 1000);
    setStepStartedAt(now);
    setNowSec(now);
    const patch = { acclimationStepIndex: stepIndex, acclimationStepStartedAt: now };
    if (!item?.acclimationStartedAt) patch.acclimationStartedAt = now;
    await persist(patch);
  };

  const handleNext = async () => {
    const next = stepIndex + 1;
    setStepIndex(next);
    setStepStartedAt(null);
    await persist({ acclimationStepIndex: next, acclimationStepStartedAt: null });
  };

  // Pro escape hatch: experienced keepers who've already waited can advance.
  const handleSkipTimer = async () => {
    // Force the timer to read as complete without changing the step.
    const backdated = Math.floor(Date.now() / 1000) - (currentStep?.durationSec || 0);
    setStepStartedAt(backdated);
    setNowSec(Math.floor(Date.now() / 1000));
    await persist({ acclimationStepStartedAt: backdated });
  };

  const handleFinish = async () => {
    const now = Math.floor(Date.now() / 1000);
    setStepIndex(DONE_INDEX);
    setStepStartedAt(null);
    await persist({
      acclimationStepIndex: DONE_INDEX,
      acclimationStepStartedAt: null,
      acclimationCompletedAt: now,
    });
    if (!awardedRef.current) {
      awardedRef.current = true;
      awardXp("ACCLIMATION_COMPLETED");
    }
    if (onComplete) onComplete({ completed: true });
  };

  const handleResetAndClose = () => {
    onClose();
  };

  const itemName =
    itemType === "batch"
      ? `${item?.quantity || "?"}× ${item?.commonName || "Juvenile Fry"}`
      : item?.commonName || item?.scientificName || `Specimen #${item?.id ?? ""}`;

  const isDone = stepIndex >= DONE_INDEX;
  const accent = "var(--accent-cyan, #22d3ee)";
  const title = casualModeActive ? "Acclimate your fish" : "Acclimation Protocol";

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={title}>
      <div style={{ padding: "1.25rem", maxWidth: "440px", width: "100%" }}>
        {/* Header */}
        <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #f1f5f9)" }}>
          {title}
        </h3>
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary, #cbd5e1)", marginBottom: "1rem" }}>
          {itemName}
        </div>

        {/* Step rail */}
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.1rem" }}>
          {STEPS.map((s, i) => {
            const state = isDone || i < stepIndex ? "done" : i === stepIndex ? "active" : "todo";
            return (
              <div key={s.key} style={{ flex: 1, textAlign: "center" }}>
                <div
                  style={{
                    height: "4px",
                    borderRadius: "4px",
                    background:
                      state === "done" ? "var(--accent-green, #34d399)" : state === "active" ? accent : "rgba(255,255,255,0.1)",
                    marginBottom: "0.35rem",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.62rem",
                    color: state === "todo" ? "var(--text-muted, #94a3b8)" : "var(--text-primary, #f1f5f9)",
                    fontWeight: state === "active" ? 700 : 500,
                  }}
                >
                  {s.icon} {casualModeActive ? s.casualTitle : s.proTitle}
                </span>
              </div>
            );
          })}
        </div>

        {isDone ? (
          /* Completion state */
          <div
            style={{
              textAlign: "center",
              padding: "1.5rem 1rem",
              borderRadius: "12px",
              background: "rgba(52,211,153,0.06)",
              border: "1px solid rgba(52,211,153,0.25)",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✅</div>
            <div style={{ fontWeight: 700, color: "#fff", marginBottom: "0.35rem" }}>
              {casualModeActive ? "All done — welcome home!" : "Acclimation complete"}
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #94a3b8)", margin: "0 auto 1rem", maxWidth: "320px", lineHeight: 1.5 }}>
              {casualModeActive
                ? "Keep the lights dim for a few hours and hold off on feeding until tomorrow."
                : "Maintain dimmed lighting for several hours and defer the first feeding ~24h to reduce transfer stress."}
            </p>
            <button type="button" className="btn-primary" onClick={onClose} style={{ padding: "0.5rem 1.5rem", fontSize: "0.85rem" }}>
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Current step card */}
            <div
              style={{
                padding: "1rem",
                borderRadius: "12px",
                background: "rgba(34,211,238,0.04)",
                border: "1px solid rgba(34,211,238,0.18)",
                marginBottom: "1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "1.4rem" }}>{currentStep.icon}</span>
                <span style={{ fontWeight: 700, color: "#fff", fontSize: "0.95rem" }}>
                  {casualModeActive ? currentStep.casualTitle : currentStep.proTitle}
                </span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary, #cbd5e1)", margin: 0, lineHeight: 1.5 }}>
                {casualModeActive ? currentStep.casualDesc : currentStep.proDesc}
              </p>

              {/* Timer */}
              {isTimed && (
                <div style={{ marginTop: "0.9rem" }}>
                  {!running ? (
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted, #94a3b8)", marginBottom: "0.5rem" }}>
                      Suggested time: {currentStep.durationSec / 60} minutes
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.35rem" }}>
                        <span style={{ fontSize: "1.5rem", fontWeight: 800, color: timerDone ? "var(--accent-green, #34d399)" : accent, fontVariantNumeric: "tabular-nums" }}>
                          {timerDone ? (casualModeActive ? "Ready!" : "Step complete") : formatClock(remaining)}
                        </span>
                        {!timerDone && (
                          <span style={{ fontSize: "0.66rem", color: "var(--text-muted, #94a3b8)" }}>remaining</span>
                        )}
                      </div>
                      {/* Progress bar */}
                      <div style={{ height: "6px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, (elapsed / currentStep.durationSec) * 100)}%`,
                            background: timerDone ? "var(--accent-green, #34d399)" : accent,
                            transition: "width 1s linear",
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
              {isTimed && !running && (
                <button type="button" className="btn-primary" onClick={handleStart} style={{ flex: 1, padding: "0.55rem", fontSize: "0.85rem" }}>
                  {casualModeActive ? "Start timer" : "Begin step"}
                </button>
              )}

              {isTimed && running && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleNext}
                  disabled={!timerDone}
                  style={{ flex: 1, padding: "0.55rem", fontSize: "0.85rem", opacity: timerDone ? 1 : 0.5, cursor: timerDone ? "pointer" : "not-allowed" }}
                >
                  {casualModeActive ? "Next step" : "Advance"}
                </button>
              )}

              {!isTimed && (
                <button type="button" className="btn-primary" onClick={handleFinish} style={{ flex: 1, padding: "0.55rem", fontSize: "0.85rem" }}>
                  {casualModeActive ? "Released — finish" : "Confirm release"}
                </button>
              )}
            </div>

            {/* Pro escape hatch + close */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem" }}>
              {isTimed && running && !timerDone ? (
                <button
                  type="button"
                  onClick={handleSkipTimer}
                  style={{ background: "none", border: "none", color: "var(--text-muted, #94a3b8)", fontSize: "0.7rem", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  I've already waited — skip timer
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={handleResetAndClose}
                style={{ background: "none", border: "none", color: "var(--text-muted, #94a3b8)", fontSize: "0.72rem", cursor: "pointer", padding: 0 }}
              >
                {running ? "Close (keeps running)" : "Close"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
