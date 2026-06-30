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

    const { baseHue, secondaryHue, pattern, signatureMark } = dna;
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
      signatureMark,
      baseHue,
      secondaryHue,
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
    pattern, baseHue, secondaryHue,
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

  // Animation
  const animationStyle = animated ? {
    animation: `echo-float ${stage < 3 ? "4s" : "3.5s"} ease-in-out infinite`,
  } : {};

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
          transition: "filter 0.5s ease, opacity 0.5s ease",
        }}
        draggable={false}
      />

      {/* Pattern overlay (SVG on top of image) */}
      {pattern !== 11 && stage > 0 && (
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
            __html: getPatternOverlay(pattern, baseHue, size),
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
        @keyframes echo-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-${Math.max(3, size * 0.02)}px); }
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
