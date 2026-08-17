import React, { useState, useEffect, useCallback } from "react";
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
import { useScrollAffordance } from "../hooks/useScrollAffordance";
import {
  getUnseenMorphUpdates,
  markMorphsViewed,
} from "../services/morphSubmissionsApi";

/**
 * BreederTools — Combined pro-mode panel that unifies Register, Lineage, and
 * Spawning into a single tab with internal sub-navigation.
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
  const subNavScrollRef = useScrollAffordance();
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
    { id: "register", icon: "✦", label: "Register" },
    { id: "program", icon: "📋", label: "Program" },
    { id: "lineage", icon: "🌿", label: "Lineage" },
    { id: "spawning", icon: "🥚", label: "Spawning" },
    { id: "genetics", icon: "🧬", label: "Genetics" },
    { id: "growout", icon: "📊", label: "Grow-Out" },
    { id: "morphs", icon: "🎨", label: "Morphs" },
    { id: "achievements", icon: "🏆", label: "Achievements" },
  ];

  return (
    <div>
      {/* Mode-mismatch notice.
          Breeder Tools has no nav pill in Casual mode, but the route is still
          reachable — deliberately, because deep links to it are documented (the
          morph flow tells breeders to bookmark /app/breeder?section=morphs) and
          silently redirecting would break them. Mode is a self-service display
          preference, NOT an entitlement: nothing here is being withheld, so the
          honest move is to explain the mismatch and offer the switch rather than
          hide a working surface or pretend it's locked.
          See docs/BREEDER_STATE_MODEL.md §10. */}
      {casualModeActive && (
        <div
          className="glass-card"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: "1rem", flexWrap: "wrap", padding: "0.75rem 1.1rem", marginBottom: "1rem",
            border: "1px solid rgba(168, 85, 247, 0.22)", background: "rgba(168, 85, 247, 0.04)",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            These are the <strong style={{ color: "#fff" }}>Pro</strong> breeding tools. They work
            just fine here, but you won't see a tab for them while you're in the simpler view.
          </span>
          {onSwitchToPro && (
            <button
              className="btn-secondary"
              onClick={onSwitchToPro}
              style={{ fontSize: "0.75rem", padding: "0.4rem 0.9rem", whiteSpace: "nowrap" }}
            >
              Switch to Pro
            </button>
          )}
        </div>
      )}

      {/* Internal sub-navigation pills.
          `.scroll-fade` only engages on mobile, where the media query switches
          this to width:100% + overflow-x:auto and hides the scrollbar. Its own
          border is faint (0.12 alpha) so the mask softening it at the edges reads
          as intentional rather than as a rendering fault. */}
      <div
        className="breeder-sub-nav scroll-fade"
        ref={subNavScrollRef}
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          padding: "0.35rem",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(168, 85, 247, 0.12)",
          borderRadius: "12px",
          width: "fit-content",
        }}
      >
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => handleSectionChange(section.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1rem",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: isActive ? "600" : "400",
                color: isActive ? "#fff" : "var(--text-muted)",
                background: isActive
                  ? "linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(124, 58, 237, 0.2) 100%)"
                  : "transparent",
                boxShadow: isActive
                  ? "0 0 12px rgba(168, 85, 247, 0.15)"
                  : "none",
                transition: "all 0.2s ease",
              }}
              aria-current={isActive ? "true" : undefined}
            >
              <span>{section.icon}</span>
              <span style={{ position: "relative" }}>
                {section.label}
                {section.id === "morphs" && morphBadgeCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-4px",
                      right: "-10px",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "var(--accent-green, #34d399)",
                      boxShadow: "0 0 6px rgba(52, 211, 153, 0.6)",
                    }}
                    aria-label={`${morphBadgeCount} new update${morphBadgeCount > 1 ? "s" : ""}`}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Section content */}
      {activeSection === "register" && (
        <MintSpecimen
          contractAddress={contractAddress}
          walletAccount={walletAccount}
          casualModeActive={casualModeActive}
        />
      )}

      {activeSection === "program" && (
        <div className="glass-card" style={{ padding: "2rem", maxWidth: "680px", margin: "0 auto" }}>
          <h2 style={{ fontSize: "1.5rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            📋 Breeding program
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", lineHeight: 1.6, marginTop: "0.5rem" }}>
            {casualModeActive
              ? "Setting up? List the groups of fish you breed and we'll make a tank for each one and add its fish."
              : "New here, or moving a fishroom across? Declare the lines you keep and we'll build the tanks and register the stock in one pass — grouped by line, ready to spawn from."}
          </p>

          {programResult && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem 0.9rem",
                borderRadius: "var(--radius-sm)",
                background: "rgba(52, 211, 153, 0.08)",
                border: "1px solid rgba(52, 211, 153, 0.25)",
                fontSize: "0.8rem",
                color: "var(--text-secondary)",
              }}
            >
              ✓ Created {programResult.tankIds.length} tanks and {programResult.specimenIds.length} birth certificates.
              They're in My Aquariums, and you can pair them from the Spawning tab.
            </div>
          )}

          <button
            className="btn-primary"
            onClick={() => setIsProgramOpen(true)}
            style={{ marginTop: "1.25rem" }}
          >
            Declare your breeding program
          </button>
        </div>
      )}

      {isProgramOpen && (
        <BreedingProgramModal
          walletAccount={walletAccount}
          catalog={contractSpecies}
          casualModeActive={casualModeActive}
          onClose={() => setIsProgramOpen(false)}
          onCreated={(result) => setProgramResult(result)}
        />
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
  );
}
