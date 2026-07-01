import React, { useState, useEffect } from "react";
import { MintSpecimen } from "./MintSpecimen";
import { SpecimenLineage } from "./SpecimenLineage";
import { SpawningWizard } from "./SpawningWizard";
import { SpawningDashboard } from "./SpawningDashboard";
import { GrowOutSection } from "./GrowOutSection";
import { MorphRegistration } from "./MorphRegistration";
import { GeneticsPrediction } from "./GeneticsPrediction";
import { COICalculator } from "./COICalculator";
import { BreederAchievements } from "./BreederAchievements";

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
}) {
  const [activeSection, setActiveSection] = useState(initialSection || "register");

  // Sync with external navigation (e.g. "View Lineage" from another tab)
  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  const sections = [
    { id: "register", icon: "✦", label: "Register" },
    { id: "lineage", icon: "🌿", label: "Lineage" },
    { id: "spawning", icon: "🥚", label: "Spawning" },
    { id: "genetics", icon: "🧬", label: "Genetics" },
    { id: "growout", icon: "📊", label: "Grow-Out" },
    { id: "morphs", icon: "🎨", label: "Morphs" },
    { id: "achievements", icon: "🏆", label: "Achievements" },
  ];

  return (
    <div>
      {/* Internal sub-navigation pills */}
      <div
        className="breeder-sub-nav"
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
              onClick={() => setActiveSection(section.id)}
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
              <span>{section.label}</span>
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
                setActiveSection("morphs");
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
