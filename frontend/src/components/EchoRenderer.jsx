/**
 * EchoRenderer.jsx
 *
 * Parametric SVG rendering engine for Echo companions.
 * Generates a unique, animated Echo from on-chain DNA traits + off-chain needs state.
 *
 * Layer stack (bottom → top):
 *   1. Stage effects (translucency, aura, particles)
 *   2. Body shape SVG path
 *   3. Color gradient fill (baseHue + secondaryHue)
 *   4. Pattern overlay (masked to body)
 *   5. Fin attachments
 *   6. Eye rendering
 *   7. Signature marking
 *   8. Personality drift modifiers (hue shift, glow)
 *   9. Needs-based overlays (belly glow, eye brightness, fin condition)
 *   10. Mood animation layer
 *
 * Props:
 *   - dna {{ seed, bodyShape, pattern, finStyle, eyeType, signatureMark, baseHue, secondaryHue }}
 *   - stage {number} 0–6 (Egg through Legendary)
 *   - needs {{ hunger, clarity, comfort, curiosity, social }} each 0–100
 *   - personality {{ nurturing, analytical, adventurous, social, calm, creative }} each 0–100
 *   - size {number} render size in px (default 200)
 *   - animated {boolean} enable swim/idle animations (default true)
 *   - mood {string} derived mood override (optional)
 *   - onClick {function} tap handler
 */

import React, { useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Body Shape Paths (8 silhouettes) — normalized to 100x60 viewBox
// ─────────────────────────────────────────────────────────────────────────────

const BODY_PATHS = [
  // 0: Sleek (fast, elongated)
  "M10,30 C10,20 25,12 45,12 C65,12 80,18 90,30 C80,42 65,48 45,48 C25,48 10,40 10,30Z",
  // 1: Round (chubby, friendly)
  "M15,30 C15,15 30,8 50,8 C70,8 85,15 85,30 C85,45 70,52 50,52 C30,52 15,45 15,30Z",
  // 2: Angular (geometric, sharp)
  "M10,30 L30,10 L70,10 L90,30 L70,50 L30,50Z",
  // 3: Flowing (graceful, long)
  "M5,30 C5,22 15,15 30,14 C50,12 70,14 85,18 C95,22 95,38 85,42 C70,46 50,48 30,46 C15,45 5,38 5,30Z",
  // 4: Eel-like (sinuous, thin)
  "M5,30 C5,25 12,20 25,19 C45,17 65,18 80,20 C90,22 95,27 95,30 C95,33 90,38 80,40 C65,42 45,43 25,41 C12,40 5,35 5,30Z",
  // 5: Puffer (round with texture)
  "M20,30 C20,14 32,6 50,6 C68,6 80,14 80,30 C80,46 68,54 50,54 C32,54 20,46 20,30Z",
  // 6: Ray-finned (wide, flat)
  "M8,30 C8,22 20,16 40,14 C55,12 70,14 85,18 C92,20 95,26 95,30 C95,34 92,40 85,42 C70,46 55,48 40,46 C20,44 8,38 8,30Z",
  // 7: Seahorse-esque (curved, upright feel rendered horizontal)
  "M12,30 C12,18 22,10 38,10 C52,10 60,15 68,20 C78,26 85,28 88,30 C85,32 78,34 68,40 C60,45 52,50 38,50 C22,50 12,42 12,30Z",
];

// ─────────────────────────────────────────────────────────────────────────────
// Fin Paths (10 variants) — positioned relative to body center
// ─────────────────────────────────────────────────────────────────────────────

const FIN_PATHS = [
  // 0: Flowing veil — long, trailing
  { dorsal: "M40,12 C42,2 50,0 55,4 C58,8 56,12 50,12Z", tail: "M5,30 C-2,22 -4,15 -2,10 C0,15 2,22 5,28Z M5,30 C-2,38 -4,45 -2,50 C0,45 2,38 5,32Z", pectoral: "M55,38 C58,42 62,48 58,52 C55,48 53,42 55,38Z" },
  // 1: Spiky — aggressive, sharp
  { dorsal: "M35,12 L38,2 L42,10 L46,4 L50,12Z", tail: "M5,30 L-3,20 L0,28 L-4,30 L0,32 L-3,40Z", pectoral: "M58,36 L62,42 L56,40 L60,46Z" },
  // 2: Fan — wide, elegant
  { dorsal: "M35,14 C38,6 45,2 52,4 C56,6 58,10 55,14Z", tail: "M5,30 C-4,18 -6,12 -3,8 C0,14 2,22 5,28Z M5,30 C-4,42 -6,48 -3,52 C0,46 2,38 5,32Z", pectoral: "M55,38 C60,44 64,50 60,54 C56,48 54,42 55,38Z" },
  // 3: Ribbon — delicate, flowing
  { dorsal: "M38,12 C40,6 44,4 48,6 C50,8 48,12 45,12Z", tail: "M5,30 C0,20 -3,14 -1,10 C1,16 3,24 5,28Z M5,30 C0,40 -3,46 -1,50 C1,44 3,36 5,32Z", pectoral: "M56,38 C58,44 56,48 54,44Z" },
  // 4: Split — forked, dynamic
  { dorsal: "M40,14 C42,8 46,6 48,8 C50,10 48,14 45,14Z", tail: "M5,30 C-2,20 -5,14 -4,10 C-1,16 2,24 5,28Z M5,30 C-2,40 -5,46 -4,50 C-1,44 2,36 5,32Z", pectoral: "M56,36 C60,40 58,46 55,42Z" },
  // 5: Crown — regal, upright
  { dorsal: "M34,14 L36,4 L40,10 L44,2 L48,10 L52,4 L54,14Z", tail: "M5,30 C-1,22 -3,16 -1,12 C1,18 3,24 5,28Z M5,30 C-1,38 -3,44 -1,48 C1,42 3,36 5,32Z", pectoral: "M56,38 C60,44 58,48 55,44Z" },
  // 6: Whisker — long barbel-like extensions
  { dorsal: "M42,12 C44,6 48,4 50,8 C48,10 46,12 44,12Z", tail: "M5,30 C0,24 -2,18 -1,14 C1,20 3,26 5,28Z M5,30 C0,36 -2,42 -1,46 C1,40 3,34 5,32Z", pectoral: "M58,34 C64,32 68,34 64,36Z M58,38 C64,40 68,42 64,40Z" },
  // 7: Sail — tall dorsal
  { dorsal: "M35,14 C36,4 42,-2 48,0 C52,2 54,8 52,14Z", tail: "M5,30 C-1,22 -2,16 0,12 C2,18 3,24 5,28Z M5,30 C-1,38 -2,44 0,48 C2,42 3,36 5,32Z", pectoral: "M55,38 C58,44 56,48 54,44Z" },
  // 8: Feather — soft, layered
  { dorsal: "M36,14 C38,8 42,6 46,8 C48,10 46,14 42,14Z M40,14 C42,10 46,8 50,10 C48,12 46,14 44,14Z", tail: "M5,30 C-1,22 -2,16 0,14 C2,20 3,26 5,28Z M5,30 C-1,38 -2,44 0,46 C2,40 3,34 5,32Z", pectoral: "M55,38 C58,42 57,46 54,42Z" },
  // 9: Trident — three-pointed
  { dorsal: "M38,14 L40,4 L42,12 L44,2 L46,12 L48,4 L50,14Z", tail: "M5,30 C-2,22 -5,16 -4,12 L-6,8 M5,30 C-3,30 -6,30 -8,30 M5,30 C-2,38 -5,44 -4,48 L-6,52", pectoral: "M56,38 C60,42 62,46 58,44Z" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Generators (12 types) — returns SVG pattern element content
// ─────────────────────────────────────────────────────────────────────────────

function generatePattern(patternId, hue, secondaryHue) {
  const color = `hsl(${hue}, 70%, 60%)`;
  const accent = `hsl(${secondaryHue}, 60%, 50%)`;

  switch (patternId) {
    case 0: // Spots
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="16" height="16">
          <circle cx="4" cy="4" r="2.5" fill={accent} opacity="0.4" />
          <circle cx="12" cy="12" r="2" fill={accent} opacity="0.3" />
        </pattern>
      );
    case 1: // Stripes
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke={accent} strokeWidth="2" opacity="0.35" />
        </pattern>
      );
    case 2: // Marbling
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="20" height="20">
          <path d="M0,10 Q5,5 10,10 T20,10" fill="none" stroke={accent} strokeWidth="1.5" opacity="0.3" />
          <path d="M0,15 Q5,10 10,15 T20,15" fill="none" stroke={color} strokeWidth="1" opacity="0.2" />
        </pattern>
      );
    case 3: // Bioluminescent veins
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="24" height="24">
          <path d="M2,12 C6,8 10,14 14,10 C18,6 22,12 24,8" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.5" />
          <path d="M0,18 C4,14 8,20 12,16" fill="none" stroke={accent} strokeWidth="0.6" opacity="0.4" />
        </pattern>
      );
    case 4: // Scales
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="12" height="10">
          <path d="M0,5 Q3,0 6,5 Q9,0 12,5" fill="none" stroke={accent} strokeWidth="0.7" opacity="0.3" />
          <path d="M-6,10 Q-3,5 0,10 Q3,5 6,10" fill="none" stroke={accent} strokeWidth="0.7" opacity="0.3" />
        </pattern>
      );
    case 5: // Galaxy swirl
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="30" height="30">
          <circle cx="15" cy="15" r="8" fill="none" stroke={accent} strokeWidth="0.5" opacity="0.3" strokeDasharray="2 3" />
          <circle cx="15" cy="15" r="4" fill="none" stroke={color} strokeWidth="0.8" opacity="0.4" strokeDasharray="1 2" />
          <circle cx="10" cy="8" r="1" fill={accent} opacity="0.5" />
          <circle cx="22" cy="20" r="0.8" fill={accent} opacity="0.4" />
        </pattern>
      );
    case 6: // Ripples
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="20" height="20">
          <circle cx="10" cy="10" r="6" fill="none" stroke={accent} strokeWidth="0.6" opacity="0.25" />
          <circle cx="10" cy="10" r="3" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.35" />
        </pattern>
      );
    case 7: // Diamond
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="14" height="14">
          <path d="M7,0 L14,7 L7,14 L0,7Z" fill="none" stroke={accent} strokeWidth="0.7" opacity="0.3" />
        </pattern>
      );
    case 8: // Fractal
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="18" height="18">
          <path d="M3,9 L6,3 L9,9 L12,3 L15,9" fill="none" stroke={accent} strokeWidth="0.6" opacity="0.3" />
          <path d="M3,15 L6,9 L9,15 L12,9 L15,15" fill="none" stroke={accent} strokeWidth="0.5" opacity="0.2" />
        </pattern>
      );
    case 9: // Nebula
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="24" height="24">
          <circle cx="8" cy="8" r="5" fill={accent} opacity="0.12" />
          <circle cx="18" cy="16" r="4" fill={color} opacity="0.1" />
          <circle cx="12" cy="20" r="3" fill={accent} opacity="0.08" />
        </pattern>
      );
    case 10: // Coral
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="16" height="16">
          <path d="M4,16 C4,10 6,6 8,4 C8,6 10,8 10,12" fill="none" stroke={accent} strokeWidth="1" opacity="0.3" />
          <path d="M12,16 C12,12 13,8 14,6" fill="none" stroke={color} strokeWidth="0.8" opacity="0.25" />
        </pattern>
      );
    case 11: // Plain (no pattern)
    default:
      return (
        <pattern id="echo-pattern" patternUnits="userSpaceOnUse" width="10" height="10">
          <rect width="10" height="10" fill="transparent" />
        </pattern>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eye Renderers (6 types)
// ─────────────────────────────────────────────────────────────────────────────

function renderEye(eyeType, x, y, clarityLevel, hue) {
  const brightness = Math.max(0.3, clarityLevel / 100);
  const glowColor = `hsl(${hue}, 80%, ${50 + brightness * 30}%)`;

  switch (eyeType) {
    case 0: // Round
      return (
        <g>
          <circle cx={x} cy={y} r="3.5" fill="#0a0a14" />
          <circle cx={x} cy={y} r="2.5" fill={glowColor} opacity={brightness} />
          <circle cx={x - 0.8} cy={y - 0.8} r="1" fill="#fff" opacity={0.7 * brightness} />
        </g>
      );
    case 1: // Almond
      return (
        <g>
          <ellipse cx={x} cy={y} rx="4" ry="2.5" fill="#0a0a14" />
          <ellipse cx={x} cy={y} rx="2.5" ry="1.8" fill={glowColor} opacity={brightness} />
          <circle cx={x - 0.5} cy={y - 0.5} r="0.8" fill="#fff" opacity={0.7 * brightness} />
        </g>
      );
    case 2: // Galaxy
      return (
        <g>
          <circle cx={x} cy={y} r="3.5" fill="#0a0a14" />
          <circle cx={x} cy={y} r="2.8" fill={`hsl(${hue + 40}, 60%, 20%)`} opacity={brightness} />
          <circle cx={x} cy={y} r="1.5" fill={glowColor} opacity={brightness * 0.8} />
          <circle cx={x + 1} cy={y - 1} r="0.5" fill="#fff" opacity={0.5 * brightness} />
          <circle cx={x - 0.8} cy={y + 0.5} r="0.3" fill="#fff" opacity={0.4 * brightness} />
        </g>
      );
    case 3: // Gem
      return (
        <g>
          <path d={`M${x},${y - 3} L${x + 3},${y} L${x},${y + 3} L${x - 3},${y}Z`} fill="#0a0a14" />
          <path d={`M${x},${y - 2} L${x + 2},${y} L${x},${y + 2} L${x - 2},${y}Z`} fill={glowColor} opacity={brightness} />
          <circle cx={x - 0.5} cy={y - 0.5} r="0.6" fill="#fff" opacity={0.6 * brightness} />
        </g>
      );
    case 4: // Ancient (wise, deep)
      return (
        <g>
          <ellipse cx={x} cy={y} rx="3.5" ry="3" fill="#0a0a14" />
          <ellipse cx={x} cy={y} rx="2.5" ry="1" fill={glowColor} opacity={brightness} />
          <line x1={x - 4} y1={y} x2={x - 2} y2={y - 1} stroke={glowColor} strokeWidth="0.4" opacity={0.5 * brightness} />
          <line x1={x + 2} y1={y - 1} x2={x + 4} y2={y} stroke={glowColor} strokeWidth="0.4" opacity={0.5 * brightness} />
        </g>
      );
    case 5: // Ember (glowing, warm)
    default:
      return (
        <g>
          <circle cx={x} cy={y} r="3" fill="#1a0800" />
          <circle cx={x} cy={y} r="2.2" fill={`hsl(${hue}, 90%, 40%)`} opacity={brightness} />
          <circle cx={x} cy={y} r="1.2" fill={`hsl(${hue}, 100%, 65%)`} opacity={brightness * 0.9} />
          <circle cx={x - 0.5} cy={y - 0.5} r="0.5" fill="#fff" opacity={0.5 * brightness} />
        </g>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature Marks (20 unique accents)
// ─────────────────────────────────────────────────────────────────────────────

function renderSignatureMark(markId, hue) {
  const color = `hsl(${hue}, 80%, 70%)`;
  const glow = `hsl(${hue}, 90%, 80%)`;

  // Only render marks 0–14 visually (15–19 are "no visible mark" for rarity)
  if (markId >= 15) return null;

  const marks = [
    // 0: Star on forehead
    <path d="M50,8 L51.5,11 L55,11.5 L52.5,13.5 L53,17 L50,15.5 L47,17 L47.5,13.5 L45,11.5 L48.5,11Z" fill={glow} opacity="0.7" />,
    // 1: Tail ring
    <circle cx="10" cy="30" r="4" fill="none" stroke={color} strokeWidth="1" opacity="0.6" />,
    // 2: Glowing barbels (whisker lines from face)
    <g><line x1="72" y1="26" x2="82" y2="22" stroke={glow} strokeWidth="0.8" opacity="0.6" /><line x1="72" y1="34" x2="82" y2="38" stroke={glow} strokeWidth="0.8" opacity="0.6" /></g>,
    // 3: Cheek dots (two small glowing circles)
    <g><circle cx="65" cy="24" r="1.5" fill={glow} opacity="0.6" /><circle cx="65" cy="36" r="1.5" fill={glow} opacity="0.6" /></g>,
    // 4: Crown mark (tiny tiara shape on top)
    <path d="M44,10 L46,6 L48,9 L50,5 L52,9 L54,6 L56,10" fill="none" stroke={glow} strokeWidth="0.8" opacity="0.6" />,
    // 5: Heart mark on side
    <path d="M35,24 C35,22 37,20 39,22 C41,20 43,22 43,24 C43,27 39,30 39,30 C39,30 35,27 35,24Z" fill={color} opacity="0.4" />,
    // 6: Lightning bolt on flank
    <path d="M55,20 L52,26 L56,26 L53,32" fill="none" stroke={glow} strokeWidth="1" opacity="0.5" />,
    // 7: Spiral on body center
    <path d="M50,30 C50,27 52,26 54,27 C56,28 56,30 54,31 C52,32 51,31 51,30" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5" />,
    // 8: Three dots (ellipsis marking)
    <g><circle cx="40" cy="22" r="1.2" fill={glow} opacity="0.5" /><circle cx="44" cy="21" r="1.2" fill={glow} opacity="0.5" /><circle cx="48" cy="22" r="1.2" fill={glow} opacity="0.5" /></g>,
    // 9: Crescent moon on gill
    <path d="M62,26 A4,4 0 0,1 62,34 A3,3 0 0,0 62,26Z" fill={color} opacity="0.5" />,
    // 10: Double stripe on tail base
    <g><line x1="14" y1="24" x2="14" y2="36" stroke={glow} strokeWidth="1.2" opacity="0.4" /><line x1="18" y1="22" x2="18" y2="38" stroke={glow} strokeWidth="1.2" opacity="0.4" /></g>,
    // 11: Teardrop below eye
    <path d="M66,34 C66,34 67,36 66,38 C65,36 66,34 66,34Z" fill={glow} opacity="0.5" />,
    // 12: Halo ring above head
    <ellipse cx="50" cy="6" rx="8" ry="2" fill="none" stroke={glow} strokeWidth="0.6" opacity="0.4" />,
    // 13: Belly spot (large gentle glow)
    <ellipse cx="50" cy="38" rx="6" ry="3" fill={color} opacity="0.2" />,
    // 14: Fin tip glow
    <circle cx="45" cy="8" r="2" fill={glow} opacity="0.5" />,
  ];

  return marks[markId] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage Effects
// ─────────────────────────────────────────────────────────────────────────────

function getStageEffects(stage, hue) {
  switch (stage) {
    case 0: // Egg — just a pulsing egg shape
      return { opacity: 1, filter: "", aura: false, particles: false, isEgg: true };
    case 1: // Larva — very translucent
      return { opacity: 0.5, filter: "", aura: false, particles: false, isEgg: false };
    case 2: // Fry — slightly translucent
      return { opacity: 0.75, filter: "", aura: false, particles: false, isEgg: false };
    case 3: // Juvenile — full opacity
      return { opacity: 1, filter: "", aura: false, particles: false, isEgg: false };
    case 4: // Adult — subtle glow
      return { opacity: 1, filter: `drop-shadow(0 0 4px hsl(${hue}, 60%, 50%))`, aura: false, particles: false, isEgg: false };
    case 5: // Elder — aura + glow
      return { opacity: 1, filter: `drop-shadow(0 0 8px hsl(${hue}, 70%, 60%))`, aura: true, particles: false, isEgg: false };
    case 6: // Legendary — full effects
      return { opacity: 1, filter: `drop-shadow(0 0 12px hsl(${hue}, 80%, 65%))`, aura: true, particles: true, isEgg: false };
    default:
      return { opacity: 1, filter: "", aura: false, particles: false, isEgg: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Personality Drift Visual Modifiers
// ─────────────────────────────────────────────────────────────────────────────

function getPersonalityModifiers(personality) {
  if (!personality) return { hueShift: 0, scaleX: 1, scaleY: 1, glowIntensity: 0 };

  const { nurturing = 10, analytical = 10, adventurous = 10, social = 10, calm = 10, creative = 10 } = personality;

  // Dominant axis affects visual
  const maxAxis = Math.max(nurturing, analytical, adventurous, social, calm, creative);

  let hueShift = 0;
  let scaleX = 1;
  let scaleY = 1;
  let glowIntensity = 0;

  if (maxAxis === nurturing && nurturing > 30) {
    hueShift = 10; // Warmer
    scaleX = 1 + (nurturing - 30) * 0.002; // Slightly rounder
    scaleY = 1 + (nurturing - 30) * 0.001;
  } else if (maxAxis === analytical && analytical > 30) {
    hueShift = -15; // Cooler
    scaleX = 1 - (analytical - 30) * 0.001; // Slightly sharper
  } else if (maxAxis === adventurous && adventurous > 30) {
    hueShift = 5;
    glowIntensity = (adventurous - 30) * 0.01;
  } else if (maxAxis === social && social > 30) {
    scaleY = 1 + (social - 30) * 0.002; // Taller fins
    glowIntensity = (social - 30) * 0.008;
  } else if (maxAxis === calm && calm > 30) {
    hueShift = -20; // Deeper blues
  } else if (maxAxis === creative && creative > 30) {
    hueShift = 15; // Warmer, more varied
    glowIntensity = (creative - 30) * 0.006;
  }

  return { hueShift, scaleX, scaleY, glowIntensity };
}

// ─────────────────────────────────────────────────────────────────────────────
// Needs-Based Visual Adjustments
// ─────────────────────────────────────────────────────────────────────────────

function getNeedsVisuals(needs) {
  if (!needs) return { bellyGlow: 1, eyeBrightness: 1, finHealth: 1, alertness: 1, sociability: 1 };

  return {
    bellyGlow: Math.max(0.2, (needs.hunger || 50) / 100),
    eyeBrightness: Math.max(0.2, (needs.clarity || 50) / 100),
    finHealth: Math.max(0.3, (needs.comfort || 50) / 100),
    alertness: Math.max(0.3, (needs.curiosity || 50) / 100),
    sociability: Math.max(0.3, (needs.social || 50) / 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function EchoRenderer({
  dna,
  stage = 2,
  needs,
  personality,
  size = 200,
  animated = true,
  onClick,
}) {
  // Derive all visual parameters
  const visuals = useMemo(() => {
    if (!dna) return null;

    const { bodyShape, pattern, finStyle, eyeType, signatureMark, baseHue, secondaryHue } = dna;
    const personalityMods = getPersonalityModifiers(personality);
    const needsVis = getNeedsVisuals(needs);
    const stageEffects = getStageEffects(stage, baseHue);

    // Apply personality hue shift
    const effectiveHue = (baseHue + personalityMods.hueShift + 360) % 360;
    const effectiveSecondaryHue = (secondaryHue + personalityMods.hueShift + 360) % 360;

    return {
      bodyShape, pattern, finStyle, eyeType, signatureMark,
      baseHue: effectiveHue,
      secondaryHue: effectiveSecondaryHue,
      personalityMods,
      needsVis,
      stageEffects,
    };
  }, [dna, stage, needs, personality]);

  if (!visuals) {
    // No DNA yet — show placeholder
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.4, opacity: 0.5 }}>🥚</span>
      </div>
    );
  }

  const { bodyShape, pattern, finStyle, eyeType, signatureMark, baseHue, secondaryHue, personalityMods, needsVis, stageEffects } = visuals;

  // Egg stage — render as a glowing egg
  if (stageEffects.isEgg) {
    return (
      <div
        style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label="Echo egg — waiting to hatch"
      >
        <svg width={size * 0.6} height={size * 0.8} viewBox="0 0 60 80">
          <defs>
            <radialGradient id="egg-glow" cx="50%" cy="40%" r="50%">
              <stop offset="0%" stopColor={`hsl(${baseHue}, 70%, 70%)`} stopOpacity="0.8" />
              <stop offset="100%" stopColor={`hsl(${secondaryHue}, 50%, 30%)`} stopOpacity="0.4" />
            </radialGradient>
          </defs>
          <ellipse cx="30" cy="42" rx="22" ry="30" fill="url(#egg-glow)" stroke={`hsl(${baseHue}, 60%, 50%)`} strokeWidth="1.5">
            {animated && <animate attributeName="ry" values="30;31;30" dur="3s" repeatCount="indefinite" />}
          </ellipse>
          <ellipse cx="24" cy="32" rx="4" ry="6" fill="#fff" opacity="0.15" />
        </svg>
      </div>
    );
  }

  // Scale factor for viewBox → size
  const viewBoxWidth = 100;
  const viewBoxHeight = 60;

  // Animation class based on mood/alertness
  const swimClass = animated ? "echo-swim" : "";
  const swimDuration = needsVis.alertness > 0.6 ? "4s" : "6s";

  // Fin droopiness based on comfort
  const finOpacity = needsVis.finHealth;
  const finTransform = needsVis.finHealth < 0.5 ? "rotate(5, 50, 30)" : "";

  // Body path
  const bodyPath = BODY_PATHS[bodyShape] || BODY_PATHS[0];
  const fins = FIN_PATHS[finStyle] || FIN_PATHS[0];

  // Eye position (relative to body center, shifted right for "face")
  const eyeX = 65;
  const eyeY = 28;

  return (
    <div
      style={{
        width: size,
        height: size * (viewBoxHeight / viewBoxWidth),
        cursor: onClick ? "pointer" : "default",
        position: "relative",
      }}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick(e) : undefined}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`Echo companion — stage ${stage}`}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        style={{
          filter: stageEffects.filter,
          opacity: stageEffects.opacity,
          transform: `scaleX(${personalityMods.scaleX}) scaleY(${personalityMods.scaleY})`,
          transformOrigin: "center",
        }}
      >
        <defs>
          {/* Main body gradient */}
          <linearGradient id="echo-body-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={`hsl(${baseHue}, 65%, 55%)`} />
            <stop offset="50%" stopColor={`hsl(${baseHue}, 55%, 45%)`} />
            <stop offset="100%" stopColor={`hsl(${secondaryHue}, 60%, 40%)`} />
          </linearGradient>

          {/* Belly glow gradient */}
          <radialGradient id="echo-belly-glow" cx="50%" cy="70%" r="40%">
            <stop offset="0%" stopColor={`hsl(${baseHue}, 80%, 75%)`} stopOpacity={needsVis.bellyGlow * 0.6} />
            <stop offset="100%" stopColor={`hsl(${baseHue}, 60%, 50%)`} stopOpacity="0" />
          </radialGradient>

          {/* Pattern definition */}
          {generatePattern(pattern, baseHue, secondaryHue)}

          {/* Clip path for body */}
          <clipPath id="echo-body-clip">
            <path d={bodyPath} />
          </clipPath>

          {/* Aura filter for elder+ */}
          {stageEffects.aura && (
            <filter id="echo-aura" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feColorMatrix in="blur" type="matrix" values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.4 0`} />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* Swim animation wrapper */}
        <g className={swimClass}>
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0,0; 0,-1.5; 0,0; 0,1.5; 0,0"
              dur={swimDuration}
              repeatCount="indefinite"
            />
          )}

          {/* Aura layer (elder+) */}
          {stageEffects.aura && (
            <path d={bodyPath} fill={`hsl(${baseHue}, 60%, 50%)`} opacity="0.15" filter="url(#echo-aura)" transform="scale(1.1) translate(-5, -3)">
              {animated && <animate attributeName="opacity" values="0.1;0.2;0.1" dur="3s" repeatCount="indefinite" />}
            </path>
          )}

          {/* Tail fin (behind body) */}
          <g opacity={finOpacity} transform={finTransform}>
            <path d={fins.tail} fill={`hsl(${baseHue}, 50%, 50%)`} opacity="0.7" />
          </g>

          {/* Body fill */}
          <path d={bodyPath} fill="url(#echo-body-grad)" />

          {/* Pattern overlay (clipped to body) */}
          <g clipPath="url(#echo-body-clip)">
            <rect x="0" y="0" width="100" height="60" fill="url(#echo-pattern)" />
          </g>

          {/* Belly glow (hunger indicator) */}
          <path d={bodyPath} fill="url(#echo-belly-glow)" />

          {/* Dorsal fin */}
          <g opacity={finOpacity} transform={finTransform}>
            <path d={fins.dorsal} fill={`hsl(${baseHue}, 55%, 55%)`} opacity="0.8" />
          </g>

          {/* Pectoral fin */}
          <g opacity={finOpacity}>
            <path d={fins.pectoral} fill={`hsl(${secondaryHue}, 50%, 50%)`} opacity="0.6" />
          </g>

          {/* Eye */}
          {renderEye(eyeType, eyeX, eyeY, (needsVis.eyeBrightness * 100), baseHue)}

          {/* Signature mark */}
          {renderSignatureMark(signatureMark, secondaryHue)}

          {/* Particle effects (legendary) */}
          {stageEffects.particles && animated && (
            <g>
              <circle cx="25" cy="15" r="1" fill={`hsl(${baseHue}, 80%, 80%)`} opacity="0.6">
                <animate attributeName="cy" values="15;5;15" dur="4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0;0.6" dur="4s" repeatCount="indefinite" />
              </circle>
              <circle cx="70" cy="45" r="0.8" fill={`hsl(${secondaryHue}, 80%, 80%)`} opacity="0.5">
                <animate attributeName="cy" values="45;35;45" dur="3.5s" repeatCount="indefinite" begin="1s" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="3.5s" repeatCount="indefinite" begin="1s" />
              </circle>
              <circle cx="50" cy="50" r="0.6" fill="#fff" opacity="0.4">
                <animate attributeName="cy" values="50;40;50" dur="5s" repeatCount="indefinite" begin="2s" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur="5s" repeatCount="indefinite" begin="2s" />
              </circle>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

export default EchoRenderer;
