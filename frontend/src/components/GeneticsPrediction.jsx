import React, { useState, useMemo } from "react";

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
export const TRAIT_GENETICS = [
  {
    id: "albino",
    label: "Albino (Amelanistic)",
    symbol: "a",
    inheritance: "recessive",
    description: "Amelanistic mutation. Both parents must carry the gene to produce albino offspring.",
    color: "#fbbf24",
  },
  {
    id: "longfin",
    label: "Longfin",
    symbol: "Lf",
    inheritance: "dominant",
    description: "Dominant fin extension. One copy produces longfin phenotype. Homozygous (Lf/Lf) can be lethal in some species.",
    color: "#60a5fa",
  },
  {
    id: "veil",
    label: "Veiltail",
    symbol: "Vt",
    inheritance: "dominant",
    description: "Dominant veil mutation affecting caudal fin elongation.",
    color: "#c084fc",
  },
  {
    id: "melanistic",
    label: "Melanistic (Dark)",
    symbol: "m",
    inheritance: "recessive",
    description: "Excessive melanin production. Recessive — both parents must carry the allele.",
    color: "#6b7280",
  },
  {
    id: "metallic",
    label: "Metallic / Iridescent",
    symbol: "Mt",
    inheritance: "codominant",
    description: "Codominant iridophore expression. Heterozygotes show partial metallic sheen; homozygotes show full metallic.",
    color: "#34d399",
  },
];

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

// ─── Main Component ─────────────────────────────────────────────────────────
export function GeneticsPrediction({ casualModeActive = false }) {
  const [selectedTrait, setSelectedTrait] = useState(TRAIT_GENETICS[0].id);
  const [sireGenotype, setSireGenotype] = useState("heterozygous");
  const [damGenotype, setDamGenotype] = useState("heterozygous");

  const trait = TRAIT_GENETICS.find((t) => t.id === selectedTrait);
  const genotypeOptions = GENOTYPE_OPTIONS[trait.inheritance];

  const result = useMemo(
    () => calculatePunnett(sireGenotype, damGenotype, trait.inheritance),
    [sireGenotype, damGenotype, trait.inheritance]
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

      {/* Trait Selector */}
      <div style={{
        display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "1.25rem",
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

      {/* Trait Info Banner */}
      <div style={{
        padding: "0.75rem 1rem", marginBottom: "1.25rem", borderRadius: "8px",
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

      {/* Parent Genotype Selectors */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
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

      {/* Results: Punnett Square + Probability Bars */}
      <div style={{
        padding: "1.25rem", borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(139, 92, 246, 0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Punnett Square
          </span>
          <span style={{
            fontSize: "0.62rem", padding: "3px 8px", borderRadius: "10px",
            background: "rgba(52, 211, 153, 0.08)", border: "1px solid rgba(52, 211, 153, 0.2)",
            color: "#34d399", fontWeight: "600",
          }}>
            {trait.label}
          </span>
        </div>

        <PunnettGrid result={result} traitColor={trait.color} />
        <ProbabilityBars summary={result.summary} traitColor={trait.color} />

        {/* Breeding tip */}
        <div style={{
          marginTop: "1rem", padding: "0.6rem 0.8rem", borderRadius: "6px",
          background: "rgba(251, 191, 36, 0.04)", border: "1px solid rgba(251, 191, 36, 0.12)",
          display: "flex", alignItems: "flex-start", gap: "6px",
        }}>
          <span style={{ fontSize: "0.85rem" }}>💡</span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted, #6b7280)", lineHeight: "1.5" }}>
            {getBreedingTip(trait, sireGenotype, damGenotype)}
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

export default GeneticsPrediction;
