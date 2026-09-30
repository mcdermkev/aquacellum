import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Certificate,
  ClipboardText,
  TreeStructure,
  Egg,
  Dna,
  ChartLineUp,
  Palette,
  Trophy,
} from "@phosphor-icons/react";
import "./breeder/BreederDaylight.css";
import { MintSpecimen } from "./MintSpecimen";
import { SpecimenLineage } from "./SpecimenLineage";
import { SpawningWizard } from "./SpawningWizard";
import { SpawningDashboard } from "./SpawningDashboard";
import { GrowOutSection } from "./GrowOutSection";
import { MorphRegistration } from "./MorphRegistration";
import { GeneticsPrediction } from "./GeneticsPrediction";
import { COICalculator } from "./COICalculator";
import { BreederAchievements } from "./BreederAchievements";
import { BreedingProgramModal } from "./BreedingProgramModal";
import { useContractSpecies } from "../hooks/useSpeciesData";
import {
  getUnseenMorphUpdates,
  markMorphsViewed,
} from "../services/morphSubmissionsApi";

/**
 * BreederTools: the pro-mode breeding workspace. One page with a row of
 * section tabs (Register, Program, Lineage, Spawning, Genetics, Grow-Out,
 * Morphs, Achievements). Styled with the shared Daylight breeder sheet
 * (./breeder/BreederDaylight.css, `bd-*` classes).
 */
export function BreederTools({
  contractAddress,
  walletAccount,
  casualModeActive,
  preselectedTokenId,
  onSelectBreed,
  onSpawningComplete,
  initialSection,
  onSwitchToPro,
}) {
  const [activeSection, setActiveSection] = useState(initialSection || "register");
  const tabRefs = useRef({});
  // Lineage-first intake (docs/LINEAGE_FIRST_INTAKE_SPEC.md)
  const [isProgramOpen, setIsProgramOpen] = useState(false);
  const [programResult, setProgramResult] = useState(null);
  const { data: contractSpecies = [] } = useContractSpecies(contractAddress);

  // Sync with external navigation (e.g. "View Lineage" from another tab)
  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  // ─── Morph notification badge ─────────────────────────────────────────────
  const [morphBadgeCount, setMorphBadgeCount] = useState(0);

  const refreshMorphBadge = useCallback(async () => {
    if (!walletAccount) return;
    const { count } = await getUnseenMorphUpdates(walletAccount);
    setMorphBadgeCount(count);
  }, [walletAccount]);

  useEffect(() => {
    refreshMorphBadge();
  }, [refreshMorphBadge]);

  // When user navigates to Morphs, mark as viewed and clear badge
  const handleSectionChange = (sectionId) => {
    setActiveSection(sectionId);
    if (sectionId === "morphs") {
      markMorphsViewed();
      setMorphBadgeCount(0);
    }
  };

  // Also mark as viewed if we land on morphs via initialSection (deep-link)
  useEffect(() => {
    if (activeSection === "morphs") {
      markMorphsViewed();
      setMorphBadgeCount(0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = [
    { id: "register", Icon: Certificate, label: "Register" },
    { id: "program", Icon: ClipboardText, label: "Program" },
    { id: "lineage", Icon: TreeStructure, label: "Lineage" },
    { id: "spawning", Icon: Egg, label: "Spawning" },
    { id: "genetics", Icon: Dna, label: "Genetics" },
    { id: "growout", Icon: ChartLineUp, label: "Grow-Out" },
    { id: "morphs", Icon: Palette, label: "Morphs" },
    { id: "achievements", Icon: Trophy, label: "Achievements" },
  ];

  // Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern with
  // automatic activation: focusing a tab opens its section).
  const handleTabKeyDown = (event) => {
    const index = sections.findIndex((s) => s.id === activeSection);
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + sections.length) % sections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sections.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = sections[next].id;
    handleSectionChange(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <div className="bd">
      <header className="bd-head">
        <div className="bd-head-text">
          <p className="bd-kicker">Breeding</p>
          <h2 className="bd-title">Breeder Tools</h2>
          <p className="bd-subtitle">
            Register your fish, record spawns and lineage, and plan your next pairing.
          </p>
        </div>
      </header>

      {/* Mode-mismatch notice.
          Breeder Tools has no nav pill in Casual mode, but the route is still
          reachable, deliberately, because deep links to it are documented (the
          morph flow tells breeders to bookmark /app/breeder?section=morphs) and
          silently redirecting would break them. Mode is a self-service display
          preference, NOT an entitlement: nothing here is being withheld, so the
          honest move is to explain the mismatch and offer the switch rather than
          hide a working surface or pretend it's locked.
          See docs/BREEDER_STATE_MODEL.md §10. */}
      {casualModeActive && (
        <div className="bd-notice">
          <span>
            These are the <strong>Pro</strong> breeding tools. They work fine here,
            but there is no tab for them in the simpler view.
          </span>
          {onSwitchToPro && (
            <button type="button" className="bd-btn" onClick={onSwitchToPro}>
              Switch to Pro
            </button>
          )}
        </div>
      )}

      {/* Section tabs. Scrolls sideways on narrow screens. */}
      <div
        className="bd-tabs"
        role="tablist"
        aria-label="Breeder Tools sections"
        onKeyDown={handleTabKeyDown}
      >
        {sections.map(({ id, Icon, label }) => {
          const isActive = activeSection === id;
          const showDot = id === "morphs" && morphBadgeCount > 0;
          return (
            <button
              key={id}
              ref={(el) => { tabRefs.current[id] = el; }}
              type="button"
              role="tab"
              id={`bd-tab-${id}`}
              aria-selected={isActive}
              aria-controls="bd-panel"
              tabIndex={isActive ? 0 : -1}
              className="bd-tab"
              onClick={() => handleSectionChange(id)}
            >
              <Icon size={18} weight={isActive ? "fill" : "regular"} aria-hidden="true" />
              <span>{label}</span>
              {showDot && (
                <span
                  className="bd-tab-dot"
                  role="status"
                  aria-label={`${morphBadgeCount} new update${morphBadgeCount > 1 ? "s" : ""}`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="bd-panel" aria-labelledby={`bd-tab-${activeSection}`}>
        {activeSection === "register" && (
          <MintSpecimen
            contractAddress={contractAddress}
            walletAccount={walletAccount}
            casualModeActive={casualModeActive}
          />
        )}

        {activeSection === "program" && (
          <section className="bd-panel" aria-labelledby="bd-program-title">
            <h3 id="bd-program-title" className="bd-panel-title">Breeding program</h3>
            <p className="bd-panel-lead">
              {casualModeActive
                ? "Setting up? List the groups of fish you breed and we'll make a tank for each one and add its fish."
                : "New here, or moving a fishroom across? List the lines you keep and we'll build a tank for each line and register its fish in one pass, ready to spawn from."}
            </p>

            {programResult && (
              <p className="bd-success" role="status">
                Created {programResult.tankIds.length} tanks and {programResult.specimenIds.length} birth
                certificates. They're in My Aquariums, and you can pair them from the Spawning tab.
              </p>
            )}

            <button
              type="button"
              className="bd-btn bd-btn--primary"
              onClick={() => setIsProgramOpen(true)}
              style={{ marginTop: "1.25rem" }}
            >
              Declare your breeding program
            </button>
          </section>
        )}

        {activeSection === "lineage" && (
          <SpecimenLineage
            contractAddress={contractAddress}
            walletAccount={walletAccount}
            preselectedTokenId={preselectedTokenId}
            onSelectBreed={onSelectBreed}
          />
        )}

        {activeSection === "spawning" && (
          <>
            <SpawningDashboard walletAccount={walletAccount} />
            <SpawningWizard
              contractAddress={contractAddress}
              walletAccount={walletAccount}
              onComplete={(targetSection) => {
                if (targetSection === "morphs") {
                  handleSectionChange("morphs");
                } else if (onSpawningComplete) {
                  onSpawningComplete();
                }
              }}
              casualModeActive={casualModeActive}
            />
          </>
        )}

        {activeSection === "genetics" && (
          <>
            <GeneticsPrediction casualModeActive={casualModeActive} />
            <COICalculator contractAddress={contractAddress} walletAccount={walletAccount} />
          </>
        )}

        {activeSection === "growout" && (
          <GrowOutSection
            walletAccount={walletAccount}
            casualModeActive={casualModeActive}
          />
        )}

        {activeSection === "morphs" && (
          <MorphRegistration
            walletAccount={walletAccount}
            casualModeActive={casualModeActive}
            contractAddress={contractAddress}
          />
        )}

        {activeSection === "achievements" && (
          <BreederAchievements walletAccount={walletAccount} />
        )}
      </div>

      {isProgramOpen && (
        <BreedingProgramModal
          walletAccount={walletAccount}
          catalog={contractSpecies}
          casualModeActive={casualModeActive}
          onClose={() => setIsProgramOpen(false)}
          onCreated={(result) => setProgramResult(result)}
        />
      )}
    </div>
  );
}
