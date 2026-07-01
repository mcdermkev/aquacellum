/**
 * coiCalculator.js — Coefficient of Inbreeding (COI) Calculator
 *
 * Implements Wright's path coefficient method (simplified for 3-generation depth).
 * Walks the pedigree tree of a proposed pairing to identify shared ancestors
 * between sire and dam lines, then calculates the probability of identical
 * alleles by descent.
 *
 * COI Ranges (aquaculture guidelines):
 *   0%        — No detectable inbreeding (outbred)
 *   0-6.25%   — Low risk (e.g., half-cousins)
 *   6.25-12.5% — Moderate risk (e.g., first cousins)
 *   12.5-25%  — High risk (e.g., half-siblings)
 *   25%+      — Very high risk (e.g., full siblings or parent-child)
 */

/**
 * Calculate COI for a proposed pairing given both parents' pedigree trees.
 *
 * @param {Object} sireTree - Sire's ancestors: { id, sireId, damId, parents?: { sire, dam }, grandparents?: {...} }
 * @param {Object} damTree  - Dam's ancestors (same shape)
 * @returns {Object} { coi, riskLevel, sharedAncestors, paths, recommendation }
 */
export function calculateCOI(sireTree, damTree) {
  if (!sireTree || !damTree) {
    return { coi: 0, riskLevel: "unknown", sharedAncestors: [], paths: [], recommendation: "Insufficient pedigree data to calculate COI." };
  }

  // Collect all ancestors for each parent with their generation depth
  const sireAncestors = collectAncestors(sireTree, "sire");
  const damAncestors = collectAncestors(damTree, "dam");

  // Find shared ancestors (same specimen ID appearing in both lines)
  const sharedAncestors = [];
  const paths = [];

  for (const [id, sireInfo] of sireAncestors.entries()) {
    if (damAncestors.has(id) && id !== 0) {
      const damInfo = damAncestors.get(id);
      sharedAncestors.push({
        id,
        name: sireInfo.name || damInfo.name,
        sireGeneration: sireInfo.generation,
        damGeneration: damInfo.generation,
      });
      paths.push({
        ancestorId: id,
        ancestorName: sireInfo.name || damInfo.name,
        pathLengthSire: sireInfo.generation,
        pathLengthDam: damInfo.generation,
        // Wright's formula: contribution = (1/2)^(n1 + n2 + 1)
        contribution: Math.pow(0.5, sireInfo.generation + damInfo.generation + 1),
      });
    }
  }

  // Sum all path contributions (Wright's method)
  const coi = paths.reduce((sum, p) => sum + p.contribution, 0);
  const coiPercent = Math.round(coi * 10000) / 100; // 2 decimal places

  const riskLevel = getRiskLevel(coiPercent);
  const recommendation = getRecommendation(coiPercent, sharedAncestors);

  return {
    coi: coiPercent,
    riskLevel,
    sharedAncestors,
    paths,
    recommendation,
  };
}

/**
 * Collect all ancestors from a tree node with generation depth.
 * Returns a Map of specimenId → { generation, name }
 */
function collectAncestors(node, lineLabel, generation = 0, map = new Map()) {
  if (!node) return map;

  const id = node.id || node.specimenId;
  if (id && id !== 0) {
    // Store the closest generation if same ancestor appears multiple times
    if (!map.has(id) || map.get(id).generation > generation) {
      map.set(id, {
        generation,
        name: node.speciesName || node.commonName || `#${id}`,
        line: lineLabel,
      });
    }
  }

  // Recurse into parents (if tree shape has parents/grandparents)
  if (node.parents) {
    collectAncestors(node.parents.sire, lineLabel, generation + 1, map);
    collectAncestors(node.parents.dam, lineLabel, generation + 1, map);
  }

  // Also handle flat grandparent shape from SpecimenLineage tree
  if (generation === 0 && node.sireId) {
    // If we have the full tree object with resolved nodes, use those
    if (node._resolvedSire) {
      collectAncestors(node._resolvedSire, lineLabel, 1, map);
    } else if (node.sireId) {
      map.set(node.sireId, { generation: 1, name: `Specimen #${node.sireId}`, line: lineLabel });
    }
    if (node._resolvedDam) {
      collectAncestors(node._resolvedDam, lineLabel, 1, map);
    } else if (node.damId) {
      map.set(node.damId, { generation: 1, name: `Specimen #${node.damId}`, line: lineLabel });
    }
  }

  return map;
}

/**
 * Build a flat ancestor map from the standard tree shape used in SpecimenLineage.
 * Input: { target, parents: { sire, dam }, grandparents: { sireSire, sireDam, damSire, damDam } }
 */
export function buildAncestorMapFromTree(tree, side) {
  const map = new Map();
  if (!tree) return map;

  // The "target" in this context IS the parent (sire or dam of the proposed offspring)
  const root = tree.target || tree;
  if (root?.id) map.set(root.id, { generation: 0, name: root.speciesName || `#${root.id}`, line: side });

  if (tree.parents?.sire?.id) {
    map.set(tree.parents.sire.id, { generation: 1, name: tree.parents.sire.speciesName || `#${tree.parents.sire.id}`, line: side });
  }
  if (tree.parents?.dam?.id) {
    map.set(tree.parents.dam.id, { generation: 1, name: tree.parents.dam.speciesName || `#${tree.parents.dam.id}`, line: side });
  }
  if (tree.grandparents?.sireSire?.id) {
    map.set(tree.grandparents.sireSire.id, { generation: 2, name: tree.grandparents.sireSire.speciesName || `#${tree.grandparents.sireSire.id}`, line: side });
  }
  if (tree.grandparents?.sireDam?.id) {
    map.set(tree.grandparents.sireDam.id, { generation: 2, name: tree.grandparents.sireDam.speciesName || `#${tree.grandparents.sireDam.id}`, line: side });
  }
  if (tree.grandparents?.damSire?.id) {
    map.set(tree.grandparents.damSire.id, { generation: 2, name: tree.grandparents.damSire.speciesName || `#${tree.grandparents.damSire.id}`, line: side });
  }
  if (tree.grandparents?.damDam?.id) {
    map.set(tree.grandparents.damDam.id, { generation: 2, name: tree.grandparents.damDam.speciesName || `#${tree.grandparents.damDam.id}`, line: side });
  }

  return map;
}

/**
 * Calculate COI from two flat ancestor maps (from buildAncestorMapFromTree).
 */
export function calculateCOIFromMaps(sireMap, damMap) {
  const sharedAncestors = [];
  const paths = [];

  for (const [id, sireInfo] of sireMap.entries()) {
    if (damMap.has(id) && id !== 0) {
      const damInfo = damMap.get(id);
      sharedAncestors.push({
        id,
        name: sireInfo.name || damInfo.name,
        sireGeneration: sireInfo.generation,
        damGeneration: damInfo.generation,
      });
      paths.push({
        ancestorId: id,
        ancestorName: sireInfo.name || damInfo.name,
        pathLengthSire: sireInfo.generation,
        pathLengthDam: damInfo.generation,
        contribution: Math.pow(0.5, sireInfo.generation + damInfo.generation + 1),
      });
    }
  }

  const coi = paths.reduce((sum, p) => sum + p.contribution, 0);
  const coiPercent = Math.round(coi * 10000) / 100;
  const riskLevel = getRiskLevel(coiPercent);
  const recommendation = getRecommendation(coiPercent, sharedAncestors);

  return { coi: coiPercent, riskLevel, sharedAncestors, paths, recommendation };
}

function getRiskLevel(coiPercent) {
  if (coiPercent === 0) return "none";
  if (coiPercent <= 6.25) return "low";
  if (coiPercent <= 12.5) return "moderate";
  if (coiPercent <= 25) return "high";
  return "critical";
}

function getRecommendation(coiPercent, sharedAncestors) {
  if (coiPercent === 0) {
    return "No shared ancestors detected within 3 generations. This is an outbred pairing with no inbreeding concerns.";
  }
  if (coiPercent <= 6.25) {
    return "Low inbreeding detected. This is generally acceptable for most species, especially if selecting for a specific trait. Monitor offspring vigor.";
  }
  if (coiPercent <= 12.5) {
    return "Moderate inbreeding — equivalent to first-cousin mating. Consider whether the trait benefits outweigh potential vigor loss. Watch for reduced clutch sizes and increased fry mortality.";
  }
  if (coiPercent <= 25) {
    return "High inbreeding — equivalent to half-sibling mating. Significant risk of inbreeding depression: reduced fertility, weakened immune response, and congenital defects. Outcross recommended unless line-breeding for a specific goal.";
  }
  return "Critical inbreeding level — equivalent to full-sibling or parent-child mating. Very high risk of inbreeding depression. Strongly recommend outcrossing with unrelated stock.";
}

/**
 * Risk level display configuration.
 */
export const COI_RISK_CONFIG = {
  unknown: { label: "Unknown", color: "#6b7280", bg: "rgba(107, 114, 128, 0.1)", icon: "❓" },
  none: { label: "Outbred", color: "#34d399", bg: "rgba(52, 211, 153, 0.1)", icon: "✓" },
  low: { label: "Low Risk", color: "#60a5fa", bg: "rgba(96, 165, 250, 0.1)", icon: "ℹ" },
  moderate: { label: "Moderate", color: "#fbbf24", bg: "rgba(251, 191, 36, 0.1)", icon: "⚠" },
  high: { label: "High Risk", color: "#f97316", bg: "rgba(249, 115, 22, 0.1)", icon: "⚠" },
  critical: { label: "Critical", color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)", icon: "🚨" },
};
