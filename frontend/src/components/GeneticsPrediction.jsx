import React, { useState, useMemo } from "react";
import { ScrollFade } from "./ScrollFade";

/**
 * GeneticsPrediction — Interactive genetics calculator for aquarium fish breeding.
 *
 * Takes sire and dam trait selections and computes predicted offspring trait
 * probabilities using simplified Mendelian genetics (single-gene dominance model).
 * Displays results as a visual Punnett square grid with probability bars.
 *
 * Supported inheritance modes:
 * - Simple recessive (albino, melanistic)
 * - Simple dominant (longfin, veiltail)
 * - Codominant / incomplete dominance (metallic)
 */

// ─── Trait Genetics Database ────────────────────────────────────────────────
//
// Now one list, in utils/traitVocabulary.js (§9.13). It was written out four times
// across this file and SpawningWizard, and a trait added to one copy but not another
// failed SILENTLY — see that module's header for the specific failure.
//
// Re-exported under the original name because this is where the calculator's readers
// expect it, and renaming it would touch call sites for no gain.
export { HERITABLE_TRAITS as TRAIT_GENETICS } from "../utils/traitVocabulary";
import { HERITABLE_TRAITS as TRAIT_GENETICS } from "../utils/traitVocabulary";

// Genotype options per parent
const GENOTYPE_OPTIONS = {
  recessive: [
    { value: "homozygous_dominant", label: "Wild (+/+)", shortLabel: "+/+" },
    { value: "heterozygous", label: "Carrier (+/−)", shortLabel: "+/−" },
    { value: "homozygous_recessive", label: "Expressing (−/−)", shortLabel: "−/−" },
  ],
  dominant: [
    { value: "homozygous_wild", label: "Wild (+/+)", shortLabel: "+/+" },
    { value: "heterozygous", label: "Heterozygous (T/+)", shortLabel: "T/+" },
    { value: "homozygous_trait", label: "Homozygous (T/T)", shortLabel: "T/T" },
  ],
  codominant: [
    { value: "homozygous_wild", label: "No expression (+/+)", shortLabel: "+/+" },
    { value: "heterozygous", label: "Partial (M/+)", shortLabel: "M/+" },
    { value: "homozygous_trait", label: "Full expression (M/M)", shortLabel: "M/M" },
  ],
};

// ─── Punnett Square Calculator ──────────────────────────────────────────────
function calculatePunnett(sireGenotype, damGenotype, inheritance) {
  // Convert genotype to alleles
  const getAlleles = (genotype, inheritance) => {
    if (inheritance === "recessive") {
      switch (genotype) {
        case "homozygous_dominant": return ["+", "+"];
        case "heterozygous": return ["+", "−"];
        case "homozygous_recessive": return ["−", "−"];
        default: return ["+", "+"];
      }
    } else {
      // dominant and codominant
      switch (genotype) {
        case "homozygous_wild": return ["+", "+"];
        case "heterozygous": return ["T", "+"];
        case "homozygous_trait": return ["T", "T"];
        default: return ["+", "+"];
      }
    }
  };

  const sireAlleles = getAlleles(sireGenotype, inheritance);
  const damAlleles = getAlleles(damGenotype, inheritance);

  // Generate 2x2 Punnett grid
  const grid = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      grid.push([sireAlleles[i], damAlleles[j]]);
    }
  }

  // Calculate phenotype outcomes
  const outcomes = grid.map(([a1, a2]) => {
    const sorted = [a1, a2].sort().join("/");
    if (inheritance === "recessive") {
      if (a1 === "−" && a2 === "−") return { genotype: "−/−", phenotype: "Expressing", type: "expressing" };
      if (a1 === "+" && a2 === "+") return { genotype: "+/+", phenotype: "Wild-type", type: "wild" };
      return { genotype: "+/−", phenotype: "Carrier (wild appearance)", type: "carrier" };
    } else if (inheritance === "dominant") {
      if (a1 === "+" && a2 === "+") return { genotype: "+/+", phenotype: "Wild-type", type: "wild" };
      if ((a1 === "T" && a2 === "T")) return { genotype: "T/T", phenotype: "Homozygous (double dose)", type: "homozygous" };
      return { genotype: "T/+", phenotype: "Expressing (heterozygous)", type: "expressing" };
    } else {
      // codominant
      if (a1 === "+" && a2 === "+") return { genotype: "+/+", phenotype: "No expression", type: "wild" };
      if (a1 === "T" && a2 === "T") return { genotype: "M/M", phenotype: "Full expression", type: "homozygous" };
      return { genotype: "M/+", phenotype: "Partial expression", type: "partial" };
    }
  });

  // Tally probabilities
  const summary = {};
  for (const outcome of outcomes) {
    const key = outcome.genotype;
    if (!summary[key]) {
      summary[key] = { ...outcome, count: 0 };
    }
    summary[key].count++;
  }

  return {
    sireAlleles,
    damAlleles,
    grid: outcomes,
    summary: Object.values(summary).map(s => ({
      ...s,
      probability: (s.count / 4) * 100,
      ratio: s.count,
    })),
  };
}

// ─── Punnett Square Grid Visual ─────────────────────────────────────────────
function PunnettGrid({ result, traitColor }) {
  const typeColors = {
    wild: "rgba(107, 114, 128, 0.15)",
    carrier: "rgba(251, 191, 36, 0.12)",
    expressing: "rgba(52, 211, 153, 0.18)",
    homozygous: "rgba(168, 85, 247, 0.18)",
    partial: "rgba(96, 165, 250, 0.15)",
  };

  const typeTextColors = {
    wild: "#9ca3af",
    carrier: "#fbbf24",
    expressing: "#34d399",
    homozygous: "#a855f7",
    partial: "#60a5fa",
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      {/* Header row: Dam alleles */}
      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: "4px", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted, #6b7280)", fontWeight: "700" }}>
            Sire ↓ Dam →
          </span>
        </div>
        {result.damAlleles.map((allele, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "6px", borderRadius: "6px",
            background: "rgba(244, 114, 182, 0.08)",
            border: "1px solid rgba(244, 114, 182, 0.2)",
          }}>
            <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#f472b6", fontFamily: "'JetBrains Mono', monospace" }}>
              {allele}
            </span>
          </div>
        ))}
      </div>

      {/* Grid rows */}
      {[0, 1].map((row) => (
        <div key={row} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: "4px", marginBottom: "4px" }}>
          {/* Sire allele label */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "6px", borderRadius: "6px",
            background: "rgba(96, 165, 250, 0.08)",
            border: "1px solid rgba(96, 165, 250, 0.2)",
          }}>
            <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#60a5fa", fontFamily: "'JetBrains Mono', monospace" }}>
              {result.sireAlleles[row]}
            </span>
          </div>
          {/* Outcome cells */}
          {[0, 1].map((col) => {
            const idx = row * 2 + col;
            const outcome = result.grid[idx];
            return (
              <div key={col} style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "10px 8px", borderRadius: "8px",
                background: typeColors[outcome.type],
                border: `1px solid ${typeTextColors[outcome.type]}33`,
                transition: "transform 0.2s, box-shadow 0.2s",
                cursor: "default",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = `0 4px 12px ${typeColors[outcome.type]}`; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <span style={{ fontSize: "0.85rem", fontWeight: "700", color: typeTextColors[outcome.type], fontFamily: "'JetBrains Mono', monospace" }}>
                  {outcome.genotype}
                </span>
                <span style={{ fontSize: "0.62rem", color: "var(--text-muted, #6b7280)", marginTop: "2px", textAlign: "center" }}>
                  {outcome.phenotype}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Probability Bars ───────────────────────────────────────────────────────
function ProbabilityBars({ summary, traitColor }) {
  const typeTextColors = {
    wild: "#9ca3af",
    carrier: "#fbbf24",
    expressing: "#34d399",
    homozygous: "#a855f7",
    partial: "#60a5fa",
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
        Offspring Probability
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {summary.map((item) => (
          <div key={item.genotype} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "50px", textAlign: "right" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: "700", color: typeTextColors[item.type], fontFamily: "'JetBrains Mono', monospace" }}>
                {item.probability}%
              </span>
            </div>
            <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.04)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${item.probability}%`,
                background: `linear-gradient(90deg, ${typeTextColors[item.type]}99, ${typeTextColors[item.type]}55)`,
                borderRadius: "4px",
                transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
              }} />
            </div>
            <div style={{ minWidth: "140px" }}>
              <span style={{ fontSize: "0.72rem", color: "#e0e0e0" }}>{item.phenotype}</span>
              <span style={{ fontSize: "0.62rem", color: "var(--text-muted, #6b7280)", marginLeft: "6px" }}>
                ({item.ratio}:4)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dihybrid Punnett Square Calculator ─────────────────────────────────────
function calculateDihybrid(sireGeno1, damGeno1, inheritance1, sireGeno2, damGeno2, inheritance2) {
  const getAlleles = (genotype, inheritance) => {
    if (inheritance === "recessive") {
      switch (genotype) {
        case "homozygous_dominant": return ["+", "+"];
        case "heterozygous": return ["+", "−"];
        case "homozygous_recessive": return ["−", "−"];
        default: return ["+", "+"];
      }
    } else {
      switch (genotype) {
        case "homozygous_wild": return ["+", "+"];
        case "heterozygous": return ["T", "+"];
        case "homozygous_trait": return ["T", "T"];
        default: return ["+", "+"];
      }
    }
  };

  const sireAlleles1 = getAlleles(sireGeno1, inheritance1);
  const damAlleles1 = getAlleles(damGeno1, inheritance1);
  const sireAlleles2 = getAlleles(sireGeno2, inheritance2);
  const damAlleles2 = getAlleles(damGeno2, inheritance2);

  // Sire gametes: combine one allele from each trait (2×2 = 4 gametes)
  const sireGametes = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      sireGametes.push({ a1: sireAlleles1[i], a2: sireAlleles2[j] });
    }
  }

  // Dam gametes
  const damGametes = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      damGametes.push({ a1: damAlleles1[i], a2: damAlleles2[j] });
    }
  }

  // 4×4 grid of offspring (16 cells)
  const grid = [];
  for (let s = 0; s < 4; s++) {
    for (let d = 0; d < 4; d++) {
      const offspringTrait1 = [sireGametes[s].a1, damGametes[d].a1];
      const offspringTrait2 = [sireGametes[s].a2, damGametes[d].a2];
      grid.push({ trait1: offspringTrait1, trait2: offspringTrait2 });
    }
  }

  // Determine phenotype for a single trait pair
  const getPhenotype = (alleles, inheritance) => {
    const [a1, a2] = alleles;
    if (inheritance === "recessive") {
      if (a1 === "−" && a2 === "−") return { genotype: "−/−", phenotype: "Expressing", type: "expressing" };
      if (a1 === "+" && a2 === "+") return { genotype: "+/+", phenotype: "Wild", type: "wild" };
      return { genotype: "+/−", phenotype: "Carrier", type: "carrier" };
    } else if (inheritance === "dominant") {
      if (a1 === "+" && a2 === "+") return { genotype: "+/+", phenotype: "Wild", type: "wild" };
      if (a1 === "T" && a2 === "T") return { genotype: "T/T", phenotype: "Homozygous", type: "homozygous" };
      return { genotype: "T/+", phenotype: "Expressing", type: "expressing" };
    } else {
      if (a1 === "+" && a2 === "+") return { genotype: "+/+", phenotype: "None", type: "wild" };
      if (a1 === "T" && a2 === "T") return { genotype: "M/M", phenotype: "Full", type: "homozygous" };
      return { genotype: "M/+", phenotype: "Partial", type: "partial" };
    }
  };

  // Resolve each cell
  const outcomes = grid.map((cell) => {
    const p1 = getPhenotype(cell.trait1, inheritance1);
    const p2 = getPhenotype(cell.trait2, inheritance2);
    return {
      trait1: p1,
      trait2: p2,
      combinedGenotype: `${p1.genotype} ; ${p2.genotype}`,
      combinedPhenotype: `${p1.phenotype} + ${p2.phenotype}`,
    };
  });

  // Tally combined phenotype probabilities
  const summary = {};
  for (const o of outcomes) {
    const key = o.combinedPhenotype;
    if (!summary[key]) {
      summary[key] = { ...o, count: 0 };
    }
    summary[key].count++;
  }

  return {
    sireGametes,
    damGametes,
    grid: outcomes,
    summary: Object.values(summary)
      .map((s) => ({ ...s, probability: (s.count / 16) * 100, ratio: s.count }))
      .sort((a, b) => b.probability - a.probability),
  };
}

// ─── Dihybrid Grid Visual ───────────────────────────────────────────────────
function DihybridGrid({ result, trait1, trait2 }) {
  const typeTextColors = {
    wild: "#9ca3af",
    carrier: "#fbbf24",
    expressing: "#34d399",
    homozygous: "#a855f7",
    partial: "#60a5fa",
  };

  const typeColors = {
    wild: "rgba(107, 114, 128, 0.12)",
    carrier: "rgba(251, 191, 36, 0.10)",
    expressing: "rgba(52, 211, 153, 0.14)",
    homozygous: "rgba(168, 85, 247, 0.14)",
    partial: "rgba(96, 165, 250, 0.12)",
  };

  // Format gamete label
  const formatGamete = (gamete) => `${gamete.a1}${gamete.a2}`;

  return (
    // No border of its own, so the fade goes straight on the scroller. Focusable
    // because the grid cells are static text — without it the square cannot be
    // scrolled by keyboard at all.
    <ScrollFade
      table
      focusable
      role="group"
      aria-label="Punnett square — scroll sideways for more columns"
      style={{ marginTop: "1rem", overflowX: "auto" }}
    >
      {/* Header row: Dam gametes */}
      <div style={{ display: "grid", gridTemplateColumns: "70px repeat(4, 1fr)", gap: "3px", marginBottom: "3px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "0.55rem", color: "var(--text-muted, #6b7280)", fontWeight: "700", textAlign: "center" }}>
            Sire ↓<br />Dam →
          </span>
        </div>
        {result.damGametes.map((gamete, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "5px 3px", borderRadius: "5px",
            background: "rgba(244, 114, 182, 0.06)",
            border: "1px solid rgba(244, 114, 182, 0.15)",
          }}>
            <span style={{ fontSize: "0.65rem", fontWeight: "700", color: "#f472b6", fontFamily: "'JetBrains Mono', monospace" }}>
              {formatGamete(gamete)}
            </span>
          </div>
        ))}
      </div>

      {/* Grid rows (4 rows) */}
      {[0, 1, 2, 3].map((row) => (
        <div key={row} style={{ display: "grid", gridTemplateColumns: "70px repeat(4, 1fr)", gap: "3px", marginBottom: "3px" }}>
          {/* Sire gamete label */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "5px 3px", borderRadius: "5px",
            background: "rgba(96, 165, 250, 0.06)",
            border: "1px solid rgba(96, 165, 250, 0.15)",
          }}>
            <span style={{ fontSize: "0.65rem", fontWeight: "700", color: "#60a5fa", fontFamily: "'JetBrains Mono', monospace" }}>
              {formatGamete(result.sireGametes[row])}
            </span>
          </div>
          {/* 4 outcome cells per row */}
          {[0, 1, 2, 3].map((col) => {
            const idx = row * 4 + col;
            const outcome = result.grid[idx];
            // Use trait1 type for background color priority
            const bgColor = typeColors[outcome.trait1.type] || typeColors.wild;
            const t1Color = typeTextColors[outcome.trait1.type] || "#9ca3af";
            const t2Color = typeTextColors[outcome.trait2.type] || "#9ca3af";
            return (
              <div key={col} style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "6px 4px", borderRadius: "6px",
                background: bgColor,
                border: `1px solid ${t1Color}22`,
                transition: "transform 0.2s, box-shadow 0.2s",
                cursor: "default", minHeight: "48px",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.04)"; e.currentTarget.style.boxShadow = `0 3px 10px ${bgColor}`; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <span style={{ fontSize: "0.6rem", fontWeight: "700", color: t1Color, fontFamily: "'JetBrains Mono', monospace" }}>
                  {outcome.trait1.genotype}
                </span>
                <span style={{ fontSize: "0.6rem", fontWeight: "700", color: t2Color, fontFamily: "'JetBrains Mono', monospace", marginTop: "1px" }}>
                  {outcome.trait2.genotype}
                </span>
                <span style={{ fontSize: "0.5rem", color: "var(--text-muted, #6b7280)", marginTop: "2px", textAlign: "center", lineHeight: "1.2" }}>
                  {outcome.trait1.phenotype}
                  <br />
                  {outcome.trait2.phenotype}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px", padding: "6px 8px", borderRadius: "6px", background: "rgba(255,255,255,0.02)" }}>
        <span style={{ fontSize: "0.58rem", color: "var(--text-muted, #6b7280)", fontWeight: "600" }}>Key:</span>
        <span style={{ fontSize: "0.58rem", color: trait1.color, fontWeight: "600" }}>Top = {trait1.label}</span>
        <span style={{ fontSize: "0.58rem", color: trait2.color, fontWeight: "600" }}>Bottom = {trait2.label}</span>
      </div>
    </ScrollFade>
  );
}

// ─── Dihybrid Probability Summary ───────────────────────────────────────────
function DihybridProbabilityBars({ summary, trait1, trait2 }) {
  const typeTextColors = {
    wild: "#9ca3af",
    carrier: "#fbbf24",
    expressing: "#34d399",
    homozygous: "#a855f7",
    partial: "#60a5fa",
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
        Combined Offspring Outcomes
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {summary.map((item, i) => {
          const barColor = typeTextColors[item.trait1.type] || "#9ca3af";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "46px", textAlign: "right" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: "700", color: barColor, fontFamily: "'JetBrains Mono', monospace" }}>
                  {item.probability.toFixed(1)}%
                </span>
              </div>
              <div style={{ flex: 1, height: "7px", background: "rgba(255,255,255,0.04)", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${item.probability}%`,
                  background: `linear-gradient(90deg, ${barColor}99, ${barColor}44)`,
                  borderRadius: "4px",
                  transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                }} />
              </div>
              <div style={{ minWidth: "180px" }}>
                <span style={{ fontSize: "0.65rem", color: "#e0e0e0" }}>{item.combinedPhenotype}</span>
                <span style={{ fontSize: "0.58rem", color: "var(--text-muted, #6b7280)", marginLeft: "6px" }}>
                  ({item.ratio}/16)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function GeneticsPrediction({ casualModeActive = false }) {
  const [mode, setMode] = useState("monohybrid"); // "monohybrid" | "dihybrid"
  const [selectedTrait, setSelectedTrait] = useState(TRAIT_GENETICS[0].id);
  const [selectedTrait2, setSelectedTrait2] = useState(TRAIT_GENETICS[1].id);
  const [sireGenotype, setSireGenotype] = useState("heterozygous");
  const [damGenotype, setDamGenotype] = useState("heterozygous");
  const [sireGenotype2, setSireGenotype2] = useState("heterozygous");
  const [damGenotype2, setDamGenotype2] = useState("heterozygous");

  const trait = TRAIT_GENETICS.find((t) => t.id === selectedTrait);
  const trait2 = TRAIT_GENETICS.find((t) => t.id === selectedTrait2);
  const genotypeOptions = GENOTYPE_OPTIONS[trait.inheritance];
  const genotypeOptions2 = GENOTYPE_OPTIONS[trait2.inheritance];

  const result = useMemo(
    () => calculatePunnett(sireGenotype, damGenotype, trait.inheritance),
    [sireGenotype, damGenotype, trait.inheritance]
  );

  const dihybridResult = useMemo(
    () => calculateDihybrid(sireGenotype, damGenotype, trait.inheritance, sireGenotype2, damGenotype2, trait2.inheritance),
    [sireGenotype, damGenotype, trait.inheritance, sireGenotype2, damGenotype2, trait2.inheritance]
  );

  return (
    <div style={{ marginTop: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff", margin: "0 0 0.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>🧬</span> Genetics Prediction Calculator
        </h3>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #6b7280)", margin: 0, lineHeight: "1.5" }}>
          {casualModeActive
            ? "Select traits for both parents to see what their babies might look like. This uses basic inheritance rules to predict outcomes."
            : "Model single-gene Mendelian inheritance for known traits. Select parental genotypes to generate a Punnett square with offspring phenotype probabilities."}
        </p>
      </div>

      {/* Mode Toggle: Monohybrid / Dihybrid */}
      <div style={{
        display: "flex", gap: "4px", marginBottom: "1.25rem",
        padding: "4px", background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(139, 92, 246, 0.12)", borderRadius: "10px",
        width: "fit-content",
      }}>
        {[
          { id: "monohybrid", label: casualModeActive ? "1 Trait (2×2)" : "Monohybrid (2×2)" },
          { id: "dihybrid", label: casualModeActive ? "2 Traits (4×4)" : "Dihybrid (4×4)" },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            style={{
              padding: "7px 14px", borderRadius: "7px", fontSize: "0.75rem", fontWeight: "600",
              color: mode === m.id ? "#fff" : "var(--text-muted, #6b7280)",
              background: mode === m.id ? "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(99, 102, 241, 0.2))" : "transparent",
              border: mode === m.id ? "1px solid rgba(139, 92, 246, 0.4)" : "1px solid transparent",
              boxShadow: mode === m.id ? "0 0 10px rgba(139, 92, 246, 0.15)" : "none",
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Trait 1 Selector */}
      <div style={{ marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", display: "block" }}>
          {mode === "dihybrid" ? "Trait 1" : "Select Trait"}
        </span>
        <div style={{
          display: "flex", gap: "6px", flexWrap: "wrap",
          padding: "0.5rem", background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(139, 92, 246, 0.1)", borderRadius: "10px",
        }}>
          {TRAIT_GENETICS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setSelectedTrait(t.id); setSireGenotype("heterozygous"); setDamGenotype("heterozygous"); }}
              style={{
                padding: "6px 12px", borderRadius: "8px", fontSize: "0.72rem", fontWeight: "600",
                color: selectedTrait === t.id ? "#fff" : "var(--text-muted, #6b7280)",
                background: selectedTrait === t.id ? `${t.color}22` : "transparent",
                border: `1px solid ${selectedTrait === t.id ? `${t.color}55` : "transparent"}`,
                cursor: "pointer", transition: "all 0.2s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trait 2 Selector (Dihybrid only) */}
      {mode === "dihybrid" && (
        <div style={{ marginBottom: "1.25rem" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", display: "block" }}>
            Trait 2
          </span>
          <div style={{
            display: "flex", gap: "6px", flexWrap: "wrap",
            padding: "0.5rem", background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(52, 211, 153, 0.1)", borderRadius: "10px",
          }}>
            {TRAIT_GENETICS.filter((t) => t.id !== selectedTrait).map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelectedTrait2(t.id); setSireGenotype2("heterozygous"); setDamGenotype2("heterozygous"); }}
                style={{
                  padding: "6px 12px", borderRadius: "8px", fontSize: "0.72rem", fontWeight: "600",
                  color: selectedTrait2 === t.id ? "#fff" : "var(--text-muted, #6b7280)",
                  background: selectedTrait2 === t.id ? `${t.color}22` : "transparent",
                  border: `1px solid ${selectedTrait2 === t.id ? `${t.color}55` : "transparent"}`,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trait Info Banner(s) */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div style={{
          flex: 1, minWidth: "200px",
          padding: "0.75rem 1rem", borderRadius: "8px",
          background: `${trait.color}08`, border: `1px solid ${trait.color}22`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", fontWeight: "700",
              padding: "2px 8px", borderRadius: "4px",
              background: `${trait.color}15`, color: trait.color,
              border: `1px solid ${trait.color}33`,
            }}>
              {trait.symbol}
            </span>
            <span style={{ fontSize: "0.72rem", fontWeight: "600", color: "#e0e0e0" }}>
              {trait.inheritance === "recessive" ? "Autosomal Recessive" : trait.inheritance === "dominant" ? "Autosomal Dominant" : "Codominant / Incomplete Dominance"}
            </span>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)", margin: 0, lineHeight: "1.5" }}>
            {trait.description}
          </p>
        </div>
        {mode === "dihybrid" && (
          <div style={{
            flex: 1, minWidth: "200px",
            padding: "0.75rem 1rem", borderRadius: "8px",
            background: `${trait2.color}08`, border: `1px solid ${trait2.color}22`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", fontWeight: "700",
                padding: "2px 8px", borderRadius: "4px",
                background: `${trait2.color}15`, color: trait2.color,
                border: `1px solid ${trait2.color}33`,
              }}>
                {trait2.symbol}
              </span>
              <span style={{ fontSize: "0.72rem", fontWeight: "600", color: "#e0e0e0" }}>
                {trait2.inheritance === "recessive" ? "Autosomal Recessive" : trait2.inheritance === "dominant" ? "Autosomal Dominant" : "Codominant / Incomplete Dominance"}
              </span>
            </div>
            <p style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)", margin: 0, lineHeight: "1.5" }}>
              {trait2.description}
            </p>
          </div>
        )}
      </div>

      {/* Parent Genotype Selectors — Trait 1 */}
      <div style={{ marginBottom: mode === "dihybrid" ? "0.5rem" : "1rem" }}>
        {mode === "dihybrid" && (
          <span style={{ fontSize: "0.65rem", fontWeight: "700", color: trait.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", display: "block" }}>
            {trait.label} Genotypes
          </span>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          {/* Sire */}
          <div style={{
            padding: "1rem", borderRadius: "10px",
            background: "rgba(96, 165, 250, 0.04)",
            border: "1px solid rgba(96, 165, 250, 0.15)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
              <div style={{
                width: "24px", height: "24px", borderRadius: "50%",
                background: "linear-gradient(135deg, #60a5fa, #3b82f6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.6rem", fontWeight: "700", color: "#fff",
              }}>♂</div>
              <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#60a5fa" }}>
                {casualModeActive ? "Dad" : "Sire"} Genotype
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {genotypeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSireGenotype(opt.value)}
                  style={{
                    padding: "8px 10px", borderRadius: "6px", fontSize: "0.75rem",
                    textAlign: "left", cursor: "pointer", transition: "all 0.2s",
                    color: sireGenotype === opt.value ? "#fff" : "var(--text-muted, #6b7280)",
                    background: sireGenotype === opt.value ? "rgba(96, 165, 250, 0.15)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${sireGenotype === opt.value ? "rgba(96, 165, 250, 0.4)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", marginRight: "6px", fontWeight: "600" }}>{opt.shortLabel}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dam */}
          <div style={{
            padding: "1rem", borderRadius: "10px",
            background: "rgba(244, 114, 182, 0.04)",
            border: "1px solid rgba(244, 114, 182, 0.15)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
              <div style={{
                width: "24px", height: "24px", borderRadius: "50%",
                background: "linear-gradient(135deg, #f472b6, #a855f7)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.6rem", fontWeight: "700", color: "#fff",
              }}>♀</div>
              <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#f472b6" }}>
                {casualModeActive ? "Mom" : "Dam"} Genotype
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {genotypeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDamGenotype(opt.value)}
                  style={{
                    padding: "8px 10px", borderRadius: "6px", fontSize: "0.75rem",
                    textAlign: "left", cursor: "pointer", transition: "all 0.2s",
                    color: damGenotype === opt.value ? "#fff" : "var(--text-muted, #6b7280)",
                    background: damGenotype === opt.value ? "rgba(244, 114, 182, 0.15)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${damGenotype === opt.value ? "rgba(244, 114, 182, 0.4)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", marginRight: "6px", fontWeight: "600" }}>{opt.shortLabel}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Parent Genotype Selectors — Trait 2 (Dihybrid only) */}
      {mode === "dihybrid" && (
        <div style={{ marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: "700", color: trait2.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", display: "block" }}>
            {trait2.label} Genotypes
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* Sire Trait 2 */}
            <div style={{
              padding: "1rem", borderRadius: "10px",
              background: "rgba(96, 165, 250, 0.04)",
              border: `1px solid ${trait2.color}22`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                <div style={{
                  width: "24px", height: "24px", borderRadius: "50%",
                  background: "linear-gradient(135deg, #60a5fa, #3b82f6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.6rem", fontWeight: "700", color: "#fff",
                }}>♂</div>
                <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#60a5fa" }}>
                  {casualModeActive ? "Dad" : "Sire"} — {trait2.symbol}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {genotypeOptions2.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSireGenotype2(opt.value)}
                    style={{
                      padding: "8px 10px", borderRadius: "6px", fontSize: "0.75rem",
                      textAlign: "left", cursor: "pointer", transition: "all 0.2s",
                      color: sireGenotype2 === opt.value ? "#fff" : "var(--text-muted, #6b7280)",
                      background: sireGenotype2 === opt.value ? "rgba(96, 165, 250, 0.15)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${sireGenotype2 === opt.value ? "rgba(96, 165, 250, 0.4)" : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", marginRight: "6px", fontWeight: "600" }}>{opt.shortLabel}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dam Trait 2 */}
            <div style={{
              padding: "1rem", borderRadius: "10px",
              background: "rgba(244, 114, 182, 0.04)",
              border: `1px solid ${trait2.color}22`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                <div style={{
                  width: "24px", height: "24px", borderRadius: "50%",
                  background: "linear-gradient(135deg, #f472b6, #a855f7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.6rem", fontWeight: "700", color: "#fff",
                }}>♀</div>
                <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "#f472b6" }}>
                  {casualModeActive ? "Mom" : "Dam"} — {trait2.symbol}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {genotypeOptions2.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDamGenotype2(opt.value)}
                    style={{
                      padding: "8px 10px", borderRadius: "6px", fontSize: "0.75rem",
                      textAlign: "left", cursor: "pointer", transition: "all 0.2s",
                      color: damGenotype2 === opt.value ? "#fff" : "var(--text-muted, #6b7280)",
                      background: damGenotype2 === opt.value ? "rgba(244, 114, 182, 0.15)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${damGenotype2 === opt.value ? "rgba(244, 114, 182, 0.4)" : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", marginRight: "6px", fontWeight: "600" }}>{opt.shortLabel}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results: Punnett Square + Probability Bars */}
      <div style={{
        padding: "1.25rem", borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(139, 92, 246, 0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {mode === "dihybrid" ? "Dihybrid Punnett Square (4×4)" : "Punnett Square"}
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            <span style={{
              fontSize: "0.62rem", padding: "3px 8px", borderRadius: "10px",
              background: "rgba(52, 211, 153, 0.08)", border: "1px solid rgba(52, 211, 153, 0.2)",
              color: "#34d399", fontWeight: "600",
            }}>
              {trait.label}
            </span>
            {mode === "dihybrid" && (
              <span style={{
                fontSize: "0.62rem", padding: "3px 8px", borderRadius: "10px",
                background: `${trait2.color}11`, border: `1px solid ${trait2.color}33`,
                color: trait2.color, fontWeight: "600",
              }}>
                {trait2.label}
              </span>
            )}
          </div>
        </div>

        {mode === "monohybrid" ? (
          <>
            <PunnettGrid result={result} traitColor={trait.color} />
            <ProbabilityBars summary={result.summary} traitColor={trait.color} />
          </>
        ) : (
          <>
            <DihybridGrid result={dihybridResult} trait1={trait} trait2={trait2} />
            <DihybridProbabilityBars summary={dihybridResult.summary} trait1={trait} trait2={trait2} />
          </>
        )}

        {/* Breeding tip */}
        <div style={{
          marginTop: "1rem", padding: "0.6rem 0.8rem", borderRadius: "6px",
          background: "rgba(251, 191, 36, 0.04)", border: "1px solid rgba(251, 191, 36, 0.12)",
          display: "flex", alignItems: "flex-start", gap: "6px",
        }}>
          <span style={{ fontSize: "0.85rem" }}>💡</span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted, #6b7280)", lineHeight: "1.5" }}>
            {mode === "dihybrid"
              ? getDihybridTip(trait, trait2, sireGenotype, damGenotype, sireGenotype2, damGenotype2)
              : getBreedingTip(trait, sireGenotype, damGenotype)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Breeding Tips Logic ────────────────────────────────────────────────────
function getBreedingTip(trait, sireGenotype, damGenotype) {
  if (trait.inheritance === "recessive") {
    if (sireGenotype === "homozygous_recessive" && damGenotype === "homozygous_recessive") {
      return `Both parents express ${trait.label}. 100% of offspring will show the trait. This is a "true-breeding" pair.`;
    }
    if (sireGenotype === "heterozygous" && damGenotype === "heterozygous") {
      return `Classic carrier × carrier cross. Expect ~25% expressing offspring. Test-breed juveniles against known carriers to identify hidden carriers in the wild-type offspring.`;
    }
    if (sireGenotype === "homozygous_dominant" && damGenotype === "homozygous_dominant") {
      return `Neither parent carries the ${trait.label} gene. No offspring will express or carry this trait.`;
    }
    if (
      (sireGenotype === "homozygous_recessive" && damGenotype === "heterozygous") ||
      (sireGenotype === "heterozygous" && damGenotype === "homozygous_recessive")
    ) {
      return `Expressing × Carrier cross. 50% of offspring will express the trait, 50% will be carriers. All offspring carry at least one copy.`;
    }
    return `Some offspring will carry the ${trait.label} allele. Track parentage carefully to identify hidden carriers in future generations.`;
  }

  if (trait.inheritance === "dominant") {
    if (sireGenotype === "homozygous_wild" && damGenotype === "homozygous_wild") {
      return `Neither parent carries ${trait.label}. No offspring will express this trait.`;
    }
    if (sireGenotype === "homozygous_trait" || damGenotype === "homozygous_trait") {
      return `At least one parent is homozygous for ${trait.label}. All offspring will express the trait. Note: homozygous dominant can be lethal in some species — monitor fry viability.`;
    }
    return `Heterozygous cross may produce some wild-type offspring. Selectively breed expressing offspring to increase frequency in subsequent generations.`;
  }

  // Codominant
  if (sireGenotype === "heterozygous" && damGenotype === "heterozygous") {
    return `Both parents show partial expression. Expect 25% full, 50% partial, 25% none. Full-expression offspring (M/M) will breed true.`;
  }
  return `Codominant traits show a dosage effect. Heterozygotes display intermediate phenotype between wild-type and full expression.`;
}

// ─── Dihybrid Breeding Tips ─────────────────────────────────────────────────
function getDihybridTip(trait1, trait2, sireGeno1, damGeno1, sireGeno2, damGeno2) {
  const bothHetero = sireGeno1 === "heterozygous" && damGeno1 === "heterozygous" &&
                     sireGeno2 === "heterozygous" && damGeno2 === "heterozygous";
  if (bothHetero) {
    return `Classic dihybrid cross (both parents heterozygous for both traits). Expect the 9:3:3:1 phenotypic ratio — 9/16 expressing both, 3/16 expressing only ${trait1.label}, 3/16 expressing only ${trait2.label}, 1/16 wild for both. Track offspring carefully to identify double-homozygous specimens.`;
  }

  const trait1Match = sireGeno1 === damGeno1;
  const trait2Match = sireGeno2 === damGeno2;
  if (trait1Match && trait2Match) {
    return `Both parents share the same genotype for both traits. Offspring genotype distribution will be narrower — fewer phenotypic classes than a full dihybrid cross.`;
  }

  return `Independent assortment applies — ${trait1.label} and ${trait2.label} segregate independently. Each trait follows its own Mendelian ratio, and the combined probabilities multiply across traits.`;
}

export default GeneticsPrediction;
