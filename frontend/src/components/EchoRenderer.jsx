/**
 * EchoRenderer.jsx
 *
 * Art-based renderer using hand-crafted stage PNGs as the base,
 * with DNA-driven uniqueness layered on top via CSS filters and SVG overlays:
 *
 *   1. Base image: /echo-stages/stage-{N}-{name}.png
 *   2. Hue rotation: baseHue drives unique color cast
 *   3. Glow effect: secondaryHue drives colored glow/shadow
 *   4. Pattern overlay: semi-transparent SVG texture unique to DNA
 *   5. Particle effects: animated dots colored by DNA
 *   6. Stage-specific effects: opacity (larva), aura (elder), trail (legendary)
 *   7. Needs-based modifiers: brightness/saturation based on needs
 *
 * Props:
 *   - dna {{ seed, bodyShape, pattern, finStyle, eyeType, signatureMark, baseHue, secondaryHue }}
 *   - stage {number} 0–6
 *   - needs {{ hunger, clarity, comfort, curiosity, social }} each 0–100
 *   - personality {{ nurturing, analytical, adventurous, social, calm, creative }}
 *   - size {number} render size in px (default 200)
 *   - animated {boolean} enable animations (default true)
 *   - onClick {function} tap handler
 */

import React, { useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Stage image mapping
// ─────────────────────────────────────────────────────────────────────────────

// Asset version — bump this when replacing art to bust SW cache
const ECHO_ART_VERSION = "v1";

const STAGE_IMAGES = [
  `/echo-stages/stage-0-egg.png?${ECHO_ART_VERSION}`,
  `/echo-stages/stage-1-larva.png?${ECHO_ART_VERSION}`,
  `/echo-stages/stage-2-fry.png?${ECHO_ART_VERSION}`,
  `/echo-stages/stage-3-juvenile.png?${ECHO_ART_VERSION}`,
  `/echo-stages/stage-4-adult.png?${ECHO_ART_VERSION}`,
  `/echo-stages/stage-5-elder.png?${ECHO_ART_VERSION}`,
  `/echo-stages/stage-6-legendary.png?${ECHO_ART_VERSION}`,
];

const STAGE_NAMES = ["Egg", "Larva", "Fry", "Juvenile", "Adult", "Elder", "Legendary"];

// ─────────────────────────────────────────────────────────────────────────────
// Pattern overlay SVG shapes (12 types, rendered semi-transparent on top)
// ─────────────────────────────────────────────────────────────────────────────

function getPatternOverlay(patternId, hue, size) {
  const color = `hsla(${hue}, 70%, 70%, 0.12)`;
  const accent = `hsla(${hue}, 80%, 80%, 0.08)`;
  const r = size / 2;

  switch (patternId) {
    case 0: // Spots
      return Array.from({ length: 5 }, (_, i) => {
        const angle = (i / 5) * Math.PI * 2 + 0.3;
        const dist = r * 0.4 + Math.random() * r * 0.2;
        const x = r + Math.cos(angle) * dist;
        const y = r + Math.sin(angle) * dist;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${3 + i}" fill="${color}" />`;
      }).join("");
    case 1: // Stripes
      return Array.from({ length: 4 }, (_, i) => {
        const x = size * 0.25 + i * size * 0.15;
        return `<line x1="${x}" y1="${size*0.2}" x2="${x}" y2="${size*0.8}" stroke="${color}" stroke-width="3" stroke-linecap="round" />`;
      }).join("");
    case 2: // Marbling
      return `<path d="M${size*0.2},${r} Q${size*0.35},${size*0.3} ${r},${size*0.35} T${size*0.8},${r}" fill="none" stroke="${color}" stroke-width="2.5"/>
        <path d="M${size*0.15},${size*0.6} Q${size*0.4},${size*0.5} ${size*0.65},${size*0.65} T${size*0.85},${size*0.55}" fill="none" stroke="${accent}" stroke-width="2"/>`;
    case 3: // Bioluminescent veins
      return `<path d="M${size*0.3},${size*0.4} C${size*0.4},${size*0.25} ${size*0.5},${size*0.45} ${size*0.65},${size*0.3}" fill="none" stroke="${color}" stroke-width="1.5"/>
        <path d="M${size*0.35},${size*0.55} C${size*0.45},${size*0.65} ${size*0.6},${size*0.5} ${size*0.7},${size*0.6}" fill="none" stroke="${color}" stroke-width="1"/>
        <circle cx="${size*0.65}" cy="${size*0.3}" r="2" fill="${color}"/>
        <circle cx="${size*0.7}" cy="${size*0.6}" r="1.5" fill="${accent}"/>`;
    case 4: // Scales
      return Array.from({ length: 6 }, (_, i) => {
        const x = size * 0.3 + (i % 3) * size * 0.15;
        const y = size * 0.35 + Math.floor(i / 3) * size * 0.2;
        return `<path d="M${x},${y} Q${x+8},${y-6} ${x+16},${y}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
      }).join("");
    case 5: // Galaxy swirl
      return `<circle cx="${r}" cy="${r}" r="${r*0.5}" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="4 6"/>
        <circle cx="${r}" cy="${r}" r="${r*0.3}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="2 4"/>
        <circle cx="${r*0.7}" cy="${r*0.6}" r="2" fill="${color}"/>
        <circle cx="${r*1.3}" cy="${r*1.2}" r="1.5" fill="${accent}"/>`;
    case 6: // Ripples
      return `<circle cx="${r}" cy="${r}" r="${r*0.25}" fill="none" stroke="${color}" stroke-width="1.5"/>
        <circle cx="${r}" cy="${r}" r="${r*0.4}" fill="none" stroke="${accent}" stroke-width="1"/>
        <circle cx="${r}" cy="${r}" r="${r*0.55}" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.7"/>`;
    case 7: // Diamond
      return `<path d="M${r},${size*0.25} L${size*0.65},${r} L${r},${size*0.75} L${size*0.35},${r}Z" fill="none" stroke="${color}" stroke-width="1.5"/>`;
    case 8: // Fractal
      return `<path d="M${size*0.25},${r} L${size*0.35},${size*0.3} L${size*0.45},${r} L${size*0.55},${size*0.3} L${size*0.65},${r} L${size*0.75},${size*0.3}" fill="none" stroke="${color}" stroke-width="1.5"/>
        <path d="M${size*0.3},${size*0.6} L${size*0.4},${size*0.45} L${size*0.5},${size*0.6} L${size*0.6},${size*0.45} L${size*0.7},${size*0.6}" fill="none" stroke="${accent}" stroke-width="1"/>`;
    case 9: // Nebula
      return `<circle cx="${size*0.35}" cy="${size*0.4}" r="${size*0.12}" fill="${color}"/>
        <circle cx="${size*0.6}" cy="${size*0.55}" r="${size*0.09}" fill="${accent}"/>
        <circle cx="${size*0.5}" cy="${size*0.65}" r="${size*0.07}" fill="${color}"/>`;
    case 10: // Coral
      return `<path d="M${size*0.3},${size*0.7} C${size*0.3},${size*0.5} ${size*0.35},${size*0.35} ${size*0.4},${size*0.3}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <path d="M${size*0.55},${size*0.7} C${size*0.55},${size*0.55} ${size*0.6},${size*0.4} ${size*0.62},${size*0.35}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>`;
    case 11: // Plain
    default:
      return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic seeded PRNG (0..1) — used so a given Echo's swim rhythm and
// accent placement stay stable across renders instead of re-randomizing.
// ─────────────────────────────────────────────────────────────────────────────

function seededRandom(seed, index) {
  const x = Math.sin((seed || 1) * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ─────────────────────────────────────────────────────────────────────────────
// Body shape → silhouette transform (bodyShape trait, 0–7)
//
// We don't have per-shape art, so body shape is expressed as a subtle
// stretch/skew of the existing silhouette. Keeps every Echo's proportions
// personally distinct without requiring new art assets.
// ─────────────────────────────────────────────────────────────────────────────

function getBodyShapeTransform(bodyShape) {
  switch (bodyShape) {
    case 0: return "scale(0.95, 1.06)"; // sleek
    case 1: return "scale(1.07, 0.94)"; // round
    case 2: return "skewY(-2.5deg) scale(1.02, 0.98)"; // angular
    case 3: return "scale(1.08, 1)"; // flowing
    case 4: return "scale(0.9, 1.14)"; // eel-like
    case 5: return "scale(1.1, 1.08)"; // puffer
    case 6: return "skewX(2deg) scale(1.03, 1)"; // ray-finned
    case 7: return "rotate(-3deg) scale(1, 1.08)"; // seahorse
    default: return "none";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fin style accent overlay (finStyle trait, 0–9)
//
// Placed near the lower-trailing region of the frame as a generic
// approximation of a tail/fin area — the source art has no documented
// per-stage anatomy coordinates, so this is an accent, not a precise
// anatomical replacement.
// ─────────────────────────────────────────────────────────────────────────────

function getFinAccent(finStyle, hue, size) {
  const color = `hsla(${hue}, 75%, 75%, 0.4)`;
  const soft = `hsla(${hue}, 80%, 85%, 0.22)`;
  const cx = size * 0.52;
  const cy = size * 0.76;

  switch (finStyle) {
    case 0: // flowing veil
      return `<path d="M${cx-12},${cy} Q${cx},${cy+26} ${cx+16},${cy+8} Q${cx+6},${cy+18} ${cx-4},${cy+12} Q${cx-10},${cy+6} ${cx-12},${cy}Z" fill="${color}"/>`;
    case 1: // spiky
      return Array.from({ length: 4 }, (_, i) => {
        const x = cx - 12 + i * 8;
        return `<path d="M${x},${cy} L${x+4},${cy+16} L${x+8},${cy}Z" fill="${color}"/>`;
      }).join("");
    case 2: // fan
      return `<path d="M${cx},${cy} L${cx-16},${cy+14} L${cx-6},${cy+20} L${cx+2},${cy+16} L${cx+10},${cy+20} L${cx+16},${cy+12}Z" fill="${soft}"/>`;
    case 3: // ribbon
      return `<path d="M${cx-8},${cy} C${cx-14},${cy+10} ${cx-4},${cy+16} ${cx-10},${cy+26}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 4: // split
      return `<path d="M${cx},${cy} L${cx-10},${cy+22}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <path d="M${cx},${cy} L${cx+10},${cy+22}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    case 5: // crown
      return `<path d="M${cx-10},${cy+6} L${cx-6},${cy-6} L${cx-2},${cy+2} L${cx+2},${cy-8} L${cx+6},${cy+2} L${cx+10},${cy-6} L${cx+14},${cy+6}Z" fill="${color}"/>`;
    case 6: // whisker
      return `<path d="M${cx-14},${cy+4} Q${cx-22},${cy+2} ${cx-26},${cy-4}" fill="none" stroke="${soft}" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M${cx-14},${cy+10} Q${cx-22},${cy+12} ${cx-26},${cy+18}" fill="none" stroke="${soft}" stroke-width="1.5" stroke-linecap="round"/>`;
    case 7: // sail
      return `<path d="M${cx},${cy-10} Q${cx+16},${cy} ${cx},${cy+18} Q${cx-4},${cy+2} ${cx},${cy-10}Z" fill="${soft}"/>`;
    case 8: // feather
      return Array.from({ length: 3 }, (_, i) => {
        const y = cy + i * 7;
        return `<path d="M${cx},${y} Q${cx+14},${y+3} ${cx+4},${y+10}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
      }).join("");
    case 9: // trident
      return `<path d="M${cx-10},${cy} L${cx-10},${cy+16} M${cx},${cy} L${cx},${cy+20} M${cx+10},${cy} L${cx+10},${cy+16} M${cx-10},${cy} Q${cx},${cy+6} ${cx+10},${cy}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    default:
      return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature mark accent (signatureMark trait, 0–19)
//
// Small unique accent placed near the head/forehead region. 2 of the 20
// values are treated as "rare" per spec (10% rare chance) and get an
// extra glow ring.
// ─────────────────────────────────────────────────────────────────────────────

function getSignatureMarkAccent(signatureMark, hue, size) {
  const isRare = signatureMark === 0 || signatureMark === 10;
  const color = isRare ? `hsla(${hue}, 90%, 88%, 0.7)` : `hsla(${hue}, 75%, 80%, 0.45)`;
  const x = size * 0.4;
  const y = size * 0.3;
  const shapeIndex = signatureMark % 5;

  const shape = (() => {
    switch (shapeIndex) {
      case 0: // star forehead
        return `<path d="M${x},${y-6} L${x+2},${y-1} L${x+7},${y-1} L${x+3},${y+2} L${x+4},${y+7} L${x},${y+4} L${x-4},${y+7} L${x-3},${y+2} L${x-7},${y-1} L${x-2},${y-1}Z" fill="${color}"/>`;
      case 1: // tail ring
        return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${color}" stroke-width="1.8"/>`;
      case 2: // cheek dots
        return `<circle cx="${x-4}" cy="${y}" r="1.6" fill="${color}"/><circle cx="${x+2}" cy="${y+3}" r="1.6" fill="${color}"/><circle cx="${x+6}" cy="${y-2}" r="1.6" fill="${color}"/>`;
      case 3: // glowing barbel
        return `<path d="M${x},${y} Q${x-6},${y+8} ${x-10},${y+16}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;
      default: // crescent mark
        return `<path d="M${x-5},${y-5} A7,7 0 1 0 ${x-5},${y+5}" fill="none" stroke="${color}" stroke-width="1.8"/>`;
    }
  })();

  const rareGlow = isRare
    ? `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.5"/>`
    : "";

  return `${rareGlow}${shape}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eye type shimmer (eyeType trait, 0–5)
//
// Exact eye pixel coordinates aren't mapped per stage in the source art,
// so instead of guessing a literal eye overlay (risking visible misalignment),
// eyeType drives a subtle head-area glint style — color + rhythm — layered
// generically in the upper-head region.
// ─────────────────────────────────────────────────────────────────────────────

function getEyeShimmerStyle(eyeType, hue) {
  const variants = [
    { color: `hsla(${hue}, 60%, 90%, 0.55)`, duration: 2.6 }, // round
    { color: `hsla(${hue + 20}, 70%, 88%, 0.5)`, duration: 3.2 }, // almond
    { color: `hsla(${(hue + 180) % 360}, 80%, 85%, 0.6)`, duration: 2.2 }, // galaxy
    { color: `hsla(${hue}, 90%, 92%, 0.65)`, duration: 1.8 }, // gem
    { color: `hsla(${hue - 30}, 50%, 75%, 0.4)`, duration: 3.6 }, // ancient
    { color: `hsla(20, 90%, 70%, 0.6)`, duration: 2.0 }, // ember
  ];
  return variants[eyeType % variants.length] || variants[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Wander motion — deterministic per-Echo swim path (drift + tilt), replaces
// the plain vertical bob so each Echo has its own personal swim rhythm.
// ─────────────────────────────────────────────────────────────────────────────

function getWanderStyle(seed, size, stage) {
  const amp = Math.max(4, size * 0.05);
  const ampY = Math.max(3, size * 0.03);
  const rotAmp = 4 + seededRandom(seed, 1) * 4;
  const speedFactor = stage < 3 ? 1.3 : stage >= 5 ? 0.85 : 1; // younger stages drift faster/twitchier
  const duration = (5 + seededRandom(seed, 2) * 3) * speedFactor;

  const pick = (i, range) => (seededRandom(seed, i) - 0.5) * 2 * range;

  return {
    vars: {
      "--wx1": `${pick(3, amp)}px`,
      "--wy1": `${pick(4, ampY)}px`,
      "--wr1": `${pick(5, rotAmp)}deg`,
      "--wx2": `${pick(6, amp)}px`,
      "--wy2": `${pick(7, ampY)}px`,
      "--wr2": `${pick(8, rotAmp)}deg`,
      "--wx3": `${pick(9, amp)}px`,
      "--wy3": `${pick(10, ampY)}px`,
      "--wr3": `${pick(11, rotAmp)}deg`,
    },
    duration,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Personality visual modifiers
// ─────────────────────────────────────────────────────────────────────────────

function getPersonalityEffects(personality) {
  if (!personality) return { extraHueShift: 0, saturationBoost: 0, glowBoost: 0 };

  const { nurturing = 10, analytical = 10, adventurous = 10, social = 10, calm = 10, creative = 10 } = personality;
  const max = Math.max(nurturing, analytical, adventurous, social, calm, creative);

  let extraHueShift = 0;
  let saturationBoost = 0;
  let glowBoost = 0;

  if (max > 30) {
    if (nurturing === max) { extraHueShift = 8; saturationBoost = 5; }
    else if (analytical === max) { extraHueShift = -12; saturationBoost = -5; }
    else if (adventurous === max) { saturationBoost = 10; glowBoost = 0.1; }
    else if (social === max) { glowBoost = 0.15; saturationBoost = 8; }
    else if (calm === max) { extraHueShift = -18; }
    else if (creative === max) { extraHueShift = 12; saturationBoost = 10; glowBoost = 0.08; }
  }

  return { extraHueShift, saturationBoost, glowBoost };
}

// ─────────────────────────────────────────────────────────────────────────────
// Needs-based modifiers
// ─────────────────────────────────────────────────────────────────────────────

function getNeedsBrightness(needs) {
  if (!needs) return { brightness: 1, saturation: 1 };
  const avg = (
    (needs.hunger ?? 80) +
    (needs.clarity ?? 80) +
    (needs.comfort ?? 80) +
    (needs.curiosity ?? 80) +
    (needs.social ?? 80)
  ) / 5;

  // Map 0–100 average to brightness 0.5–1.1
  const brightness = 0.5 + (avg / 100) * 0.6;
  // Saturation drops when needs are low
  const saturation = 0.6 + (avg / 100) * 0.5;

  return { brightness, saturation };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
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
  const visuals = useMemo(() => {
    if (!dna) return null;

    const { seed, baseHue, secondaryHue, pattern, bodyShape, finStyle, eyeType, signatureMark } = dna;
    const personalityFx = getPersonalityEffects(personality);
    const needsFx = getNeedsBrightness(needs);

    // Final hue shift combines DNA base with personality drift
    const hueRotation = baseHue + personalityFx.extraHueShift;
    // Normalize: we rotate from a "neutral" starting point (the art is roughly teal/blue ~190°)
    // So actual rotation = desired hue - art base hue
    const artBaseHue = 190;
    const hueRotateDeg = hueRotation - artBaseHue;

    const glowColor = `hsl(${secondaryHue}, 70%, 55%)`;
    const particleColor1 = `hsl(${baseHue}, 80%, 70%)`;
    const particleColor2 = `hsl(${secondaryHue}, 75%, 65%)`;

    return {
      hueRotateDeg,
      saturation: 100 + personalityFx.saturationBoost,
      brightness: needsFx.brightness,
      needsSaturation: needsFx.saturation,
      glowColor,
      glowBoost: personalityFx.glowBoost,
      particleColor1,
      particleColor2,
      pattern,
      bodyShape,
      finStyle,
      eyeType,
      signatureMark,
      baseHue,
      secondaryHue,
      seed,
    };
  }, [dna, personality, needs]);

  if (!visuals) {
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.3, opacity: 0.4 }}>🥚</span>
      </div>
    );
  }

  const {
    hueRotateDeg, saturation, brightness, needsSaturation,
    glowColor, glowBoost, particleColor1, particleColor2,
    pattern, bodyShape, finStyle, eyeType, signatureMark, baseHue, secondaryHue, seed,
  } = visuals;

  // Stage-specific effects
  let stageOpacity = 1;
  let glowIntensity = 0;
  let auraSize = 0;
  let showParticles = false;

  switch (stage) {
    case 0: break; // Egg — just color shift
    case 1: stageOpacity = 0.6; break;
    case 2: stageOpacity = 0.85; break;
    case 3: glowIntensity = 0.3; break;
    case 4: glowIntensity = 0.5; break;
    case 5: glowIntensity = 0.7; auraSize = 8; break;
    case 6: glowIntensity = 1; auraSize = 14; showParticles = true; break;
    default: break;
  }

  glowIntensity += glowBoost;

  // Build CSS filter
  const filter = [
    `hue-rotate(${hueRotateDeg}deg)`,
    `saturate(${Math.round(saturation * needsSaturation)}%)`,
    `brightness(${brightness.toFixed(2)})`,
    glowIntensity > 0 ? `drop-shadow(0 0 ${Math.round(6 + glowIntensity * 10)}px ${glowColor})` : "",
  ].filter(Boolean).join(" ");

  // Wander motion — deterministic per-Echo drift/tilt path (replaces plain bob)
  const wander = getWanderStyle(seed, size, stage);
  const animationStyle = animated ? {
    animation: `echo-wander ${wander.duration.toFixed(2)}s ease-in-out infinite`,
    ...wander.vars,
  } : {};

  // Body shape silhouette transform — applied to the image itself so it
  // composes with (rather than fights) the wander animation on the wrapper
  const bodyShapeTransform = getBodyShapeTransform(bodyShape);

  const eyeShimmer = getEyeShimmerStyle(eyeType, baseHue);

  // Aura animation (elder/legendary)
  const auraStyle = auraSize > 0 ? {
    position: "absolute",
    inset: `-${auraSize}px`,
    borderRadius: "50%",
    background: `radial-gradient(circle, ${glowColor}20 0%, transparent 70%)`,
    animation: animated ? "echo-aura-pulse 3s ease-in-out infinite" : "none",
    pointerEvents: "none",
  } : null;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        ...animationStyle,
      }}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick(e) : undefined}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`Echo companion — ${STAGE_NAMES[stage]} stage`}
    >
      {/* Aura layer (elder/legendary) */}
      {auraStyle && <div style={auraStyle} />}

      {/* Main image with DNA color shifting */}
      <img
        src={STAGE_IMAGES[stage] || STAGE_IMAGES[2]}
        alt={`Echo — ${STAGE_NAMES[stage]}`}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          filter,
          opacity: stageOpacity,
          position: "relative",
          zIndex: 1,
          transform: bodyShapeTransform,
          transition: "filter 0.5s ease, opacity 0.5s ease",
        }}
        draggable={false}
      />

      {/* Head-area eye shimmer (eyeType trait) */}
      {stage > 0 && animated && (
        <div
          style={{
            position: "absolute",
            left: "42%",
            top: "28%",
            width: `${Math.max(4, size * 0.05)}px`,
            height: `${Math.max(4, size * 0.05)}px`,
            borderRadius: "50%",
            background: eyeShimmer.color,
            zIndex: 2,
            pointerEvents: "none",
            animation: `echo-eye-shimmer ${eyeShimmer.duration}s ease-in-out infinite`,
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* Pattern + fin-style + signature-mark overlay (SVG on top of image) */}
      {stage > 0 && (
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 2,
            mixBlendMode: "screen",
            opacity: stage >= 4 ? 0.6 : 0.4,
          }}
          viewBox={`0 0 ${size} ${size}`}
          dangerouslySetInnerHTML={{
            __html: [
              pattern !== 11 ? getPatternOverlay(pattern, baseHue, size) : "",
              getFinAccent(finStyle, secondaryHue, size),
              getSignatureMarkAccent(signatureMark, baseHue, size),
            ].join(""),
          }}
        />
      )}

      {/* Particle effects (legendary) */}
      {showParticles && animated && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${20 + i * 14}%`,
                bottom: `${10 + i * 5}%`,
                width: `${3 + i % 2}px`,
                height: `${3 + i % 2}px`,
                borderRadius: "50%",
                background: i % 2 === 0 ? particleColor1 : particleColor2,
                animation: `echo-particle-rise ${3 + i * 0.5}s ease-in-out infinite`,
                animationDelay: `${i * 0.6}s`,
                opacity: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* Inline keyframes */}
      <style>{`
        @keyframes echo-wander {
          0%   { transform: translate(0, 0) rotate(0deg); }
          25%  { transform: translate(var(--wx1), var(--wy1)) rotate(var(--wr1)); }
          50%  { transform: translate(var(--wx2), var(--wy2)) rotate(var(--wr2)); }
          75%  { transform: translate(var(--wx3), var(--wy3)) rotate(var(--wr3)); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes echo-eye-shimmer {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 0.9; transform: scale(1.15); }
        }
        @keyframes echo-aura-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.05); }
        }
        @keyframes echo-particle-rise {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          30% { opacity: 0.8; transform: translateY(-10px) scale(1); }
          70% { opacity: 0.6; transform: translateY(-25px) scale(0.8); }
          100% { opacity: 0; transform: translateY(-40px) scale(0.3); }
        }
      `}</style>
    </div>
  );
}

export default EchoRenderer;
