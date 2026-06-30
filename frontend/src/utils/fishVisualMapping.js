/**
 * fishVisualMapping.js — Derives visual appearance (body shape, color, fin style, scale)
 * from FishBase species data fields. Used by TankFishVisualization to render
 * species-accurate SVG fish in the tank card.
 *
 * Mapping sources:
 * - family → primary color palette
 * - maxLengthCm → relative scale in the tank view
 * - family/ecology → body shape archetype (elongated, disc, standard, eel, flat)
 * - family → fin style (rounded, pointed, flowing, spiky)
 */

// ─── Color Palettes by Family ────────────────────────────────────────────────
// Each family maps to a primary + secondary color for gradient bodies
const FAMILY_COLORS = {
  cichlidae:       { primary: "#f59e0b", secondary: "#d97706", accent: "#fbbf24" },
  characidae:      { primary: "#ef4444", secondary: "#b91c1c", accent: "#fca5a5" },
  poeciliidae:     { primary: "#22c55e", secondary: "#15803d", accent: "#86efac" },
  loricariidae:    { primary: "#78716c", secondary: "#44403c", accent: "#a8a29e" },
  callichthyidae:  { primary: "#a78bfa", secondary: "#7c3aed", accent: "#c4b5fd" },
  osphronemidae:   { primary: "#3b82f6", secondary: "#1d4ed8", accent: "#93c5fd" },
  cyprinidae:      { primary: "#06b6d4", secondary: "#0e7490", accent: "#67e8f9" },
  serrasalmidae:   { primary: "#dc2626", secondary: "#7f1d1d", accent: "#fca5a5" },
  anabantidae:     { primary: "#8b5cf6", secondary: "#6d28d9", accent: "#c4b5fd" },
  gobiidae:        { primary: "#84cc16", secondary: "#4d7c0f", accent: "#bef264" },
  synodontidae:    { primary: "#a3a3a3", secondary: "#525252", accent: "#d4d4d4" },
  mochokidae:      { primary: "#92400e", secondary: "#451a03", accent: "#d97706" },
  aplocheilidae:   { primary: "#f97316", secondary: "#c2410c", accent: "#fdba74" },
  nothobranchiidae:{ primary: "#e11d48", secondary: "#881337", accent: "#fb7185" },
  melanotaeniidae: { primary: "#14b8a6", secondary: "#0f766e", accent: "#5eead4" },
  labridae:        { primary: "#0ea5e9", secondary: "#0369a1", accent: "#7dd3fc" },
  pomacanthidae:   { primary: "#eab308", secondary: "#a16207", accent: "#fde047" },
  acanthuridae:    { primary: "#2563eb", secondary: "#1e40af", accent: "#60a5fa" },
  clariidae:       { primary: "#57534e", secondary: "#292524", accent: "#78716c" },
};

const DEFAULT_COLORS = { primary: "#64748b", secondary: "#334155", accent: "#94a3b8" };

// ─── Body Shape Archetypes ───────────────────────────────────────────────────
// Maps family to body shape. Determines the SVG path used.
const FAMILY_BODY_SHAPES = {
  // Disc-shaped (tall, compressed body)
  pomacanthidae: "disc",
  symphysodontidae: "disc",
  pterophyllidae: "disc",
  
  // Elongated (torpedo-like, fast swimmers)
  characidae: "elongated",
  cyprinidae: "elongated",
  melanotaeniidae: "elongated",
  
  // Eel-like (very long, thin)
  muraenidae: "eel",
  mastacembelidae: "eel",
  synbranchidae: "eel",
  
  // Flat-bottom (catfish body plan)
  loricariidae: "flat",
  callichthyidae: "flat",
  mochokidae: "flat",
  clariidae: "flat",
  
  // Standard (generic fish shape — most cichlids, gouramis, etc.)
  cichlidae: "standard",
  osphronemidae: "standard",
  poeciliidae: "standard",
  anabantidae: "standard",
  gobiidae: "standard",
  labridae: "standard",
  acanthuridae: "standard",
};

// ─── Fin Styles ──────────────────────────────────────────────────────────────
const FAMILY_FIN_STYLES = {
  osphronemidae: "flowing",   // Bettas, gouramis — long flowing fins
  cichlidae: "pointed",       // Angular dorsal fins
  poeciliidae: "rounded",     // Small rounded fins (guppies, mollies)
  loricariidae: "spiky",      // Bristled/armored look
  characidae: "small",        // Small, neat fins (tetras)
  pomacanthidae: "flowing",   // Angelfish, flowing dorsal
  acanthuridae: "pointed",    // Tangs — sharp dorsal
};

const DEFAULT_FIN_STYLE = "rounded";

/**
 * Get the full visual configuration for a species.
 * @param {object} species - FishBase species object (from fishbase_master.json)
 * @returns {object} Visual config: { colors, bodyShape, finStyle, relativeScale, swimSpeed }
 */
export function getSpeciesVisual(species) {
  const family = (species?.family || "").toLowerCase();
  const maxLen = species?.maxLengthCm || 5;

  const colors = FAMILY_COLORS[family] || DEFAULT_COLORS;
  const bodyShape = FAMILY_BODY_SHAPES[family] || "standard";
  const finStyle = FAMILY_FIN_STYLES[family] || DEFAULT_FIN_STYLE;

  // Relative scale: map maxLengthCm to a visual scale factor (0.6 – 1.8)
  // 3cm fish = 0.6x, 10cm = 1.0x, 30cm+ = 1.8x
  const relativeScale = Math.max(0.6, Math.min(1.8, 0.4 + (maxLen / 20)));

  // Swim speed: smaller fish dart faster, larger fish glide
  const swimSpeed = Math.max(0.4, Math.min(2.0, 6 / maxLen));

  return {
    colors,
    bodyShape,
    finStyle,
    relativeScale,
    swimSpeed,
    family,
    maxLengthCm: maxLen,
  };
}

/**
 * Generate SVG path data for a fish body based on body shape archetype.
 * Returns an object with { bodyPath, tailPath, dorsalPath, eyePosition }
 * All paths are within a 40x25 viewBox.
 */
export function getFishSVGPaths(bodyShape) {
  switch (bodyShape) {
    case "disc":
      return {
        bodyPath: "M38 12.5C34 19 27 23 20 23C12 23 7 18 4 12.5C7 7 12 2 20 2C27 2 34 6 38 12.5Z",
        tailPath: "M4 12.5L0 5V20L4 12.5Z",
        dorsalPath: "M24 2C20 -2 14 -1 10 2C14 2 18 1 24 2Z",
        eyePosition: { cx: 32, cy: 10 },
      };
    case "elongated":
      return {
        bodyPath: "M39 12.5C36 16 29 18 20 18C11 18 6 15 3 12.5C6 10 11 7 20 7C29 7 36 9 39 12.5Z",
        tailPath: "M3 12.5L0 7V18L3 12.5Z",
        dorsalPath: "M28 7C24 5 18 5 14 7C18 6 22 6 28 7Z",
        eyePosition: { cx: 34, cy: 11 },
      };
    case "eel":
      return {
        bodyPath: "M39 12.5C37 15 30 16 20 16C10 16 5 14 2 12.5C5 11 10 9 20 9C30 9 37 10 39 12.5Z",
        tailPath: "M2 12.5L0 9.5V15.5L2 12.5Z",
        dorsalPath: "M30 9C25 8 15 8 10 9C15 8.5 25 8.5 30 9Z",
        eyePosition: { cx: 35, cy: 11.5 },
      };
    case "flat":
      return {
        bodyPath: "M38 13C34 18 27 20 20 20C12 20 7 17 4 13C7 10 12 8 20 8C27 8 34 10 38 13Z",
        tailPath: "M4 13L0 8V18L4 13Z",
        dorsalPath: "M26 8C22 6 16 6 12 8C16 7 20 7 26 8Z",
        eyePosition: { cx: 32, cy: 11 },
      };
    case "standard":
    default:
      return {
        bodyPath: "M38 12.5C34 17 27 20 20 20C13 20 8 16 4 12.5C8 9 13 5 20 5C27 5 34 8 38 12.5Z",
        tailPath: "M4 12.5L0 7V18L4 12.5Z",
        dorsalPath: "M26 5C21 1.5 15 1.5 10 4C15 3 20 3 26 5Z",
        eyePosition: { cx: 33, cy: 10.5 },
      };
  }
}

/**
 * Get additional fin path based on fin style.
 * Returns SVG path string for the pectoral/ventral fin accent.
 */
export function getFinAccentPath(finStyle) {
  switch (finStyle) {
    case "flowing":
      return "M22 18C18 22 14 23 12 21C14 20 18 19 22 18Z";
    case "pointed":
      return "M24 17L20 22L18 17Z";
    case "spiky":
      return "M26 5L24 1L22 5L20 2L18 5Z";
    case "small":
      return "M22 16C20 18 18 18 17 16Z";
    case "rounded":
    default:
      return "M22 17C19 20 16 20 15 17C17 17 20 17 22 17Z";
  }
}
