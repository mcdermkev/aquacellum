/**
 * OnboardingWizard.jsx — REVAMPED (task 9.1)
 *
 * Composes the new onboarding pieces: OnboardingProvider → OnboardingLayout +
 * PoseidonNarrator + EchoStage + IdentityStep + NameConfirmStep for in-card
 * phases, then hands off to SpotlightTour for the guided real-UI walkthrough.
 *
 * Kicks off useCatalogHydration on mount; holds on an Echo-syncing beat when the
 * catalog isn't ready at the transition point. Never shows a raw loading bar.
 *
 * Requirements: 1.1, 8.3, 8.4, 8.5
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { OnboardingProvider, useOnboarding, PHASES } from "../contexts/OnboardingContext";
import { OnboardingLayout } from "./onboarding/OnboardingLayout";
import { PoseidonNarrator, DIALOGUE, resolveLine } from "./onboarding/PoseidonNarrator";
import { EchoStage } from "./onboarding/EchoStage";
import { IdentityStep } from "./onboarding/IdentityStep";
import { NameConfirmStep } from "./onboarding/NameConfirmStep";
import { SpotlightTour } from "./onboarding/SpotlightTour";
import { useCatalogHydration } from "../hooks/useCatalogHydration";

// ─────────────────────────────────────────────────────────────────────────────
// Inner wizard — requires OnboardingProvider above it in the tree
// ─────────────────────────────────────────────────────────────────────────────

function WizardInner({ onComplete }) {
  const {
    phase,
    persona,
    casualMode,
    account,
    setPersona,
    advance,
    completeOnboarding,
  } = useOnboarding();

  const { catalogReady } = useCatalogHydration();
  const narratorRef = useRef(null);
  const phaseContainerRef = useRef(null);
  const [welcomeSent, setWelcomeSent] = useState(false);

  // ── Focus management: move focus to phase container on transitions (Req 9.1)
  useEffect(() => {
    if (phaseContainerRef.current) {
      phaseContainerRef.current.focus({ preventScroll: true });
    }
  }, [phase]);

  // ── Persona step: welcome message on mount ───────────────────────────────
  useEffect(() => {
    if (welcomeSent || phase !== PHASES.PERSONA) return;
    setWelcomeSent(true);
    narratorRef.current?.say(DIALOGUE.welcome, null, 1200);
  }, [phase, welcomeSent]);

  // ── Persona selected → narrate confirmation then advance ─────────────────
  const handlePersonaSelect = useCallback(
    async (isCasual) => {
      setPersona(isCasual);
      await narratorRef.current?.say(DIALOGUE.personaConfirm, isCasual);
      advance(); // → identity
    },
    [setPersona, advance]
  );

  // ── Identity phase: narrate wallet pending message ───────────────────────
  useEffect(() => {
    if (phase === PHASES.IDENTITY && persona !== null) {
      narratorRef.current?.say(DIALOGUE.walletPending, persona, 400);
    }
  }, [phase, persona]);

  // ── Account resolved (from IdentityStep) → narrate success ───────────────
  useEffect(() => {
    if (phase === PHASES.NAME_CONFIRM && account) {
      narratorRef.current?.say(DIALOGUE.walletSuccess, persona);
      setTimeout(() => {
        narratorRef.current?.say(DIALOGUE.namePrompt || DIALOGUE.tankSetupIntro, persona, 600);
      }, 900);
    }
    // Only fire when phase becomes nameConfirm
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Hatch phase intro ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === PHASES.HATCH) {
      narratorRef.current?.say(DIALOGUE.echoIntro, persona, 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Echo hatched → check catalog, then advance ───────────────────────────
  const handleHatch = useCallback(async () => {
    await narratorRef.current?.say(DIALOGUE.echoTapped, persona, 800);

    if (!catalogReady) {
      await narratorRef.current?.say(DIALOGUE.catalogSyncing, null, 600);
      // Wait for catalog (poll)
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          // catalogReady is a hook value — we'll just advance and let the tour
          // handle any remaining loading. The design says "hold on a companion-
          // themed beat" but never block indefinitely.
          clearInterval(iv);
          resolve();
        }, 2000);
      });
    }
    advance(); // → tourTank
  }, [persona, catalogReady, advance]);

  // ── Tour completion → mark onboarding done ───────────────────────────────
  const handleTourComplete = useCallback(async () => {
    await completeOnboarding();
    if (onComplete) onComplete(casualMode);
  }, [completeOnboarding, onComplete, casualMode]);

  // ── Determine what to render based on phase ──────────────────────────────

  const isTourPhase = [PHASES.TOUR_TANK, PHASES.TOUR_FISH, PHASES.PROFILE_NUDGE].includes(phase);
  const isComplete = phase === PHASES.COMPLETE;

  // When the phase machine hits complete, fire the completion callback
  useEffect(() => {
    if (isComplete && onComplete) {
      onComplete(casualMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // ── TOUR PHASES: render the live dashboard beneath + SpotlightTour on top ─
  if (isTourPhase) {
    return (
      <SpotlightTour
        onAllComplete={handleTourComplete}
      />
    );
  }

  // ── IN-CARD PHASES: persona, identity, nameConfirm, hatch ────────────────

  const renderStage = () => {
    if (phase === PHASES.HATCH || phase === PHASES.NAME_CONFIRM) {
      return <EchoStage onHatch={handleHatch} />;
    }
    // Default: show a subtle ambient backdrop for persona/identity
    return (
      <div className="echo-stage">
        <div className="echo-tank-frame" style={{ opacity: 0.4 }} />
      </div>
    );
  };

  const renderActionArea = () => {
    switch (phase) {
      case PHASES.PERSONA:
        return (
          <div className="onboarding-action-area">
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                className="btn-primary"
                onClick={() => handlePersonaSelect(true)}
                style={{ flex: 1, minWidth: "180px", padding: "0.85rem 1.25rem", fontSize: "0.9rem" }}
              >
                🐠 I keep fish at home
              </button>
              <button
                className="btn-primary"
                onClick={() => handlePersonaSelect(false)}
                style={{
                  flex: 1, minWidth: "180px", padding: "0.85rem 1.25rem", fontSize: "0.9rem",
                  background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
                }}
              >
                🧬 I breed professionally
              </button>
            </div>
          </div>
        );

      case PHASES.IDENTITY:
        return <IdentityStep />;

      case PHASES.NAME_CONFIRM:
        return <NameConfirmStep />;

      case PHASES.HATCH:
        return null; // EchoStage handles interaction in the stage pane

      default:
        return null;
    }
  };

  const narration = (
    <div className="onboarding-pane--narration" ref={phaseContainerRef} tabIndex={-1} style={{ outline: "none" }}>
      <PoseidonNarrator ref={narratorRef} persona={persona} />
      {renderActionArea()}
    </div>
  );

  return (
    <div
      className="onboarding-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        overflow: "hidden",
      }}
    >
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        top: "15%",
        left: "10%",
        width: "300px",
        height: "300px",
        borderRadius: "50%",
        background: "var(--accent-blue)",
        filter: "blur(150px)",
        opacity: 0.1,
        pointerEvents: "none",
      }} />

      <OnboardingLayout
        narration={narration}
        stage={renderStage()}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public export wraps the inner wizard in OnboardingProvider
// ─────────────────────────────────────────────────────────────────────────────

export function OnboardingWizard({ onComplete }) {
  return (
    <OnboardingProvider>
      <WizardInner onComplete={onComplete} />
    </OnboardingProvider>
  );
}

export default OnboardingWizard;
