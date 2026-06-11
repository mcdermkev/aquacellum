/**
 * OnboardingWizard.jsx — REVAMPED (task 9.1)
 *
 * Composes the new onboarding pieces:
 *   OnboardingProvider → OnboardingLayout + PoseidonNarrator + EchoStage +
 *   IdentityStep + NameConfirmStep    (in-card phases: persona, identity,
 *                                      nameConfirm, hatch)
 *   → SpotlightTour                   (tour/profile phases over the LIVE dashboard:
 *                                      tourTank, tourFish, profileNudge)
 *
 * Kicks off `useCatalogHydration` on mount so the species archive hydrates while
 * the user is engaged with Poseidon. The final transition into the dashboard is
 * held on a companion-themed "Echo-syncing" beat when the catalog isn't ready yet
 * — never a raw loading bar — but is capped so a slow/failed hydration can never
 * block completion (Req 8.4, 9.5, Property 6).
 *
 * ── App contract (relied on by task 9.2) ─────────────────────────────────────
 *   - This component keeps the `onComplete(isCasual)` prop. It fires EXACTLY ONCE
 *     when onboarding reaches the `complete` phase, AFTER `completeOnboarding()`
 *     has persisted the per-account flag + Dexie mirror + localStorage cache. App
 *     uses this to refresh its `useOnboardingGate` decision and swap to the
 *     dashboard.
 *   - During TOUR phases (tourTank/tourFish/profileNudge) this component renders
 *     ONLY the SpotlightTour overlay. The live dashboard MUST be mounted BENEATH
 *     it by App for those phases (the spotlight points at real `data-tour-id`
 *     controls). Task 9.2 adjusts App to render the dashboard during tour phases
 *     instead of returning the wizard alone.
 *
 * Requirements: 1.1, 8.3, 8.4, 8.5
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { OnboardingProvider, useOnboarding, PHASES } from "../contexts/OnboardingContext";
import { OnboardingLayout } from "./onboarding/OnboardingLayout";
import { PoseidonNarrator, DIALOGUE } from "./onboarding/PoseidonNarrator";
import { EchoStage } from "./onboarding/EchoStage";
import { IdentityStep } from "./onboarding/IdentityStep";
import { NameConfirmStep } from "./onboarding/NameConfirmStep";
import { SpotlightTour } from "./onboarding/SpotlightTour";
import { useCatalogHydration } from "../hooks/useCatalogHydration";

// Hard cap on the Echo-syncing hold so a slow/failed catalog hydration never
// blocks the final transition into the dashboard (Req 9.5, Property 6).
const CATALOG_HOLD_CAP_MS = 8000;

// Echo's hatchling art (served from /public) — reused on the syncing beat.
const ECHO_FRY = "/echo-fry.png";

// ─────────────────────────────────────────────────────────────────────────────
// Echo-syncing hold beat — companion-themed final transition (Req 8.4)
// Shown only while the catalog is still hydrating at the `complete` phase. It is
// deliberately NOT a progress bar: a calm "Echo syncing" moment instead.
// ─────────────────────────────────────────────────────────────────────────────
function EchoSyncingBeat() {
  return (
    <div
      className="onboarding-overlay onboarding-syncing"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "1rem",
      }}
    >
      <div className="echo-stage echo-stage--syncing">
        <div className="echo-tank-frame">
          <img
            className="echo-fry"
            src={ECHO_FRY}
            alt="Echo syncing with the reef"
            draggable={false}
          />
        </div>
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", textAlign: "center", maxWidth: "22rem" }}>
        {DIALOGUE.catalogSyncing}
      </p>
    </div>
  );
}

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
    hatchEcho,
    completeOnboarding,
  } = useOnboarding();

  // Kick off background catalog hydration on mount (Req 8.3). We only read
  // readiness to gate the FINAL transition; it never blocks earlier phases.
  const { catalogReady } = useCatalogHydration();

  const narratorRef = useRef(null);
  const phaseContainerRef = useRef(null);
  const [welcomeSent, setWelcomeSent] = useState(false);

  // ── Imperative narrate helper passed to child steps so their lines land in
  //    the shared Poseidon transcript (e.g. IdentityStep's retry copy).
  const narrate = useCallback(
    (text) => narratorRef.current?.addMessage(text) ?? Promise.resolve(),
    []
  );

  // ── Focus management: move focus to the phase container on transitions (Req 9.1)
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

  // ── Account resolved (IdentityStep advanced us here) → narrate success +
  //    prompt for the name (the NameConfirmStep input handles the entry). ────
  useEffect(() => {
    if (phase === PHASES.NAME_CONFIRM && account) {
      narratorRef.current?.say(DIALOGUE.walletSuccess, persona);
      const t = setTimeout(() => {
        narratorRef.current?.say(DIALOGUE.namePrompt, persona, 600);
      }, 900);
      return () => clearTimeout(t);
    }
    return undefined;
    // Only fire when the phase becomes nameConfirm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Hatch phase intro ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === PHASES.HATCH) {
      narratorRef.current?.say(DIALOGUE.echoIntro, persona, 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Egg untouched ~6s → Poseidon nudge (Req 2.3) ─────────────────────────
  const handleNudge = useCallback(() => {
    narratorRef.current?.say(DIALOGUE.echoNudge, null, 400);
  }, []);

  // ── Echo hatched → persist the companion (Req 2.4), narrate, then advance ─
  const handleHatch = useCallback(async () => {
    // Persist Echo's initial companion state. Idempotent + no-op pre-account
    // (Property 8 / Property 3); never blocks the flow on a Dexie hiccup.
    try {
      await hatchEcho();
    } catch (err) {
      console.warn("[onboarding] Echo companion persist failed:", err?.message);
    }
    await narratorRef.current?.say(DIALOGUE.echoTapped, persona, 800);
    advance(); // hatch → tourTank (hand off to the live-dashboard tour)
  }, [hatchEcho, persona, advance]);

  // ── Final transition: when the phase machine reaches `complete`, hold on the
  //    Echo-syncing beat until the catalog is ready, then persist completion and
  //    notify App via onComplete — EXACTLY ONCE (Req 8.4, 8.5). ───────────────
  const completedRef = useRef(false);
  const finalize = useCallback(async () => {
    if (completedRef.current) return;
    completedRef.current = true;
    await completeOnboarding(); // persist Supabase flag + Dexie mirror + cache
    if (typeof onComplete === "function") onComplete(casualMode);
  }, [completeOnboarding, onComplete, casualMode]);

  useEffect(() => {
    if (phase !== PHASES.COMPLETE) return undefined;

    // Catalog ready → transition straight into the dashboard.
    if (catalogReady) {
      finalize();
      return undefined;
    }

    // Catalog still hydrating → the render shows the Echo-syncing beat. Cap the
    // hold so a slow/failed hydration can't block completion (Req 9.5).
    const cap = setTimeout(() => {
      finalize();
    }, CATALOG_HOLD_CAP_MS);
    return () => clearTimeout(cap);
  }, [phase, catalogReady, finalize]);

  // ── Render branches ──────────────────────────────────────────────────────

  const isTourPhase = [
    PHASES.TOUR_TANK,
    PHASES.TOUR_FISH,
    PHASES.PROFILE_NUDGE,
  ].includes(phase);

  // TOUR PHASES: render only the spotlight overlay; App mounts the dashboard
  // beneath it (see App-contract note at the top of this file).
  if (isTourPhase) {
    return <SpotlightTour />;
  }

  // COMPLETE: hold on the companion-themed syncing beat until `finalize` runs
  // (immediately when the catalog is ready). App swaps to the dashboard once
  // onComplete fires and the gate re-resolves.
  if (phase === PHASES.COMPLETE) {
    return <EchoSyncingBeat />;
  }

  // ── IN-CARD PHASES: persona, identity, nameConfirm, hatch ────────────────

  const renderStage = () => {
    // The interactive egg only appears (and is hatchable) during the hatch phase.
    if (phase === PHASES.HATCH) {
      return <EchoStage onHatch={handleHatch} onNudge={handleNudge} />;
    }
    // Ambient tank backdrop for persona/identity/nameConfirm (Echo's home).
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
        return <IdentityStep narrate={narrate} />;

      case PHASES.NAME_CONFIRM:
        return <NameConfirmStep />;

      case PHASES.HATCH:
        return null; // EchoStage handles interaction in the stage pane

      default:
        return null;
    }
  };

  const narration = (
    <div
      className="onboarding-pane--narration"
      ref={phaseContainerRef}
      tabIndex={-1}
      style={{ outline: "none" }}
    >
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
